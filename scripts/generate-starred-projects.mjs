import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "..");
const outFile = path.join(root, "profile", "06-starred-projects-generated.md");

const USERNAME = "VeTwo-dev";
const COUNT = 3;

function sanitize(str, token) {
  if (!str || !token) return str;
  if (typeof str !== "string") str = String(str);
  return str.split(token).join("[REDACTED]");
}

function getHeaders(token) {
  const headers = {
    Accept: "application/vnd.github+json",
    "User-Agent": "VeTwo-dev-profile-generator",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

function parseLinkHeader(header) {
  if (!header) return null;
  const match = header.match(/<([^>]+)>;\s*rel="next"/);
  return match ? match[1] : null;
}

async function fetchWithTimeout(url, opts = {}, ms = 4000) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), ms);
  try {
    const res = await fetch(url, { ...opts, signal: controller.signal });
    return res;
  } finally {
    clearTimeout(t);
  }
}

async function fetchAllRepos(token) {
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

function selectStarredRepos(repos) {
  const withoutProfile = repos.filter((r) => r.name.toLowerCase() !== USERNAME.toLowerCase());
  const base = withoutProfile.length >= COUNT ? withoutProfile : repos;
  const publicRepos = base.filter((r) => !r.private);
  const candidatesPrimary = base.filter((r) => !r.fork && !r.archived && !r.private);
  let candidates = candidatesPrimary.length >= COUNT ? candidatesPrimary : publicRepos.length >= COUNT ? publicRepos : base;

  candidates.sort((a, b) => {
    const sa = a.stargazers_count ?? 0;
    const sb = b.stargazers_count ?? 0;
    if (sb !== sa) return sb - sa;
    const pa = a.pushed_at ? new Date(a.pushed_at).getTime() : 0;
    const pb = b.pushed_at ? new Date(b.pushed_at).getTime() : 0;
    if (pb !== pa) return pb - pa;
    return a.name.localeCompare(b.name);
  });

  // Ensure no duplicates (shouldn't happen) and slice
  const seen = new Set();
  const result = [];
  for (const r of candidates) {
    if (!seen.has(r.id)) {
      seen.add(r.id);
      result.push(r);
    }
    if (result.length >= COUNT) break;
  }
  return result;
}

const IMAGE_EXTS = [".png", ".jpg", ".svg"];
const COMMON_DIRS = ["", "assets/"];
const COMMON_NAMES = ["thumbnail", "preview", "banner", "cover"];

function isBadgeUrl(url) {
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

function isLikelyThumbnailUrl(url) {
  const lower = url.toLowerCase();
  const hasExt = IMAGE_EXTS.some((ext) => lower.includes(ext));
  if (!hasExt) return false;
  if (isBadgeUrl(url)) return false;
  return true;
}

async function fetchReadmeImages(repo, token) {
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

async function checkCommonImageFiles(repo, token) {
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

async function detectThumbnail(repo, token) {
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

function escapeHtml(str) {
  if (!str) return "";
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function formatDate(dateStr) {
  if (!dateStr) return "";
  try {
    const d = new Date(dateStr);
    return d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
  } catch {
    return dateStr;
  }
}

function generateCard(repo, thumbnail) {
  const name = escapeHtml(repo.name);
  const desc = repo.description ? escapeHtml(repo.description) : "No description provided.";
  const url = repo.html_url;
  const stars = repo.stargazers_count ?? 0;
  const forks = repo.forks_count ?? 0;
  const lang = repo.language ? escapeHtml(repo.language) : null;
  const pushed = repo.pushed_at ? formatDate(repo.pushed_at) : null;

  let thumbHtml = "";
  if (thumbnail) {
    const safeThumb = escapeHtml(thumbnail);
    thumbHtml = `        <a href="${url}"><img src="${safeThumb}" alt="${name}" width="100%" style="border-radius:6px; max-height:140px; object-fit:cover;" /></a><br />`;
  }

  let meta = "";
  const metaParts = [];
  if (lang) metaParts.push(`<span>${lang}</span>`);
  metaParts.push(`<span>⭐ ${stars}</span>`);
  if (forks > 0) metaParts.push(`<span>⑂ ${forks}</span>`);
  if (pushed) metaParts.push(`<span>Updated ${escapeHtml(pushed)}</span>`);
  if (metaParts.length > 0) {
    meta = `      <div style="font-size:11px; color:#7a7a7a; margin:6px 0;">${metaParts.join(" · ")}</div>`;
  }

  return `    <td width="50%" valign="top" style="padding:8px;">
      <div style="border:1px solid #252525; border-radius:8px; padding:12px; background:#0d1117;">
${thumbHtml}        <strong style="font-size:14px;"><a href="${url}" style="text-decoration:none; color:#58a6ff;">${name}</a></strong><br />
        <span style="font-size:12px; color:#c9d1d9;">${desc}</span><br />
${meta}        <a href="${url}" style="font-size:12px; color:#8957e5; text-decoration:none;">View Repository →</a>
      </div>
    </td>`;
}

async function main() {
  const token = process.env.GITHUB_TOKEN || "";
  try {
    console.log(`⭐ Fetching repositories for ${USERNAME} (starred)...`);
    const allRepos = await fetchAllRepos(token);
    if (!allRepos || allRepos.length === 0) {
      console.error("No repositories found for user.");
      process.exit(1);
    }

    const top = selectStarredRepos(allRepos);
    if (top.length === 0) {
      console.error("Could not determine top starred repositories.");
      process.exit(1);
    }

    console.log(`✓ Found ${allRepos.length} repos, selected top ${top.length} by stars:`);
    top.forEach((r) => console.log(` - ${r.name} (⭐ ${r.stargazers_count}, pushed_at: ${r.pushed_at})`));

    const withThumbs = [];
    for (const repo of top) {
      console.log(`🔍 Checking thumbnail for ${repo.name}...`);
      const thumb = await detectThumbnail(repo, token);
      if (thumb) {
        try {
          const res = await fetchWithTimeout(thumb, { method: "HEAD" }, 3000);
          if (!res.ok) {
            console.log(`  ⚠ Thumbnail not reachable (${res.status}), omitting`);
            withThumbs.push({ repo, thumbnail: null });
          } else {
            console.log(`  ✓ Thumbnail: ${thumb}`);
            withThumbs.push({ repo, thumbnail: thumb });
          }
        } catch {
          console.log(`  ⚠ Thumbnail check failed, omitting`);
          withThumbs.push({ repo, thumbnail: null });
        }
      } else {
        console.log(`  ℹ No thumbnail found`);
        withThumbs.push({ repo, thumbnail: null });
      }
    }

    let table = "<!-- This section is generated automatically. Do not edit directly. -->\n";
    table += "## ⭐ Featured by Stars\n\n";
    table += "<table>\n";
    // 3 cards: first row 2, second row 1 (+ empty)
    for (let i = 0; i < withThumbs.length; i += 2) {
      table += "  <tr>\n";
      const a = withThumbs[i];
      const b = withThumbs[i + 1];
      table += generateCard(a.repo, a.thumbnail) + "\n";
      if (b) {
        table += generateCard(b.repo, b.thumbnail) + "\n";
      } else {
        table += `    <td width="50%" valign="top"></td>\n`;
      }
      table += "  </tr>\n";
    }
    table += "</table>\n";

    await mkdir(path.dirname(outFile), { recursive: true });
    await writeFile(outFile, table, "utf8");
    console.log(`\n✓ Generated ${withThumbs.length} starred cards → ${path.relative(root, outFile)}`);
    withThumbs.forEach(({ repo, thumbnail }) => {
      console.log(` - ${repo.name}: ⭐ ${repo.stargazers_count}, desc=${repo.description ? "yes" : "no"}, thumb=${thumbnail ? "yes" : "no"}, url=${repo.html_url} ✓`);
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const safe = token ? sanitize(msg, token) : msg;
    console.error("Failed to generate starred project cards:", safe);
    process.exit(1);
  }
}

await main();
