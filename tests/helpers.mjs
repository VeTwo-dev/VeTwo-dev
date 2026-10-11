import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
export const ROOT = path.resolve(__dirname, "..");

export function sha256File(relPath) {
  const full = path.join(ROOT, relPath);
  if (!existsSync(full)) return null;
  return createHash("sha256").update(readFileSync(full)).digest("hex");
}

export function snapshotFiles(relPaths) {
  const snap = new Map();
  for (const p of relPaths) snap.set(p, sha256File(p));
  return snap;
}

export function snapshotDir(relDir) {
  const full = path.join(ROOT, relDir);
  const snap = new Map();
  if (!existsSync(full)) return snap;
  for (const name of readdirSync(full).sort()) {
    snap.set(`${relDir}/${name}`, sha256File(`${relDir}/${name}`));
  }
  return snap;
}

export function assertSnapshotsEqual(before, after, label) {
  assert.deepEqual(
    [...after.entries()],
    [...before.entries()],
    `${label}: files changed unexpectedly`
  );
}
