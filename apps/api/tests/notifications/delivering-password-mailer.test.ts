/**
 * `DeliveringPasswordMailer` (issue #2602) -- real delivery for `password-reset-link` /
 * `password-changed`, riding the same `TransactionalMailTransport` "系统异常 → 测试邮件"
 * uses, wrapping (not replacing) `OutboxMailer`'s recording.
 *
 * ⚠ Fake transport, no real network -- same discipline as
 * `cloudflare-transactional-email-transport.test.ts`.
 */
import { describe, expect, it } from "vitest";
import { DeliveringPasswordMailer } from "../../src/infrastructure/auth/delivering-password-mailer";
import { TransactionalMailError } from "../../src/infrastructure/notifications/cloudflare-transactional-email-transport";
import type {
  TransactionalMailMessage,
  TransactionalMailResult,
  TransactionalMailTransport,
} from "../../src/application/notifications/transactional-mail-ports";
import type { CloudflareEmailConfig } from "../../src/infrastructure/auth/cloudflare-email-transport";
import type { LogFields, LoggerPort } from "../../src/application/ports/logger.port";

function fakeEmailConfig(over: Partial<CloudflareEmailConfig> = {}): CloudflareEmailConfig {
  return {
    accountId: "acc-1",
    apiToken: "token-1",
    mailFrom: "no-reply@mail.boardx.us",
    appPublicUrl: "https://app.example.com",
    previewDisabledAttested: true,
    workerEnabled: false,
    requestTimeoutMs: 5_000,
    ...over,
  };
}

class RecordingTransport implements TransactionalMailTransport {
  readonly sent: TransactionalMailMessage[] = [];
  constructor(private readonly result: TransactionalMailResult | Error = {}) {}
  async send(message: TransactionalMailMessage): Promise<TransactionalMailResult> {
    this.sent.push(message);
    if (this.result instanceof Error) throw this.result;
    return this.result;
  }
}

class RecordingLogger implements LoggerPort {
  readonly errors: { msg: string; fields: LogFields & { err: unknown } }[] = [];
  info(): void {}
  error(msg: string, fields: LogFields & { err: unknown }): void {
    this.errors.push({ msg, fields });
  }
}

describe("DeliveringPasswordMailer", () => {
  it("records into the wrapped outbox exactly like OutboxMailer -- existing test contract", async () => {
    const transport = new RecordingTransport();
    const mailer = new DeliveringPasswordMailer(transport, fakeEmailConfig(), new RecordingLogger());
    await mailer.send({ to: "a@b.com", kind: "password-reset-link", body: { token: "tok-1", expiresAt: "2026-01-01T00:00:00.000Z" } });
    expect(mailer.drain()).toHaveLength(1);
    expect(mailer.drain()[0]!.to).toBe("a@b.com");
    mailer.clear();
    expect(mailer.drain()).toHaveLength(0);
  });

  it("forwards a reset-link mail to the real transport with the reset URL in the body", async () => {
    const transport = new RecordingTransport();
    const mailer = new DeliveringPasswordMailer(transport, fakeEmailConfig(), new RecordingLogger());
    await mailer.send({ to: "a@b.com", kind: "password-reset-link", body: { token: "tok-1", expiresAt: "2026-01-01T00:00:00.000Z" } });

    expect(transport.sent).toHaveLength(1);
    expect(transport.sent[0]!.to).toBe("a@b.com");
    expect(transport.sent[0]!.text).toContain("https://app.example.com/auth/reset-password?token=tok-1");
    // ⚠ The plaintext token travels ONLY inside the message handed to the transport --
    // nothing here should ever put it through the logger.
  });

  it("forwards a password-changed mail with the revoked session count", async () => {
    const transport = new RecordingTransport();
    const mailer = new DeliveringPasswordMailer(transport, fakeEmailConfig(), new RecordingLogger());
    await mailer.send({ to: "a@b.com", kind: "password-changed", body: { at: "2026-01-01T00:00:00.000Z", revokedSessionCount: "3" } });

    expect(transport.sent).toHaveLength(1);
    expect(transport.sent[0]!.text).toContain("3 台已登录设备");
  });

  it("a transport failure is caught, logged (never the message body), and NOT rethrown", async () => {
    const transport = new RecordingTransport(new TransactionalMailError("provider_http_500"));
    const logger = new RecordingLogger();
    const mailer = new DeliveringPasswordMailer(transport, fakeEmailConfig(), logger);

    // ⚠ Best-effort: must resolve, not reject -- `completePasswordReset` has already
    // committed the password change by the time it calls this for `password-changed`.
    await expect(
      mailer.send({ to: "a@b.com", kind: "password-changed", body: { at: "now", revokedSessionCount: "1" } }),
    ).resolves.toBeUndefined();

    // Recording still happened -- delivery failing does not undo the outbox contract.
    expect(mailer.drain()).toHaveLength(1);

    expect(logger.errors).toHaveLength(1);
    expect(logger.errors[0]!.fields.kind).toBe("password-changed");
    expect(logger.errors[0]!.fields.to).toBe("a@b.com");
    // The one thing this log line must never carry: the message body (it can hold a
    // reset token, a bearer credential -- same discipline as `outbox-mailer.ts`).
    expect(JSON.stringify(logger.errors[0])).not.toContain("token");
  });

  it("an incomplete-configuration failure (empty apiToken) is also swallowed, not thrown", async () => {
    const transport: TransactionalMailTransport = {
      send: async () => { throw new TransactionalMailError("configuration_missing"); },
    };
    const logger = new RecordingLogger();
    const mailer = new DeliveringPasswordMailer(transport, fakeEmailConfig({ apiToken: "" }), logger);

    await expect(
      mailer.send({ to: "a@b.com", kind: "password-reset-link", body: { token: "t", expiresAt: "x" } }),
    ).resolves.toBeUndefined();
    expect(logger.errors).toHaveLength(1);
  });
});
