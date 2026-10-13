import { loadConfig } from "./config.mjs";

const profileConfig = loadConfig("profile", {
  username: "VeTwo-dev",
  paths: { thumbnailPlaceholder: "assets/thumbnail/placeholder.svg" },
});
const githubConfig = loadConfig("github", {
  userAgent: "VeTwo-dev-profile-generator",
  apiVersion: "2022-11-28",
  reposPerPage: 100,
  sort: "pushed",
  repoType: "all",
  maxRepos: 300,
  timeoutsMs: { repos: 8000, readme: 4000, contentHead: 3000, thumbnailHead: 3000, thumbnailDownload: 8000 },
  maxThumbnailBytes: 819200,
});
const USERNAME = profileConfig.username || "VeTwo-dev";

export function sanitize(str, token) {
  if (!str || !token) return str;
  if (typeof str !== "string") str = String(str);
  return str.split(token).join("[REDACTED]");
}

export function getHeaders(token) {
  const headers = {
    Accept: "application/vnd.github+json",
    "User-Agent": githubConfig.userAgent || "VeTwo-dev-profile-generator",
    "X-GitHub-Api-Version": githubConfig.apiVersion || "2022-11-28",
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

export function parseLinkHeader(header) {
  if (!header) return null;
  const match = header.match(/<([^>]+)>;\s*rel="next"/);
  return match ? match[1] : null;
}

export async function fetchWithTimeout(url, opts = {}, ms = 4000) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), ms);
  try {
    const res = await fetch(url, { ...opts, signal: controller.signal });
    return res;
  } finally {
    clearTimeout(t);
  }
}

export async function fetchAllRepos(token) {
  const headers = getHeaders(token);
  const perPage = githubConfig.reposPerPage || 100;
  const sort = githubConfig.sort || "pushed";
  const type = githubConfig.repoType || "all";
  const maxRepos = githubConfig.maxRepos || 300;
  const timeout = (githubConfig.timeoutsMs && githubConfig.timeoutsMs.repos) || 8000;
  let url = `https://api.github.com/users/${USERNAME}/repos?per_page=${perPage}&sort=${sort}&type=${type}`;
  let all = [];
  while (url) {
    const res = await fetchWithTimeout(url, { headers }, timeout);
    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText);
      const sanitized = token ? sanitize(text, token) : text;
      if (res.status === 403 && res.headers.get("x-ratelimit-remaining") === "0") {
        throw new Error(`GitHub API rate limited: ${sanitized}`);
      }
      throw new Error(`GitHub API failed (${res.status}): ${sanitized}`);
    }
    const data = await res.json();
    if (!Array.isArray(data)) throw new Error("Invalid GitHub API response");
    all = all.concat(data);
    const next = parseLinkHeader(res.headers.get("link"));
    url = next;
    if (all.length > maxRepos) break;
  }
  return all;
}

// Shared repository selection used by all project generators.
// Same semantics everywhere: profile-repo exclusion, fork/archived/private
// filtering with public/all fallbacks, deterministic sort, id deduplication.
export function selectRepos(repos, options = {}) {
  const {
    count = 4,
    sortBy = "pushed",
    username = USERNAME,
    excludeProfile = true,
    filter = {},
  } = options;
  const withoutProfile = excludeProfile
    ? repos.filter((r) => String(r.name || "").toLowerCase() !== String(username || "").toLowerCase())
    : repos;
  const base = withoutProfile.length >= count ? withoutProfile : repos;
  const excludePrivate = filter.excludePrivate !== false;
  const excludeForks = filter.excludeForks !== false;
  const excludeArchived = filter.excludeArchived !== false;
  const publicRepos = excludePrivate ? base.filter((r) => !r.private) : base;
  const candidatesPrimary = base.filter(
    (r) => !(excludeForks && r.fork) && !(excludeArchived && r.archived) && !(excludePrivate && r.private)
  );
  const candidates =
    candidatesPrimary.length >= count
      ? candidatesPrimary
      : filter.fallbackToPublic !== false && publicRepos.length >= count
        ? publicRepos
        : filter.fallbackToAll !== false
          ? base
          : candidatesPrimary;
  const pushedTime = (r) => (r.pushed_at ? new Date(r.pushed_at).getTime() : 0);
  if (sortBy === "stars") {
    candidates.sort((a, b) => {
      const sa = a.stargazers_count ?? 0;
      const sb = b.stargazers_count ?? 0;
      if (sb !== sa) return sb - sa;
      const pa = pushedTime(a);
      const pb = pushedTime(b);
      if (pb !== pa) return pb - pa;
      return String(a.name).localeCompare(String(b.name));
    });
  } else {
    candidates.sort((a, b) => {
      const pa = pushedTime(a);
      const pb = pushedTime(b);
      if (pb !== pa) return pb - pa;
      const ua = a.updated_at ? new Date(a.updated_at).getTime() : 0;
      const ub = b.updated_at ? new Date(b.updated_at).getTime() : 0;
      if (ub !== ua) return ub - ua;
      return String(a.name).localeCompare(String(b.name));
    });
  }
  const seen = new Set();
  const result = [];
  for (const r of candidates) {
    const key = r.id ?? r.name;
    if (!seen.has(key)) {
      seen.add(key);
      result.push(r);
    }
    if (result.length >= count) break;
  }
  return result;
}

