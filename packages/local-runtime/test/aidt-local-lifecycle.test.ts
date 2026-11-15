/** Local IPC lifecycle ownership, using real sockets and private temporary directories.
 * No application stack, model, database, production process or PID signal is involved.
 */
import { createConnection, createServer, type Server } from "node:net";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { acquireControl, inspectControl, requestControl, serveControl, type ControlLease } from "../src/aidt-control";

const directories: string[] = [];
const leases: ControlLease[] = [];
const extraServers: Server[] = [];
function dataDir(): string { const parent = mkdtempSync(join(tmpdir(), "aidt-ctl-")); directories.push(parent); return join(parent, "data"); }
async function acquire(dir: string): Promise<ControlLease> { const lease = await acquireControl(dir); leases.push(lease); return lease; }
const ownerFile = (dir: string) => join(dir, "run", "aidt-owner.json");
function rawRequest(endpoint: string, packet: unknown): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const client = createConnection(endpoint); let data = "";
    const timer = setTimeout(() => { client.destroy(); reject(new Error("test control response timed out")); }, 3000);
    const finish = (error?: Error) => { clearTimeout(timer); client.destroy(); if (error) reject(error); };
    client.once("error", finish);
    client.once("connect", () => client.write(`${JSON.stringify(packet)}\n`));
    client.on("data", (chunk) => { data += chunk.toString(); if (!data.includes("\n")) return; try { const response = JSON.parse(data.slice(0, data.indexOf("\n"))) as Record<string, unknown>; finish(); resolve(response); } catch (error) { finish(error instanceof Error ? error : new Error(String(error))); } });
  });
}
afterEach(async () => {
  for (const lease of leases.splice(0)) await lease.close();
  for (const server of extraServers.splice(0)) if (server.listening) await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("AIDT local owner lifecycle", () => {
  it("reports an unknown directory stopped without creating data or configuration", async () => {
    const dir = dataDir();
    expect(await inspectControl(dir)).toEqual({ state: "stopped" });
    await expect(requestControl(dir, "status")).rejects.toThrow(/stopped/);
    await expect(requestControl(dir, "stop")).rejects.toThrow(/stopped/);
    expect(existsSync(dir)).toBe(false);
  });

  it("acquires once atomically before configuration, including concurrent first starts", async () => {
    const dir = dataDir();
    const attempts = await Promise.allSettled([acquireControl(dir), acquireControl(dir), acquireControl(dir)]);
    const winners = attempts.filter((attempt): attempt is PromiseFulfilledResult<ControlLease> => attempt.status === "fulfilled");
    for (const winner of winners) leases.push(winner.value);
    expect(winners).toHaveLength(1); expect(attempts.filter((attempt) => attempt.status === "rejected")).toHaveLength(2);
    const state = winners[0]!.value.state;
    expect(state.schema).toBe(1); expect(state.pid).toBe(process.pid); expect(state.instanceId).toBeTruthy(); expect(state.token.length).toBeGreaterThanOrEqual(24);
    expect(readdirSync(dir)).toEqual(["run"]); expect(existsSync(join(dir, "secrets.json"))).toBe(false);
    if (process.platform !== "win32") { expect(statSync(dir).mode & 0o777).toBe(0o700); expect(statSync(ownerFile(dir)).mode & 0o777).toBe(0o600); }
  });

  it("does not infer running from a live PID or an owner metadata file without responding IPC", async () => {
    const dir = dataDir(), lease = await acquire(dir);
    expect(lease.state.pid).toBe(process.pid);
    expect((await inspectControl(dir)).state).toBe("unreachable");
    expect(existsSync(ownerFile(dir))).toBe(true);
  });

  it("refuses stale PID metadata without deleting it or adopting its resources", async () => {
    const dir = dataDir(), lease = await acquire(dir);
    const stale = JSON.stringify({ ...lease.state, pid: 2147483647, startedAt: "1970-01-01T00:00:00.000Z" });
    writeFileSync(ownerFile(dir), stale);
    expect((await inspectControl(dir)).state).toBe("unreachable");
    await expect(acquireControl(dir)).rejects.toThrow(/already owns or previously owned/);
    await expect(requestControl(dir, "stop", 100)).rejects.toThrow();
    expect(readFileSync(ownerFile(dir), "utf8")).toBe(stale);
  });

  it("authenticates status and stop against the same actual owner and keeps status live", async () => {
    const dir = dataDir(), lease = await acquire(dir); let calls = 0;
    const handler = vi.fn(async (command: "status" | "stop") => ({ command, sample: ++calls, phase: command === "stop" ? "stopping" : "ready" }));
    await serveControl(lease, handler);
    expect(await requestControl(dir, "status")).toEqual({ command: "status", sample: 1, phase: "ready" });
    expect(await inspectControl(dir)).toEqual({ state: "responding", details: { command: "status", sample: 2, phase: "ready" } });
    expect(await requestControl(dir, "stop")).toEqual({ command: "stop", sample: 3, phase: "stopping" });
    expect(handler.mock.calls.map((call) => call[0])).toEqual(["status", "status", "stop"]);
    if (process.platform !== "win32") expect(statSync(lease.state.endpoint).mode & 0o777).toBe(0o600);
  });

  it.each(["token", "instanceId", "command"] as const)("rejects wrong %s without invoking the owner handler", async (field) => {
    const dir = dataDir(), lease = await acquire(dir); const handler = vi.fn(async () => ({ ready: true }));
    await serveControl(lease, handler);
    const packet = { token: lease.state.token, instanceId: lease.state.instanceId, command: "status", [field]: "wrong" };
    expect(await rawRequest(lease.state.endpoint, packet)).toMatchObject({ ok: false });
    expect(handler).not.toHaveBeenCalled();
    expect(await requestControl(dir, "status")).toEqual({ ready: true });
  });

  it("keeps saved database, objects, secrets and logs through stop acknowledgement and repeated close", async () => {
    const dir = dataDir(), lease = await acquire(dir);
    const saved = { database: "persistent-database-sentinel", objects: "persistent-evidence-sentinel", secrets: "persistent-key-sentinel", logs: "persistent-log-sentinel" };
    for (const [name, value] of Object.entries(saved)) writeFileSync(join(dir, name), value);
    await serveControl(lease, async (command) => ({ phase: command === "stop" ? "stopped" : "ready" }));
    expect(await requestControl(dir, "stop")).toEqual({ phase: "stopped" });
    await Promise.all([lease.close(), lease.close()]); await lease.close();
    expect(await inspectControl(dir)).toEqual({ state: "stopped" });
    for (const [name, value] of Object.entries(saved)) expect(readFileSync(join(dir, name), "utf8")).toBe(value);
  });

  it("bounds an unresponsive owner request without deleting state and can recover on the next request", async () => {
    const dir = dataDir(), lease = await acquire(dir); let release!: () => void; let calls = 0;
    const stalled = new Promise<void>((resolve) => { release = resolve; });
    await serveControl(lease, async () => { calls += 1; if (calls === 1) await stalled; return { phase: "ready", sample: calls }; });
    const original = readFileSync(ownerFile(dir), "utf8");
    try {
      await expect(requestControl(dir, "status", 30)).rejects.toThrow(/did not respond/);
      expect(readFileSync(ownerFile(dir), "utf8")).toBe(original);
      expect(await requestControl(dir, "status", 1000)).toMatchObject({ phase: "ready", sample: 2 });
    } finally { release(); }
  });

  it("keeps the original owner reachable after a stop handler rejects, without claiming a stop receipt", async () => {
    const dir = dataDir(), lease = await acquire(dir);
    await serveControl(lease, async (command) => { if (command === "stop") throw new Error("Stop not confirmed"); return { phase: "stopping", healthy: false }; });
    await expect(requestControl(dir, "stop")).rejects.toThrow("Stop not confirmed");
    expect(existsSync(ownerFile(dir))).toBe(true);
    expect(await inspectControl(dir)).toEqual({ state: "responding", details: { phase: "stopping", healthy: false } });
  });

  it("does not delete a replacement owner's lock during old-owner cleanup", async () => {
    const dir = dataDir(), lease = await acquire(dir);
    const replacement = JSON.stringify({ ...lease.state, instanceId: "replacement-owner", token: "replacement-token" });
    writeFileSync(ownerFile(dir), replacement);
    await lease.close();
    expect(readFileSync(ownerFile(dir), "utf8")).toBe(replacement);
    await expect(acquireControl(dir)).rejects.toThrow(/already owns or previously owned/);
  });

  it("rejects tampered TCP endpoints instead of probing or stopping arbitrary listeners", async () => {
    const dir = dataDir(), lease = await acquire(dir), original = readFileSync(ownerFile(dir), "utf8");
    writeFileSync(ownerFile(dir), JSON.stringify({ ...lease.state, endpoint: "127.0.0.1:3200" }));
    try {
      expect((await inspectControl(dir)).state).toBe("unreachable");
      await expect(requestControl(dir, "stop")).rejects.toThrow(/does not match/);
    } finally { writeFileSync(ownerFile(dir), original); }
  });

  it("does not accept a response from a different instance even at the expected local endpoint", async () => {
    const dir = dataDir(), lease = await acquire(dir);
    const fake = createServer((client) => { client.once("data", () => client.end(`${JSON.stringify({ ok: true, instanceId: "different-owner", result: { phase: "ready" } })}\n`)); });
    extraServers.push(fake);
    await new Promise<void>((resolve, reject) => { fake.once("error", reject); fake.listen(lease.state.endpoint, resolve); });
    await expect(requestControl(dir, "status")).rejects.toThrow(/identity changed/);
    expect((await inspectControl(dir)).state).toBe("unreachable");
  });

  it.skipIf(process.platform === "win32")("reports an overlong POSIX socket path before acquiring an owner lock", async () => {
    const dir = join(dataDir(), "long-data-directory-".repeat(8));
    await expect(acquireControl(dir)).rejects.toThrow(/too long/);
    expect(existsSync(ownerFile(dir))).toBe(false);
  });
});
