import { describe, expect, it } from "vitest";
import { aggregateLanguages, categorizeEcosystem, scoreRepo, selectFeatured } from "../profile/generator/select.js";
import { mockRepos } from "./fixtures/repos.mock.js";
import type { NormalizedRepo } from "../profile/data/github.js";

describe("selectFeatured", () => {
  it("selects configured repos in the given order when all exist", () => {
    const result = selectFeatured(mockRepos, {
      featuredRepositories: ["units", "nutrition-units", "Feed-Formulation"],
      maxFeatured: 3,
    });
    expect(result.map((r) => r.name)).toEqual(["units", "nutrition-units", "Feed-Formulation"]);
  });

  it("gracefully skips a configured repository that no longer exists", () => {
    const result = selectFeatured(mockRepos, {
      featuredRepositories: ["units", "this-repo-was-deleted", "nutrition-units"],
      maxFeatured: 2,
    });
    expect(result.map((r) => r.name)).toEqual(["units", "nutrition-units"]);
  });

  it("fills remaining slots from fallback ranking, excluding forks and archived repos", () => {
    const result = selectFeatured(mockRepos, {
      featuredRepositories: ["units"],
      maxFeatured: 3,
    });
    expect(result).toHaveLength(3);
    expect(result[0]?.name).toBe("units");
    expect(result.some((r) => r.isFork)).toBe(false);
    expect(result.some((r) => r.isArchived)).toBe(false);
  });

  it("never returns duplicate repositories even if a fallback candidate overlaps the curated list", () => {
    const result = selectFeatured(mockRepos, {
      featuredRepositories: ["units", "units", "nutrition-units"],
      maxFeatured: 5,
    });
    const names = result.map((r) => r.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("respects excludeFromAuto even for explicitly configured repos", () => {
    const result = selectFeatured(
      mockRepos,
      { featuredRepositories: ["units", "nutrition-units"], maxFeatured: 5 },
      ["units"],
    );
    expect(result.map((r) => r.name)).not.toContain("units");
  });

  it("returns an empty array when given no repos", () => {
    const result = selectFeatured([], { featuredRepositories: ["units"], maxFeatured: 3 });
    expect(result).toEqual([]);
  });
});

describe("scoreRepo", () => {
  it("scores forks and archived repos as ineligible", () => {
    const fork = mockRepos.find((r) => r.name === "an-old-fork")!;
    const archived = mockRepos.find((r) => r.name === "archived-experiment")!;
    expect(scoreRepo(fork)).toBe(-Infinity);
    expect(scoreRepo(archived)).toBe(-Infinity);
  });

  it("scores a well-documented, starred repo higher than a near-empty scaffold", () => {
    const rich = mockRepos.find((r) => r.name === "Repo-Fetch")!;
    const empty = mockRepos.find((r) => r.name === "empty-scaffold")!;
    expect(scoreRepo(rich)).toBeGreaterThan(scoreRepo(empty));
  });
});

describe("categorizeEcosystem", () => {
  const categories = {
    "Core Engine": ["units"],
    "Domain Layer": ["nutrition-units"],
  };

  it("groups repos into their configured categories", () => {
    const result = categorizeEcosystem(mockRepos, categories);
    expect(result.get("Core Engine")?.map((r) => r.name)).toEqual(["units"]);
    expect(result.get("Domain Layer")?.map((r) => r.name)).toEqual(["nutrition-units"]);
  });

  it("omits a category entirely if its configured repo no longer exists", () => {
    const result = categorizeEcosystem(mockRepos, { Ghost: ["repo-that-doesnt-exist"] });
    expect(result.has("Ghost")).toBe(false);
  });

  it("does not place the same repo in two categories", () => {
    const result = categorizeEcosystem(mockRepos, {
      A: ["units"],
      B: ["units"],
    });
    const total = [...result.values()].flat().filter((r) => r.name === "units").length;
    expect(total).toBe(1);
  });

  it("drops uncategorized repos with no description and a trivial README instead of forcing an 'Other' entry", () => {
    const result = categorizeEcosystem([mockRepos.find((r) => r.name === "empty-scaffold")!], {});
    expect(result.has("Other")).toBe(false);
  });
});

describe("aggregateLanguages", () => {
  it("produces percentages that sum to ~100", () => {
    const repos: NormalizedRepo[] = [
      { ...mockRepos[0]!, languageBytes: { TypeScript: 800, CSS: 200 } },
      { ...mockRepos[1]!, languageBytes: { TypeScript: 1000 } },
    ];
    const result = aggregateLanguages(repos);
    const total = result.reduce((sum, r) => sum + r.percent, 0);
    expect(total).toBeCloseTo(100, 5);
    expect(result[0]?.language).toBe("TypeScript");
  });

  it("excludes forked repositories from language aggregation", () => {
    const fork = mockRepos.find((r) => r.name === "an-old-fork")!;
    const result = aggregateLanguages([{ ...fork, languageBytes: { Rust: 99999 } }]);
    expect(result.find((r) => r.language === "Rust")).toBeUndefined();
  });

  it("returns an empty array when there is no language data at all", () => {
    const noLang = { ...mockRepos[0]!, language: null, languageBytes: undefined };
    expect(aggregateLanguages([noLang])).toEqual([]);
  });
});
