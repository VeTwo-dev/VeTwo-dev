import { readFile, writeFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "./lib/config.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "..");
const readmeConfig = loadConfig("readme", {
  profileDir: "profile",
  output: "README.md",
  header: "<!-- This file is generated from profile/*.md — do not edit directly. Run `pnpm readme` to regenerate. -->",
  order: [
    "01-hero.md",
    "02-about.md",
    "03-vetwo.md",
    "04-projects.md",
    "05-technologies.md",
    "06-github.md",
    "projects-generated.md",
    "starred-projects-generated.md",
    "07-console.md",
  ],
});
const profileDir = path.join(root, readmeConfig.profileDir || "profile");
const outFile = path.join(root, readmeConfig.output || "README.md");

async function main() {
  try {
    let files;
    try {
      files = await readdir(profileDir);
    } catch (e) {
      console.error(`profile directory not found: ${profileDir}`);
      process.exit(1);
    }

    // Order comes from config/sequence.json (primary) with config/readme.json
    // order as fallback, so reordering sections needs no code change.
    // sequence.json entries carry position + filename number + generated flag.
    const sequenceConfig = loadConfig("sequence", { sequence: [] });
    const ORDER =
      Array.isArray(sequenceConfig.sequence) && sequenceConfig.sequence.length > 0
        ? [...sequenceConfig.sequence]
            .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
            .map((e) => e.file)
        : readmeConfig.order || [];
    const allMd = files.filter((f) => f.endsWith(".md"));
    const mdFiles = [
      ...ORDER.filter((f) => allMd.includes(f)),
      ...allMd
        .filter((f) => !ORDER.includes(f))
        .sort(),
    ];

    if (mdFiles.length === 0) {
      console.error("No Markdown files found in profile/");
      process.exit(1);
    }

    const parts = [];
    for (const file of mdFiles) {
      const full = path.join(profileDir, file);
      const content = await readFile(full, "utf8");
      // Trim trailing whitespace but keep intentional leading/trailing newlines minimal
      parts.push(content.trim());
    }

    // Join with double newline — each source file already contains its own
    // section separators (---) where needed, so no extra separator is injected.
    const body = parts.join("\n\n");

    // Add a lightweight header comment to clarify the source of truth.
    // This does not affect rendering but makes regeneration explicit.
    // Header text comes from config/readme.json.
    const header = `${readmeConfig.header || `<!-- This file is generated from profile/*.md — do not edit directly. Run \`pnpm readme\` to regenerate. -->`}\n\n`;

    const output = header + body + "\n";

    await writeFile(outFile, output, "utf8");

    console.log("README generated from profile/*.md:");
    for (const f of mdFiles) {
      console.log(` - profile/${f}`);
    }
    console.log(`→ ${path.relative(root, outFile)}`);
  } catch (err) {
    console.error("Failed to build README:", err instanceof Error ? err.message : err);
    process.exit(1);
  }
}

await main();
