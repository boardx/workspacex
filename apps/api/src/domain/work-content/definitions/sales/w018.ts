/** W018 Account Expansion（`workflows/W018-account-expansion.md` §5；S021 ∥ S009 并行收集）。 */
import type { WorkContentWorkflowModule } from "../../workflow-definition-module";
import { gate, stage } from "./stage-builder";

export const W018: WorkContentWorkflowModule = {
  workflowId: "W018",
  key: "account-expansion",
  version: 1,
  title: "客户扩张（Account Expansion）",
  line: "sales",
  inputSchema: {
    type: "object",
    required: ["accountId"],
    properties: { accountId: { type: "string" }, asOf: { type: "string" }, recordInCrm: { type: "boolean" } },
  },
  stages: [
    stage("intake", "受理（P1）", { caps: ["crm.read"] }),
    stage("intel", "客户情报", {
      skills: ["S021"],
      caps: ["web.search", "web.fetch", "knowledge.search", "knowledge.read"],
      parallelGroup: "gathering",
    }),
    stage("dossier", "账户证据档案", { skills: ["S009"], parallelGroup: "gathering" }),
    stage("health_gate", "扩张健康门", { skills: ["S035"], caps: ["crm.read"] }),
    stage("plan", "扩张计划", { skills: ["S023"] }),
    stage("publish_plan", "发布计划（P6）", { caps: ["artifact.write"], sideEffect: "write" }),
    stage("play_selection", "H1 打法选择（P2）", { sideEffect: "none", gate: { roles: ["account_owner"], selfApproval: true } }),
    stage("propose", "扩张报价", { skills: ["S036"], caps: ["pricebook.read", "crm.read", "knowledge.read"] }),
    stage("approve", "H2 批准（按审批层级多签）", { sideEffect: "none", gate: { roles: ["sales_lead", "deal_desk"] } }),
    stage("record_crm", "记入 CRM（P3）", { caps: ["crm.write"], sideEffect: "write" }),
    stage("send", "H3 发送（P4 逐收件人）", {
      caps: ["mail.send", "notify.inapp"],
      sideEffect: "external_send",
      gate: { roles: ["sales_lead"] },
    }),
  ],
  gates: [gate("H1", "play_selection"), gate("H2", "approve", { dual: true }), gate("H3", "send")],
};
