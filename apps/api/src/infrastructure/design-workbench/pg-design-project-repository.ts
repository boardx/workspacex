/**
 * UC-17.8 B4.2/B4.3 —— `design_projects` + `design_project_chat_messages` 的
 * PostgreSQL 适配器（迁移 `20260904150000_uc178_design_workbench.sql`）。
 *
 * ⚠ 每个方法恰好一次 `withTenant`，没有 `withoutTenant`——同 `pg-feedback-draft-repository.ts`。
 * ⚠ 读方法（`listForOrg`/`get`）**不**接 `ownerId` 谓词——全组织可读是本表的可见性口径
 *   （见 `project-ports.ts` 头注），与草稿仓储的每条 SQL 都带 `owner_id = $n` 正相反。
 *   写方法（`update`/`delete`/`appendChat`/`pushToInbox`）**必须**带 `owner_id = $n`
 *   谓词——这是「仅 owner 可改/删/推送」这条规则的唯一实现位置。
 */
import type { DatabasePort, TenantSession } from "../../application/ports/database.port";
import { toOrgId } from "../../domain/org-id";
import type {
  CreateOrGetByLinkedFeedbackResult,
  DesignProjectChatTurn,
  DesignProjectPatch,
  DesignProjectRepository,
  DesignProjectRepositoryFactory,
  DesignProjectRow,
  NewDesignProject,
  ProjectTemplate,
  PushToInboxResult,
} from "../../application/design-workbench/project-ports";

interface ProjectDbRow {
  readonly id: string;
  readonly owner_id: string;
  readonly name: string;
  readonly template: string;
  readonly problem: string;
  readonly criteria: unknown;
  readonly frames: unknown;
  readonly pushed: boolean;
  readonly pushed_at: Date | string | null;
  readonly push_note: string | null;
  readonly linked_feedback_id: string | null;
  readonly created_at: Date | string;
  readonly updated_at: Date | string;
}

interface ChatDbRow {
  readonly role: string;
  readonly text: string;
  readonly created_at: Date | string;
  /** B5.2：`model` / `fallback` / NULL（user 记录与旧记录）——迁移 `20260905130000_uc178_b52_design_chat_source.sql` */
  readonly source: string | null;
}

function toStringArray(raw: unknown): readonly string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((v): v is string => typeof v === "string");
}

function toChat(rows: readonly ChatDbRow[]): readonly DesignProjectChatTurn[] {
  return rows.map((r) => ({
    role: r.role === "ai" ? "ai" : "user",
    text: r.text,
    at: new Date(r.created_at).toISOString(),
    // 「无」≠「模型说的」：NULL 就不带键（契约 `.optional()`），不猜默认值。
    ...(r.source === "model" || r.source === "fallback" ? { source: r.source } : {}),
  }));
}

