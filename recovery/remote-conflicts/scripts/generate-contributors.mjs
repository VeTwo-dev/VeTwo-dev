import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  USER,
  sanitize,
  getHeaders,
  fetchWithTimeout,
  parseLinkHeader,
  fetchAllRepos,
  escapeHtml,
  isSafeCardUrl,
  resolveApiBase,
  getTimeout,
} from "./lib/github.mjs";
import { loadConfig } from "./lib/config.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "..");

const projectsConfig = loadConfig("projects", {
  contributors: {
    output: "profile/contributors-generated.md",
    title: "Contributors",
    columns: 6,
    avatarSizePx: 64,
    maxContributors: 36,
    includeBots: false,
    perPage: 100,
    emptyMessage: "No contributors available yet — be the first to contribute.",
    colors: {
      text: "#ECFDF5",
      muted: "#A7B8AF",
      accent: "#10B981",
      surface: "#0D1511",
      border: "#121A16",
    },
  },
});
const profileConfig = loadConfig("profile", {
  filter: { excludeForks: true, excludeArchived: true, excludePrivate: true, fallbackToPublic: true, fallbackToAll: true },
});

const BANNER = "<!-- This section is generated automatically. Do not edit directly. -->";

// Stable identity for one human across repositories: numeric GitHub user id
// when the API returns it. Documented fallback (no id in the payload) is the
// lowercased login, which keeps identity stable for accounts renamed later.
export function contributorKey(contributor) {
  const raw = contributor && contributor.id;
  const id = raw == null || raw === "" ? NaN : Number(raw);
  if (Number.isFinite(id) && id > 0) return `id:${id}`;
  return `login:${String((contributor && contributor.login) || "").toLowerCase()}`;
}

// GitHub marks service accounts as type "Bot"; the "[bot]" login suffix is
// the reliable marker when the API omits the type field.
export function isBotContributor(contributor) {
  if (!contributor) return false;
  if (contributor.type === "Bot") return true;
  return String(contributor.login || "").endsWith("[bot]");
}

