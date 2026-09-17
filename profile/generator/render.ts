import type { GitHubUser, NormalizedRepo } from "../data/github.js";
import { aggregateLanguages } from "./select.js";

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { year: "numeric", month: "short" });
}

function relativeRecency(iso: string): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}

/** GitHub Snapshot — real, verifiable account-level numbers only. */
export function renderStats(user: GitHubUser, repos: readonly NormalizedRepo[]): string {
  const own = repos.filter((r) => !r.isFork);
  const totalStars = own.reduce((sum, r) => sum + r.stars, 0);
  const totalForks = own.reduce((sum, r) => sum + r.forks, 0);

  const rows = [
    ["Public repositories", String(user.public_repos)],
    ["Followers", String(user.followers)],
    ["Total stars", String(totalStars)],
    ["Total forks", String(totalForks)],
  ];

  const header = "| Metric | Value |\n| --- | --- |";
  const body = rows.map(([label, value]) => `| ${label} | ${value} |`).join("\n");
  return `${header}\n${body}\n\n<sub>Pulled directly from the GitHub API for [@${user.login}](${user.html_url}).</sub>`;
}

/** Technology Landscape — aggregated from real repository language bytes. */
export function renderLanguages(repos: readonly NormalizedRepo[]): string {
  const langs = aggregateLanguages(repos).slice(0, 8);
  if (langs.length === 0) {
    return "<sub>No language data available yet.</sub>";
  }
  const lines = langs.map(({ language, percent }) => {
    const barLength = Math.max(1, Math.round(percent / 5));
    const bar = "█".repeat(barLength) + "░".repeat(Math.max(0, 20 - barLength));
    return `\`${language.padEnd(12)}\` ${bar} ${percent.toFixed(1)}%`;
  });
  return (
    lines.join("\n\n") +
    "\n\n<sub>Aggregated from language bytes across non-fork public repositories — reflects repository usage, not the complete list of languages I know.</sub>"
  );
}

/** Featured Projects — real per-repo metadata only, no fabricated fields. */
export function renderFeatured(repos: readonly NormalizedRepo[]): string {
  if (repos.length === 0) return "<sub>No featured repositories are currently available.</sub>";

  const cards = repos.map((repo) => {
    const desc = repo.description?.trim() || "_No description set on GitHub yet._";
    const meta: string[] = [];
    if (repo.language) meta.push(`\`${repo.language}\``);
    if (repo.stars > 0) meta.push(`⭐ ${repo.stars}`);
    if (repo.forks > 0) meta.push(`🍴 ${repo.forks}`);
    meta.push(`updated ${relativeRecency(repo.pushedAt)}`);

    return [
      `#### [${repo.name}](${repo.url})`,
      desc,
      meta.join(" · "),
    ].join("\n\n");
  });

  return cards.join("\n\n---\n\n");
}

/** VeTwo Ecosystem — manually categorized, data validated live. */
export function renderEcosystem(categorized: ReadonlyMap<string, NormalizedRepo[]>): string {
  if (categorized.size === 0) return "<sub>Ecosystem data unavailable.</sub>";

  const sections = [...categorized.entries()].map(([category, repos]) => {
    const items = repos
      .map((repo) => {
        const desc = repo.description?.trim();
        const suffix = desc ? ` — ${desc}` : "";
        return `- [\`${repo.name}\`](${repo.url})${suffix}`;
      })
      .join("\n");
    return `**${category}**\n${items}`;
  });

  return sections.join("\n\n");
}

/** Recent Work — factual, recency-based wording only (no invented "currently building X"). */
export function renderActivity(repos: readonly NormalizedRepo[], limit = 5): string {
  const recent = [...repos]
    .filter((r) => !r.isFork && !r.isArchived)
    .sort((a, b) => new Date(b.pushedAt).getTime() - new Date(a.pushedAt).getTime())
    .slice(0, limit);

  if (recent.length === 0) return "<sub>No recent activity available.</sub>";

  const rows = recent.map(
    (r) => `- [\`${r.name}\`](${r.url}) — recently updated (${relativeRecency(r.pushedAt)}, ${fmtDate(r.pushedAt)})`,
  );
  return rows.join("\n");
}
