import { describe, it, before, after } from "node:test";
import { strict as assert } from "node:assert";
import { mkdtemp, mkdir, writeFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  normalizeRepoName,
  getLocalThumbnailPath,
  getPlaceholderPath,
  isSharedPlaceholder,
  resolveLocalThumbnail,
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

  it("neutralizes path traversal segments", () => {
    assert.equal(normalizeRepoName("../../etc/passwd"), "etc-passwd");
    assert.equal(normalizeRepoName("..\\..\\x"), "x");
    assert.equal(normalizeRepoName(""), "");
    assert.equal(normalizeRepoName(null), "");
  });
});

describe("getLocalThumbnailPath", () => {
  it("is deterministic per repo and extension", () => {
    assert.equal(getLocalThumbnailPath("Cli", "svg"), "./assets/thumbnail/cli.svg");
    assert.equal(getLocalThumbnailPath("Cli", "png"), "./assets/thumbnail/cli.png");
    assert.equal(getLocalThumbnailPath("Cli", "svg"), getLocalThumbnailPath("Cli", "svg"));
  });
});

describe("isSharedPlaceholder", () => {
  it("distinguishes the shared placeholder from real local thumbnails", () => {
    assert.equal(isSharedPlaceholder("./assets/thumbnail/placeholder.svg"), true);
    assert.equal(isSharedPlaceholder("./assets/thumbnail/cli.svg"), false);
    assert.equal(isSharedPlaceholder(""), false);
  });
});

describe("resolveLocalThumbnail (local assets only)", () => {
  let tmp;
  let thumbDir;
  before(async () => {
    tmp = await mkdtemp(path.join(os.tmpdir(), "vetwo-thumbs-"));
    thumbDir = path.join(tmp, "assets", "thumbnail");
    await mkdir(thumbDir, { recursive: true });
    // Real local assets a project would commit by hand.
    await writeFile(path.join(thumbDir, "cli.svg"), "<svg></svg>", "utf8");
    await writeFile(path.join(thumbDir, "units.png"), "png-bytes", "utf8");
    await writeFile(path.join(thumbDir, "units.svg"), "<svg>stale?</svg>", "utf8");
    await writeFile(path.join(thumbDir, "notes.txt"), "not an image", "utf8");
    await mkdir(path.join(thumbDir, "docs.svg"));
  });
  after(async () => {
    await rm(tmp, { recursive: true, force: true });
  });

  const opts = () => ({ rootDir: tmp });

  it("uses the exact local asset for a project that has one", async () => {
    const r = await resolveLocalThumbnail("Cli", opts());
    assert.equal(r.url, "./assets/thumbnail/cli.svg");
    assert.equal(r.kind, "local");
  });

  it("selects deterministically when several files match (ext priority, then name)", async () => {
    const r = await resolveLocalThumbnail("units", opts());
    assert.equal(r.url, "./assets/thumbnail/units.svg");
    assert.equal(r.kind, "local");
  });

  it("resolves every missing project to the exact same shared placeholder", async () => {
    const a = await resolveLocalThumbnail("no-such-project", opts());
    const b = await resolveLocalThumbnail("another-missing-one", opts());
    assert.equal(a.url, "./assets/thumbnail/placeholder.svg");
    assert.equal(b.url, "./assets/thumbnail/placeholder.svg");
    assert.equal(a.kind, "placeholder");
    assert.equal(b.kind, "placeholder");
    assert.ok(isSharedPlaceholder(a.url));
  });

  it("ignores unsupported files and directories that look like images", async () => {
    const r = await resolveLocalThumbnail("notes", opts());
    assert.equal(r.kind, "placeholder");
    const d = await resolveLocalThumbnail("docs", opts());
    assert.equal(d.kind, "placeholder");
  });

  it("treats a missing thumbnail directory as no thumbnail, not an error", async () => {
    const empty = await mkdtemp(path.join(os.tmpdir(), "vetwo-empty-"));
    try {
      const r = await resolveLocalThumbnail("anything", { rootDir: empty });
      assert.equal(r.kind, "placeholder");
      assert.equal(r.url, "./assets/thumbnail/placeholder.svg");
    } finally {
      await rm(empty, { recursive: true, force: true });
    }
  });

  it("rejects paths escaping the thumbnail root", async () => {
    for (const evil of ["../../etc/passwd", "..\\..\\x", "/abs/path", ""]) {
      const r = await resolveLocalThumbnail(evil, opts());
      assert.ok(!r.url.includes(".."), `must not escape root for ${JSON.stringify(evil)}`);
      assert.ok(
        r.url === "./assets/thumbnail/placeholder.svg" || r.url.startsWith("./assets/thumbnail/"),
        `must stay inside thumbnail dir for ${JSON.stringify(evil)}`
      );
    }
  });

  it("makes no network requests", async () => {
    const realFetch = globalThis.fetch;
    globalThis.fetch = () => {
      throw new Error("network must not be used by thumbnail resolution");
    };
    try {
      const r = await resolveLocalThumbnail("cli", opts());
      assert.equal(r.kind, "local");
      const m = await resolveLocalThumbnail("missing-here", opts());
      assert.equal(m.kind, "placeholder");
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it("writes no files while resolving", async () => {
    const list = async () => (await readdir(thumbDir)).sort();
    const before = await list();
    await resolveLocalThumbnail("cli", opts());
    await resolveLocalThumbnail("missing-here", opts());
    await resolveLocalThumbnail("../../etc/passwd", opts());
    assert.deepEqual(await list(), before);
  });
});
