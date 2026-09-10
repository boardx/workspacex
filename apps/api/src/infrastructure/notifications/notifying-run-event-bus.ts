import type { AgentKernelRunStatus, KernelStreamEvent } from "@repo/contracts/streaming-transport";
import type { RunEventBusPort } from "../../application/agent-run/run-event-bus";
import type { NotificationPublisher } from "../../application/notifications/notification-center";
import type { DatabasePort } from "../../application/ports/database.port";
import type { OrgId } from "../../domain/org-id";
/**
 * 哪些 run 状态值得打扰用户、怎么说，以及**它是待办还是收据**（issue #3311）。
 * running/queued 不推——那是进行中，不是事实收据。
 *
 * `actionable: true` 的两条是**待办**：run 停在那儿等人类动手。它们的点击语义与收据不同
 * （送去能办的地方、不许看一眼就读掉），所以类别在这里**声明一次**、随通知存进库，
 * 前端不许拿标题字符串反推。
 */
export const RUN_STATUS_NOTICE: Partial<Record<AgentKernelRunStatus, { label: string; actionable: boolean }>> = {
  succeeded: { label: "已完成", actionable: false },
  failed: { label: "执行失败", actionable: false },
  paused: { label: "已暂停", actionable: false },
  awaiting_plan_confirmation: { label: "等待你确认计划", actionable: true },
  awaiting_tool_permission: { label: "等待你授权工具", actionable: true },
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
    const notice = RUN_STATUS_NOTICE[status];
    if (!notice) return;
    try {
      const row = (await this.db.withTenant(orgId, (s) => s.query<{ author_id: string; thread_id: string; title: string }>(
        `SELECT m.author_id, r.thread_id, t.title FROM agent_runs r
           JOIN chat_messages m ON m.org_id=r.org_id AND m.id=r.input_message_id
           JOIN chat_threads t ON t.org_id=r.org_id AND t.id=r.thread_id
          WHERE r.org_id=$1 AND r.id=$2 AND m.author_kind='human'`, [orgId, runId],
      ))).rows[0];
      if (!row) return;
      // 同一条 run 往前走一步，之前那条"等你授权/确认"的**待办**就不再待办了——把它读掉（#3311）。
      // 不这么做，待办通知因为"点开不读掉"会永远挂在角标上：那是拿一个卡死的角标换掉
      // 原来的"读掉并丢弃"，不是修好。走通知中心自己那道有租户/收件人绑定的口子，
      // 不在这里另开一条裸 SQL（`lint-permission-paths` 钉住了本文件只许有一条 run 查询）。
      await this.notifications.supersede({ orgId, userId: row.author_id },
        { sourceKeyPrefix: `run:${runId}:%`, exceptSourceKey: `run:${runId}:${status}` });
      await this.notifications.publish({
        orgId, userId: row.author_id, kind: "task", title: `${row.title || "对话"} · ${notice.label}`,
        body: notice.actionable ? `任务${notice.label}，点开去处理。` : `任务${notice.label}，点开查看结果。`,
        threadId: row.thread_id, sourceKey: `run:${runId}:${status}`, actionable: notice.actionable,
      });
    } catch (err) {
      this.log("run status notification failed", { runId, status, err });
    }
  }
}
