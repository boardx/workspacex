/**
 * 邮件配置校验的**时机**：缺配置不该让整个 API 起不来。
 *
 * 2026-08-05 实测：`cloudflareEmailConfig()` 被直接用作 Nest provider 工厂，
 * 生产模式下缺任何一项就在 DI 阶段抛 ⇒ **整个 API 拒绝启动**，
 * 哪怕这次部署根本不发一封信（核心闭环第 1 步走 bootstrap，`emailVerifiedAt`
 * 直接置位，不经过邮件）。运行时门控 G7 也因此红了一整轮。
 *
 * ⇒ 要守的不变量有两条，**缺一不可**：
 *   ① 缺配置时**构造**不抛（否则进程起不来）；
 *   ② 但**一用到**就抛（否则等于把校验删了 —— 那才是真正的退化）。
 */
import { describe, expect, it } from "vitest";
import {
  cloudflareEmailConfig,
  lazyCloudflareEmailConfig,
} from "../../src/infrastructure/auth/cloudflare-email-transport";

const INCOMPLETE_PROD = { NODE_ENV: "production" } as NodeJS.ProcessEnv;
const COMPLETE_PROD = {
  NODE_ENV: "production",
  CLOUDFLARE_ACCOUNT_ID: "acc",
  CLOUDFLARE_EMAIL_API_TOKEN: "tok",
  MAIL_FROM: "no-reply@mail.boardx.us",
  APP_PUBLIC_URL: "https://x.invalid",
  CLOUDFLARE_EMAIL_PREVIEW_DISABLED: "true",
} as NodeJS.ProcessEnv;

describe("邮件配置校验的时机", () => {
  it("① 生产缺配置时，**构造**不抛 —— 进程能起来", () => {
    expect(() => lazyCloudflareEmailConfig(INCOMPLETE_PROD)).not.toThrow();
  });

  it("② 但**一读它**就抛 —— 校验没有被削弱，只是换了时刻", () => {
    const cfg = lazyCloudflareEmailConfig(INCOMPLETE_PROD);
    expect(() => cfg.accountId).toThrow(/incomplete/);
  });

  it("③ 正样本：配置齐全时，读得到真实值（证明上面两条不是因为它恒抛）", () => {
    const cfg = lazyCloudflareEmailConfig(COMPLETE_PROD);
    expect(cfg.accountId).toBe("acc");
    expect(cfg.mailFrom).toBe("no-reply@mail.boardx.us");
  });

  it("④ 原来那个**立即校验**的入口原样保留并继续抛 —— 规则本身没动", () => {
    expect(() => cloudflareEmailConfig(INCOMPLETE_PROD)).toThrow(/incomplete/);
  });
});
