/**
 * F176 —— 消息级评价的唯一路由（`POST /messages/:messageId/rating`，F68 契约）。
 *
 * ## 为什么是独立 controller
 *
 * 这条路由的 path 不在 `/chat/*` 也不在 `/skills/*` 之下——契约把它放在
 * `/messages/:messageId/rating`，因为评价的主语是**消息**，而消息同时属于 chat 束
 * （可见性）与 skills 束（归因与满意度）。挂到任何一个已有 controller 上都会让
 * 那个 controller 依赖另一个束的仓储。独立一个文件，两个依赖各自显式注入。
 *
 * ## 状态码
 *
 *   200  评价已记录。⚠ **归因不全也是 200**——`out.attribution` 的
 *        `skillId`/`skillVersionId` 为 null 就是「只计 agent 级」的表达
 *        （usecases.md 逐字：`ATTRIBUTION_MISSING(记录但只计 agent 级)`）。
 *        把它做成错误码会让前端在一次**成功落库**上渲染失败态，
 *        而那条评价确实已经存进去了。
 *   404  看不到 / 不存在 / 不是 AI 消息——**同一个出口**（I-3，见用例的
 *        `MessageNotRateableError` 头注）。
 *
 * ⚠ 响应体**只有契约里的两个字段**。用例内部还算出了 `attributionMissing`，
 *   那是给调用方与测试看的推导值，不上线：它可以从 `attribution.skillVersionId === null`
 *   完全推出来，多发一个字段就是同一事实的第二份副本。
 */
import { Body, Controller, HttpCode, HttpStatus, Inject, NotFoundException, Param, Post } from "@nestjs/common";
import { skills as C } from "@repo/contracts";
import { randomUUID } from "node:crypto";
import {
  MessageNotRateableError,
  submitMessageRating,
} from "../../application/skill/submit-message-rating";
import {
  MESSAGE_RATING_REPOSITORY,
  type MessageRatingRepositoryFactory,
} from "../../application/skill/ports";
import { CHAT_REPOSITORY, type ChatRepository } from "../../application/chat/ports";
import {
  DECISION_ID_FACTORY,
  IDENTITY_REPOSITORY,
  type DecisionIdFactory,
  type IdentityRepository,
} from "../../application/identity/ports";
import { toOrgId } from "../../domain/org-id";
import type { Principal } from "../../domain/principal";
import { assertPrincipal } from "../../domain/principal";
import { CurrentPrincipal } from "../current-principal.decorator";
import { ZodBodyPipe } from "../pipes/zod-body.pipe";

/**
 * ⚠ 契约的 `in` 含 `messageId`，而 path 里也有一个。这里校验的是**请求体**，
 *   最终用的是 **path 参数**——见路由方法里的注释。
 */
export const RATE_MESSAGE_SCHEMA = C.operations.rateMessage.in;

type RateBody = { messageId: string; verdict: "up" | "down"; reason: string | null };

@Controller()
export class MessageRatingController {
  constructor(
    @Inject(MESSAGE_RATING_REPOSITORY)
    private readonly ratings: MessageRatingRepositoryFactory,
    @Inject(CHAT_REPOSITORY) private readonly chat: ChatRepository,
    @Inject(IDENTITY_REPOSITORY) private readonly repo: IdentityRepository,
    @Inject(DECISION_ID_FACTORY) private readonly ids: DecisionIdFactory,
  ) {}

  @HttpCode(HttpStatus.OK)
  @Post("/messages/:messageId/rating")
  async rate(
    @CurrentPrincipal() principal: Principal,
    @Param("messageId") messageId: string,
    @Body(new ZodBodyPipe(RATE_MESSAGE_SCHEMA)) body: RateBody,
  ) {
    assertPrincipal(principal);
    const orgId = toOrgId(principal.orgId);
    try {
      const result = await submitMessageRating(
        {
          repo: this.repo,
          ids: this.ids,
          chat: this.chat,
          ratings: this.ratings.forOrg(principal.orgId),
          newRatingId: () => randomUUID(),
        },
        {
          userId: principal.userId,
          orgId,
          // ⚠ 用 **path** 的 messageId，不用请求体里那个。两者不一致时以路径为准——
          //   路径是资源的地址，请求体里那份只是契约 `in` 的形状要求。
          //   以请求体为准会让「对 A 发请求、在 body 里写 B」变成一次对 B 的写入，
          //   而**可见性检查是按路径那条消息做的**——那正好是一个绕过检查的洞。
          messageId,
          verdict: body.verdict,
          reason: body.reason,
        },
      );
      return { ratingId: result.ratingId, attribution: result.attribution };
    } catch (e) {
      if (e instanceof MessageNotRateableError) throw new NotFoundException();
      throw e;
    }
  }
}
