// verify-risk.ts — feature 风险分档（ADR-106 batch-1/6，issue #1274）。
//
// 判据显式、可审计：feature.area 或 feature.verification 命令字符串里出现
// config.high_risk_markers 任一标记子串 → high_risk。宁可判重不判漏——不确定
// 就按更贵的档验证，不是相反。
import type { Feature } from "./types";
import type { VerificationConfig } from "./config";

export type RiskLevel = "small" | "standard" | "high_risk";

/** 纯函数：只看 markers 命中与否，不读配置默认档——默认档由调用方决定。 */
export function isHighRisk(feature: Pick<Feature, "area" | "verification">, markers: string[]): boolean {
  const haystack = [feature.area, ...feature.verification].join("\n").toLowerCase();
  return markers.some((m) => haystack.includes(m.toLowerCase()));
}

export function classifyFeatureRisk(
  feature: Pick<Feature, "area" | "verification">,
  cfg: VerificationConfig,
): RiskLevel {
  if (isHighRisk(feature, cfg.high_risk_markers)) return "high_risk";
  const fallback = cfg.default_profile;
  if (fallback === "small" || fallback === "standard" || fallback === "high_risk") return fallback;
  // default_profile 配置成非法值：宁可报错也不要悄悄退化成某个随意的默认档。
  throw new Error(`harness.config.yaml 的 verification.default_profile 非法: "${fallback}"`);
}

export interface ResolvedProfile {
  level: RiskLevel;
  cmd: string;
}

export function resolveVerifyProfile(
  feature: Pick<Feature, "area" | "verification">,
  cfg: VerificationConfig,
): ResolvedProfile {
  const level = classifyFeatureRisk(feature, cfg);
  const cmd = cfg.profiles[level];
  if (!cmd) {
    throw new Error(`harness.config.yaml 的 verification.profiles 缺少 "${level}" 档的命令`);
  }
  return { level, cmd };
}
