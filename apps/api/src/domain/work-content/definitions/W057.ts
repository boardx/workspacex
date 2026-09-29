/** W057 Question-to-Analysis —— 按 workflows/W057-question-to-analysis.md §5 阶段表。 */
import type { WorkContentWorkflowDefinition } from "../workflow-definition";

export const W057: WorkContentWorkflowDefinition = {
  id: "W057",
  key: "question-to-analysis",
  version: 1,
  title: "Question-to-Analysis",
  line: "research",
  skillVersions: { S157: "1.0.0", S160: "1.0.0", S158: "1.0.0", S161: "1.0.0", S164: "1.0.0", S172: "1.0.0" },
  stages: [
    { stageId: "explore", title: "数据探查", skills: ["S157"] },
    { stageId: "plan", title: "分析计划", skills: [] },
    { stageId: "query", title: "查询", skills: ["S160"] },
    { stageId: "validate", title: "数据校验", skills: ["S158"] },
    { stageId: "test", title: "统计检验", skills: ["S161"] },
    { stageId: "recompute", title: "复算", skills: ["S158"] },
    { stageId: "chart", title: "图表", skills: ["S164"] },
    { stageId: "story", title: "叙事", skills: ["S172"] },
    { stageId: "review", title: "审阅", skills: [] },
    { stageId: "publish", title: "发布", skills: [] },
    { stageId: "distribute", title: "分发", skills: [] },
  ],
  gates: [
    { gateId: "G1", stageId: "plan", requiresDualSign: false },
    { gateId: "G2", stageId: "review", requiresDualSign: false },
    { gateId: "G3", stageId: "distribute", requiresDualSign: true },
  ],
  effects: ["artifact.write", "notify.inapp", "mail.send"],
};
