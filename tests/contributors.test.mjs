import { describe, it, after } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync, existsSync, writeFileSync, rm } from "node:fs";
import { execFile } from "node:child_process";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  contributorKey,
  isBotContributor,
  selectEligibleRepos,
  fetchRepoContributors,
  aggregateContributors,
  sortContributors,
  renderContributorsSection,
  collectContributors,
  contributorOptions,
} from "../scripts/generate-contributors.mjs";
import { PIPELINE_SCRIPTS } from "../scripts/ci.mjs";
import { ROOT, withLock } from "./helpers.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// A fake token that must never reach stdout, stderr, a log line or an
// exception message. Everything below runs with injected fetches or against
// a local fixture server, so no live network request is ever made.
const FAKE_TOKEN = "ghp_testcontributortoken1234567890";

const CONTRIBUTOR_FIXTURES = {
  neo: {
    login: "neo",
    id: 10,
    avatar_url: "https://avatars.githubusercontent.com/u/10?v=4",
    html_url: "https://github.com/neo",
    type: "User",
    contributions: 7,
  },
  trinity: {
    login: "trinity",
    id: 11,
    avatar_url: "https://avatars.githubusercontent.com/u/11?v=4",
    html_url: "https://github.com/trinity",
    type: "User",
    contributions: 3,
  },
  morpheus: {
    login: "morpheus",
    id: 12,
    avatar_url: "https://avatars.githubusercontent.com/u/12?v=4",
    html_url: "https://github.com/morpheus",
    type: "User",
    contributions: 5,
  },
  dependabot: {
    login: "dependabot[bot]",
    id: 13,
    avatar_url: "https://avatars.githubusercontent.com/u/13?v=4",
    html_url: "https://github.com/apps/dependabot",
    type: "Bot",
    contributions: 99,
  },
};

function mockResponse({ status = 200, body = [], headers = {} } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: `status ${status}`,
    headers: {
      get: (name) => {
        const wanted = String(name).toLowerCase();
        const key = Object.keys(headers).find(
          (h) => h.toLowerCase() === wanted,
        );
        return key ? headers[key] : null;
      },
    },
    json: async () => (typeof body === "string" ? JSON.parse(body) : body),
    text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
  };
}

// Scripted fetch: `handler(url, opts)` resolves to a mockResponse. Records
// every call so header/pagination behaviour can be asserted.
function mockFetch(handler) {
  const calls = [];
  const impl = (url, opts) => {
    calls.push({ url: String(url), opts: opts || {} });
    return Promise.resolve(handler(String(url), opts || {}));
  };
  impl.calls = calls;
  return impl;
}

const REPO_IDS = new Map();

