/**
 * CT06 —— 由角色 Agent 发起内容线 Workflow（05-content-lines.md R3 步骤 6 / R4 E3；契约束 work-content
 * 「白名单外发起」；UC-WR-3 start 内核复用）。
 *
 * 顺序：按 Workflow stableId 找到内容线定义 → 读发起 Agent **已发布版本**冻结的 `workflowAllowlist`
 * → 白名单外：抛 `ContentWorkflowNotAllowlistedError`（HTTP 403 `workflow_not_allowed`，body 附
 * `WorkflowNotAllowlistedHint`，列出可转交的官方角色），**不**改走其它 Workflow（不静默降级）；
 * 白名单内：交给 Workflow Runtime 的 start（准入 / 版本解析 / Skill 固定都在那里）。
 */
import { WorkflowNotAllowlistedHint } from "@repo/contracts/work-content";
import type { z } from "zod";
import { checkWorkflowAllowlisted } from "../../domain/work-content/content-workflow-registration";
import type { ContentWorkflowDefinition } from "../../domain/work-content/product-workflow-definitions";
import type { StartInstanceResponse } from "../workflow/instance-commands";
import { WorkflowUseCaseError } from "../workflow/workflow-errors";

export type WorkflowNotAllowlistedHintT = z.infer<typeof WorkflowNotAllowlistedHint>;

/** 发起 Agent 已发布版本冻结的白名单；Agent 不可运行（未发布 / 停用 / 非成员）返回 null。 */
export interface AgentWorkflowAllowlistPort {
  publishedWorkflowAllowlist(orgId: string, userId: string, agentId: string): Promise<readonly string[] | null>;
}

export interface WorkflowStarterPort {
  start(orgId: string, userId: string, pathKey: string, body: unknown): Promise<StartInstanceResponse>;
}

export interface StartContentWorkflowDeps {
  definitions: readonly ContentWorkflowDefinition[];
  agents: AgentWorkflowAllowlistPort;
  /** 官方角色 → workflowAllowlist（用于算转交候选）。 */
  officialRoleAllowlists: Readonly<Record<string, readonly string[]>>;
  runtime: WorkflowStarterPort;
}

export interface StartContentWorkflowCommand {
  orgId: string;
  userId: string;
  agentId: string;
  workflowId: string;
  requestId: string;
  input: Record<string, unknown>;
}

/** E3：白名单外发起。`code` 沿用 runtime 的 HTTP 码，`hint` 细分（契约 Q2 裁决前的约定）。 */
export class ContentWorkflowNotAllowlistedError extends WorkflowUseCaseError {
  constructor(readonly hint: WorkflowNotAllowlistedHintT) {
    super("workflow_not_allowed", "workflow not in agent allowlist");
    this.name = "ContentWorkflowNotAllowlistedError";
  }
}

export async function startContentWorkflow(deps: StartContentWorkflowDeps, cmd: StartContentWorkflowCommand): Promise<StartInstanceResponse> {
  const def = deps.definitions.find((d) => d.workflowId === cmd.workflowId);
  if (!def) throw new WorkflowUseCaseError("workflow_not_found", "workflow not found");
  const allowlist = await deps.agents.publishedWorkflowAllowlist(cmd.orgId, cmd.userId, cmd.agentId);
  if (allowlist === null) throw new WorkflowUseCaseError("workflow_not_allowed", "agent not runnable for this workflow");
  const decision = checkWorkflowAllowlisted(cmd.agentId, cmd.workflowId, { ...deps.officialRoleAllowlists, [cmd.agentId]: allowlist });
  if (!decision.ok) {
    throw new ContentWorkflowNotAllowlistedError(
      WorkflowNotAllowlistedHint.parse({
        code: decision.code,
        requestedWorkflowId: decision.requestedWorkflowId,
        handoffCandidates: decision.handoffCandidates.filter((r) => r in deps.officialRoleAllowlists),
      }),
    );
  }
  return deps.runtime.start(cmd.orgId, cmd.userId, def.key, { agentId: cmd.agentId, requestId: cmd.requestId, input: cmd.input });
}
