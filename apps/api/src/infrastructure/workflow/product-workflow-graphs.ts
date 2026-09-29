/**
 * CT05 —— 产品线 Workflow（W027–W032 / W002）的代码图工厂（ADR-118 第 2 条：图本体在代码里）。
 *
 * 节点 = 实体文档 §5 阶段表的每一行，按声明顺序串联（与 Definition 元数据一一对应，发布校验由
 * `validateDefinitionForPublish` 判）。节点体只记录本阶段按实例冻结的 Skill 版本（pinnedSkills），
 * 不调用模型、不碰外部系统；逐 Skill 的执行接线属于内容线端到端 feature（CT06）。
 */
import type { StageWork } from "../../application/workflow/run-instance";
import {
  graphRefOf,
  PRODUCT_LINE_WORKFLOWS,
  type ContentWorkflowDefinition,
} from "../../domain/work-content/product-workflow-definitions";
import type { LinearWorkflowGraph } from "./workflow-graph-registry";

function stageWork(workflowId: string, stageId: string): StageWork {
  return async (exec) => ({
    label: `${workflowId}/${stageId}`,
    content: {
      workflowId,
      stageId,
      pinnedSkills: exec.pinnedSkills.filter((p) => p.stageId === stageId).map((p) => `${p.stableId}@${p.version}`),
    },
  });
}

export function contentWorkflowGraph(def: ContentWorkflowDefinition): LinearWorkflowGraph {
  return {
    graphRef: graphRefOf(def),
    stages: def.stages.map((s) => ({ stageId: s.stageId, work: stageWork(def.workflowId, s.stageId) })),
  };
}

export function productWorkflowGraphs(): LinearWorkflowGraph[] {
  return PRODUCT_LINE_WORKFLOWS.map(contentWorkflowGraph);
}
