/** Private, local IPC. Only the process that created RunningStack may stop it. */
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, openSync, closeSync, readFileSync, writeFileSync, unlinkSync, realpathSync, chmodSync } from "node:fs";
import { createConnection, createServer, type Server } from "node:net";
import { join, resolve } from "node:path";

export type ControlCommand = "status" | "stop";
export interface ControlState {
  schema: 1;
  instanceId: string;
  token: string;
  pid: number;
  endpoint: string;
  startedAt: string;
}
export interface ControlLease {
  readonly state: ControlState;
  readonly dataDir: string;
  server?: Server;
  close(): Promise<void>;
}
const lockPath = (dir: string): string => join(dir, "run", "aidt-owner.json");

function readState(dir: string): ControlState | null {
  const path = lockPath(resolve(dir));
  if (!existsSync(path)) return null;
  const s = JSON.parse(readFileSync(path, "utf8")) as Partial<ControlState>;
  if (s.schema !== 1 || typeof s.instanceId !== "string" || typeof s.token !== "string" ||
    !Number.isInteger(s.pid) || typeof s.endpoint !== "string" || typeof s.startedAt !== "string") {
    throw new Error("AIDT owner metadata is invalid; no process was stopped. Inspect the local run directory.");
  }
  // Never connect to a TCP endpoint supplied by metadata.
  const canonical = realpathSync(resolve(dir));
  if (s.endpoint !== endpointFor(canonical)) throw new Error("AIDT owner endpoint does not match this data directory.");
  return s as ControlState;
}

function endpointFor(dir: string): string {
  if (process.platform === "win32") {
    return `\\\\.\\pipe\\workspacex-aidt-${createHash("sha256").update(dir).digest("hex").slice(0, 24)}`;
  }
  const path = join(dir, "run", "aidt-control.sock");
  if (Buffer.byteLength(path) > 100) throw new Error("AIDT data directory is too long for local IPC. Use a shorter --data-dir path.");
  return path;
}

/** Acquire BEFORE resolveLocalConfig, which creates durable encryption secrets. */
export async function acquireControl(dataDir: string): Promise<ControlLease> {
  mkdirSync(resolve(dataDir), { recursive: true, mode: 0o700 });
  const canonical = realpathSync(resolve(dataDir));
  mkdirSync(join(canonical, "run"), { recursive: true, mode: 0o700 });
  const state: ControlState = {
    schema: 1, instanceId: randomUUID(), token: randomUUID(), pid: process.pid,
    endpoint: endpointFor(canonical), startedAt: new Date().toISOString(),
  };
  const path = lockPath(canonical);
  let fd: number;
  try { fd = openSync(path, "wx", 0o600); }
  catch (e) {
    if ((e as NodeJS.ErrnoException).code === "EEXIST") {
      throw new Error(`AIDT already owns or previously owned this data directory. Run status/stop with the same --data-dir. If unreachable, inspect ${path}; no process or data was removed.`);
    }
    throw e;
  }
  try { writeFileSync(fd, JSON.stringify(state)); } finally { closeSync(fd); }
  let closed: Promise<void> | undefined;
  const lease: ControlLease = {
    state, dataDir: canonical,
    close() {
      closed ??= (async () => {
        if (lease.server?.listening) await new Promise<void>((done, fail) => lease.server!.close(e => e ? fail(e) : done()));
        // Do not unlink a different owner's lock, even during error recovery.
        const current = readState(canonical);
        if (current?.instanceId === state.instanceId && current.token === state.token) unlinkSync(path);
      })();
      return closed;
    },
  };
  return lease;
}

export async function serveControl(lease: ControlLease, handler: (command: ControlCommand) => Promise<unknown>): Promise<void> {
  const server = createServer(socket => {
    socket.setTimeout(15_000, () => socket.destroy());
    let data = "";
    let handled = false;
    socket.on("error", () => {});
    socket.on("data", chunk => {
      data += chunk.toString();
      if (data.length > 8192) { socket.destroy(); return; }
      if (!data.includes("\n") || handled) return;
      handled = true;
      void (async () => {
        try {
          const req = JSON.parse(data.slice(0, data.indexOf("\n"))) as Record<string, unknown>;
          if (req.token !== lease.state.token || req.instanceId !== lease.state.instanceId ||
            (req.command !== "status" && req.command !== "stop")) {
            socket.end(`${JSON.stringify({ ok: false, error: "Unauthorized local control request" })}\n`); return;
          }
          const result = await handler(req.command);
          socket.end(`${JSON.stringify({ ok: true, instanceId: lease.state.instanceId, result })}\n`);
        } catch (e) {
          socket.end(`${JSON.stringify({ ok: false, error: e instanceof Error ? e.message : "Control failed" })}\n`);
        }
      })();
    });
  });
  lease.server = server;
  await new Promise<void>((done, fail) => {
    server.once("error", fail);
    server.listen(lease.state.endpoint, () => {
      server.removeListener("error", fail);
      if (process.platform !== "win32") chmodSync(lease.state.endpoint, 0o600);
      done();
    });
  });
}

/** Reads only existing owner metadata; never creates data, secrets or config. */
export async function requestControl(dataDir: string, command: ControlCommand, timeoutMs = 5000): Promise<unknown> {
  const state = readState(dataDir);
  if (!state) throw new Error("AIDT is stopped (no owner metadata).");
  return new Promise((done, fail) => {
    const socket = createConnection(state.endpoint);
    let data = "";
    const timer = setTimeout(() => { socket.destroy(); fail(new Error("AIDT owner did not respond; no process was stopped.")); }, timeoutMs);
    const finish = (e?: Error, result?: unknown): void => {
      clearTimeout(timer); socket.destroy(); if (e) fail(e); else done(result);
    };
    socket.on("error", e => finish(e));
    socket.on("connect", () => socket.write(`${JSON.stringify({ token: state.token, instanceId: state.instanceId, command })}\n`));
    socket.on("data", chunk => {
      data += chunk.toString();
      if (data.length > 1024 * 1024) { finish(new Error("Invalid oversized control response")); return; }
      if (!data.includes("\n")) return;
      try {
        const response = JSON.parse(data.slice(0, data.indexOf("\n"))) as { ok: boolean; instanceId?: string; result?: unknown; error?: string };
        if (!response.ok || response.instanceId !== state.instanceId) finish(new Error(response.error ?? "Owner identity changed"));
        else finish(undefined, response.result);
      } catch (e) { finish(e as Error); }
    });
    socket.on("end", () => { if (!data.includes("\n")) finish(new Error("Owner closed without a response")); });
  });
}

export async function inspectControl(dataDir: string): Promise<{ state: "stopped" | "unreachable" | "responding"; details?: unknown }> {
  try {
    if (!readState(dataDir)) return { state: "stopped" };
    return { state: "responding", details: await requestControl(dataDir, "status", 15_000) };
  } catch (e) { return { state: "unreachable", details: e instanceof Error ? e.message : "Owner unavailable" }; }
}
