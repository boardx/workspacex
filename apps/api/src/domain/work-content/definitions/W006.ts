/** W006 Knowledge Capture Loop —— 按 workflows/W006-knowledge-capture-loop.md §5 阶段表（4a dedupe ∥ 4b followups）。 */
import type { WorkContentWorkflowDefinition } from "../workflow-definition";

export const W006: WorkContentWorkflowDefinition = {
  id: "W006",
  key: "knowledge-capture-loop",
  version: 1,
  title: "Knowledge Capture Loop",
  line: "research",
  skillVersions: { S016: "1.0.0", S063: "1.0.0", S003: "1.0.0", S017: "1.0.0" },
  stages: [
    { stageId: "collect", title: "枚举来源", skills: [] },
    { stageId: "capture", title: "知识捕获", skills: ["S016"] },
    { stageId: "synthesize", title: "批次综合", skills: ["S063"] },
    { stageId: "dedupe", title: "查重", skills: ["S003"] },
    { stageId: "followups", title: "待回答问题", skills: ["S017"] },
    { stageId: "assemble", title: "组装审阅", skills: [] },
    { stageId: "capture_review", title: "捕获审阅", skills: [] },
    { stageId: "stage", title: "暂存", skills: [] },
    { stageId: "project_promote", title: "提升到项目", skills: [] },
    { stageId: "personal_remember", title: "记入个人", skills: [] },
    { stageId: "org_promote", title: "提升到组织", skills: [] },
  ],
  gates: [
    { gateId: "G1", stageId: "capture_review", requiresDualSign: false },
    { gateId: "G2", stageId: "project_promote", requiresDualSign: false },
    { gateId: "G3", stageId: "org_promote", requiresDualSign: true },
  ],
  effects: ["notify.inapp", "knowledge.graph.write"],
};
