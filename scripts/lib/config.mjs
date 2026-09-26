import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "../..");
const configDir = path.join(root, "config");

const cache = new Map();

function deepMerge(base, override) {
  if (Array.isArray(base)) return override !== undefined ? override : base;
  if (base !== null && typeof base === "object" && override !== null && typeof override === "object") {
    const out = { ...base };
    for (const key of Object.keys(override)) {
      out[key] = key in out ? deepMerge(out[key], override[key]) : override[key];
    }
    return out;
  }
  return override !== undefined ? override : base;
}

export function loadConfig(name, defaults = {}) {
  const cacheKey = name;
  if (cache.has(cacheKey)) return cache.get(cacheKey);
  let fileData = {};
  const filePath = path.join(configDir, `${name}.json`);
  try {
    if (existsSync(filePath)) {
      const raw = readFileSync(filePath, "utf8");
      fileData = JSON.parse(raw);
    }
  } catch (err) {
    console.error(`[config] Warning: could not load ${name}.json, using defaults: ${err instanceof Error ? err.message : err}`);
    fileData = {};
  }
  const merged = deepMerge(defaults, fileData);
  cache.set(cacheKey, merged);
  return merged;
}

export function getRepoRoot() {
  return root;
}

export function resolveFromRoot(relPath) {
  return path.join(root, relPath);
}

export function clearConfigCache() {
  cache.clear();
}
