/**
 * Phase 20 CT02 —— 内容线 Workflow 注册到 runtime 图工厂（UC-WC-I3，I-C4）。
 *
 * 先按目录校验每个 Workflow 的 skillPins；只有 available 的 Workflow 才生成图并进注册表，
 * unavailable 的只出现在目录（带 unresolvedPins），不影响其它 Workflow。
 * 阶段体此处只落「阶段 + 固定 Skill 版本」指针产出；Skill 执行接线属于后续内容线 feature。
 */
import {
  graphRefOf,
  resolveWorkflowCatalog,
  skillPinsOf,
  type SkillPinLookup,
  type WorkContentWorkflowDefinition,
} from "../../domain/work-content/workflow-definition";
import type { LinearWorkflowGraph } from "./workflow-graph-registry";

export function toLinearGraph(def: WorkContentWorkflowDefinition): LinearWorkflowGraph {
  const versions = new Map(skillPinsOf(def).map((p) => [p.skillId, p.semanticVersion]));
  return {
    graphRef: graphRefOf(def),
    stages: def.stages.map((s) => ({
      stageId: s.stageId,
      work: async () => ({
        label: s.title,
        content: { workflowId: def.id, stageId: s.stageId, skills: s.skills.map((id) => ({ skillId: id, semanticVersion: versions.get(id) })) },
      }),
    })),
  };
}

export function registerWorkContentWorkflows(defs: readonly WorkContentWorkflowDefinition[], lookup: SkillPinLookup) {
  const catalog = resolveWorkflowCatalog(defs, lookup);
  const available = new Set(catalog.filter((c) => c.availability === "available").map((c) => c.workflowId));
  const graphs = defs.filter((d) => available.has(d.id)).map(toLinearGraph);
  return { catalog, graphs };
}
