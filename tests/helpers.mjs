import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import os from "node:os";
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
    `${label}: files changed unexpectedly`,
  );
}

// Cross-process mutex for a named resource. Test files run in parallel
// processes and several rebuild the same outputs; without serialization,
// concurrent writes (O_TRUNC + write) can interleave and a concurrent read
// can observe torn bytes, producing flakes. All README writes and generated
// profile-section snapshots in tests go through this. Locks live in
// os.tmpdir() so they work regardless of checkout location.
const LOCK_ROOT = os.tmpdir();

export async function withLock(name, fn, { timeoutMs = 60000 } = {}) {
  const lockDir = path.join(LOCK_ROOT, `vetwo-profile-${name}.lock`);
  const start = Date.now();
  for (;;) {
    try {
      await mkdir(lockDir);
      break;
    } catch {
      if (Date.now() - start > timeoutMs) {
        throw new Error(
          `timed out waiting for ${name} lock after ${timeoutMs}ms`,
        );
      }
      await new Promise((r) => setTimeout(r, 25));
    }
  }
  try {
    return await fn();
  } finally {
    await rm(lockDir, { recursive: true, force: true });
  }
}

export async function withReadmeLock(fn, options = {}) {
  return withLock("readme", fn, options);
}
