/** W015 Weekly Pipeline Review（`workflows/W015-weekly-pipeline-review.md` §5）。 */
import type { WorkContentWorkflowModule } from "../../workflow-definition-module";
import { gate, stage } from "./stage-builder";

export const W015: WorkContentWorkflowModule = {
  workflowId: "W015",
  key: "weekly-pipeline-review",
  version: 1,
  title: "每周管道评审（Weekly Pipeline Review）",
  line: "sales",
  inputSchema: { type: "object", required: ["scope"], properties: { scope: { type: "object" }, distributeOwnerSections: { type: "boolean" } } },
  stages: [
    stage("scope_and_snapshot", "范围与快照（收窄时 G1 ask）", {
      caps: ["crm.read", "org.directory.read"],
      gate: { roles: ["sales_manager"], selfApproval: true },
    }),
    stage("hygiene", "管道卫生", { skills: ["S034"] }),
    stage("review", "周评审", { skills: ["S030"] }),
    stage("refresh_plans", "刷新成交计划（≤15 单）", { skills: ["S032"] }),
    stage("forecast_pre", "会前预测汇总", { skills: ["S031"], sideEffect: "none" }),
    stage("propose", "CRM 变更提议", { skills: ["S029"], caps: ["crm.read"] }),
    stage("meeting_review", "G2 会上评审", { sideEffect: "none", gate: { roles: ["sales_manager", "opportunity_owner"] } }),
    stage("write", "写入 CRM（P2 逐字段）", { caps: ["crm.write"], sideEffect: "external_send" }),
    stage("verify", "读回核实", { skills: ["S029"], caps: ["crm.read"] }),
    stage("forecast_post", "会后预测汇总", { skills: ["S031"], sideEffect: "none" }),
    stage("publish", "发布评审包（P3）", { caps: ["artifact.write"], sideEffect: "write" }),
    stage("distribute_owner_sections", "分发负责人分节（P4）", {
      caps: ["notify.inapp"],
      sideEffect: "external_send",
      gate: { roles: ["sales_manager"], selfApproval: true },
    }),
  ],
  gates: [gate("G1", "scope_and_snapshot"), gate("G2", "meeting_review"), gate("G3", "distribute_owner_sections")],
};
