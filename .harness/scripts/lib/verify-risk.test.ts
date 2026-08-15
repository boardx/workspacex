// verify-risk.test.ts — 反证是本 issue（#1274）的核心：用真实历史 feature 形状
// （不是拍出来的玩具用例）反跑一遍分类器，确认高风险/低风险都落对档。
import { describe, expect, it } from "vitest";
import { classifyFeatureRisk, isHighRisk, resolveVerifyProfile } from "./verify-risk";
import type { VerificationConfig } from "./config";

const cfg: VerificationConfig = {
  shell: "bash",
  fail_fast: true,
  default_profile: "standard",
  profiles: {
    small: "pnpm -w run verify:quick",
    standard: "pnpm -w run verify:quick",
    high_risk: "pnpm -w run verify:release",
  },
  high_risk_markers: ["migration", "apps/api/migrations", "auth", "permission", "packages/coord-", "contracts/", "schema"],
};

describe("verify-risk", () => {
  it("真实高风险场景：数据库 migration 改动 → high_risk", () => {
    // 形状取自本仓真实 issue：F03 source_materials 级联删除迁移
    // （apps/api/migrations/20260814100000_f03_source_materials_cascade.sql）
    const feature = {
      area: "files",
      verification: [
        "psql -f apps/api/migrations/20260814100000_f03_source_materials_cascade.sql --dry-run",
        "pnpm --filter api exec vitest run src/files/source-materials.test.ts",
      ],
    };
    expect(isHighRisk(feature, cfg.high_risk_markers)).toBe(true);
    expect(classifyFeatureRisk(feature, cfg)).toBe("high_risk");
    expect(resolveVerifyProfile(feature, cfg).cmd).toBe("pnpm -w run verify:release");
  });

  it("真实高风险场景：鉴权改动 → high_risk（area 命中，不靠 verification 命令）", () => {
    // 形状取自本仓真实场景：coord-agent-auth 模块的鉴权 feature
    const feature = {
      area: "coord-agent-auth",
      verification: ["pnpm --filter web exec playwright test --grep @login"],
    };
    expect(classifyFeatureRisk(feature, cfg)).toBe("high_risk");
  });

  it("真实高风险场景：跨束 API 契约改动 → high_risk", () => {
    const feature = {
      area: "chat",
      verification: [
        "pnpm exec tsc --noEmit phases/phase-01-run-a-project/contracts/chat-bundle/api.ts",
      ],
    };
    expect(classifyFeatureRisk(feature, cfg)).toBe("high_risk");
  });

  it("真实低风险场景：纯前端文案改动 → 走 default_profile（standard），不误判成 high_risk", () => {
    // 形状取自本仓真实场景：类似 #1157「新对话默认 agent 不再意外选中 Deep Research」
    const feature = {
      area: "chat",
      verification: [
        "pnpm --filter web exec playwright test --config playwright.chat-read.config.ts",
      ],
    };
    expect(classifyFeatureRisk(feature, cfg)).toBe("standard");
    expect(resolveVerifyProfile(feature, cfg).cmd).toBe("pnpm -w run verify:quick");
  });

  it("真实低风险场景：纯文档/skill 改动 → standard，不因为路径里凑巧出现子串就误判", () => {
    const feature = {
      area: "harness",
      verification: ["pnpm exec vitest run .harness/scripts/lib/verify-risk.test.ts"],
    };
    expect(classifyFeatureRisk(feature, cfg)).toBe("standard");
  });

  it("反证：default_profile 配置非法值时必须报错，不能悄悄退化成某个随意档", () => {
    const badCfg: VerificationConfig = { ...cfg, default_profile: "not-a-real-profile" };
    const feature = { area: "chat", verification: ["echo ok"] };
    expect(() => classifyFeatureRisk(feature, badCfg)).toThrow(/default_profile/);
  });

  it("反证：profiles 缺某档命令时 resolveVerifyProfile 必须报错，不能返回 undefined 静默通过", () => {
    const incompleteCfg: VerificationConfig = {
      ...cfg,
      profiles: { small: "x", standard: "y" }, // 缺 high_risk
    };
    const feature = { area: "auth", verification: ["echo ok"] };
    expect(() => resolveVerifyProfile(feature, incompleteCfg)).toThrow(/high_risk/);
  });
});
