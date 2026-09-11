import { randomUUID } from "node:crypto";
import { mkdir, open, lstat, rename, unlink } from "node:fs/promises";
import { join } from "node:path";

export class UncertainProvisionStateError extends Error {}

export const provisionStages = ["preflight", "secrets", "dependencies", "migrate", "bootstrap", "start", "readiness", "business-probe"] as const;
export type ProvisionStage = typeof provisionStages[number];
export type ProvisionAction = (context: { signal: AbortSignal; remainingMs: () => number }) => Promise<void>;
export type ProvisionActions = Record<ProvisionStage, ProvisionAction>;
export interface ProvisionReport {
  attemptId: string;
  startedAt: string;
  /** Time through all actions and intermediate reports; terminal report I/O is separate. */
  durationMs: number;
  status: "running" | "passed" | "failed";
  code?: "DEADLINE_EXCEEDED" | "STAGE_FAILED" | "CANCELLED";
  lockRetained: boolean;
  stages: { name: ProvisionStage; durationMs: number; status: "passed" | "failed" }[];
}

/** The caller supplies real deployment actions. Passing this core's tests is not cloud acceptance.
 * Never skips stages on retry: each real action must implement its own idempotent behavior.
 * Timeout/cancellation retains the lock because a custom action may ignore its AbortSignal.
 */
export async function provision(options: {
  stateDirectory: string;
  actions: ProvisionActions;
  signal?: AbortSignal;
  deadlineMs?: number;
}): Promise<ProvisionReport> {
  const start = performance.now();
  const startedAt = new Date().toISOString();
  const budget = options.deadlineMs ?? 300_000;
  if (!Number.isSafeInteger(budget) || budget <= 0 || budget > 300_000) throw new Error("INVALID_DEADLINE");
  for (const name of provisionStages) if (typeof options.actions[name] !== "function") throw new Error("MISSING_STAGE");
  const remainingMs = () => Math.max(0, budget - (performance.now() - start));
  const report: ProvisionReport = { attemptId: randomUUID(), startedAt, durationMs: 0, status: "running", lockRetained: false, stages: [] };
  await mkdir(options.stateDirectory, { recursive: true, mode: 0o700 });
  const dir = await lstat(options.stateDirectory);
  if (!dir.isDirectory() || dir.isSymbolicLink() || (dir.mode & 0o077) !== 0) throw new Error("UNSAFE_STATE_DIRECTORY");
  const lockPath = join(options.stateDirectory, "provision.lock");
  const lock = await open(lockPath, "wx", 0o600).catch(() => { throw new Error("DEPLOYMENT_LOCK_UNAVAILABLE"); });
  let release = false;
  const path = join(options.stateDirectory, `${report.attemptId}.json`);
  const save = async () => {
    if (report.status === "running") report.durationMs = Math.round(performance.now() - start);
    const temporary = `${path}.${randomUUID()}.tmp`;
    const handle = await open(temporary, "wx", 0o600);
    try { await handle.writeFile(JSON.stringify(report, null, 2) + "\n"); await handle.sync(); }
    finally { await handle.close(); }
    await rename(temporary, path);
    const directory = await open(options.stateDirectory, "r");
    try { await directory.sync(); } finally { await directory.close(); }
  };
  const controller = new AbortController();
  let reason: "DEADLINE_EXCEEDED" | "CANCELLED" | undefined;
  const abort = (code: typeof reason) => { reason ??= code; controller.abort(); };
  const cancelled = () => abort("CANCELLED");
  options.signal?.addEventListener("abort", cancelled, { once: true });
  if (options.signal?.aborted) cancelled();
  const timer = setTimeout(() => abort("DEADLINE_EXCEEDED"), remainingMs());
  try {
    await lock.writeFile(JSON.stringify({ attemptId: report.attemptId, pid: process.pid, startedAt }));
    await lock.sync();
    await save();
    for (const name of provisionStages) {
      const stageStart = performance.now();
      let rejectAbort: (() => void) | undefined;
      try {
        if (remainingMs() <= 0) abort("DEADLINE_EXCEEDED");
        if (controller.signal.aborted) throw new Error("ABORTED");
        const interrupted = new Promise<never>((_, reject) => {
          rejectAbort = () => reject(new Error("ABORTED"));
          controller.signal.addEventListener("abort", rejectAbort, { once: true });
        });
        await Promise.race([options.actions[name]({ signal: controller.signal, remainingMs }), interrupted]);
        if (remainingMs() <= 0) abort("DEADLINE_EXCEEDED");
        if (controller.signal.aborted) throw new Error("ABORTED");
        report.stages.push({ name, durationMs: Math.round(performance.now() - stageStart), status: "passed" });
        await save();
      } catch (error) {
        report.stages = report.stages.filter(stage => stage.name !== name);
        report.stages.push({ name, durationMs: Math.round(performance.now() - stageStart), status: "failed" });
        report.durationMs = Math.round(performance.now() - start);
        report.status = "failed";
        report.code = reason ?? "STAGE_FAILED";
        report.lockRetained = controller.signal.aborted || error instanceof UncertainProvisionStateError;
        await save();
        release = !report.lockRetained;
        return report;
      } finally {
        if (rejectAbort) controller.signal.removeEventListener("abort", rejectAbort);
      }
    }
    // Freeze the measured completion instant before publishing a single terminal state.
    // Terminal report fsync is bookkeeping outside this action budget; never publish
    // passed and subsequently revise it to failed because that fsync was slow.
    report.durationMs = Math.round(performance.now() - start);
    if (remainingMs() <= 0) abort("DEADLINE_EXCEEDED");
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", cancelled);
    if (controller.signal.aborted) {
      report.status = "failed";
      report.code = reason ?? "DEADLINE_EXCEEDED";
      report.lockRetained = true;
    } else report.status = "passed";
    await save();
    release = !report.lockRetained;
    return report;
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", cancelled);
    await lock.close();
    // Unknown/reporting failures retain the lock. Never auto-recover based on PID alone.
    if (release) await unlink(lockPath);
  }
}
