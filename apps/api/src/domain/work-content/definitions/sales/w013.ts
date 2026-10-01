/**
 * W013 Meeting-to-Opportunity（`workflows/W013-meeting-to-opportunity.md` §5）。
 *
 * 决策 5：G1 一次展示 S028 记录 + S023 三选一 + S029 变更集，批准绑定
 * `(recordDigest, framingDecision, changeSetDigest)`；事件触发永远停在 G1（I-C10）。
 * 新商机只写五个字段（与契约 `NewOpportunityPayload` 同形），`amount/closeDate/stage` 进 `deferredProposals[]`。
 * 跟进邮件经独立 G2 + `mail.send`，收件人只由服务端解析（I-C14）。
 */
import { DeferredProposal, NewOpportunityPayload } from "@repo/contracts/work-content";
import type { WorkContentWorkflowModule } from "../../workflow-definition-module";
import { gate, stage } from "./stage-builder";

export const W013_G1_BINDS = ["recordDigest", "framingDecision", "changeSetDigest"] as const;
export const W013_DEFERRED_FIELDS: readonly string[] = DeferredProposal.shape.field.options;
export const W013_TRIGGER_EVENTS = ["recording_completed", "calendar_event_ended"] as const;

export const W013: WorkContentWorkflowModule = {
  workflowId: "W013",
  key: "meeting-to-opportunity",
  version: 1,
  title: "会议到商机（Meeting-to-Opportunity）",
  line: "sales",
  inputSchema: {
    type: "object",
    required: ["meetingRef"],
    properties: {
      meetingRef: { type: "string" },
      accountId: { type: "string" },
      opportunityId: { type: "string" },
      triggerEvent: { type: "string", enum: [...W013_TRIGGER_EVENTS] },
    },
  },
  stages: [
    stage("intake_resolve", "解析账户/商机/联系人", { caps: ["crm.read"] }),
    stage("prep", "会前准备", { skills: ["S005"], caps: ["knowledge.search", "knowledge.read", "project.read"] }),
    stage("await_material", "G0 等待会议材料（录音同意确认）", {
      caps: ["recording.read", "knowledge.read"],
      gate: { roles: ["sales_rep"], selfApproval: true },
    }),
    stage("summarize", "会议记录", { skills: ["S028"], caps: ["knowledge.read", "recording.read"] }),
    stage("account_evidence", "账户证据", { skills: ["S009"], caps: ["knowledge.read"] }),
    stage("frame", "商机三选一", { skills: ["S023"] }),
    stage("plan_update", "CRM 变更集", { skills: ["S029"], caps: ["crm.read"] }),
    stage("review", "G1 三联决定（记录 / 三选一 / 变更集）", {
      sideEffect: "none",
      gate: { roles: ["opportunity_owner"], selfApproval: true },
    }),
    stage("apply", "写入 CRM（P3 逐次）", { caps: ["crm.write"], sideEffect: "write" }),
    stage("verify_update", "读回核实", { skills: ["S029"], caps: ["crm.read"] }),
    stage("approve_followup", "G2 跟进邮件确认（收件人服务端解析）", {
      sideEffect: "none",
      gate: { roles: ["opportunity_owner"], selfApproval: true },
    }),
    stage("send_followup", "发送跟进邮件（P4）", { caps: ["mail.send"], sideEffect: "external_send" }),
  ],
  gates: [gate("G0", "await_material"), gate("G1", "review", { binds: W013_G1_BINDS }), gate("G2", "approve_followup")],
  constraints: {
    newOpportunityFields: Object.keys(NewOpportunityPayload.shape),
    deferredProposalFields: W013_DEFERRED_FIELDS,
    followupRecipientSources: ["calendar_external_attendees", "opportunity_contacts"],
  },
};
