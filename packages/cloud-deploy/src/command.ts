import { spawn } from "node:child_process";

export class CommandExecutionError extends Error {
  constructor(readonly exitCode: number | null) { super("COMMAND_FAILED"); }
}

type Command = { executable: string; args: readonly string[]; cwd: string; env: NodeJS.ProcessEnv };
type Context = { signal: AbortSignal; remainingMs: () => number };

/** Run argv, never a shell string. stderr is not copied to reports because SDKs can leak secrets.
 * POSIX process groups keep ordinary child processes from outliving cancellation.
 */
export async function runProvisionCommand(command: Command, context: Context): Promise<void> {
  await execute(command, context, false);
}

/** Bounded stdout is only for structured tools such as docker inspect; callers must not
 * publish its contents as error details. Credentials never belong on argv.
 */
export async function captureProvisionCommand(command: Command, context: Context): Promise<string> {
  return execute(command, context, true);
}

async function execute(command: Command, context: Context, capture: boolean): Promise<string> {
  if (context.signal.aborted || context.remainingMs() <= 0) throw new Error("COMMAND_CANCELLED");
  if (process.platform === "win32") throw new Error("UNSUPPORTED_PROVISION_PLATFORM");
  return new Promise<string>((resolve, reject) => {
    const child = spawn(command.executable, [...command.args], {
      cwd: command.cwd, env: command.env, shell: false, detached: true, stdio: ["ignore", capture ? "pipe" : "ignore", "ignore"],
    });
    let failure: string | undefined;
    const chunks: Buffer[] = [];
    let bytes = 0;
    const stop = () => {
      failure ??= "COMMAND_CANCELLED";
      if (child.pid) {
        try { process.kill(-child.pid, "SIGKILL"); }
        catch { try { child.kill("SIGKILL"); } catch { /* close/error determines result */ } }
      }
    };
    child.stdout?.on("data", (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > 65_536) { failure = "COMMAND_OUTPUT_LIMIT"; stop(); }
      else chunks.push(chunk);
    });
    context.signal.addEventListener("abort", stop, { once: true });
    if (context.signal.aborted) stop();
    child.once("error", () => {
      context.signal.removeEventListener("abort", stop);
      reject(new Error("COMMAND_START_FAILED"));
    });
    child.once("close", (code) => {
      context.signal.removeEventListener("abort", stop);
      if (failure) reject(new Error(failure));
      else if (code !== 0) reject(new CommandExecutionError(code));
      else resolve(Buffer.concat(chunks).toString("utf8"));
    });
  });
}
