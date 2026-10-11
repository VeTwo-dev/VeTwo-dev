import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveOrder } from "../scripts/build-readme.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");

describe("resolveOrder", () => {
  it("follows pinned positions and appends unknown files alphabetically", () => {
    const all = ["07-console.md", "zzz-extra.md", "01-hero.md", "aaa-extra.md"];
    const order = ["01-hero.md", "07-console.md"];
    assert.deepEqual(resolveOrder(all, order), [
      "01-hero.md",
      "07-console.md",
      "aaa-extra.md",
      "zzz-extra.md",
    ]);
  });

  it("skips pinned files that do not exist", () => {
    assert.deepEqual(resolveOrder(["01-hero.md"], ["01-hero.md", "missing.md"]), ["01-hero.md"]);
  });

  it("handles empty or invalid order input", () => {
    assert.deepEqual(resolveOrder(["b.md", "a.md"], []), ["a.md", "b.md"]);
    assert.deepEqual(resolveOrder(["b.md", "a.md"], null), ["a.md", "b.md"]);
  });
});

describe("config/sequence.json (source of truth for section order)", () => {
  const seqPath = path.join(ROOT, "config", "sequence.json");
  const seq = JSON.parse(readFileSync(seqPath, "utf8")).sequence;

  it("has unique positions covering every profile file exactly once", () => {
    const positions = seq.map((e) => e.position);
    assert.equal(new Set(positions).size, positions.length, "positions must be unique");
    const files = seq.map((e) => e.file);
    assert.equal(new Set(files).size, files.length, "files must be unique");
    for (const e of seq) {
      assert.ok(existsSync(path.join(ROOT, "profile", e.file)), `${e.file} must exist`);
    }
  });

  it("marks generated files and their authoritative generator", () => {
    const generated = seq.filter((e) => e.generated);
    assert.ok(generated.length > 0, "expected at least one generated section");
    for (const e of generated) {
      assert.equal(e.number, null, `${e.file} must carry no filename number`);
      assert.ok(e.generator, `${e.file} must name its generator`);
      assert.ok(
        existsSync(path.join(ROOT, e.generator)),
        `${e.generator} must exist`
      );
    }
  });

  it("matches the README builder fallback order in config/readme.json", () => {
    const readme = JSON.parse(readFileSync(path.join(ROOT, "config", "readme.json"), "utf8"));
    const byPosition = [...seq].sort((a, b) => a.position - b.position).map((e) => e.file);
    assert.deepEqual(byPosition, readme.order);
  });
});
