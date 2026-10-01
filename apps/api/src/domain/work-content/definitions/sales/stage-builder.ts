/**
 * 销售线 Workflow 定义的阶段构造器（CT08）。Skill 版本统一固定为 work-sales 包的 `semanticVersion`
 * （ADR-118 第 9 条：Workflow 版本固定其 Skill 版本；不接受区间）。
 */
import type { WorkflowSideEffectClass } from "@repo/contracts/workflow-runtime";
import type { z } from "zod";
import type { WorkContentStage } from "../../workflow-definition-module";

/** work-sales 包（CT07，`skills/work-sales/*` frontmatter `version`）的 Skill 版本。 */
export const SALES_SKILL_VERSION = "1.0.0";

export interface StageSpec {
  skills?: readonly string[];
  caps?: readonly string[];
  sideEffect?: z.infer<typeof WorkflowSideEffectClass>;
  gate?: { roles: readonly string[]; selfApproval?: boolean; onDeny?: string | null };
  maxAttempts?: number;
  fanOutConcurrency?: number;
  parallelGroup?: string;
  layer?: "campaign" | "lane";
}

export function stage(stageId: string, title: string, spec: StageSpec = {}): WorkContentStage {
  const out: WorkContentStage = {
    stageId,
    title,
    skills: (spec.skills ?? []).map((stableId) => ({ stableId, versionRange: SALES_SKILL_VERSION })),
    capabilityCategories: [...(spec.caps ?? [])],
    sideEffect: spec.sideEffect ?? "read",
    humanGate: spec.gate
      ? {
          approverRoles: [...spec.gate.roles],
          approverUserIds: [],
          allowSelfApproval: spec.gate.selfApproval ?? false,
          onDenyStageId: spec.gate.onDeny ?? null,
        }
      : null,
    maxAttempts: spec.maxAttempts ?? 3,
  };
  if (spec.fanOutConcurrency !== undefined) out.fanOutConcurrency = spec.fanOutConcurrency;
  if (spec.parallelGroup !== undefined) out.parallelGroup = spec.parallelGroup;
  if (spec.layer !== undefined) out.layer = spec.layer;
  return out;
}

export function gate(gateId: string, stageId: string, opts: { dual?: boolean; binds?: readonly string[] } = {}) {
  return { gateId, stageId, requiresDualSign: opts.dual ?? false, autoApprove: false as const, ...(opts.binds ? { binds: opts.binds } : {}) };
}
