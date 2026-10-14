import type { ContentSkillRunnerPort } from "../../application/work-content/content-skill-runner";
import type { StageExecution, StageWork } from "../../application/workflow/run-instance";
import type { WorkflowInstanceRepository } from "../../application/workflow/workflow-ports";
import type { WorkflowStageOutputStore } from "../../application/workflow/workflow-runtime-ports";
import type { WorkflowDefinitionVersionInput } from "@repo/contracts/workflow-runtime";

export class ContentStageUnavailableError extends Error {
  readonly code = "WORKFLOW_CONTENT_UNAVAILABLE";
  constructor(readonly reason: string) {
    super(`workflow content unavailable: ${reason}`);
    this.name = "ContentStageUnavailableError";
  }
}

export interface PinnedContentStageDeps {
  skills: ContentSkillRunnerPort;
  instances: WorkflowInstanceRepository;
  outputs: WorkflowStageOutputStore;
}

/** Durable predecessors, same-tenant instance, and exact frozen pins are prerequisites for work. */
export async function contentStageContext(
  deps: PinnedContentStageDeps,
  definition: WorkflowDefinitionVersionInput,
  exec: StageExecution,
) {
  const instance = await deps.instances.find(exec.lease.orgId, exec.instanceId);
  if (!instance || instance.orgId !== exec.lease.orgId || instance.workflowKey !== definition.key ||
    instance.definitionVersion !== definition.version || instance.graphRef !== definition.graphRef) {
    throw new ContentStageUnavailableError("instance_missing_or_wrong_workflow");
  }
  const index = definition.stages.findIndex(stage => stage.stageId === exec.stageId);
  if (index < 0) throw new ContentStageUnavailableError("stage_unknown");
  const stage = definition.stages[index]!;
  const pins = exec.pinnedSkills;
  if (pins.length !== stage.skills.length || stage.skills.some(ref =>
    pins.filter(pin => pin.stageId === stage.stageId && pin.stableId === ref.stableId &&
      pin.version === ref.versionRange).length !== 1)) {
    throw new ContentStageUnavailableError("pinned_skill_missing_or_duplicated");
  }
  const prior: Record<string, unknown> = {};
  for (const previous of definition.stages.slice(0, index)) {
    const row = await deps.outputs.find(exec.lease.orgId, exec.instanceId, previous.stageId, 1);
    if (!row) throw new ContentStageUnavailableError(`prior_output_missing:${previous.stageId}`);
    prior[previous.stageId] = row.content.output;
  }
  return { instance, prior, stage };
}

/** Runs every declared Skill; no missing pin or empty/metadata-only reply can masquerade as success. */
export function pinnedContentStage(
  deps: PinnedContentStageDeps,
  workflowId: string,
  definition: WorkflowDefinitionVersionInput,
  runtimeInstructions?: string,
): StageWork {
  return async exec => {
    const { instance, prior, stage } = await contentStageContext(deps, definition, exec);
    if (!stage.skills.length) throw new ContentStageUnavailableError(`stage_adapter_missing:${exec.stageId}`);
    const results: Record<string, Record<string, unknown>> = {};
    for (const ref of stage.skills) {
      const result = await deps.skills.run({
        orgId: exec.lease.orgId, instanceId: exec.instanceId, agentVersionId: instance.agentVersionId,
        workflowId, stageId: exec.stageId, skillId: ref.stableId, skillVersion: ref.versionRange,
        input: exec.input, prior,
        ...(runtimeInstructions ? { runtimeInstructions } : {}),
      });
      const body = Object.entries(result).filter(([key]) =>
        !["workflowId", "stageId", "skillId", "skillVersion", "pinnedSkills", "skills", "label"].includes(key));
      if (!body.some(([, value]) => value !== null && value !== undefined && JSON.stringify(value).length > 2)) {
        throw new ContentStageUnavailableError(`skill_output_empty:${ref.stableId}`);
      }
      results[ref.stableId] = result;
    }
    const output = stage.skills.length === 1 ? results[stage.skills[0]!.stableId]! : { results };
    return { label: `${workflowId}/${exec.stageId}`, content: { workflowId, stageId: exec.stageId, output } };
  };
}
