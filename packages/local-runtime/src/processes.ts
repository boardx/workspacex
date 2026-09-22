/**
 * Child-process plumbing shared by `up` and the seed runner: spawn with a log prefix,
 * run-to-completion with captured output, and HTTP readiness polling.
 */
import { execFileSync } from "node:child_process";
import { spawn, type ChildProcess } from "node:child_process";
import { createWriteStream, mkdirSync } from "node:fs";
import net from "node:net";
import { platform } from "node:os";
import { join } from "node:path";

export interface SpawnSpec {
  readonly name: string;
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly env: Record<string, string>;
  readonly logDir?: string;
}

export interface Managed {
  readonly name: string;
  readonly child: ChildProcess;
  readonly exited: Promise<number | null>;
  stop(): Promise<void>;
}

export function startManaged(spec: SpawnSpec, log: (line: string) => void = defaultLog): Managed {
  // Own process group (POSIX): uvicorn `--workers` and `next dev` fork; signalling only the
  // direct child left a worker listening on the port after the supervisor died, and the next
  // `up` then took the stale worker's /healthz for its own (Mac实测 2026-09-17).
  const child = spawn(spec.command, [...spec.args], {
    cwd: spec.cwd,
    env: { ...baseEnv(), ...spec.env },
    stdio: ["ignore", "pipe", "pipe"],
    detached: platform() !== "win32",
  });
  let file: ReturnType<typeof createWriteStream> | null = null;
  if (spec.logDir) {
    mkdirSync(spec.logDir, { recursive: true });
    file = createWriteStream(join(spec.logDir, `${spec.name}.log`), { flags: "a" });
  }
  const pipe = (stream: NodeJS.ReadableStream | null): void => {
    if (!stream) return;
    let buf = "";
    stream.on("data", (chunk: Buffer) => {
      buf += chunk.toString("utf8");
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const line of lines) {
        file?.write(`${new Date().toISOString()} ${line}\n`);
        log(`[${spec.name}] ${line}`);
      }
    });
  };
  pipe(child.stdout);
  pipe(child.stderr);
  const exited = new Promise<number | null>((resolve) => {
    child.on("exit", (code) => {
      file?.end();
      resolve(code);
    });
    // ENOENT etc.: without a handler Node throws an unhandled 'error' and takes the whole
    // supervisor down; here it becomes a logged line + a failed readiness wait instead.
    child.on("error", (e) => {
      const line = `[${spec.name}] failed to start ${spec.command}: ${e.message}`;
      file?.write(`${new Date().toISOString()} ${line}\n`);
      log(line);
      file?.end();
      resolve(null);
    });
  });
  return {
    name: spec.name,
    child,
    exited,
    async stop() {
      if (child.exitCode !== null) return;
      killTree(child, "SIGTERM");
      const t = setTimeout(() => killTree(child, "SIGKILL"), 8_000);
      await exited;
      clearTimeout(t);
    },
  };
}

/** Signal the child's whole process group (falls back to the child alone on Windows / if the group is gone). */
export function killTree(child: ChildProcess, signal: NodeJS.Signals): void {
  if (child.pid === undefined) return;
  if (platform() !== "win32") {
    try { process.kill(-child.pid, signal); return; } catch { /* group already gone, fall through */ }
  }
  try { child.kill(signal); } catch { /* already exited */ }
}

/**
 * Readiness that cannot be faked by a stale process: rejects as soon as the child exits, and
 * only resolves on the HTTP probe. Without the race, a child that failed to bind (EADDRINUSE)
 * was reported ready because whoever held the port answered the probe.
 */
export async function waitForManaged(m: Managed, url: string, opts: Parameters<typeof waitForHttp>[1]): Promise<void> {
  const exited = m.exited.then((code) => { throw new Error(`${m.name} exited with code ${code} before becoming ready (see ${m.name}.log)`); });
  await Promise.race([waitForHttp(url, opts), exited]);
}

/** Fail fast and say who to stop, instead of letting a service die on EADDRINUSE behind a probe that a stale process answers. */
export async function assertPortFree(port: number, what: string): Promise<void> {
  const inUse = await new Promise<boolean>((resolve) => {
    const s = net.createServer();
    s.once("error", () => resolve(true));
    s.listen(port, "127.0.0.1", () => s.close(() => resolve(false)));
  });
  if (inUse) {
    throw new Error(
      `127.0.0.1:${port} (${what}) is already in use -- another WorkspaceX Local or a leftover ${what} process is running; ` +
        `stop it first (lsof -ti :${port} | xargs kill)`,
    );
  }
}

/**
 * Stop whatever listens on a loopback port and wait until it is free. Only for ports this
 * runtime owns outright (the alternate Ollama port): a process there is a previous instance of
 * ours that would otherwise be reused with stale env (no OLLAMA_CONTEXT_LENGTH, #3749 B1.1).
 */
export async function stopListenerOnPort(port: number, timeoutMs = 15_000): Promise<boolean> {
  let pids: number[] = [];
  try {
    const out = execFileSync("lsof", ["-tiTCP:" + String(port), "-sTCP:LISTEN"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    pids = out.split(/\s+/).map((x) => Number(x)).filter((n) => Number.isInteger(n) && n > 0);
  } catch { return false; }
  if (pids.length === 0) return false;
  for (const pid of pids) { try { process.kill(pid, "SIGTERM"); } catch { /* already gone */ } }
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const free = await new Promise<boolean>((resolve) => {
      const s = net.createServer();
      s.once("error", () => resolve(false));
      s.listen(port, "127.0.0.1", () => s.close(() => resolve(true)));
    });
    if (free) return true;
    await new Promise((r) => setTimeout(r, 250));
  }
  for (const pid of pids) { try { process.kill(pid, "SIGKILL"); } catch { /* gone */ } }
  return true;
}

export interface RunResult {
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

/** Run to completion; never throws on non-zero exit -- the caller decides what a failure means. */
export function runToCompletion(spec: Omit<SpawnSpec, "logDir">): Promise<RunResult> {
  return new Promise((resolve) => {
    const child = spawn(spec.command, [...spec.args], {
      cwd: spec.cwd,
      env: { ...baseEnv(), ...spec.env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (c: Buffer) => { stdout += c.toString("utf8"); });
    child.stderr?.on("data", (c: Buffer) => { stderr += c.toString("utf8"); });
    child.on("exit", (code) => resolve({ code, stdout, stderr }));
    child.on("error", (e) => resolve({ code: null, stdout, stderr: `${stderr}\n${String(e)}` }));
  });
}

export async function waitForHttp(url: string, opts: { timeoutMs: number; intervalMs?: number; accept?: (status: number) => boolean }): Promise<void> {
  const started = Date.now();
  const accept = opts.accept ?? ((s) => s >= 200 && s < 500);
  let lastError = "";
  while (Date.now() - started < opts.timeoutMs) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(2_000) });
      if (accept(res.status)) return;
      lastError = `HTTP ${res.status}`;
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
    }
    await new Promise((r) => setTimeout(r, opts.intervalMs ?? 500));
  }
  throw new Error(`${url} not ready after ${opts.timeoutMs}ms (${lastError})`);
}

/** Inherit PATH/HOME etc., but never leak the parent's cloud model / DB configuration into a child. */
function baseEnv(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v === undefined) continue;
    if (/^(KERNEL_|PG|REDIS_|OSS_|S3_|WORKSPACEX_|MODEL_|DEEP_AGENT_|NEXT_PUBLIC_)/.test(k)) continue;
    out[k] = v;
  }
  return out;
}

function defaultLog(line: string): void {
  process.stdout.write(`${line}\n`);
}
