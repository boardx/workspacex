/**
 * `DeliveringPasswordMailer` -- the "separate, reviewable decision" `outbox-mailer.ts`'s
 * head comment said would come later: real delivery for F21's `password-reset-link` /
 * `password-changed` mail (issue #2602).
 *
 * ## Wraps `OutboxMailer`, does not replace it
 *
 * Every existing test that does `app.get<OutboxMailer>(MAILER)` and then
 * `.drain()`/`.clear()` (`tests/auth/forgot-password-flow.test.ts`,
 * `tests/auth/password-reset-revokes-sessions.test.ts`) keeps working unmodified: this
 * class holds a private `OutboxMailer` and forwards `drain`/`clear` to it, and `send()`
 * records into it FIRST, exactly as before. Delivery is additive, not a replacement of
 * the recording contract those tests assert against.
 *
 * ⚠ The one test this class must NOT be confused with is the structural one at the
 * bottom of `forgot-password-flow.test.ts` -- `new OutboxMailer()` must still have no
 * `logger` own-property. That test constructs the RAW class directly; this file is a
 * different class and does not touch it.
 *
 * ## Rides the SAME transport `sendTestEmail` uses, not a third mail pipeline
 *
 * `@Inject(TRANSACTIONAL_MAIL_TRANSPORT)` is the identical provider "系统异常 → 测试邮件"
 * (`application/notifications/send-test-email.ts`) already sends through -- same
 * Cloudflare account, same `renderBrandEmailHtml` branded template, same
 * `CLOUDFLARE_TXN_EMAIL_API_TOKEN` (falling back to `CLOUDFLARE_EMAIL_API_TOKEN`, see
 * that transport's head comment). Reusing the binding, not re-deriving a second config
 * for the same "which Cloudflare account do we send from" fact.
 *
 * ## Best-effort: `send()` never throws
 *
 * `requestPasswordReset` has exactly one `return` and it does not distinguish "the mail
 * queued" from "the mail sent" (I-1: `{ sent: true }` regardless of whether the address
 * exists, see `password-reset.ts`). `completePasswordReset` has ALREADY committed the
 * password change and revoked every session by the time it sends `password-changed` --
 * a transport hiccup at that point describes a notification failure, not an undone
 * security operation, and must not turn an honest success into a 500.
 *
 * So a delivery failure here is caught, logged (kind + recipient + failure category;
 * `msg.body` is NEVER logged -- it carries the reset token, the same discipline
 * `outbox-mailer.ts` states and this file repeats rather than inherits, since this class
 * does not extend `OutboxMailer`), and swallowed.
 *
 * ⚠ Consequence, stated rather than hidden: this keeps uc-1-1 R12 V8 ("simulate the mail
 * service being unavailable; the flow must fail clearly, not fake success") an ADMITTED,
 * UNCHANGED gap. It was already unmet before this file existed (`OutboxMailer` never had
 * a real transport to fail). Best-effort here does not regress that -- it also does not
 * newly satisfy it, and this file does not claim otherwise.
 */
import { Inject, Injectable } from "@nestjs/common";
import type { Mailer, MailKind } from "../../application/auth/ports";
import { OutboxMailer, type OutboxMessage } from "./outbox-mailer";
import {
  TRANSACTIONAL_MAIL_TRANSPORT,
  type TransactionalMailTransport,
} from "../../application/notifications/transactional-mail-ports";
import { CLOUDFLARE_EMAIL_CONFIG } from "./mail-outbox-worker";
import type { CloudflareEmailConfig } from "./cloudflare-email-transport";
import { LOGGER_PORT, type LoggerPort } from "../../application/ports/logger.port";
import { passwordMailContent } from "./password-mail-content";

@Injectable()
export class DeliveringPasswordMailer implements Mailer {
  private readonly outbox = new OutboxMailer();

  constructor(
    @Inject(TRANSACTIONAL_MAIL_TRANSPORT) private readonly transport: TransactionalMailTransport,
    @Inject(CLOUDFLARE_EMAIL_CONFIG) private readonly emailConfig: CloudflareEmailConfig,
    @Inject(LOGGER_PORT) private readonly logger: LoggerPort,
  ) {}

  async send(msg: { to: string; kind: MailKind; body: Record<string, string> }): Promise<void> {
    // Recording happens unconditionally and first -- the existing test suite's contract.
    await this.outbox.send(msg);
    try {
      // ⚠ `this.emailConfig.appPublicUrl` resolves `cloudflareEmailConfig()` lazily
      // (`lazyCloudflareEmailConfig`'s Proxy) and THROWS in production if that
      // subsystem's env is incomplete. That throw belongs inside this `try`, not
      // guarded separately -- an unconfigured deployment is exactly the "delivery
      // unavailable" case this method must swallow, not crash on.
      const content = passwordMailContent(msg, this.emailConfig.appPublicUrl);
      await this.transport.send({ to: msg.to, subject: content.subject, text: content.text });
    } catch (err) {
      this.logger.error("password mail delivery failed", {
        traceId: "password-mailer",
        kind: msg.kind,
        to: msg.to,
        err,
      });
    }
  }

  drain(): readonly OutboxMessage[] {
    return this.outbox.drain();
  }

  clear(): void {
    this.outbox.clear();
  }
}
