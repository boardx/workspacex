/** W012 Prospect-to-Meeting（`workflows/W012-prospect-to-meeting.md` §5；活动层 + lane 层）。 */
import type { WorkContentWorkflowModule } from "../../workflow-definition-module";
import { gate, stage } from "./stage-builder";

export const W012: WorkContentWorkflowModule = {
  workflowId: "W012",
  key: "prospect-to-meeting",
  version: 1,
  title: "潜客到会议（Prospect-to-Meeting）",
  line: "sales",
  inputSchema: {
    type: "object",
    required: ["icpRef", "orgContextRef"],
    properties: { icpRef: { type: "string" }, orgContextRef: { type: "string" }, maxLanes: { type: "integer" } },
  },
  stages: [
    stage("intake", "校验 ICP 与组织上下文", { caps: ["project.read"], layer: "campaign" }),
    stage("prospect", "潜客发现", {
      skills: ["S024"],
      caps: ["knowledge.search", "knowledge.read", "project.read", "web.search", "web.fetch"],
      layer: "campaign",
    }),
    stage("select_bind", "G1 选择并绑定联系人", { caps: ["crm.read"], gate: { roles: ["sales_rep"], selfApproval: true }, layer: "campaign" }),
    stage("research", "潜客研究", { skills: ["S021"], caps: ["knowledge.search", "knowledge.read", "web.search", "web.fetch"], layer: "lane" }),
    stage("draft", "外联序列起草", { skills: ["S026"], layer: "lane" }),
    stage("approve_step", "G2 逐步发送批准", { sideEffect: "none", gate: { roles: ["sales_rep"], selfApproval: true }, layer: "lane" }),
    stage("send_step", "发送外联（P3）", { caps: ["mail.send"], sideEffect: "external_send", layer: "lane" }),
    stage("wait_reply", "等待回复", { layer: "lane" }),
    stage("triage_reply", "G3 回复分诊", { sideEffect: "none", gate: { roles: ["sales_rep"], selfApproval: true }, layer: "lane" }),
    stage("schedule", "提议时段", { skills: ["S027"], caps: ["calendar.read"], layer: "lane" }),
    stage("invite", "G4 发送邀请（P4）", {
      skills: ["S027"],
      caps: ["calendar.write"],
      sideEffect: "external_send",
      gate: { roles: ["sales_rep"], selfApproval: true },
      layer: "lane",
    }),
    stage("confirm", "会议确认", { layer: "lane" }),
    stage("prep", "首次会议准备（P5）", { skills: ["S005"], layer: "lane" }),
  ],
  gates: [gate("G1", "select_bind"), gate("G2", "approve_step"), gate("G3", "triage_reply"), gate("G4", "invite")],
};
