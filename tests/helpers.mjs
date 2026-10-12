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
    `${label}: files changed unexpectedly`
  );
}

// Cross-process mutex for README.md. Test files run in parallel processes
// and several rebuild README.md; without serialization, concurrent writes
// (O_TRUNC + write) can interleave and a concurrent read can observe torn
// bytes, producing flakes. All README reads/writes in tests go through this.
// Lock lives in os.tmpdir() so it works regardless of checkout location.
const README_LOCK_DIR = path.join(os.tmpdir(), "vetwo-profile-readme.lock");

export async function withReadmeLock(fn, { timeoutMs = 60000 } = {}) {
  const start = Date.now();
  for (;;) {
    try {
      await mkdir(README_LOCK_DIR);
      break;
    } catch {
      if (Date.now() - start > timeoutMs) {
        throw new Error(`timed out waiting for README lock after ${timeoutMs}ms`);
      }
      await new Promise((r) => setTimeout(r, 25));
    }
  }
  try {
    return await fn();
  } finally {
    await rm(README_LOCK_DIR, { recursive: true, force: true });
  }
}
