import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { generateCard as generateRecentCard } from "../scripts/generate-project-cards.mjs";
import { generateCard as generateStarredCard } from "../scripts/generate-starred-projects.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");

// Mirrors the Website case that broke the live profile: no language, no
// topics, no push date. Before the fix, the empty meta interpolation left a
// whitespace-only line that terminated GitHub's HTML block, rendering the
// rest of the section as literal text.
const bareRepo = {
  name: "Website",
  html_url: "https://github.com/VeTwo-dev/Website",
  language: null,
  topics: [],
  pushed_at: null,
  updated_at: null,
  description: null,
  stargazers_count: 0,
  forks_count: 0,
};

const fullRepo = {
  name: "Units-manager",
  html_url: "https://github.com/VeTwo-dev/Units-manager",
  language: "TypeScript",
  topics: ["units", "nutrition"],
  pushed_at: "2026-10-08T00:00:00Z",
  updated_at: "2026-10-08T00:00:00Z",
  description: "Unit engine.",
  stargazers_count: 3,
  forks_count: 1,
};

const hostileRepo = {
  name: '"><script>alert(1)</script>',
  html_url: "javascript:alert(1)",
  language: "<b>XSS</b>",
  topics: ['a"b', "[x](http://evil.example/)", "back\\slash"],
  pushed_at: "2026-10-08T00:00:00Z",
  updated_at: "2026-10-08T00:00:00Z",
  description: null,
  stargazers_count: 0,
  forks_count: 0,
};

function assertNoBlankLines(output, label) {
  const bad = output.split("\n").filter((line) => line.trim() === "");
  assert.deepEqual(bad, [], `${label} must not emit whitespace-only lines`);
}

function hrefValues(output) {
  return [...output.matchAll(/href="([^"]*)"/g)].map((m) => m[1]);
}

describe("recent card rendering", () => {
  it("emits no whitespace-only lines when metadata is missing", () => {
    const out = generateRecentCard(bareRepo, "./assets/thumbnail/website.svg", "Some description here.");
    assertNoBlankLines(out, "bare card");
    assert.ok(out.includes("https://github.com/VeTwo-dev/Website"), "links must survive");
  });

  it("keeps structure intact with full metadata", () => {
    const out = generateRecentCard(fullRepo, "./assets/thumbnail/units-manager.svg", "A unit engine.");
    assertNoBlankLines(out, "full card");
    assert.ok(out.includes("<td"), "must render a table cell");
    assert.ok(out.includes("Units-manager project thumbnail"), "must keep meaningful alt text");
    for (const href of hrefValues(out)) {
      assert.ok(!href.includes("["), `href must be a direct URL, got: ${href}`);
    }
    assert.ok(!out.includes("\\<"), "must not contain backslash-escaped tags");
  });

  it("escapes hostile metadata without breaking structure", () => {
    const out = generateRecentCard(hostileRepo, "javascript:alert(2)", "Desc with <b>tags</b> & quotes and [x](http://evil.example/) link.");
    assertNoBlankLines(out, "hostile card");
    assert.ok(!out.includes("<script>"), "must escape injected tags");
    assert.ok(!out.includes("\\<"), "must not contain backslash-escaped tags");
    for (const href of hrefValues(out)) {
      assert.ok(
        href === "https://github.com/VeTwo-dev" || href === "./assets/thumbnail/placeholder.svg",
        `unsafe URL must fall back, got: ${href}`
      );
      assert.ok(!href.includes("["), `href must never contain markdown syntax, got: ${href}`);
    }
  });

  it("is deterministic for identical input", () => {
    const a = generateRecentCard(fullRepo, "./assets/thumbnail/units-manager.svg", "A unit engine.");
    const b = generateRecentCard(fullRepo, "./assets/thumbnail/units-manager.svg", "A unit engine.");
    assert.equal(a, b);
  });
});

describe("starred card rendering", () => {
  it("emits no whitespace-only lines when optional metadata is missing", () => {
    const repo = { ...bareRepo, pushed_at: null };
    const out = generateStarredCard(repo, "./assets/thumbnail/website.svg", "Some description here.");
    assertNoBlankLines(out, "bare starred card");
  });

  it("keeps structure intact with full metadata", () => {
    const out = generateStarredCard(fullRepo, "./assets/thumbnail/units-manager.svg", "A unit engine.");
    assertNoBlankLines(out, "full starred card");
    for (const href of hrefValues(out)) {
      assert.ok(!href.includes("["), `href must be a direct URL, got: ${href}`);
    }
    assert.ok(!out.includes("\\<"), "must not contain backslash-escaped tags");
  });
});

describe("generated card artifacts", () => {
  for (const file of ["profile/05-projects-generated.md", "profile/06-starred-projects-generated.md"]) {
    it(`${file} has no whitespace-only lines inside its table`, () => {
      const content = readFileSync(path.join(ROOT, file), "utf8");
      const lines = content.split("\n");
      const start = lines.findIndex((l) => l.includes("<table"));
      const end = lines.findIndex((l) => l.includes("</table>"));
      assert.ok(start !== -1 && end > start, `${file} must contain a table`);
      const bad = lines.slice(start, end + 1).filter((l) => l.trim() === "");
      assert.deepEqual(bad, [], `${file} table must not contain whitespace-only lines`);
    });

    it(`${file} is real markup, not a fenced code block`, () => {
      const content = readFileSync(path.join(ROOT, file), "utf8");
      assert.ok(!content.includes("```"), `${file} must not wrap markup in code fences`);
      assert.ok(content.includes("<td"), `${file} must contain table cells`);
    });
  }
});
