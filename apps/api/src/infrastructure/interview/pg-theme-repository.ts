/**
 * PostgreSQL 实现 —— `interview_themes` / `interview_theme_operations`（F04）。
 *
 * ⚠ 并发保护全部落在 SQL 语句本身的 `WHERE status = 'active'` / `WHERE weight = $previous`
 *   条件上（`theme-ports.ts` 头注），不是应用层自己判断"是不是冲突"。三个 `commit*`
 *   方法内部一旦发现某个 `UPDATE ... RETURNING` 影响的行数与预期不符，就抛一个仅本文件
 *   可见的 `ThemeCommitConflict`，让 `db.withTenant` 的事务整体回滚（不会留下"主题已转
 *   `merged` 但洞察没挪过去"这种半截状态），外层 `catch` 把它翻译成公开契约的 `null`
 *   （`commitMerge` 等方法的返回值约定，见 port 文件头）。
 */
import type { DatabasePort } from "../../application/ports/database.port";
import type { OrgId } from "../../domain/org-id";
import type {
  AdjustEvidenceWeightCommit,
  AdjustEvidenceWeightCommitResult,
  MergeThemesCommit,
  MergeThemesCommitResult,
  RevertedOperationKind,
  SplitThemeCommit,
  SplitThemeCommitResult,
  ThemeQuoteRow,
  ThemeRecord,
  ThemeRepository,
} from "../../application/interview/theme-ports";

/** 仅本文件内部使用：标记"这次 commit 因为并发被别的请求抢先"，触发事务回滚。 */
class ThemeCommitConflict extends Error {}

interface MergePayload {
  readonly mergedThemeId: string;
  readonly sourceThemes: readonly { readonly themeId: string; readonly label: string }[];
  readonly movedInsights: readonly { readonly insightId: string; readonly previousThemeId: string | null }[];
}

interface SplitPayload {
  readonly originalThemeId: string;
  readonly originalLabel: string;
  readonly newThemeIds: readonly string[];
  readonly movedInsights: readonly { readonly insightId: string; readonly previousThemeId: string | null }[];
}

interface AdjustWeightPayload {
  readonly quoteId: string;
  readonly previousWeight: number;
}

function randomToken(): string {
  // `crypto.randomUUID` 而非应用层的 `IdFactory`——回滚令牌不进对象命名空间
  // （不是 artifact/insight/theme 那类"东西的名字"），只是一次性凭证。
  return `revert-${crypto.randomUUID()}`;
}

export class PgThemeRepository implements ThemeRepository {
  constructor(private readonly db: DatabasePort) {}

  async getActiveThemes(orgId: OrgId, themeIds: readonly string[]): Promise<readonly ThemeRecord[]> {
    if (themeIds.length === 0) return [];
    return this.db.withTenant(orgId, async (s) => {
      const r = await s.query<{ id: string; label: string; status: string }>(
        `SELECT id, label, status FROM interview_themes
          WHERE org_id = $1 AND id = ANY($2::text[]) AND status = 'active'`,
        [orgId, themeIds],
      );
      return r.rows.map((row) => ({ themeId: row.id, label: row.label, status: row.status as ThemeRecord["status"] }));
    });
  }

  async getThemeQuoteFacts(orgId: OrgId, themeIds: readonly string[]): Promise<readonly ThemeQuoteRow[]> {
    if (themeIds.length === 0) return [];
    return this.db.withTenant(orgId, async (s) => {
      const r = await s.query<{
        quote_id: string; theme_id: string | null; subject_id: string | null;
        is_counterexample: boolean; is_appeasement: boolean; weight: string;
      }>(
        `SELECT q.id AS quote_id, i.theme_id AS theme_id, q.subject_id,
                q.is_counterexample, q.is_appeasement, q.weight
           FROM interview_insights i
           JOIN LATERAL unnest(i.evidence_quote_ids) AS eq(quote_id) ON true
           JOIN interview_quotes q ON q.org_id = i.org_id AND q.id = eq.quote_id
          WHERE i.org_id = $1 AND i.theme_id = ANY($2::text[])`,
        [orgId, themeIds],
      );
      return r.rows.map((row) => ({
        quoteId: row.quote_id, themeId: row.theme_id, subjectId: row.subject_id,
        isCounterexample: row.is_counterexample, isAppeasement: row.is_appeasement,
        weight: Number(row.weight),
      }));
    });
  }

  async getQuoteFact(orgId: OrgId, quoteId: string): Promise<ThemeQuoteRow | null> {
    return this.db.withTenant(orgId, async (s) => {
      const r = await s.query<{
        quote_id: string; subject_id: string | null; is_counterexample: boolean;
        is_appeasement: boolean; weight: string; theme_id: string | null;
      }>(
        `SELECT q.id AS quote_id, q.subject_id, q.is_counterexample, q.is_appeasement, q.weight,
                (SELECT i.theme_id FROM interview_insights i
                  WHERE i.org_id = $1 AND $2 = ANY(i.evidence_quote_ids) LIMIT 1) AS theme_id
           FROM interview_quotes q
          WHERE q.org_id = $1 AND q.id = $2`,
        [orgId, quoteId],
      );
      const row = r.rows[0];
      if (row === undefined) return null;
      return {
        quoteId: row.quote_id, themeId: row.theme_id, subjectId: row.subject_id,
        isCounterexample: row.is_counterexample, isAppeasement: row.is_appeasement,
        weight: Number(row.weight),
      };
    });
  }

