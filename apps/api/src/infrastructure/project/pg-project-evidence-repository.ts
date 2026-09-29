/**
 * `ProjectEvidencePort` 的 PostgreSQL 实现（项目中枢 B3-T1，#4495）。
 *
 * 全部 `withTenant` + 每条谓词带 `org_id`；读侧返回 `guard({kind:"project"})`——披露由用例拿
 * `authorize()` 的决策解开（同 `pg-project-resource-repository.ts`）。
 *
 * 分页：`(created_at, id)` 复合游标，base64 编码的 JSON——同一毫秒建立的多条靠 `id` 定序，
 * 翻页不会漏也不会重。`countsBySource` 与列表同一过滤面（`includeRevoked`），但不受 `sourceKind` /
 * 游标影响：角标要的是「这一类一共几条」。
 *
 * 写侧 `upsert` 以 `(org_id, source_kind, source_ref)` 幂等：已存在 ⇒ 刷新摘录 / 定位 / 说话人 / 标题并
 * 取消撤回（源又出现了就是又在了），返回既有 id；`xmax = 0` 判是不是新插。
 */
import { randomUUID } from "node:crypto";
import { projectEvidence as PE } from "@repo/contracts";
import type { DatabasePort } from "../../application/ports/database.port";
import type {
  ProjectEvidenceListFilter,
  ProjectEvidencePage,
  ProjectEvidencePort,
  ProjectEvidenceRow,
  ProjectEvidenceSourceKind,
  UpsertEvidenceCommand,
} from "../../application/project/project-evidence-ports";
import { guard, type Guarded } from "../../application/security/permission-filter";
import type { OrgId } from "../../domain/org-id";

interface EvidenceSqlRow {
  id: string;
  project_id: string;
  source_kind: ProjectEvidenceSourceKind;
  resource_id: string;
  source_ref: string;
  excerpt: string;
  locator: ProjectEvidenceRow["locator"];
  speaker_label: string | null;
  resource_title: string;
  revoked: boolean;
  created_at: Date;
}

/**
 * 全部来源全列，含 0——`countsBySource` 是 `z.record(enum, number)`，缺键会让契约解析失败。
 * 取值来自契约（#4615 起七类，+ whiteboard_note），这里不重列：重列就是缺键的那一天。
 */
const SOURCE_KINDS: readonly ProjectEvidenceSourceKind[] = PE.ProjectEvidenceSourceKind.options;

const COLUMNS = `id, project_id, source_kind, resource_id, source_ref, excerpt, locator, speaker_label, resource_title, revoked, created_at`;

export const newEvidenceId = (): string => `ev_${randomUUID().replace(/-/g, "")}`;

interface Cursor {
  readonly createdAt: string;
  readonly id: string;
}

export function encodeEvidenceCursor(c: Cursor): string {
  return Buffer.from(JSON.stringify(c), "utf8").toString("base64url");
}

/** 坏游标（不是本仓库发出的）⇒ `null`，从头开始——不抛：游标不是用户能改错的输入，改错了说明是拼出来的。 */
export function decodeEvidenceCursor(raw: string | undefined): Cursor | null {
  if (raw === undefined || raw === "") return null;
  try {
    const parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as Partial<Cursor>;
    if (typeof parsed.createdAt !== "string" || typeof parsed.id !== "string") return null;
    if (Number.isNaN(Date.parse(parsed.createdAt))) return null;
    return { createdAt: parsed.createdAt, id: parsed.id };
  } catch {
    return null;
  }
}

function toRow(r: EvidenceSqlRow): ProjectEvidenceRow {
  return {
    id: r.id,
    projectId: r.project_id,
    sourceKind: r.source_kind,
    resourceId: r.resource_id,
    sourceRef: r.source_ref,
    excerpt: r.excerpt,
    locator: r.locator ?? {},
    speakerLabel: r.speaker_label,
    resourceTitle: r.resource_title,
    revoked: r.revoked,
    createdAt: r.created_at.toISOString(),
  };
}

export class PgProjectEvidenceRepository implements ProjectEvidencePort {
  constructor(private readonly db: DatabasePort) {}

