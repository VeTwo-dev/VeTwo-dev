import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");

// VeTwo brand contract for the Recent Projects section. If the palette or
// header changes intentionally, update config/projects.json AND this test.
const PALETTE = {
  border: "#10B98133",
  background: "#0A0F0D",
  name: "#10B981",
  description: "#ECFDF5",
  meta: "#6EE7B7",
  date: "#4B5563",
  link: "#10B981",
};
const LEGACY_PALETTE = ["#252525", "#58a6ff", "#c9d1d9", "#8957e5"];

describe("recent-projects branding config", () => {
  const projects = JSON.parse(readFileSync(path.join(ROOT, "config", "projects.json"), "utf8"));

  it("card colors match the VeTwo palette", () => {
    assert.deepEqual(projects.card.colors, PALETTE);
  });

  it("recent section uses the centered h2 header", () => {
    const header = projects.recent?.headerHtml || "";
    assert.ok(header.includes("<h2>🚀 Featured Ecosystem Repositories</h2>"), "header must carry the branded h2");
    assert.ok(header.includes('align="center"'), "header must be centered");
  });

  it("recent layout stays 2 columns", () => {
    assert.equal(projects.recent?.columns, 2);
  });
});

describe("recent-projects generated output", () => {
  const generatedPath = path.join(ROOT, "profile", "05-projects-generated.md");
  const generated = readFileSync(generatedPath, "utf8");

  it("opens with the branded header block, not a markdown title", () => {
    assert.ok(
      generated.includes("<div align=\"center\">\n  <h2>🚀 Featured Ecosystem Repositories</h2>\n</div>"),
      "generated file must start with the branded header"
    );
  });

  it("renders one comment per card in order", () => {
    for (const n of [1, 2, 3, 4]) {
      assert.ok(generated.includes(`<!-- Project Card ${n} -->`), `missing comment for card ${n}`);
    }
    const positions = [1, 2, 3, 4].map((n) => generated.indexOf(`<!-- Project Card ${n} -->`));
    assert.deepEqual([...positions].sort((a, b) => a - b), positions, "card comments must be ordered");
  });

  it("uses the VeTwo palette and none of the legacy palette", () => {
    for (const color of Object.values(PALETTE)) {
      assert.ok(generated.includes(color), `generated file must use ${color}`);
    }
    for (const color of LEGACY_PALETTE) {
      assert.ok(!generated.includes(color), `generated file must not use legacy ${color}`);
    }
  });

  it("keeps the max-width 2-column table", () => {
    assert.ok(generated.includes('<table width="100%"'), "table must span max width");
    assert.equal((generated.match(/<td width="50%"/g) || []).length, 4, "must render 4 half-width cells");
  });
});
