/**
 * #4789 —— `CLOUDFLARE_API_BASE_URL`：CI 回环邮件替身的唯一入口，生产禁止覆盖。
 * 纯逻辑 + fake fetch，不打网络。
 */
import { describe, expect, it } from "vitest";
import {
  CLOUDFLARE_API_BASE_URL_DEFAULT,
  cloudflareApiBaseUrl,
  cloudflareEmailSendUrl,
} from "../../src/infrastructure/cloudflare-email-api-base";
import { cloudflareEmailConfig } from "../../src/infrastructure/auth/cloudflare-email-transport";
import {
  CloudflareTransactionalEmailTransport,
  transactionalMailConfig,
} from "../../src/infrastructure/notifications/cloudflare-transactional-email-transport";

const env = (over: Record<string, string>) => over as NodeJS.ProcessEnv;
const PROD = {
  NODE_ENV: "production",
  CLOUDFLARE_ACCOUNT_ID: "a",
  CLOUDFLARE_EMAIL_API_TOKEN: "t",
  CLOUDFLARE_EMAIL_PREVIEW_DISABLED: "true",
  MAIL_FROM: "no-reply@mail.boardx.us",
  APP_PUBLIC_URL: "https://app.example.test",
};

describe("cloudflareApiBaseUrl", () => {
  it("未设置 ⇒ 官方默认值（没有隐式回退到任何回环）", () => {
    expect(cloudflareApiBaseUrl(env({ NODE_ENV: "test" }))).toBe(CLOUDFLARE_API_BASE_URL_DEFAULT);
  });
  it("非生产可指向回环，末尾斜杠被规整", () => {
    expect(cloudflareApiBaseUrl(env({ NODE_ENV: "test", CLOUDFLARE_API_BASE_URL: "http://127.0.0.1:1234/client/v4/" })))
      .toBe("http://127.0.0.1:1234/client/v4");
  });
  it("生产覆盖为非默认值 ⇒ 抛错（fail fast）", () => {
    expect(() => cloudflareApiBaseUrl(env({ NODE_ENV: "production", CLOUDFLARE_API_BASE_URL: "http://127.0.0.1:1234" })))
      .toThrow(/must not be overridden in production/);
  });
  it("生产显式写成默认值 ⇒ 允许", () => {
    expect(cloudflareApiBaseUrl(env({ NODE_ENV: "production", CLOUDFLARE_API_BASE_URL: `${CLOUDFLARE_API_BASE_URL_DEFAULT}/` })))
      .toBe(CLOUDFLARE_API_BASE_URL_DEFAULT);
  });
  it("非法 URL ⇒ 抛错", () => {
    expect(() => cloudflareApiBaseUrl(env({ NODE_ENV: "test", CLOUDFLARE_API_BASE_URL: "not a url" }))).toThrow(/absolute http/);
    expect(() => cloudflareApiBaseUrl(env({ NODE_ENV: "test", CLOUDFLARE_API_BASE_URL: "ftp://x" }))).toThrow(/absolute http/);
  });
  it("send URL 缺省 apiBaseUrl 时回落官方地址", () => {
    expect(cloudflareEmailSendUrl(undefined, "acc")).toBe(`${CLOUDFLARE_API_BASE_URL_DEFAULT}/accounts/acc/email/sending/send`);
  });
});

describe("两个 transport 的配置都带上并守住同一条规则", () => {
  it("cloudflareEmailConfig / transactionalMailConfig 读取覆盖值", () => {
    const over = { NODE_ENV: "test", CLOUDFLARE_API_BASE_URL: "http://127.0.0.1:9/client/v4" };
    expect(cloudflareEmailConfig(env(over)).apiBaseUrl).toBe("http://127.0.0.1:9/client/v4");
    expect(transactionalMailConfig(env(over)).apiBaseUrl).toBe("http://127.0.0.1:9/client/v4");
  });
  it("生产下两者都拒绝覆盖", () => {
    const over = { ...PROD, CLOUDFLARE_API_BASE_URL: "http://127.0.0.1:9/client/v4" };
    expect(() => cloudflareEmailConfig(env(over))).toThrow(/must not be overridden/);
    expect(() => transactionalMailConfig(env(over))).toThrow(/must not be overridden/);
  });
  it("事务 transport 实际请求落在覆盖后的 base 上", async () => {
    let url = "";
    const fakeFetch = (async (u: string) => {
      url = u;
      return { ok: true, status: 200, json: async () => ({ success: true }) } as Response;
    }) as typeof fetch;
    const config = transactionalMailConfig(env({
      NODE_ENV: "test",
      CLOUDFLARE_ACCOUNT_ID: "acc",
      CLOUDFLARE_TXN_EMAIL_API_TOKEN: "t",
      MAIL_FROM: "x@y.test",
      CLOUDFLARE_API_BASE_URL: "http://127.0.0.1:9/client/v4",
    }));
    await new CloudflareTransactionalEmailTransport(config, fakeFetch).send({ to: "a@b.test", subject: "s", text: "t" });
    expect(url).toBe("http://127.0.0.1:9/client/v4/accounts/acc/email/sending/send");
  });
});
