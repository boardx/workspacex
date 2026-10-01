/**
 * Workflow Definition 版本的领域规则（WF01；ADR-118 第 1/2/5 条；契约束 workflow-runtime domain.md I-2/I-3/I-4/I-5）。
 *
 * 纯函数、无 IO：发布校验（图工厂已注册、阶段与图节点一一对应、Skill 引用可解析）与
 * 启动时的版本冻结（definition 版本 + 每个 Skill 版本）。
 */
import type {
  PinnedSkillVersion,
  WorkflowDefinitionVersionInput,
  WorkflowDefinitionVersionView,
} from "@repo/contracts/workflow-runtime";

/** 代码图工厂注册表的只读视图（ADR-118 第 2 条：图本体在代码里）。 */
export interface WorkflowGraphCatalog {
  /** 返回 `key:version` 对应图的节点 id；未注册返回 null。 */
  nodeIdsOf(graphRef: string): readonly string[] | null;
}

export type DefinitionValidationIssue =
  | { kind: "graph_not_registered"; graphRef: string }
  | { kind: "stage_without_node"; stageId: string }
  | { kind: "node_without_stage"; nodeId: string }
  | { kind: "skill_unresolved"; stageId: string; stableId: string; versionRange: string };

/** 解析 (stableId, versionRange) → 已发布 Skill 版本；不可解析返回 null。 */
export type SkillRefResolver = (stableId: string, versionRange: string) => string | null;

export function validateDefinitionForPublish(
  input: WorkflowDefinitionVersionInput,
  graphs: WorkflowGraphCatalog,
  resolveSkill: SkillRefResolver,
): DefinitionValidationIssue[] {
  const issues: DefinitionValidationIssue[] = [];
  const nodes = graphs.nodeIdsOf(input.graphRef);
  if (nodes === null) {
    issues.push({ kind: "graph_not_registered", graphRef: input.graphRef });
  } else {
    const stageIds = new Set(input.stages.map((s) => s.stageId));
    const nodeIds = new Set(nodes);
    for (const id of stageIds) if (!nodeIds.has(id)) issues.push({ kind: "stage_without_node", stageId: id });
    for (const id of nodeIds) if (!stageIds.has(id)) issues.push({ kind: "node_without_stage", nodeId: id });
  }
  for (const stage of input.stages) {
    for (const ref of stage.skills) {
      if (resolveSkill(ref.stableId, ref.versionRange) === null) {
        issues.push({ kind: "skill_unresolved", stageId: stage.stageId, stableId: ref.stableId, versionRange: ref.versionRange });
      }
    }
  }
  return issues;
}

export type PinResult =
  | { ok: true; pinnedSkills: readonly PinnedSkillVersion[] }
  | { ok: false; missingSkills: string[] };

/** I-5：冻结版本定义中每个 stages[*].skills[*] 为一个具体已发布版本。 */
export function pinSkillVersions(definition: WorkflowDefinitionVersionView, resolveSkill: SkillRefResolver): PinResult {
  const pinned: PinnedSkillVersion[] = [];
  const missing: string[] = [];
  for (const stage of definition.stages) {
    for (const ref of stage.skills) {
      const version = resolveSkill(ref.stableId, ref.versionRange);
      if (version === null) missing.push(`${ref.stableId}@${ref.versionRange}`);
      else pinned.push({ stageId: stage.stageId, stableId: ref.stableId, version });
    }
  }
  if (missing.length > 0) return { ok: false, missingSkills: missing };
  return { ok: true, pinnedSkills: Object.freeze(pinned.map((p) => Object.freeze({ ...p }))) };
}

/** I-2：published 版本的实质内容不可变——同 key:version 再发布只允许完全相同的内容。 */
export function sameDefinitionContent(a: WorkflowDefinitionVersionInput, b: WorkflowDefinitionVersionInput): boolean {
  return stableJson(pickContent(a)) === stableJson(pickContent(b));
}

function pickContent(d: WorkflowDefinitionVersionInput) {
  return { key: d.key, version: d.version, graphRef: d.graphRef, title: d.title, inputSchema: d.inputSchema, stages: d.stages };
}

function stableJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableJson).join(",")}]`;
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableJson(o[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(v);
}

export function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const v of Object.values(value as Record<string, unknown>)) deepFreeze(v);
  }
  return value;
}
