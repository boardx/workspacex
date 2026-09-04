/**
 * `SubtaskRunStore` 的进程内存实现——issue #2664 明确允许的"最小可行"通路
 * （issue 原文：「如果现有架构里没有这条通路，你需要新增一个最小可行的」）。
 *
 * ## 已知取舍（跟着这份 MVP 走，不是意外遗漏）
 *
 * 进程重启即丢失队列内容——与 `agent_runs` 落 Postgres、跨进程/跨重启存活不同。可接受，
 * 因为子任务本身就是"主对话还在、agent 进程还活着"这段时间窗口内的派生工作，不是需要
 * 独立于主对话生命周期存在的记录。多副本部署下每个进程持有各自的队列，不互相领取——
 * 与生产要求的"多实例共享一个队列"不同，留作后续把持久层换成 Postgres 时的自然扩展点
 * （`SubtaskRunStore` 接口形状已经与实现解耦，替换实现不动调用方）。
 */
import { randomUUID } from "node:crypto";
import type { OrgId } from "../../domain/org-id";
import type {
  EnqueueSubtaskRunInput, SubtaskRun, SubtaskRunStore,
} from "../../application/agent-run/subtask-run-queue";

interface Row extends SubtaskRun {
  readonly orgId: string;
}

export class InMemorySubtaskRunStore implements SubtaskRunStore {
  private readonly rows = new Map<string, Row>();

  constructor(private readonly idFactory: () => string = () => randomUUID()) {}

  async enqueue(orgId: OrgId, input: EnqueueSubtaskRunInput): Promise<SubtaskRun> {
    const now = new Date().toISOString();
    const row: Row = {
      id: this.idFactory(),
      orgId: String(orgId),
      parentRunId: input.parentRunId,
      description: input.description,
      context: input.context ?? null,
      status: "pending",
      result: null,
      error: null,
      createdAt: now,
      updatedAt: now,
    };
    this.rows.set(row.id, row);
    return stripOrg(row);
  }

  async claimQueued(orgId: OrgId, limit: number): Promise<readonly SubtaskRun[]> {
    const claimed: Row[] = [];
    for (const row of this.rows.values()) {
      if (claimed.length >= limit) break;
      if (row.orgId !== String(orgId) || row.status !== "pending") continue;
      const running: Row = { ...row, status: "running", updatedAt: new Date().toISOString() };
      this.rows.set(row.id, running);
      claimed.push(running);
    }
    return claimed.map(stripOrg);
  }

  async complete(orgId: OrgId, id: string, result: string): Promise<void> {
    this.transition(orgId, id, { status: "completed", result, error: null });
  }

  async fail(orgId: OrgId, id: string, error: string): Promise<void> {
    this.transition(orgId, id, { status: "failed", result: null, error });
  }

  async get(orgId: OrgId, id: string): Promise<SubtaskRun | null> {
    const row = this.rows.get(id);
    if (!row || row.orgId !== String(orgId)) return null;
    return stripOrg(row);
  }

  private transition(
    orgId: OrgId, id: string,
    patch: Pick<Row, "status" | "result" | "error">,
  ): void {
    const row = this.rows.get(id);
    if (!row || row.orgId !== String(orgId)) return;
    this.rows.set(id, { ...row, ...patch, updatedAt: new Date().toISOString() });
  }
}

function stripOrg(row: Row): SubtaskRun {
  const { orgId: _orgId, ...rest } = row;
  return rest;
}
