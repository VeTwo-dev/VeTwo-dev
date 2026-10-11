import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  USER,
  sanitize,
  fetchAllRepos,
  escapeHtml,
  formatDate,
  getRepoDescription,
  selectRepos,
} from "./lib/github.mjs";
import { resolveCardThumbnail, getPlaceholderPath as getLocalPlaceholder } from "./lib/thumbnails.mjs";
import { loadConfig } from "./lib/config.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "..");
const projectsConfig = loadConfig("projects", {
  recent: { count: 4, output: "profile/projects-generated.md", title: "Recent Projects", columns: 2, showTopics: 3 },
  card: {
    heightPx: 280,
    thumbnailHeightPx: 120,
    descriptionLines: 2,
    descriptionLineHeightPx: 18,
    colors: { border: "#252525", background: "#0d1117", name: "#58a6ff", description: "#c9d1d9", meta: "#7a7a7a", date: "#484f58", link: "#8957e5" },
    linkText: "View Repository →",
    dateIcon: "🕓",
  },
});
const profileConfig = loadConfig("profile", {
  filter: { excludeForks: true, excludeArchived: true, excludePrivate: true, fallbackToPublic: true, fallbackToAll: true },
});
const outFile = path.join(root, projectsConfig.recent?.output || "profile/projects-generated.md");
const COUNT = projectsConfig.recent?.count || 4;

function selectLatestRepos(repos) {
  return selectRepos(repos, {
    count: COUNT,
    sortBy: "pushed",
    username: USER,
    excludeProfile: profileConfig.excludeProfileRepo !== false,
    filter: profileConfig.filter || {},
  });
}

async function getDescriptionWithFallback(repo, token) {
  const desc = await getRepoDescription(repo, token);
  return escapeHtml(desc);
}

function generateCard(repo, thumbnail, description, colWidth) {
  const card = projectsConfig.card || {};
  const widthAttr = colWidth || "50%";
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
  const showTopics = projectsConfig.recent?.showTopics ?? 3;

  const name = escapeHtml(repo.name);
  const desc = description || projectsConfig.card?.fallbackDescription || "No description provided.";
  const url = repo.html_url;
  const lang = repo.language ? escapeHtml(repo.language) : null;
  const topics = Array.isArray(repo.topics) && repo.topics.length > 0 ? repo.topics.slice(0, showTopics) : [];
  const pushed = repo.pushed_at ? formatDate(repo.pushed_at) : null;

  const thumbSrc = thumbnail || getLocalPlaceholder();
  const safeThumb = escapeHtml(thumbSrc);
  const thumbHtml = `        <a href="${url}"><img src="${safeThumb}" alt="${name}" width="100%" height="${thumbPx}" style="border-radius:6px; height:${thumbPx}px; object-fit:cover; display:block;" /></a>`;

  const langTopicParts = [];
  if (lang) langTopicParts.push(`<span>${lang}</span>`);
  if (topics.length > 0) langTopicParts.push(`<span>${topics.map((t) => escapeHtml(t)).join(" · ")}</span>`);
  const langTopicHtml = langTopicParts.length ? `<div style="font-size:11px; color:${metaColor}; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${langTopicParts.join(" · ")}</div>` : "";
  const dateHtml = pushed ? `<div style="font-size:10px; color:${dateColor}; margin-top:2px;">${dateIcon} ${escapeHtml(pushed)}</div>` : "";
  const descHeight = descLines * descLineHeight;

  return `    <td width="${widthAttr}" valign="top" style="padding:8px;">
      <div style="border:1px solid ${border}; border-radius:8px; padding:12px; background:${background}; height:${heightPx}px; width:100%; display:flex; flex-direction:column; justify-content:space-between; box-sizing:border-box;">
        <div>
${thumbHtml}
          <div style="margin-top:8px;"><strong style="font-size:14px;"><a href="${url}" style="text-decoration:none; color:${nameColor};">${name}</a></strong></div>
          <div style="font-size:12px; color:${descColor}; height:${descHeight}px; overflow:hidden; display:-webkit-box; -webkit-line-clamp:${descLines}; -webkit-box-orient:vertical; line-height:${descLineHeight}px; margin:4px 0;">${desc}</div>
        </div>
        <div>
          ${langTopicHtml}
          ${dateHtml}
          <a href="${url}" style="font-size:12px; color:${linkColor}; text-decoration:none; display:inline-block; margin-top:4px;">${linkText}</a>
        </div>
      </div>
    </td>`;
}

async function main() {
  const token = process.env.GITHUB_TOKEN || "";
  try {
    console.log(`[projects] Fetching repositories for ${USER}...`);
    const allRepos = await fetchAllRepos(token);
    if (!allRepos || allRepos.length === 0) {
      console.error("[projects] No repositories found");
      process.exit(1);
    }
    const latest = selectLatestRepos(allRepos);
    console.log(`[projects] Found ${allRepos.length}, selected ${latest.length}: ${latest.map((r) => r.name).join(", ")}`);
    latest.forEach((r) => console.log(` - ${r.name} (pushed_at: ${r.pushed_at})`));

    const withThumbs = [];
    for (const repo of latest) {
      // Each card fetches its own repo assets/thumbnail/ (or keeps the default)
      const finalThumb = await resolveCardThumbnail(repo, token, (msg) =>
        console.log(`[projects] ${msg}`)
      );
      const desc = await getDescriptionWithFallback(repo, token);
      withThumbs.push({ repo, thumbnail: finalThumb, description: desc });
    }

    const title = projectsConfig.recent?.title || "Recent Projects";
    const columns = Math.max(1, projectsConfig.recent?.columns || 2);
    const colWidth = `${parseFloat((100 / columns).toFixed(2))}%`;
    let table = "<!-- This section is generated automatically. Do not edit directly. -->\n";
    table += `## ${title}\n\n`;
    table += '<table width="100%" cellspacing="0" cellpadding="0" style="width:100%; max-width:100%; table-layout:fixed; border-collapse:collapse;">\n';
    for (let i = 0; i < withThumbs.length; i += columns) {
      table += "  <tr>\n";
      for (let j = 0; j < columns; j++) {
        const item = withThumbs[i + j];
        if (item) table += generateCard(item.repo, item.thumbnail, item.description, colWidth) + "\n";
        else table += `    <td width="${colWidth}" valign="top" style="padding:8px;"></td>\n`;
      }
      table += "  </tr>\n";
    }
    table += "</table>\n";

    await mkdir(path.dirname(outFile), { recursive: true });
    await writeFile(outFile, table, "utf8");
    console.log(`[projects] ✓ Generated ${withThumbs.length} cards → ${path.relative(root, outFile)}`);
    withThumbs.forEach(({ repo, thumbnail }) => {
      console.log(` - ${repo.name}: desc=${repo.description ? "yes" : "no"}, thumb=${thumbnail ? "yes" : "no"} ✓`);
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[projects] Failed:", token ? sanitize(msg, token) : msg);
    process.exit(1);
  }
}

await main();
