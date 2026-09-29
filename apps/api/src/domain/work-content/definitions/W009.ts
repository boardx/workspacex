/** W009 Evidence-to-Recommendation —— 按 workflows/W009-evidence-to-recommendation.md §5 阶段表。 */
import type { WorkContentWorkflowDefinition } from "../workflow-definition";

export const W009: WorkContentWorkflowDefinition = {
  id: "W009",
  key: "evidence-to-recommendation",
  version: 1,
  title: "Evidence-to-Recommendation",
  line: "research",
  skillVersions: { S003: "1.0.0", S171: "1.0.0", S063: "1.0.0", S012: "1.0.0", S010: "1.0.0" },
  stages: [
    { stageId: "admit", title: "准入", skills: [] },
    { stageId: "frame", title: "框定方案与准则", skills: [] },
    { stageId: "search", title: "检索证据", skills: ["S003"] },
    { stageId: "appraise", title: "证据评审", skills: ["S171"] },
    { stageId: "synthesize", title: "研究综合", skills: ["S063"] },
    { stageId: "brief_provisional", title: "临时决策简报", skills: ["S012"] },
    { stageId: "risk", title: "方案风险", skills: ["S010"] },
    { stageId: "brief_final", title: "最终决策简报", skills: ["S012"] },
    { stageId: "basis_check", title: "依据校验", skills: [] },
    { stageId: "choose", title: "决定人选择", skills: [] },
    { stageId: "override_rationale", title: "推翻理由", skills: [] },
    { stageId: "record", title: "记录决定", skills: [] },
    { stageId: "distribute", title: "分发", skills: [] },
  ],
  gates: [
    { gateId: "G1", stageId: "frame", requiresDualSign: false },
    { gateId: "G2", stageId: "choose", requiresDualSign: false },
    { gateId: "G3", stageId: "distribute", requiresDualSign: false },
  ],
  effects: ["decision.record.write", "notify.inapp", "mail.send"],
};
