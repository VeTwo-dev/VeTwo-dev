import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { selectRepos } from "../scripts/lib/github.mjs";

const repo = (overrides) => ({
  id: 0, // placeholder, every fixture below overrides it
  name: "x",
  private: false,
  fork: false,
  archived: false,
  pushed_at: "2026-09-20T00:00:00Z",
  updated_at: "2026-09-20T00:00:00Z",
  stargazers_count: 0,
  ...overrides,
});

describe("selectRepos (pushed mode)", () => {
  it("orders by pushed_at DESC", () => {
    const repos = [
      repo({ id: 1, name: "old", pushed_at: "2026-09-18T00:00:00Z" }),
      repo({ id: 2, name: "new", pushed_at: "2026-09-24T00:00:00Z" }),
      repo({ id: 3, name: "mid", pushed_at: "2026-09-20T00:00:00Z" }),
    ];
    const out = selectRepos(repos, { count: 3, sortBy: "pushed", username: "VeTwo-dev" });
    assert.deepEqual(out.map((r) => r.name), ["new", "mid", "old"]);
  });

  it("breaks pushed_at ties by updated_at DESC then name ASC", () => {
    const repos = [
      repo({ id: 1, name: "zeta", updated_at: "2026-09-21T00:00:00Z" }),
      repo({ id: 2, name: "alpha", updated_at: "2026-09-21T00:00:00Z" }),
      repo({ id: 3, name: "mid", updated_at: "2026-09-25T00:00:00Z" }),
    ];
    const out = selectRepos(repos, { count: 3, sortBy: "pushed", username: "VeTwo-dev" });
    assert.deepEqual(out.map((r) => r.name), ["mid", "alpha", "zeta"]);
  });

  it("caps results at count", () => {
    const repos = Array.from({ length: 6 }, (_, i) =>
      repo({ id: 10 + i, name: `r${i}`, pushed_at: `2026-09-${10 + i}T00:00:00Z` })
    );
    const out = selectRepos(repos, { count: 4, sortBy: "pushed", username: "VeTwo-dev" });
    assert.equal(out.length, 4);
    assert.deepEqual(out.map((r) => r.name), ["r5", "r4", "r3", "r2"]);
  });
});

describe("selectRepos (stars mode)", () => {
  it("orders by stargazers_count DESC with pushed_at then name tiebreaks", () => {
    const repos = [
      repo({ id: 1, name: "quiet", stargazers_count: 1, pushed_at: "2026-07-09T00:00:00Z" }),
      repo({ id: 2, name: "popular", stargazers_count: 9, pushed_at: "2026-01-01T00:00:00Z" }),
      repo({ id: 3, name: "b-mid", stargazers_count: 1, pushed_at: "2026-07-13T00:00:00Z" }),
      repo({ id: 4, name: "a-mid", stargazers_count: 1, pushed_at: "2026-07-13T00:00:00Z" }),
    ];
    const out = selectRepos(repos, { count: 4, sortBy: "stars", username: "VeTwo-dev" });
    assert.deepEqual(out.map((r) => r.name), ["popular", "a-mid", "b-mid", "quiet"]);
  });

  it("dedupes by id without changing order", () => {
    const dup = repo({ id: 7, name: "same", stargazers_count: 2 });
    const out = selectRepos([dup, { ...dup }, repo({ id: 8, name: "other", stargazers_count: 1 })], {
      count: 3,
      sortBy: "stars",
      username: "VeTwo-dev",
    });
    assert.deepEqual(out.map((r) => r.name), ["same", "other"]);
  });
});

describe("selectRepos filtering", () => {
  it("excludes the profile repo and forks/archived/private with fallbacks", () => {
    const repos = [
      repo({ id: 1, name: "VeTwo-dev", pushed_at: "2026-09-30T00:00:00Z" }),
      repo({ id: 2, name: "good-a", pushed_at: "2026-09-24T00:00:00Z" }),
      repo({ id: 3, name: "a-fork", fork: true, pushed_at: "2026-09-25T00:00:00Z" }),
      repo({ id: 4, name: "good-b", pushed_at: "2026-09-23T00:00:00Z" }),
    ];
    const out = selectRepos(repos, { count: 2, sortBy: "pushed", username: "VeTwo-dev" });
    assert.deepEqual(out.map((r) => r.name), ["good-a", "good-b"]);
  });

  it("falls back to public then all repos so a section is always produced", () => {
    const repos = [
      repo({ id: 1, name: "only-fork", fork: true }),
      repo({ id: 2, name: "only-archived", archived: true }),
    ];
    const out = selectRepos(repos, { count: 4, sortBy: "pushed", username: "VeTwo-dev" });
    assert.equal(out.length, 2);
  });

  it("keeps the profile repo when too few other repos exist", () => {
    const repos = [
      repo({ id: 1, name: "VeTwo-dev", pushed_at: "2026-09-30T00:00:00Z" }),
      repo({ id: 2, name: "solo", pushed_at: "2026-09-20T00:00:00Z" }),
    ];
    const out = selectRepos(repos, { count: 4, sortBy: "pushed", username: "VeTwo-dev" });
    assert.ok(out.some((r) => r.name === "VeTwo-dev"));
  });

  it("returns [] for empty input", () => {
    assert.deepEqual(selectRepos([], { count: 4, username: "VeTwo-dev" }), []);
  });
});
