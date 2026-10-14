import type { WorkflowDefinitionVersionInput } from "@repo/contracts/workflow-runtime";
import { PRODUCT_LINE_WORKFLOWS, toRuntimeDefinition } from "./product-workflow-definitions";

/** New immutable Skill versions include the independently authored method files. */
export const DISCOVERY_EXECUTION_SKILL_VERSION = "1.2.0";

/** V1 is immutable. V2 reviews committed output in a separate node, before any dependent work. */
export function discoveryExecutionDefinition(): WorkflowDefinitionVersionInput {
  const v1 = toRuntimeDefinition(PRODUCT_LINE_WORKFLOWS.find(def => def.workflowId === "W027")!);
  const stages = v1.stages.flatMap(stage => {
    if (!stage.humanGate || stage.stageId === "fieldwork") return [structuredClone(stage)];
    return [
      { ...structuredClone(stage), humanGate: null },
      { stageId: `review_${stage.stageId}`, title: `Review ${stage.title}`,
        skills: [], capabilityCategories: [], sideEffect: "none" as const,
        humanGate: structuredClone(stage.humanGate), maxAttempts: 1 },
    ];
  });
  return { ...v1, version: 2, graphRef: `${v1.key}:2`,
    stages: stages.map(stage => ({ ...stage, skills: stage.skills.map(ref => ({
      ...ref, versionRange: DISCOVERY_EXECUTION_SKILL_VERSION,
    })) })),
    inputSchema: {
      type: "object", required: ["intent", "decision"],
      properties: {
        intent: { type: "string", minLength: 20, maxLength: 2000, title: "产品探索方向" },
        decision: { type: "string", minLength: 10, maxLength: 300, title: "本轮要改变的决定" },
      },
    },
  };
}
