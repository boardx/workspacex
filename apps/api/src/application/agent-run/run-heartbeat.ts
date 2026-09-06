import { withRunLease } from "./run-lease";
import type { OrgId } from "../../domain/org-id";
import { RUN_HEARTBEAT_INTERVAL_MS, type AgentRunStore } from "./ports";

/**
 * issue #2860 —— run 进行中每 `RUN_HEARTBEAT_INTERVAL_MS` 写一次心跳；进程死了心跳就停，
 * 回收器（`reclaimStaleRunning` / `sweepOrphanedRuns`）据此在 2 分钟内把它收敛成
 * `RUN_INTERRUPTED`，而不是像此前那样卡 `running` 20 分钟且要等人来读。心跳写失败只记
 * 日志，绝不影响 run 本身；`heartbeatRun` 是可选端口，缺席 ⇒ 不心跳（回收判据退回
 * started_at，与改动前逐字相同）。独立成文件是因为 `execute-run.ts` 有"薄网关"行数棘轮
 * （`execute-run-thin-gateway.test.ts`），不往那里堆。
 */
export async function withRunHeartbeat<T>(
  runs: Pick<AgentRunStore, "heartbeatRun">,
  log: (msg: string, detail: Record<string, unknown>) => void,
  orgId: OrgId,
  runId: string,
  work: () => Promise<T>,
  epoch?: number,
): Promise<T> {
  const execute=async()=>{
  const heartbeat = runs.heartbeatRun === undefined ? null : setInterval(() => {
    runs.heartbeatRun?.(orgId, runId).catch((e: unknown) => {
      log("agent run heartbeat failed", { runId, detail: e instanceof Error ? `${e.name}: ${e.message}` : "unknown" });
    });
  }, RUN_HEARTBEAT_INTERVAL_MS);
  heartbeat?.unref?.();
  try {
    return await work();
  } finally {
    if (heartbeat !== null) clearInterval(heartbeat);
  }
  };
  return epoch===undefined?execute():withRunLease({orgId,runId,epoch,verify:async()=>{await runs.heartbeatRun?.(orgId,runId);}},execute);
}