// Repository eligibility mirrors the shared card selectors (profile repo,
// forks, archived and private excluded) minus their "always fill N cards"
// fallbacks: aggregation must never pull in a repository the profile itself
// excludes. Repository identity is deduplicated by id (falling back to the
// full name) so overlapping pagination cannot process a repo twice.
export function selectEligibleRepos(repos, { username = USER, filter = {} } = {}) {
  const excludeForks = filter.excludeForks !== false;
  const excludeArchived = filter.excludeArchived !== false;
  const excludePrivate = filter.excludePrivate !== false;
  const profileName = String(username || "").toLowerCase();
  const seen = new Set();
  const out = [];
  for (const repo of Array.isArray(repos) ? repos : []) {
    if (!repo || typeof repo.name !== "string" || repo.name.length === 0) continue;
    if (String(repo.name).toLowerCase() === profileName) continue;
    if (excludeForks && repo.fork === true) continue;
    if (excludeArchived && repo.archived === true) continue;
    if (excludePrivate && repo.private === true) continue;
    const key = repo.id != null ? `id:${repo.id}` : `name:${String(repo.full_name || repo.name).toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(repo);
  }
  return out;
}

// Paginated contributors fetch for one repository. Returns
// { ok: true, contributors } or { ok: false, fatal, httpStatus, reason }.
// fatal marks account-wide problems (bad credentials, rate limit) that must
// stop the run; everything else (404/204/410, other statuses) means "this
// repository simply has no contributor data" and is skipped with a warning.
// Deduplication by identity happens per repository so a retried or
// overlapping page can never count a contributor twice.
export async function fetchRepoContributors(repoName, token, {
  fetchImpl = fetchWithTimeout,
  apiBase,
  perPage = 100,
  timeoutMs = getTimeout("contributors", 5000),
} = {}) {
  const base = resolveApiBase(apiBase);
  const headers = getHeaders(token);
  const per = Math.min(Math.max(Number(perPage) || 100, 1), 100);
  let url = `${base}/repos/${encodeURIComponent(USER)}/${encodeURIComponent(repoName)}/contributors?per_page=${per}&anon=false`;
  const contributors = [];
  const seen = new Set();
  while (url) {
    const res = await fetchImpl(url, { headers }, timeoutMs);
    // 204 carries no body: an empty repository, never a payload to parse.
    if (res && res.ok === true && res.status === 204) {
      return { ok: false, httpStatus: 204, reason: `contributors endpoint unavailable (204) for ${repoName}` };
    }
    if (!res || res.ok !== true) {
      const status = res ? res.status : 0;
      const text = res ? await res.text().catch(() => res.statusText) : "no response";
      const sanitized = token ? sanitize(text, token) : text;
      if (status === 401) return { ok: false, fatal: true, httpStatus: status, reason: `GitHub API authentication failed (401): ${sanitized}` };
      if (status === 403) return { ok: false, fatal: true, httpStatus: status, reason: `GitHub API rate limited: ${sanitized}` };
      // 204 (empty repository) and 404/410 (contributors disabled or removed)
      // are data-absence signals, not failures: skip this repository only.
      if (status === 204 || status === 404 || status === 410) {
        return { ok: false, httpStatus: status, reason: `contributors endpoint unavailable (${status}) for ${repoName}` };
      }
      return { ok: false, httpStatus: status, reason: `contributors request failed (${status}) for ${repoName}: ${sanitized}` };
    }
    const data = await res.json().catch(() => null);
    if (!Array.isArray(data)) {
      return { ok: false, reason: `invalid contributors response for ${repoName}` };
    }
    for (const contributor of data) {
      const key = contributorKey(contributor);
      if (seen.has(key)) continue;
      seen.add(key);
      contributors.push(contributor);
    }
    url = parseLinkHeader(res.headers.get("link"));
  }
  return { ok: true, contributors };
}

// Aggregates per-repository contributor lists into one roster.
// Rules (see OWNERSHIP.md):
//  - identities aggregate by id (or login fallback), never duplicated;
//  - each repository contributes at most one entry per contributor;
//  - `contributions` is summed only when every response carried a numeric
//    count for that contributor, so mixed metrics are never added together;
//    a single unknown count makes that contributor's total unreliable and
//    the renderer omits it instead of guessing.
export function aggregateContributors(perRepo, { includeBots = false } = {}) {
  const aggregated = new Map();
  for (const entry of Array.isArray(perRepo) ? perRepo : []) {
    const repoName = String((entry && entry.repo) || "");
    const contributors = Array.isArray(entry && entry.contributors) ? entry.contributors : [];
    const seenInRepo = new Set();
    for (const contributor of contributors) {
      if (!contributor || !repoName) continue;
      const key = contributorKey(contributor);
      if (seenInRepo.has(key)) continue;
      seenInRepo.add(key);
      if (!includeBots && isBotContributor(contributor)) continue;
      const login = String(contributor.login || "");
      const numeric = typeof contributor.contributions === "number" && Number.isFinite(contributor.contributions);
      let acc = aggregated.get(key);
      if (!acc) {
        acc = {
          key,
          id: key.startsWith("id:") ? Number(key.slice(3)) : null,
          logins: new Set(),
          avatarUrl: null,
          htmlUrl: null,
          contributions: 0,
          countsReliable: true,
          repos: new Set(),
        };
        aggregated.set(key, acc);
      }
      if (login) acc.logins.add(login);
      if (!acc.avatarUrl && isSafeCardUrl(contributor.avatar_url)) acc.avatarUrl = contributor.avatar_url;
      if (!acc.htmlUrl && isSafeCardUrl(contributor.html_url)) acc.htmlUrl = contributor.html_url;
      // First numeric value seen wins only for reliability: a later
      // non-numeric count flips the whole total to unreliable.
      acc.countsReliable = acc.countsReliable && numeric;
      if (numeric) acc.contributions += contributor.contributions;
      acc.repos.add(repoName);
    }
  }
  return [...aggregated.values()].map((acc) => ({
    key: acc.key,
    id: acc.id,
    // Deterministic pick among multiple logins for one identity.
    login: [...acc.logins].sort()[0] || "",
    logins: [...acc.logins].sort(),
    avatarUrl: acc.avatarUrl,
    htmlUrl: acc.htmlUrl || (acc.logins.size ? `https://github.com/${encodeURIComponent([...acc.logins].sort()[0])}` : null),
    contributions: acc.countsReliable ? acc.contributions : null,
    repos: [...acc.repos].sort(),
    projectCount: acc.repos.size,
  }));
}

