import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  USER,
  sanitize,
  fetchAllRepos,
  fetchWithTimeout,
  detectThumbnail,
  escapeHtml,
  formatDate,
  getRepoDescription,
  getLocalPlaceholder,
  ensureLocalThumbnail,
} from "./lib/github.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "..");
const outFile = path.join(root, "profile", "06-starred-projects-generated.md");
const COUNT = 3;

function selectStarredRepos(repos) {
  const withoutProfile = repos.filter((r) => r.name.toLowerCase() !== USER.toLowerCase());
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

async function getDescriptionWithFallback(repo, token) {
  const desc = await getRepoDescription(repo, token);
  return escapeHtml(desc);
}

function generateCard(repo, thumbnail, description) {
  const name = escapeHtml(repo.name);
  const desc = description || "No description provided.";
  const url = repo.html_url;
  const stars = repo.stargazers_count ?? 0;
  const forks = repo.forks_count ?? 0;
  const lang = repo.language ? escapeHtml(repo.language) : null;
  const pushed = repo.pushed_at ? formatDate(repo.pushed_at) : null;

  const thumbSrc = thumbnail || getLocalPlaceholder();
  const safeThumb = escapeHtml(thumbSrc);
  const thumbHtml = `        <a href="${url}"><img src="${safeThumb}" alt="${name}" width="100%" height="120" style="border-radius:6px; height:120px; object-fit:cover; display:block;" /></a>`;

  const metaParts = [];
  if (lang) metaParts.push(`<span>${lang}</span>`);
  metaParts.push(`<span>⭐ ${stars}</span>`);
  if (forks > 0) metaParts.push(`<span>⑂ ${forks}</span>`);
  if (pushed) metaParts.push(`<span>Updated ${escapeHtml(pushed)}</span>`);
  const meta = `<div style="font-size:11px; color:#7a7a7a; margin:6px 0; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${metaParts.join(" · ")}</div>`;

  return `    <td width="33.33%" valign="top" style="padding:8px;">
      <div style="border:1px solid #252525; border-radius:8px; padding:12px; background:#0d1117; height:280px; display:flex; flex-direction:column; justify-content:space-between; box-sizing:border-box;">
        <div>
${thumbHtml}
          <div style="margin-top:8px;"><strong style="font-size:14px;"><a href="${url}" style="text-decoration:none; color:#58a6ff;">${name}</a></strong></div>
          <div style="font-size:12px; color:#c9d1d9; height:36px; overflow:hidden; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; line-height:18px; margin:4px 0;">${desc}</div>
        </div>
        <div>
${meta}          <a href="${url}" style="font-size:12px; color:#8957e5; text-decoration:none;">View Repository →</a>
        </div>
      </div>
    </td>`;
}

async function main() {
  const token = process.env.GITHUB_TOKEN || "";
  try {
    console.log(`[stars] Fetching repositories for ${USER} (starred)...`);
    const allRepos = await fetchAllRepos(token);
    if (!allRepos || allRepos.length === 0) {
      console.error("[stars] No repositories found");
      process.exit(1);
    }
    const top = selectStarredRepos(allRepos);
    console.log(`[stars] Found ${allRepos.length}, selected top ${top.length} by stars: ${top.map((r) => `${r.name} (⭐${r.stargazers_count})`).join(", ")}`);
    top.forEach((r) => console.log(` - ${r.name} (⭐ ${r.stargazers_count}, pushed_at: ${r.pushed_at})`));

    const withThumbs = [];
    for (const repo of top) {
      console.log(`[stars] Checking thumbnail for ${repo.name}...`);
      let thumb = await detectThumbnail(repo, token);
      let finalThumb = getLocalPlaceholder();
      if (thumb) {
        try {
          const res = await fetchWithTimeout(thumb, { method: "HEAD" }, 3000);
          if (res.ok) {
            console.log(`  ✓ Thumbnail: ${thumb}`);
            finalThumb = await ensureLocalThumbnail(thumb, repo.name);
            if (finalThumb !== thumb) console.log(`  → Cached locally: ${finalThumb}`);
          } else {
            console.log(`  ⚠ Not reachable (${res.status}), using placeholder`);
            finalThumb = getLocalPlaceholder();
          }
        } catch {
          console.log(`  ⚠ Check failed, using placeholder`);
          finalThumb = getLocalPlaceholder();
        }
      } else {
        console.log(`  ℹ No thumbnail, using placeholder`);
        finalThumb = getLocalPlaceholder();
      }
      const desc = await getRepoDescription(repo, token).then(escapeHtml);
      withThumbs.push({ repo, thumbnail: finalThumb, description: desc });
    }

    let table = "<!-- This section is generated automatically. Do not edit directly. -->\n";
    table += "## ⭐ Featured by Stars\n\n";
    table += '<table style="width:100%; table-layout:fixed;">\n';
    table += "  <tr>\n";
    for (const item of withThumbs) {
      table += generateCard(item.repo, item.thumbnail, item.description) + "\n";
    }
    table += "  </tr>\n";
    table += "</table>\n";

    await mkdir(path.dirname(outFile), { recursive: true });
    await writeFile(outFile, table, "utf8");
    console.log(`[stars] ✓ Generated ${withThumbs.length} cards → ${path.relative(root, outFile)}`);
    withThumbs.forEach(({ repo, thumbnail }) => {
      console.log(` - ${repo.name}: ⭐ ${repo.stargazers_count}, desc=${repo.description ? "yes" : "no"}, thumb=${thumbnail ? "yes" : "no"} ✓`);
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[stars] Failed:", token ? sanitize(msg, token) : msg);
    process.exit(1);
  }
}

await main();
