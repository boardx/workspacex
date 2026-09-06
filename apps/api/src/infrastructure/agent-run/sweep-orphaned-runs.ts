import type { DatabasePort } from "../../application/ports/database.port";
import { DEFAULT_STALE_RUNNING_THRESHOLD_MS } from "../../application/agent-run/ports";

/**
 * issue #2860 —— 幽灵 run 回收器（跨租户、进程级）。
 *
 * `reclaimStaleRunning` 是按 org 的、被动触发的（同租户下一条消息 kick / 有人读那条 run），
 * 这在"进程重启"这个场景里正好是最没用的时候：没有人在 kick，用户刷新看到的是非终态、
 * 前端继续等一个永远不来的事件。这里用 `withoutTenant`（与 `sweepExpiredErrorLogs` 同一条
 * 通道）在 **API 启动时** 跑一次、之后每分钟跑一次，把心跳停了超过阈值的 `running` 收敛成
 * `failed(RUN_INTERRUPTED)`。判据与 `reclaimStaleRunning` 同一个（`coalesce(heartbeat_at,
 * started_at)` + `DEFAULT_STALE_RUNNING_THRESHOLD_MS`），不另立一套"多久算死"。
 *
 * 远端一致性：有 `remote_run_id` 的行顺手向 deep-agent-service 发一次 cancel（best-effort，
 * 失败只记日志）——本地判死了，远端那个 langgraph run 不该继续烧模型。
 *
 * 只收 `running`：`awaiting_tool_permission` 是在等人，`writeback_pending` 由下一次 tick 的
 * `writeBackPendingRuns` 重试，`queued` 由下一次 claim 接走。
 */
export interface OrphanedRun {
  readonly id: string;
  readonly orgId: string;
  readonly threadId: string;
  readonly remoteRunId: string | null;
}

export async function sweepOrphanedRuns(
  db: DatabasePort,
  options: { readonly reconcile?: (orgId: string) => Promise<unknown>; readonly olderThanMs?: number; readonly log?: (msg: string, detail?: Record<string, unknown>) => void } = {},
): Promise<readonly OrphanedRun[]> {
  const olderThanMs = options.olderThanMs ?? DEFAULT_STALE_RUNNING_THRESHOLD_MS;
  // 直接 `UPDATE agent_runs` 在 FORCE RLS 下影响 0 行（20260903130000 那次 worker 的同款坑，
  // 本 PR 实测复现）；走迁移里的 SECURITY DEFINER 函数，WHERE 与投影都焊在 SQL 里。
  const rows = await db.withoutTenant((s) => s.query<{ id: string; org_id: string; thread_id: string; remote_run_id: string | null }>(
    `SELECT id, org_id, thread_id, remote_run_id FROM kernel_reclaim_orphaned_agent_runs($1)`,
    [Math.max(60_000, Math.floor(olderThanMs))],
  ));
  const orphaned = rows.rows.map((r) => ({ id: r.id, orgId: r.org_id, threadId: r.thread_id, remoteRunId: r.remote_run_id }));
  if (orphaned.length > 0) {
    options.log?.("orphaned agent runs reclaimed", { count: orphaned.length, runIds: orphaned.map((r) => r.id) });
    for(const orgId of new Set(orphaned.map(run=>run.orgId))) await options.reconcile?.(orgId);
  }
  return orphaned;
}
