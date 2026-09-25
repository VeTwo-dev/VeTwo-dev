import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fetchAllRepos, sanitize, USER } from "./lib/github.mjs";
import {
  normalizeRepoName,
  findSourceThumbnail,
  downloadThumbnail,
  generatePlaceholder,
  getLocalThumbnailPath,
} from "./lib/thumbnails.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "..");

const COUNT_RECENT = 4;
const COUNT_STARRED = 3;

function selectLatestRepos(repos, count) {
  const withoutProfile = repos.filter((r) => r.name.toLowerCase() !== USER.toLowerCase());
  const base = withoutProfile.length >= count ? withoutProfile : repos;
  const publicRepos = base.filter((r) => !r.private);
  const candidatesPrimary = base.filter((r) => !r.fork && !r.archived && !r.private);
  let candidates = candidatesPrimary.length >= count ? candidatesPrimary : publicRepos.length >= count ? publicRepos : base;
  candidates.sort((a, b) => {
    const pa = a.pushed_at ? new Date(a.pushed_at).getTime() : 0;
    const pb = b.pushed_at ? new Date(b.pushed_at).getTime() : 0;
    if (pb !== pa) return pb - pa;
    const ua = a.updated_at ? new Date(a.updated_at).getTime() : 0;
    const ub = b.updated_at ? new Date(b.updated_at).getTime() : 0;
    if (ub !== ua) return ub - ua;
    return a.name.localeCompare(b.name);
  });
  return candidates.slice(0, count);
}

function selectStarredRepos(repos, count) {
  const withoutProfile = repos.filter((r) => r.name.toLowerCase() !== USER.toLowerCase());
  const base = withoutProfile.length >= count ? withoutProfile : repos;
  const publicRepos = base.filter((r) => !r.private);
  const candidatesPrimary = base.filter((r) => !r.fork && !r.archived && !r.private);
  let candidates = candidatesPrimary.length >= count ? candidatesPrimary : publicRepos.length >= count ? publicRepos : base;
  candidates.sort((a, b) => {
    const sa = a.stargazers_count ?? 0;
    const sb = b.stargazers_count ?? 0;
    if (sb !== sa) return sb - sa;
    const pa = a.pushed_at ? new Date(a.pushed_at).getTime() : 0;
    const pb = b.pushed_at ? new Date(b.pushed_at).getTime() : 0;
    if (pb !== pa) return pb - pa;
    return a.name.localeCompare(b.name);
  });
  const seen = new Set();
  const result = [];
  for (const r of candidates) {
    if (!seen.has(r.id)) {
      seen.add(r.id);
      result.push(r);
    }
    if (result.length >= count) break;
  }
  return result;
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

    await mkdir(path.join(root, "assets", "thumbnail"), { recursive: true });

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
    console.log(`\n[thumbnails] ✓ Ensured ${allSelected.length} thumbnails in assets/thumbnail/`);
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
