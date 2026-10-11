import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fetchAllRepos, sanitize, USER, selectRepos } from "./lib/github.mjs";
import {
  normalizeRepoName,
  findSourceThumbnail,
  downloadThumbnail,
  generatePlaceholder,
  getLocalThumbnailPath,
} from "./lib/thumbnails.mjs";
import { loadConfig } from "./lib/config.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "..");
const projectsConfig = loadConfig("projects", {
  recent: { count: 4 },
  starred: { count: 3 },
});
const thumbsConfig = loadConfig("thumbnails", { dir: "assets/thumbnail" });

const COUNT_RECENT = projectsConfig.recent?.count || 4;
const COUNT_STARRED = projectsConfig.starred?.count || 3;

function selectLatestRepos(repos, count) {
  return selectRepos(repos, { count, sortBy: "pushed", username: USER });
}

function selectStarredRepos(repos, count) {
  return selectRepos(repos, { count, sortBy: "stars", username: USER });
}

async function main() {
  const token = process.env.GITHUB_TOKEN || "";
  try {
    console.log(`[thumbnails] Discovering projects for ${USER}...`);
    const allRepos = await fetchAllRepos(token);
    const recent = selectLatestRepos(allRepos, COUNT_RECENT);
    const starred = selectStarredRepos(allRepos, COUNT_STARRED);

    // Union, deduplicate by id
    const map = new Map();
    for (const r of [...recent, ...starred]) {
      if (!map.has(r.id)) map.set(r.id, r);
    }
    const allSelected = Array.from(map.values());
    console.log(`[thumbnails] Found ${allRepos.length} repos, need thumbnails for ${allSelected.length} unique: ${allSelected.map((r) => r.name).join(", ")}`);

    await mkdir(path.join(root, thumbsConfig.dir || "assets/thumbnail"), { recursive: true });

    for (const repo of allSelected) {
      console.log(`[thumbnails] Processing ${repo.name}...`);
      // Check local already exists
      const localPath = getLocalThumbnailPath(repo.name);
      // Try to find source thumbnail
      const sourceUrl = await findSourceThumbnail(repo, token);
      if (sourceUrl) {
        console.log(`  ✓ Found source thumbnail: ${sourceUrl}`);
        const local = await downloadThumbnail(sourceUrl, repo.name, token);
        if (local) {
          console.log(`  → Downloaded to ${local}`);
          continue;
        } else {
          console.log(`  ⚠ Download failed, generating placeholder`);
        }
      } else {
        console.log(`  ℹ No source thumbnail, generating placeholder`);
      }

      // Generate placeholder
      const generated = await generatePlaceholder(repo);
      console.log(`  → Generated placeholder: ${generated}`);
    }

    // Ensure placeholder.svg exists (for repos with no thumbnail and for fallback)
    // It's already created by generatePlaceholder if needed, but ensure the generic placeholder exists
    // The placeholder.svg we created earlier is the generic one, but our generated placeholders are per-repo
    // We should keep the generic placeholder.svg as fallback
    console.log(`\n[thumbnails] ✓ Ensured ${allSelected.length} thumbnails in ${thumbsConfig.dir || "assets/thumbnail"}/`);
    for (const repo of allSelected) {
      const p = getLocalThumbnailPath(repo.name);
      console.log(` - ${repo.name}: ${p}`);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const safe = token ? sanitize(msg, token) : msg;
    console.error("[thumbnails] Failed:", safe);
    process.exit(1);
  }
}

await main();