function repoFixture(name, overrides = {}) {
  if (!REPO_IDS.has(name)) REPO_IDS.set(name, REPO_IDS.size + 100);
  return {
    id: REPO_IDS.get(name),
    name,
    full_name: `VeTwo-dev/${name}`,
    fork: false,
    archived: false,
    private: false,
    pushed_at: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("contributor identity", () => {
  it("keys contributors by numeric id when the API provides it", () => {
    assert.equal(contributorKey({ id: 42, login: "neo" }), "id:42");
    assert.equal(contributorKey({ id: "42", login: "neo" }), "id:42");
    assert.equal(contributorKey({ id: 0 }), "login:");
  });

  it("falls back to a normalized login key when no id is returned", () => {
    assert.equal(contributorKey({ login: "Neo" }), "login:neo");
    assert.equal(
      contributorKey({ login: "NEO" }),
      contributorKey({ login: "neo" }),
    );
    assert.notEqual(
      contributorKey({ login: "neo" }),
      contributorKey({ login: "trinity" }),
    );
  });

  it("treats type Bot and the [bot] suffix as bots", () => {
    assert.equal(
      isBotContributor({ type: "Bot", login: "renovate[bot]" }),
      true,
    );
    assert.equal(
      isBotContributor({ type: "User", login: "renovate[bot]" }),
      true,
    );
    assert.equal(isBotContributor({ type: "User", login: "neo" }), false);
    assert.equal(isBotContributor(null), false);
  });
});

describe("eligible repository selection", () => {
  const repos = [
    repoFixture("Website"),
    repoFixture("VeTwo-dev", { id: 100 }), // profile repo itself
    repoFixture("Forked-Lib", { fork: true, id: 101 }),
    repoFixture("Old-Project", { archived: true, id: 102 }),
    repoFixture("Private-Thing", { private: true, id: 103 }),
    repoFixture("Api"),
  ];

  it("keeps only non-fork, non-archived, non-private repos and drops the profile repo", () => {
    const eligible = selectEligibleRepos(repos, { username: "VeTwo-dev" });
    assert.deepEqual(eligible.map((r) => r.name).sort(), ["Api", "Website"]);
  });

  it("respects explicit filter overrides", () => {
    const eligible = selectEligibleRepos(repos, {
      username: "VeTwo-dev",
      filter: {
        excludeForks: false,
        excludeArchived: true,
        excludePrivate: true,
      },
    });
    assert.deepEqual(eligible.map((r) => r.name).sort(), [
      "Api",
      "Forked-Lib",
      "Website",
    ]);
  });

  it("deduplicates repositories by id", () => {
    const dup = [
      repoFixture("Website", { id: 7 }),
      repoFixture("Website", { id: 7 }),
      repoFixture("Api", { id: 8 }),
    ];
    assert.deepEqual(
      selectEligibleRepos(dup).map((r) => r.name),
      ["Website", "Api"],
    );
  });

  it("returns an empty list for empty or invalid input", () => {
    assert.deepEqual(selectEligibleRepos([]), []);
    assert.deepEqual(selectEligibleRepos(null), []);
    assert.deepEqual(selectEligibleRepos([{ description: "no name" }]), []);
  });
});

describe("fetchRepoContributors (mocked, no network)", () => {
  it("follows pagination and never returns a contributor twice", async () => {
    const firstLink =
      "https://api.github.com/repos/VeTwo-dev/Alpha/contributors?per_page=100&anon=false&page=2";
    const fetchImpl = mockFetch((url) => {
      if (url.includes("page=2"))
        return mockResponse({
          body: [CONTRIBUTOR_FIXTURES.trinity, CONTRIBUTOR_FIXTURES.neo],
        });
      return mockResponse({
        body: [CONTRIBUTOR_FIXTURES.neo],
        headers: {
          link: `<${firstLink}>; rel="next", <https://x>; rel="last"`,
        },
      });
    });
    const result = await fetchRepoContributors("Alpha", "", { fetchImpl });
    assert.equal(result.ok, true);
    assert.deepEqual(
      result.contributors.map((c) => c.login),
      ["neo", "trinity"],
    );
    assert.equal(fetchImpl.calls.length, 2, "exactly two pages requested");
    assert.ok(
      fetchImpl.calls[0].opts.headers.Accept,
      "uses the shared GitHub API headers",
    );
  });

  it("classifies 401 as a fatal authentication error", async () => {
    const fetchImpl = mockFetch(() =>
      mockResponse({ status: 401, body: "Bad credentials" }),
    );
    const result = await fetchRepoContributors("Alpha", FAKE_TOKEN, {
      fetchImpl,
    });
    assert.equal(result.ok, false);
    assert.equal(result.fatal, true);
    assert.equal(result.httpStatus, 401);
  });

  it("classifies 403 as a fatal rate-limit error", async () => {
    const fetchImpl = mockFetch(() =>
      mockResponse({
        status: 403,
        body: `rate limit exceeded for ${FAKE_TOKEN}`,
        headers: { "x-ratelimit-remaining": "0" },
      }),
    );
    const result = await fetchRepoContributors("Alpha", FAKE_TOKEN, {
      fetchImpl,
    });
    assert.equal(result.ok, false);
    assert.equal(result.fatal, true);
    assert.equal(result.httpStatus, 403);
    assert.ok(!result.reason.includes(FAKE_TOKEN), "reason must be redacted");
  });

  it("classifies 204/404/410 as unavailable but non-fatal", async () => {
    for (const status of [204, 404, 410]) {
      const fetchImpl = mockFetch(() => mockResponse({ status, body: "" }));
      const result = await fetchRepoContributors("Empty", "", { fetchImpl });
      assert.equal(result.ok, false, `status ${status} must not be ok`);
      assert.equal(
        result.fatal,
        undefined,
        `status ${status} must not be fatal`,
      );
    }
  });

  it("treats a non-array payload as unavailable", async () => {
    const fetchImpl = mockFetch(() =>
      mockResponse({ body: { message: "nope" } }),
    );
    const result = await fetchRepoContributors("Alpha", "", { fetchImpl });
    assert.equal(result.ok, false);
    assert.equal(result.fatal, undefined);
  });

  it("caps per_page at 100 and encodes the repository name", async () => {
    const fetchImpl = mockFetch(() => mockResponse({ body: [] }));
    await fetchRepoContributors("My Repo", "", { fetchImpl, perPage: 1000 });
    const called = fetchImpl.calls[0].url;
    assert.ok(
      called.includes("per_page=100"),
      "per_page must be capped at 100",
    );
    assert.ok(
      called.includes("/repos/VeTwo-dev/My%20Repo/contributors"),
      "repository name must be encoded",
    );
  });
});

describe("aggregation", () => {
  it("aggregates the same contributor across multiple repositories once", () => {
    const entries = aggregateContributors([
      {
        repo: "VeTwo-dev/Alpha",
        contributors: [CONTRIBUTOR_FIXTURES.neo, CONTRIBUTOR_FIXTURES.trinity],
      },
      {
        repo: "VeTwo-dev/Beta",
        contributors: [CONTRIBUTOR_FIXTURES.neo, CONTRIBUTOR_FIXTURES.morpheus],
      },
    ]);
    assert.equal(entries.length, 3, "one roster entry per identity");
    const neo = entries.find((e) => e.login === "neo");
    assert.equal(
      neo.contributions,
      14,
      "contributions are summed across repositories",
    );
    assert.deepEqual(neo.repos, ["VeTwo-dev/Alpha", "VeTwo-dev/Beta"]);
    assert.equal(neo.projectCount, 2, "distinct project count");
  });

  it("keeps identity stable when the username changes", () => {
    const entries = aggregateContributors([
      {
        repo: "VeTwo-dev/Alpha",
        contributors: [{ ...CONTRIBUTOR_FIXTURES.neo, login: "old-name" }],
      },
      {
        repo: "VeTwo-dev/Beta",
        contributors: [{ ...CONTRIBUTOR_FIXTURES.neo, login: "new-name" }],
      },
    ]);
    assert.equal(entries.length, 1, "same id aggregates into one entry");
    assert.deepEqual(entries[0].logins.sort(), ["new-name", "old-name"]);
    assert.equal(entries[0].login, "new-name", "deterministic login pick");
  });

  it("aggregates by login when the API returns no id", () => {
    const entries = aggregateContributors([
      {
        repo: "VeTwo-dev/Alpha",
        contributors: [
          {
            login: "Neo",
            contributions: 2,
            avatar_url: "https://avatars.githubusercontent.com/u/9",
          },
        ],
      },
      {
        repo: "VeTwo-dev/Beta",
        contributors: [
          {
            login: "neo",
            contributions: 4,
            avatar_url: "https://avatars.githubusercontent.com/u/9",
          },
        ],
      },
    ]);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].contributions, 6);
    assert.equal(entries[0].projectCount, 2);
  });

  it("never counts the same repository twice for one contributor", () => {
    const entries = aggregateContributors([
      {
        repo: "VeTwo-dev/Alpha",
        // Simulates a retried/overlapping page returning the same person twice.
        contributors: [
          CONTRIBUTOR_FIXTURES.neo,
          CONTRIBUTOR_FIXTURES.neo,
          CONTRIBUTOR_FIXTURES.neo,
        ],
      },
      { repo: "VeTwo-dev/Beta", contributors: [CONTRIBUTOR_FIXTURES.neo] },
    ]);
    const neo = entries[0];
    assert.equal(neo.contributions, 14);
    assert.deepEqual(neo.repos, ["VeTwo-dev/Alpha", "VeTwo-dev/Beta"]);
    assert.equal(neo.projectCount, 2);
  });

  it("marks totals unreliable when any response lacks a numeric count", () => {
    const entries = aggregateContributors([
      {
        repo: "VeTwo-dev/Alpha",
        contributors: [{ login: "neo", id: 10, contributions: 5 }],
      },
      { repo: "VeTwo-dev/Beta", contributors: [{ login: "neo", id: 10 }] },
    ]);
    assert.equal(entries.length, 1);
    assert.equal(
      entries[0].contributions,
      null,
      "unreliable totals must render as unknown, not guessed",
    );
  });

  it("excludes bots by default and includes them when configured", () => {
    const perRepo = [
      {
        repo: "VeTwo-dev/Alpha",
        contributors: [
          CONTRIBUTOR_FIXTURES.neo,
          CONTRIBUTOR_FIXTURES.dependabot,
        ],
      },
    ];
    const humans = aggregateContributors(perRepo);
    assert.deepEqual(
      humans.map((e) => e.login),
      ["neo"],
    );
    const withBots = aggregateContributors(perRepo, { includeBots: true });
    assert.deepEqual(withBots.map((e) => e.login).sort(), [
      "dependabot[bot]",
      "neo",
    ]);
  });

  it("ignores empty contributor lists and invalid input", () => {
    assert.deepEqual(
      aggregateContributors([{ repo: "VeTwo-dev/Alpha", contributors: [] }]),
      [],
    );
    assert.deepEqual(aggregateContributors([]), []);
    assert.deepEqual(aggregateContributors(null), []);
  });

  it("drops unsafe avatar and profile URLs", () => {
    const entries = aggregateContributors([
      {
        repo: "VeTwo-dev/Alpha",
        contributors: [
          {
            login: "evil",
            id: 44,
            contributions: 1,
            avatar_url: "javascript:alert(1)",
            html_url: "javascript:alert(1)",
          },
          {
            login: "good",
            id: 45,
            contributions: 1,
            avatar_url: "http://insecure.example/a.png",
          },
        ],
      },
    ]);
    const evil = entries.find((e) => e.login === "evil");
    const good = entries.find((e) => e.login === "good");
    assert.equal(evil.avatarUrl, null);
    assert.equal(good.avatarUrl, null, "only https URLs are used");
    assert.equal(
      good.htmlUrl,
      "https://github.com/good",
      "profile URL falls back to the GitHub profile",
    );
  });

  it("is order independent for equal API responses", () => {
    const a = aggregateContributors([
      {
        repo: "VeTwo-dev/Alpha",
        contributors: [CONTRIBUTOR_FIXTURES.neo, CONTRIBUTOR_FIXTURES.morpheus],
      },
      { repo: "VeTwo-dev/Beta", contributors: [CONTRIBUTOR_FIXTURES.trinity] },
    ]);
    const b = aggregateContributors([
      { repo: "VeTwo-dev/Beta", contributors: [CONTRIBUTOR_FIXTURES.trinity] },
      {
        repo: "VeTwo-dev/Alpha",
        contributors: [CONTRIBUTOR_FIXTURES.morpheus, CONTRIBUTOR_FIXTURES.neo],
      },
    ]);
    assert.deepEqual(sortContributors(a), sortContributors(b));
  });
});

