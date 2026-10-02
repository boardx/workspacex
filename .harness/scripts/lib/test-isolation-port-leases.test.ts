import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { acquireTestPortLease } from "./test-port-lease";
import { deriveTestIsolation, ensureReservedTestIsolation, PORT_BAND, PORT_BASE, reserveIsolationPorts,
  type PortReservation, type TestIsolationEnv } from "./test-isolation";

let leaseDir: string;
const reservations: Array<{ dispose: () => Promise<void> }> = [];
const servers: Server[] = [];
beforeEach(() => { leaseDir = mkdtempSync(join(tmpdir(), "isolation-port-lease-")); });
afterEach(async () => {
  for (const server of servers.splice(0)) await new Promise<void>((resolve) => server.close(() => resolve()));
  for (const reservation of reservations.splice(0)) await reservation.dispose();
  rmSync(leaseDir, { recursive: true, force: true });
});

function seed(): TestIsolationEnv {
  return deriveTestIsolation({ isolationId: "lease-startup-gap", worktreePath: "/tmp/test-port-lease-worktree" });
}

async function reserve(env = seed()): Promise<PortReservation> {
  const reservation = await reserveIsolationPorts(env, { leaseDir });
  reservations.push(reservation);
  return reservation;
}

async function bind(port: number): Promise<Server> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  servers.push(server);
  return server;
}

describe("#3128 ownership survives listener release", () => {
  it("A releases OS listeners, but B cannot reuse A's API/web or other ports until teardown", async () => {
    const a = await reserve();
    await a.release();
    await a.release();
    expect(readdirSync(leaseDir)).toHaveLength(Object.keys(PORT_BASE).length);
    const b = await reserve({ ...seed(), ...a.ports });
    for (const key of Object.keys(PORT_BASE) as Array<keyof typeof PORT_BASE>) {
      expect(b.ports[key], key).not.toBe(a.ports[key]);
    }
    await b.dispose();
    await a.dispose();
    await a.dispose();
    expect(readdirSync(leaseDir)).toEqual([]);
    const c = await reserve({ ...seed(), ...a.ports });
    expect(c.ports).toEqual(a.ports);
  });

  it("the owning services can bind their API/web ports during the protected startup gap", async () => {
    const a = await reserve();
    await a.release();
    await bind(Number(a.ports.WORKSPACEX_API_PORT));
    await bind(Number(a.ports.WORKSPACEX_WEB_PORT));
    const b = await reserve({ ...seed(), ...a.ports });
    expect(b.ports.WORKSPACEX_API_PORT).not.toBe(a.ports.WORKSPACEX_API_PORT);
    expect(b.ports.WORKSPACEX_WEB_PORT).not.toBe(a.ports.WORKSPACEX_WEB_PORT);
  });

  it("an inherited scope neither claims new ports nor releases its parent's leases", async () => {
    const a = await ensureReservedTestIsolation({}, { worktreePath: "/tmp/outer", leaseDir });
    reservations.push(a);
    await a.release();
    const before = readdirSync(leaseDir).sort();
    const child = await ensureReservedTestIsolation(a.env, { worktreePath: "/tmp/inner", leaseDir });
    expect(child.reserved).toBe(false);
    expect(child.env).toEqual(a.env);
    await child.release();
    await child.dispose();
    expect(readdirSync(leaseDir).sort()).toEqual(before);
    const b = await reserve(a.env);
    expect(b.ports.WORKSPACEX_API_PORT).not.toBe(a.env.WORKSPACEX_API_PORT);
    expect(b.ports.WORKSPACEX_WEB_PORT).not.toBe(a.env.WORKSPACEX_WEB_PORT);
  });

  it("a real OS listener still blocks selection even when no advisory lease exists", async () => {
    const a = await reserve();
    await a.release();
    const port = Number(a.ports.WORKSPACEX_API_PORT);
    await bind(port);
    await a.dispose();
    const b = await reserve({ ...seed(), ...a.ports });
    expect(Number(b.ports.WORKSPACEX_API_PORT)).not.toBe(port);
    expect(readdirSync(leaseDir)).not.toContain(String(port));
  });

  it("candidate exhaustion fails closed and rolls back earlier listeners and leases", async () => {
    const blocked = Array.from({ length: PORT_BAND }, (_, offset) =>
      acquireTestPortLease(PORT_BASE.WORKSPACEX_API_PORT + offset, leaseDir)!);
    try {
      await expect(reserve()).rejects.toThrow("WORKSPACEX_API_PORT");
      expect(readdirSync(leaseDir)).toHaveLength(PORT_BAND);
      expect(readdirSync(leaseDir).every((port) => Number(port) >= 24_000 && Number(port) < 25_000)).toBe(true);
      await bind(Number(seed().PGPORT));
    } finally {
      for (const lease of blocked) lease.release();
    }
  });

  it("lease filesystem errors cannot fall back to unleased ports", async () => {
    const file = join(leaseDir, "not-a-directory");
    writeFileSync(file, "unavailable");
    await expect(reserveIsolationPorts(seed(), { leaseDir: file })).rejects.toThrow();
    expect(readdirSync(leaseDir)).toEqual(["not-a-directory"]);
  });
});