export function escapeHtml(str) {
  if (!str) return "";
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// Card-URL allowlist: local profile assets ("./...") or absolute HTTPS only.
// Blocks javascript:, data:, http:, protocol-relative and other schemes so
// untrusted repository metadata can never inject an unsafe link or image.
export function isSafeCardUrl(url) {
  if (typeof url !== "string") return false;
  const v = url.trim();
  if (v.startsWith("./")) return true;
  try {
    return new URL(v).protocol === "https:";
  } catch {
    return false;
  }
}

// Deterministic word-boundary truncation for card text. GitHub sanitizes
// CSS line-clamping, so the generator itself guarantees short text. The
// result never exceeds maxChars (ellipsis included).
export function truncateText(text, maxChars = 110) {
  const s = String(text ?? "").trim().replace(/\s+/g, " ");
  if (s.length <= maxChars) return s;
  if (maxChars <= 3) return s.slice(0, maxChars);
  const cut = s.slice(0, maxChars - 3);
  const lastSpace = cut.lastIndexOf(" ");
  const base = lastSpace > cut.length * 0.5 ? cut.slice(0, lastSpace) : cut;
  return `${base.trimEnd()}...`;
}

export function formatDate(dateStr) {
  if (!dateStr) return "";
  try {
    const d = new Date(dateStr);
    return d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
  } catch {
    return dateStr;
  }
}

// Pure helper: strip inline markdown to plain text for card rendering.
// Cards render as HTML, where `**` and `[t](u)` would otherwise show raw.
// Also applied to API repository descriptions, which may contain markdown.
export function stripMarkdownInline(text) {
  return String(text ?? "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/(`{1,3})([^`]+)\1/g, "$2")
    .replace(/(\*\*|__)(.+?)\1/g, "$2")
    .replace(/(^|\W)\*([^*\n]+)\*/g, "$1$2")
    .replace(/(^|\W)_([^_\n]+)_/g, "$1$2")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function isBoundaryLine(rawLine, textLine) {
  return (
    textLine.length === 0 ||
    rawLine.startsWith("!") ||
    rawLine.startsWith("[") ||
    rawLine.startsWith("<") ||
    rawLine.startsWith("|")
  );
}

// Pure helper: first meaningful paragraph of a README string, or null.
// Badges, images, headings and tables are skipped so decorative content
// never becomes a card description. Consecutive content lines are joined
// into one paragraph so descriptions never end mid-thought; an ellipsis is
// added only when the paragraph was cut off by following content. Boundary
// detection uses the pre-strip text so a lone link line never leaks its
// bare link text into the paragraph.
export function extractFirstParagraph(markdown, maxLen = 120) {
  if (!markdown) return null;
  const rawLines = String(markdown)
    .replace(/!\[[^\]]*\]\([^)]+\)/g, "")
    .replace(/<img[^>]*>/gi, "")
    .replace(/\[!\[[^\]]*\]\([^)]+\)\]\([^)]+\)/g, "")
    .replace(/#+\s.*\n/g, "")
    .split("\n")
    .map((l) => l.trim().replace(/^([-*+]|\d+\.)\s+/, ""));
  const lines = rawLines.map(stripMarkdownInline);
  for (let i = 0; i < lines.length; i++) {
    if (isBoundaryLine(rawLines[i], lines[i])) continue;
    const parts = [];
    let j = i;
    // A boundary line ends the paragraph; anything else joins it.
    while (j < lines.length && !isBoundaryLine(rawLines[j], lines[j])) {
      parts.push(lines[j]);
      j++;
    }
    const paragraph = parts.join(" ");
    if (paragraph.length <= 20) {
      i = j;
      continue;
    }
    const cutOff = lines.slice(j).some((_, k) => !isBoundaryLine(rawLines[j + k], lines[j + k]));
    let text = paragraph;
    if (text.length > maxLen) text = `${text.slice(0, maxLen - 3).trimEnd()}...`;
    else if (cutOff && !/[.!?…:]$/.test(text)) text = `${text}...`;
    return text;
  }
  return null;
}

export async function getRepoDescription(repo, token) {
  if (repo.description && repo.description.trim()) {
    // API descriptions may contain markdown — strip it like README excerpts.
    return stripMarkdownInline(repo.description);
  }
  const headers = getHeaders(token);
  const readmeTimeout = (githubConfig.timeoutsMs && githubConfig.timeoutsMs.readme) || 4000;
  // 1. Try the API README endpoint (base64 payload).
  try {
    const res = await fetchWithTimeout(`https://api.github.com/repos/${USERNAME}/${repo.name}/readme`, { headers }, readmeTimeout);
    if (res.ok) {
      const data = await res.json();
      if (data.content) {
        const first = extractFirstParagraph(Buffer.from(data.content, "base64").toString("utf8"));
        if (first) return first;
      }
    }
  } catch {}
  // 2. Fall back to the raw file (no API quota). This keeps unauthenticated
  // or rate-limited runs producing the same rich excerpts instead of
  // degrading to the generic fallback and overwriting good descriptions.
  const branch = repo.default_branch || "main";
  for (const readmeName of ["README.md", "readme.md"]) {
    try {
      const rawUrl = `https://raw.githubusercontent.com/${USERNAME}/${repo.name}/${branch}/${readmeName}`;
      const rawRes = await fetchWithTimeout(rawUrl, {}, readmeTimeout);
      if (!rawRes.ok) continue;
      const first = extractFirstParagraph(await rawRes.text());
      if (first) return first;
      break;
    } catch {
      continue;
    }
  }
  // 3. Generic fallback based on language/topics (deterministic, no network).
  const lang = repo.language ? ` ${repo.language}` : "";
  const topics = Array.isArray(repo.topics) && repo.topics.length > 0 ? ` · ${repo.topics.slice(0, 2).join(", ")}` : "";
  if (lang || topics) {
    return `${repo.name} —${lang} project${topics}.`;
  }
  return `${repo.name} — open-source repository.`;
}

export const USER = USERNAME;
