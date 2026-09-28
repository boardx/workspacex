/**
 * WF02 —— `WorkflowLeaseStore` 的 PostgreSQL 适配器（workflow_leases，domain I-16 / R4-E2）。
 *
 * 获取 = epoch CAS：先读观察到的 epoch，再用**一条**语句
 *   INSERT … ON CONFLICT (instance_id) DO UPDATE SET epoch = epoch + 1 … WHERE epoch = <observed> AND expires_at <= now()
 * 只有观察值未变且旧 lease 已过期时才推进。两个 worker 并发：ON CONFLICT 锁住行，后到者按新行重评 WHERE
 * （epoch 已变）→ 0 行 → lease_conflict。时间一律取库时钟 now()，不信进程时钟。
 * 租户一致：lease 以 (instance_id, org_id) 复合 FK 指向实例，他组织的 instanceId → 23503 → workflow_not_found。
 * 其余意外的唯一/RLS 冲突（23505 / 42501）一律映射为 lease_conflict，不把裸 PG 错误漏给调用方。
 *
 * 已知限制：assertLease 是 check-then-act，effect receipt 尚未记录 lease epoch 作 fencing token；
 * WF04 的 effect receipt 应在 finalize 时带 epoch 校验以拒绝迟到写者。
 */
import type { DatabasePort } from "../../application/ports/database.port";
import type { WorkflowLease, WorkflowLeaseStore } from "../../application/workflow/workflow-ports";
import { WorkflowLeaseLostError, WorkflowUseCaseError } from "../../application/workflow/workflow-errors";
import { toOrgId } from "../../domain/org-id";

export class PgWorkflowLeaseStore implements WorkflowLeaseStore {
  constructor(private readonly db: DatabasePort) {}

  acquire(input: { orgId: string; instanceId: string; holder: string; ttlMs: number }): Promise<WorkflowLease> {
    if (!Number.isInteger(input.ttlMs) || input.ttlMs <= 0) throw new Error("lease ttlMs must be a positive integer");
    return this.db.withTenant(toOrgId(input.orgId), async (s) => {
      const seen = await s.query<{ epoch: string }>(
        "SELECT epoch FROM workflow_leases WHERE org_id = $1 AND instance_id = $2",
        [input.orgId, input.instanceId],
      );
      const observed = seen.rows[0] ? Number(seen.rows[0].epoch) : 0;
      const won = await s.query<{ epoch: string }>(
        `INSERT INTO workflow_leases (instance_id, org_id, holder, epoch, expires_at)
         VALUES ($1, $2, $3, 1, now() + make_interval(secs => $5::double precision / 1000))
         ON CONFLICT (instance_id) DO UPDATE
            SET holder = EXCLUDED.holder, epoch = workflow_leases.epoch + 1,
                expires_at = EXCLUDED.expires_at, acquired_at = now()
          WHERE workflow_leases.epoch = $4 AND workflow_leases.expires_at <= now()
         RETURNING epoch`,
        [input.instanceId, input.orgId, input.holder, observed, input.ttlMs],
      ).catch((e: unknown) => {
        throw mapAcquireError(e, input.instanceId);
      });
      const row = won.rows[0];
      if (!row) throw new WorkflowUseCaseError("lease_conflict", `instance ${input.instanceId} is leased by another worker`);
      return { orgId: input.orgId, instanceId: input.instanceId, holder: input.holder, epoch: Number(row.epoch) };
    });
  }

  assertLease(lease: WorkflowLease): Promise<void> {
    return this.db.withTenant(toOrgId(lease.orgId), async (s) => {
      const { rows } = await s.query<{ epoch: string; holder: string; live: boolean }>(
        "SELECT epoch, holder, expires_at > now() AS live FROM workflow_leases WHERE org_id = $1 AND instance_id = $2",
        [lease.orgId, lease.instanceId],
      );
      const row = rows[0];
      const current = row ? Number(row.epoch) : null;
      if (!row || current !== lease.epoch || row.holder !== lease.holder || !row.live) {
        throw new WorkflowLeaseLostError(lease.instanceId, lease.epoch, current);
      }
    });
  }

  async release(lease: WorkflowLease): Promise<void> {
    await this.db.withTenant(toOrgId(lease.orgId), (s) =>
      s.query(
        `UPDATE workflow_leases SET expires_at = now()
          WHERE org_id = $1 AND instance_id = $2 AND epoch = $3 AND holder = $4 AND expires_at > now()`,
        [lease.orgId, lease.instanceId, lease.epoch, lease.holder],
      ),
    );
  }
}

function mapAcquireError(e: unknown, instanceId: string): unknown {
  const code = (e as { code?: unknown } | null)?.code;
  if (code === "23503") return new WorkflowUseCaseError("workflow_not_found", `workflow instance ${instanceId} not found`);
  if (code === "23505" || code === "42501") {
    return new WorkflowUseCaseError("lease_conflict", `instance ${instanceId} is leased by another worker`);
  }
  return e;
}
