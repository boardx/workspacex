/**
 * Phase 20 WS03 —— `skill_catalog_entries` 的读路径（列表/搜索/详情）与通道/后继写路径（含审计 + 幂等）。
 *
 * ⚠ 每个方法恰好一次 `withTenant`（RLS 按 org_id），WHERE 仍显式带 `org_id`——第二道防线。
 * ⚠ 当前生效版本 = 最新一条 `published` 的 `skill_versions`（与 `pg-enabled-skill-version-reader.ts` 同语义，A2）。
 * ⚠ 搜索：`simple` 全文（英文/stableId 分词）OR 子串 ILIKE（中文无分词，靠子串兜底）；空关键词按 stableId 排序（R3.6）。
 */
import { randomUUID } from "node:crypto";
import { WorkGateStatus } from "@repo/contracts/work-eval";
import type { WorkSkillChannel, WorkSkillManifest } from "@repo/contracts/work-skill-meta";
import type { DatabasePort, TenantSession } from "../../application/ports/database.port";
import type {
  CatalogDetailRow,
  CatalogListQuery,
  CatalogRow,
  CatalogUpdateOutcome,
  WorkSkillCatalogRepository,
} from "../../application/skill/work-skill-catalog";
import type { OrgId } from "../../domain/org-id";
import type { CurrentVersionG5 } from "../../domain/skill/work-skill-catalog";

/**
 * EV05：当前版本（最新 published）门状态记录里的 G5；记录缺失、digest 对不上当前版本或结构不合法 → null
 * （= 未评测，candidate→verified 被拒）。
 */
async function currentVersionG5(session: TenantSession, orgId: string, skillId: string): Promise<CurrentVersionG5 | null> {
  const rec = await session.query<{ status: unknown; content_digest: string }>(
    `SELECT g.status, cur.content_digest
       FROM (SELECT sv.id, sv.content_digest FROM skill_versions sv
              WHERE sv.org_id = $1 AND sv.skill_id = $2 AND sv.published
              ORDER BY sv.created_at DESC, sv.id DESC LIMIT 1) AS cur
       JOIN skill_gate_records g ON g.org_id = $1 AND g.skill_id = $2 AND g.skill_version_id = cur.id`,
    [orgId, skillId],
  );
  const row = rec.rows[0];
  if (!row) return null;
  const parsed = WorkGateStatus.safeParse(row.status);
  if (!parsed.success || parsed.data.subjectVersionDigest !== `sha256:${row.content_digest}`) return null;
  const g5 = parsed.data.gates.find((g) => g.gate === "G5");
  return g5 ? { outcome: g5.outcome, reasonCode: g5.reasonCode } : null;
}

interface RowShape {
  skill_id: string;
  name: string;
  stable_id: string;
  domain: string;
  channel: WorkSkillChannel;
  successor_skill_id: string | null;
  version_id: string;
  semantic_label: string;
  manifest: { description?: unknown; work?: WorkSkillManifest };
}

const SELECT_ROWS = `
  SELECT e.skill_id, sk.name, e.stable_id, e.domain, e.channel, e.successor_skill_id,
         cur.id AS version_id, cur.semantic_label, cur.manifest
    FROM skill_catalog_entries e
    JOIN skills sk ON sk.id = e.skill_id AND sk.org_id = e.org_id
    CROSS JOIN LATERAL (
      SELECT sv.id, sv.semantic_label, sv.manifest
        FROM skill_versions sv
       WHERE sv.skill_id = e.skill_id AND sv.org_id = e.org_id AND sv.published
       ORDER BY sv.created_at DESC, sv.id DESC LIMIT 1
    ) AS cur`;

