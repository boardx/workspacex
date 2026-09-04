/**
 * UC-17.8 B1 —— `product_feedback_drafts` 的 PostgreSQL 适配器
 * （迁移 `20260904130100_uc178_feedback_drafts.sql`）。
 *
 * ⚠ 每个方法恰好一次 `withTenant`，没有 `withoutTenant`——同 `pg-product-feedback-repository.ts`。
 * ⚠ 每条 SQL 同时带 `org_id = $n`（RLS 之外的第二道防线）**和** `owner_id = $n`——后者是
 *   「草稿是提交人私有物」这条规则的唯一实现位置：不是先读出来再在应用层比对。
 *   `tests/feedback/draft-repository-guard.test.ts` 解析本文件，任何一条面向请求方的
 *   SELECT / UPDATE / DELETE 丢了 `owner_id` 谓词就会变红——这也是本文件在
 *   `lint-permission-paths` allowlist 里那条豁免的前提。
 *
 * ## 为什么不经 `Guarded<T>`
 *
 * `Guarded` 保护的是**披露**：让人无法在没有权限判定的情况下把租户内容交给请求方。草稿背后
 * 没有 ACL 对象，也没有 D3 那种「管理员 + 提交人」的多方判定——它的披露规则只有一条
 * 「只有 owner 能读」，而这条规则由 SQL 谓词表达，读不到就是读不到（用例翻成 `DRAFT_NOT_FOUND`）。
 * 为了过 linter 给它套一个恒真的 `discloseDecided` 会更糟：那是一道读起来像门、实际不是门的门
 * （`ports.ts` 的 `FeedbackRow` 头注对标题/票数说的正是这件事）。与
 * `pg-skill-trial-run-store.ts` 的豁免同一形态。
 */
import { feedbackLoop } from "@repo/contracts";
import type { DatabasePort, TenantSession } from "../../application/ports/database.port";
import { toOrgId } from "../../domain/org-id";
import type {
  FeedbackDraftChatTurn,
  FeedbackDraftPatch,
  FeedbackDraftRepository,
  FeedbackDraftRepositoryFactory,
  FeedbackDraftRow,
  NewFeedbackDraft,
} from "../../application/feedback/draft-ports";
import type { FeedbackStructured, FeedbackTarget } from "../../application/feedback/ports";

interface DraftDbRow {
  readonly id: string;
  readonly owner_id: string;
  readonly kind: string;
  readonly target_kind: string;
  readonly target_agent_id: string | null;
  readonly target_skill_id: string | null;
  readonly detail: string;
  readonly structured: unknown;
  readonly chat: unknown;
  readonly refine_seeded: boolean;
  readonly occurred_route: string | null;
  readonly app_version: string | null;
  readonly created_at: Date | string;
  readonly updated_at: Date | string;
}

/** 同 `pg-product-feedback-repository.ts` 的 `toTarget`：对不上的组合抛，不默认当 product。 */
function toTarget(row: DraftDbRow): FeedbackTarget {
  if (row.target_kind === "product") return { kind: "product" };
  if (row.target_kind === "agent" && row.target_agent_id !== null) {
    return { kind: "agent", agentId: row.target_agent_id };
  }
  if (row.target_kind === "skill" && row.target_skill_id !== null) {
    return { kind: "skill", skillId: row.target_skill_id };
  }
  throw new Error(`product_feedback_drafts ${row.id}: target columns violate the pairing CHECK`);
}

/**
 * `chat` 列是 jsonb 数组，写入侧只写契约形状；读回来仍过一次契约 schema——直连 SQL 写坏的
 * 一条记录在这里抛而不是投影成一个前端渲染不出来的对象。
 */
function toChat(raw: unknown, draftId: string): readonly FeedbackDraftChatTurn[] {
  const parsed = feedbackLoop.FeedbackDraftChatTurn.array().safeParse(raw ?? []);
  if (!parsed.success) throw new Error(`product_feedback_drafts ${draftId}: chat column is not a FeedbackDraftChatTurn[]`);
  return parsed.data;
}