  async commitMerge(input: MergeThemesCommit): Promise<MergeThemesCommitResult | null> {
    try {
      return await this.db.withTenant(input.orgId, async (s) => {
        await s.query(
          `INSERT INTO interview_themes (id, org_id, label, status, created_by)
           VALUES ($1, $2, $3, 'active', $4)`,
          [input.mergedThemeId, input.orgId, input.mergedLabel, input.actorId],
        );

        const consumed = await s.query<{ id: string; label: string }>(
          `UPDATE interview_themes SET status = 'merged', merged_into_theme_id = $3, updated_at = now()
             WHERE org_id = $1 AND id = ANY($2::text[]) AND status = 'active'
           RETURNING id, label`,
          [input.orgId, input.themeIds, input.mergedThemeId],
        );
        if (consumed.rows.length !== input.themeIds.length) throw new ThemeCommitConflict();

        // 每条洞察的"代表受访者"取它第一条证据引述所属的受访者（与 `commitSplit` 同一
        // 简化假设，见该方法头注）：只有裁决胜出的源主题下、该受访者名下的洞察才真正
        // 搬进合并主题；输掉裁决的（或代表受访者本身无法解析）改挂 `theme_id = NULL`
        // （退回未整理池，不是删除）——这是 `mergeThemes` 头注「先到先得」在写库这一步
        // 的落点，也是 `COUNTEREXAMPLE_WOULD_VANISH` 真正对应的物理效果。
        const insightRows = await s.query<{ insight_id: string; subject_id: string | null; previous_theme_id: string | null }>(
          `SELECT i.id AS insight_id, q.subject_id, i.theme_id AS previous_theme_id
             FROM interview_insights i
             LEFT JOIN interview_quotes q
               ON q.org_id = i.org_id AND q.id = i.evidence_quote_ids[1]
            WHERE i.org_id = $1 AND i.theme_id = ANY($2::text[])`,
          [input.orgId, input.themeIds],
        );

        const movedInsights: { insightId: string; previousThemeId: string | null }[] = [];
        for (const row of insightRows.rows) {
          const claimant = row.subject_id !== null ? input.subjectClaims.get(row.subject_id) : undefined;
          const target = claimant !== undefined && claimant === row.previous_theme_id ? input.mergedThemeId : null;
          await s.query(
            `UPDATE interview_insights SET theme_id = $3, updated_at = now() WHERE org_id = $1 AND id = $2`,
            [input.orgId, row.insight_id, target],
          );
          movedInsights.push({ insightId: row.insight_id, previousThemeId: row.previous_theme_id });
        }

        const revertToken = randomToken();
        const payload: MergePayload = {
          mergedThemeId: input.mergedThemeId,
          sourceThemes: consumed.rows.map((r) => ({ themeId: r.id, label: r.label })),
          movedInsights,
        };
        await s.query(
          `INSERT INTO interview_theme_operations (id, org_id, kind, revert_token, payload, created_by)
           VALUES ($1, $2, 'merge', $3, $4::jsonb, $5)`,
          [`${input.mergedThemeId}-op`, input.orgId, revertToken, JSON.stringify(payload), input.actorId],
        );

        return { mergedThemeId: input.mergedThemeId, revertToken };
      });
    } catch (e) {
      if (e instanceof ThemeCommitConflict) return null;
      throw e;
    }
  }

