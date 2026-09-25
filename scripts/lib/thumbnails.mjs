import { mkdir, writeFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getHeaders, fetchWithTimeout, USER } from "./github.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "../..");

export function normalizeRepoName(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-+/g, "-");
}

export function getLocalThumbnailPath(repoName, ext = "svg") {
  const safe = normalizeRepoName(repoName);
  return `./assets/thumbnail/${safe}.${ext}`;
}

export function getLocalThumbnailFullPath(repoName, ext = "svg") {
  const safe = normalizeRepoName(repoName);
  return path.join(root, "assets", "thumbnail", `${safe}.${ext}`);
}

export function getPlaceholderPath() {
  return "./assets/thumbnail/placeholder.svg";
}

// Deterministic hash for composition selection
function hashString(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 31 + str.charCodeAt(i)) >>> 0;
  }
  return hash;
}

function getCompositionIndex(repoName) {
  return hashString(repoName) % 5;
}

// Find best thumbnail in source repo's assets/thumbnail
export async function findSourceThumbnail(repo, token) {
  const headers = getHeaders(token);
  const branch = repo.default_branch || "main";
  const dirPath = "assets/thumbnail";

  try {
    const url = `https://api.github.com/repos/${USER}/${repo.name}/contents/${dirPath}?ref=${branch}`;
    const res = await fetchWithTimeout(url, { headers }, 5000);
    if (!res.ok) return null;
    const data = await res.json();
    if (!Array.isArray(data)) return null;

    // Filter to image files
    const images = data.filter((f) => f.type === "file" && /\.(svg|png|jpg|jpeg|webp)$/i.test(f.name));
    if (images.length === 0) return null;

    // Prefer thumbnail.*, preview.*, cover.*, banner.*, hero.*, project.*
    const priority = ["thumbnail", "preview", "cover", "banner", "hero", "project"];
    const extPriority = { svg: 0, png: 1, webp: 2, jpg: 3, jpeg: 3 };

    images.sort((a, b) => {
      const aLower = a.name.toLowerCase();
      const bLower = b.name.toLowerCase();
      const aIdx = priority.findIndex((p) => aLower.includes(p));
      const bIdx = priority.findIndex((p) => bLower.includes(p));
      const aP = aIdx === -1 ? 100 : aIdx;
      const bP = bIdx === -1 ? 100 : bIdx;
      if (aP !== bP) return aP - bP;
      const aExt = a.name.split(".").pop().toLowerCase();
      const bExt = b.name.split(".").pop().toLowerCase();
      const aE = extPriority[aExt] ?? 10;
      const bE = extPriority[bExt] ?? 10;
      if (aE !== bE) return aE - bE;
      return a.name.localeCompare(b.name);
    });

    const best = images[0];
    // Return download URL
    return best.download_url || `https://raw.githubusercontent.com/${USER}/${repo.name}/${branch}/${dirPath}/${best.name}`;
  } catch {
    return null;
  }
}

export async function downloadThumbnail(sourceUrl, repoName, token) {
  const headers = token ? { Authorization: `Bearer ${token}`, "User-Agent": "VeTwo-dev-profile-generator" } : { "User-Agent": "VeTwo-dev-profile-generator" };
  try {
    const res = await fetchWithTimeout(sourceUrl, { headers }, 8000);
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length === 0 || buf.length > 800 * 1024) return null;

    // Determine extension from URL or content-type
    const urlExt = sourceUrl.match(/\.(svg|png|jpg|jpeg|webp)(\?|$)/i);
    let ext = urlExt ? urlExt[1].toLowerCase() : "png";
    if (ext === "jpeg") ext = "jpg";
    const contentType = res.headers.get("content-type") || "";
    if (!urlExt && contentType.includes("svg")) ext = "svg";
    else if (!urlExt && contentType.includes("png")) ext = "png";

    const safeName = normalizeRepoName(repoName);
    const localFile = `${safeName}.${ext}`;
    const localPath = path.join(root, "assets", "thumbnail", localFile);
    const localUrl = `./assets/thumbnail/${localFile}`;

    await mkdir(path.dirname(localPath), { recursive: true });
    await writeFile(localPath, buf);
    return localUrl;
  } catch {
    return null;
  }
}

