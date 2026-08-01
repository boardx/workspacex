/**
 * 蓝本列表行的派生（F30 / D-03 / AC4，`uc-2-4` R3 步骤 5 · R12 V4）。
 *
 * 纯函数：没有时钟、没有 I/O。字段来源全部由调用方传入（谁套用过、谁打过分、
 * 完成了哪些配置项……），这里只做**派生与拼装**，不做查询。
 *
 * ## 本文件守的三条性质
 *
 * · **D-03 术语三分**：`agendaSegmentCount`（议程环节数，随时长档位变）与
 *   `completeness`（设计配置完成度，恒以定义表长度为分母）是**两个独立字段**，
 *   共用同一次派生入口的目的就是让它们**不可能被调用方自己拼错行**（串位）。
 * · **O-37 ③ 满意度阈值**：样本量低于阈值 ⇒ 返回 `null`（界面显示「样本不足」），
 *   阈值是**参数**，不是写死的数字（产品尚未定稿最小样本量，见 R10）。
 * · **I-8 行操作派生**：`[× 删除]` 与 `[归档]` 互斥，由 `referencingProjectCount`
 *   同一个阈值判定（复用 `archive-delete-gate.ts` 的 `deleteButtonReplacedByArchive`），
 *   不是前端各自猜。
 */

import { deriveCompleteness, type CompletenessResult } from "./completeness";
import type { DesignFacetRow } from "./design-facet-table";
import { deleteButtonReplacedByArchive } from "./archive-delete-gate";
import { displayVersionNumber, type BlueprintState, type BlueprintVersion } from "./blueprint-version";

export type BlueprintRowAction = "archive" | "delete" | "copy" | "rollback";

/**
 * 满意度 = 项目复盘均值，样本量不足则不给分数（O-37 ③）。
 *
 * ⚠ `minSampleSize` 是入参而不是常量：最小样本量待产品裁定，
 *   这里只落「不足即不显示」这条已定口径（R10 逐字）。
 */
export function deriveSatisfaction(
  reviewScores: readonly number[],
  minSampleSize: number,
): { readonly satisfaction: number | null; readonly sampleSize: number } {
  const sampleSize = reviewScores.length;
  if (sampleSize < minSampleSize) return { satisfaction: null, sampleSize };
  const avg = reviewScores.reduce((sum, s) => sum + s, 0) / sampleSize;
  return { satisfaction: avg, sampleSize };
}

/**
 * 行操作集合（I-8 / uc-2-4 R3 步骤 5）。
 * ⚠ `copy` 恒可用；`rollback` 只在**有版本历史**（至少发布过一次）时才有意义——
 *   一个从未发布过的草稿没有版本可回滚。
 */
export function deriveBlueprintRowActions(params: {
  readonly state: BlueprintState;
  readonly referencingProjectCount: number;
  readonly hasPublishedVersion: boolean;
}): readonly BlueprintRowAction[] {
  const actions: BlueprintRowAction[] = ["copy"];
  if (deleteButtonReplacedByArchive(params.referencingProjectCount)) {
    actions.push("archive");
  } else {
    actions.push("delete");
  }
  if (params.hasPublishedVersion) actions.push("rollback");
  return actions;
}

/**
 * ⚠ 不叫 `BlueprintRow`：那个名字属于契约（`packages/contracts/src/templates.ts`），
 *   同名一次就是第二份定义（`contract-single-source.test.ts`）。领域层只拼装出
 *   契约形状需要的字段，形状归契约，名字不与它撞。
 */
export interface BlueprintListRowInput {
  readonly blueprintId: string;
  readonly name: string;
  readonly state: BlueprintState;
  readonly currentVersion: BlueprintVersion | null;
  /** 议程环节数（`agenda_segment`）——**不是**设计配置完成度的分子分母任何一半 */
  readonly agendaSegmentCount: number;
  /** 「用过 N 次」：调用方已排除试跑实例（I-22），本函数不重新过滤 */
  readonly appliedProjectCount: number;
  readonly referencingProjectCount: number;
  readonly reviewScores: readonly number[];
  readonly minSatisfactionSampleSize: number;
  readonly completedDesignFacetKeys: readonly string[];
  readonly designFacetTable?: readonly DesignFacetRow[];
}

export interface BlueprintListRow {
  readonly blueprintId: string;
  readonly name: string;
  readonly state: BlueprintState;
  /** ⚠ 草稿态为 null（uc-2-4 R7：「草稿态蓝本不显示版本号」） */
  readonly versionNumber: number | null;
  readonly agendaSegmentCount: number;
  readonly appliedProjectCount: number;
  readonly satisfaction: number | null;
  readonly completeness: CompletenessResult;
  readonly availableActions: readonly BlueprintRowAction[];
}

/** 拼装一整行。⚠ 两个「数字」字段（议程环节数 / 完成度）分别来自各自的入参，不互相推导。 */
export function deriveBlueprintRow(input: BlueprintListRowInput): BlueprintListRow {
  const { satisfaction } = deriveSatisfaction(input.reviewScores, input.minSatisfactionSampleSize);
  return {
    blueprintId: input.blueprintId,
    name: input.name,
    state: input.state,
    versionNumber: displayVersionNumber(input.state, input.currentVersion),
    agendaSegmentCount: input.agendaSegmentCount,
    appliedProjectCount: input.appliedProjectCount,
    satisfaction,
    completeness: deriveCompleteness(input.completedDesignFacetKeys, input.designFacetTable),
    availableActions: deriveBlueprintRowActions({
      state: input.state,
      referencingProjectCount: input.referencingProjectCount,
      hasPublishedVersion: input.currentVersion !== null || input.state === "archived",
    }),
  };
}
