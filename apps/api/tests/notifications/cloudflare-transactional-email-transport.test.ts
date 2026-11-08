/**
 * 通用事务性邮件适配器（`CloudflareTransactionalEmailTransport`）。
 *
 * ⚠ 全程 fake `fetch`——同 `email-verification-public.test.ts` 里
 *   `CloudflareEmailTransport` 的既有测试纪律,不打真实网络。
 *
 * 这份端口与 `VerificationMailTransport` 的关键区别就是本文件要证明的东西:
 * 主题/正文由**调用方**给,不是适配器内部写死的模板。
 */
import { describe, expect, it } from "vitest";
import {
  CloudflareTransactionalEmailTransport,
  TransactionalMailError,
  lazyTransactionalMailConfig,
  transactionalMailConfig,
  type TransactionalMailConfig,
} from "../../src/infrastructure/notifications/cloudflare-transactional-email-transport";
import { isMailConfigurationError } from "../../src/application/notifications/transactional-mail-ports";
import { renderBrandEmailHtml } from "../../src/infrastructure/notifications/email-branding";

function fakeConfig(over: Partial<TransactionalMailConfig> = {}): TransactionalMailConfig {
  return {
    accountId: "acc-1",
    apiToken: "token-1",
    mailFrom: "no-reply@mail.boardx.us",
    requestTimeoutMs: 5_000,
    ...over,
  };
}

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: async () => body } as Response;
}

