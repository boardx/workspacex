/**
 * `mergeThemes` —— 主题整理三动作之一（F04，uc-6-5 R3 step6，R12 V4/V12）。
 *
 * ## 合并规则："先到先得"裁决重叠受访者，不是简单并集
 *
 * 若某位受访者只在待合并的主题里的**一个**里有证据，这位受访者的全部证据原样整体
 * 搬进合并后的主题——多数情况下的多数受访者都是这一支路径，行为等价于直觉上的
 * "把几个主题的东西倒到一起"。
 *
 * ⚠ 但若某位受访者**同时**出现在多个待合并主题里（现场对同一人的证据被分到了不同
 *   主题下这件事本身会发生），本 feature 按 `themeIds` 的**请求顺序**"先到先得"：
 *   排在前面的主题拿下这位受访者的证据归属，排在后面的主题里这位受访者名下的洞察
 *   **不会**跟着并入合并主题，而是被退回"未整理池"（`theme_id = NULL`，不是删除）。
 *   这正是合并**会**让唯一反例消失的真实原因——如果这位受访者唯一的反例证据恰好在
 *   "输"的那个主题里，合并后的主题就再也看不到这条反例了。简单并集（永远不丢任何
 *   已存在的证据）在这个数据模型下no-op 地不可能真正丢证据，`COUNTEREXAMPLE_WOULD_VANISH`
 *   也就无从触发——先到先得的裁决规则才是这个错误码在 `mergeThemes` 这一侧真正的
 *   触发点，`guardCounterexamplePreservation` 守的正是这一步。
 *
 * ⚠ **`preview: true` 永远成功返回**，不抛 `COUNTEREXAMPLE_WOULD_VANISH`——预检的
 *   全部价值就是让调用方在写库之前看到 `vanishingCells`，抛错反而让"先看一眼"这件事
 *   本身都做不到。只有 `preview: false` 才会在命中危险时真正阻断。
 * ⚠ **并发保护不靠客户端传版本号**（契约 `in` 里没有这个字段）：`getActiveThemes`
 *   在写库前核一次"这些主题是不是仍然 active"，`ThemeRepository.commitMerge` 在同一个
 *   事务里用 `WHERE status = 'active'` 再核一次并原子地翻转——两次检查中间的窗口由
 *   数据库的行锁兜底，`commitMerge` 返回 `null` 就是这条底线被触发的信号。
 */
import type { OrgId } from "../../domain/org-id";
import type { IdFactory } from "../artifact/ports";
import { buildThemeSubjectCells, guardCounterexamplePreservation } from "../../domain/interview/theme-organize";
import type { ThemeSubjectCell } from "../../domain/interview/theme-organize";
import { CounterexampleWouldVanishError, ThemeConcurrentModificationError } from "./errors";
import type { ThemeQuoteRow, ThemeRepository } from "./theme-ports";

export interface MergeThemesDeps {
  readonly themes: ThemeRepository;
  readonly ids: IdFactory;
}

export interface MergeThemesInput {
  readonly orgId: OrgId;
  readonly actorId: string;
  readonly themeIds: readonly string[];
  readonly preview: boolean;
}

export interface VanishingCell {
  readonly themeId: string;
  readonly subjectId: string;
  readonly counterexample: boolean;
}

export interface MergeThemesResult {
  readonly mergedThemeId: string | null;
  readonly vanishingCells: readonly VanishingCell[];
  readonly revertToken: string | null;
}

function toVanishingCells(vanishing: readonly { themeId: string; subjectId: string }[]): VanishingCell[] {
  // 会消失的格子按 `guardCounterexamplePreservation` 的定义只可能是"合并前是反例、合并后
  // 不再是"，所以 `counterexample` 恒为 true——这不是第二次判定,是同一个事实的只读投影
  // （见 `domain/interview/evidence-matrix.ts` 里 `cellToContractShape` 的同一纪律）。
  return vanishing.map((v) => ({ themeId: v.themeId, subjectId: v.subjectId, counterexample: true }));
}

/** 按 `themeIds` 请求顺序"先到先得"：每位受访者的证据归属唯一一个源主题。 */
function computeSubjectClaims(
  themeIdsInOrder: readonly string[],
  facts: readonly ThemeQuoteRow[],
): Map<string, string> {
  const claims = new Map<string, string>();
  for (const themeId of themeIdsInOrder) {
    const subjectsHere = new Set(
      facts
        .filter((f) => f.themeId === themeId && f.subjectId !== null && f.weight > 0)
        .map((f) => f.subjectId as string),
    );
    for (const subjectId of subjectsHere) {
      if (!claims.has(subjectId)) claims.set(subjectId, themeId);
    }
  }
  return claims;
}

/** 只保留"裁决胜出"的那部分事实，重算成合并后单一主题下的格子。 */
function afterMergeCells(facts: readonly ThemeQuoteRow[], claims: ReadonlyMap<string, string>): ThemeSubjectCell[] {
  const kept = facts.filter((f) => f.subjectId !== null && claims.get(f.subjectId) === f.themeId);
  return buildThemeSubjectCells("__merged__", kept.map((f) => ({
    quoteId: f.quoteId, subjectId: f.subjectId, isCounterexample: f.isCounterexample,
    isAppeasement: f.isAppeasement, weight: f.weight,
  })));
}

export async function mergeThemes(deps: MergeThemesDeps, input: MergeThemesInput): Promise<MergeThemesResult> {
  const active = await deps.themes.getActiveThemes(input.orgId, input.themeIds);
  if (active.length !== input.themeIds.length) {
    throw new ThemeConcurrentModificationError(`themes ${input.themeIds.join(",")}`);
  }

  const facts = await deps.themes.getThemeQuoteFacts(input.orgId, input.themeIds);

  // "合并前"：每个源主题各自的格子（同一受访者若跨多个源主题都有证据，各主题下各算一格）。
  const beforeCells: ThemeSubjectCell[] = active.flatMap((theme) =>
    buildThemeSubjectCells(
      theme.themeId,
      facts.filter((f) => f.themeId === theme.themeId).map((f) => ({
        quoteId: f.quoteId, subjectId: f.subjectId, isCounterexample: f.isCounterexample,
        isAppeasement: f.isAppeasement, weight: f.weight,
      })),
    ),
  );
  const claims = computeSubjectClaims(input.themeIds, facts);
  const afterCells = afterMergeCells(facts, claims);

  const guard = guardCounterexamplePreservation(beforeCells, afterCells);
  const vanishingCells = guard.ok ? [] : toVanishingCells(guard.vanishing);

  if (input.preview) {
    return { mergedThemeId: null, vanishingCells, revertToken: null };
  }

  if (!guard.ok) {
    throw new CounterexampleWouldVanishError(guard.vanishing);
  }

  const mergedThemeId = deps.ids.next("itv-theme");
  const mergedLabel = active.map((t) => t.label).join(" + ");
  const committed = await deps.themes.commitMerge({
    orgId: input.orgId,
    actorId: input.actorId,
    themeIds: input.themeIds,
    mergedThemeId,
    mergedLabel,
    subjectClaims: claims,
  });
  if (committed === null) {
    throw new ThemeConcurrentModificationError(`themes ${input.themeIds.join(",")}`);
  }

  return { mergedThemeId: committed.mergedThemeId, vanishingCells: [], revertToken: committed.revertToken };
}
