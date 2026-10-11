import { describe, it, before } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { sanitize } from "../scripts/lib/github.mjs";
import { ROOT, snapshotFiles, snapshotDir, assertSnapshotsEqual } from "./helpers.mjs";

const GENERATORS = [
  "scripts/generate-project-cards.mjs",
  "scripts/generate-starred-projects.mjs",
  "scripts/generate-project-thumbnails.mjs",
  "scripts/generate-snake.mjs",
  "scripts/build-readme.mjs",
  "scripts/ci.mjs",
];

const OWNED_OUTPUTS = [
  "profile/projects-generated.md",
  "profile/starred-projects-generated.md",
  "README.md",
  "assets/github/github-contribution-grid-snake.svg",
  "assets/github/github-contribution-grid-snake-dark.svg",
];

describe("token safety", () => {
  it("sanitize() redacts the token everywhere without leaking it", () => {
    const fake = "ghp_faketoken1234567890abcdef";
    const msg = `request failed with ${fake} inside url https://x/${fake}`;
    const out = sanitize(msg, fake);
    assert.ok(!out.includes(fake), "token must not appear in sanitized output");
    assert.ok(out.includes("[REDACTED]"), "redaction marker must be present");
    assert.equal(sanitize("clean message", fake), "clean message");
    assert.equal(sanitize("", fake), "");
  });

  it("no generator source contains a hardcoded credential", () => {
    const credential = /(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}/;
    for (const f of [...GENERATORS, "scripts/lib/github.mjs", "scripts/lib/thumbnails.mjs"]) {
      const src = readFileSync(path.join(ROOT, f), "utf8");
      assert.ok(!credential.test(src), `${f} must not contain a hardcoded credential`);
    }
  });
});

describe("generator filesystem boundaries", () => {
  it("no generator runs git mutations (read-only inspection only)", () => {
    const mutation = /git\s+(add|commit|push|reset|checkout(\s+--|\s+\S)|\brm\b|clean|mv)\b/;
    for (const f of GENERATORS) {
      const src = readFileSync(path.join(ROOT, f), "utf8");
      assert.ok(!mutation.test(src), `${f} must not run git mutations`);
    }
  });

  it("only the thumbnail pipeline deletes files, and only same-repo siblings", () => {
    for (const f of GENERATORS) {
      const src = readFileSync(path.join(ROOT, f), "utf8");
      assert.ok(!src.includes("unlink("), `${f} must not delete files directly`);
    }
    const lib = readFileSync(path.join(ROOT, "scripts/lib/thumbnails.mjs"), "utf8");
    assert.ok(lib.includes("removeSiblingThumbnails"), "sibling cleanup must stay centralized");
  });
});

describe("failure behavior (no silent stale writes)", () => {
  let baseline;
  before(() => {
    baseline = {
      files: snapshotFiles(OWNED_OUTPUTS),
      thumbs: snapshotDir("assets/thumbnail"),
    };
  });

  it("missing GITHUB_TOKEN stops the snake run before any write", () => {
    const env = { ...process.env };
    delete env.GITHUB_TOKEN;
    const r = spawnSync("node", ["scripts/generate-snake.mjs"], { cwd: ROOT, env, encoding: "utf8" });
    assert.notEqual(r.status, 0, "must exit non-zero without a token");
    assert.match(r.stderr, /GITHUB_TOKEN is required/);
    assertSnapshotsEqual(baseline.files, snapshotFiles(OWNED_OUTPUTS), "snake outputs");
    assertSnapshotsEqual(baseline.thumbs, snapshotDir("assets/thumbnail"), "thumbnails");
  });

  it("an invalid token fails the projects run without touching any output", () => {
    const r = spawnSync("node", ["scripts/generate-project-cards.mjs"], {
      cwd: ROOT,
      env: { ...process.env, GITHUB_TOKEN: "test-invalid-token-for-regression-000" },
      encoding: "utf8",
    });
    assert.notEqual(r.status, 0, "must exit non-zero on API failure");
    const combined = `${r.stdout || ""}\n${r.stderr || ""}`;
    assert.ok(!combined.includes("test-invalid-token-for-regression-000"), "token must not leak into output");
    assertSnapshotsEqual(baseline.files, snapshotFiles(OWNED_OUTPUTS), "project outputs");
    assertSnapshotsEqual(baseline.thumbs, snapshotDir("assets/thumbnail"), "thumbnails");
  });
});