// Deterministic order: contribution count descending (unknown counts last),
// then username alphabetically as the tie-breaker.
export function sortContributors(entries) {
  return [...entries].sort((a, b) => {
    const aNull = a.contributions == null;
    const bNull = b.contributions == null;
    if (aNull !== bNull) return aNull ? 1 : -1;
    if (!aNull && a.contributions !== b.contributions) return b.contributions - a.contributions;
    return String(a.login).localeCompare(String(b.login));
  });
}

export function contributorOptions(overrides = {}) {
  const cfg = (projectsConfig.contributors && { ...projectsConfig.contributors }) || {};
  const colors = { ...(cfg.colors || {}), ...((overrides && overrides.colors) || {}) };
  const rawMax = overrides.maxContributors != null ? overrides.maxContributors : cfg.maxContributors;
  const max = Number(rawMax);
  return {
    title: (overrides.title != null ? overrides.title : cfg.title) || "Contributors",
    columns: Math.max(1, Number((overrides.columns != null ? overrides.columns : cfg.columns) || 6)),
    avatarSizePx: Math.max(16, Number((overrides.avatarSizePx != null ? overrides.avatarSizePx : cfg.avatarSizePx) || 64)),
    // <= 0 disables the cap (documented in OWNERSHIP.md).
    maxContributors: Number.isFinite(max) ? Math.floor(max) : 0,
    emptyMessage: (overrides.emptyMessage != null ? overrides.emptyMessage : cfg.emptyMessage) || "No contributors available yet — be the first to contribute.",
    colors: {
      text: colors.text || "#ECFDF5",
      muted: colors.muted || "#A7B8AF",
      accent: colors.accent || "#10B981",
      surface: colors.surface || "#0D1511",
      border: colors.border || "#121A16",
    },
  };
}

function renderAvatar(contributor, options) {
  const size = options.avatarSizePx;
  const login = escapeHtml(contributor.login);
  const accent = options.colors.accent;
  if (contributor.avatarUrl) {
    return `<a href="${escapeHtml(contributor.htmlUrl)}" title="${login}"><img src="${escapeHtml(contributor.avatarUrl)}" alt="@${login} avatar" width="${size}" height="${size}" style="border-radius:50%; border:1px solid ${options.colors.border}; width:${size}px; height:${size}px;" /></a>`;
  }
  // No usable avatar URL: a styled initial tile, never a project thumbnail
  // and never a generated or downloaded image.
  const initial = escapeHtml(String(contributor.login || "?").charAt(0).toUpperCase() || "?");
  return `<a href="${escapeHtml(contributor.htmlUrl)}" title="${login}"><span style="display:inline-block; width:${size}px; height:${size}px; line-height:${size}px; border-radius:50%; border:1px solid ${options.colors.border}; background:${options.colors.surface}; color:${accent}; font-size:${Math.floor(size / 2.4)}px; text-align:center;">${initial}</span></a>`;
}

function renderMeta(contributor, options) {
  const parts = [];
  if (contributor.contributions != null) parts.push(`${contributor.contributions} commits`);
  parts.push(`${contributor.projectCount} ${contributor.projectCount === 1 ? "repo" : "repos"}`);
  return `<div style="font-size:11px; color:${options.colors.muted}; margin-top:6px;">${parts.join(" · ")}</div>`;
}

function renderCell(contributor, options, columns) {
  const login = escapeHtml(contributor.login);
  const width = `${(100 / columns).toFixed(2)}%`;
  // Escaped even in the comment: untrusted logins must never land raw in output.
  return `    <!-- Contributor ${login} -->
    <td width="${width}" align="center" style="padding:12px;">
      ${renderAvatar(contributor, options)}
      <div style="margin-top:6px;"><a href="${escapeHtml(contributor.htmlUrl)}" style="text-decoration:none; color:${options.colors.accent}; font-size:13px;">${login}</a></div>
      ${renderMeta(contributor, options)}
    </td>`;
}

