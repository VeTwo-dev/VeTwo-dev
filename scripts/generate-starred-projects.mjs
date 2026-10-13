import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  USER,
  sanitize,
  fetchAllRepos,
  escapeHtml,
  formatDate,
  getRepoDescription,
  selectRepos,
} from "./lib/github.mjs";
import { resolveLocalThumbnail, getPlaceholderPath as getLocalPlaceholder } from "./lib/thumbnails.mjs";
import { loadConfig } from "./lib/config.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "..");
const projectsConfig = loadConfig("projects", {
  starred: { count: 3, output: "profile/06-starred-projects-generated.md", title: "⭐ Featured Repositories", headerHtml: "<div align=\"center\">\n  <h2>⭐ Featured Repositories</h2>\n</div>" },
  card: {
    heightPx: 280,
    thumbnailHeightPx: 120,
    descriptionLines: 2,
    descriptionLineHeightPx: 18,
    colors: { border: "#10B98133", background: "#0A0F0D", name: "#10B981", description: "#ECFDF5", meta: "#6EE7B7", date: "#4B5563", link: "#10B981" },
    linkText: "View Repository →",
    dateIcon: "🕓",
  },
});
const profileConfig = loadConfig("profile", {
  filter: { excludeForks: true, excludeArchived: true, excludePrivate: true, fallbackToPublic: true, fallbackToAll: true },
});
const outFile = path.join(root, projectsConfig.starred?.output || "profile/06-starred-projects-generated.md");
const COUNT = projectsConfig.starred?.count || 3;

function selectStarredRepos(repos) {
  return selectRepos(repos, {
    count: COUNT,
    sortBy: "stars",
    username: USER,
    excludeProfile: profileConfig.excludeProfileRepo !== false,
    filter: profileConfig.filter || {},
  });
}

async function getDescriptionWithFallback(repo, token) {
  const desc = await getRepoDescription(repo, token);
  return escapeHtml(desc);
}

export function generateCard(repo, thumbnail, description) {
  const card = projectsConfig.card || {};
  const colors = card.colors || {};
  const border = colors.border || "#252525";
  const background = colors.background || "#0d1117";
  const nameColor = colors.name || "#58a6ff";
  const descColor = colors.description || "#c9d1d9";
  const metaColor = colors.meta || "#7a7a7a";
  const dateColor = colors.date || "#484f58";
  const linkColor = colors.link || "#8957e5";
  const heightPx = card.heightPx || 280;
  const thumbPx = card.thumbnailHeightPx || 120;
  const descLines = card.descriptionLines || 2;
  const descLineHeight = card.descriptionLineHeightPx || 18;
  const linkText = card.linkText || "View Repository →";
  const dateIcon = card.dateIcon || "🕓";
  const showStars = projectsConfig.starred?.showStars !== false;
  const showForks = projectsConfig.starred?.showForks !== false;

  const name = escapeHtml(repo.name);
  const desc = description || card.fallbackDescription || "No description provided.";
  const url = repo.html_url;
  const stars = repo.stargazers_count ?? 0;
  const forks = repo.forks_count ?? 0;
  const lang = repo.language ? escapeHtml(repo.language) : null;
  const pushed = repo.pushed_at ? formatDate(repo.pushed_at) : null;

  const thumbSrc = thumbnail || getLocalPlaceholder();
  const safeThumb = escapeHtml(thumbSrc);
  const thumbHtml = `        <a href="${url}"><img src="${safeThumb}" alt="${name}" width="100%" height="${thumbPx}" style="border-radius:6px; height:${thumbPx}px; object-fit:cover; display:block;" /></a>`;

  const langStarsParts = [];
  if (lang) langStarsParts.push(`<span>${lang}</span>`);
  if (showStars) langStarsParts.push(`<span>⭐ ${stars}</span>`);
  if (showForks && forks > 0) langStarsParts.push(`<span>⑂ ${forks}</span>`);
  const langStarsHtml = langStarsParts.length ? `<div style="font-size:11px; color:${metaColor}; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${langStarsParts.join(" · ")}</div>` : "";
  const dateHtml = pushed ? `<div style="font-size:10px; color:${dateColor}; margin-top:2px;">${dateIcon} ${escapeHtml(pushed)}</div>` : "";
  const descHeight = descLines * descLineHeight;
  // Same guard as the recent cards: never emit a whitespace-only or empty
  // line inside the table (see generate-project-cards.mjs).
  const metaLines = [langStarsHtml, dateHtml].filter((s) => typeof s === "string" && s.trim() !== "");
  const actionLine = `          <a href="${url}" style="font-size:12px; color:${linkColor}; font-weight:600; text-decoration:none; display:inline-block; margin-top:6px;">${linkText}</a>`;

  return `    <td width="33.33%" valign="top" style="padding:6px;">
      <div style="border:1px solid ${border}; border-radius:8px; padding:12px; background:${background}; height:${heightPx}px; width:100%; display:flex; flex-direction:column; justify-content:space-between; box-sizing:border-box;">
        <div>
${thumbHtml}
          <div style="margin-top:10px;">
            <strong style="font-size:14px;">
              <a href="${url}" style="text-decoration:none; color:${nameColor};">${name}</a>
            </strong>
          </div>
          <div style="font-size:12px; color:${descColor}; height:${descHeight}px; overflow:hidden; display:-webkit-box; -webkit-line-clamp:${descLines}; -webkit-box-orient:vertical; line-height:${descLineHeight}px; margin:6px 0;">${desc}</div>
        </div>
        <div>
${[...metaLines.map((s) => `          ${s}`), actionLine].join("\n")}
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
      // Same local-only resolution as recent cards (see above).
      const resolved = await resolveLocalThumbnail(repo.name);
      const finalThumb = resolved.url;
      console.log(`[stars] thumbnail for ${repo.name}: ${finalThumb} (${resolved.kind})`);
      const desc = await getRepoDescription(repo, token).then(escapeHtml);
      withThumbs.push({ repo, thumbnail: finalThumb, description: desc });
    }

    const title = projectsConfig.starred?.title || "⭐ Featured Repositories";
    const headerHtml = projectsConfig.starred?.headerHtml;
    let table = "<!-- This section is generated automatically. Do not edit directly. -->\n";
    table += headerHtml ? `${headerHtml}\n\n` : `## ${title}\n\n`;
    table += '<table width="100%" cellspacing="0" cellpadding="0" style="width:100%; border-collapse:collapse; table-layout:fixed;">\n';
    table += "  <tr>\n";
    let cardNumber = 0;
    for (const item of withThumbs) {
      cardNumber += 1;
      table += `    <!-- Starred Project Card ${cardNumber} -->\n`;
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

const isDirectRun = !!process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isDirectRun) await main();
