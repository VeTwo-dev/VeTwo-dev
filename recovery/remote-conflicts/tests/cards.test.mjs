import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { isSafeCardUrl, truncateText, extractFirstParagraph, stripMarkdownInline } from "../scripts/lib/github.mjs";

describe("isSafeCardUrl", () => {
  it("allows local profile assets and absolute HTTPS URLs", () => {
    assert.equal(isSafeCardUrl("./assets/thumbnail/cli.svg"), true);
    assert.equal(isSafeCardUrl("https://github.com/VeTwo-dev/Cli"), true);
    assert.equal(isSafeCardUrl("https://raw.githubusercontent.com/x/y/main/a.png"), true);
  });

  it("blocks unsafe schemes and non-strings", () => {
    assert.equal(isSafeCardUrl("javascript:alert(1)"), false);
    assert.equal(isSafeCardUrl("data:image/svg+xml,<svg/>"), false);
    assert.equal(isSafeCardUrl("http://github.com/x"), false);
    assert.equal(isSafeCardUrl("//github.com/x"), false);
    assert.equal(isSafeCardUrl(""), false);
    assert.equal(isSafeCardUrl(null), false);
    assert.equal(isSafeCardUrl(undefined), false);
  });
});

describe("truncateText", () => {
  it("leaves short text untouched and truncates long text deterministically", () => {
    assert.equal(truncateText("short text", 110), "short text");
    const long = `word ${"x".repeat(200)}`;
    const out = truncateText(long, 110);
    assert.ok(out.endsWith("..."), "must end with an ellipsis");
    assert.ok(out.length <= 110, "must respect the limit");
    assert.equal(truncateText(long, 110), out, "must be deterministic");
  });

  it("prefers word boundaries and handles edge input", () => {
    assert.equal(truncateText("  spaced   out  ", 50), "spaced out");
    assert.equal(truncateText("", 50), "");
    assert.equal(truncateText(null, 50), "");
  });
});

describe("extractFirstParagraph markdown stripping", () => {
  it("strips bold, links, code and list markers to plain text", () => {
    assert.equal(
      extractFirstParagraph("A small **bold engine** for TypeScript work here yes indeed."),
      "A small bold engine for TypeScript work here yes indeed."
    );
    assert.equal(
      extractFirstParagraph("This is a [Next.js](https://nextjs.org) project bootstrapped for real use cases."),
      "This is a Next.js project bootstrapped for real use cases."
    );
    assert.equal(
      extractFirstParagraph("Run `pnpm install` to install every dependency right now ok."),
      "Run pnpm install to install every dependency right now ok."
    );
    assert.equal(
      extractFirstParagraph("- **Bold item** in a list that is long enough to count here."),
      "Bold item in a list that is long enough to count here."
    );
  });

  it("still skips headings and returns null for short content", () => {
    assert.equal(
      extractFirstParagraph("# Title to skip\n\nPlain second paragraph that is long enough to pass the filter."),
      "Plain second paragraph that is long enough to pass the filter."
    );
    assert.equal(extractFirstParagraph("too short"), null);
    assert.equal(extractFirstParagraph(""), null);
  });

  it("joins multi-line paragraphs instead of ending mid-thought", () => {
    assert.equal(
      extractFirstParagraph(
        "A pnpm workspace for the VeTwo unit engine family — a dependency-free\ncalculation engine for science.\n\nNext paragraph here."
      ),
      "A pnpm workspace for the VeTwo unit engine family — a dependency-free calculation engine for science."
    );
  });

  it("adds an ellipsis only when the paragraph was cut off", () => {
    assert.equal(
      extractFirstParagraph(
        "First line of a longer thought here yes indeed it continues\n[link](https://x.example/y)\n\nMore below."
      ),
      "First line of a longer thought here yes indeed it continues..."
    );
    assert.equal(
      extractFirstParagraph("A complete sentence that stands alone here.\n\nAnother paragraph follows it."),
      "A complete sentence that stands alone here."
    );
  });

  it("never leaks bare link text from link-only lines", () => {
    const out = extractFirstParagraph(
      "First line of a longer thought here yes indeed it continues\n[link](https://x.example/y)\n\nMore below."
    );
    assert.ok(!out.includes("[link]"), "raw link markup must not leak");
  });
});

describe("stripMarkdownInline (API description path)", () => {
  it("cleans API descriptions so cards never show raw markdown", () => {
    assert.equal(
      stripMarkdownInline("A small, dependency-free **scientific unit** engine for TypeScript."),
      "A small, dependency-free scientific unit engine for TypeScript."
    );
    assert.equal(stripMarkdownInline("Plain text stays untouched here."), "Plain text stays untouched here.");
    assert.equal(stripMarkdownInline(""), "");
  });
});
