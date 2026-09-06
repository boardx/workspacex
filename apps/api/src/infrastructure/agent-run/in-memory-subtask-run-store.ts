/**
 * `SubtaskRunStore` 的内存测试实现。WX-T042 生产绑定已切到 PgSubtaskRunStore，
 * 此类保留便于应用层测试；重启/多进程持久化只由 Postgres adapter 提供。
 */
import { SubtaskIdempotencyConflictError } from "../../application/agent-run/subtask-run-queue";
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
  private readonly idempotency = new Map<string, string>();

  constructor(private readonly idFactory: () => string = () => randomUUID()) {}

  async enqueue(orgId: OrgId, input: EnqueueSubtaskRunInput): Promise<SubtaskRun> {
    const key = input.idempotencyKey === undefined ? undefined : JSON.stringify([orgId,input.parentRunId,input.idempotencyKey]);
    const existing = key === undefined ? undefined : this.rows.get(this.idempotency.get(key) ?? "");
    if (existing) {
      if (existing.description !== input.description || existing.context !== (input.context ?? null)) {
        throw new SubtaskIdempotencyConflictError("subtask_idempotency_conflict");
      }
      return stripOrg(existing);
    }
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
    if (key !== undefined) this.idempotency.set(key,row.id);
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

  async listByParentRun(orgId: OrgId, parentRunId: string): Promise<readonly SubtaskRun[]> {
    const rows = [...this.rows.values()]
      .filter((row) => row.orgId === String(orgId) && row.parentRunId === parentRunId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    return rows.map(stripOrg);
  }

  private transition(
    orgId: OrgId, id: string,
    patch: Pick<Row, "status" | "result" | "error">,
  ): void {
    const row = this.rows.get(id);
    if (!row || row.orgId !== String(orgId) || row.status !== "running") return;
    this.rows.set(id, { ...row, ...patch, updatedAt: new Date().toISOString() });
  }
}

function stripOrg(row: Row): SubtaskRun {
  const { orgId: _orgId, ...rest } = row;
  return rest;
}
