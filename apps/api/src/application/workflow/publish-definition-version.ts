/**
 * UC-WR-1：发布 WorkflowDefinition 版本（WF01；requirements 02 R3 第 1 步；domain I-2/I-3）。
 */
import { WorkflowDefinitionVersionInput, type WorkflowDefinitionVersionView } from "@repo/contracts/workflow-runtime";
import { deepFreeze, sameDefinitionContent, validateDefinitionForPublish } from "../../domain/workflow/definition-version";
import { WorkflowUseCaseError } from "./workflow-errors";
import type { SkillVersionResolverPort, WorkflowActor, WorkflowClock, WorkflowDefinitionRepository, WorkflowGraphCatalog } from "./workflow-ports";

export interface PublishDefinitionDeps {
  definitions: WorkflowDefinitionRepository;
  graphs: WorkflowGraphCatalog;
  skills: SkillVersionResolverPort;
  clock: WorkflowClock;
}

export async function publishDefinitionVersion(
  deps: PublishDefinitionDeps,
  cmd: { orgId: string; actor: WorkflowActor; pathKey: string; body: unknown },
): Promise<WorkflowDefinitionVersionView> {
  // UC-WR-1 pre：调用者为组织管理员。契约 err 只列 workflow_not_found | definition_invalid，
  // 非管理员按「不可见」折成 workflow_not_found（与他组织/非成员同一个 404，不暴露 key 是否存在）。
  if (cmd.actor.orgRole !== "admin") {
    throw new WorkflowUseCaseError("workflow_not_found", "workflow not found");
  }
  if (!(await deps.definitions.definitionExists(cmd.orgId, cmd.pathKey))) {
    throw new WorkflowUseCaseError("workflow_not_found", "workflow not found");
  }
  const parsed = WorkflowDefinitionVersionInput.safeParse(cmd.body);
  if (!parsed.success) {
    throw new WorkflowUseCaseError("definition_invalid", "definition shape invalid", { issues: parsed.error.issues });
  }
  const input = parsed.data;
  if (input.key !== cmd.pathKey) {
    throw new WorkflowUseCaseError("definition_invalid", "body key does not match path key");
  }

  const existing = await deps.definitions.findVersion(cmd.orgId, input.key, input.version);
  if (existing) {
    if (existing.status === "published" && sameDefinitionContent(existing, input)) return existing; // 幂等重放
    throw new WorkflowUseCaseError("definition_invalid", "version already exists and is immutable");
  }

  // 解析在校验前预取（resolver 是异步端口，域规则是同步纯函数）。
  const resolved = new Map<string, string | null>();
  for (const stage of input.stages) {
    for (const ref of stage.skills) {
      const k = `${ref.stableId}\u0000${ref.versionRange}`;
      if (!resolved.has(k)) resolved.set(k, await deps.skills.resolve(cmd.orgId, ref.stableId, ref.versionRange));
    }
  }
  const issues = validateDefinitionForPublish(input, deps.graphs, (id, range) => resolved.get(`${id}\u0000${range}`) ?? null);
  if (issues.length > 0) {
    throw new WorkflowUseCaseError("definition_invalid", "definition failed publish validation", {
      issues,
      missingSkills: issues.flatMap((i) => (i.kind === "skill_unresolved" ? [`${i.stableId}@${i.versionRange}`] : [])),
    });
  }

  const view: WorkflowDefinitionVersionView = deepFreeze({ ...structuredClone(input), status: "published", publishedAt: deps.clock.nowIso() });
  await deps.definitions.insertPublished(cmd.orgId, view);
  return view;
}
