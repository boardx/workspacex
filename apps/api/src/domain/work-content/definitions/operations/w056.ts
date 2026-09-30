/**
 * W056 Incident-to-Postmortem（`workflows/W056-incident-to-postmortem.md` §5）。
 *
 * 两个运行模式共用一份 Definition（矩阵第 62 行一个 W056）：
 * - 状态机 A `postmortem`（A1–A10）：intake → timeline → confirm_facts(H1) → diagnose → document → review_assign(H2) →
 *   materialize_actions → baseline_report → capture → publish；
 * - 状态机 B `follow_through`（B1–B4）：followup_intake → action_check → report → publish_report。
 * B1 与 A1 同名（intake）⇒ B 侧改名 `followup_intake`；B3/B4 的 report / publish_report 与 A 侧的 baseline_report / publish 不重名，沿用文档。
 * **行动项建卡 vs S142 去重**：矩阵 W056 行没有 S142（文档 A7：「平台：为已认领行动项建卡；无 S142」），所以 `materialize_actions`
 * 不带 Skill pin，只经 `board.write` 逐卡 receipt 写入；卡与看板现有卡的去重对照**不在本 Workflow 内**（基线 `POST /tasks`
 * 无幂等键，恢复时按运行账本 taskId + 标题/owner 查重，不盲重写）。若产品要求去重，需先改矩阵加 S142（文档 §15 提议），
 * 不能在这里偷加 pin（skillPins = 矩阵行，由测试核对）。
 * H2 需要 IC + 工程负责人（`counselDirected` 时加律师）——多人联署 ⇒ `requiresDualSign=true`。
 * `counselDirected=true` 的复盘只发受限工作区 + 指定名单（发布阶段图工厂决定，不靠 Definition）。
 */
import type { WorkContentWorkflowModule } from "../../workflow-definition-module";
import { gate, stage } from "../batch2/stage-builder";

const SOURCE_READ = ["incident.read", "monitoring.read", "deploy.read", "chat.search", "ticket.read"];

export const W056: WorkContentWorkflowModule = {
  workflowId: "W056",
  key: "incident-to-postmortem",
  version: 1,
  title: "事件到复盘（Incident-to-Postmortem）",
  line: "operations",
  inputSchema: {
    type: "object",
    required: ["mode", "incidentCommander", "policyRef"],
    properties: {
      mode: { type: "string", enum: ["postmortem", "follow_through"] },
      incident: {
        type: "object",
        properties: {
          incidentRef: { type: "string" },
          systemRef: { type: "string" },
          title: { type: "string", maxLength: 200 },
          incidentState: { type: "string", enum: ["mitigated", "monitoring", "resolved"] },
          declaredSeverity: { type: "object" },
          startedAtHint: { type: "string", format: "date-time" },
        },
      },
      sources: { type: "array", maxItems: 80, items: { type: "object" } },
      incidentCommander: { type: "object", properties: { userId: { type: "string" } } },
      audienceLevel: { type: "string", enum: ["org-internal", "analysis-team"] },
      counselDirected: { type: "boolean" },
      actionSetRef: { type: "string" },
      policyRef: { type: "string" },
      jurisdiction: { type: "string", enum: ["CN", "US", "other"] },
    },
  },
  stages: [
    // ── 状态机 A：postmortem ──
    stage("intake", "准入（P1：IC 与严重度核验 + 来源可读性）", { caps: SOURCE_READ }),
    stage("timeline", "事件时间线重建（timeline-rebuild）", { skills: ["S177"], caps: SOURCE_READ }),
    stage("confirm_facts", "H1 事实确认（宣布严重度）", {
      sideEffect: "none",
      gate: { roles: ["incident_commander"], selfApproval: true },
    }),
    stage("diagnose", "事件根因（incident）", { skills: ["S011"] }),
    stage("document", "复盘文档（postmortem）", { skills: ["S179"], caps: ["docs.read"] }),
    stage("review_assign", "H2 复盘审阅并认领行动项", {
      sideEffect: "none",
      gate: { roles: ["incident_commander", "engineering_lead", "legal_counsel"], selfApproval: true },
    }),
    stage("materialize_actions", "为已认领行动项建卡（P3 逐卡 receipt；无 S142）", { caps: ["board.write", "artifact.write"], sideEffect: "write" }),
    stage("baseline_report", "行动项基线报告（action-tracking）", { skills: ["S143"], caps: ["board.read"] }),
    stage("capture", "复盘知识待确认捕获（ad-hoc）", { skills: ["S016"], caps: ["knowledge.search"] }),
    stage("publish", "发布复盘（P4；counselDirected 时仅受限工作区）", { caps: ["artifact.write", "notify.inapp"], sideEffect: "write" }),
    // ── 状态机 B：follow_through ──
    stage("followup_intake", "准入（P1：actionSetRef 属同组织）", { caps: ["artifact.read"] }),
    stage("action_check", "行动项当前状态核对（P5）", { caps: ["board.read"] }),
    stage("report", "行动项跟踪回报（action-tracking）", { skills: ["S143"], caps: ["board.read"] }),
    stage("publish_report", "发布行动项回报（逾期项升级提醒批准人）", { caps: ["artifact.write", "notify.inapp"], sideEffect: "write" }),
  ],
  gates: [
    gate("H1", "confirm_facts", { binds: ["factBaseForRca", "declaredSeverity"] }),
    gate("H2", "review_assign", { dual: true, binds: ["postmortemVersion", "actionSetVersion"] }),
  ],
  constraints: {
    postmortemStages: [
      "intake", "timeline", "confirm_facts", "diagnose", "document", "review_assign", "materialize_actions", "baseline_report", "capture", "publish",
    ],
    followThroughStages: ["followup_intake", "action_check", "report", "publish_report"],
    renamedFromDoc: ["B1:intake=followup_intake"],
    /** follow_through 只能 schedule/manual；postmortem 不允许 schedule。 */
    scheduleAllowedModes: ["follow_through"],
    /** 行动项建卡不走 S142（矩阵无此边）：materialize_actions 不得挂 Skill。 */
    stagesWithoutSkill: ["materialize_actions"],
  },
};
