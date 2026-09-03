/**
 * `sendTestEmail`（后台测试邮件）——纯 fake，不碰 DB。
 *   ① 传了收件人就发给它；② 没传就查当前账号邮箱；③ 查不到 ⇒ NoTestEmailRecipientError；
 *   ④ 发信失败**原样抛**（与 best-effort 的反馈通知相反，测试邮件的意义就是把失败报出来）。
 */
import { describe, expect, it, vi } from "vitest";
import { NoTestEmailRecipientError, sendTestEmail, testEmailContent } from "../../src/application/notifications/send-test-email";
import { TransactionalMailError } from "../../src/application/notifications/transactional-mail-ports";

const at = new Date("2026-09-02T10:00:00.000Z");
function deps(over: { email?: string | null; send?: () => Promise<{ providerMessageId?: string }> } = {}) {
  return {
    mail: { send: vi.fn(over.send ?? (async () => ({ providerMessageId: "cf-1" }))) },
    recipients: { emailForUserId: vi.fn(async () => (over.email === undefined ? "me@example.com" : over.email)) },
    now: () => at,
  };
}

describe("sendTestEmail", () => {
  it("① 显式收件人优先，正文带触发账号与 traceId", async () => {
    const d = deps();
    const out = await sendTestEmail(d, { actorUserId: "u-1", to: "ops@example.com", traceId: "t-1" });
    expect(out).toEqual({ sentTo: "ops@example.com", subject: "WorkspaceX 测试邮件 2026-09-02T10:00:00.000Z", providerMessageId: "cf-1", sentAt: "2026-09-02T10:00:00.000Z" });
    const { text } = testEmailContent({ actorUserId: "u-1", traceId: "t-1", at });
    expect(d.mail.send).toHaveBeenCalledWith({ to: "ops@example.com", subject: out.subject, text });
    expect(text).toContain("u-1");
    expect(text).toContain("t-1");
    expect(d.recipients.emailForUserId).not.toHaveBeenCalled();
  });

  it("② 没传收件人 ⇒ 发给当前账号邮箱", async () => {
    const d = deps();
    const out = await sendTestEmail(d, { actorUserId: "u-1", to: null, traceId: "t-1" });
    expect(out.sentTo).toBe("me@example.com");
  });

  it("③ 查不到邮箱 ⇒ NoTestEmailRecipientError，不发", async () => {
    const d = deps({ email: null });
    await expect(sendTestEmail(d, { actorUserId: "u-1", to: null, traceId: "t-1" })).rejects.toBeInstanceOf(NoTestEmailRecipientError);
    expect(d.mail.send).not.toHaveBeenCalled();
  });

  it("④ 发信失败原样抛（不吞）", async () => {
    const d = deps({ send: async () => { throw new TransactionalMailError("provider_http_502"); } });
    await expect(sendTestEmail(d, { actorUserId: "u-1", to: "ops@example.com", traceId: "t-1" })).rejects.toMatchObject({ category: "provider_http_502" });
  });
});
