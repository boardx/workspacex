/**
 * 用例：`[另存为组织模板]`（F26 / `uc-2-2` R7 步骤 8 / 契约 `templates.saveAsOrgTemplate`）。
 *
 * ⚠ **这里是本操作接口的唯一实现**——契约常量 `skills.SOLE_SAVE_AS_ORG_TEMPLATE_OPERATION
 * = "templates.saveAsOrgTemplate"` 钉死了这一点；`skills` 束的 `save-as-org-template.ts`
 * （F63）只提供「实例编排 → 模板本体」的形状转换与不变量，不注册路由，两者不是同一件事。
 *
 * ## 为什么它结构性地不可能回写来源模板
 *
 * 本用例的依赖里**没有**「写工作流模板本体」的端口——只有 `OrgTemplateCreatePort.create`，
 * 且它不接受一个已存在的 `templateId`（同 F63 版本头注「一个只有 create 的端口」的同一
 * 条纪律）：`I-17`「不回写」不是一条会被漏掉的运行时检查，是这个依赖清单上缺的那一项。
 *
 * ⚠ 契约 `saveAsOrgTemplate` **不需要蓝本维护者审核**——它没有改动定义层；
 *   它与 UC-2.3 的「提交回蓝本」是两条不同路径，互不替代。
 */
import { templates } from "@repo/contracts";
import type { z } from "zod";
import type { ProjectRole } from "../../domain/identity/roles";
import { canWriteOrchestration } from "./orchestration-write-guard";
import type { OrchestrationRepository, OrgTemplateCreatePort } from "./workflow-orchestration-ports";

export type SaveAsOrgTemplateOutput = z.infer<typeof templates.operations.saveAsOrgTemplate.out>;
export type SaveAsOrgTemplateErrorCode = z.infer<typeof templates.TemplateError>;

export class SaveAsOrgTemplateError extends Error {
  readonly reasonCode: SaveAsOrgTemplateErrorCode;
  constructor(reasonCode: SaveAsOrgTemplateErrorCode) {
    super(reasonCode);
    this.reasonCode = reasonCode;
    this.name = "SaveAsOrgTemplateError";
  }
}

export interface SaveAsOrgTemplateInput {
  readonly projectId: string;
  /** 目标组织——由调用方（未来的控制器）从项目上下文解析，契约 `in` 本身不携带它。 */
  readonly orgId: string;
  readonly name: string;
  readonly actorProjectRole: ProjectRole | null;
}

export interface SaveAsOrgTemplateDeps {
  readonly orchestrations: OrchestrationRepository;
  readonly orgTemplates: OrgTemplateCreatePort;
}

export async function saveAsOrgTemplate(
  deps: SaveAsOrgTemplateDeps,
  input: SaveAsOrgTemplateInput,
): Promise<SaveAsOrgTemplateOutput> {
  if (!canWriteOrchestration(input.actorProjectRole)) {
    throw new SaveAsOrgTemplateError(
      input.actorProjectRole === null ? "NO_PROJECT_ROLE" : "ROLE_INSUFFICIENT",
    );
  }

  const current = await deps.orchestrations.load(input.projectId);
  if (current === null) throw new SaveAsOrgTemplateError("DEPENDENCY_UNAVAILABLE");

  const created = await deps.orgTemplates.create({
    orgId: input.orgId,
    name: input.name,
    segments: current.segments.map((s) => ({ ...s })),
    matrix: current.matrix.map((c) => ({ ...c })),
  });

  // ⚠ 断言的是「新 id ≠ 来源模板 id」，不是「create 被调用」——一个把新 id 分配成
  // 来源模板 id 的实现同样会让这次调用「成功」，那正是覆盖，只是换了个动词。这不是
  // 一条契约错误码能表达的业务失败，是 `OrgTemplateCreatePort` 实现坏掉的信号，
  // 所以不套 `SaveAsOrgTemplateError`（那会让调用方把它当成一个正常的业务分支处理）。
  if (created.workflowTemplateId === current.template.templateId) {
    throw new Error(
      `OrgTemplateCreatePort.create returned the source template's own id (${created.workflowTemplateId}); ` +
        "that is an overwrite, not a save-as (I-17 violation in the port implementation)",
    );
  }

  return { workflowTemplateId: created.workflowTemplateId };
}
