import { readFile, writeFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "..");
const profileDir = path.join(root, "profile");
const outFile = path.join(root, "README.md");

async function main() {
  try {
    let files;
    try {
      files = await readdir(profileDir);
    } catch (e) {
      console.error(`profile directory not found: ${profileDir}`);
      process.exit(1);
    }

    const mdFiles = files.filter((f) => f.endsWith(".md")).sort();

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
    const header = `<!-- This file is generated from profile/*.md — do not edit directly. Run \`pnpm readme\` to regenerate. -->\n\n`;

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
