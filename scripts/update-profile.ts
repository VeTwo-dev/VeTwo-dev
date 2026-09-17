#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { profileConfig } from "../profile/config/profile.js";
import { collectProfileData } from "../profile/generator/collect.js";
import { selectFeatured, categorizeEcosystem } from "../profile/generator/select.js";
import {
  renderActivity,
  renderEcosystem,
  renderFeatured,
  renderLanguages,
  renderStats,
} from "../profile/generator/render.js";
import { validateGeneratedMarkdown } from "../profile/generator/validate.js";
import { patchMarkers, verifyMarkersPresent } from "../profile/generator/patch.js";

const README_PATH = resolve(process.cwd(), "README.md");
const CHECK_MODE = process.argv.includes("--check");

async function main(): Promise<void> {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    console.warn("⚠ No GITHUB_TOKEN set — proceeding unauthenticated (60 requests/hour limit).");
  }

  console.log(`Collecting live GitHub data for ${profileConfig.githubUsername}…`);
  const dataset = await collectProfileData({ token });

  const featured = selectFeatured(
    dataset.repos,
    { featuredRepositories: profileConfig.featuredRepositories, maxFeatured: profileConfig.maxFeatured },
    profileConfig.excludeFromAuto,
  );
  const ecosystem = categorizeEcosystem(
    dataset.repos,
    profileConfig.ecosystemCategories,
    profileConfig.excludeFromAuto,
  );

  const sections: Record<string, string> = {
    STATS: renderStats(dataset.user, dataset.repos),
    LANGUAGES: renderLanguages(dataset.repos),
    FEATURED: renderFeatured(featured),
    ECOSYSTEM: renderEcosystem(ecosystem),
    ACTIVITY: renderActivity(dataset.repos),
  };

  for (const [name, markdown] of Object.entries(sections)) {
    validateGeneratedMarkdown(name, markdown);
  }

  const existingReadme = await readFile(README_PATH, "utf-8");
  const presence = verifyMarkersPresent(existingReadme, Object.keys(sections));
  if (!presence.ok) {
    throw new Error(
      `README is missing required marker(s): ${presence.missing.join(", ")}. Refusing to patch — README left untouched.`,
    );
  }

  const result = patchMarkers(existingReadme, sections);

  if (!result.changed) {
    console.log("✓ README already up to date — no changes.");
    return;
  }

  if (CHECK_MODE) {
    console.log(`README would change (markers: ${result.patchedMarkers.join(", ")}). Run without --check to apply.`);
    process.exitCode = 1;
    return;
  }

  await writeFile(README_PATH, result.content, "utf-8");
  console.log(`✓ README updated (markers: ${result.patchedMarkers.join(", ")}).`);
}

main().catch((err) => {
  // Fail loudly, but never touch README.md on failure — the previous
  // valid file (already on disk / in git) is preserved automatically
  // since we only write after every validation step above succeeds.
  console.error("✗ Profile update failed:", err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
