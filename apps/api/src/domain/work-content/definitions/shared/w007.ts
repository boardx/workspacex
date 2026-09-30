/**
 * W007 Issue-to-Resolution（`workflows/W007-issue-to-resolution.md` §5）。
 *
 * 五道门（文档 H0–H4，门 id 沿用文档）：
 * - H0 分诊确认（条件必填：P1 / 低置信 / security / 重复集群确认）；
 * - H1 升级决定（flagged 时必填；批准人 = 工单负责人或其经理）；
 * - H2 回复批准（必填；S015 输出须先过其不变量再人审）；
 * - H3 解决确认（必填，记录 `confirmedBy`）；
 * - H4 知识库文章审阅（发布前必填）。
 * 「条件必填」是图工厂按策略决定是否开门，Definition 里门恒存在且 `autoApprove=false`（I-C10）。
 *
 * 写类阶段：apply_triage / escalate_decide / resolve / kb_review 为 `write`，send_reply 为 `external_send`。
 * 上传模式（`origin=uploaded`）启动时 `writeDisabled=true`：所有写/发阶段跳过，终态只到 `drafts_ready`（决策 9）。
 * 工单系统基线不存在：`ticket.read` / `ticket.write` / `tracker.write` / `kb.publish` 均 proposed-unwired，
 * 因此生产上唯一可用路径是上传模式（草稿）；写类分类在默认只读授权下一律 blocked_permission。
 */
import type { WorkContentWorkflowModule } from "../../workflow-definition-module";
import { gate, stage } from "../batch2/stage-builder";

export const W007: WorkContentWorkflowModule = {
  workflowId: "W007",
  key: "issue-to-resolution",
  version: 1,
  title: "问题到解决（Issue-to-Resolution）",
  line: "shared",
  inputSchema: {
    type: "object",
    required: ["origin", "policyRef"],
    properties: {
      origin: { type: "string", enum: ["ticket-system", "uploaded"] },
      ticketRef: { type: "object", properties: { systemRef: { type: "string" }, ticketId: { type: "string" } } },
      uploaded: {
        type: "object",
        properties: {
          subject: { type: "string", maxLength: 300 },
          body: { type: "string", maxLength: 20000 },
          receivedAt: { type: "string", format: "date-time" },
          requesterLabel: { type: "string", maxLength: 80 },
        },
      },
      accountRef: { type: "string" },
      audienceLevel: { type: "string", enum: ["customer", "org-internal", "analysis-team"] },
      policyRef: { type: "string" },
      jurisdiction: { type: "string", enum: ["CN", "US", "other"] },
    },
  },
  stages: [
    stage("intake", "准入（P1：工单可读性 + 并发键）", { caps: ["ticket.read"] }),
    stage("triage", "工单分诊（intake）", { skills: ["S187"], caps: ["ticket.read", "knowledge.search", "crm.read"] }),
    stage("confirm_triage", "H0 分诊确认（条件必填）", {
      sideEffect: "none",
      gate: { roles: ["ticket_owner", "support_lead"], selfApproval: true },
    }),
    stage("apply_triage", "回写分诊结果（P3）", { caps: ["ticket.write"], sideEffect: "write" }),
    stage("diagnose", "根因诊断（customer-issue）", { skills: ["S011"], caps: ["ticket.read", "deploy.read", "tracker.read", "knowledge.search"] }),
    stage("escalate_draft", "升级简报（support-escalation）", { skills: ["S189"], caps: ["ticket.read", "crm.read"] }),
    stage("escalate_decide", "H1 升级决定（flagged 时必填）", {
      caps: ["tracker.write", "ticket.write", "notify.inapp"],
      sideEffect: "write",
      gate: { roles: ["ticket_owner", "support_manager"], selfApproval: true },
    }),
    stage("reply_draft", "回复草稿", { skills: ["S015"] }),
    stage("approve_reply", "H2 回复批准", {
      sideEffect: "none",
      gate: { roles: ["ticket_owner", "support_lead"], selfApproval: true },
    }),
    stage("send_reply", "发送回复（P4 逐收件人核实）", { caps: ["ticket.write", "mail.send"], sideEffect: "external_send" }),
    stage("resolve", "H3 解决确认（记录 confirmedBy）", {
      caps: ["ticket.write"],
      sideEffect: "write",
      gate: { roles: ["ticket_owner"], selfApproval: true },
    }),
    stage("kb_draft", "知识库文章草稿（from-resolution）", { skills: ["S190"], caps: ["knowledge.search"] }),
    stage("kb_review", "H4 知识库文章审阅（发布前必填）", {
      caps: ["artifact.write", "kb.publish"],
      sideEffect: "write",
      gate: { roles: ["kb_owner", "support_lead"], selfApproval: true },
    }),
  ],
  gates: [
    gate("H0", "confirm_triage"),
    gate("H1", "escalate_decide"),
    gate("H2", "approve_reply", { binds: ["replyDraftDigest"] }),
    gate("H3", "resolve"),
    gate("H4", "kb_review"),
  ],
  constraints: {
    /** 决策 9：origin=uploaded 时这些阶段一律跳过（只产草稿，永不写、永不发）。 */
    uploadedOriginDisabledStages: ["apply_triage", "escalate_decide", "send_reply", "resolve", "kb_review"],
    /** 不支持 schedule 触发：无人值守不得回复客户（§4）。 */
    triggerKinds: ["manual", "webhook"],
  },
};
