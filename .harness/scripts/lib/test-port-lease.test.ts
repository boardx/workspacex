import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { acquireTestPortLease, testPortLeaseDir } from "./test-port-lease";

let dir: string;
const children: ChildProcess[] = [];
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "port-lease-test-")); });
afterEach(() => {
  for (const child of children.splice(0)) child.kill();
  rmSync(dir, { recursive: true, force: true });
});

function owner(port: number, pid: number, token = randomUUID()): string {
  const path = join(dir, String(port));
  mkdirSync(path);
  const file = join(path, `${pid}-${token}.json`);
  writeFileSync(file, JSON.stringify({ pid, token }));
  return file;
}

describe("#3128 machine-wide port ownership", () => {
  it("uses one directory across worktrees", () => {
    expect(testPortLeaseDir({})).toBe(join(tmpdir(), "workspacex-test-port-leases"));
    expect(testPortLeaseDir({ WORKSPACEX_TEST_PORT_LEASE_DIR: dir })).toBe(dir);
  });

  it("cannot steal a live PID's lease and releases its own lease idempotently", () => {
    const lease = acquireTestPortLease(24100, dir)!;
    expect(acquireTestPortLease(24100, dir)).toBeNull();
    lease.release();
    lease.release();
    const next = acquireTestPortLease(24100, dir);
    expect(next).not.toBeNull();
    next!.release();
    expect(readdirSync(dir)).toEqual([]);
  });

  it("reclaims a dead PID but refuses incomplete, malformed and invalid owners", () => {
    // PID above the kernel's possible range, rather than racing a short-lived child.
    owner(24100, 2_147_483_647);
    const reclaimed = acquireTestPortLease(24100, dir);
    expect(reclaimed).not.toBeNull();
    reclaimed!.release();
    mkdirSync(join(dir, "24101"));
    expect(acquireTestPortLease(24101, dir)).toBeNull();
    mkdirSync(join(dir, "24102"));
    writeFileSync(join(dir, "24102", "owner.json"), "{");
    expect(acquireTestPortLease(24102, dir)).toBeNull();
    owner(24103, 0);
    expect(acquireTestPortLease(24103, dir)).toBeNull();
  });

  it("a delayed release never deletes a different token", () => {
    const lease = acquireTestPortLease(24100, dir)!;
    rmSync(join(dir, "24100"), { recursive: true });
    owner(24100, process.pid);
    const replacement = readdirSync(join(dir, "24100"));
    lease.release();
    expect(readdirSync(join(dir, "24100"))).toEqual(replacement);
    expect(acquireTestPortLease(24100, dir)).toBeNull();
  });

  it.each([false, true])("only one process can claim a port (stale lease=%s)", async (stale) => {
    if (stale) owner(24100, 2_147_483_647);
    const results = await Promise.all(Array.from({ length: 4 }, () => {
      const child = spawn(process.execPath, ["--import", "tsx",
        resolve(import.meta.dirname, "../fixtures/test-port-lease-fixture.ts"), dir, "24100"],
      { stdio: ["ignore", "ignore", "pipe", "ipc"] });
      children.push(child);
      return new Promise<{ child: ChildProcess; held: boolean }>((resolveReady, reject) => {
        let stderr = "";
        child.stderr!.on("data", (chunk) => { stderr += String(chunk); });
        child.once("error", reject);
        child.once("exit", () => reject(new Error(`lease fixture exited before ready: ${stderr}`)));
        child.once("message", (message) => resolveReady({ child, held: (message as { held: boolean }).held }));
      });
    }));
    expect(results.filter((result) => result.held)).toHaveLength(1);
    const winner = results.find((result) => result.held)!.child;
    const closed = new Promise<void>((resolveClosed) => winner.once("close", () => resolveClosed()));
    winner.send("release");
    await closed;
    expect(readdirSync(dir)).toEqual([]);
  });
});