describe("CloudflareTransactionalEmailTransport", () => {
  it("请求形状:URL 带 accountId,body 是调用方给的任意 subject/text,不是硬编模板", async () => {
    let capturedUrl: string | undefined;
    let capturedBody: unknown;
    let capturedHeaders: Record<string, string> | undefined;
    const fakeFetch = (async (url: string, init?: RequestInit) => {
      capturedUrl = url;
      capturedBody = JSON.parse(init?.body as string);
      capturedHeaders = init?.headers as Record<string, string>;
      return jsonResponse({ success: true, result: { delivered: ["user@example.com"], queued: [], permanent_bounces: [] } });
    }) as typeof fetch;

    const transport = new CloudflareTransactionalEmailTransport(fakeConfig(), fakeFetch);
    const subject = "你的反馈状态已更新为「已进入迭代」";
    const text = "你提交的反馈《点了没反应》状态已更新为「已进入迭代」。";
    await transport.send({ to: "user@example.com", subject, text });

    expect(capturedUrl).toBe("https://api.cloudflare.com/client/v4/accounts/acc-1/email/sending/send");
    expect(capturedHeaders?.authorization).toBe("Bearer token-1");
    // html 是这一层自动套的品牌外壳（email-branding.ts）——subject/text 仍是调用方
    // 给的原样值，没有被硬编模板顶掉；html 由同一个渲染函数生成，两边不会各自漂移。
    expect(capturedBody).toEqual({
      from: { address: "no-reply@mail.boardx.us" },
      to: "user@example.com",
      subject,
      text,
      html: renderBrandEmailHtml({ heading: subject, text }),
    });
  });

  it("配置不全 ⇒ 拒绝,不发请求", async () => {
    let called = false;
    const fakeFetch = (async () => { called = true; return jsonResponse({ success: true }); }) as typeof fetch;
    const transport = new CloudflareTransactionalEmailTransport(fakeConfig({ apiToken: "" }), fakeFetch);
    await expect(transport.send({ to: "a@b.com", subject: "s", text: "t" })).rejects.toBeInstanceOf(
      TransactionalMailError,
    );
    expect(called).toBe(false);
  });

  it("2026-09-14：生产懒加载配置在首次读取时抛普通 Error ⇒ 归类为 configuration_invalid，不再穿透成 500", async () => {
    let called = false;
    const fakeFetch = (async () => { called = true; return jsonResponse({ success: true }); }) as typeof fetch;
    const transport = new CloudflareTransactionalEmailTransport(
      lazyTransactionalMailConfig({ NODE_ENV: "production" } as NodeJS.ProcessEnv),
      fakeFetch,
    );
    const err = await transport.send({ to: "a@b.com", subject: "s", text: "t" }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TransactionalMailError);
    expect((err as TransactionalMailError).category).toBe("configuration_invalid");
    expect(isMailConfigurationError(err as TransactionalMailError)).toBe(true);
    expect(String((err as Error).cause)).toMatch(/incomplete/);
    expect(called).toBe(false);
  });

  it("HTTP 非 2xx ⇒ 抛 TransactionalMailError", async () => {
    const fakeFetch = (async () => jsonResponse({}, false, 500)) as typeof fetch;
    const transport = new CloudflareTransactionalEmailTransport(fakeConfig(), fakeFetch);
    await expect(transport.send({ to: "a@b.com", subject: "s", text: "t" })).rejects.toBeInstanceOf(
      TransactionalMailError,
    );
  });

  it("success !== true ⇒ 视为无效响应", async () => {
    const fakeFetch = (async () => jsonResponse({ success: false })) as typeof fetch;
    const transport = new CloudflareTransactionalEmailTransport(fakeConfig(), fakeFetch);
    await expect(transport.send({ to: "a@b.com", subject: "s", text: "t" })).rejects.toBeInstanceOf(
      TransactionalMailError,
    );
  });

  const recipient = "target@example.test";
  const accepted = (overrides: Record<string, unknown> = {}) => ({ delivered: [recipient], queued: [], permanent_bounces: [], ...overrides });
  const message = { to: recipient, subject: "Private subject", text: "https://example.test/auth/activate?t=private-bearer" };
  const sendResponse = (body: unknown) => new CloudflareTransactionalEmailTransport(
    fakeConfig(), (async () => jsonResponse(body)) as typeof fetch,
  ).send(message);

  it.each([
    ["delivered", accepted()],
    ["queued", accepted({ delivered: [], queued: [recipient] })],
    ["optional empty suppression metadata", accepted({ suppressed_recipients: [] })],
  ])("accepts the exact recipient as %s without promising inbox placement", async (_name, result) => {
    await expect(sendResponse({ success: true, result })).resolves.toEqual({});
  });

  it("passes through an available provider message ID, while older responses need no ID", async () => {
    await expect(sendResponse({ success: true, result: accepted({ message_id: "<provider-id@example.test>" }) }))
      .resolves.toEqual({ providerMessageId: "<provider-id@example.test>" });
    await expect(sendResponse({ success: true, result: accepted() })).resolves.toEqual({});
  });

  const rejectedResponses: Array<[string, unknown, string]> = [
    ["foreign recipient", { success: true, result: accepted({ delivered: ["other@example.test"] }) }, "provider_invalid_response"],
    ["permanent bounce", { success: true, result: accepted({ delivered: [], permanent_bounces: [recipient] }) }, "provider_permanent_bounce"],
    ["bounce overrides delivered", { success: true, result: accepted({ permanent_bounces: [recipient] }) }, "provider_permanent_bounce"],
    ["suppressed recipient", { success: true, result: accepted({ delivered: [], suppressed_recipients: [recipient] }) }, "provider_suppressed"],
    ["suppression overrides delivered", { success: true, result: accepted({ suppressed_recipients: [recipient] }) }, "provider_suppressed"],
    ["success alone", { success: true }, "provider_invalid_response"],
    ["null envelope", null, "provider_invalid_response"],
    ["null result", { success: true, result: null }, "provider_invalid_response"],
    ["missing queued", { success: true, result: { delivered: [recipient], permanent_bounces: [] } }, "provider_invalid_response"],
    ["malformed delivered", { success: true, result: accepted({ delivered: [1] }) }, "provider_invalid_response"],
    ["malformed bounce", { success: true, result: accepted({ permanent_bounces: "private-provider-response" }) }, "provider_invalid_response"],
    ["malformed suppression", { success: true, result: accepted({ suppressed_recipients: null }) }, "provider_invalid_response"],
    ["no target", { success: true, result: accepted({ delivered: [] }) }, "provider_invalid_response"],
    ["duplicate target", { success: true, result: accepted({ delivered: [recipient, recipient] }) }, "provider_invalid_response"],
    ["target both delivered and queued", { success: true, result: accepted({ queued: [recipient] }) }, "provider_invalid_response"],
  ];
  it.each(rejectedResponses)("rejects %s without leaking request/provider content", async (_name, response, category) => {
    const error = await sendResponse(response).catch((failure: unknown) => failure);
    expect(error).toBeInstanceOf(TransactionalMailError);
    expect(error).toMatchObject({ category });
    expect(String(error)).not.toMatch(/target@example|private-bearer|private-provider-response|Private subject/);
  });

  describe("transactionalMailConfig", () => {
    it("非生产允许缺配置", () => {
      expect(() => transactionalMailConfig({ NODE_ENV: "test" } as NodeJS.ProcessEnv)).not.toThrow();
    });
    it("生产缺任一项直接拒绝", () => {
      expect(() =>
        transactionalMailConfig({ NODE_ENV: "production", CLOUDFLARE_ACCOUNT_ID: "x" } as NodeJS.ProcessEnv),
      ).toThrow(/incomplete/);
    });

    it("生产环境 MAIL_FROM 域名必须匹配已 onboard 的发信域名（同 cloudflareEmailConfig 那条,2026-09-03 事故）", () => {
      expect(() => transactionalMailConfig({
        NODE_ENV: "production",
        CLOUDFLARE_ACCOUNT_ID: "a",
        CLOUDFLARE_TXN_EMAIL_API_TOKEN: "t",
        MAIL_FROM: "noreply@boardx.us",
      } as NodeJS.ProcessEnv)).toThrow(/MAIL_FROM domain/);
      expect(() => transactionalMailConfig({
        NODE_ENV: "production",
        CLOUDFLARE_ACCOUNT_ID: "a",
        CLOUDFLARE_TXN_EMAIL_API_TOKEN: "t",
        MAIL_FROM: "no-reply@mail.boardx.us",
      } as NodeJS.ProcessEnv)).not.toThrow();
    });
    it("2026-09-02 人类裁决：没配专属 CLOUDFLARE_TXN_EMAIL_API_TOKEN 时回退到 CLOUDFLARE_EMAIL_API_TOKEN", () => {
      const config = transactionalMailConfig({
        NODE_ENV: "test",
        CLOUDFLARE_EMAIL_API_TOKEN: "verification-token",
      } as NodeJS.ProcessEnv);
      expect(config.apiToken).toBe("verification-token");
    });
    it("配了专属 token 时优先用它，不吃回退", () => {
      const config = transactionalMailConfig({
        NODE_ENV: "test",
        CLOUDFLARE_TXN_EMAIL_API_TOKEN: "txn-token",
        CLOUDFLARE_EMAIL_API_TOKEN: "verification-token",
      } as NodeJS.ProcessEnv);
      expect(config.apiToken).toBe("txn-token");
    });
  });
});