  async commitSplit(input: SplitThemeCommit): Promise<SplitThemeCommitResult | null> {
    try {
      return await this.db.withTenant(input.orgId, async (s) => {
        const consumed = await s.query<{ id: string; label: string }>(
          `UPDATE interview_themes SET status = 'split_out', updated_at = now()
             WHERE org_id = $1 AND id = $2 AND status = 'active'
           RETURNING id, label`,
          [input.orgId, input.themeId],
        );
        if (consumed.rows.length !== 1) throw new ThemeCommitConflict();

        for (const nt of input.newThemes) {
          await s.query(
            `INSERT INTO interview_themes (id, org_id, label, status, created_by)
             VALUES ($1, $2, $3, 'active', $4)`,
            [nt.themeId, input.orgId, nt.label, input.actorId],
          );
        }

        // 每条洞察的目标新主题由它第一条证据引述所属受访者决定（文件头「按受访者整体搬迁」
        // 在写库这一步的落点；没有可解析受访者的洞察落到第一个新主题，兜底不丢数据）。
        const insightRows = await s.query<{ insight_id: string; subject_id: string | null; previous_theme_id: string | null }>(
          `SELECT i.id AS insight_id, q.subject_id, i.theme_id AS previous_theme_id
             FROM interview_insights i
             LEFT JOIN interview_quotes q
               ON q.org_id = i.org_id AND q.id = i.evidence_quote_ids[1]
            WHERE i.org_id = $1 AND i.theme_id = $2`,
          [input.orgId, input.themeId],
        );

        const fallbackThemeId = input.newThemes[0]?.themeId;
        if (fallbackThemeId === undefined) throw new Error("splitThemes: intoLabels must not be empty");

        const movedInsights: { insightId: string; previousThemeId: string | null }[] = [];
        for (const row of insightRows.rows) {
          const target = (row.subject_id !== null ? input.subjectAssignment.get(row.subject_id) : undefined)
            ?? fallbackThemeId;
          await s.query(
            `UPDATE interview_insights SET theme_id = $3, updated_at = now() WHERE org_id = $1 AND id = $2`,
            [input.orgId, row.insight_id, target],
          );
          movedInsights.push({ insightId: row.insight_id, previousThemeId: row.previous_theme_id });
        }

        const revertToken = randomToken();
        const payload: SplitPayload = {
          originalThemeId: input.themeId,
          originalLabel: consumed.rows[0]!.label,
          newThemeIds: input.newThemes.map((t) => t.themeId),
          movedInsights,
        };
        await s.query(
          `INSERT INTO interview_theme_operations (id, org_id, kind, revert_token, payload, created_by)
           VALUES ($1, $2, 'split', $3, $4::jsonb, $5)`,
          [`${input.themeId}-split-op`, input.orgId, revertToken, JSON.stringify(payload), input.actorId],
        );

        return { themeIds: input.newThemes.map((t) => t.themeId), revertToken };
      });
    } catch (e) {
      if (e instanceof ThemeCommitConflict) return null;
      throw e;
    }
  }

  async commitAdjustWeight(input: AdjustEvidenceWeightCommit): Promise<AdjustEvidenceWeightCommitResult | null> {
    try {
      return await this.db.withTenant(input.orgId, async (s) => {
        const updated = await s.query<{ id: string; weight: string }>(
          `UPDATE interview_quotes SET weight = $4
             WHERE org_id = $1 AND id = $2 AND weight = $3
           RETURNING id, weight`,
          [input.orgId, input.quoteId, input.previousWeight, input.weight],
        );
        const row = updated.rows[0];
        if (row === undefined) throw new ThemeCommitConflict();

        const revertToken = randomToken();
        const payload: AdjustWeightPayload = { quoteId: input.quoteId, previousWeight: input.previousWeight };
        await s.query(
          `INSERT INTO interview_theme_operations (id, org_id, kind, revert_token, payload, created_by)
           VALUES ($1, $2, 'adjust_weight', $3, $4::jsonb, $5)`,
          [`${input.quoteId}-weight-op-${Date.now()}`, input.orgId, revertToken, JSON.stringify(payload), input.actorId],
        );

        return { quoteId: row.id, weight: Number(row.weight), revertToken };
      });
    } catch (e) {
      if (e instanceof ThemeCommitConflict) return null;
      throw e;
    }
  }

  async revert(orgId: OrgId, actorId: string, revertToken: string): Promise<{ readonly kind: RevertedOperationKind } | null> {
    return this.db.withTenant(orgId, async (s) => {
      const op = await s.query<{ id: string; kind: RevertedOperationKind; payload: unknown; reverted_at: string | null }>(
        `SELECT id, kind, payload, reverted_at FROM interview_theme_operations
          WHERE org_id = $1 AND revert_token = $2`,
        [orgId, revertToken],
      );
      const row = op.rows[0];
      if (row === undefined || row.reverted_at !== null) return null;

      if (row.kind === "merge") {
        const payload = row.payload as MergePayload;
        for (const source of payload.sourceThemes) {
          await s.query(
            `UPDATE interview_themes SET status = 'active', merged_into_theme_id = NULL, updated_at = now()
               WHERE org_id = $1 AND id = $2`,
            [orgId, source.themeId],
          );
        }
        for (const moved of payload.movedInsights) {
          await s.query(
            `UPDATE interview_insights SET theme_id = $3, updated_at = now() WHERE org_id = $1 AND id = $2`,
            [orgId, moved.insightId, moved.previousThemeId],
          );
        }
      } else if (row.kind === "split") {
        const payload = row.payload as SplitPayload;
        await s.query(
          `UPDATE interview_themes SET status = 'active', updated_at = now() WHERE org_id = $1 AND id = $2`,
          [orgId, payload.originalThemeId],
        );
        for (const moved of payload.movedInsights) {
          await s.query(
            `UPDATE interview_insights SET theme_id = $3, updated_at = now() WHERE org_id = $1 AND id = $2`,
            [orgId, moved.insightId, moved.previousThemeId],
          );
        }
      } else {
        const payload = row.payload as AdjustWeightPayload;
        await s.query(
          `UPDATE interview_quotes SET weight = $3 WHERE org_id = $1 AND id = $2`,
          [orgId, payload.quoteId, payload.previousWeight],
        );
      }

      await s.query(
        `UPDATE interview_theme_operations SET reverted_at = now() WHERE org_id = $1 AND id = $2`,
        [orgId, row.id],
      );
      return { kind: row.kind };
    });
  }
}
