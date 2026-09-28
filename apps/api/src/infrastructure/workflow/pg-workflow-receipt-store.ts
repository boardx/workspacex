/**
 * WF02/WF04 —— `WorkflowReceiptStore` 的 PostgreSQL 适配器（workflow_receipts）。
 *
 * begin：单条 INSERT … ON CONFLICT DO NOTHING；没插进去就读回那行判定 replay / in_flight / 指纹冲突。
 * finalize：只把 begun 且指纹一致的行置 finalized；已 finalized 时读回首次稳定响应（I-7 由触发器
 * wf_receipt_immutable 在库里兜底，不靠本文件自觉）。
 * find/resolveBegun（WF04）：崩溃恢复对账用——不比对指纹（恢复路径未必拿得到原始载荷），只把
 * 仍是 begun 的行迁到 reconciled/unresolved 终态（domain I-14）；触发器把这两个终态也锁死。
 */
import type { DatabasePort, TenantSession } from "../../application/ports/database.port";
import type { WorkflowReceiptBegin, WorkflowReceiptKey, WorkflowReceiptRow, WorkflowReceiptScope, WorkflowReceiptStore } from "../../application/workflow/workflow-ports";
import { WorkflowUseCaseError } from "../../application/workflow/workflow-errors";
import { toOrgId } from "../../domain/org-id";

interface ReceiptRow {
  fingerprint: string;
  status: "begun" | "finalized" | "reconciled" | "unresolved";
  instance_id: string | null;
  checkpoint_id: string | null;
  stable_response: unknown;
}

async function readRow(s: TenantSession, k: WorkflowReceiptKey): Promise<ReceiptRow> {
  const { rows } = await s.query<ReceiptRow>(
    `SELECT fingerprint, status, instance_id, checkpoint_id, stable_response
       FROM workflow_receipts WHERE org_id = $1 AND scope = $2 AND request_key = $3`,
    [k.orgId, k.scope, k.requestKey],
  );
  const row = rows[0];
  if (!row) throw new Error(`workflow receipt ${k.scope}/${k.requestKey} vanished`);
  if (row.fingerprint !== k.fingerprint) {
    throw new WorkflowUseCaseError("idempotency_key_reused", "request key reused with a different payload");
  }
  return row;
}

export class PgWorkflowReceiptStore implements WorkflowReceiptStore {
  constructor(private readonly db: DatabasePort) {}

  begin(k: WorkflowReceiptKey): Promise<WorkflowReceiptBegin> {
    return this.db.withTenant(toOrgId(k.orgId), async (s) => {
      const inserted = await s.query(
        `INSERT INTO workflow_receipts (org_id, scope, request_key, fingerprint, status)
         VALUES ($1, $2, $3, $4, 'begun') ON CONFLICT (org_id, scope, request_key) DO NOTHING RETURNING request_key`,
        [k.orgId, k.scope, k.requestKey, k.fingerprint],
      );
      if (inserted.rows.length === 1) return { kind: "begun" };
      const row = await readRow(s, k);
      // `reconciled` 与 `finalized` 对调用方是同一件事——已确认完成、不得二次调用工具——所以按
      // 同一支 replay 分支回；`reconciled` 的 stable_response 通常是 null（对账只读确认，没有工具
      // 返回值可存），调用方（EffectGateway.execute）已经把 null 归一成 `{}`（WF04 review #2：这是
      // 生产恢复路径「reconcile 之后不再无限撞 in_flight」的关键一环）。
      return row.status === "finalized" || row.status === "reconciled"
        ? { kind: "replay", stableResponse: row.stable_response, checkpointId: row.checkpoint_id, instanceId: row.instance_id }
        : { kind: "in_flight", instanceId: row.instance_id };
    });
  }

  finalize(
    k: WorkflowReceiptKey,
    result: { stableResponse: unknown; checkpointId: string | null; instanceId: string | null },
  ): Promise<unknown> {
    const json = JSON.stringify(result.stableResponse);
    if (json === undefined) {
      return Promise.reject(new Error(`workflow receipt ${k.scope}/${k.requestKey}: stableResponse must be JSON-serializable (got undefined)`));
    }
    return this.db.withTenant(toOrgId(k.orgId), async (s) => {
      const updated = await s.query<{ stable_response: unknown }>(
        `UPDATE workflow_receipts
            SET status = 'finalized', stable_response = $5::jsonb, checkpoint_id = $6, instance_id = $7, finalized_at = now()
          WHERE org_id = $1 AND scope = $2 AND request_key = $3 AND fingerprint = $4 AND status = 'begun'
          RETURNING stable_response`,
        [k.orgId, k.scope, k.requestKey, k.fingerprint, json, result.checkpointId, result.instanceId],
      );
      if (updated.rows[0]) return updated.rows[0].stable_response;
      const row = await readRow(s, k);
      if (row.status !== "finalized") throw new Error(`workflow receipt ${k.scope}/${k.requestKey} is not finalizable`);
      return row.stable_response;
    });
  }

  find(orgId: string, scope: WorkflowReceiptScope, requestKey: string): Promise<WorkflowReceiptRow | null> {
    return this.db.withTenant(toOrgId(orgId), async (s) => {
      const { rows } = await s.query<ReceiptRow>(
        `SELECT fingerprint, status, instance_id, checkpoint_id, stable_response
           FROM workflow_receipts WHERE org_id = $1 AND scope = $2 AND request_key = $3`,
        [orgId, scope, requestKey],
      );
      const row = rows[0];
      if (!row) return null;
      return { status: row.status, instanceId: row.instance_id, checkpointId: row.checkpoint_id, stableResponse: row.stable_response };
    });
  }

  resolveBegun(orgId: string, scope: WorkflowReceiptScope, requestKey: string, outcome: "reconciled" | "unresolved"): Promise<void> {
    return this.db.withTenant(toOrgId(orgId), async (s) => {
      await s.query(
        `UPDATE workflow_receipts SET status = $4
          WHERE org_id = $1 AND scope = $2 AND request_key = $3 AND status = 'begun'`,
        [orgId, scope, requestKey, outcome],
      );
    });
  }
}
