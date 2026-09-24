/**
 * backlog E3 —— `first_value_facts` 的租户内读写（迁移 `20260924210000_first_value_facts.sql`）。
 * 先写者胜落在 SQL：`ON CONFLICT (org_id, step) DO NOTHING`。`org_kind` 由 organizations.kind
 * 派生，不由调用方自报。步名只接受契约 `FirstValueStep` 枚举（唯一事实源）。
 */
import { firstValueEvents as FV } from "@repo/contracts";
import type { DatabasePort } from "../../application/ports/database.port";
import type { FirstValueFactStore, FirstValueStep } from "../../application/first-value/first-value-recorder";
import type { OrgId } from "../../domain/org-id";

const INSERT_SQL = `INSERT INTO first_value_facts (org_id, org_kind, step, occurred_at)
SELECT o.id, o.kind, $2, $3 FROM organizations o WHERE o.id = $1
ON CONFLICT (org_id, step) DO NOTHING`;

const LIST_SQL = `SELECT step, occurred_at FROM first_value_facts WHERE org_id = $1 ORDER BY occurred_at`;

export class PgFirstValueFacts implements FirstValueFactStore {
  constructor(private readonly db: DatabasePort) {}

  async recordFirst(orgId: OrgId, step: FirstValueStep, at: Date): Promise<void> {
    const parsed = FV.FirstValueStep.parse(step);
    await this.db.withTenant(orgId, (s) => s.query(INSERT_SQL, [orgId, parsed, at]));
  }

  async listForOrg(orgId: OrgId): Promise<readonly { step: FirstValueStep; occurredAt: Date }[]> {
    const rows = await this.db.withTenant(orgId, async (s) =>
      (await s.query<{ step: string; occurred_at: Date }>(LIST_SQL, [orgId])).rows);
    const out: { step: FirstValueStep; occurredAt: Date }[] = [];
    for (const r of rows) {
      const step = FV.FirstValueStep.safeParse(r.step);
      if (step.success) out.push({ step: step.data, occurredAt: new Date(r.occurred_at) });
    }
    return out;
  }
}
