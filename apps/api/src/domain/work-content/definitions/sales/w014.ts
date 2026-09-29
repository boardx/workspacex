/** W014 Opportunity-to-Close（`workflows/W014-opportunity-to-close.md` §5；三通道门卡）。 */
import type { WorkContentWorkflowModule } from "../../workflow-definition-module";
import { gate, stage } from "./stage-builder";

export const W014: WorkContentWorkflowModule = {
  workflowId: "W014",
  key: "opportunity-to-close",
  version: 1,
  title: "商机到成交（Opportunity-to-Close）",
  line: "sales",
  inputSchema: { type: "object", required: ["opportunityId"], properties: { opportunityId: { type: "string" } } },
  stages: [
    stage("admit", "准入（P1）", { caps: ["crm.read", "knowledge.read", "file.read"] }),
    stage("context", "商机上下文", { skills: ["S023"], caps: ["knowledge.read"] }),
    stage("plan", "成交计划", { skills: ["S032"] }),
    stage("propose", "报价方案", { skills: ["S036"], caps: ["pricebook.read"] }),
    stage("risk", "风险评估", { skills: ["S010"] }),
    stage("change_plan", "CRM 变更集", { skills: ["S029"], caps: ["crm.read"] }),
    stage("gates", "G1-crm / G1-price 门卡", { sideEffect: "none", gate: { roles: ["opportunity_owner", "sales_manager"] } }),
    stage("write", "写入 CRM（P3 逐字段）", { caps: ["crm.write"], sideEffect: "write" }),
    stage("verify", "读回核实", { skills: ["S029"], caps: ["crm.read"] }),
    stage("impact", "预测影响（P5 self）", { skills: ["S031"] }),
    stage("release", "G1-release 发布方案（P4 逐收件人）", {
      caps: ["mail.send"],
      sideEffect: "external_send",
      gate: { roles: ["opportunity_owner"], selfApproval: true },
    }),
    stage("notify", "通知", { caps: ["notify.inapp"], sideEffect: "write" }),
  ],
  gates: [gate("G1-crm", "gates"), gate("G1-price", "gates"), gate("G1-release", "release")],
};
