/**
 * 人类 2026-09-16 截图复盘的机械门控：**同一次失败不许同时给两个语义不同的重试**。
 * 把 `shouldOfferBannerRetry` 里的 `!planStepRecoveryOffered` 撤掉 ⇒ 第一条红。
 */
import { describe, expect, it } from "vitest";
import { shouldOfferBannerRetry } from "@/lib/copilotkit-v2-banner-retry";

const base = { hasResendableMessage: true, agentIsRunning: false, planStepRecoveryOffered: false };

describe("shouldOfferBannerRetry", () => {
  it("计划面板已给出「重试该步」时，横幅不再给第二个重试", () => {
    expect(shouldOfferBannerRetry({ ...base, planStepRecoveryOffered: true })).toBe(false);
  });

  it("没有可恢复的计划（或账本还没追上）时，横幅照旧给重试——不制造空窗", () => {
    expect(shouldOfferBannerRetry(base)).toBe(true);
  });

  it("没有可重发的消息、或已有一轮在跑时不给重试（既有行为，一字未动）", () => {
    expect(shouldOfferBannerRetry({ ...base, hasResendableMessage: false })).toBe(false);
    expect(shouldOfferBannerRetry({ ...base, agentIsRunning: true })).toBe(false);
  });
});
