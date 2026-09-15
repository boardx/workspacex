/**
 * `ResearchWorkflowRepository` 的 PostgreSQL 实现。
 *
 * 同本仓既有纪律：每个查询经 `withTenant`，本文件**不做任何判断**——
 * 「这个推进合不合法」全部在 `domain/research-workflow/state-machine.ts`。
 * 仓储一旦开始顺手判一句，门就有了第二处定义。
 *
 * ⚠ `applyTransition` 把阶段与血缘写在**同一条 UPDATE** 里，不是两条。
 * 阶段进了而血缘没跟上，会得到一个"已发布但不知道基于哪批材料"的状态——
 * 那正是三个月后复盘要问的唯一问题，也是数据层 CHECK 约束
 * `research_session_published_needs_batch` 在防的事。
 */
import type { DatabasePort } from "../../application/ports/database.port";
import type { OrgId } from "../../domain/org-id";
import type { researchWorkflow as C } from "@repo/contracts";
import type {
  GateAuditEntry,
  ResearchSessionRow,
  ResearchWorkflowRepository,
} from "../../application/research-workflow/ports";

interface SessionDbRow {
  thread_id: string;
  phase: string;
  material_batch_id: string | null;
  field_scheme_version: number;
  logic_version: number;
  published_graph_version: number;
  verify_due_at: string | null;
  updated_at: string;
}

interface MaterialDbRow {
  id: string;
  source: string;
  label: string;
  verdict: string;
  note: string | null;
  attempts: number;
  created_at: string;
}

const SESSION_COLS = `thread_id, phase, material_batch_id, field_scheme_version,
  logic_version, published_graph_version, verify_due_at, updated_at`;

function toSession(s: SessionDbRow, materials: readonly MaterialDbRow[]): ResearchSessionRow {
  return {
    threadId: s.thread_id,
    phase: s.phase as C.ResearchPhaseName,
    lineage: {
      materialBatchId: s.material_batch_id,
      fieldSchemeVersion: s.field_scheme_version,
      logicVersion: s.logic_version,
      publishedGraphVersion: s.published_graph_version,
    },
    materials: materials.map((m) => ({
      id: m.id,
      source: m.source as never,
      label: m.label,
      verdict: m.verdict as C.MaterialVerdictName,
      note: m.note,
      attempts: m.attempts,
      createdAt: new Date(m.created_at).toISOString(),
    })),
    verifyDueAt: s.verify_due_at === null ? null : new Date(s.verify_due_at).toISOString(),
    updatedAt: new Date(s.updated_at).toISOString(),
  };
}

export class PgResearchWorkflowRepository implements ResearchWorkflowRepository {
  constructor(
    private readonly db: DatabasePort,
    private readonly uuid: () => string,
  ) {}

  private async read(orgId: OrgId, threadId: string): Promise<ResearchSessionRow> {
    return this.db.withTenant(orgId, async (s) => {
      const sess = await s.query<SessionDbRow>(
        `SELECT ${SESSION_COLS} FROM research_sessions WHERE thread_id = $1 AND org_id = $2`,
        [threadId, orgId],
      );
      const mats = await s.query<MaterialDbRow>(
        `SELECT id, source, label, verdict, note, attempts, created_at
           FROM research_materials WHERE thread_id = $1 AND org_id = $2
          ORDER BY created_at ASC, id ASC`,
        [threadId, orgId],
      );
      return toSession(sess.rows[0]!, mats.rows);
    });
  }

  /**
   * 没有会话就建一个 `empty` 的。
   *
   * 用 ON CONFLICT DO NOTHING 而不是"先查再插"：两个请求同时进同一条线程时，
   * 先查再插会让其中一个撞主键。这个竞态在真实使用里很容易发生——用户点开页面的
   * 同时 Agent 正在推进。
   */
  async ensureSession(orgId: OrgId, threadId: string): Promise<ResearchSessionRow> {
    await this.db.withTenant(orgId, (s) =>
      s.query(
        `INSERT INTO research_sessions (thread_id, org_id) VALUES ($1, $2)
         ON CONFLICT (thread_id) DO NOTHING`,
        [threadId, orgId],
      ),
    );
    return this.read(orgId, threadId);
  }

