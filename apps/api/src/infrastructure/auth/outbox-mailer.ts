/**
 * Outbox mailer -- mail is RECORDED, not sent.
 *
 * ## Why this is not a stub to be replaced later without a decision
 *
 * Sending mail is EGRESS. X-3 says the local-organization path makes zero outbound calls,
 * and coverage.md's gap A-4 states the consequence plainly: for a local organization,
 * "forgot password" does not work, and whether such an organization may use password login
 * at all is a PRODUCT question that the sign-off left open. It is still open.
 *
 * Wiring a real SMTP client here would answer that question by accident, in the direction
 * of "yes, we send mail", and would do it inside a feature nobody reviewed for egress.
 *
 * So this records the message and returns. That keeps `{ sent: true }` honest at this layer
 * -- the request was accepted and the message queued -- without opening a network path. The
 * transport is a separate, reviewable decision.
 *
 * ⚠ Consequence, stated rather than hidden: uc-1-1 R12 V8 ("simulate the mail service being
 * unavailable; the flow must fail clearly and not fake success") CANNOT be satisfied by
 * this implementation, because there is no service to be unavailable. It is reported as
 * deferred, not claimed.
 *
 * ⚠ `body` may carry a reset token. It is never written to the logger for that reason --
 * a bearer credential in an application log is a bearer credential in whatever aggregates
 * that log.
 */
import type { Mailer, MailKind } from "../../application/auth/ports";

export interface OutboxMessage {
  readonly to: string;
  readonly kind: MailKind;
  readonly body: Record<string, string>;
  readonly at: Date;
}

export class OutboxMailer implements Mailer {
  private readonly messages: OutboxMessage[] = [];

  async send(msg: { to: string; kind: MailKind; body: Record<string, string> }): Promise<void> {
    this.messages.push({ ...msg, at: new Date() });
    // ⚠ Deliberately NOT logged. `password-reset-link` messages carry a token that is
    // equivalent to the account's password until it is used, and `body` is where it lives;
    // a log line here would put a bearer credential into whatever aggregates the logs.
  }

  /**
   * Test-only reader.
   *
   * It is what makes "a reset mail was queued for this address, and a `password-changed`
   * notice followed" assertable at all. Without it, O-28 ④'s "the change notification is
   * mandatory and cannot be switched off" is a sentence with nothing behind it.
   */
  drain(): readonly OutboxMessage[] {
    return [...this.messages];
  }

  clear(): void {
    this.messages.length = 0;
  }
}
