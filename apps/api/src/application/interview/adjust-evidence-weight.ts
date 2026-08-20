/**
 * `adjustEvidenceWeight` —— 主题整理三动作之一（F04，uc-6-5 R3 step6）。
 *
 * ⚠ 调权同样可能抹掉唯一反例：把一条**唯一携带反例标记**的引述权重调到 ≤0，等价于把它
 *   从矩阵格子里抹掉（`domain/interview/theme-organize.ts` 的 `ThemeQuoteFact.weight`
 *   头注）。这是三个算子里唯一天然会触发 `COUNTEREXAMPLE_WOULD_VANISH` 的（`mergeThemes`
 *   合并多主题时同样会；`splitThemes` 当前的按受访者整体搬迁算法结构性地不会，见该文件
 *   头注）。
 * ⚠ 引述尚未挂靠任何主题（`themeId === null`，F01 遗留、还没被整理过）时，没有格子可守护，
 *   直接放行——这不是绕过守护，是没有守护对象。
 */
import type { OrgId } from "../../domain/org-id";
import { buildThemeSubjectCells, guardCounterexamplePreservation } from "../../domain/interview/theme-organize";
import { CounterexampleWouldVanishError, ThemeConcurrentModificationError } from "./errors";
import type { ThemeRepository } from "./theme-ports";

export interface AdjustEvidenceWeightDeps {
  readonly themes: ThemeRepository;
}

export interface AdjustEvidenceWeightInput {
  readonly orgId: OrgId;
  readonly actorId: string;
  readonly quoteId: string;
  readonly weight: number;
}

export interface AdjustEvidenceWeightResult {
  readonly quoteId: string;
  readonly weight: number;
  readonly revertToken: string;
}

export async function adjustEvidenceWeight(
  deps: AdjustEvidenceWeightDeps,
  input: AdjustEvidenceWeightInput,
): Promise<AdjustEvidenceWeightResult> {
  const quote = await deps.themes.getQuoteFact(input.orgId, input.quoteId);
  // 引述不存在——与 `InsightCandidateNotFoundError` 同一惯例，复用 `CONCURRENT_MODIFICATION`
  // 承载"引用的对象已不可解析"（errors.ts 的 F01 一节头注）。
  if (quote === null) throw new ThemeConcurrentModificationError(`quote ${input.quoteId}`);

  if (quote.themeId !== null) {
    const facts = await deps.themes.getThemeQuoteFacts(input.orgId, [quote.themeId]);
    const before = buildThemeSubjectCells(quote.themeId, facts.map((f) => ({
      quoteId: f.quoteId, subjectId: f.subjectId, isCounterexample: f.isCounterexample,
      isAppeasement: f.isAppeasement, weight: f.weight,
    })));
    const after = buildThemeSubjectCells(quote.themeId, facts.map((f) => ({
      quoteId: f.quoteId, subjectId: f.subjectId, isCounterexample: f.isCounterexample,
      isAppeasement: f.isAppeasement,
      weight: f.quoteId === input.quoteId ? input.weight : f.weight,
    })));
    const guard = guardCounterexamplePreservation(before, after);
    if (!guard.ok) throw new CounterexampleWouldVanishError(guard.vanishing);
  }

  const committed = await deps.themes.commitAdjustWeight({
    orgId: input.orgId,
    actorId: input.actorId,
    quoteId: input.quoteId,
    previousWeight: quote.weight,
    weight: input.weight,
  });
  if (committed === null) throw new ThemeConcurrentModificationError(`quote ${input.quoteId}`);

  return committed;
}
