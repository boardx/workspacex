/**
 * 内容线 Workflow 注册与白名单判定（CT05；05-content-lines.md R4 E2 / E3；契约束 work-content domain I-C4）。
 *
 * - 注册：每个 Workflow 独立校验（图工厂已注册、阶段与图节点一一对应、每个固定的 Skill 版本在目录中且
 *   门状态达到 G2）。任一引用未解析 → 该 Workflow `unavailable` + `workflow_skill_pin_unresolved`，
 *   其它 Workflow 不受影响（逐个判定，不抛出）。
 * - 白名单：角色 Agent 只能发起 `workflowAllowlist` 内的 Workflow；白名单外返回
 *   `workflow_not_allowlisted` 与可转交的角色（不静默降级）。
 *
 * 纯函数、无 IO。
 */
import { validateDefinitionForPublish, type WorkflowGraphCatalog } from "../workflow/definition-version";
import { graphRefOf, skillPinsOf, toRuntimeDefinition, type ContentWorkflowDefinition } from "./product-workflow-definitions";

/** Skill 目录中的一个已入目录版本及其已通过的门。 */
export interface CatalogSkillVersion {
  stableId: string;
  semanticVersion: string;
  passedGates: readonly string[];
}

/** 注册要求：固定的 Skill 版本至少通过 G0–G2（E2「门状态低于 G2 → 注册失败」）。 */
export const REQUIRED_SKILL_GATES = ["G0", "G1", "G2"] as const;

export interface SkillPin {
  skillId: string;
  semanticVersion: string;
}

export interface RegisteredContentWorkflow {
  workflowId: string;
  key: string;
  version: number;
  title: string;
  line: ContentWorkflowDefinition["line"];
  skillPins: SkillPin[];
  stages: { stageId: string; title: string }[];
  gates: { gateId: string; stageId: string; requiresDualSign: boolean }[];
  effects: string[];
  availability: "available" | "unavailable";
  unavailableReason: "workflow_skill_pin_unresolved" | null;
  unresolvedPins: SkillPin[];
  /** 图工厂 / 阶段对应问题（非 Skill 引用）；非空同样使 Workflow 不可用。 */
  graphIssues: string[];
}

export function skillCatalogResolver(catalog: readonly CatalogSkillVersion[]) {
  return (stableId: string, versionRange: string): string | null => {
    const hit = catalog.find((c) => c.stableId === stableId && c.semanticVersion === versionRange);
    if (!hit) return null;
    return REQUIRED_SKILL_GATES.every((g) => hit.passedGates.includes(g)) ? hit.semanticVersion : null;
  };
}

export function registerContentWorkflow(
  def: ContentWorkflowDefinition,
  graphs: WorkflowGraphCatalog,
  catalog: readonly CatalogSkillVersion[],
): RegisteredContentWorkflow {
  const runtime = toRuntimeDefinition(def);
  const issues = validateDefinitionForPublish(runtime, graphs, skillCatalogResolver(catalog));
  const pins = skillPinsOf(def);
  const unresolvedIds = new Set(issues.flatMap((i) => (i.kind === "skill_unresolved" ? [i.stableId] : [])));
  const unresolvedPins = pins.filter((p) => unresolvedIds.has(p.skillId));
  const graphIssues = issues.flatMap((i) =>
    i.kind === "graph_not_registered" ? [`graph_not_registered:${i.graphRef}`]
    : i.kind === "stage_without_node" ? [`stage_without_node:${i.stageId}`]
    : i.kind === "node_without_stage" ? [`node_without_stage:${i.nodeId}`]
    : [],
  );
  const available = unresolvedPins.length === 0 && graphIssues.length === 0;
  return {
    workflowId: def.workflowId,
    key: def.key,
    version: runtime.version,
    title: runtime.title,
    line: def.line,
    skillPins: pins,
    stages: def.stages.map((s) => ({ stageId: s.stageId, title: s.stageId })),
    gates: def.stages.flatMap((s) => (s.gateId === null ? [] : [{ gateId: s.gateId, stageId: s.stageId, requiresDualSign: false }])),
    effects: [...new Set(def.stages.flatMap((s) => s.capabilityCategories))],
    availability: available ? "available" : "unavailable",
    unavailableReason: unresolvedPins.length > 0 ? "workflow_skill_pin_unresolved" : null,
    unresolvedPins,
    graphIssues,
  };
}

/** 批量注册：逐个独立判定，一个 Workflow 的失败不影响其它（E2）。 */
export function registerContentWorkflows(
  defs: readonly ContentWorkflowDefinition[],
  graphs: WorkflowGraphCatalog,
  catalog: readonly CatalogSkillVersion[],
): RegisteredContentWorkflow[] {
  return defs.map((d) => registerContentWorkflow(d, graphs, catalog));
}

export { graphRefOf };

export type AllowlistDecision =
  | { ok: true }
  | { ok: false; code: "workflow_not_allowlisted"; requestedWorkflowId: string; handoffCandidates: string[] };

/**
 * E3：角色 Agent 发起 Workflow 前的白名单判定。`allowlists` = 各官方角色的 `workflowAllowlist`
 * （角色包字段，来源是 DIGITALHUMAN-COMPOSITION-MATRIX 的 Workflows 列）。
 */
export function checkWorkflowAllowlisted(
  roleId: string,
  workflowId: string,
  allowlists: Readonly<Record<string, readonly string[]>>,
): AllowlistDecision {
  if ((allowlists[roleId] ?? []).includes(workflowId)) return { ok: true };
  const handoffCandidates = Object.keys(allowlists)
    .filter((r) => r !== roleId && allowlists[r]!.includes(workflowId))
    .sort();
  return { ok: false, code: "workflow_not_allowlisted", requestedWorkflowId: workflowId, handoffCandidates };
}