describe("sortContributors", () => {
  it("sorts by contribution count descending then login ascending", () => {
    const sorted = sortContributors([
      { login: "zeta", contributions: 2 },
      { login: "alpha", contributions: 2 },
      { login: "mid", contributions: 10 },
    ]);
    assert.deepEqual(
      sorted.map((e) => e.login),
      ["mid", "alpha", "zeta"],
    );
  });

  it("places unknown counts last and stays deterministic", () => {
    const input = [
      { login: "b", contributions: null },
      { login: "a", contributions: null },
      { login: "c", contributions: 1 },
    ];
    assert.deepEqual(
      sortContributors(input).map((e) => e.login),
      ["c", "a", "b"],
    );
    assert.deepEqual(sortContributors(input), sortContributors(input));
  });
});

describe("rendering", () => {
  const options = { columns: 3, avatarSizePx: 64, maxContributors: 0 };

  it("renders the heading, avatars and links for multiple contributors", () => {
    const entries = aggregateContributors([
      {
        repo: "VeTwo-dev/Alpha",
        contributors: [CONTRIBUTOR_FIXTURES.neo, CONTRIBUTOR_FIXTURES.trinity],
      },
    ]);
    const md = renderContributorsSection(entries, options);
    assert.ok(
      md.startsWith(
        "<!-- This section is generated automatically. Do not edit directly.",
      ),
      "generated banner first",
    );
    assert.ok(md.includes("## Contributors"), "exact heading");
    assert.ok(
      md.includes(
        '<a href="https://github.com/neo" title="neo"><img src="https://avatars.githubusercontent.com/u/10?v=4" alt="@neo avatar"',
      ),
    );
    assert.ok(md.includes(">neo</a>"));
    assert.ok(md.includes("7 commits · 1 repo"));
    assert.ok(
      md.includes('width="33.33%"'),
      "column width derived from the configured columns",
    );
  });

  it("escapes usernames and never emits an unsafe URL", () => {
    const entries = [
      {
        key: "id:1",
        id: 1,
        login: "<script>x</script>",
        logins: ["<script>x</script>"],
        avatarUrl: null,
        htmlUrl: "https://github.com/x",
        contributions: 3,
        repos: ["VeTwo-dev/Alpha"],
        projectCount: 1,
      },
    ];
    const md = renderContributorsSection(entries, {
      ...options,
      maxContributors: 0,
    });
    assert.ok(!md.includes("<script>"), "raw markup must be escaped");
    assert.ok(md.includes("&lt;script&gt;"));
    assert.ok(!md.includes("javascript:"), "no unsafe schemes in output");
    assert.ok(
      !md.includes('src="javascript:'),
      "avatar source must never be a script URL",
    );
  });

  it("falls back to a styled initial tile when no avatar URL exists", () => {
    const entries = [
      {
        key: "id:1",
        id: 1,
        login: "neo",
        logins: ["neo"],
        avatarUrl: null,
        htmlUrl: "https://github.com/neo",
        contributions: 3,
        repos: ["VeTwo-dev/Alpha"],
        projectCount: 1,
      },
    ];
    const md = renderContributorsSection(entries, options);
    assert.ok(md.includes(">N</span>"), "initial tile must be used");
    assert.ok(!md.includes("<img"), "no broken image element without a URL");
    assert.ok(
      !md.includes("placeholder.svg"),
      "must not reuse the project thumbnail placeholder",
    );
  });

  it("shows a clear message with no contributors", () => {
    const md = renderContributorsSection([], {
      ...options,
      emptyMessage:
        "No contributors available yet — be the first to contribute.",
    });
    assert.ok(md.includes("## Contributors"));
    assert.ok(
      md.includes(
        "No contributors available yet — be the first to contribute.",
      ),
    );
    assert.ok(!md.includes("<table"), "no empty table");
  });

  it("truncates after sorting and reports the remainder", () => {
    const entries = [
      {
        key: "id:1",
        id: 1,
        login: "low",
        logins: ["low"],
        avatarUrl: null,
        htmlUrl: "https://github.com/low",
        contributions: 1,
        repos: ["VeTwo-dev/Alpha"],
        projectCount: 1,
      },
      {
        key: "id:2",
        id: 2,
        login: "top",
        logins: ["top"],
        avatarUrl: null,
        htmlUrl: "https://github.com/top",
        contributions: 50,
        repos: ["VeTwo-dev/Alpha"],
        projectCount: 1,
      },
      {
        key: "id:3",
        id: 3,
        login: "mid",
        logins: ["mid"],
        avatarUrl: null,
        htmlUrl: "https://github.com/mid",
        contributions: 20,
        repos: ["VeTwo-dev/Alpha"],
        projectCount: 1,
      },
    ];
    const md = renderContributorsSection(entries, {
      ...options,
      maxContributors: 1,
    });
    assert.ok(md.includes(">top</a>"));
    assert.ok(!md.includes(">mid</a>"), "must truncate after sorting");
    assert.ok(
      md.includes("and 2 more contributors."),
      "remainder must be reported",
    );
  });

  it("omits commit counts when they are unknown but still shows project counts", () => {
    const entries = [
      {
        key: "id:1",
        id: 1,
        login: "neo",
        logins: ["neo"],
        avatarUrl: "https://avatars.githubusercontent.com/u/10?v=4",
        htmlUrl: "https://github.com/neo",
        contributions: null,
        repos: ["VeTwo-dev/Alpha", "VeTwo-dev/Beta"],
        projectCount: 2,
      },
    ];
    const md = renderContributorsSection(entries, options);
    assert.ok(!md.includes("commits"), "unknown totals must not be invented");
    assert.ok(md.includes("2 repos"));
  });

  it("is byte-identical for identical entries and options", () => {
    const entries = aggregateContributors([
      { repo: "VeTwo-dev/Alpha", contributors: [CONTRIBUTOR_FIXTURES.neo] },
    ]);
    assert.equal(
      renderContributorsSection(entries, options),
      renderContributorsSection(entries, options),
    );
  });

  it("resolves defaults from config/projects.json", () => {
    const resolved = contributorOptions();
    assert.equal(resolved.maxContributors, 36);
    assert.equal(
      resolved.includeBots !== true,
      true,
      "bot exclusion is the documented default",
    );
  });
});

