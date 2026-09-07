import { spawn } from "node:child_process";
import { sessionLimits } from "./schema.js";
import { access, open } from "node:fs/promises";

export interface SessionExecutionResult {
  executionId: string;
  exitCode: number | null;
  output: string;
  truncated: boolean;
  timedOut: boolean;
  cancelled: boolean;
}
export interface SessionExecutionInput {
  executionId: string;
  command: string;
  timeoutMs: number;
  workspace: string;
  skills: string;
  inputs?: string;
  signal: AbortSignal;
}
export interface SessionExecutionProvider {
  probe(): Promise<boolean>;
  execute(input: SessionExecutionInput): Promise<SessionExecutionResult>;
}

/** No host root bind, socket mount, inherited environment or shared PID namespace. */
export function bubblewrapArguments(workspace: string, skills: string, inputs?: string): string[] {
  return ["--unshare-all", "--unshare-user", "--die-with-parent", "--new-session",
    "--cap-drop", "ALL", "--clearenv",
    "--ro-bind", "/usr", "/usr", "--ro-bind", "/lib", "/lib",
    "--ro-bind-try", "/lib64", "/lib64", "--ro-bind", "/bin", "/bin",
    "--ro-bind", "/opt/sandbox/node_modules", "/opt/sandbox/node_modules",
    "--dev", "/dev", "--tmpfs", "/tmp",
    "--bind", workspace, "/workspace", "--ro-bind", skills, "/skills",
    ...(inputs ? ["--ro-bind", inputs, "/inputs"] : []),
    "--setenv", "PATH", "/usr/local/bin:/usr/bin:/bin",
    "--setenv", "HOME", "/tmp", "--setenv", "TMPDIR", "/tmp",
    "--setenv", "NODE_PATH", "/opt/sandbox/node_modules",
    "--chdir", "/workspace"];
}

export class BubblewrapProvider implements SessionExecutionProvider {
  constructor(private readonly binary = "/usr/bin/bwrap", private readonly filter = "/opt/sandbox/session-seccomp.bpf") {}

  async probe(): Promise<boolean> {
    if (process.platform !== "linux") return false;
    try {
      await access(this.binary);
      // This only executes a fixed, trusted probe; actual policy is also probed per execution.
      const result = await this.run(["--unshare-all", "--unshare-user", "--die-with-parent",
        "--new-session", "--cap-drop", "ALL", "--ro-bind", "/usr", "/usr",
        "--ro-bind", "/lib", "/lib", "--ro-bind-try", "/lib64", "/lib64",
        "--clearenv", "--", "/usr/bin/true"], "probe", 5000, new AbortController().signal);
      return result.exitCode === 0;
    } catch { return false; }
  }

  execute(input: SessionExecutionInput): Promise<SessionExecutionResult> {
    if (process.platform !== "linux") throw new Error("SESSION_EXECUTION_UNAVAILABLE");
    return this.run([...bubblewrapArguments(input.workspace, input.skills, input.inputs),
      "--", "/bin/sh", "-c", input.command], input.executionId, input.timeoutMs, input.signal);
  }

  private async run(args: string[], executionId: string, timeoutMs: number, signal: AbortSignal): Promise<SessionExecutionResult> {
    const filter = await open(this.filter, "r");
    try {
    return await new Promise<SessionExecutionResult>((resolve, reject) => {
      const child = spawn(this.binary, ["--seccomp", "3", ...args], { env: {}, detached: true, stdio: ["ignore", "pipe", "pipe", filter.fd] });
      let output = Buffer.alloc(0);
      let truncated = false;
      let timedOut = false;
      let cancelled = false;
      const collect = (chunk: Buffer) => {
        const available = Math.max(0, sessionLimits.maxOutputBytes! - output.length);
        if (chunk.length > available) truncated = true;
        if (available > 0) output = Buffer.concat([output, chunk.subarray(0, available)]);
      };
      child.stdout!.on("data", collect);
      child.stderr!.on("data", collect);
      const kill = () => {
        if (child.pid) try { process.kill(-child.pid, "SIGKILL"); } catch { child.kill("SIGKILL"); }
      };
      const abort = () => { cancelled = true; kill(); };
      const timer = setTimeout(() => { timedOut = true; kill(); }, timeoutMs);
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) abort();
      const cleanup = () => { clearTimeout(timer); signal.removeEventListener("abort", abort); };
      child.once("error", (error) => { cleanup(); reject(error); });
      child.once("close", (exitCode) => {
        cleanup();
        resolve({ executionId, exitCode, output: output.toString("utf8"), truncated, timedOut, cancelled });
      });
    });
    } finally { await filter.close(); }
  }
}
