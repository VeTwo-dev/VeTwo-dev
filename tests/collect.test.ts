import { afterEach, describe, expect, it, vi } from "vitest";
import { collectProfileData } from "../profile/generator/collect.js";
import { GitHubApiError, fetchUser, fetchRepos } from "../profile/data/github.js";

function jsonResponse(body: unknown, init: { status?: number } = {}) {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { "Content-Type": "application/json" },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("GitHub API failure handling", () => {
  it("throws a typed GitHubApiError (rather than a generic crash) on a non-2xx response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ message: "Not Found" }, { status: 404 })),
    );
    await expect(fetchUser("nonexistent-user-xyz")).rejects.toBeInstanceOf(GitHubApiError);
  });

  it("propagates a rate-limit failure clearly instead of returning empty/garbage data", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ message: "API rate limit exceeded" }, { status: 403 })),
    );
    await expect(fetchRepos("VeTwo-dev")).rejects.toThrow(/rate limit/i);
  });

  it("collectProfileData rejects (does not silently produce a half-built dataset) when the user fetch fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ message: "server error" }, { status: 500 })),
    );
    await expect(collectProfileData({})).rejects.toThrow();
  });
});

describe("empty GitHub data", () => {
  it("handles a user with zero public repositories without throwing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string) => {
        if (url.includes("/repos?")) return Promise.resolve(jsonResponse([]));
        return Promise.resolve(
          jsonResponse({
            login: "VeTwo-dev",
            name: "VeTwo.Dev",
            bio: null,
            location: null,
            public_repos: 0,
            followers: 0,
            following: 0,
            html_url: "https://github.com/VeTwo-dev",
          }),
        );
      }),
    );
    const dataset = await collectProfileData({});
    expect(dataset.repos).toEqual([]);
    expect(dataset.user.public_repos).toBe(0);
  });
});