// Renders the whole section. Pure for identical input entries + options, so
// repeated generator runs with identical API responses are byte-identical.
export function renderContributorsSection(entries, options = {}) {
  const opts = contributorOptions(options);
  const sorted = sortContributors(entries);
  const capped = opts.maxContributors > 0 ? sorted.slice(0, opts.maxContributors) : sorted;
  const hidden = sorted.length - capped.length;

  let out = `${BANNER}\n## ${opts.title}\n\n<div align="center">`;

  if (capped.length === 0) {
    out += `\n\n<p><em>${escapeHtml(opts.emptyMessage)}</em></p>\n`;
  } else {
    out += `\n\n<table width="100%" cellspacing="0" cellpadding="0" style="width:100%; border-collapse:collapse;">\n`;
    for (let i = 0; i < capped.length; i += opts.columns) {
      out += "  <tr>\n";
      const row = capped.slice(i, i + opts.columns);
      out += row.map((contributor) => renderCell(contributor, opts, opts.columns)).join("\n");
      out += "\n  </tr>\n";
    }
    out += "</table>\n";
    if (hidden > 0) {
      out += `\n<p style="font-size:12px; color:${opts.colors.muted};">and ${hidden} more contributor${hidden === 1 ? "" : "s"}.</p>\n`;
    }
  }
  out += "\n</div>\n";
  return out;
}

// Walks every eligible repository, collecting contributors and skipping
// repositories whose endpoint is unavailable. Fatal account-wide problems
// (bad token, rate limit) abort the whole run before any file is written.
export async function collectContributors(repos, token, {
  username = USER,
  filter = {},
  fetchImpl = fetchWithTimeout,
  fetchRepoContributorsImpl,
  apiBase,
  perPage,
} = {}) {
  const eligible = selectEligibleRepos(repos, { username, filter });
  const fetchOne = fetchRepoContributorsImpl || ((repoName, tok, opts) =>
    fetchRepoContributors(repoName, tok, { ...opts, fetchImpl, apiBase, perPage }));
  const perRepo = [];
  const warnings = [];
  let unavailable = 0;
  for (const repo of eligible) {
    const repoName = repo.name;
    const fullName = repo.full_name || `${USER}/${repoName}`;
    let result;
    try {
      result = await fetchOne(repoName, token, { perPage });
    } catch (err) {
      // A single repository timing out must not kill the roster.
      const msg = err instanceof Error ? err.message : String(err);
      warnings.push(`contributors unavailable for ${fullName}: ${token ? sanitize(msg, token) : msg}`);
      unavailable += 1;
      continue;
    }
    if (!result) {
      warnings.push(`contributors unavailable for ${fullName}: no response`);
      unavailable += 1;
      continue;
    }
    if (!result.ok) {
      if (result.fatal) {
        throw new Error(result.reason);
      }
      warnings.push(result.reason);
      unavailable += 1;
      continue;
    }
    perRepo.push({ repo: fullName, contributors: result.contributors });
  }
  // Never replace a good roster with an empty one: if not a single eligible
  // repository answered, fail instead of writing "no contributors".
  if (eligible.length > 0 && unavailable === eligible.length) {
    throw new Error(`contributor data unavailable for every of ${eligible.length} eligible repositories`);
  }
  const entries = aggregateContributors(perRepo);
  return { entries, eligible, warnings };
}

async function main() {
  const token = process.env.GITHUB_TOKEN || "";
  try {
    console.log(`[contributors] Fetching repositories for ${USER} (contributors)...`);
    const repos = await fetchAllRepos(token, { apiBase: resolveApiBase() });
    if (!Array.isArray(repos)) throw new Error("Invalid GitHub API response");
    console.log(`[contributors] Found ${repos.length} repositories`);

    const contributorsCfg = projectsConfig.contributors || {};
    const apiBase = resolveApiBase();
    const { entries, eligible, warnings } = await collectContributors(repos, token, {
      username: USER,
      filter: profileConfig.filter || {},
      apiBase,
      perPage: contributorsCfg.perPage,
      fetchImpl: fetchWithTimeout,
    });
    for (const warning of warnings) {
      console.warn(`[contributors] warning: ${token ? sanitize(warning, token) : warning}`);
    }
    console.log(`[contributors] Aggregated ${entries.length} contributor(s) across ${eligible.length} eligible repositories`);

    const section = renderContributorsSection(entries, {});
    const outRelative = contributorsCfg.output || "profile/contributors-generated.md";
    await mkdir(path.dirname(path.join(root, outRelative)), { recursive: true });
    await writeFile(path.join(root, outRelative), section, "utf8");
    console.log(`[contributors] ✓ ${entries.length} contributor(s) → ${outRelative}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[contributors] Failed:", token ? sanitize(msg, token) : msg);
    process.exit(1);
  }
}

const isDirectRun = !!process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isDirectRun) await main();
