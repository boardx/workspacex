/**
 * Ports for F04（phase-11）—— 主题整理三动作（`mergeThemes` / `splitThemes` /
 * `adjustEvidenceWeight`）共用的存储形状。
 *
 * ⚠ 并发保护（E3/V12）不靠客户端传 `expectedVersion`（契约的 `in` 里确实没有这个
 *   字段）——三个 `commit*` 方法约定：**返回 `null` 就是"发生了并发冲突"**，具体判据
 *   由各自实现在同一个 SQL 语句里用 `WHERE status = 'active'`（主题）之类的条件表达，
 *   Postgres 的行级锁保证两个真正并发的写请求里只有一个的 WHERE 条件在提交时仍然成立。
 *   application 层收到 `null` 一律抛 `ThemeConcurrentModificationError`，与
 *   `TemplateVersionChangedError` 用 `null` 传导冲突同一惯例
 *   （见 `template-ports.ts` 头注）。
 */
import type { OrgId } from "../../domain/org-id";

export type ThemeStatus = "active" | "merged" | "split_out";

export interface ThemeRecord {
  readonly themeId: string;
  readonly label: string;
  readonly status: ThemeStatus;
}

/** 某条引述在"归入哪个矩阵格子"这件事上的完整事实，外加它当前挂在哪个主题下。 */
export interface ThemeQuoteRow {
  readonly quoteId: string;
  readonly themeId: string | null;
  readonly subjectId: string | null;
  readonly isCounterexample: boolean;
  readonly isAppeasement: boolean;
  readonly weight: number;
}

export interface MergeThemesCommit {
  readonly orgId: OrgId;
  readonly actorId: string;
  /** 已核实全部 `active` 的源主题 id（application 层在调用前已用 `getActiveThemes` 核过）。 */
  readonly themeIds: readonly string[];
  readonly mergedThemeId: string;
  readonly mergedLabel: string;
  /**
   * 受访者 → 该受访者证据"归属哪个源主题"的裁决（application 层按 `themeIds` 的**请求
   * 顺序**、先到先得算出，见 `merge-themes.ts` 头注）。⚠ 这不是可选的元数据——它是
   * `COUNTEREXAMPLE_WOULD_VANISH` 真正可能触发的原因：同一受访者若在多个待合并主题里
   * 都有证据，只有"裁决胜出"的那个源主题的证据进最终合并主题，另一源主题下这位受访者
   * 名下的洞察改挂 `theme_id = NULL`（退回未整理池，不是被删除）。裁决只在一个主题下
   * 都有数据的受访者身上生效；只出现在单一源主题的受访者不受影响，照常整体搬入合并主题。
   */
  readonly subjectClaims: ReadonlyMap<string, string>;
}

export interface MergeThemesCommitResult {
  readonly mergedThemeId: string;
  readonly revertToken: string;
}

export interface SplitThemeCommit {
  readonly orgId: OrgId;
  readonly actorId: string;
  readonly themeId: string;
  /** 新主题 id 与其标签一一对应，顺序即 `intoLabels` 的顺序。 */
  readonly newThemes: readonly { readonly themeId: string; readonly label: string }[];
  /** 受访者 → 目标新主题 id 的重分配方案（按受访者整体搬迁，见 application 层算法说明）。 */
  readonly subjectAssignment: ReadonlyMap<string, string>;
}

export interface SplitThemeCommitResult {
  readonly themeIds: readonly string[];
  readonly revertToken: string;
}

export interface AdjustEvidenceWeightCommit {
  readonly orgId: OrgId;
  readonly actorId: string;
  readonly quoteId: string;
  readonly previousWeight: number;
  readonly weight: number;
}

export interface AdjustEvidenceWeightCommitResult {
  readonly quoteId: string;
  readonly weight: number;
  readonly revertToken: string;
}

export type RevertedOperationKind = "merge" | "split" | "adjust_weight";

export interface ThemeRepository {
  /**
   * 只返回仍 `status = 'active'` 的主题行；请求的 id 里若有已被消费或不存在的，
   * 直接从结果集中缺席——调用方用 `返回集合长度 !== 请求集合长度` 判定并发冲突/不可用。
   */
  getActiveThemes(orgId: OrgId, themeIds: readonly string[]): Promise<readonly ThemeRecord[]>;

  /** 给定一组主题 id，取它们名下全部洞察引用到的引述事实（经 `interview_insights.theme_id` 关联）。 */
  getThemeQuoteFacts(orgId: OrgId, themeIds: readonly string[]): Promise<readonly ThemeQuoteRow[]>;

  /** 按 id 精确取一条引述的事实（含它当前挂靠的主题，可能为 `null`）。找不到返回 `null`。 */
  getQuoteFact(orgId: OrgId, quoteId: string): Promise<ThemeQuoteRow | null>;

  /** 合并：新建目标主题、源主题批量转 `merged`、洞察批量转挂到新主题，一个事务。冲突返回 `null`。 */
  commitMerge(input: MergeThemesCommit): Promise<MergeThemesCommitResult | null>;

  /** 拆分：新建 N 个目标主题、源主题转 `split_out`、洞察按受访者分配到新主题，一个事务。冲突返回 `null`。 */
  commitSplit(input: SplitThemeCommit): Promise<SplitThemeCommitResult | null>;

  /** 调权：改一条引述的 `weight`，一个事务。冲突返回 `null`（引述已不存在/已被并发改过）。 */
  commitAdjustWeight(input: AdjustEvidenceWeightCommit): Promise<AdjustEvidenceWeightCommitResult | null>;

  /**
   * 按回滚令牌精确还原到操作前状态。令牌不存在或已被兑现过 ⇒ 返回 `null`
   * （调用方据此抛 `ThemeRevertTokenInvalidError`），不做部分回滚。
   */
  revert(orgId: OrgId, actorId: string, revertToken: string): Promise<{ readonly kind: RevertedOperationKind } | null>;
}

export const THEME_REPOSITORY = Symbol("ThemeRepository");
