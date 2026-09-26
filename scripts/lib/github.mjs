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
const thumbnailsConfig = loadConfig("thumbnails", {
  imageExts: [".png", ".jpg", ".svg"],
  commonDirs: ["", "assets/"],
  commonNames: ["thumbnail", "preview", "banner", "cover"],
  thumbnailKeywords: ["thumbnail", "preview", "banner", "cover", "hero", "screenshot"],
  badgeMarkers: [
    "shields.io",
    "badge",
    "skillicons.dev",
    "komarev.com",
    "github-readme-stats",
    "github-readme-streak",
    "capsule-render",
    "readme-typing-svg",
    "github-readme-activity-graph",
    "star-history",
    "contrib.rocks",
    "img.shields.io",
  ],
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

// Thumbnail helpers - shared (values from config/thumbnails.json)
export const IMAGE_EXTS = thumbnailsConfig.imageExts || [".png", ".jpg", ".svg"];
export const COMMON_DIRS = thumbnailsConfig.commonDirs || ["", "assets/"];
export const COMMON_NAMES = thumbnailsConfig.commonNames || ["thumbnail", "preview", "banner", "cover"];

export function isBadgeUrl(url) {
  const markers =
    thumbnailsConfig.badgeMarkers || [];
  const lower = url.toLowerCase();
  return markers.some((m) => lower.includes(String(m).toLowerCase()));
}

export function isLikelyThumbnailUrl(url) {
  const lower = url.toLowerCase();
  const hasExt = IMAGE_EXTS.some((ext) => lower.includes(ext));
  if (!hasExt) return false;
  if (isBadgeUrl(url)) return false;
  return true;
}

export async function fetchReadmeImages(repo, token) {
  const headers = getHeaders(token);
  const timeout = (githubConfig.timeoutsMs && githubConfig.timeoutsMs.readme) || 4000;
  try {
    const res = await fetchWithTimeout(`https://api.github.com/repos/${USERNAME}/${repo.name}/readme`, { headers }, timeout);
    if (!res.ok) return [];
    const data = await res.json();
    if (!data.content) return [];
    const decoded = Buffer.from(data.content, "base64").toString("utf8");
    const mdRegex = /!\[[^\]]*\]\(([^)]+)\)/g;
    const htmlRegex = /<img[^>]+src=["']([^"']+)["']/gi;
    const urls = [];
    let m;
    while ((m = mdRegex.exec(decoded)) !== null) urls.push(m[1]);
    while ((m = htmlRegex.exec(decoded)) !== null) urls.push(m[1]);
    return urls;
  } catch {
    return [];
  }
}

export async function checkCommonImageFiles(repo, token) {
  const headers = getHeaders(token);
  const branch = repo.default_branch || "main";
  for (const dir of COMMON_DIRS) {
    for (const name of COMMON_NAMES) {
      for (const ext of IMAGE_EXTS) {
        const filePath = `${dir}${name}${ext}`;
        try {
          const url = `https://api.github.com/repos/${USERNAME}/${repo.name}/contents/${filePath}?ref=${branch}`;
          const headTimeout = (githubConfig.timeoutsMs && githubConfig.timeoutsMs.contentHead) || 3000;
          const res = await fetchWithTimeout(url, { headers }, headTimeout);
          if (res.ok) {
            return `https://raw.githubusercontent.com/${USERNAME}/${repo.name}/${branch}/${filePath}`;
          }
        } catch {
          continue;
        }
      }
    }
  }
  return null;
}

