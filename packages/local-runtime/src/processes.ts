/**
 * Child-process plumbing shared by `up` and the seed runner: spawn with a log prefix,
 * run-to-completion with captured output, and HTTP readiness polling.
 */
import { spawn, type ChildProcess } from "node:child_process";
import net from "node:net";
import { createWriteStream, mkdirSync } from "node:fs";
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
  /** The last lines this child printed. A crash that only says "exit 1" is not actionable. */
  recentOutput(): string;
  stop(): Promise<void>;
}

/** How many trailing output lines to keep per child for crash reporting. */
const TAIL_LINES = 40;

export function startManaged(spec: SpawnSpec, log: (line: string) => void = defaultLog): Managed {
  const child = spawn(spec.command, [...spec.args], {
    cwd: spec.cwd,
    env: { ...baseEnv(), ...spec.env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const tail: string[] = [];
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
        tail.push(line);
        if (tail.length > TAIL_LINES) tail.shift();
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
      const line = `failed to start ${spec.command}: ${e.message}`;
      file?.write(`${new Date().toISOString()} ${line}\n`);
      tail.push(line);
      log(`[${spec.name}] ${line}`);
      file?.end();
      resolve(null);
    });
  });
  return {
    name: spec.name,
    child,
    exited,
    recentOutput: () => tail.join("\n"),
    async stop() {
      if (child.exitCode !== null) return;
      child.kill("SIGTERM");
      const t = setTimeout(() => child.kill("SIGKILL"), 8_000);
      await exited;
      clearTimeout(t);
    },
  };
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

/**
 * Readiness, but a child that has already died stops the wait immediately.
 *
 * ⚠ Without this, a service that crashes two seconds in still burns its whole readiness
 *   budget -- for the API that is 180 seconds of a progress bar that cannot succeed -- and
 *   then reports a timeout, which points the reader at the wrong thing entirely. The real
 *   cause is in the lines the child printed just before exiting, so those come along.
 */
export async function waitForHttpOrExit(
  url: string,
  opts: { timeoutMs: number; intervalMs?: number; accept?: (status: number) => boolean },
  managed: Managed,
): Promise<void> {
  let exitCode: number | null | undefined;
  const died = managed.exited.then((code) => { exitCode = code; });
  await Promise.race([waitForHttp(url, opts, () => exitCode !== undefined), died]);
  if (exitCode !== undefined) {
    const why = managed.recentOutput().trim();
    throw new Error(
      `${managed.name} exited (code ${String(exitCode)}) before it became ready at ${url}` +
        (why === "" ? "" : `\n--- ${managed.name} 最后的输出 ---\n${why}`),
    );
  }
}

export async function waitForHttp(
  url: string,
  opts: { timeoutMs: number; intervalMs?: number; accept?: (status: number) => boolean },
  abandoned: () => boolean = () => false,
): Promise<void> {
  const started = Date.now();
  const accept = opts.accept ?? ((s) => s >= 200 && s < 500);
  let lastError = "";
  while (Date.now() - started < opts.timeoutMs) {
    if (abandoned()) return;
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

/**
 * Is something already listening on this loopback port?
 *
 * Used before starting anything: a port taken by an unrelated process otherwise surfaces as
 * "not ready after 180000ms", and the reader has no way to tell that from a slow boot.
 */
export function portInUse(port: number, host = "127.0.0.1"): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(true));
    server.listen(port, host, () => server.close(() => resolve(false)));
  });
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
