/**
 * F105 — 组画布状态与同步状态取固定 enum（O-32）。
 *
 * ⚠ `GroupCanvasStatus` 的 `"落后"` **当且仅当** `missingRequiredSections` 非空
 *   （I-20）——**不与其他组横向比较**。"别的组填得比我快" 不构成"落后"，
 *   只有"这张画布自己有必填分区还空着"才算。本文件不接受任何形式的跨组比较输入。
 * ⚠ `computeCompleteness` 的 `defined` **严格等于**模板 `sections` 条数（I-21），
 *   分母来自模板分区定义表，不是"已经出现过便签的分区数"。
 * ⚠ "无来源 · 待补"的草稿（`citationRef === null` 且 `aiGenerated`）**不计入完成度
 *   分子** `done`（I-23）——这条把"留白"与"已完成"区分开。
 * ⚠ `stalled` 阈值**默认 5 分钟、可配置**（O-32）——本文件不硬编码 5 分钟为
 *   唯一取值，而是把它做成一个有默认值的参数。
 */
import type { z } from "zod";
import { canvas as C } from "@repo/contracts";

export type GroupCanvasStatus = z.infer<typeof C.GroupCanvasStatus>;
export type CanvasSyncStatus = z.infer<typeof C.CanvasSyncStatus>;

/** O-32：停滞判定的默认阈值。可配置——调用方可传别的值，本值只是缺省。 */
export const DEFAULT_STALLED_THRESHOLD_MS = 5 * 60 * 1000;

export interface CompletenessInput {
  /** 模板定义的分区列表——分母 `defined` 的唯一来源（I-21）。 */
  readonly definedSectionIds: readonly string[];
  readonly requiredSectionIds: readonly string[];
  /** 每个分区当前是否已有内容；`false` 表示分区为空。 */
  readonly sectionHasContent: ReadonlyMap<string, boolean>;
  /** 落在分区里、但被规则②标了"无来源 · 待补"的便签数——不计入 `done`（I-23）。 */
  readonly awaitingCitationCount: number;
  /** 已经"填了"的分区数（分子的原始值，未扣减待补部分）。 */
  readonly filledSectionCount: number;
}

export interface CompletenessResult {
  readonly done: number;
  readonly defined: number;
  readonly missingRequiredSections: readonly string[];
}

/**
 * `computeCompleteness` 的纯计算核心。
 *
 * - `defined` = `definedSectionIds.length`，逐字对应模板分区定义表条数，
 *   不是"曾经出现过便签的分区数"——一个模板哪怕当前一张便签都没有，
 *   `defined` 也等于它的分区总数。
 * - `missingRequiredSections` = 必填分区里，`sectionHasContent` 为 `false` 的那些。
 * - `done` = `filledSectionCount` 减去待补草稿数（下限钳到 0），
 *   把"无来源 · 待补"的草稿从分子里剔除（I-23）。
 */
export function computeCompleteness(input: CompletenessInput): CompletenessResult {
  const missingRequiredSections = input.requiredSectionIds.filter(
    (id) => input.sectionHasContent.get(id) !== true,
  );
  const done = Math.max(0, input.filledSectionCount - input.awaitingCitationCount);
  return { done, defined: input.definedSectionIds.length, missingRequiredSections };
}

/**
 * `GroupCanvasStatus` 的判定。⚠ **"落后"只看 `missingRequiredSections` 是否非空，
 * 不看任何"其他组"的数据**——本函数的签名里根本没有"其他组"这个参数，
 * 这是刻意的：签名里不存在的输入，实现就不可能意外拿它来横向比较。
 *
 * `viewerInGroup` / `viewerIsReadOnly` 决定"你在这组" / "只读" 这两个视角相关态，
 * 它们与"落后"是两个正交的判断维度——一张画布可以同时是"你在这组"又"落后"。
 * 判定优先级（domain.md 未明确排序时的本模块取舍，如实登记）：
 *   1. `readOnly`（观察者视角）→ "只读"，视角性质压过其他一切。
 *   2. `viewerInGroup` → "你在这组"。
 *   3. 必填分区有空 → "落后"。
 *   4. 否则 → "进行中"。
 */
export function computeGroupCanvasStatus(params: {
  readonly missingRequiredSections: readonly string[];
  readonly viewerInGroup: boolean;
  readonly viewerIsReadOnly: boolean;
}): GroupCanvasStatus {
  if (params.viewerIsReadOnly) return "只读";
  if (params.viewerInGroup) return "你在这组";
  if (params.missingRequiredSections.length > 0) return "落后";
  return "进行中";
}

/**
 * 停滞判定：距上次编辑的毫秒数超过阈值即停滞。阈值默认
 * `DEFAULT_STALLED_THRESHOLD_MS`（5 分钟），调用方可传别的值——不是写死。
 */
export function isStalled(params: {
  readonly msSinceLastEdit: number;
  readonly thresholdMs?: number;
}): boolean {
  const threshold = params.thresholdMs ?? DEFAULT_STALLED_THRESHOLD_MS;
  return params.msSinceLastEdit > threshold;
}