function toRow(row: DraftDbRow): FeedbackDraftRow {
  return {
    id: row.id,
    ownerId: row.owner_id,
    kind: row.kind as "缺陷" | "需求",
    target: toTarget(row),
    detail: row.detail,
    structured: (row.structured ?? null) as FeedbackStructured | null,
    chat: toChat(row.chat, row.id),
    refineSeeded: row.refine_seeded,
    occurredRoute: row.occurred_route,
    appVersion: row.app_version,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

const SELECT_COLUMNS = `
  id, owner_id, kind, target_kind, target_agent_id, target_skill_id,
  detail, structured, chat, refine_seeded, occurred_route, app_version, created_at, updated_at`;

class ScopedPgFeedbackDraftRepository implements FeedbackDraftRepository {
  constructor(
    private readonly db: DatabasePort,
    private readonly orgId: string,
  ) {}

  async create(draft: NewFeedbackDraft): Promise<void> {
    await this.db.withTenant(toOrgId(this.orgId), async (s: TenantSession) => {
      await s.query(
        `INSERT INTO product_feedback_drafts
           (id, org_id, owner_id, kind, target_kind, target_agent_id, target_skill_id,
            detail, structured, occurred_route, app_version)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11)`,
        [
          draft.id,
          this.orgId,
          draft.ownerId,
          draft.kind,
          draft.target.kind,
          draft.target.kind === "agent" ? draft.target.agentId : null,
          draft.target.kind === "skill" ? draft.target.skillId : null,
          draft.detail,
          draft.structured === null ? null : JSON.stringify(draft.structured),
          draft.occurredRoute,
          draft.appVersion,
        ],
      );
    });
  }

  async listMine(ownerId: string): Promise<readonly FeedbackDraftRow[]> {
    return this.db.withTenant(toOrgId(this.orgId), async (s: TenantSession) => {
      const { rows } = await s.query<DraftDbRow>(
        `SELECT ${SELECT_COLUMNS}
           FROM product_feedback_drafts
          WHERE org_id = $1 AND owner_id = $2
          ORDER BY updated_at DESC, id DESC`,
        [this.orgId, ownerId],
      );
      return rows.map(toRow);
    });
  }

  async countMine(ownerId: string): Promise<number> {
    return this.db.withTenant(toOrgId(this.orgId), async (s: TenantSession) => {
      const { rows } = await s.query<{ n: string | number }>(
        `SELECT count(*) AS n
           FROM product_feedback_drafts
          WHERE org_id = $1 AND owner_id = $2`,
        [this.orgId, ownerId],
      );
      return Number(rows[0]?.n ?? 0);
    });
  }

  async get(draftId: string, ownerId: string): Promise<FeedbackDraftRow | null> {
    return this.db.withTenant(toOrgId(this.orgId), async (s: TenantSession) => {
      const { rows } = await s.query<DraftDbRow>(
        `SELECT ${SELECT_COLUMNS}
           FROM product_feedback_drafts
          WHERE org_id = $1 AND owner_id = $2 AND id = $3`,
        [this.orgId, ownerId, draftId],
      );
      const row = rows[0];
      return row === undefined ? null : toRow(row);
    });
  }

  /**
   * ⚠ 一条 UPDATE，未给的字段用 `COALESCE($n, 列)` 保持原值。`structured` 例外——它可以被显式
   *   置 `null`（契约 `.nullable().optional()`），所以用一个独立的布尔参数区分「没传」与「传了 null」。
   */
  async update(draftId: string, ownerId: string, patch: FeedbackDraftPatch): Promise<FeedbackDraftRow | null> {
    const structuredGiven = patch.structured !== undefined;
    return this.db.withTenant(toOrgId(this.orgId), async (s: TenantSession) => {
      const { rows } = await s.query<DraftDbRow>(
        `UPDATE product_feedback_drafts
            SET kind          = COALESCE($4, kind),
                detail        = COALESCE($5, detail),
                structured    = CASE WHEN $6::boolean THEN $7::jsonb ELSE structured END,
                chat          = COALESCE($8::jsonb, chat),
                refine_seeded = COALESCE($9, refine_seeded),
                updated_at    = now()
          WHERE org_id = $1 AND owner_id = $2 AND id = $3
          RETURNING ${SELECT_COLUMNS}`,
        [
          this.orgId,
          ownerId,
          draftId,
          patch.kind ?? null,
          patch.detail ?? null,
          structuredGiven,
          structuredGiven && patch.structured !== null ? JSON.stringify(patch.structured) : null,
          patch.chat === undefined ? null : JSON.stringify(patch.chat),
          patch.refineSeeded ?? null,
        ],
      );
      const row = rows[0];
      return row === undefined ? null : toRow(row);
    });
  }

  async delete(draftId: string, ownerId: string): Promise<boolean> {
    return this.db.withTenant(toOrgId(this.orgId), async (s: TenantSession) => {
      const { rows } = await s.query<{ id: string }>(
        `DELETE FROM product_feedback_drafts
          WHERE org_id = $1 AND owner_id = $2 AND id = $3
          RETURNING id`,
        [this.orgId, ownerId, draftId],
      );
      return rows.length > 0;
    });
  }
}

export class PgFeedbackDraftRepository implements FeedbackDraftRepositoryFactory {
  constructor(private readonly db: DatabasePort) {}

  forOrg(orgId: string): FeedbackDraftRepository {
    return new ScopedPgFeedbackDraftRepository(this.db, orgId);
  }
}
