import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "..");

function run(cmd, opts = {}) {
  console.log(`\n$ ${cmd}`);
  execSync(cmd, { cwd: root, stdio: "inherit", ...opts });
}

function runSafe(cmd) {
  try {
    run(cmd);
    return true;
  } catch (e) {
    return false;
  }
}

async function main() {
  const hasToken = !!process.env.GITHUB_TOKEN;
  console.log("🚀 CI pipeline: generate → commit → push\n");

  // 1. Snake (requires token)
  if (hasToken) {
    console.log("▶ Generating snake (VeTwo-dev, purple #8957e5) ...");
    try {
      run("node scripts/generate-snake.mjs");
    } catch {
      console.error("❌ Snake generation failed. Aborting CI.");
      process.exit(1);
    }
  } else {
    console.warn("⚠️ GITHUB_TOKEN not set — skipping snake generation");
    console.warn("   Set GITHUB_TOKEN to regenerate assets/github/*.svg");
  }

  // 2. README (always)
  console.log("\n▶ Building README from profile/*.md ...");
  try {
    run("node scripts/build-readme.mjs");
  } catch {
    console.error("❌ README build failed.");
    process.exit(1);
  }

  // 2.5 Clear GitHub Actions cache (so gitascii is fresh on next push)
  if (hasToken) {
    console.log("\n▶ Clearing GitHub Actions cache (gitascii) ...");
    try {
      // Use gh CLI if available, fallback to API via curl
      try {
        execSync('gh cache list --json key,id 2>/dev/null | jq -r \'.[].id\' | while read -r id; do [ -n "$id" ] && gh cache delete "$id" --confirm 2>/dev/null || true; done', {
          cwd: root,
          stdio: "inherit",
          env: { ...process.env, GH_TOKEN: process.env.GITHUB_TOKEN },
        });
        console.log("✓ Cache clear attempted via gh CLI");
      } catch {
        // Fallback via GitHub API
        const apiCmd = `curl -s -H "Authorization: token $GITHUB_TOKEN" -H "Accept: application/vnd.github+json" "https://api.github.com/repos/VeTwo-dev/VeTwo-dev/actions/caches" | jq -r '.actions_caches[].id' | while read -r id; do [ -n "$id" ] && curl -s -X DELETE -H "Authorization: token $GITHUB_TOKEN" "https://api.github.com/repos/VeTwo-dev/VeTwo-dev/actions/caches/$id" >/dev/null || true; done`;
        execSync(apiCmd, { cwd: root, stdio: "inherit", shell: "/bin/bash" });
        console.log("✓ Cache clear attempted via API");
      }
    } catch (e) {
      console.warn("⚠️ Cache clear failed (continuing):", e instanceof Error ? e.message : e);
    }
  } else {
    console.log("\nℹ Skipping cache clear (no GITHUB_TOKEN)");
  }

  // 3. Git add / commit / push
  console.log("\n▶ Checking git status ...");
  try {
    const status = execSync("git status --porcelain", { cwd: root, encoding: "utf8" });
    if (!status.trim()) {
      console.log("✓ No changes to commit.");
      return;
    }
    console.log(status.trim());

    console.log("\n▶ Staging changes ...");
    run("git add -A");

    const cached = execSync("git diff --cached --name-only", { cwd: root, encoding: "utf8" }).trim();
    if (!cached) {
      console.log("✓ Nothing staged.");
      return;
    }
    console.log("Staged:\n" + cached.split("\n").map((f) => ` - ${f}`).join("\n"));

    // Commit if there is something to commit
    const diffCached = execSync("git diff --cached --quiet; echo $?", { cwd: root, encoding: "utf8", shell: "/bin/bash" }).trim();
    // Actually simpler: try commit, if no changes git will error; we handle
    const msg = process.argv[2] || "chore: update profile (snake + readme)";
    console.log(`\n▶ Committing: "${msg}" ...`);
    try {
      execSync(`git commit -m "${msg.replace(/"/g, '\\"')}"`, { cwd: root, stdio: "inherit" });
    } catch {
      console.log("ℹ No new commit (maybe already committed).");
    }

    console.log("\n▶ Pushing to origin ...");
    run("git push");
    console.log("\n✅ CI pipeline complete. Snake + README pushed.");
  } catch (e) {
    console.error("❌ Git step failed:", e instanceof Error ? e.message : e);
    process.exit(1);
  }
}

await main();
