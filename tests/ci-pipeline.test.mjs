import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PIPELINE_SCRIPTS } from "../scripts/ci.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");

describe("ci pipeline allowlist", () => {
  it("runs exactly the documented generators plus the README builder", () => {
    assert.deepEqual(PIPELINE_SCRIPTS, [
      "generate-project-cards.mjs",
      "generate-snake.mjs",
      "generate-starred-projects.mjs",
    ]);
  });

  it("never includes the retired thumbnail generator", () => {
    assert.ok(!PIPELINE_SCRIPTS.includes("generate-project-thumbnails.mjs"));
    assert.ok(!existsSync(path.join(ROOT, "scripts", "generate-project-thumbnails.mjs")));
  });

  it("every allowlisted script exists on disk", () => {
    for (const script of [...PIPELINE_SCRIPTS, "build-readme.mjs"]) {
      assert.ok(existsSync(path.join(ROOT, "scripts", script)), `${script} must exist`);
    }
  });

  it("uses no implicit generate-*.mjs discovery", () => {
    const src = readFileSync(path.join(ROOT, "scripts", "ci.mjs"), "utf8");
    assert.ok(!src.includes("discoverScripts"), "ci must not auto-discover scripts");
    assert.ok(!src.includes('startsWith("generate-")'), "ci must not match scripts by prefix");
  });

  it("package.json exposes no thumbnail-generation command", () => {
    const pkg = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8"));
    assert.ok(!("thumbnails" in (pkg.scripts || {})), "retired thumbnails script must be gone");
    for (const name of ["projects", "stars", "readme", "ready", "ci"]) {
      assert.ok(name in (pkg.scripts || {}), `package script ${name} must be preserved`);
    }
  });
});
