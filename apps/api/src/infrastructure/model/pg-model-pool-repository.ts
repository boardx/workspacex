/**
 * PostgreSQL implementation of `ModelPoolRepository` (F48 / migration 0019).
 *
 * ## Three tables, one transaction
 *
 * `models` + `model_composite_members` + `model_secrets`. `withTenant` runs them in one
 * transaction, so uc-20-1 E2 (「凭据被拒时不保存半截配置」) holds for the failure modes the
 * database can still raise after the use case's vocabulary check has passed -- a composite
 * member that belongs to another tenant trips 0019's trigger, and the model row it was
 * attached to must not survive that.
 *
 * ## ⚠ No method here returns a credential, and none may be added
 *
 * `ModelPoolRepository` declares `insert` and `listForOrg`. `listForOrg` reports
 * `credentialConfigured` -- one boolean -- and it is computed with an `EXISTS`, never by
 * selecting the secret. That is not merely a habit: 0019 grants `app_rw` a COLUMN-LEVEL
 * SELECT on `model_secrets` that omits `ciphertext`, so `SELECT *` on that table fails at
 * the database with `permission denied for column ciphertext`. The query below is written
 * to be correct; the grant is what makes it impossible to be wrong.
 *
 * `credential-never-echoed.test.ts` pins the port's method list exhaustively, so a
 * credential-returning method cannot be added to `ports.ts` without turning that red.
 */
import type { DatabasePort } from "../../application/ports/database.port";
import type { ModelPoolRepository, StoredModel } from "../../application/model/ports";
import type { SealedCredential } from "../../domain/model/credential-vault";
import type { ModelPoolRow, ModelStatus } from "../../domain/model/registry";
import { toOrgId } from "../../domain/org-id";

interface PoolRow {
  id: string;
  kind: string;
  shape: string;
  vendor: string;
  display_name: string;
  capability_tags: string[];
  context_window: number;
  unit_price: string;
  compliance_attrs: string[];
  status: string;
  /** Computed by `EXISTS`, never by reading the ciphertext column. */
  credential_configured: boolean;
}

interface MemberRow {
  composite_id: string;
  member_id: string;
  role: string;
  position: number;
}

export class PgModelPoolRepository implements ModelPoolRepository {
  constructor(private readonly db: DatabasePort) {}

  async insert(input: {
    readonly orgId: string;
    readonly row: ModelPoolRow;
    readonly credential: SealedCredential | null;
    readonly endpoint: SealedCredential | null;
  }): Promise<void> {
    const { orgId, row } = input;
    await this.db.withTenant(toOrgId(orgId), async (s) => {
      await s.query(
        `INSERT INTO models
           (id, org_id, kind, shape, vendor, display_name,
            capability_tags, context_window, unit_price, compliance_attrs, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [
          row.modelId,
          orgId,
          row.kind,
          row.shape,
          row.vendor,
          row.displayName,
          row.capabilityTags,
          row.contextWindow,
          row.unitPrice,
          row.complianceAttrs,
          row.status,
        ],
      );

      // Ordered: `position` is the pipeline's order and 0019 has a UNIQUE on
      // (composite_id, position), so the index is the record, not a rendering detail.
      for (const [position, member] of row.members.entries()) {
        await s.query(
          `INSERT INTO model_composite_members
             (composite_id, member_id, org_id, role, position)
           VALUES ($1, $2, $3, $4, $5)`,
          [row.modelId, member.modelId, orgId, member.role, position],
        );
      }

      // ⚠ `sealed.ciphertext` is written and never read back by this class. The two secrets
      // share one table and one code path -- an endpoint is as much a fact about the
      // customer's network as a key is about access (uc-21-1: 内网地址属敏感信息).
      for (const [kind, sealed] of [
        ["credential", input.credential],
        ["endpoint", input.endpoint],
      ] as const) {
        if (sealed === null) continue;
        await s.query(
          `INSERT INTO model_secrets
             (model_id, org_id, secret_kind, ciphertext, algorithm, key_id, sealed_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [row.modelId, orgId, kind, sealed.ciphertext, sealed.algorithm, sealed.keyId, sealed.sealedAt],
        );
      }
    });
  }

  async listForOrg(orgId: string): Promise<readonly StoredModel[]> {
    return this.db.withTenant(toOrgId(orgId), async (s) => {
      // ⚠ Columns are enumerated. `SELECT *` here would be harmless today (`models` holds no
      // secret) but it is the habit that makes the next table's leak invisible.
      const rows = await s.query<PoolRow>(
        `SELECT m.id, m.kind, m.shape, m.vendor, m.display_name,
                m.capability_tags, m.context_window, m.unit_price,
                m.compliance_attrs, m.status,
                EXISTS (
                  SELECT 1 FROM model_secrets sec
                   WHERE sec.model_id = m.id AND sec.secret_kind = 'credential'
                ) AS credential_configured
           FROM models m
          ORDER BY m.display_name ASC`,
      );
      if (rows.rows.length === 0) return [];

      const members = await s.query<MemberRow>(
        `SELECT composite_id, member_id, role, position
           FROM model_composite_members
          ORDER BY composite_id, position ASC`,
      );
      const byComposite = new Map<string, MemberRow[]>();
      for (const m of members.rows) {
        const list = byComposite.get(m.composite_id) ?? [];
        list.push(m);
        byComposite.set(m.composite_id, list);
      }

      return rows.rows.map((r) => this.toStored(r, byComposite.get(r.id) ?? []));
    });
  }

  private toStored(r: PoolRow, members: readonly MemberRow[]): StoredModel {
    const row = {
      modelId: r.id,
      kind: r.kind as ModelPoolRow["kind"],
      shape: r.shape as ModelPoolRow["shape"],
      vendor: r.vendor,
      displayName: r.display_name,
      capabilityTags: r.capability_tags,
      contextWindow: r.context_window,
      // numeric(12,6) arrives as a string from node-postgres. `Number` here rather than at
      // the call site: a price compared as a string orders 0.9 after 0.10.
      unitPrice: Number(r.unit_price),
      complianceAttrs: r.compliance_attrs,
      status: r.status as ModelStatus,
      members: members.map((m) => ({ modelId: m.member_id, role: m.role })),
    } as ModelPoolRow;
    // The only bit about the credential that may cross this boundary (`StoredModel`).
    return { row, credentialConfigured: r.credential_configured };
  }
}