// Check if local thumbnail already exists and is up to date (simple existence check)
export async function localThumbnailExists(repoName) {
  const exts = ["svg", "png", "jpg", "webp"];
  for (const ext of exts) {
    const safe = normalizeRepoName(repoName);
    const full = path.join(root, "assets", "thumbnail", `${safe}.${ext}`);
    try {
      await stat(full);
      return `./assets/thumbnail/${safe}.${ext}`;
    } catch {}
  }
  // Check placeholder
  try {
    await stat(path.join(root, "assets", "thumbnail", "placeholder.svg"));
  } catch {}
  return null;
}

// Generate placeholder SVG with multiple compositions
export async function generatePlaceholder(repo) {
  const safeName = normalizeRepoName(repo.name);
  const fileName = `${safeName}.svg`;
  const fullPath = path.join(root, "assets", "thumbnail", fileName);
  const localUrl = `./assets/thumbnail/${fileName}`;

  // Check if already exists (avoid regeneration if not needed)
  try {
    await stat(fullPath);
    // If exists, check if it's a generated placeholder (by checking if it contains the repo name)
    // For now, we regenerate only if needed; to keep deterministic, we can check if file is older
    // For simplicity, we will regenerate if the file doesn't exist or we want to ensure it's up to date
    // But to avoid unnecessary writes, we can return existing
    return localUrl;
  } catch {}

  const name = repo.name;
  const desc = repo.description || `${repo.language || "TypeScript"} project`;
  const lang = repo.language || "TypeScript";
  const topics = Array.isArray(repo.topics) ? repo.topics.slice(0, 3).join(" · ") : "";
  const stars = repo.stargazers_count ?? 0;

  const compIndex = getCompositionIndex(name);
  const accentColors = ["#8957e5", "#58a6ff", "#2ea043", "#f778ba", "#ff7b72"];
  const accent = accentColors[compIndex % accentColors.length];
  const bgColors = ["#0d1117", "#161b22", "#0f172a", "#1a1a2e", "#0d1117"];
  const bg = bgColors[compIndex % bgColors.length];

  // Truncate description
  let shortDesc = desc;
  if (shortDesc.length > 80) shortDesc = shortDesc.slice(0, 77) + "...";

  // Escape for SVG
  const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

  let svg = "";

  // 5 compositions, each 1200x675 (16:9)
  const width = 1200;
  const height = 675;

  if (compIndex === 0) {
    // Composition A: Large project name, description, language indicator, geometric background
    svg = `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
  <rect width="${width}" height="${height}" fill="${bg}" rx="16"/>
  <rect x="40" y="40" width="${width-80}" height="${height-80}" fill="none" stroke="${accent}" stroke-width="2" rx="12" opacity="0.3"/>
  <circle cx="1000" cy="80" r="120" fill="${accent}" opacity="0.08"/>
  <circle cx="1100" cy="150" r="80" fill="${accent}" opacity="0.05"/>
  <rect x="60" y="60" width="60" height="60" fill="${accent}" rx="8" opacity="0.15"/>
  <text x="80" y="95" font-family="JetBrains Mono, monospace" font-size="28" fill="${accent}" text-anchor="middle">⬢</text>
  <text x="140" y="85" font-family="Inter, sans-serif" font-size="14" fill="#7a7a7a" letter-spacing="2">VeTwo • ${esc(lang)}</text>
  <text x="60" y="320" font-family="Inter, sans-serif" font-size="48" font-weight="700" fill="#ffffff">${esc(name)}</text>
  <text x="60" y="380" font-family="Inter, sans-serif" font-size="18" fill="#c9d1d9">${esc(shortDesc)}</text>
  <text x="60" y="430" font-family="JetBrains Mono, monospace" font-size="13" fill="#7a7a7a">${esc(topics || lang)} ${stars > 0 ? `· ⭐ ${stars}` : ""}</text>
  <rect x="60" y="500" width="200" height="4" fill="${accent}" rx="2"/>
</svg>`;
  } else if (compIndex === 1) {
    // Composition B: Logo-focused, centered
    svg = `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
  <rect width="${width}" height="${height}" fill="${bg}" rx="16"/>
  <rect x="0" y="0" width="${width}" height="${height}" fill="none" stroke="${accent}" stroke-width="1" rx="16" opacity="0.2"/>
  <circle cx="600" cy="300" r="180" fill="${accent}" opacity="0.06"/>
  <circle cx="600" cy="300" r="120" fill="${accent}" opacity="0.1"/>
  <text x="600" y="320" font-family="JetBrains Mono, monospace" font-size="72" fill="${accent}" text-anchor="middle" opacity="0.9">⬢</text>
  <text x="600" y="420" font-family="Inter, sans-serif" font-size="42" font-weight="700" fill="#ffffff" text-anchor="middle">${esc(name)}</text>
  <text x="600" y="460" font-family="Inter, sans-serif" font-size="16" fill="#8b949e" text-anchor="middle">${esc(shortDesc)}</text>
  <text x="600" y="500" font-family="JetBrains Mono, monospace" font-size="12" fill="#7a7a7a" text-anchor="middle">${esc(lang)}${topics ? ` · ${esc(topics)}` : ""}</text>
</svg>`;
  } else if (compIndex === 2) {
    // Composition C: Split layout
    svg = `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
  <rect width="${width}" height="${height}" fill="${bg}" rx="16"/>
  <rect x="0" y="0" width="480" height="${height}" fill="${accent}" opacity="0.08" rx="16"/>
  <rect x="40" y="40" width="400" height="400" fill="none" stroke="${accent}" stroke-width="1" rx="12" opacity="0.2"/>
  <text x="240" y="260" font-family="JetBrains Mono, monospace" font-size="96" fill="${accent}" text-anchor="middle" opacity="0.3">⬢</text>
  <text x="520" y="260" font-family="Inter, sans-serif" font-size="36" font-weight="700" fill="#ffffff">${esc(name)}</text>
  <text x="520" y="310" font-family="Inter, sans-serif" font-size="16" fill="#c9d1d9">${esc(shortDesc)}</text>
  <text x="520" y="360" font-family="JetBrains Mono, monospace" font-size="12" fill="${accent}">${esc(lang)} · VeTwo</text>
  <text x="520" y="390" font-family="JetBrains Mono, monospace" font-size="11" fill="#7a7a7a">${esc(topics)}</text>
  <rect x="520" y="420" width="80" height="3" fill="${accent}" rx="1"/>
</svg>`;
  } else if (compIndex === 3) {
    // Composition D: Editorial/card
    svg = `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
  <rect width="${width}" height="${height}" fill="${bg}" rx="16"/>
  <rect x="40" y="40" width="${width-80}" height="120" fill="${accent}" opacity="0.08" rx="8"/>
  <text x="60" y="110" font-family="JetBrains Mono, monospace" font-size="14" fill="${accent}">● VeTwo • ${esc(lang)}</text>
  <text x="60" y="280" font-family="Inter, sans-serif" font-size="44" font-weight="800" fill="#ffffff" letter-spacing="-1">${esc(name)}</text>
  <text x="60" y="330" font-family="Inter, sans-serif" font-size="18" fill="#8b949e">${esc(shortDesc)}</text>
  <rect x="60" y="380" width="${width-120}" height="1" fill="#252525"/>
  <text x="60" y="420" font-family="JetBrains Mono, monospace" font-size="12" fill="#7a7a7a">${esc(topics)} ${stars > 0 ? `· ⭐ ${stars} stars` : ""}</text>
  <circle cx="${width-80}" cy="80" r="40" fill="none" stroke="${accent}" stroke-width="2" opacity="0.15"/>
  <circle cx="${width-80}" cy="80" r="20" fill="${accent}" opacity="0.1"/>
</svg>`;
  } else {
    // Composition E: Centered with decorative geometry
    svg = `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
  <rect width="${width}" height="${height}" fill="${bg}" rx="16"/>
  <rect x="40" y="40" width="${width-80}" height="${height-80}" fill="none" stroke="#252525" stroke-width="1" rx="12"/>
  <circle cx="200" cy="500" r="60" fill="${accent}" opacity="0.05"/>
  <circle cx="1000" cy="200" r="40" fill="${accent}" opacity="0.05"/>
  <rect x="60" y="60" width="120" height="4" fill="${accent}" rx="2"/>
  <text x="600" y="300" font-family="Inter, sans-serif" font-size="48" font-weight="800" fill="#ffffff" text-anchor="middle">${esc(name)}</text>
  <text x="600" y="350" font-family="Inter, sans-serif" font-size="16" fill="#8b949e" text-anchor="middle">${esc(shortDesc)}</text>
  <text x="600" y="400" font-family="JetBrains Mono, monospace" font-size="12" fill="${accent}" text-anchor="middle">${esc(lang)}${topics ? ` · ${esc(topics)}` : ""}</text>
  <text x="600" y="550" font-family="JetBrains Mono, monospace" font-size="10" fill="#484f58" text-anchor="middle">github.com/VeTwo-dev/${esc(name)}</text>
</svg>`;
  }

  await mkdir(path.dirname(fullPath), { recursive: true });
  await writeFile(fullPath, svg, "utf8");
  return localUrl;
}