describe("collectContributors", () => {
  const repos = [repoFixture("Alpha"), repoFixture("Beta")];

  it("discovers contributors across multiple repositories", async () => {
    const fetchRepoContributorsImpl = async (repoName) => {
      if (repoName === "Alpha")
        return { ok: true, contributors: [CONTRIBUTOR_FIXTURES.neo] };
      return { ok: true, contributors: [CONTRIBUTOR_FIXTURES.trinity] };
    };
    const { entries, eligible, warnings } = await collectContributors(
      repos,
      "",
      { fetchRepoContributorsImpl },
    );
    assert.equal(eligible.length, 2);
    assert.equal(warnings.length, 0);
    assert.equal(entries.length, 2);
    assert.deepEqual(entries.map((e) => e.login).sort(), ["neo", "trinity"]);
  });

  it("skips an unavailable repository and continues with the rest", async () => {
    const fetchRepoContributorsImpl = async (repoName) =>
      repoName === "Alpha"
        ? {
            ok: false,
            httpStatus: 404,
            reason:
              "contributors endpoint unavailable (404) for VeTwo-dev/Alpha",
          }
        : { ok: true, contributors: [CONTRIBUTOR_FIXTURES.neo] };
    const { entries, warnings } = await collectContributors(repos, "", {
      fetchRepoContributorsImpl,
    });
    assert.equal(entries.length, 1);
    assert.equal(warnings.length, 1);
    assert.ok(warnings[0].includes("404"));
  });

  it("propagates fatal authentication and rate-limit errors", async () => {
    for (const result of [
      {
        ok: false,
        fatal: true,
        httpStatus: 401,
        reason: "GitHub API authentication failed (401)",
      },
      {
        ok: false,
        fatal: true,
        httpStatus: 403,
        reason: "GitHub API rate limited",
      },
    ]) {
      const fetchRepoContributorsImpl = async () => result;
      await assert.rejects(
        () =>
          collectContributors(repos, FAKE_TOKEN, { fetchRepoContributorsImpl }),
        /401|rate limited/,
        "fatal errors must abort the run",
      );
    }
  });

  it("redacts the token when a repository request throws", async () => {
    const fetchRepoContributorsImpl = async (repoName) => {
      if (repoName === "Alpha")
        throw new Error(`request failed: ${FAKE_TOKEN}`);
      return { ok: true, contributors: [CONTRIBUTOR_FIXTURES.neo] };
    };
    const { entries, warnings } = await collectContributors(repos, FAKE_TOKEN, {
      fetchRepoContributorsImpl,
    });
    assert.equal(
      entries.length,
      1,
      "remaining repositories still produce a roster",
    );
    assert.equal(warnings.length, 1);
    assert.ok(
      !warnings[0].includes(FAKE_TOKEN),
      "token must be redacted from warnings",
    );
    assert.ok(warnings[0].includes("[REDACTED]"));
  });

  it("fails instead of writing an empty roster when every repository is unavailable", async () => {
    const fetchRepoContributorsImpl = async (repoName) => ({
      ok: false,
      httpStatus: 404,
      reason: `contributors endpoint unavailable (404) for VeTwo-dev/${repoName}`,
    });
    await assert.rejects(
      () => collectContributors(repos, "", { fetchRepoContributorsImpl }),
      /unavailable for every/,
    );
  });

  it("returns an empty roster when there are no eligible repositories", async () => {
    const fetchRepoContributorsImpl = async () => {
      throw new Error("must not be called");
    };
    const { entries, eligible, warnings } = await collectContributors(
      [repoFixture("VeTwo-dev")],
      "",
      { username: "VeTwo-dev", fetchRepoContributorsImpl },
    );
    assert.deepEqual(entries, []);
    assert.deepEqual(eligible, []);
    assert.deepEqual(warnings, []);
  });
});

