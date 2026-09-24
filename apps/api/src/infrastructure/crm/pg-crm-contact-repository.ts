/**
 * D3 —— `crm_contacts` 的 PostgreSQL 实现。见迁移 `20260924200000_crm_contacts.sql`。
 * 每个事务先设 `app.crm_operator = on`（事务级）——RLS 只对这个会话标记放行。
 * 调用方必须已过 PlatformOperatorGuard；会话标记是纵深防御，不是鉴权本身。
 */
import type { DatabasePort, TenantSession } from "../../application/ports/database.port";
import type { CrmContact, CrmContactFields, CrmContactRepository } from "../../application/crm/crm-contact-ports";

interface Row {
  lead_id: string;
  name: string;
  company: string | null;
  phone: string | null;
  email: string | null;
  notes: string | null;
  created_at: Date;
  updated_at: Date;
}

const COLS = "lead_id, name, company, phone, email, notes, created_at, updated_at";
const FIELDS = ["name", "company", "phone", "email", "notes"] as const;

const toContact = (r: Row): CrmContact => ({
  leadId: r.lead_id, name: r.name, company: r.company, phone: r.phone, email: r.email, notes: r.notes,
  createdAt: r.created_at.toISOString(), updatedAt: r.updated_at.toISOString(),
});

export class PgCrmContactRepository implements CrmContactRepository {
  constructor(private readonly db: DatabasePort) {}

  private asOperator<T>(fn: (s: TenantSession) => Promise<T>): Promise<T> {
    return this.db.withoutTenant(async (s) => {
      await s.query("SELECT set_config('app.crm_operator', 'on', true)");
      return fn(s);
    });
  }

  create(leadId: string, f: CrmContactFields, createdBy: string): Promise<CrmContact> {
    return this.asOperator(async (s) => {
      const r = await s.query<Row>(
        `INSERT INTO crm_contacts (lead_id, name, company, phone, email, notes, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING ${COLS}`,
        [leadId, f.name, f.company ?? null, f.phone ?? null, f.email ?? null, f.notes ?? null, createdBy],
      );
      return toContact(r.rows[0]!);
    });
  }

  get(leadId: string): Promise<CrmContact | null> {
    return this.asOperator(async (s) => {
      const r = await s.query<Row>(`SELECT ${COLS} FROM crm_contacts WHERE lead_id = $1`, [leadId]);
      return r.rows[0] ? toContact(r.rows[0]) : null;
    });
  }

  update(leadId: string, patch: Partial<CrmContactFields>): Promise<CrmContact | null> {
    const keys = FIELDS.filter((k) => patch[k] !== undefined);
    return this.asOperator(async (s) => {
      if (keys.length === 0) {
        const r = await s.query<Row>(`SELECT ${COLS} FROM crm_contacts WHERE lead_id = $1`, [leadId]);
        return r.rows[0] ? toContact(r.rows[0]) : null;
      }
      const sets = keys.map((k, i) => `${k} = $${i + 2}`).join(", ");
      const r = await s.query<Row>(
        `UPDATE crm_contacts SET ${sets}, updated_at = now() WHERE lead_id = $1 RETURNING ${COLS}`,
        [leadId, ...keys.map((k) => patch[k])],
      );
      return r.rows[0] ? toContact(r.rows[0]) : null;
    });
  }

  delete(leadId: string): Promise<boolean> {
    return this.asOperator(async (s) => {
      const r = await s.query("DELETE FROM crm_contacts WHERE lead_id = $1 RETURNING lead_id", [leadId]);
      return r.rows.length > 0;
    });
  }
}
