import type { AgentKernelRunStatus, KernelStreamEvent } from "@repo/contracts/streaming-transport";
import type { RunEventBusPort } from "../../application/agent-run/run-event-bus";
import type { NotificationPublisher } from "../../application/notifications/notification-center";
import type { DatabasePort } from "../../application/ports/database.port";
import type { OrgId } from "../../domain/org-id";
/** 哪些 run 状态值得打扰用户，以及怎么说。running/queued 不推——那是进行中，不是事实收据。 */
export const RUN_STATUS_NOTICE: Partial<Record<AgentKernelRunStatus, string>> = {
  succeeded: "已完成", failed: "执行失败", paused: "已暂停",
  awaiting_plan_confirmation: "等待你确认计划", awaiting_tool_permission: "等待你授权工具",
};
/**
 * 装饰 `RUN_EVENT_BUS`：每条 `status_change` 照常广播给 WS 订阅者，同时把"值得打扰"的
 * 状态变成一条通知推给发起这次 run 的人。去重靠 `sourceKey=run:<id>:<status>`。
 * 推送失败只记日志，绝不反向影响 run 本身（与事件总线 fire-and-forget 的约定一致）。
 */
export class NotifyingRunEventBus implements RunEventBusPort {
  constructor(
    private readonly inner: RunEventBusPort,
    private readonly db: DatabasePort,
    private readonly notifications: NotificationPublisher,
    private readonly log: (message: string, detail: Record<string, unknown>) => void,
  ) {}
  publish(orgId: OrgId, runId: string, build: (seq: number) => KernelStreamEvent): void {
    let published: KernelStreamEvent | null = null;
    this.inner.publish(orgId, runId, (seq) => { published = build(seq); return published; });
    const event = published as KernelStreamEvent | null;
    if (event?.type === "status_change") void this.notify(orgId, runId, event.status);
  }
  subscribe(orgId: OrgId, runId: string, afterSeq: number, onEvent: (event: KernelStreamEvent) => void): () => void {
    return this.inner.subscribe(orgId, runId, afterSeq, onEvent);
  }
  private async notify(orgId: OrgId, runId: string, status: AgentKernelRunStatus): Promise<void> {
    const label = RUN_STATUS_NOTICE[status];
    if (!label) return;
    try {
      const row = (await this.db.withTenant(orgId, (s) => s.query<{ author_id: string; thread_id: string; title: string }>(
        `SELECT m.author_id, r.thread_id, t.title FROM agent_runs r
           JOIN chat_messages m ON m.org_id=r.org_id AND m.id=r.input_message_id
           JOIN chat_threads t ON t.org_id=r.org_id AND t.id=r.thread_id
          WHERE r.org_id=$1 AND r.id=$2 AND m.author_kind='human'`, [orgId, runId],
      ))).rows[0];
      if (!row) return;
      await this.notifications.publish({
        orgId, userId: row.author_id, kind: "task", title: `${row.title || "对话"} · ${label}`,
        body: `任务${label}，点开查看结果。`, threadId: row.thread_id, sourceKey: `run:${runId}:${status}`,
      });
    } catch (err) {
      this.log("run status notification failed", { runId, status, err });
    }
  }
}
