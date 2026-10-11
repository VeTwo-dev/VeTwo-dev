import { describe, it, before } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { ROOT, sha256File, snapshotFiles, assertSnapshotsEqual } from "./helpers.mjs";

const HAND_WRITTEN_PROFILE = [
  "profile/01-hero.md",
  "profile/02-about.md",
  "profile/03-vetwo.md",
  "profile/04-projects.md",
  "profile/05-technologies.md",
  "profile/06-github.md",
  "profile/07-console.md",
];

function runReadme() {
  const r = spawnSync("node", ["scripts/build-readme.mjs"], { cwd: ROOT, encoding: "utf8" });
  assert.equal(r.status, 0, `build-readme must succeed, stderr: ${r.stderr}`);
}

describe("README builder determinism", () => {
  it("two consecutive runs produce byte-identical README.md", () => {
    runReadme();
    const first = sha256File("README.md");
    runReadme();
    assert.equal(sha256File("README.md"), first, "README must be deterministic");
  });

  it("hand-written profile sections are never modified by the build", () => {
    const before = snapshotFiles(HAND_WRITTEN_PROFILE);
    runReadme();
    assertSnapshotsEqual(before, snapshotFiles(HAND_WRITTEN_PROFILE), "hand-written sections");
  });

  it("generated sections carry the do-not-edit marker", () => {
    for (const f of ["profile/projects-generated.md", "profile/starred-projects-generated.md"]) {
      const content = readFileSync(path.join(ROOT, f), "utf8");
      assert.ok(
        content.includes("generated automatically"),
        `${f} must identify itself as generated`
      );
    }
  });

  it("README section order follows config/sequence.json", () => {
    const readme = readFileSync(path.join(ROOT, "README.md"), "utf8");
    const markers = [
      ["01-hero.md", "Ahmed Kamal"],
      ["projects-generated.md", "## Recent Projects"],
      ["starred-projects-generated.md", "## ⭐ Featured by Stars"],
      ["07-console.md", "./welcome.sh"],
    ];
    let lastIndex = -1;
    for (const [file, marker] of markers) {
      const idx = readme.indexOf(marker);
      assert.ok(idx > lastIndex, `${file} marker must appear in sequence order`);
      lastIndex = idx;
    }
  });
});
