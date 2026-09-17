/**
 * Marker-based patching so the generator only ever touches the regions it
 * owns. Everything outside `<!-- AUTO:X:START -->` / `<!-- AUTO:X:END -->`
 * pairs is human-controlled and must survive every regeneration untouched.
 */

export class MarkerError extends Error {}

function markerPattern(name: string): RegExp {
  // Non-greedy match between the two comments, DOTALL via [\s\S].
  const start = `<!-- AUTO:${name}:START -->`;
  const end = `<!-- AUTO:${name}:END -->`;
  return new RegExp(`${escapeRegex(start)}[\\s\\S]*?${escapeRegex(end)}`, "g");
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export interface PatchResult {
  readonly content: string;
  readonly changed: boolean;
  readonly patchedMarkers: readonly string[];
  readonly missingMarkers: readonly string[];
}

/**
 * Replaces the content of each named marker region with the corresponding
 * generated Markdown. Throws `MarkerError` if a marker appears more than
 * once (ambiguous — refuses to guess which to patch).
 */
export function patchMarkers(
  readme: string,
  sections: Readonly<Record<string, string>>,
): PatchResult {
  let content = readme;
  let changed = false;
  const patchedMarkers: string[] = [];
  const missingMarkers: string[] = [];

  for (const [name, body] of Object.entries(sections)) {
    const start = `<!-- AUTO:${name}:START -->`;
    const end = `<!-- AUTO:${name}:END -->`;
    const occurrences = content.match(markerPattern(name)) ?? [];

    if (occurrences.length === 0) {
      missingMarkers.push(name);
      continue;
    }
    if (occurrences.length > 1) {
      throw new MarkerError(`Marker AUTO:${name} appears ${occurrences.length} times — refusing to patch ambiguously.`);
    }

    const replacement = `${start}\n${body.trim()}\n${end}`;
    const next = content.replace(markerPattern(name), replacement);
    if (next !== content) changed = true;
    content = next;
    patchedMarkers.push(name);
  }

  return { content, changed, patchedMarkers, missingMarkers };
}

/** Verifies every requested marker name exists exactly once in the README. */
export function verifyMarkersPresent(
  readme: string,
  names: readonly string[],
): { ok: boolean; missing: string[] } {
  const missing = names.filter((name) => {
    const matches = readme.match(markerPattern(name)) ?? [];
    return matches.length !== 1;
  });
  return { ok: missing.length === 0, missing };
}
