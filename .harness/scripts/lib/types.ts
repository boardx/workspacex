// feature 的字段表、TS 类型、JSON 模板与校验器同出一源：lib/feature-schema.ts（issue #386）。
// 这里只做**再导出**——曾经手写在本文件里的 `interface Feature` 已经删除：它当时缺 `points`，
// 而模板缺 `spec_ref`/`depends_on`/`points`，validate-fl 又自建第三份，三份各自漂移。
// 想改字段或必填性，改字段表，不要在这里加回一份。
import type { Feature } from "./feature-schema";
export type { Feature, FeatureStatus, RawFeature } from "./feature-schema";
export { FEATURE_STATES, FEATURE_FIELDS, FEATURE_FIELD_NAMES } from "./feature-schema";

export interface FeatureList {
  phase: string;
  features: Feature[];
}

export type PhaseStatus = "not_started" | "in_progress" | "blocked" | "done";

export interface RoadmapPhase {
  id: string;
  slug: string;
  name: string;
  goal: string;
  status: PhaseStatus;
  depends_on: string[];
  /**
   * true = 本阶段有用户界面。两个机械后果，都在束级签核门里（ADR-023 决策一，2026-07-30）：
   * ① 该阶段每个契约束必须有 `ui.md`（UI 签核的第 ① 件材料）；
   * ② 该阶段若**没有任何契约束**，签核门直接判失败——有界面却无处签核，不是放行的理由。
   * （原 phase 级 `ui-signoff.md` 关卡见 ADR-003，已于 2026-07-30 停用。）
   */
  has_ui?: boolean;
  /** Existing GitHub umbrella issue used for external phase coordination. */
  tracking_issue?: number;
}

export interface Roadmap {
  project: string;
  phases: RoadmapPhase[];
}
