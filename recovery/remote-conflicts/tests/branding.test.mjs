import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");

// VeTwo brand contract for the project cards. The shared block styles the
// starred section; the recent section merges its own override on top. If the
// palette changes intentionally, update config/projects.json AND this test.
const SHARED_PALETTE = {
  border: "#10B98133",
  background: "#0A0F0D",
  name: "#10B981",
  description: "#ECFDF5",
  meta: "#6EE7B7",
  date: "#4B5563",
  link: "#10B981",
};
const RECENT_OVERRIDE = {
  background: "#0D1511",
  border: "#121A16",
  meta: "#A7B8AF",
  date: "#6EE7B7",
};
const RECENT_PALETTE = { ...SHARED_PALETTE, ...RECENT_OVERRIDE };
const LEGACY_PALETTE = ["#252525", "#58a6ff", "#c9d1d9", "#8957e5"];

describe("recent-projects branding config", () => {
  const projects = JSON.parse(readFileSync(path.join(ROOT, "config", "projects.json"), "utf8"));

  it("shared card colors stay on the VeTwo palette", () => {
    assert.deepEqual(projects.card.colors, SHARED_PALETTE);
  });

  it("recent override carries the premium surface set", () => {
    assert.deepEqual(projects.recent?.card?.colors, RECENT_OVERRIDE);
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
    for (const color of Object.values(RECENT_PALETTE)) {
      assert.ok(generated.includes(color), `generated file must use ${color}`);
    }
    for (const color of LEGACY_PALETTE) {
      assert.ok(!generated.includes(color), `generated file must not use legacy ${color}`);
    }
  });

  it("keeps the max-width 2-column table", () => {
    assert.ok(generated.includes('<table width="100%"'), "table must span max width");
    assert.ok(generated.includes("<tbody>"), "table must wrap rows in tbody");
    assert.equal((generated.match(/<td width="50%"/g) || []).length, 4, "must render 4 half-width cells");
  });

  it("uses h3 titles, sub language labels and thumbnail alts", () => {
    assert.equal((generated.match(/<h3 style="font-size:15px;/g) || []).length, 4, "must render 4 h3 titles");
    assert.ok(generated.includes(" project thumbnail\""), "thumbnails must have meaningful alt text");
  });

  it("does not depend on sanitizer-stripped CSS for truncation", () => {
    assert.ok(!generated.includes("-webkit-box"), "must not rely on -webkit-box");
    assert.ok(!generated.includes("-webkit-line-clamp"), "must not rely on -webkit-line-clamp");
    assert.ok(generated.includes("overflow:hidden"), "must keep overflow guard");
  });

  it("links and images use only safe URLs", () => {
    const hrefs = [...generated.matchAll(/(?:href|src)="([^"]*)"/g)].map((m) => m[1]);
    assert.ok(hrefs.length > 0, "expected links and images");
    for (const url of hrefs) {
      assert.ok(
        url.startsWith("https://") || url.startsWith("./"),
        `unsafe URL must never render: ${url}`
      );
    }
  });
});

describe("starred-projects branding config", () => {
  const projects = JSON.parse(readFileSync(path.join(ROOT, "config", "projects.json"), "utf8"));

  it("starred section uses the centered h2 header", () => {
    assert.equal(projects.starred?.title, "⭐ Featured Repositories");
    const header = projects.starred?.headerHtml || "";
    assert.ok(header.includes("<h2>⭐ Featured Repositories</h2>"), "header must carry the branded h2");
    assert.ok(header.includes('align="center"'), "header must be centered");
  });

  it("starred layout stays 3 columns", () => {
    assert.equal(projects.starred?.columns, 3);
  });
});

describe("starred-projects generated output", () => {
  const generatedPath = path.join(ROOT, "profile", "06-starred-projects-generated.md");
  const generated = readFileSync(generatedPath, "utf8");

  it("opens with the branded header block, not a markdown title", () => {
    assert.ok(
      generated.includes("<div align=\"center\">\n  <h2>⭐ Featured Repositories</h2>\n</div>"),
      "generated file must start with the branded header"
    );
  });

  it("renders one comment per card in order", () => {
    for (const n of [1, 2, 3]) {
      assert.ok(generated.includes(`<!-- Starred Project Card ${n} -->`), `missing comment for card ${n}`);
    }
    const positions = [1, 2, 3].map((n) => generated.indexOf(`<!-- Starred Project Card ${n} -->`));
    assert.deepEqual([...positions].sort((a, b) => a - b), positions, "card comments must be ordered");
  });

  it("uses the VeTwo palette and none of the legacy palette", () => {
    for (const color of Object.values(SHARED_PALETTE)) {
      assert.ok(generated.includes(color), `generated file must use ${color}`);
    }
    for (const color of LEGACY_PALETTE) {
      assert.ok(!generated.includes(color), `generated file must not use legacy ${color}`);
    }
  });

  it("keeps the max-width 3-column table with 14px titles and 6px cells", () => {
    assert.ok(generated.includes('<table width="100%"'), "table must span max width");
    assert.ok(generated.includes("table-layout:fixed"), "table must fix column layout");
    assert.equal((generated.match(/<td width="33.33%"/g) || []).length, 3, "must render 3 third-width cells");
    assert.equal((generated.match(/font-size:14px/g) || []).length, 3, "must render 3 titles at 14px");
    assert.equal((generated.match(/padding:6px/g) || []).length, 3, "must render 3 cells with 6px padding");
  });
});
