import { describe, expect, it } from "vitest";
import { MarkerError, patchMarkers, verifyMarkersPresent } from "../profile/generator/patch.js";

function sampleReadme(statsBody = "old stats"): string {
  return [
    "# Hello, I'm a human-written hero section",
    "",
    "This paragraph must never be touched by the generator.",
    "",
    "<!-- AUTO:STATS:START -->",
    statsBody,
    "<!-- AUTO:STATS:END -->",
    "",
    "## Connect",
    "",
    "Manual footer content.",
  ].join("\n");
}

describe("patchMarkers", () => {
  it("replaces only the content inside the named marker", () => {
    const readme = sampleReadme();
    const result = patchMarkers(readme, { STATS: "new stats content" });
    expect(result.content).toContain("new stats content");
    expect(result.content).not.toContain("old stats");
  });

  it("preserves all content outside the markers exactly", () => {
    const readme = sampleReadme();
    const result = patchMarkers(readme, { STATS: "new stats content" });
    expect(result.content).toContain("# Hello, I'm a human-written hero section");
    expect(result.content).toContain("This paragraph must never be touched by the generator.");
    expect(result.content).toContain("## Connect");
    expect(result.content).toContain("Manual footer content.");
  });

  it("reports changed:false when the generated content is identical", () => {
    const readme = sampleReadme("same content");
    const result = patchMarkers(readme, { STATS: "same content" });
    expect(result.changed).toBe(false);
  });

  it("reports changed:true when content differs", () => {
    const readme = sampleReadme("old content");
    const result = patchMarkers(readme, { STATS: "different content" });
    expect(result.changed).toBe(true);
  });

  it("records markers that were not found in the README as missing, without throwing", () => {
    const readme = sampleReadme();
    const result = patchMarkers(readme, { STATS: "x", NONEXISTENT: "y" });
    expect(result.missingMarkers).toEqual(["NONEXISTENT"]);
    expect(result.patchedMarkers).toEqual(["STATS"]);
  });

  it("throws MarkerError instead of guessing when a marker appears more than once", () => {
    const readme = `${sampleReadme()}\n\n<!-- AUTO:STATS:START -->\nduplicate\n<!-- AUTO:STATS:END -->`;
    expect(() => patchMarkers(readme, { STATS: "x" })).toThrow(MarkerError);
  });

  it("can patch multiple distinct markers independently", () => {
    const readme = [
      "<!-- AUTO:A:START -->old-a<!-- AUTO:A:END -->",
      "<!-- AUTO:B:START -->old-b<!-- AUTO:B:END -->",
    ].join("\n");
    const result = patchMarkers(readme, { A: "new-a", B: "new-b" });
    expect(result.content).toContain("new-a");
    expect(result.content).toContain("new-b");
  });
});

describe("verifyMarkersPresent", () => {
  it("returns ok:true when every requested marker exists exactly once", () => {
    const readme = sampleReadme();
    expect(verifyMarkersPresent(readme, ["STATS"]).ok).toBe(true);
  });

  it("returns ok:false and lists a marker that is entirely missing", () => {
    const readme = sampleReadme();
    const result = verifyMarkersPresent(readme, ["STATS", "LANGUAGES"]);
    expect(result.ok).toBe(false);
    expect(result.missing).toEqual(["LANGUAGES"]);
  });

  it("returns ok:false for a marker duplicated in the document", () => {
    const readme = `${sampleReadme()}\n<!-- AUTO:STATS:START -->dup<!-- AUTO:STATS:END -->`;
    expect(verifyMarkersPresent(readme, ["STATS"]).ok).toBe(false);
  });
});
