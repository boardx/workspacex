/**
 * 用例：读工作流编排（F26 / `uc-2-2` R7 / 契约 `getWorkflowOrchestration`）。
 *
 * pre 只要求「调用者对该项目可见」——契约 `err` 里没有 `ROLE_INSUFFICIENT`，
 * 四种项目角色（含 `observer`）都能读，只有完全没有项目角色时才 `NO_PROJECT_ROLE`。
 */
import { templates } from "@repo/contracts";
import type { z } from "zod";
import type { ProjectRole } from "../../domain/identity/roles";
import type { OrchestrationRepository } from "./workflow-orchestration-ports";

export type GetWorkflowOrchestrationOutput = z.infer<
  typeof templates.operations.getWorkflowOrchestration.out
>;
export type GetWorkflowOrchestrationErrorCode = z.infer<typeof templates.TemplateError>;

/** 一个类携带契约里的一个错误码，同 `ApplyBlueprintError` / `TemplateOperationError` 的形状。 */
export class GetWorkflowOrchestrationError extends Error {
  readonly reasonCode: GetWorkflowOrchestrationErrorCode;
  constructor(reasonCode: GetWorkflowOrchestrationErrorCode) {
    super(reasonCode);
    this.reasonCode = reasonCode;
    this.name = "GetWorkflowOrchestrationError";
  }
}

export interface GetWorkflowOrchestrationInput {
  readonly projectId: string;
  /** null = 调用者在该项目没有任何角色。已由调用方（未来的控制器）解析好。 */
  readonly actorProjectRole: ProjectRole | null;
}

export interface GetWorkflowOrchestrationDeps {
  readonly orchestrations: OrchestrationRepository;
}

export async function getWorkflowOrchestration(
  deps: GetWorkflowOrchestrationDeps,
  input: GetWorkflowOrchestrationInput,
): Promise<GetWorkflowOrchestrationOutput> {
  if (input.actorProjectRole === null) throw new GetWorkflowOrchestrationError("NO_PROJECT_ROLE");

  const snapshot = await deps.orchestrations.load(input.projectId);
  if (snapshot === null) throw new GetWorkflowOrchestrationError("DEPENDENCY_UNAVAILABLE");

  return {
    template: {
      templateId: snapshot.template.templateId,
      name: snapshot.template.name,
      sourceVersion: snapshot.template.sourceVersion,
    },
    segmentChain: snapshot.segments.map((s) => ({ ...s })),
    matrix: snapshot.matrix.map((c) => ({ ...c, skillIds: [...c.skillIds] })),
  };
}
