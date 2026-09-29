/** W011 Lead-to-Qualified（`requirements/work-stack-v2/workflows/W011-lead-to-qualified.md` §5）。 */
import type { WorkContentWorkflowModule } from "../../workflow-definition-module";
import { gate, stage } from "./stage-builder";

/** S021 逐公司扇出的并发上限（W011 §4：批内对 S021 以并发 5 扇出）。 */
export const W011_ENRICH_CONCURRENCY = 5;

export const W011: WorkContentWorkflowModule = {
  workflowId: "W011",
  key: "lead-to-qualified",
  version: 1,
  title: "线索到合格（Lead-to-Qualified）",
  line: "sales",
  inputSchema: {
    type: "object",
    required: ["leadSourceRef", "icpRef", "triageConfigRef"],
    properties: {
      leadSourceRef: { type: "string" },
      icpRef: { type: "string" },
      triageConfigRef: { type: "string" },
      batchKey: { type: "string" },
      batchPart: { type: "string" },
    },
  },
  stages: [
    stage("admit", "准入（P1：以发起人身份读 3 个 ref）", { caps: ["knowledge.read"] }),
    stage("intake", "线索受理", { skills: ["S024"], caps: ["knowledge.read", "project.read"] }),
    stage("enrich", "逐公司扩充", {
      skills: ["S021"],
      caps: ["web.search", "web.fetch", "knowledge.search", "knowledge.read"],
      fanOutConcurrency: W011_ENRICH_CONCURRENCY,
    }),
    stage("tier", "客户分层", { skills: ["S022"] }),
    stage("triage", "线索分诊", { skills: ["S025"] }),
    stage("hygiene", "数据卫生", { skills: ["S034"] }),
    stage("review", "G1 线索决定卡（逐条；P2 重查审批资格）", {
      sideEffect: "none",
      gate: { roles: ["sales_queue_manager", "revops"], selfApproval: true },
    }),
    stage("write_back", "写回 CRM（P3 逐条重查写权限 + 乐观并发）", { caps: ["crm.write"], sideEffect: "write" }),
    stage("notify", "通知（P4 核实收件人读权限）", { caps: ["notify.inapp"], sideEffect: "write" }),
  ],
  gates: [gate("G1", "review")],
};
