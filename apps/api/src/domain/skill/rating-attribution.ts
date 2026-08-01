/**
 * 消息级评价 → 归因链（F68；UC-3.6 R3 阶段一，`usecases.md` `rateMessage`，I-20）。
 *
 * 洋葱最内层：纯函数，只回答两件事——
 *   ① 一条评价能不能归到某个 skill 版本（E1 的判据）；
 *   ② 同一人对同一消息的评价按幂等键去重（V13）——去重判据本身在这里，
 *      不在落库层，好让规则脱离数据库直接测。
 *
 * ⚠ 缺 `skillVersionId` 的评价**不是错误**——`rateMessage` 仍然成功记录，
 *   只是它的归属被降级为「只计 agent 级」，且必须能在数据质量报表里被列出来
 *   （不得随意归给某个 skill，也不得悄悄丢弃）。把它做成异常会诱使调用方
 *   用 try/catch 吞掉这条本该可见的信号。
 */

export type RatingVerdict = "up" | "down";

/**
 * 一条评价的归因链。⚠ `skillId` 与 `skillVersionId` 分开建模——
 * 「归到 skill 但归不到具体版本」同样不可信任满意度粒度（`classifyAttribution` 两者都要求非空）。
 */
export interface RatingAttribution {
  readonly agentId: string;
  readonly skillId: string | null;
  readonly skillVersionId: string | null;
}

export interface MessageRatingInput {
  readonly messageId: string;
  readonly raterId: string;
  readonly verdict: RatingVerdict;
  readonly reason: string | null;
  readonly attribution: RatingAttribution;
}

/**
 * 一条落库后的评价记录。
 *
 * ⚠ 刻意**不包含**任何「对外可见的评价人展示名」字段——D-40 同源：
 *   评价不公开署名。`raterId` 只用于幂等去重与人群计数，聚合/案例视图
 *   投影时不得把它原样透出。
 */
export interface RatingRecord extends MessageRatingInput {
  readonly ratingId: string;
}

export type AttributionOutcome =
  | { readonly kind: "skill-attributed"; readonly skillId: string; readonly skillVersionId: string }
  | { readonly kind: "agent-only-missing-version"; readonly agentId: string };

/**
 * I-20：`skillId` 与 `skillVersionId` 必须**同时非空**才计入 skill 满意度；
 * 缺任一项都降级为「只计 agent 级」——不得凭 `skillId` 存在就随意归给某个 skill
 * （版本粒度是 O-37 的前提，见 `satisfaction.ts` 头注释）。
 */
export function classifyAttribution(attribution: RatingAttribution): AttributionOutcome {
  if (attribution.skillId !== null && attribution.skillVersionId !== null) {
    return {
      kind: "skill-attributed",
      skillId: attribution.skillId,
      skillVersionId: attribution.skillVersionId,
    };
  }
  return { kind: "agent-only-missing-version", agentId: attribution.agentId };
}

/** V13：同一人对同一消息的评价幂等键。⚠ 重复提交只计一次，不是「后一次覆盖前一次」。 */
export function idempotencyKeyOf(messageId: string, raterId: string): string {
  return `${messageId}::${raterId}`;
}

/**
 * 从一批已落库的评价里，推导某个 skill 的满意度计数（E1 的落点）。
 *
 * ⚠ 只有 `classifyAttribution` 判为 `skill-attributed` 且 `skillId` 匹配的记录才计入；
 *   `agent-only-missing-version` 的记录**结构性地**不参与这次归约——不是靠调用方
 *   记得先过滤一遍，是这个函数本身就不会读它们的 `verdict`。
 */
export function deriveSkillSatisfactionCounts(
  ratings: readonly RatingRecord[],
  skillId: string,
): { readonly up: number; readonly down: number } {
  let up = 0;
  let down = 0;
  for (const r of ratings) {
    const outcome = classifyAttribution(r.attribution);
    if (outcome.kind !== "skill-attributed" || outcome.skillId !== skillId) continue;
    if (r.verdict === "up") up += 1;
    else down += 1;
  }
  return { up, down };
}

/** 数据质量报表的一条——E1「缺归因不得随意归给某 skill，但必须可见」的落点。 */
export interface DataQualityEntry {
  readonly ratingId: string;
  readonly agentId: string;
  readonly reason: "missing-skill-version";
}

/** `null` ⇒ 这条评价已正常归因，不需要进数据质量报表。 */
export function toDataQualityEntry(record: RatingRecord): DataQualityEntry | null {
  const outcome = classifyAttribution(record.attribution);
  if (outcome.kind !== "agent-only-missing-version") return null;
  return { ratingId: record.ratingId, agentId: outcome.agentId, reason: "missing-skill-version" };
}
