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
  transactionalMailConfig,
  type TransactionalMailConfig,
} from "../../src/infrastructure/notifications/cloudflare-transactional-email-transport";

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
      return jsonResponse({ success: true });
    }) as typeof fetch;

    const transport = new CloudflareTransactionalEmailTransport(fakeConfig(), fakeFetch);
    await transport.send({
      to: "user@example.com",
      subject: "你的反馈状态已更新为「已进入迭代」",
      text: "你提交的反馈《点了没反应》状态已更新为「已进入迭代」。",
    });

    expect(capturedUrl).toBe("https://api.cloudflare.com/client/v4/accounts/acc-1/email/sending/send");
    expect(capturedHeaders?.authorization).toBe("Bearer token-1");
    expect(capturedBody).toEqual({
      from: { address: "no-reply@mail.boardx.us" },
      to: "user@example.com",
      subject: "你的反馈状态已更新为「已进入迭代」",
      text: "你提交的反馈《点了没反应》状态已更新为「已进入迭代」。",
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

  describe("transactionalMailConfig", () => {
    it("非生产允许缺配置", () => {
      expect(() => transactionalMailConfig({ NODE_ENV: "test" } as NodeJS.ProcessEnv)).not.toThrow();
    });
    it("生产缺任一项直接拒绝", () => {
      expect(() =>
        transactionalMailConfig({ NODE_ENV: "production", CLOUDFLARE_ACCOUNT_ID: "x" } as NodeJS.ProcessEnv),
      ).toThrow(/incomplete/);
    });
  });
});