describe("pipeline registration", () => {
  it("registers the generator explicitly in the CI allowlist", () => {
    assert.ok(
      PIPELINE_SCRIPTS.includes("generate-contributors.mjs"),
      "must be allowlisted",
    );
    assert.ok(
      !PIPELINE_SCRIPTS.includes("generate-project-thumbnails.mjs"),
      "retired generator stays retired",
    );
  });

  it("keeps existing generators and the README builder in the pipeline", () => {
    for (const script of [
      "generate-project-cards.mjs",
      "generate-snake.mjs",
      "generate-starred-projects.mjs",
      "build-readme.mjs",
    ]) {
      assert.ok(
        existsSync(path.join(ROOT, "scripts", script)),
        `${script} must still exist`,
      );
    }
  });

  it("is pinned in config/sequence.json after the featured sections and before the footer", () => {
    const sequence = JSON.parse(
      readFileSync(path.join(ROOT, "config", "sequence.json"), "utf8"),
    ).sequence;
    const byPosition = [...sequence]
      .sort((a, b) => a.position - b.position)
      .map((e) => e.file);
    const entry = sequence.find((e) => e.file === "contributors-generated.md");
    assert.ok(entry, "sequence must contain the generated section");
    assert.equal(entry.generated, true);
    assert.equal(entry.generator, "scripts/generate-contributors.mjs");
    assert.ok(
      byPosition.indexOf("contributors-generated.md") >
        byPosition.indexOf("06-starred-projects-generated.md"),
    );
    assert.ok(
      byPosition.indexOf("contributors-generated.md") <
        byPosition.indexOf("07-footer.md"),
    );
    const readme = JSON.parse(
      readFileSync(path.join(ROOT, "config", "readme.json"), "utf8"),
    );
    assert.deepEqual(
      byPosition,
      readme.order,
      "fallback order must match the sequence",
    );
  });

  it("exposes a regeneration command and documents its ownership", () => {
    const pkg = JSON.parse(
      readFileSync(path.join(ROOT, "package.json"), "utf8"),
    );
    assert.equal(
      pkg.scripts.contributors,
      "node scripts/generate-contributors.mjs",
    );
    const ownership = readFileSync(path.join(ROOT, "OWNERSHIP.md"), "utf8");
    assert.ok(
      ownership.includes("profile/contributors-generated.md"),
      "OWNERSHIP.md must list the output",
    );
    assert.ok(
      ownership.includes("scripts/generate-contributors.mjs"),
      "OWNERSHIP.md must name the writer",
    );
  });
});

