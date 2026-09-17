import { describe, expect, it } from "vitest";
import { renderActivity, renderFeatured, renderLanguages, renderStats } from "../profile/generator/render.js";
import { validateGeneratedMarkdown, ValidationError, validateRepos } from "../profile/generator/validate.js";
import { mockRepos } from "./fixtures/repos.mock.js";
import type { GitHubUser } from "../profile/data/github.js";

const mockUser: GitHubUser = {
  login: "VeTwo-dev",
  name: "VeTwo.Dev",
  bio: "Bridging veterinary medicine and software engineering.",
  location: "Egypt",
  public_repos: 13,
  followers: 3,
  following: 12,
  html_url: "https://github.com/VeTwo-dev",
};

describe("renderStats", () => {
  it("only includes real, computed numbers — no fabricated metrics", () => {
    const md = renderStats(mockUser, mockRepos);
    expect(md).toContain("13");
    expect(md).toContain("Followers");
    expect(md).not.toContain("undefined");
  });

  it("sums stars only across non-fork repositories", () => {
    const md = renderStats(mockUser, mockRepos);
    // an-old-fork has 50 stars and must NOT be counted
    const starsLine = md.split("\n").find((l) => l.includes("Total stars"));
    expect(starsLine).not.toContain("50");
  });
});

describe("renderLanguages", () => {
  it("never renders a percentage figure with no underlying data", () => {
    const md = renderLanguages([]);
    expect(md).not.toMatch(/%/);
  });

  it("renders a percentage breakdown when language data exists", () => {
    const repos = [{ ...mockRepos[0]!, languageBytes: { TypeScript: 100 } }];
    const md = renderLanguages(repos);
    expect(md).toContain("TypeScript");
    expect(md).toContain("%");
  });
});

describe("renderFeatured", () => {
  it("shows 'no description set' rather than inventing one", () => {
    const [repo] = mockRepos;
    const md = renderFeatured([{ ...repo!, description: null }]);
    expect(md.toLowerCase()).toContain("no description set");
  });

  it("omits star/fork counts entirely when they are zero, rather than showing clutter", () => {
    const repo = { ...mockRepos[0]!, stars: 0, forks: 0 };
    const md = renderFeatured([repo]);
    expect(md).not.toContain("⭐ 0");
    expect(md).not.toContain("🍴 0");
  });

  it("handles an empty list without throwing", () => {
    expect(() => renderFeatured([])).not.toThrow();
  });
});

describe("renderActivity", () => {
  it("excludes forks and archived repos from recent activity", () => {
    const md = renderActivity(mockRepos);
    expect(md).not.toContain("an-old-fork");
    expect(md).not.toContain("archived-experiment");
  });

  it("uses factual 'recently updated' wording, not invented claims", () => {
    const md = renderActivity(mockRepos);
    expect(md).toContain("recently updated");
    expect(md.toLowerCase()).not.toContain("currently building");
  });
});

describe("validateGeneratedMarkdown", () => {
  it("rejects empty generated sections", () => {
    expect(() => validateGeneratedMarkdown("STATS", "")).toThrow(ValidationError);
  });

  it("rejects sections containing corrupted template tokens", () => {
    expect(() => validateGeneratedMarkdown("STATS", "Total stars: undefined")).toThrow(ValidationError);
  });

  it("accepts well-formed markdown", () => {
    expect(() => validateGeneratedMarkdown("STATS", "| Metric | Value |\n| --- | --- |")).not.toThrow();
  });
});

describe("validateRepos", () => {
  it("rejects a repo with a malformed URL", () => {
    const bad = [{ ...mockRepos[0]!, url: "not-a-url" }];
    expect(() => validateRepos(bad)).toThrow(ValidationError);
  });

  it("rejects duplicate repository names in one dataset", () => {
    const dup = [mockRepos[0]!, mockRepos[0]!];
    expect(() => validateRepos(dup)).toThrow(ValidationError);
  });

  it("accepts the full real mock dataset", () => {
    expect(() => validateRepos(mockRepos)).not.toThrow();
  });
});
