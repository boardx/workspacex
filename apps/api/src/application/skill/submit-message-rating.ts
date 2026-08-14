/**
 * F176 —— `POST /messages/:messageId/rating` 的用例编排。
 *
 * ## 它做的四件事，每一件都不该在 controller 里
 *
 *   ① `pre: 调用者能看到该消息`（usecases.md `rateMessage` 逐字）
 *   ② 归因**从服务端查**，不接受任何外部输入
 *   ③ 交给 F68 已有的 `rateMessage`（幂等、数据质量报表都在那里，本文件不重写）
 *   ④ 投影成契约的 `out` 形状
 *
 * ## ① 复用 chat 束的可见性判定，不另写一份
 *
 * `findMessageLocation` → `resolveVisibility` 是 `expandToolCallChain`（F111）
 * 逐字相同的两步。**刻意照抄这两行**：可见性是 chat 束的领域规则，评价这条路径
 * 上再判一次就是第二套权限系统，而两套权限系统里总有一套没人在看
 * （`thread-visibility.ts` 文件头对同一件事的措辞）。
 *
 * ⚠ 「不可见」与「不存在」走同一个出口（`MessageNotRateableError` → 404）。
 *   I-3 那条纪律：响应里必须分不开，否则一次探测就能确认某条消息存在。
 *
 * ## ② 为什么归因绝不能来自请求体
 *
 * 满意度是 UC-3.6 整条改进闭环的输入（👎 → 聚合 → 提案 → 新版本）。前端能传归因，
 * 就等于任何用户都能给任意 skill 版本刷满意度——而且刷出来的数字与真实数字
 * 长得一模一样，没有任何下游能分辨。
 *
 * 契约这一侧已经先堵了一道：`rateMessage.in` 是 `{ messageId, verdict, reason }`
 * 且 `.strict()`，多传字段会被 zod 当场拒。本文件是第二道：即使有人日后放宽了那个
 * schema，attribution 也只可能来自 `deps.ratings.resolveForMessage`——
 * 这个函数的签名里根本没有可以传归因进来的地方。
 *
 * ## ③ 不是 agent 消息 ⇒ 拒绝，不是「记一条没有 agent 的评价」
 *
 * `resolveForMessage` 返回 null 表示这条消息不是某次 agent run 的产物
 * （人类发的消息，或早于 `chat_messages.agent_run_id` 的历史消息）。
 * 此时**必须拒绝**：`RatingAttribution.agentId` 是非空的，编一个空串塞进去
 * 会在数据质量报表里长出一堆 `agentId: ""` 的行，而那些行谁也修不了。
 */
import type { OrgId } from "../../domain/org-id";
import { rateMessage } from "./rate-message";
import type { MessageRatingRepository } from "./ports";
import type { RatingVerdict } from "../../domain/skill/rating-attribution";
import { resolveVisibility, type ResolveVisibilityDeps } from "../chat/resolve-visibility";

export interface SubmitMessageRatingDeps extends ResolveVisibilityDeps {
  readonly ratings: MessageRatingRepository;
  readonly newRatingId: () => string;
}

export interface SubmitMessageRatingInput {
  readonly userId: string;
  readonly orgId: OrgId;
  readonly messageId: string;
  readonly verdict: RatingVerdict;
  readonly reason: string | null;
}

/**
 * 「看不到」「不存在」「不是 AI 消息」三种情况的**同一个**出口。
 *
 * ⚠ 三合一是有意的。把「不是 AI 消息」单独做成 422 会泄露「这条消息存在且是人发的」，
 *   而调用方本来可能连它存不存在都不该知道。评价按钮只画在 AI 消息上，
 *   所以正常界面根本走不到这三条里的任何一条。
 */
export class MessageNotRateableError extends Error {
  constructor() {
    super("message_not_rateable");
    this.name = "MessageNotRateableError";
  }
}

export interface SubmitMessageRatingResult {
  readonly ratingId: string;
  readonly attribution: {
    readonly agentId: string;
    readonly skillId: string | null;
    readonly skillVersionId: string | null;
  };
  /** 归因不全 —— 契约的 `ATTRIBUTION_MISSING`。⚠ 评价**已经落库**，这是告警不是失败。 */
  readonly attributionMissing: boolean;
}

export async function submitMessageRating(
  deps: SubmitMessageRatingDeps,
  input: SubmitMessageRatingInput,
): Promise<SubmitMessageRatingResult> {
  const location = await deps.chat.findMessageLocation(input.orgId, input.messageId);
  if (location === null) throw new MessageNotRateableError();

  const outcome = await resolveVisibility(deps, {
    userId: input.userId,
    orgId: input.orgId,
    projectId: location.projectId,
    threadId: location.threadId,
  });
  if (outcome.kind !== "allow") throw new MessageNotRateableError();

  const attribution = await deps.ratings.resolveForMessage(input.messageId);
  if (attribution === null) throw new MessageNotRateableError();

  const result = await rateMessage(
    {
      ratingId: deps.newRatingId(),
      messageId: input.messageId,
      raterId: input.userId,
      verdict: input.verdict,
      reason: input.reason,
      attribution,
    },
    { ratings: deps.ratings, dataQuality: deps.ratings },
  );

  return {
    ratingId: result.ratingId,
    attribution: result.attribution,
    attributionMissing: !result.attributed,
  };
}
