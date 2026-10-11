import { readdir } from "node:fs/promises";
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

export function discoverScripts(dir = scriptsDir) {
  return readdir(dir)
    .then((files) =>
      files
        .filter((f) => f.startsWith("generate-") && f.endsWith(".mjs"))
        .filter((f) => f !== "ci.mjs")
        .sort()
    )
    .catch(() => []);
}

// Deterministic pipeline order: generators alphabetically with thumbnails
// first (cards/starred consume its outputs), README builder always last.
export function orderScripts(names) {
  const ordered = names.filter((f) => f !== "build-readme.mjs").sort();
  const thumbIdx = ordered.indexOf("generate-project-thumbnails.mjs");
  if (thumbIdx > 0) {
    const [thumb] = ordered.splice(thumbIdx, 1);
    ordered.unshift(thumb);
  }
  return [...ordered, "build-readme.mjs"];
}

async function main() {
  const token = process.env.GITHUB_TOKEN || "";
  const generators = await discoverScripts();

  // Ensure build-readme runs last, even if it matches generate-*
  const orderedGenerators = orderScripts(generators).filter((f) => f !== "build-readme.mjs");
  const all = [...orderedGenerators, "build-readme.mjs"];

  // Verify build-readme exists
  let hasReadme = false;
  try {
    const files = await readdir(scriptsDir);
    hasReadme = files.includes("build-readme.mjs");
  } catch {}

  if (!hasReadme) {
    console.error("[CI] build-readme.mjs not found");
    process.exit(1);
  }

  console.log(`[CI] Discovered ${orderedGenerators.length} generator(s): ${orderedGenerators.join(", ") || "none"}`);
  console.log(`[CI] Will run build-readme.mjs last`);

  for (const script of all) {
    // Skip if not exists (for build-readme check)
    if (script === "build-readme.mjs" && !hasReadme) continue;
    // For generators, ensure file exists
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
