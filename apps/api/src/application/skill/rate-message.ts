/**
 * `rateMessage` —— 消息级评价采集与归因的**唯一用例**（F68；UC-3.6 R3 阶段一）。
 *
 * ⚠ 幂等（V13）在这里判断，不在落库层——同一人对同一消息重复提交时，
 *   直接返回已存在的那条记录，**不新增计数、不覆盖原评价**。
 * ⚠ 缺 `skillVersionId`（E1/I-20）不是失败：仍然 `ok: true` 落库，
 *   只是 `attributed: false`，并把这条写进数据质量报表——
 *   界面据此提示「该评价未计入任何 skill 的满意度」，而不是静默丢弃。
 */
import {
  classifyAttribution,
  idempotencyKeyOf,
  toDataQualityEntry,
  type MessageRatingInput,
  type RatingRecord,
} from "../../domain/skill/rating-attribution";
import type { DataQualityReportPort, RatingRepositoryPort } from "./ports";

export interface RateMessageInput extends MessageRatingInput {
  readonly ratingId: string;
}

export interface RateMessageResult {
  readonly ok: true;
  readonly ratingId: string;
  /** 已存在同一 `(messageId, raterId)` 的评价时为 true——本次调用未产生新计数（V13）。 */
  readonly idempotentReplay: boolean;
  readonly attributed: boolean;
  readonly attribution: MessageRatingInput["attribution"];
}

export async function rateMessage(
  input: RateMessageInput,
  deps: { readonly ratings: RatingRepositoryPort; readonly dataQuality: DataQualityReportPort },
): Promise<RateMessageResult> {
  const key = idempotencyKeyOf(input.messageId, input.raterId);
  const existing = await deps.ratings.findByIdempotencyKey(key);
  if (existing !== null) {
    return {
      ok: true,
      ratingId: existing.ratingId,
      idempotentReplay: true,
      attributed: classifyAttribution(existing.attribution).kind === "skill-attributed",
      attribution: existing.attribution,
    };
  }

  const record: RatingRecord = {
    ratingId: input.ratingId,
    messageId: input.messageId,
    raterId: input.raterId,
    verdict: input.verdict,
    reason: input.reason,
    attribution: input.attribution,
  };
  await deps.ratings.save(record);

  const outcome = classifyAttribution(input.attribution);
  if (outcome.kind === "agent-only-missing-version") {
    const entry = toDataQualityEntry(record);
    if (entry !== null) await deps.dataQuality.record(entry);
  }

  return {
    ok: true,
    ratingId: record.ratingId,
    idempotentReplay: false,
    attributed: outcome.kind === "skill-attributed",
    attribution: input.attribution,
  };
}
