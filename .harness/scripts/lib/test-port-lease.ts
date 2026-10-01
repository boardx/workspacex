import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, rmdirSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { alive } from "./stack-admission";

interface PortLeaseOwner {
  pid: number;
  token: string;
}

/** Machine-wide, shared by all worktrees. Override only to isolate test fixtures. */
export function testPortLeaseDir(env: NodeJS.ProcessEnv = process.env): string {
  return env.WORKSPACEX_TEST_PORT_LEASE_DIR || join(tmpdir(), "workspacex-test-port-leases");
}

function isErrorCode(error: unknown, code: string): boolean {
  return (error as NodeJS.ErrnoException).code === code;
}

function ownerFile(dir: string, owner: PortLeaseOwner): string {
  return join(dir, `${owner.pid}-${owner.token}.json`);
}

function readOwner(dir: string): PortLeaseOwner | null {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch (error) {
    if (isErrorCode(error, "ENOENT")) return null;
    throw error;
  }
  // An incomplete publication or corrupt record is unavailable, never unowned.
  if (names.length !== 1) return null;
  let owner: PortLeaseOwner;
  try {
    owner = JSON.parse(readFileSync(join(dir, names[0]!), "utf8")) as PortLeaseOwner;
  } catch (error) {
    if (error instanceof SyntaxError || isErrorCode(error, "ENOENT")) return null;
    throw error;
  }
  if (!owner || !Number.isSafeInteger(owner.pid) || owner.pid <= 0 ||
      typeof owner.token !== "string" || !/^[\da-f-]{36}$/.test(owner.token) ||
      ownerFile(dir, owner) !== join(dir, names[0]!)) return null;
  return owner;
}

/** Only the winner of unlinking this immutable token may remove the directory. */
function removeOwner(dir: string, owner: PortLeaseOwner): void {
  const current = readOwner(dir);
  if (current?.pid !== owner.pid || current.token !== owner.token) return;
  try {
    unlinkSync(ownerFile(dir, owner));
  } catch (error) {
    if (isErrorCode(error, "ENOENT")) return;
    throw error;
  }
  // Not recursive: another token or an unexpected file must never be deleted.
  rmdirSync(dir);
}

/** Atomic claim; a live or unverifiable owner means this candidate is unavailable. */
export function acquireTestPortLease(port: number, root: string): { release: () => void } | null {
  mkdirSync(root, { recursive: true, mode: 0o700 });
  const dir = join(root, String(port));
  const owner: PortLeaseOwner = { pid: process.pid, token: randomUUID() };
  const create = (): boolean => {
    try {
      mkdirSync(dir);
    } catch (error) {
      if (isErrorCode(error, "EEXIST")) return false;
      throw error;
    }
    try {
      writeFileSync(ownerFile(dir, owner), JSON.stringify(owner), { flag: "wx" });
    } catch (error) {
      // A failed publication must not leave an owned listener or silently succeed.
      try { unlinkSync(ownerFile(dir, owner)); } catch (cleanupError) {
        if (!isErrorCode(cleanupError, "ENOENT")) throw cleanupError;
      }
      rmdirSync(dir);
      throw error;
    }
    return true;
  };
  if (!create()) {
    const existing = readOwner(dir);
    if (existing === null || alive(existing.pid)) return null;
    // alive() is shared with admission. Confirm ESRCH before reclaiming: EPERM
    // and other probe errors do not prove that another user's process is dead.
    try {
      process.kill(existing.pid, 0);
      return null;
    } catch (error) {
      if (!isErrorCode(error, "ESRCH")) return null;
    }
    removeOwner(dir, existing);
    if (!create()) return null;
  }
  return { release: () => removeOwner(dir, owner) };
}
