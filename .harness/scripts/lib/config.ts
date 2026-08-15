// config.ts — 加载并强类型化 harness.config.yaml
// 替代"配置是假文档"的问题：脚本运行时从此处取配置，改 yaml 立即生效。
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import { HARNESS_DIR } from "./paths";

export interface VerificationConfig {
  shell: string;
  fail_fast: boolean;
  /** ADR-106 batch-1/6（#1274）：风险分档取代原来的 require_base_pass 布尔值。 */
  default_profile: string;
  /** profile 名 → 该档要跑的完整命令（如 "pnpm -w run verify:quick"）。 */
  profiles: Record<string, string>;
  /** 本次改动碰到的文件路径命中任一 glob → 判 high_risk（#1332；替代原
   *  high_risk_markers 的 feature 元数据子串匹配，见 lib/verify-risk.ts 文件头）。 */
  high_risk_paths: string[];
}

export interface GatesConfig {
  single_in_progress: boolean;
  passing_is_irreversible: boolean;
  evidence_required: boolean;
  /** claim/verify 门控 spec_ref（每个 feature 必须能追溯到 requirements/ 下的一个 story 章节）。 */
  spec_ref_required: boolean;
}

export interface QualityConfig {
  evaluator_rubric: string;
  quality_document: string;
}

export interface PathsConfig {
  phases_dir: string;
  roadmap: string;
  project_progress: string;
}

export interface HarnessConfig {
  version: number;
  paths: PathsConfig;
  feature_states: string[];
  verification: VerificationConfig;
  gates: GatesConfig;
  quality: QualityConfig;
}

let _cached: HarnessConfig | null = null;

export function loadHarnessConfig(): HarnessConfig {
  if (_cached) return _cached;
  const raw = readFileSync(join(HARNESS_DIR, "config", "harness.config.yaml"), "utf8");
  const cfg = parse(raw) as HarnessConfig;
  if (!cfg || typeof cfg.version !== "number") {
    throw new Error("harness.config.yaml 结构非法或缺失");
  }
  _cached = cfg;
  return cfg;
}
