import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "./config.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "../..");

const thumbsConfig = loadConfig("thumbnails", {
  dir: "assets/thumbnail",
  placeholder: "assets/thumbnail/placeholder.svg",
  imageExts: [".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg"],
  extPriority: { svg: 0, png: 1, webp: 2, jpg: 3, jpeg: 3, gif: 4 },
});

const THUMB_DIR = thumbsConfig.dir || "assets/thumbnail";

// Normalize a repository name to a filesystem-safe thumbnail basename.
// Only lowercase alphanumerics and hyphens survive, so the result can never
// climb out of the thumbnail directory (no slashes, no dot segments).
export function normalizeRepoName(name) {
  return String(name ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-+/g, "-");
}

export function getLocalThumbnailPath(repoName, ext = "svg") {
  const safe = normalizeRepoName(repoName);
  return `./${THUMB_DIR}/${safe}.${ext}`;
}

export function getPlaceholderPath() {
  return `./${thumbsConfig.placeholder || "assets/thumbnail/placeholder.svg"}`;
}

// True when a thumbnail URL is the shared placeholder rather than a
// project-specific local asset. Used for diagnostics in generator logs.
export function isSharedPlaceholder(url) {
  return url === getPlaceholderPath();
}

function supportedExts() {
  const exts = thumbsConfig.imageExts;
  return Array.isArray(exts) && exts.length > 0
    ? exts.map((e) => String(e).toLowerCase())
    : [".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg"];
}

function extRank(ext) {
  const priority = thumbsConfig.extPriority || {};
  return priority[ext.replace(/^\./, "")] ?? 10;
}

// Resolve the thumbnail for one repository card from local assets only:
//   1. A file named after the repository (<normalized>.<ext>) inside the
//      profile repository's own assets/thumbnail/ directory wins. When
//      several match, the configured extension priority then the filename
//      decide deterministically.
//   2. Otherwise every project shares the single static placeholder.
// Pure filesystem reads. No network requests, no writes, never throws for
// missing directories or files — a missing thumbnail is not an error.
export async function resolveLocalThumbnail(repoName, options = {}) {
  const rootDir = options.rootDir || root;
  const dir = options.dir || THUMB_DIR;
  const placeholder = options.placeholder || getPlaceholderPath();
  const thumbDir = path.join(rootDir, dir);
  const thumbDirResolved = path.resolve(thumbDir);
  const fallback = () => ({ url: placeholder, kind: "placeholder" });
  const safe = normalizeRepoName(repoName);
  if (!safe) return fallback();
  const exts = supportedExts();
  let entries;
  try {
    entries = await readdir(thumbDir);
  } catch {
    return fallback();
  }
  const candidates = [];
  for (const name of entries) {
    if (typeof name !== "string") continue;
    const lower = name.toLowerCase();
    const dot = lower.lastIndexOf(".");
    if (dot <= 0) continue;
    if (lower.slice(0, dot) !== safe) continue;
    const ext = lower.slice(dot);
    if (!exts.includes(ext)) continue;
    const full = path.join(thumbDir, name);
    // Containment: the resolved path must stay inside the thumbnail dir.
    const resolved = path.resolve(full);
    if (resolved !== path.join(thumbDirResolved, name) || !resolved.startsWith(thumbDirResolved + path.sep)) {
      continue;
    }
    let isFile = false;
    try {
      isFile = (await stat(full)).isFile();
    } catch {
      continue;
    }
    if (!isFile) continue;
    candidates.push({ name, rank: extRank(ext) });
  }
  if (candidates.length === 0) return fallback();
  candidates.sort((a, b) => (a.rank !== b.rank ? a.rank - b.rank : a.name.localeCompare(b.name)));
  return { url: `./${dir}/${candidates[0].name}`, kind: "local" };
}
