/**
 * `splitThemes` —— 主题整理三动作之一（F04，uc-6-5 R3 step6，「同构」于 `mergeThemes`）。
 *
 * ⚠ 契约 `in` 只给 `intoLabels`（新主题的标签），**没有**逐条引述/洞察该去哪个新主题的
 *   映射——这不是本文件漏实现，是契约本身在这一点上留白（`splitThemes` 的形状原样照抄，
 *   不许改契约类型）。给定这个约束，唯一不会"武断拆散同一受访者证据"的确定性算法是
 *   **按受访者整体搬迁**：先把原主题下出现过的受访者去重排序，再按顺序轮转分配到
 *   `intoLabels` 对应的新主题——同一个受访者的全部引述（含反例）永远整体挪到同一个
 *   新主题，不会出现"一半留这、一半去那"。
 * ⚠ 这个算法的直接推论：`guardCounterexamplePreservation` 在当前实现下**恒放行**
 *   （某受访者的反例证据只会整体出现在唯一一个新主题里，不会消失）。守护调用本身仍然
 *   保留、并不是被绕开——它与 `mergeThemes`/`adjustEvidenceWeight` 共用同一个函数，
 *   真正能触发 `COUNTEREXAMPLE_WOULD_VANISH` 的是后两者（尤其是把反例引述的权重调到 0）；
 *   `tests/itv/theme-merge-counterexample-guard.test.ts` 因此把触发场景放在 merge 上，
 *   不是本文件遗漏了这个断言。
 */
import type { OrgId } from "../../domain/org-id";
import type { IdFactory } from "../artifact/ports";
import { buildThemeSubjectCells, guardCounterexamplePreservation } from "../../domain/interview/theme-organize";
import { CounterexampleWouldVanishError, ThemeConcurrentModificationError } from "./errors";
import type { ThemeRepository } from "./theme-ports";

export interface SplitThemesDeps {
  readonly themes: ThemeRepository;
  readonly ids: IdFactory;
}

export interface SplitThemesInput {
  readonly orgId: OrgId;
  readonly actorId: string;
  readonly themeId: string;
  readonly intoLabels: readonly string[];
}

export interface SplitThemesResult {
  readonly themeIds: readonly string[];
  readonly revertToken: string;
}

export async function splitThemes(deps: SplitThemesDeps, input: SplitThemesInput): Promise<SplitThemesResult> {
  const active = await deps.themes.getActiveThemes(input.orgId, [input.themeId]);
  const source = active[0];
  if (source === undefined) throw new ThemeConcurrentModificationError(`theme ${input.themeId}`);

  const facts = await deps.themes.getThemeQuoteFacts(input.orgId, [input.themeId]);
  const beforeCells = buildThemeSubjectCells(input.themeId, facts.map((f) => ({
    quoteId: f.quoteId, subjectId: f.subjectId, isCounterexample: f.isCounterexample,
    isAppeasement: f.isAppeasement, weight: f.weight,
  })));

  // 按受访者整体轮转分配（见文件头「为什么是这个算法」）。
  const subjectIds = [...new Set(facts.map((f) => f.subjectId).filter((s): s is string => s !== null))].sort();
  const newThemes = input.intoLabels.map((label) => ({ themeId: deps.ids.next("itv-theme"), label }));
  const subjectAssignment = new Map<string, string>();
  subjectIds.forEach((subjectId, i) => {
    const target = newThemes[i % newThemes.length];
    if (target !== undefined) subjectAssignment.set(subjectId, target.themeId);
  });

  // "拆分后"：每个受访者的证据整体落在被分配到的新主题下——按新主题分组重算格子。
  const afterCells = newThemes.flatMap((nt) => {
    const subjectsHere = subjectIds.filter((s) => subjectAssignment.get(s) === nt.themeId);
    const factsHere = facts.filter((f) => f.subjectId !== null && subjectsHere.includes(f.subjectId));
    return buildThemeSubjectCells(nt.themeId, factsHere.map((f) => ({
      quoteId: f.quoteId, subjectId: f.subjectId, isCounterexample: f.isCounterexample,
      isAppeasement: f.isAppeasement, weight: f.weight,
    })));
  });

  const guard = guardCounterexamplePreservation(beforeCells, afterCells);
  if (!guard.ok) throw new CounterexampleWouldVanishError(guard.vanishing);

  const committed = await deps.themes.commitSplit({
    orgId: input.orgId,
    actorId: input.actorId,
    themeId: input.themeId,
    newThemes,
    subjectAssignment,
  });
  if (committed === null) throw new ThemeConcurrentModificationError(`theme ${input.themeId}`);

  return committed;
}
