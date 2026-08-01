/**
 * `ApprovalModelRegistryReader` 的 PostgreSQL 实现（F112 · I-31）。
 *
 * 读的是 F48 建的 `models` 表（`0019-f48-model-pool.sql`），窄取批准卡需要的三列。
 * ⚠ 这里**不**判断 `status`——批准卡展示的是「agent 提议使用哪个模型」，模型是否
 * `已启用` 是 `routeModelCall`（F51）在真正发起调用时才把关的事，与本读口无关；
 * 把「未启用即查不到」塞进这里会让 `REGISTRY_UNAVAILABLE` 与「模型未启用」这两件不同的
 * 事共用一个错误码，而契约里两者本来就没有对应关系（见 `create-approval-request.ts`
 * 文件头对这一批错误码映射的说明）。
 */
import type { DatabasePort } from "../../application/ports/database.port";
import type { ApprovalModelRegistryReader } from "../../application/chat/approval-model-registry";
import type { ApprovalModelRow } from "../../domain/chat/approval-gate";
import type { OrgId } from "../../domain/org-id";

interface ModelDbRow {
  id: string;
  kind: string;
  display_name: string;
  unit_price: string;
}

export class PgApprovalModelRegistryReader implements ApprovalModelRegistryReader {
  constructor(private readonly db: DatabasePort) {}

  async findModels(orgId: OrgId, modelIds: readonly string[]): Promise<readonly ApprovalModelRow[]> {
    if (modelIds.length === 0) return [];
    return this.db.withTenant(orgId, async (s) => {
      const r = await s.query<ModelDbRow>(
        `SELECT id, kind, display_name, unit_price
           FROM models WHERE org_id = $1 AND id = ANY($2::text[])`,
        [orgId, modelIds],
      );
      return r.rows.map((row) => ({
        modelId: row.id,
        kind: row.kind as ApprovalModelRow["kind"],
        displayName: row.display_name,
        // numeric(12,6) 经驱动读回是字符串，避免浮点精度在传输层被悄悄改写。
        unitPrice: Number(row.unit_price),
      }));
    });
  }
}
