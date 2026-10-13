import { access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "..");
const scriptsDir = path.join(root, "scripts");

function sanitize(str) {
  const token = process.env.GITHUB_TOKEN || "";
  if (!token || !str) return str;
  if (typeof str !== "string") str = String(str);
  return str.split(token).join("[REDACTED]");
}

// Explicit pipeline: the only scripts `pnpm ci` may execute, in order.
// A retired or experimental generate-*.mjs file sitting in scripts/ is never
// picked up implicitly — it must be added here deliberately to run.
export const PIPELINE_SCRIPTS = [
  "generate-project-cards.mjs",
  "generate-snake.mjs",
  "generate-starred-projects.mjs",
];
const README_SCRIPT = "build-readme.mjs";

async function main() {
  const token = process.env.GITHUB_TOKEN || "";

  // Fail fast when a pipeline script is missing instead of silently skipping.
  const missing = [];
  for (const script of [...PIPELINE_SCRIPTS, README_SCRIPT]) {
    try {
      await access(path.join(scriptsDir, script));
    } catch {
      missing.push(script);
    }
  }
  if (missing.length > 0) {
    console.error(`[CI] Missing pipeline script(s): ${missing.join(", ")}`);
    process.exit(1);
  }
  const all = [...PIPELINE_SCRIPTS, README_SCRIPT];

  console.log(`[CI] Pipeline of ${PIPELINE_SCRIPTS.length} generator(s): ${PIPELINE_SCRIPTS.join(", ")}`);
  console.log(`[CI] Will run ${README_SCRIPT} last`);

  for (const script of all) {
    const full = path.join(scriptsDir, script);
    // Use spawnSync for sequential execution
    console.log(`\n[CI] Running ${script} ...`);
    const result = spawnSync("node", [full], {
      cwd: root,
      stdio: "inherit",
      env: process.env,
    });

    if (result.error) {
      const msg = sanitize(result.error.message, token);
      console.error(`[CI] ✗ ${script} failed to spawn: ${msg}`);
      process.exit(1);
    }

    if (result.status !== 0) {
      console.error(`[CI] ✗ ${script} failed with exit code ${result.status}`);
      process.exit(result.status ?? 1);
    }

    console.log(`[CI] ✓ ${script}`);
  }

  console.log("\n[CI] All profile automation completed successfully.");
}

const isDirectRun = !!process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isDirectRun) await main();
