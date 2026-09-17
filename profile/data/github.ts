/**
 * GitHub API client.
 *
 * Thin, dependency-free wrapper around the REST API using the platform
 * `fetch`. This module ONLY talks to GitHub and normalizes the shape of
 * the response — it makes no decisions about selection, ranking, or
 * rendering (see `profile/generator/*` for that).
 */

const API_ROOT = "https://api.github.com";

export interface GitHubUser {
  readonly login: string;
  readonly name: string | null;
  readonly bio: string | null;
  readonly location: string | null;
  readonly public_repos: number;
  readonly followers: number;
  readonly following: number;
  readonly html_url: string;
}

/** Raw shape (subset) of a GitHub repo as returned by the REST API. */
export interface RawRepo {
  readonly id: number;
  readonly name: string;
  readonly full_name: string;
  readonly description: string | null;
  readonly html_url: string;
  readonly fork: boolean;
  readonly archived: boolean;
  readonly language: string | null;
  readonly stargazers_count: number;
  readonly forks_count: number;
  readonly watchers_count: number;
  readonly open_issues_count: number;
  readonly topics?: readonly string[];
  readonly created_at: string;
  readonly updated_at: string;
  readonly pushed_at: string;
  readonly default_branch: string;
  readonly homepage: string | null;
  readonly visibility?: string;
}

/** Normalized repo shape used by the rest of the generator. */
export interface NormalizedRepo {
  readonly name: string;
  readonly fullName: string;
  readonly description: string | null;
  readonly url: string;
  readonly isFork: boolean;
  readonly isArchived: boolean;
  readonly language: string | null;
  readonly stars: number;
  readonly forks: number;
  readonly openIssues: number;
  readonly topics: readonly string[];
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly pushedAt: string;
  readonly defaultBranch: string;
  readonly homepage: string | null;
  /** Populated only for repos the generator inspects in depth (featured/ecosystem). */
  readonly languageBytes?: Readonly<Record<string, number>>;
  /** Length in characters of the repo's README, if fetched. `null` = not fetched, `0` = fetched but missing. */
  readonly readmeLength?: number | null;
}

export class GitHubApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "GitHubApiError";
  }
}

function authHeaders(token?: string): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "vetwo-profile-generator",
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

async function githubGet<T>(path: string, token?: string): Promise<T> {
  const res = await fetch(`${API_ROOT}${path}`, { headers: authHeaders(token) });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new GitHubApiError(`GitHub API ${path} failed: ${res.status} ${body}`.trim(), res.status);
  }
  return (await res.json()) as T;
}

export async function fetchUser(username: string, token?: string): Promise<GitHubUser> {
  return githubGet<GitHubUser>(`/users/${username}`, token);
}

export async function fetchRepos(username: string, token?: string): Promise<RawRepo[]> {
  const perPage = 100;
  const all: RawRepo[] = [];
  let page = 1;
  // Defensive cap so a misbehaving API can never spin this loop forever.
  while (page <= 10) {
    const batch = await githubGet<RawRepo[]>(
      `/users/${username}/repos?per_page=${perPage}&page=${page}&type=owner&sort=updated`,
      token,
    );
    all.push(...batch);
    if (batch.length < perPage) break;
    page += 1;
  }
  return all;
}

export function normalizeRepo(raw: RawRepo): NormalizedRepo {
  return {
    name: raw.name,
    fullName: raw.full_name,
    description: raw.description,
    url: raw.html_url,
    isFork: raw.fork,
    isArchived: raw.archived,
    language: raw.language,
    stars: raw.stargazers_count,
    forks: raw.forks_count,
    openIssues: raw.open_issues_count,
    topics: raw.topics ?? [],
    createdAt: raw.created_at,
    updatedAt: raw.updated_at,
    pushedAt: raw.pushed_at,
    defaultBranch: raw.default_branch,
    homepage: raw.homepage,
  };
}

/** Byte-count-per-language breakdown for a single repo. */
export async function fetchLanguages(
  owner: string,
  repo: string,
  token?: string,
): Promise<Record<string, number>> {
  return githubGet<Record<string, number>>(`/repos/${owner}/${repo}/languages`, token);
}

/**
 * Fetches the length (in characters) of a repo's default README, or `0` if
 * the repo has none. Used only as a heuristic signal for fallback repo
 * ranking — never displayed as a fabricated metric.
 */
export async function fetchReadmeLength(
  owner: string,
  repo: string,
  token?: string,
): Promise<number> {
  try {
    const data = await githubGet<{ content: string; encoding: string }>(
      `/repos/${owner}/${repo}/readme`,
      token,
    );
    if (data.encoding === "base64") {
      return Buffer.from(data.content, "base64").toString("utf-8").length;
    }
    return data.content.length;
  } catch (err) {
    if (err instanceof GitHubApiError && err.status === 404) return 0;
    throw err;
  }
}
