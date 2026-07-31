/**
 * R3 步骤 8：`[另存为组织模板]` —— **沉淀回组织的唯一一条显式路径**（F63）。
 *
 * 依据：UC-3.2 R3 步骤 8「[原型] **不回写**原模板本体」；`usecases.md` 的
 *       `saveAsOrgTemplate`；domain.md I-17；O-03（须主持人确认）。
 *
 * ## 它为什么不可能回写
 *
 * 本用例的依赖里**没有 `WorkflowTemplateReadPort`** —— 连来源模板都读不到，
 * 更谈不上写。它只拿到：当前实例（读）＋ `OrgTemplateCreatePort`（只有 `create`）。
 * 「不回写」于是不是一条注释，而是**依赖清单上缺的那一项**。
 *
 * ⚠ 返回里带上 `sourceTemplateIdUntouched`：来源模板 id 从实例上抄下来原样返回，
 *   用例断言「新模板 id ≠ 它」。一个「create 出同一个 id」的实现是覆盖，只是换了个动词。
 *
 * ⚠ 契约把**接口**的唯一实现钉在 templates 束
 *   （`SOLE_SAVE_AS_ORG_TEMPLATE_OPERATION = "templates.saveAsOrgTemplate"`），
 *   本文件**不注册路由**，只提供 skill 束这一侧的形状转换与不变量。
 */
import {
  saveInstanceAsOrgTemplate,
  orchestrationFingerprint,
  type WorkflowTemplateBody,
} from "../../domain/skill/orchestration";
import type { SkillErrorCode } from "../../domain/skill/declarative-contract";
import type { OrgTemplateCreatePort, ProjectOrchestrationStorePort } from "./ports";

/** 契约常量的回指。⚠ 这里**不新增**一条路由，只声明它归谁。 */
export const SAVE_AS_ORG_TEMPLATE_OWNER = "templates.saveAsOrgTemplate" as const;

export interface SaveAsOrgTemplateInput {
  readonly projectId: string;
  readonly orgId: string;
  readonly name: string;
  readonly newTemplateId: string;
  /** O-03：另存属「最终确认」动作 ⇒ 未确认**零写入** */
  readonly hostConfirmed: boolean;
}

export type SaveAsOrgTemplateResult =
  | {
      readonly ok: true;
      readonly workflowTemplateId: string;
      readonly body: WorkflowTemplateBody;
      /** 来源模板 id（可能为 null：从空白搭的实例）。⚠ 用例断言新 id ≠ 它 */
      readonly sourceTemplateIdUntouched: string | null;
      /** 新模板的内容指纹 ＝ 当前实例的内容指纹（另存的是「当前实例编排」） */
      readonly fingerprint: string;
    }
  | { readonly ok: false; readonly code: SkillErrorCode; readonly reason: string };

export interface SaveAsOrgTemplateDeps {
  readonly orchestrations: ProjectOrchestrationStorePort;
  readonly orgTemplates: OrgTemplateCreatePort;
  readonly newBindingId: (index: number) => string;
}

export async function saveAsOrgTemplate(
  input: SaveAsOrgTemplateInput,
  deps: SaveAsOrgTemplateDeps,
): Promise<SaveAsOrgTemplateResult> {
  if (!input.hostConfirmed) {
    return {
      ok: false,
      code: "TEMPLATE_WRITEBACK_FORBIDDEN",
      reason: "另存为组织模板属最终确认动作，须主持人确认（O-03）；确认前零写入",
    };
  }

  const instance = await deps.orchestrations.load(input.projectId);
  if (instance === null) {
    return { ok: false, code: "DEPENDENCY_UNAVAILABLE", reason: "该项目尚无实例编排" };
  }

  const body = saveInstanceAsOrgTemplate({
    instance,
    orgId: input.orgId,
    name: input.name,
    newTemplateId: input.newTemplateId,
    newBindingId: deps.newBindingId,
  });

  if (instance.sourceTemplateId !== null && body.templateId === instance.sourceTemplateId) {
    // 分配到同一个 id 的「新建」就是覆盖。在写出去**之前**拦住。
    return {
      ok: false,
      code: "TEMPLATE_WRITEBACK_FORBIDDEN",
      reason: `新模板 id 与来源模板 ${instance.sourceTemplateId} 相同：那是覆盖不是另存`,
    };
  }

  const created = await deps.orgTemplates.create(body);
  return {
    ok: true,
    workflowTemplateId: created.templateId,
    body,
    sourceTemplateIdUntouched: instance.sourceTemplateId,
    fingerprint: orchestrationFingerprint(body),
  };
}