  async list(orgId: OrgId, projectId: string, filter: ProjectEvidenceListFilter): Promise<Guarded<ProjectEvidencePage | null>> {
    const ref = { kind: "project" as const, id: projectId };
    return this.db.withTenant(orgId, async (s) => {
      const found = await s.query<{ id: string }>(`SELECT id FROM projects WHERE id = $1 AND org_id = $2`, [projectId, orgId]);
      if (found.rows[0] === undefined) return guard(ref, null);

      const includeRevoked = filter.includeRevoked === true;
      const cursor = decodeEvidenceCursor(filter.cursor);
      const params: unknown[] = [orgId, projectId, includeRevoked];
      const where = [`org_id = $1`, `project_id = $2`, `($3::boolean OR revoked = false)`];
      if (filter.sourceKind !== undefined) {
        params.push(filter.sourceKind);
        where.push(`source_kind = $${params.length}`);
      }
      if (cursor !== null) {
        params.push(cursor.createdAt, cursor.id);
        where.push(`(created_at, id) < ($${params.length - 1}::timestamptz, $${params.length})`);
      }
      params.push(filter.limit + 1);
      const page = await s.query<EvidenceSqlRow>(
        `SELECT ${COLUMNS} FROM project_evidence
          WHERE ${where.join(" AND ")}
          ORDER BY created_at DESC, id DESC
          LIMIT $${params.length}`,
        params,
      );
      const rows = page.rows.slice(0, filter.limit).map(toRow);
      const last = rows.at(-1);
      const nextCursor = page.rows.length > filter.limit && last !== undefined
        ? encodeEvidenceCursor({ createdAt: last.createdAt, id: last.id })
        : null;

      const counted = await s.query<{ source_kind: ProjectEvidenceSourceKind; n: number }>(
        `SELECT source_kind, count(*)::int AS n FROM project_evidence
          WHERE org_id = $1 AND project_id = $2 AND ($3::boolean OR revoked = false)
          GROUP BY source_kind`,
        [orgId, projectId, includeRevoked],
      );
      const countsBySource = Object.fromEntries(SOURCE_KINDS.map((k) => [k, 0])) as Record<ProjectEvidenceSourceKind, number>;
      for (const r of counted.rows) countsBySource[r.source_kind] = r.n;

      return guard(ref, { items: rows, nextCursor, countsBySource });
    });
  }

  async find(orgId: OrgId, projectId: string, evidenceId: string): Promise<Guarded<ProjectEvidenceRow | null>> {
    const ref = { kind: "project" as const, id: projectId };
    return this.db.withTenant(orgId, async (s) => {
      const r = await s.query<EvidenceSqlRow>(
        `SELECT ${COLUMNS} FROM project_evidence WHERE org_id = $1 AND project_id = $2 AND id = $3`,
        [orgId, projectId, evidenceId],
      );
      const row = r.rows[0];
      return guard(ref, row === undefined ? null : toRow(row));
    });
  }

  async upsert(cmd: UpsertEvidenceCommand): Promise<{ readonly id: string; readonly created: boolean }> {
    return this.db.withTenant(cmd.orgId, async (s) => {
      const r = await s.query<{ id: string; inserted: boolean }>(
        `INSERT INTO project_evidence
           (id, org_id, project_id, source_kind, resource_id, source_ref, excerpt, locator, speaker_label, resource_title)
         VALUES ($1, $2, $3, $4, $5, $6, left($7, 280), $8::jsonb, $9, $10)
         ON CONFLICT (org_id, source_kind, source_ref) DO UPDATE
           SET project_id = EXCLUDED.project_id,
               resource_id = EXCLUDED.resource_id,
               excerpt = EXCLUDED.excerpt,
               locator = EXCLUDED.locator,
               speaker_label = EXCLUDED.speaker_label,
               resource_title = EXCLUDED.resource_title,
               revoked = false
         RETURNING id, (xmax = 0) AS inserted`,
        [
          newEvidenceId(),
          cmd.orgId,
          cmd.projectId,
          cmd.sourceKind,
          cmd.resourceId,
          cmd.sourceRef,
          cmd.excerpt,
          JSON.stringify(cmd.locator ?? {}),
          cmd.speakerLabel,
          cmd.resourceTitle,
        ],
      );
      const row = r.rows[0];
      if (row === undefined) throw new Error("project_evidence upsert returned no row");
      return { id: row.id, created: row.inserted };
    });
  }

  async revokeBySource(orgId: OrgId, sourceKind: ProjectEvidenceSourceKind, resourceId: string): Promise<number> {
    return this.db.withTenant(orgId, async (s) => {
      const r = await s.query<{ id: string }>(
        `UPDATE project_evidence SET revoked = true
          WHERE org_id = $1 AND source_kind = $2 AND resource_id = $3 AND revoked = false
          RETURNING id`,
        [orgId, sourceKind, resourceId],
      );
      return r.rows.length;
    });
  }

  async listForIngestion(
    orgId: OrgId,
    projectId: string,
    sourceKinds: readonly ProjectEvidenceSourceKind[],
    limit: number,
  ): Promise<Guarded<readonly ProjectEvidenceRow[]>> {
    const ref = { kind: "project" as const, id: projectId };
    if (sourceKinds.length === 0) return guard(ref, []);
    return this.db.withTenant(orgId, async (s) => {
      // 「尚未被任何结论引用」= 两张锚点表里都没有指向它的 evidence_id。
      const r = await s.query<EvidenceSqlRow>(
        `SELECT ${COLUMNS} FROM project_evidence e
          WHERE e.org_id = $1 AND e.project_id = $2 AND e.revoked = false
            AND e.source_kind = ANY($3::text[])
            AND NOT EXISTS (SELECT 1 FROM claim_message_evidence m WHERE m.org_id = e.org_id AND m.evidence_id = e.id)
            AND NOT EXISTS (SELECT 1 FROM claim_segments c WHERE c.org_id = e.org_id AND c.evidence_id = e.id)
          ORDER BY e.created_at ASC, e.id ASC
          LIMIT $4`,
        [orgId, projectId, [...sourceKinds], limit],
      );
      return guard(ref, r.rows.map(toRow));
    });
  }
}
