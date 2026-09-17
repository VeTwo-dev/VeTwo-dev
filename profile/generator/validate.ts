import type { NormalizedRepo } from "../data/github.js";

export class ValidationError extends Error {}

/** Sanity-checks raw repo data before it's used anywhere downstream. */
export function validateRepo(repo: NormalizedRepo): void {
  if (!repo.name || typeof repo.name !== "string") {
    throw new ValidationError(`Repo missing a valid name: ${JSON.stringify(repo)}`);
  }
  if (!repo.url || !repo.url.startsWith("https://github.com/")) {
    throw new ValidationError(`Repo "${repo.name}" has an invalid URL: ${repo.url}`);
  }
  if (repo.stars < 0 || repo.forks < 0) {
    throw new ValidationError(`Repo "${repo.name}" has negative stars/forks — data looks corrupt.`);
  }
  if (Number.isNaN(new Date(repo.pushedAt).getTime())) {
    throw new ValidationError(`Repo "${repo.name}" has an unparseable pushed_at date.`);
  }
}

export function validateRepos(repos: readonly NormalizedRepo[]): void {
  for (const repo of repos) validateRepo(repo);
  const names = new Set<string>();
  for (const repo of repos) {
    if (names.has(repo.name)) {
      throw new ValidationError(`Duplicate repository detected in dataset: "${repo.name}".`);
    }
    names.add(repo.name);
  }
}

/**
 * Guards against a generated section silently containing placeholder or
 * corrupted output (e.g. from a template bug) before it's ever written to
 * disk.
 */
export function validateGeneratedMarkdown(name: string, markdown: string): void {
  if (!markdown || markdown.trim().length === 0) {
    throw new ValidationError(`Generated section "${name}" is empty.`);
  }
  const forbidden = ["undefined", "NaN", "[object Object]", "TODO_PLACEHOLDER"];
  for (const token of forbidden) {
    if (markdown.includes(token)) {
      throw new ValidationError(`Generated section "${name}" contains a corrupted token: "${token}".`);
    }
  }
}
