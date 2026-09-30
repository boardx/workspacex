/**
 * 批次 2（共享线 W003/W004/W007 + 运营线 W052/W053/W055/W056）Workflow 定义的阶段构造器。
 *
 * Skill 版本固定（ADR-118 第 9 条：Workflow 版本固定其 Skill 版本；不接受区间）。与销售线不同，批次 2 的 Skill
 * 分属多个 starter-pack（work-research / work-product / work-operations / work-customer-success /
 * work-resolution / work-engineering / work-executive），所以 pin 版本来自下面这张**显式表**，而不是某一个包的版本号。
 * 表里每一项都由 `batch2-workflow-skillpins-matrix.test.ts` 与 starter-pack 中该 Skill 的 `semanticVersion` 逐项核对
 * （同一事实不另抄第二份：包是事实源，这张表只是 Workflow 侧的「我钉了哪个版本」）。
 *
 * `S019`（SOP Authoring）目前没有任何 starter-pack（实体文档已 PASS，但 Skill 包未作者化）：它按 1.0.0 钉住，
 * 注册时解析不到 ⇒ 仅 W055 标为 unavailable（`workflow_skill_pin_unresolved`，`unresolvedPins=[S019]`），
 * 与销售线 W012/S027 同一处置；S019 的包落地后无需改本文件，W055 自动变 available。
 */
import type { WorkflowSideEffectClass } from "@repo/contracts/workflow-runtime";
import type { z } from "zod";
import type { WorkContentStage } from "../../workflow-definition-module";

/** 批次 2 引用的 24 个 Skill → 固定版本（其中 23 个在 starter-pack 内；S019 见文件头）。 */
export const BATCH2_SKILL_VERSIONS: Readonly<Record<string, string>> = Object.freeze({
  S007: "1.0.0", S010: "1.0.0", S011: "1.0.0", S012: "1.0.0", S015: "1.0.0", S016: "1.0.0",
  S018: "1.0.0", S019: "1.0.0", S020: "1.0.0", S141: "1.0.0", S142: "1.0.0", S143: "1.0.0",
  S144: "1.0.0", S145: "1.0.0", S154: "1.0.0", S155: "1.0.0", S156: "1.0.0", S162: "1.0.0",
  S177: "1.0.0", S179: "1.0.0", S187: "1.0.0", S189: "1.0.0", S190: "1.0.0", S197: "1.0.0",
});

export interface StageSpec {
  skills?: readonly string[];
  caps?: readonly string[];
  sideEffect?: z.infer<typeof WorkflowSideEffectClass>;
  gate?: { roles: readonly string[]; selfApproval?: boolean; onDeny?: string | null };
  maxAttempts?: number;
  parallelGroup?: string;
}

export function stage(stageId: string, title: string, spec: StageSpec = {}): WorkContentStage {
  const out: WorkContentStage = {
    stageId,
    title,
    skills: (spec.skills ?? []).map((stableId) => {
      const versionRange = BATCH2_SKILL_VERSIONS[stableId];
      if (versionRange === undefined) throw new Error(`batch2 stage ${stageId}: no pinned version declared for ${stableId}`);
      return { stableId, versionRange };
    }),
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
  if (spec.parallelGroup !== undefined) out.parallelGroup = spec.parallelGroup;
  return out;
}

export function gate(gateId: string, stageId: string, opts: { dual?: boolean; binds?: readonly string[] } = {}) {
  return { gateId, stageId, requiresDualSign: opts.dual ?? false, autoApprove: false as const, ...(opts.binds ? { binds: opts.binds } : {}) };
}
