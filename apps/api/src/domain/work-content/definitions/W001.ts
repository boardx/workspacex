/** W001 Research-to-Brief —— 按 requirements/work-stack-v2/workflows/W001-research-to-brief.md §5 阶段表。 */
import type { WorkContentWorkflowDefinition } from "../workflow-definition";

export const W001: WorkContentWorkflowDefinition = {
  id: "W001",
  key: "research-to-brief",
  version: 1,
  title: "Research-to-Brief",
  line: "research",
  skillVersions: { S003: "1.0.0", S063: "1.0.0", S171: "1.0.0", S010: "1.0.0", S020: "1.0.0" },
  stages: [
    { stageId: "scope", title: "范围与用途", skills: [] },
    { stageId: "search", title: "检索证据", skills: ["S003"] },
    { stageId: "synthesize", title: "研究综合", skills: ["S063"] },
    { stageId: "audit", title: "证据评审", skills: ["S171"] },
    { stageId: "risk", title: "风险评估", skills: ["S010"] },
    { stageId: "draft", title: "起草简报", skills: ["S020"] },
    { stageId: "citation_check", title: "引用校验", skills: [] },
    { stageId: "review_brief", title: "简报审阅", skills: [] },
    { stageId: "publish", title: "发布", skills: [] },
    { stageId: "distribute", title: "分发", skills: [] },
  ],
  gates: [
    { gateId: "G1", stageId: "scope", requiresDualSign: false },
    { gateId: "G2", stageId: "review_brief", requiresDualSign: false },
    // tier ∈ {board, regulator, external_partner} 时双签（D002 文档第 82 行）
    { gateId: "G3", stageId: "distribute", requiresDualSign: true },
  ],
  effects: ["artifact.write", "notify.inapp", "mail.send"],
};
