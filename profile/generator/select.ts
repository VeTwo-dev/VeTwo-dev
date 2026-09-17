import type { NormalizedRepo } from "../data/github.js";

export interface SelectionOptions {
  readonly featuredRepositories: readonly string[];
  readonly maxFeatured: number;
}

/**
 * Score used ONLY to break ties for the fallback slots (i.e. when the
 * curated `featuredRepositories` list doesn't fill `maxFeatured`). This is
 * never displayed to a visitor — it exists purely to pick a sensible
 * default from real, verifiable signals.
 */
export function scoreRepo(repo: NormalizedRepo): number {
  if (repo.isFork || repo.isArchived) return -Infinity;
  let score = 0;
  score += repo.stars * 10;
  score += repo.forks * 4;
  if (repo.description && repo.description.trim().length > 0) score += 5;
  if (repo.topics.length > 0) score += 3;
  if (typeof repo.readmeLength === "number" && repo.readmeLength > 500) score += 6;
  // Recency: more recently pushed repos rank slightly higher, capped so it
  // never dominates real signals like stars/readme quality.
  const daysSincePush = (Date.now() - new Date(repo.pushedAt).getTime()) / 86_400_000;
  score += Math.max(0, 5 - Math.min(daysSincePush / 14, 5));
  return score;
}

/**
 * Builds the final featured-repo list:
 *  1. Start with the curated order, dropping any name that no longer
 *     exists on GitHub (renamed / deleted / made private) — silently, no
 *     error, since this is expected maintenance drift.
 *  2. If there is remaining capacity, fill it with the highest-scoring
 *     eligible repos not already selected, excluding forks/archived repos
 *     and anything in `excludeFromAuto`.
 * Never returns duplicates.
 */
export function selectFeatured(
  repos: readonly NormalizedRepo[],
  options: SelectionOptions,
  excludeFromAuto: readonly string[] = [],
): NormalizedRepo[] {
  const byName = new Map(repos.map((r) => [r.name, r] as const));
  const excluded = new Set(excludeFromAuto);
  const selected: NormalizedRepo[] = [];
  const seen = new Set<string>();

  for (const name of options.featuredRepositories) {
    const repo = byName.get(name);
    if (!repo || seen.has(repo.name) || excluded.has(repo.name)) continue;
    selected.push(repo);
    seen.add(repo.name);
    if (selected.length >= options.maxFeatured) return selected;
  }

  const remaining = repos
    .filter((r) => !seen.has(r.name) && !excluded.has(r.name))
    .filter((r) => !r.isFork && !r.isArchived)
    .map((r) => ({ repo: r, score: scoreRepo(r) }))
    .filter((entry) => entry.score > -Infinity)
    .sort((a, b) => b.score - a.score);

  for (const { repo } of remaining) {
    if (selected.length >= options.maxFeatured) break;
    selected.push(repo);
    seen.add(repo.name);
  }

  return selected;
}

/**
 * Groups repos into the manually-configured ecosystem categories.
 * Repos not mentioned in `categories` and not explicitly excluded fall
 * into an "Other" bucket ONLY if they carry a real description or a
 * substantial README (`readmeLength > 200`); otherwise they are dropped
 * rather than shown as an empty, unhelpful entry.
 */
export function categorizeEcosystem(
  repos: readonly NormalizedRepo[],
  categories: Readonly<Record<string, readonly string[]>>,
  excludeFromAuto: readonly string[] = [],
): Map<string, NormalizedRepo[]> {
  const byName = new Map(repos.map((r) => [r.name, r] as const));
  const excluded = new Set(excludeFromAuto);
  const result = new Map<string, NormalizedRepo[]>();
  const placed = new Set<string>();

  for (const [category, names] of Object.entries(categories)) {
    const items: NormalizedRepo[] = [];
    for (const name of names) {
      const repo = byName.get(name);
      if (!repo || excluded.has(repo.name) || placed.has(repo.name)) continue;
      items.push(repo);
      placed.add(repo.name);
    }
    if (items.length > 0) result.set(category, items);
  }

  const other = repos.filter((r) => {
    if (placed.has(r.name) || excluded.has(r.name) || r.isFork || r.isArchived) return false;
    const hasDescription = Boolean(r.description && r.description.trim().length > 0);
    const hasReadme = typeof r.readmeLength === "number" && r.readmeLength > 200;
    return hasDescription || hasReadme;
  });
  if (other.length > 0) result.set("Other", other);

  return result;
}

/** Aggregates byte-level language stats across a set of repos into percentages. */
export function aggregateLanguages(
  repos: readonly NormalizedRepo[],
): Array<{ language: string; bytes: number; percent: number }> {
  const totals = new Map<string, number>();
  for (const repo of repos) {
    if (repo.isFork) continue;
    const breakdown = repo.languageBytes;
    if (breakdown) {
      for (const [lang, bytes] of Object.entries(breakdown)) {
        totals.set(lang, (totals.get(lang) ?? 0) + bytes);
      }
    } else if (repo.language) {
      // Fallback when per-repo byte breakdown wasn't fetched: count the
      // repo's single primary language as a nominal 1 unit so it still
      // shows up, without pretending to know exact byte counts.
      totals.set(repo.language, (totals.get(repo.language) ?? 0) + 1);
    }
  }
  const grandTotal = [...totals.values()].reduce((a, b) => a + b, 0);
  if (grandTotal === 0) return [];
  return [...totals.entries()]
    .map(([language, bytes]) => ({ language, bytes, percent: (bytes / grandTotal) * 100 }))
    .sort((a, b) => b.bytes - a.bytes);
}
