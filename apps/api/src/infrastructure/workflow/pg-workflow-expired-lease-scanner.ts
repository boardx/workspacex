/**
 * WF03 —— `WorkflowExpiredLeaseScanner` 的 PostgreSQL 实现：迁移 20260929040000 的 wf_expired_lease_instances 薄封装。
 * 只调函数、不点表名：两张表都是 FORCE RLS，跨组织读只经这个只返回标识的 SECURITY DEFINER 函数。
 */
import type { DatabasePort } from "../../application/ports/database.port";
import type { WorkflowExpiredLeaseScanner } from "../../application/workflow/workflow-runtime-ports";

export class PgWorkflowExpiredLeaseScanner implements WorkflowExpiredLeaseScanner {
  constructor(private readonly db: DatabasePort) {}

  async expired(limit: number): Promise<Array<{ orgId: string; instanceId: string }>> {
    const r = await this.db.withoutTenant((s) =>
      s.query<{ org_id: string; instance_id: string }>(
        "SELECT org_id, instance_id FROM wf_expired_lease_instances($1)",
        [limit],
      ),
    );
    return r.rows.map((x) => ({ orgId: x.org_id, instanceId: x.instance_id }));
  }
}