// End-to-end against a local fixture server: proves the generator uses the
// shared GITHUB_TOKEN mechanism (Bearer header), writes the documented
// output path, redacts the token from logs, and never touches the network.
describe("generate-contributors.mjs against a fixture server", () => {
  const servers = [];

  after(async () => {
    while (servers.length) {
      const server = servers.pop();
      await new Promise((resolve) => server.close(resolve));
    }
  });

  async function startServer(routes) {
    const seen = [];
    const server = http.createServer((req, res) => {
      const url = new URL(req.url, "http://127.0.0.1");
      const key = `${req.method} ${url.pathname}`;
      seen.push({ key, auth: req.headers.authorization || null });
      const route = routes.find((r) => key === `${r.method} ${r.path}`);
      if (!route) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end("[]");
        return;
      }
      const out = route.handle(url, seen) || { status: 200, body: [] };
      res.writeHead(out.status || 200, {
        "Content-Type": "application/json",
        ...(out.headers || {}),
      });
      res.end(
        typeof out.body === "string" ? out.body : JSON.stringify(out.body),
      );
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    servers.push(server);
    return { port: server.address().port, seen };
  }

  function repoRoutes() {
    return [
      {
        method: "GET",
        path: `/users/${"VeTwo-dev"}/repos`,
        handle: () => ({
          body: [
            repoFixture("Alpha", { id: 1, full_name: "VeTwo-dev/Alpha" }),
            repoFixture("Beta", { id: 2, full_name: "VeTwo-dev/Beta" }),
            repoFixture("VeTwo-dev", {
              id: 3,
              full_name: "VeTwo-dev/VeTwo-dev",
            }),
            repoFixture("Forked", {
              id: 4,
              full_name: "VeTwo-dev/Forked",
              fork: true,
            }),
          ],
        }),
      },
      {
        method: "GET",
        path: "/repos/VeTwo-dev/Alpha/contributors",
        handle: () => ({
          body: [CONTRIBUTOR_FIXTURES.neo, CONTRIBUTOR_FIXTURES.trinity],
        }),
      },
      {
        method: "GET",
        path: "/repos/VeTwo-dev/Beta/contributors",
        handle: () => ({
          body: [CONTRIBUTOR_FIXTURES.morpheus, CONTRIBUTOR_FIXTURES.neo],
        }),
      },
    ];
  }

  // Runs the generator asynchronously: the fixture server lives in this
  // process's event loop, so a blocking spawn here would deadlock it.
  function runGenerator(extraEnv) {
    return new Promise((resolve) => {
      execFile(
        process.execPath,
        ["scripts/generate-contributors.mjs"],
        {
          cwd: ROOT,
          env: {
            ...process.env,
            GITHUB_TOKEN: FAKE_TOKEN,
            GITHUB_API_BASE: "",
            ...extraEnv,
          },
          timeout: 60000,
          maxBuffer: 16 * 1024 * 1024,
        },
        (err, stdout, stderr) => {
          const code =
            err && typeof err.code === "number" ? err.code : err ? 1 : 0;
          resolve({ status: code, stdout: stdout || "", stderr: stderr || "" });
        },
      );
    });
  }

  it("writes the contributor section and never leaks the token", async () => {
    const { port, seen } = await startServer(repoRoutes());
    const outFile = path.join(ROOT, "profile", "contributors-generated.md");
    const original = existsSync(outFile) ? readFileSync(outFile, "utf8") : null;
    await withLock("contributors", async () => {
      const run = await runGenerator({
        GITHUB_API_URL: `http://127.0.0.1:${port}`,
      });
      const combined = `${run.stdout}\n${run.stderr}`;
      try {
        assert.equal(run.status, 0, `generator must succeed: ${combined}`);
        assert.ok(!combined.includes(FAKE_TOKEN), "token must never be logged");
        const sent = seen.find((r) => r.key === "GET /users/VeTwo-dev/repos");
        assert.equal(
          sent.auth,
          `Bearer ${FAKE_TOKEN}`,
          "repos call must use the shared token mechanism",
        );
        const contributorsCall = seen.find(
          (r) => r.key === "GET /repos/VeTwo-dev/Alpha/contributors",
        );
        assert.ok(contributorsCall, "contributors endpoint must be called");
        assert.equal(
          contributorsCall.auth,
          `Bearer ${FAKE_TOKEN}`,
          "contributors call must be authenticated",
        );

        const written = readFileSync(outFile, "utf8");
        assert.ok(
          written.includes("## Contributors"),
          "section must be written",
        );
        assert.ok(
          written.includes(">neo</a>"),
          "aggregated contributor must appear once",
        );
        assert.equal(
          written.split(">neo</a>").length - 1,
          1,
          "no duplicate cells for one identity",
        );
        assert.equal(
          written.split("14 commits").length - 1,
          1,
          "aggregated count rendered once",
        );
        assert.ok(!written.includes("Forked"), "forked repos stay excluded");
        assert.ok(
          !written.includes(FAKE_TOKEN),
          "token must never reach the generated file",
        );
      } finally {
        if (original == null) {
          await rm(path.join(ROOT, "profile", "contributors-generated.md"), {
            force: true,
          });
        } else {
          writeFileSync(outFile, original, "utf8");
        }
      }
    });
  });

  it("exits non-zero on a rate-limited token without writing output", async () => {
    const { port } = await startServer([
      {
        method: "GET",
        path: `/users/${"VeTwo-dev"}/repos`,
        handle: () => ({ body: [repoFixture("Alpha", { id: 1 })] }),
      },
      {
        method: "GET",
        path: "/repos/VeTwo-dev/Alpha/contributors",
        handle: () => ({
          status: 403,
          body: `rate limit exceeded ${FAKE_TOKEN}`,
          headers: { "x-ratelimit-remaining": "0" },
        }),
      },
    ]);
    const outFile = path.join(ROOT, "profile", "contributors-generated.md");
    const original = existsSync(outFile) ? readFileSync(outFile, "utf8") : null;
    await withLock("contributors", async () => {
      const run = await runGenerator({
        GITHUB_API_URL: `http://127.0.0.1:${port}`,
      });
      const combined = `${run.stdout}\n${run.stderr}`;
      try {
        assert.notEqual(run.status, 0, "must fail on a rate limit");
        assert.ok(
          !combined.includes(FAKE_TOKEN),
          "token must be redacted in the error",
        );
        assert.ok(
          /rate limit|rate-limited|403/i.test(combined),
          "failure reason must be reported",
        );
        const after = existsSync(outFile)
          ? readFileSync(outFile, "utf8")
          : null;
        assert.equal(after, original, "a failed run must change nothing");
      } finally {
        if (original != null) writeFileSync(outFile, original, "utf8");
      }
    });
  });
});
