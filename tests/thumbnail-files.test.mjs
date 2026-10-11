import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import {
  normalizeRepoName,
  staleSiblingsFor,
  getLocalThumbnailPath,
} from "../scripts/lib/thumbnails.mjs";

describe("normalizeRepoName", () => {
  it("is deterministic and filesystem-safe", () => {
    assert.equal(normalizeRepoName("VeTwo-dev"), "vetwo-dev");
    assert.equal(normalizeRepoName("Feed-Formulation"), "feed-formulation");
    assert.equal(normalizeRepoName("  Weird  Name__Here  "), "weird-name-here");
    assert.equal(normalizeRepoName("a"), "a");
  });

  it("maps case variants to the same basename (single file per repo)", () => {
    assert.equal(normalizeRepoName("Cli"), normalizeRepoName("cli"));
    assert.equal(normalizeRepoName("Units-manager"), normalizeRepoName("UNITS-MANAGER"));
  });
});

describe("getLocalThumbnailPath", () => {
  it("is deterministic per repo and extension", () => {
    assert.equal(getLocalThumbnailPath("Cli", "svg"), "./assets/thumbnail/cli.svg");
    assert.equal(getLocalThumbnailPath("Cli", "png"), "./assets/thumbnail/cli.png");
    assert.equal(getLocalThumbnailPath("Cli", "svg"), getLocalThumbnailPath("Cli", "svg"));
  });
});

describe("staleSiblingsFor (single-file-per-repo invariant)", () => {
  it("lists same-basename images with other extensions for removal", () => {
    const out = staleSiblingsFor(["units.svg", "units.png", "other.svg", "README.md"], "units", "units.png");
    assert.deepEqual(out, ["units.svg"]);
  });

  it("matches case-insensitively so pre-normalization files are cleaned", () => {
    const out = staleSiblingsFor(["cli.svg", "Cli.png", "CLI.JPG"], "Cli", "cli.svg");
    assert.deepEqual(out.sort(), ["Cli.png", "CLI.JPG"].sort());
  });

  it("never lists the file being kept", () => {
    assert.deepEqual(staleSiblingsFor(["a.svg"], "a", "a.svg"), []);
    assert.deepEqual(staleSiblingsFor(["A.SVG"], "a", "a.svg"), []);
  });

  it("ignores non-images, dotfiles and unrelated names", () => {
    const out = staleSiblingsFor(
      ["units.json", ".units.svg", "units", "my-units.svg", "units-backup.svg", "placeholder.svg"],
      "units",
      "units.png"
    );
    assert.deepEqual(out, []);
  });

  it("handles empty or invalid input without throwing", () => {
    assert.deepEqual(staleSiblingsFor([], "x", "x.svg"), []);
    assert.deepEqual(staleSiblingsFor(null, "x", "x.svg"), []);
    assert.deepEqual(staleSiblingsFor(["units.svg", 42, null], "units", "other.png"), ["units.svg"]);
  });
});
