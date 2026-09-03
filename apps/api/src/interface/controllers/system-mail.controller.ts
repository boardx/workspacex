/**
 * `POST /system/mail/test` —— 平台超管发测试邮件。见用例 `send-test-email.ts` 头注。
 *
 * ## 状态码
 *   200  发出去了（`sentTo` / `providerMessageId`）。
 *   403  不是平台超管（`NOT_PLATFORM_SUPERUSER`，由 `PlatformSuperuserGuard` 给）。
 *   422  没传收件人且当前账号查不到邮箱（`NO_RECIPIENT`）。
 *   503  部署没配事务邮件（`MAIL_NOT_CONFIGURED`）/ 配了但没发出去（`MAIL_SEND_FAILED`，
 *        带适配器归好类的 `category`——粗粒度原因，不是原始异常文本，见契约头注）。
 */
import {
  Body, Controller, HttpCode, HttpStatus, Inject, Post, Req, ServiceUnavailableException,
  UnprocessableEntityException, UseGuards,
} from "@nestjs/common";
import { systemErrorLogs as C } from "@repo/contracts";
import { FEEDBACK_SUBMITTER_DIRECTORY, type FeedbackSubmitterDirectory } from "../../application/feedback/notification-ports";
import { NoTestEmailRecipientError, sendTestEmail } from "../../application/notifications/send-test-email";
import {
  TRANSACTIONAL_MAIL_TRANSPORT,
  TransactionalMailError,
  type TransactionalMailTransport,
} from "../../application/notifications/transactional-mail-ports";
import type { Principal } from "../../domain/principal";
import { assertPrincipal } from "../../domain/principal";
import { CurrentPrincipal } from "../current-principal.decorator";
import { PlatformSuperuserGuard } from "../guards/platform-superuser.guard";
import { traceIdOf } from "../middleware/trace";
import { ZodBodyPipe } from "../pipes/zod-body.pipe";

export const SEND_TEST_EMAIL_SCHEMA = C.operations.sendTestEmail.in;
type SendTestEmailBody = ReturnType<typeof C.operations.sendTestEmail.in.parse>;

@Controller()
export class SystemMailController {
  constructor(
    @Inject(TRANSACTIONAL_MAIL_TRANSPORT) private readonly mail: TransactionalMailTransport,
    @Inject(FEEDBACK_SUBMITTER_DIRECTORY) private readonly recipients: FeedbackSubmitterDirectory,
  ) {}

  @UseGuards(PlatformSuperuserGuard)
  @HttpCode(HttpStatus.OK)
  @Post("/system/mail/test")
  async send(
    @CurrentPrincipal() principal: Principal,
    @Req() req: unknown,
    @Body(new ZodBodyPipe(SEND_TEST_EMAIL_SCHEMA)) body: SendTestEmailBody,
  ) {
    assertPrincipal(principal);
    try {
      return await sendTestEmail(
        { mail: this.mail, recipients: this.recipients, now: () => new Date() },
        { actorUserId: principal.userId, to: body.to ?? null, traceId: traceIdOf(req) },
      );
    } catch (e) {
      if (e instanceof NoTestEmailRecipientError) throw new UnprocessableEntityException({ reasonCode: "NO_RECIPIENT" });
      if (e instanceof TransactionalMailError) {
        if (e.category === "configuration_missing") {
          throw new ServiceUnavailableException({ reasonCode: "MAIL_NOT_CONFIGURED" });
        }
        // `category` 是适配器归好类的枚举式字符串（timeout / network / provider_http_502…），
        // 不是原始异常消息——见契约 `sendTestEmail` 头注。
        throw new ServiceUnavailableException({ reasonCode: "MAIL_SEND_FAILED", category: e.category });
      }
      throw e;
    }
  }
}
