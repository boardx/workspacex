/**
 * 启动实例时冻结 definition 版本与每个 Skill 版本（WF01；ADR-118 第 5 条；domain I-4/I-5）。
 * 幂等 receipt / lease / 事件日志属于 WF02/WF03，本用例只负责「解析 + 冻结 + 落实例」。
 */
import type { PinnedSkillVersion, WorkflowDefinitionVersionView } from "@repo/contracts/workflow-runtime";
import { deepFreeze, pinSkillVersions } from "../../domain/workflow/definition-version";
import { WorkflowUseCaseError } from "./workflow-errors";
import type {
  PinnedWorkflowInstance,
  SkillVersionResolverPort,
  WorkflowDefinitionRepository,
  WorkflowInstanceRepository,
} from "./workflow-ports";

export interface PinInstanceDeps {
  definitions: WorkflowDefinitionRepository;
  instances: WorkflowInstanceRepository;
  skills: SkillVersionResolverPort;
  newId(): string;
}

export interface PinInstanceCommand {
  orgId: string;
  key: string;
  version?: number;
  agentId: string;
  agentVersionId: string;
  initiatorUserId: string;
  triggerKind: PinnedWorkflowInstance["triggerKind"];
}

export async function createPinnedInstance(deps: PinInstanceDeps, cmd: PinInstanceCommand): Promise<PinnedWorkflowInstance> {
  if (!(await deps.definitions.definitionExists(cmd.orgId, cmd.key))) {
    throw new WorkflowUseCaseError("workflow_not_found", "workflow not found");
  }
  const version = cmd.version ?? (await deps.definitions.latestPublishedVersion(cmd.orgId, cmd.key));
  const definition = version == null ? null : await deps.definitions.findVersion(cmd.orgId, cmd.key, version);
  if (!definition || definition.status !== "published") {
    throw new WorkflowUseCaseError("workflow_version_not_published", "workflow version not published");
  }

  const resolved = new Map<string, string | null>();
  for (const stage of definition.stages) {
    for (const ref of stage.skills) {
      const k = `${ref.stableId}\u0000${ref.versionRange}`;
      if (!resolved.has(k)) resolved.set(k, await deps.skills.resolve(cmd.orgId, ref.stableId, ref.versionRange));
    }
  }
  const pin = pinSkillVersions(definition, (id, range) => resolved.get(`${id}\u0000${range}`) ?? null);
  if (!pin.ok) {
    throw new WorkflowUseCaseError("skill_version_unresolved", "skill version unresolved", { missingSkills: pin.missingSkills });
  }

  const instance: PinnedWorkflowInstance = deepFreeze({
    instanceId: deps.newId(),
    orgId: cmd.orgId,
    workflowKey: definition.key,
    definitionVersion: definition.version,
    graphRef: definition.graphRef,
    pinnedSkills: pin.pinnedSkills,
    agentId: cmd.agentId,
    agentVersionId: cmd.agentVersionId,
    initiatorUserId: cmd.initiatorUserId,
    triggerKind: cmd.triggerKind,
    status: "running",
    stateVersion: 1,
  });
  await deps.instances.create(instance);
  return instance;
}

/** 运行时按实例冻结的版本取执行计划：永远读实例上的 definitionVersion，不读「最新版」。 */
export async function loadPinnedExecutionPlan(
  deps: Pick<PinInstanceDeps, "definitions" | "instances">,
  orgId: string,
  instanceId: string,
): Promise<{ definition: WorkflowDefinitionVersionView; skillsFor(stageId: string): PinnedSkillVersion[] }> {
  const instance = await deps.instances.find(orgId, instanceId);
  if (!instance) throw new WorkflowUseCaseError("workflow_not_found", "instance not found");
  const definition = await deps.definitions.findVersion(orgId, instance.workflowKey, instance.definitionVersion);
  if (!definition) throw new WorkflowUseCaseError("workflow_not_found", "pinned definition version missing");
  return {
    definition,
    skillsFor: (stageId) => instance.pinnedSkills.filter((p) => p.stageId === stageId),
  };
}