  async addMaterials(
    orgId: OrgId,
    threadId: string,
    items: readonly { source: string; label: string }[],
  ): Promise<ResearchSessionRow> {
    await this.ensureSession(orgId, threadId);
    await this.db.withTenant(orgId, async (s) => {
      for (const it of items) {
        await s.query(
          `INSERT INTO research_materials (id, thread_id, org_id, source, label)
           VALUES ($1,$2,$3,$4,$5)`,
          [this.uuid(), threadId, orgId, it.source, it.label],
        );
      }
    });
    return this.read(orgId, threadId);
  }

  async setMaterialVerdict(
    orgId: OrgId,
    threadId: string,
    materialId: string,
    verdict: C.MaterialVerdictName,
    note: string | null,
  ): Promise<ResearchSessionRow> {
    await this.db.withTenant(orgId, (s) =>
      s.query(
        `UPDATE research_materials SET verdict = $1, note = $2
          WHERE id = $3 AND thread_id = $4 AND org_id = $5`,
        [verdict, note, materialId, threadId, orgId],
      ),
    );
    return this.read(orgId, threadId);
  }

  async bumpMaterialAttempts(orgId: OrgId, threadId: string, materialId: string): Promise<ResearchSessionRow> {
    await this.db.withTenant(orgId, (s) =>
      s.query(
        `UPDATE research_materials SET attempts = attempts + 1, verdict = 'pending'
          WHERE id = $1 AND thread_id = $2 AND org_id = $3`,
        [materialId, threadId, orgId],
      ),
    );
    return this.read(orgId, threadId);
  }

  async applyTransition(
    orgId: OrgId,
    threadId: string,
    nextPhase: C.ResearchPhaseName,
    lineage: ResearchSessionRow["lineage"],
    verifyDueAt: string | null,
  ): Promise<ResearchSessionRow> {
    await this.db.withTenant(orgId, (s) =>
      s.query(
        // 阶段与血缘同一条语句——见文件头注：分两条会产生"已发布但血缘未知"的窗口。
        `UPDATE research_sessions
            SET phase = $1, material_batch_id = $2, field_scheme_version = $3,
                logic_version = $4, published_graph_version = $5,
                verify_due_at = $6, updated_at = now()
          WHERE thread_id = $7 AND org_id = $8`,
        [
          nextPhase, lineage.materialBatchId, lineage.fieldSchemeVersion,
          lineage.logicVersion, lineage.publishedGraphVersion, verifyDueAt, threadId, orgId,
        ],
      ),
    );
    return this.read(orgId, threadId);
  }

  async appendAudit(e: GateAuditEntry): Promise<void> {
    await this.db.withTenant(e.orgId, (s) =>
      s.query(
        `INSERT INTO research_gate_audit
           (thread_id, org_id, actor_kind, action, from_phase, outcome, refusal)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [e.threadId, e.orgId, e.actorKind, e.action, e.fromPhase, e.outcome, e.refusal],
      ),
    );
  }

  async listAudit(
    orgId: OrgId,
    threadId: string,
    limit: number,
  ): Promise<readonly (GateAuditEntry & { createdAt: string })[]> {
    return this.db.withTenant(orgId, async (s) => {
      const r = await s.query<{
        thread_id: string; actor_kind: string; action: string;
        from_phase: string; outcome: string; refusal: string | null; created_at: string;
      }>(
        `SELECT thread_id, actor_kind, action, from_phase, outcome, refusal, created_at
           FROM research_gate_audit WHERE thread_id = $1 AND org_id = $2
          ORDER BY created_at DESC, id DESC LIMIT $3`,
        [threadId, orgId, limit],
      );
      return r.rows.map((x) => ({
        orgId,
        threadId: x.thread_id,
        actorKind: x.actor_kind as "human" | "agent",
        action: x.action,
        fromPhase: x.from_phase as C.ResearchPhaseName,
        outcome: x.outcome as "allowed" | "refused",
        refusal: x.refusal as C.ResearchRefusalName | null,
        createdAt: new Date(x.created_at).toISOString(),
      }));
    });
  }
}