function toRow(row: RowShape): CatalogRow {
  return {
    skillId: row.skill_id,
    name: row.name,
    stableId: row.stable_id,
    domain: row.domain,
    channel: row.channel,
    riskClass: row.manifest.work?.riskClass ?? "high",
    currentVersionId: row.version_id,
    currentVersionLabel: row.semantic_label,
    successorSkillId: row.successor_skill_id,
  };
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

async function readRow(session: TenantSession, orgId: string, skillId: string): Promise<CatalogRow | null> {
  const found = await session.query<RowShape>(`${SELECT_ROWS} WHERE e.org_id = $1 AND e.skill_id = $2`, [orgId, skillId]);
  return found.rows[0] ? toRow(found.rows[0]) : null;
}

export class PgWorkSkillCatalogRepository implements WorkSkillCatalogRepository {
  constructor(private readonly db: DatabasePort) {}

  async list(orgId: OrgId, query: CatalogListQuery): Promise<readonly CatalogRow[]> {
    return this.db.withTenant(orgId, async (session) => {
      const params: unknown[] = [orgId];
      const where = ["e.org_id = $1"];
      if (query.domain !== undefined) {
        params.push(query.domain);
        where.push(`e.domain = $${params.length}`);
      }
      if (query.channel !== undefined) {
        params.push(query.channel);
        where.push(`e.channel = $${params.length}`);
      } else if (!query.includeDeprecated) {
        where.push("e.channel <> 'deprecated'");
      }
      let order = "e.stable_id ASC, e.skill_id ASC";
      const q = query.q?.trim();
      if (q) {
        params.push(q);
        const qi = params.length;
        params.push(`%${escapeLike(q)}%`);
        const li = params.length;
        where.push(`(to_tsvector('simple', e.search_document) @@ plainto_tsquery('simple', $${qi})
                     OR e.search_document ILIKE $${li} OR e.stable_id ILIKE $${li})`);
        order = `(upper(e.stable_id) = upper($${qi})) DESC,
                 ts_rank(to_tsvector('simple', e.search_document), plainto_tsquery('simple', $${qi})) DESC,
                 ${order}`;
      }
      params.push(query.limit, query.offset);
      const found = await session.query<RowShape>(
        `${SELECT_ROWS} WHERE ${where.join(" AND ")} ORDER BY ${order}
          LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params,
      );
      return found.rows.map(toRow);
    });
  }

  async get(orgId: OrgId, skillId: string, versionId?: string): Promise<CatalogDetailRow | null> {
    return this.db.withTenant(orgId, async (session) => {
      const base = await session.query<RowShape>(`${SELECT_ROWS} WHERE e.org_id = $1 AND e.skill_id = $2`, [orgId, skillId]);
      const row = base.rows[0];
      if (!row) return null;
      const versions = await session.query<{ id: string; semantic_label: string; created_at: Date; manifest: RowShape["manifest"] }>(
        `SELECT id, semantic_label, created_at, manifest FROM skill_versions
          WHERE org_id = $1 AND skill_id = $2 AND published
          ORDER BY created_at DESC, id DESC`,
        [orgId, skillId],
      );
      const selected = versionId === undefined
        ? versions.rows.find((v) => v.id === row.version_id)
        : versions.rows.find((v) => v.id === versionId);
      if (!selected || selected.manifest.work === undefined) return null;
      let successor: CatalogDetailRow["successor"] = null;
      if (row.successor_skill_id) {
        const s = await session.query<{ skill_id: string; name: string; stable_id: string }>(
          `SELECT e.skill_id, sk.name, e.stable_id FROM skill_catalog_entries e
             JOIN skills sk ON sk.id = e.skill_id AND sk.org_id = e.org_id
            WHERE e.org_id = $1 AND e.skill_id = $2`,
          [orgId, row.successor_skill_id],
        );
        const hit = s.rows[0];
        successor = hit ? { skillId: hit.skill_id, name: hit.name, stableId: hit.stable_id } : null;
      }
      const description = selected.manifest.description;
      return {
        ...toRow(row),
        description: typeof description === "string" ? description.slice(0, 4000) : "",
        manifest: selected.manifest.work,
        versions: versions.rows.map((v) => ({
          skillVersionId: v.id,
          semanticLabel: v.semantic_label,
          publishedAt: new Date(v.created_at).toISOString(),
          current: v.id === row.version_id,
        })),
        successor,
      };
    });
  }

  async update(input: Parameters<WorkSkillCatalogRepository["update"]>[0]): Promise<CatalogUpdateOutcome> {
    return this.db.withTenant(input.orgId, async (session): Promise<CatalogUpdateOutcome> => {
      // 串行化本组织的目录写：后继成环检测要看一张稳定的图。
      await session.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 1))", [`skill-catalog:${input.orgId}`]);
      const prior = await session.query<{ skill_id: string; request_digest: string }>(
        `SELECT skill_id, request_digest FROM skill_catalog_channel_events WHERE org_id = $1 AND idempotency_key = $2`,
        [input.orgId, input.idempotencyKey],
      );
      const replay = prior.rows[0];
      if (replay) {
        if (replay.request_digest !== input.requestDigest || replay.skill_id !== input.skillId) {
          return { kind: "idempotency-conflict" };
        }
        const row = await readRow(session, input.orgId, input.skillId);
        return row ? { kind: "replayed", row } : { kind: "not-found" };
      }

      const locked = await session.query<{ channel: WorkSkillChannel; successor_skill_id: string | null }>(
        `SELECT channel, successor_skill_id FROM skill_catalog_entries
          WHERE org_id = $1 AND skill_id = $2 FOR UPDATE`,
        [input.orgId, input.skillId],
      );
      const current = locked.rows[0];
      if (!current) return { kind: "not-found" };
      const graph = await session.query<{ skill_id: string; successor_skill_id: string | null }>(
        "SELECT skill_id, successor_skill_id FROM skill_catalog_entries WHERE org_id = $1",
        [input.orgId],
      );
      const decision = input.decide(
        { skillId: input.skillId, channel: current.channel, successorSkillId: current.successor_skill_id },
        new Map(graph.rows.map((r) => [r.skill_id, r.successor_skill_id])),
        await currentVersionG5(session, input.orgId, input.skillId),
      );
      if (decision.kind !== "ok") return decision;
      // 无变化（同 channel、后继不变）不写 UPDATE、不落审计事件：from==to 的行只是噪声（WS03 review）。
      if (decision.next.channel === current.channel && decision.next.successorSkillId === current.successor_skill_id) {
        const unchanged = await readRow(session, input.orgId, input.skillId);
        return unchanged ? { kind: "replayed", row: unchanged } : { kind: "not-found" };
      }

      const at = new Date().toISOString();
      await session.query(
        `UPDATE skill_catalog_entries
            SET channel = $3, successor_skill_id = $4, updated_by = $5, updated_at = $6
          WHERE org_id = $1 AND skill_id = $2`,
        [input.orgId, input.skillId, decision.next.channel, decision.next.successorSkillId, input.actorId, at],
      );
      await session.query(
        `INSERT INTO skill_catalog_channel_events
          (id, org_id, skill_id, idempotency_key, request_digest, from_channel, to_channel,
           from_successor_id, to_successor_id, gate_evidence_ref, actor_id, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [
          `skill-catalog-event-${randomUUID()}`, input.orgId, input.skillId, input.idempotencyKey, input.requestDigest,
          current.channel, decision.next.channel, current.successor_skill_id, decision.next.successorSkillId,
          input.gateEvidenceRef, input.actorId, at,
        ],
      );
      const row = await readRow(session, input.orgId, input.skillId);
      return row ? { kind: "updated", row } : { kind: "not-found" };
    });
  }
}
