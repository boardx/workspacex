/** W016 Forecast Review（`workflows/W016-forecast-review.md` §5）。 */
import type { WorkContentWorkflowModule } from "../../workflow-definition-module";
import { gate, stage } from "./stage-builder";

export const W016: WorkContentWorkflowModule = {
  workflowId: "W016",
  key: "forecast-review",
  version: 1,
  title: "预测评审（Forecast Review）",
  line: "sales",
  inputSchema: { type: "object", required: ["scope", "period"], properties: { scope: { type: "object" }, period: { type: "string" } } },
  stages: [
    stage("scope", "范围核实与口径加载", { caps: ["org.directory.read", "crm.read"] }),
    stage("snapshot", "冻结快照（P1）", { caps: ["crm.read", "contract.read", "support.ticket.read"] }),
    stage("rollup", "预测汇总", { skills: ["S031"], sideEffect: "none" }),
    stage("challenge", "预测挑战", { skills: ["S030"], sideEffect: "none" }),
    stage("health", "客户健康", { skills: ["S035"], caps: ["crm.read"] }),
    stage("renewal_overlay", "续约叠加", { skills: ["S033"], sideEffect: "none" }),
    stage("risk", "预测风险", { skills: ["S010"], sideEffect: "none" }),
    stage("assemble", "生成评审包", { caps: ["artifact.write"], sideEffect: "write" }),
    stage("review", "G1 评审", { sideEffect: "none", gate: { roles: ["forecast_submitter"], selfApproval: true } }),
    stage("request_changes", "类别变更任务（P2）", { caps: ["task.create"], sideEffect: "write" }),
    stage("submit", "G2 提交预测（P3；org 范围双签）", {
      caps: ["forecast.submission.write", "forecast.submit"],
      sideEffect: "external_send",
      gate: { roles: ["forecast_submitter", "forecast_second_signer"], selfApproval: true },
    }),
    stage("notify", "通知（P4）", { caps: ["notify.inapp"], sideEffect: "write" }),
  ],
  gates: [gate("G1", "review"), gate("G2", "submit", { dual: true })],
};
