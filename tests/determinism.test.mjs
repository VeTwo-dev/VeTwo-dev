import { describe, it, before } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { ROOT, sha256File, snapshotFiles, assertSnapshotsEqual, withReadmeLock } from "./helpers.mjs";

const HAND_WRITTEN_PROFILE = [
  "profile/01-hero.md",
  "profile/02-about.md",
  "profile/03-github.md",
  "profile/04-technologies.md",
  "profile/07-footer.md",
];

async function runReadme() {
  // Serialized across test processes: concurrent README writes can interleave.
  await withReadmeLock(async () => {
    const r = spawnSync("node", ["scripts/build-readme.mjs"], { cwd: ROOT, encoding: "utf8" });
    assert.equal(r.status, 0, `build-readme must succeed, stderr: ${r.stderr}`);
  });
}

describe("README builder determinism", () => {
  it("two consecutive runs produce byte-identical README.md", async () => {
    await runReadme();
    const first = await withReadmeLock(async () => sha256File("README.md"));
    await runReadme();
    const second = await withReadmeLock(async () => sha256File("README.md"));
    assert.equal(second, first, "README must be deterministic");
  });

  it("hand-written profile sections are never modified by the build", async () => {
    const before = snapshotFiles(HAND_WRITTEN_PROFILE);
    await runReadme();
    assertSnapshotsEqual(before, snapshotFiles(HAND_WRITTEN_PROFILE), "hand-written sections");
  });

  it("generated sections carry the do-not-edit marker", () => {
    for (const f of ["profile/05-projects-generated.md", "profile/06-starred-projects-generated.md"]) {
      const content = readFileSync(path.join(ROOT, f), "utf8");
      assert.ok(
        content.includes("generated automatically"),
        `${f} must identify itself as generated`
      );
    }
  });

  it("README section order follows config/sequence.json", async () => {
    // Order is verified with full file contents, not heading strings, so
    // rewriting a section's wording can never break this test.
    await withReadmeLock(async () => {
      const sequence = JSON.parse(readFileSync(path.join(ROOT, "config", "sequence.json"), "utf8")).sequence;
      const files = [...sequence]
        .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
        .map((e) => e.file);
    const readme = readFileSync(path.join(ROOT, "README.md"), "utf8");
    let lastIndex = -1;
    for (const file of files) {
      const content = readFileSync(path.join(ROOT, "profile", file), "utf8").trim();
      // Empty scaffolding files (e.g. a footer being drafted) contribute
      // nothing and are skipped: only ordered, non-empty sections are checked.
      if (content.length === 0) continue;
      const idx = readme.indexOf(content);
      assert.ok(idx > lastIndex, `${file} must appear in sequence order in README.md`);
      lastIndex = idx;
    }
    });
  });
});
