/**
 * W003 Decision-to-Execution（`requirements/work-stack-v2/workflows/W003-decision-to-execution.md` §5）。
 *
 * 两个运行模式共用一份 Definition（矩阵第 9 行只有一个 W003）：
 * - `plan_and_materialize`：intake → brief → decide(H1) → plan → risk → approve_plan(H2) → materialize_preview →
 *   approve_cards(H3) → write_cards → notify；
 * - `follow_through`：intake → decision_check → report → publish_report（按周的短实例，决策 4）。
 * 阶段顺序 = 文档 §5 表（主模式在前，F1–F3 在后）；模式划分见 `constraints`。**已知缺口**：线性图运行时没有「按 mode 选入口」
 * 的分支能力，所以本 Definition 只进目录/白名单/授权清单，不作为内置 Definition 发布（见 batch2 注册测试的护栏）。
 *
 * 门（审批角色为本定义的语义角色，组织侧把成员映射到这些角色；`workflow_initiator` 不在其中）：
 * - H1 选定方案：决定人；选定值只取自已解决的 `choose_execution_option` 中断；
 * - H2 计划确认：决定人或其委托的项目负责人；`allowSelfApproval=false`（E4：D001 不得自批）；
 * - H3 建卡确认：项目管理侧；与 H2 分开（决策 2）。
 */
import type { WorkContentWorkflowModule } from "../../workflow-definition-module";
import { gate, stage } from "../batch2/stage-builder";

export const W003: WorkContentWorkflowModule = {
  workflowId: "W003",
  key: "decision-to-execution",
  version: 1,
  title: "决策到执行（Decision-to-Execution）",
  line: "shared",
  inputSchema: {
    type: "object",
    required: ["mode", "projectId", "decisionOwnerUserId"],
    properties: {
      mode: { type: "string", enum: ["plan_and_materialize", "follow_through"] },
      projectId: { type: "string" },
      decisionOwnerUserId: { type: "string" },
      decisionMakerKind: { type: "string", enum: ["individual", "governance_body"] },
      entry: { type: "string", enum: ["from_question", "from_brief", "from_adopted_decision"] },
      question: { type: "string", maxLength: 2000 },
      decisionBriefId: { type: "string" },
      adoptedDecisionRef: { type: "object" },
      decisionRef: { type: "string" },
      planInstanceRef: { type: "string" },
      audienceSensitivity: { type: "string", enum: ["team", "project", "org"] },
      cadenceDays: { type: "integer", minimum: 7, maximum: 31 },
    },
  },
  stages: [
    stage("intake", "准入（P1：发起人读权限 + 决定人核验）", { caps: ["project.read", "knowledge.graph.read"] }),
    stage("brief", "决策简报（framing-first）", { skills: ["S012"], caps: ["knowledge.search", "knowledge.read"] }),
    stage("decide", "H1 选定方案并采纳落库（P2）", {
      caps: ["knowledge.graph.write"],
      sideEffect: "write",
      gate: { roles: ["decision_owner"], selfApproval: true },
    }),
    stage("plan", "执行计划（decision-to-plan）", { skills: ["S154"], caps: ["board.read"] }),
    stage("risk", "执行风险评估（对计划）", { skills: ["S010"] }),
    stage("approve_plan", "H2 计划确认（风险认领）", {
      sideEffect: "none",
      gate: { roles: ["decision_owner", "project_lead"] },
    }),
    stage("materialize_preview", "建卡预览（与看板现有卡对照）", { skills: ["S142"], caps: ["board.read"] }),
    stage("approve_cards", "H3 建卡确认（逐条或整批）", {
      sideEffect: "none",
      gate: { roles: ["project_lead", "project_manager"] },
    }),
    stage("write_cards", "写入看板卡片（P3 逐卡重查 + 逐卡 receipt）", { caps: ["board.write"], sideEffect: "write" }),
    stage("notify", "通知（执行启动）", { caps: ["notify.inapp"], sideEffect: "write" }),
    stage("decision_check", "决定仍有效复核（P5，follow_through）", { caps: ["knowledge.graph.read"] }),
    stage("report", "决策执行回报（decision-follow-through）", { skills: ["S143"], caps: ["board.read"] }),
    stage("publish_report", "发布回报", { caps: ["artifact.write", "notify.inapp"], sideEffect: "write" }),
  ],
  gates: [
    gate("H1", "decide", { binds: ["selectedOptionId", "decisionRef"] }),
    gate("H2", "approve_plan", { binds: ["planId", "planVersion", "inputsDigest"] }),
    gate("H3", "approve_cards", { binds: ["changeSetDigest"] }),
  ],
  constraints: {
    planAndMaterializeStages: [
      "intake", "brief", "decide", "plan", "risk", "approve_plan", "materialize_preview", "approve_cards", "write_cards", "notify",
    ],
    followThroughStages: ["intake", "decision_check", "report", "publish_report"],
    /** 并发键：同一决定同时只有一个 plan_and_materialize 实例（决策 7）。 */
    concurrencyKey: ["orgId", "decisionRef"],
    /** 无人值守只允许 follow_through（plan_and_materialize 的 schedule 触发被禁，§4）。 */
    scheduleAllowedModes: ["follow_through"],
  },
};
