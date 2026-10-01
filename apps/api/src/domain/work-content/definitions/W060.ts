/** W060 Research-to-Evidence —— 按 workflows/W060-research-to-evidence.md §5 阶段表。 */
import type { WorkContentWorkflowDefinition } from "../workflow-definition";

export const W060: WorkContentWorkflowDefinition = {
  id: "W060",
  key: "research-to-evidence",
  version: 1,
  title: "Research-to-Evidence",
  line: "research",
  skillVersions: { S170: "1.0.0", S003: "1.0.0", S171: "1.0.0", S169: "1.0.0", S063: "1.0.0", S172: "1.0.0" },
  stages: [
    { stageId: "plan", title: "研究计划", skills: ["S170"] },
    { stageId: "freeze", title: "冻结计划", skills: [] },
    { stageId: "search", title: "检索证据", skills: ["S003"] },
    { stageId: "appraise", title: "证据评审", skills: ["S171"] },
    { stageId: "gap_review", title: "缺口审阅", skills: ["S170"] },
    { stageId: "structure", title: "证据结构化", skills: ["S169"] },
    { stageId: "synthesize", title: "研究综合", skills: ["S063"] },
    { stageId: "readout", title: "证据解读", skills: ["S172"] },
    { stageId: "package", title: "证据包组装", skills: [] },
    { stageId: "publish_review", title: "发布审阅", skills: [] },
    { stageId: "publish", title: "发布", skills: [] },
  ],
  gates: [
    { gateId: "G1", stageId: "freeze", requiresDualSign: false },
    { gateId: "G2", stageId: "gap_review", requiresDualSign: false },
    { gateId: "G4", stageId: "publish_review", requiresDualSign: true },
  ],
  effects: ["artifact.write"],
};
