const USERNAME = "VeTwo-dev";

export function sanitize(str, token) {
  if (!str || !token) return str;
  if (typeof str !== "string") str = String(str);
  return str.split(token).join("[REDACTED]");
}

export function getHeaders(token) {
  const headers = {
    Accept: "application/vnd.github+json",
    "User-Agent": "VeTwo-dev-profile-generator",
    "X-GitHub-Api-Version": "2022-11-28",
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
  let url = `https://api.github.com/users/${USERNAME}/repos?per_page=100&sort=pushed&type=all`;
  let all = [];
  while (url) {
    const res = await fetchWithTimeout(url, { headers }, 8000);
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
    if (all.length > 300) break;
  }
  return all;
}

// Thumbnail helpers - shared
export const IMAGE_EXTS = [".png", ".jpg", ".svg"];
export const COMMON_DIRS = ["", "assets/"];
export const COMMON_NAMES = ["thumbnail", "preview", "banner", "cover"];

export function isBadgeUrl(url) {
  const lower = url.toLowerCase();
  return (
    lower.includes("shields.io") ||
    lower.includes("badge") ||
    lower.includes("skillicons.dev") ||
    lower.includes("komarev.com") ||
    lower.includes("github-readme-stats") ||
    lower.includes("github-readme-streak") ||
    lower.includes("capsule-render") ||
    lower.includes("readme-typing-svg") ||
    lower.includes("github-readme-activity-graph") ||
    lower.includes("star-history") ||
    lower.includes("contrib.rocks") ||
    lower.includes("img.shields.io")
  );
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
  try {
    const res = await fetchWithTimeout(`https://api.github.com/repos/${USERNAME}/${repo.name}/readme`, { headers }, 4000);
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
          const res = await fetchWithTimeout(url, { headers }, 3000);
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
  const readmeUrls = await fetchReadmeImages(repo, token);
  const likely = readmeUrls.filter(isLikelyThumbnailUrl);
  const prioritized = likely.filter((u) => {
    const l = u.toLowerCase();
    return ["thumbnail", "preview", "banner", "cover", "hero", "screenshot"].some((k) => l.includes(k));
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
    const res = await fetchWithTimeout(ogUrl, { method: "HEAD" }, 3000);
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

export const USER = USERNAME;