function toRow(row: ProjectDbRow, chat: readonly ChatDbRow[]): DesignProjectRow {
  return {
    id: row.id,
    ownerId: row.owner_id,
    name: row.name,
    template: row.template as ProjectTemplate,
    problem: row.problem,
    criteria: toStringArray(row.criteria),
    frames: toStringArray(row.frames),
    pushed: row.pushed,
    pushedAt: row.pushed_at === null ? null : new Date(row.pushed_at).toISOString(),
    pushNote: row.push_note,
    linkedFeedbackId: row.linked_feedback_id,
    chat: toChat(chat),
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

const SELECT_COLUMNS = `
  id, owner_id, name, template, problem, criteria, frames,
  pushed, pushed_at, push_note, linked_feedback_id, created_at, updated_at`;

class ScopedPgDesignProjectRepository implements DesignProjectRepository {
  constructor(
    private readonly db: DatabasePort,
    private readonly orgId: string,
  ) {}

  private async chatFor(s: TenantSession, projectId: string): Promise<readonly ChatDbRow[]> {
    const { rows } = await s.query<ChatDbRow>(
      `SELECT role, text, created_at, source
         FROM design_project_chat_messages
        WHERE org_id = $1 AND project_id = $2
        ORDER BY created_at ASC, id ASC`,
      [this.orgId, projectId],
    );
    return rows;
  }

  async create(project: NewDesignProject): Promise<void> {
    await this.db.withTenant(toOrgId(this.orgId), async (s: TenantSession) => {
      await s.query(
        `INSERT INTO design_projects
           (id, org_id, owner_id, name, template, problem, criteria, frames, linked_feedback_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9)`,
        [
          project.id,
          this.orgId,
          project.ownerId,
          project.name,
          project.template,
          project.problem,
          JSON.stringify(project.criteria),
          JSON.stringify(project.frames),
          project.linkedFeedbackId,
        ],
      );
    });
  }

  /**
   * B4.4 `deepenFeedback`——见 `project-ports.ts` 头注的幂等说明。`ON CONFLICT` 目标必须
   * 精确匹配迁移里的部分唯一索引（`(org_id, linked_feedback_id) WHERE linked_feedback_id
   * IS NOT NULL`）,否则 Postgres 不认这条索引,`DO NOTHING` 就不会生效。
   */
  async createOrGetByLinkedFeedback(
    project: NewDesignProject & { readonly linkedFeedbackId: string },
  ): Promise<CreateOrGetByLinkedFeedbackResult> {
    return this.db.withTenant(toOrgId(this.orgId), async (s: TenantSession) => {
      const { rows: inserted } = await s.query<{ id: string }>(
        `INSERT INTO design_projects
           (id, org_id, owner_id, name, template, problem, criteria, frames, linked_feedback_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9)
         ON CONFLICT (org_id, linked_feedback_id) WHERE linked_feedback_id IS NOT NULL DO NOTHING
         RETURNING id`,
        [
          project.id,
          this.orgId,
          project.ownerId,
          project.name,
          project.template,
          project.problem,
          JSON.stringify(project.criteria),
          JSON.stringify(project.frames),
          project.linkedFeedbackId,
        ],
      );

      if (inserted.length > 0) {
        const { rows } = await s.query<ProjectDbRow>(
          `SELECT ${SELECT_COLUMNS} FROM design_projects WHERE org_id = $1 AND id = $2`,
          [this.orgId, project.id],
        );
        const row = rows[0];
        if (row === undefined) throw new Error("design-workbench: inserted row vanished within the same transaction");
        return { project: toRow(row, await this.chatFor(s, row.id)), created: true };
      }

      // 冲突：已经有一行占了这条反馈——复用它,不是本次传入的字段（见 project-ports.ts 头注）。
      const { rows } = await s.query<ProjectDbRow>(
        `SELECT ${SELECT_COLUMNS} FROM design_projects WHERE org_id = $1 AND linked_feedback_id = $2`,
        [this.orgId, project.linkedFeedbackId],
      );
      const row = rows[0];
      if (row === undefined) throw new Error("design-workbench: conflicting linked_feedback_id row not found");
      return { project: toRow(row, await this.chatFor(s, row.id)), created: false };
    });
  }

  async listForOrg(): Promise<readonly DesignProjectRow[]> {
    return this.db.withTenant(toOrgId(this.orgId), async (s: TenantSession) => {
      const { rows } = await s.query<ProjectDbRow>(
        `SELECT ${SELECT_COLUMNS} FROM design_projects WHERE org_id = $1 ORDER BY created_at ASC, id ASC`,
        [this.orgId],
      );
      const out: DesignProjectRow[] = [];
      for (const row of rows) out.push(toRow(row, await this.chatFor(s, row.id)));
      return out;
    });
  }

  async get(projectId: string): Promise<DesignProjectRow | null> {
    return this.db.withTenant(toOrgId(this.orgId), async (s: TenantSession) => {
      const { rows } = await s.query<ProjectDbRow>(
        `SELECT ${SELECT_COLUMNS} FROM design_projects WHERE org_id = $1 AND id = $2`,
        [this.orgId, projectId],
      );
      const row = rows[0];
      if (row === undefined) return null;
      return toRow(row, await this.chatFor(s, row.id));
    });
  }

  async update(projectId: string, ownerId: string, patch: DesignProjectPatch): Promise<DesignProjectRow | null> {
    return this.db.withTenant(toOrgId(this.orgId), async (s: TenantSession) => {
      const { rows } = await s.query<ProjectDbRow>(
        `UPDATE design_projects
            SET name       = COALESCE($4, name),
                template   = COALESCE($5, template),
                problem    = COALESCE($6, problem),
                criteria   = COALESCE($7::jsonb, criteria),
                frames     = COALESCE($8::jsonb, frames),
                updated_at = now()
          WHERE org_id = $1 AND owner_id = $2 AND id = $3
          RETURNING ${SELECT_COLUMNS}`,
        [
          this.orgId, ownerId, projectId, patch.name ?? null, patch.template ?? null, patch.problem ?? null,
          patch.criteria === undefined ? null : JSON.stringify(patch.criteria),
          patch.frames === undefined ? null : JSON.stringify(patch.frames),
        ],
      );
      const row = rows[0];
      if (row === undefined) return null;
      return toRow(row, await this.chatFor(s, row.id));
    });
  }

  async appendChat(
    projectId: string,
    ownerId: string,
    turns: readonly Omit<DesignProjectChatTurn, "at">[],
  ): Promise<DesignProjectRow | null> {
    return this.db.withTenant(toOrgId(this.orgId), async (s: TenantSession) => {
      // 先确认这行存在且是本人的——owner 谓词在这条 SELECT 上,不是先插入再回滚。
      const { rows: owned } = await s.query<{ id: string }>(
        `SELECT id FROM design_projects WHERE org_id = $1 AND owner_id = $2 AND id = $3`,
        [this.orgId, ownerId, projectId],
      );
      if (owned.length === 0) return null;

      for (const turn of turns) {
        await s.query(
          `INSERT INTO design_project_chat_messages (id, org_id, project_id, role, text, source)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [`${projectId}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`, this.orgId, projectId, turn.role, turn.text, turn.source ?? null],
        );
      }
      // ⚠ owner_id 再收窄一次——虽然上面那条 SELECT 已经确认过 owner,但这条 UPDATE 是独立语句,
      //   同 `update`/`delete`/`pushToInbox` 的纪律一致:每一条改 `design_projects` 的语句自己带
      //   谓词,不依赖"前面刚查过"这件事本身作为保护(那不是数据库能强制的东西,是读代码才知道的
      //   顺序)。`tests/design-workbench/project-repository-guard.test.ts` 逐条检查,不放过这条。
      await s.query(
        `UPDATE design_projects SET updated_at = now() WHERE org_id = $1 AND owner_id = $2 AND id = $3`,
        [this.orgId, ownerId, projectId],
      );

      const { rows } = await s.query<ProjectDbRow>(
        `SELECT ${SELECT_COLUMNS} FROM design_projects WHERE org_id = $1 AND id = $2`,
        [this.orgId, projectId],
      );
      const row = rows[0];
      if (row === undefined) return null;
      return toRow(row, await this.chatFor(s, row.id));
    });
  }

  async delete(projectId: string, ownerId: string): Promise<boolean> {
    return this.db.withTenant(toOrgId(this.orgId), async (s: TenantSession) => {
      const { rows } = await s.query<{ id: string }>(
        `DELETE FROM design_projects WHERE org_id = $1 AND owner_id = $2 AND id = $3 RETURNING id`,
        [this.orgId, ownerId, projectId],
      );
      return rows.length > 0;
    });
  }

  /**
   * ⚠ 事务边界：本方法体是**一次** `withTenant` 调用——①标记 pushed ②回写来源反馈的
   *   `resolved_by_design_id` 在同一个数据库事务里执行，见 `project-ports.ts` 头注。
   *   `note` 是 `undefined` 时用 `COALESCE` 保持原值（同 `updateProject` 的 patch 写法）；
   *   传了空字符串则清空（`COALESCE` 不会把空字符串当 NULL，行为符合直觉）。
   */
  async pushToInbox(projectId: string, ownerId: string, note: string | undefined): Promise<PushToInboxResult | null> {
    return this.db.withTenant(toOrgId(this.orgId), async (s: TenantSession) => {
      const { rows } = await s.query<ProjectDbRow>(
        `UPDATE design_projects
            SET pushed     = true,
                pushed_at  = now(),
                push_note  = COALESCE($4, push_note),
                updated_at = now()
          WHERE org_id = $1 AND owner_id = $2 AND id = $3
          RETURNING ${SELECT_COLUMNS}`,
        [this.orgId, ownerId, projectId, note ?? null],
      );
      const row = rows[0];
      if (row === undefined) return null;

      let resolvedFeedback = false;
      if (row.linked_feedback_id !== null) {
        const { rows: fbRows } = await s.query<{ id: string }>(
          `UPDATE product_feedback
              SET resolved_by_design_id = $3
            WHERE org_id = $1 AND id = $2
            RETURNING id`,
          [this.orgId, row.linked_feedback_id, projectId],
        );
        resolvedFeedback = fbRows.length > 0;
      }

      const chat = await this.chatFor(s, row.id);
      return { project: toRow(row, chat), resolvedFeedback };
    });
  }
}

export class PgDesignProjectRepository implements DesignProjectRepositoryFactory {
  constructor(private readonly db: DatabasePort) {}

  forOrg(orgId: string): DesignProjectRepository {
    return new ScopedPgDesignProjectRepository(this.db, orgId);
  }
}