export async function detectThumbnail(repo, token) {
  const keywords = thumbnailsConfig.thumbnailKeywords || ["thumbnail", "preview", "banner", "cover", "hero", "screenshot"];
  const readmeUrls = await fetchReadmeImages(repo, token);
  const likely = readmeUrls.filter(isLikelyThumbnailUrl);
  const prioritized = likely.filter((u) => {
    const l = u.toLowerCase();
    return keywords.some((k) => l.includes(String(k).toLowerCase()));
  });
  if (prioritized.length > 0) {
    let url = prioritized[0].trim();
    if (url.startsWith("./") || url.startsWith("/") || url.startsWith("assets/") || url.startsWith("images/")) {
      const branch = repo.default_branch || "main";
      const clean = url.replace(/^\.\//, "").replace(/^\//, "");
      return `https://raw.githubusercontent.com/${USERNAME}/${repo.name}/${branch}/${clean}`;
    }
    if (url.startsWith("http")) return url;
    return url;
  }
  if (likely.length > 0) {
    let url = likely[0].trim();
    if (url.startsWith("http") && !isBadgeUrl(url)) return url;
    if (url.startsWith("./") || url.startsWith("assets/") || url.startsWith("images/")) {
      const branch = repo.default_branch || "main";
      const clean = url.replace(/^\.\//, "");
      return `https://raw.githubusercontent.com/${USERNAME}/${repo.name}/${branch}/${clean}`;
    }
  }
  const common = await checkCommonImageFiles(repo, token);
  if (common) return common;
  try {
    const ogUrl = `https://opengraph.githubassets.com/1/${USERNAME}/${repo.name}`;
    const thumbTimeout = (githubConfig.timeoutsMs && githubConfig.timeoutsMs.thumbnailHead) || 3000;
    const res = await fetchWithTimeout(ogUrl, { method: "HEAD" }, thumbTimeout);
    if (res.ok) return ogUrl;
  } catch {}
  return null;
}

export function escapeHtml(str) {
  if (!str) return "";
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
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

export async function getRepoDescription(repo, token) {
  if (repo.description && repo.description.trim()) {
    return repo.description.trim();
  }
  // Try to extract first meaningful paragraph from README
  try {
    const headers = getHeaders(token);
    const readmeTimeout = (githubConfig.timeoutsMs && githubConfig.timeoutsMs.readme) || 4000;
    const res = await fetchWithTimeout(`https://api.github.com/repos/${USERNAME}/${repo.name}/readme`, { headers }, readmeTimeout);
    if (res.ok) {
      const data = await res.json();
      if (data.content) {
        const decoded = Buffer.from(data.content, "base64").toString("utf8");
        // Remove badges and images, get first paragraph
        const cleaned = decoded
          .replace(/!\[[^\]]*\]\([^)]+\)/g, "")
          .replace(/<img[^>]*>/gi, "")
          .replace(/\[!\[[^\]]*\]\([^)]+\)\]\([^)]+\)/g, "")
          .replace(/#+\s.*\n/g, "")
          .split("\n")
          .map((l) => l.trim())
          .filter((l) => l.length > 20 && !l.startsWith("!") && !l.startsWith("[") && !l.startsWith("<") && !l.startsWith("|"));
        if (cleaned.length > 0) {
          let first = cleaned[0];
          if (first.length > 120) first = first.slice(0, 117) + "...";
          return first;
        }
      }
    }
  } catch {}
  // Fallback based on language/topics
  const lang = repo.language ? ` ${repo.language}` : "";
  const topics = Array.isArray(repo.topics) && repo.topics.length > 0 ? ` · ${repo.topics.slice(0, 2).join(", ")}` : "";
  if (lang || topics) {
    return `${repo.name} —${lang} project${topics}.`;
  }
  return `${repo.name} — open-source repository.`;
}

export function getLocalPlaceholder() {
  return `./${profileConfig.paths?.thumbnailPlaceholder || "assets/thumbnail/placeholder.svg"}`;
}

export async function ensureLocalThumbnail(thumbnailUrl, repoName) {
  const placeholder = getLocalPlaceholder();
  if (!thumbnailUrl) return placeholder;
  if (thumbnailUrl.startsWith("./assets/thumbnail/")) return thumbnailUrl;
  // Try to cache externally hosted thumbnails locally under assets/thumbnail
  try {
    const extMatch = thumbnailUrl.match(/\.(png|jpg|jpeg|svg|webp|gif)(\?|$)/i);
    const ext = extMatch ? extMatch[1].toLowerCase() : "png";
    const safeExt = ext === "jpeg" ? "jpg" : ext === "svg" ? "svg" : "png";
    const localFileName = `${repoName}.${safeExt}`;
    const localUrl = `./assets/thumbnail/${localFileName}`;

    // Resolve filesystem path
    const { mkdir, writeFile, stat } = await import("node:fs/promises");
    const path = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const root = path.resolve(__dirname, "../..");
    const thumbDir = path.join(root, "assets", "thumbnail");
    const fullPath = path.join(thumbDir, localFileName);

    // If already cached, return local
    try {
      await stat(fullPath);
      return localUrl;
    } catch {}

    // Download
    const dlTimeout = (githubConfig.timeoutsMs && githubConfig.timeoutsMs.thumbnailDownload) || 8000;
    const maxBytes = githubConfig.maxThumbnailBytes || 819200;
    const res = await fetchWithTimeout(thumbnailUrl, {}, dlTimeout);
    if (!res.ok) return placeholder;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length === 0 || buf.length > maxBytes) return thumbnailUrl; // keep original if too large
    await mkdir(thumbDir, { recursive: true });
    await writeFile(fullPath, buf);
    return localUrl;
  } catch {
    return placeholder;
  }
}

export const USER = USERNAME;
