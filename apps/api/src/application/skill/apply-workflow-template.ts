/**
 * R3 步骤 1：套用工作流模板 —— **一次性写入这场项目**（F63）。
 *
 * 依据：UC-3.2 R3 步骤 1 / AC2；契约 `applyWorkflowTemplate`；domain.md I-17。
 *
 * ## 这个用例交付的三件事
 *
 * 1. 模板的环节链、绑定、三角色分工**深拷贝**进实例，并记 `sourceTemplateVersion`
 *    （界面上的「来自后台 v2」）。
 * 2. 可绑定池校验：模板里引用了**非 `已启用`** 的 skill ⇒ `SKILL_NOT_ENABLED`，
 *    **零写入**（E1 后半句「新项目套用前须处置」）。
 * 3. O-03：切模板属「最终确认」动作 ⇒ 未经主持人确认 **零写入**。
 *
 * ⚠ 三条失败路径都断言「实例存储一次都没被调用」，而不只是断言返回码。
 *   一个先写后校验的实现，返回码同样是对的。
 *
 * ⚠ 已有实例改动时列出「将丢失的清单」（V6）与孤立绑定逐条处置属 **F64**，
 *   本用例只在检测到已有实例编排时**拒绝并指向那条路径**，不静默覆盖。
 */
import {
  applyTemplateToProject,
  referenceHealth,
  sourceLabelOf,
  type ProjectOrchestration,
  type SkillVersionCatalog,
} from "../../domain/skill/orchestration";
import { bindingsOfKind, type SegmentBinding } from "../../domain/skill/binding-slot";
import type { SkillErrorCode } from "../../domain/skill/declarative-contract";
import type {
  ProjectOrchestrationStorePort,
  SkillVisibilityPort,
  WorkflowTemplateReadPort,
} from "./ports";

export interface ApplyWorkflowTemplateInput {
  readonly projectId: string;
  readonly workflowTemplateId: string;
  readonly principalId: string;
  /** O-03：切模板须主持人确认。⚠ 为 false 时**零写入** */
  readonly hostConfirmed: boolean;
}

export type ApplyWorkflowTemplateResult =
  | {
      readonly ok: true;
      readonly orchestration: ProjectOrchestration;
      /** 「来自后台 v2」。契约 `out.sourceTemplateVersion` 的人类可读形态 */
      readonly sourceLabel: string | null;
    }
  | { readonly ok: false; readonly code: SkillErrorCode; readonly reason: string };

export interface ApplyWorkflowTemplateDeps {
  readonly templates: WorkflowTemplateReadPort;
  readonly orchestrations: ProjectOrchestrationStorePort;
  readonly skills: SkillVisibilityPort;
  /** 实例绑定 id 的分配。注入而不是内部生成：测试要断言的是**内容**不是随机串 */
  readonly newBindingId: (index: number) => string;
}

export async function applyWorkflowTemplate(
  input: ApplyWorkflowTemplateInput,
  deps: ApplyWorkflowTemplateDeps,
): Promise<ApplyWorkflowTemplateResult> {
  if (!input.hostConfirmed) {
    return {
      ok: false,
      code: "ORPHAN_BINDING_UNRESOLVED",
      reason: "切模板属最终确认动作，须主持人确认（O-03）；确认前零写入",
    };
  }

  const template = await deps.templates.load(input.workflowTemplateId);
  if (template === null) {
    return { ok: false, code: "DEPENDENCY_UNAVAILABLE", reason: "工作流模板不存在或暂不可读" };
  }

  const existing = await deps.orchestrations.load(input.projectId);
  if (existing !== null && existing.bindings.length > 0) {
    // 覆盖前必须先列出将丢失的绑定与分工（V6/AC6）。那份清单与逐条处置是 F64 的
    // `previewOrphanBindings` / `confirmOrphanDisposition`；本用例**不自己发明第二条**，
    // 而是明确失败并指过去。静默覆盖是这里唯一不可接受的行为。
    return {
      ok: false,
      code: "ORPHAN_BINDING_UNRESOLVED",
      reason:
        "该项目已有实例级编排：须先经 previewOrphanBindings 列出将丢失的绑定与分工并逐条处置",
    };
  }

  // 可绑定池校验先于任何写入。⚠ 校验的是**模板里的 skill 绑定**，
  // 画布模板与 agent 产物不走 skill 的启用判定 —— 那正是混合槽可区分的用处。
  for (const b of bindingsOfKind(template.bindings, "skill")) {
    const entry = await deps.skills.visibleTo({
      skillId: b.slot.skillId,
      principalId: input.principalId,
    });
    if (entry === null) {
      // I-14：不存在与可见性范围外**同一个出口**，不泄露存在性。
      //
      // ⚠ 这里用 `SKILL_NOT_ENABLED` 而不是 `SKILL_NOT_FOUND`：契约
      //   `applyWorkflowTemplate.err` 是**封闭清单**，里面没有 `SKILL_NOT_FOUND`
      //   （只有 `upsertSegmentBinding` 有）。契约是签核过的单一事实源，
      //   照它落。⚠ 副作用是：套用一个引用了「本人不可见的 team-only skill」的模板，
      //   与套用一个引用了已停用 skill 的模板，返回码相同 ——
      //   **这是契约当前形状的已知代价，已在 issue #91 记下待人裁**，不在本 feature 里挑边。
      return {
        ok: false,
        code: "SKILL_NOT_ENABLED",
        reason: `模板绑定引用的 skill ${b.slot.skillId} 不在当前用户的可绑定池内`,
      };
    }
    if (entry.status !== "已启用") {
      return {
        ok: false,
        code: "SKILL_NOT_ENABLED",
        reason: `模板绑定引用了 ${entry.status} 的 skill ${b.slot.skillId}：新项目套用前须处置（E1）`,
      };
    }
  }

  const orchestration = applyTemplateToProject({
    template,
    projectId: input.projectId,
    newBindingId: deps.newBindingId,
  });
  await deps.orchestrations.save(orchestration);

  return { ok: true, orchestration, sourceLabel: sourceLabelOf(orchestration) };
}

/**
 * 模板侧的「这条绑定还能不能拿去开新项目」清单（E1 的模板半边）。
 *
 * 单独一个纯函数而不是塞进上面的循环：界面要在**套用之前**把标记显示出来
 * （「引用了已停用的 skill」），那是一次纯读。
 */
export function templateBindingFlags(
  template: { readonly bindings: readonly SegmentBinding[] },
  catalog: SkillVersionCatalog,
): readonly { readonly bindingId: string; readonly flag: string }[] {
  return template.bindings
    .map((b) => ({ bindingId: b.bindingId, health: referenceHealth(b, catalog) }))
    .filter((x) => x.health.flag !== null)
    .map((x) => ({ bindingId: x.bindingId, flag: x.health.flag as string }));
}
