/**
 * W055 Process Improvement（`workflows/W055-process-improvement.md` §5）。
 *
 * 两个运行模式共用一份 Definition（矩阵第 61 行一个 W055）：
 * - 状态机 A `diagnose_and_plan`（文档 A1–A9）：intake → map → validate_map(H1) → diagnose → screen(H2) → plan → metrics →
 *   approve_plan(H3) → publish；
 * - 状态机 B `pilot_review`（文档 B1–B7）：pilot_intake → review → metrics_check → decide(H4) → sop → approve_sop(H5) → pilot_publish。
 * 文档里 B1/B7 与 A1/A9 同名（intake / publish）；stageId 在一份 Definition 内必须唯一，所以 B 侧改名为
 * `pilot_intake` / `pilot_publish`，其余阶段名沿用文档。**已知缺口**：线性图运行时没有按 mode 选入口的分支，
 * 且 S019（SOP Authoring）尚无 starter-pack ⇒ W055 注册为 unavailable（`workflow_skill_pin_unresolved`）；
 * 二者都补齐前不作为内置 Definition 发布。`docs.publish`（受控文档库）在 W055 里只登记不执行（文档 B7）。
 */
import type { WorkContentWorkflowModule } from "../../workflow-definition-module";
import { gate, stage } from "../batch2/stage-builder";

const EVIDENCE_READ = ["docs.read", "knowledge.search", "transcript.read", "ticket.read"];

export const W055: WorkContentWorkflowModule = {
  workflowId: "W055",
  key: "process-improvement",
  version: 1,
  title: "流程改进（Process Improvement）",
  line: "operations",
  inputSchema: {
    type: "object",
    required: ["mode", "processKey", "processName", "processOwnerRole", "policyRef"],
    properties: {
      mode: { type: "string", enum: ["diagnose_and_plan", "pilot_review"] },
      processKey: { type: "string" },
      processName: { type: "string", maxLength: 200 },
      trigger: {
        type: "object",
        properties: {
          reason: { type: "string", enum: ["complaint", "metric-deviation", "audit-finding", "periodic-review", "owner-request"] },
          problemStatement: { type: "string", maxLength: 1500 },
        },
      },
      processOwnerRole: { type: "string" },
      lens: { type: "string", enum: ["general", "lean", "quality"] },
      audienceLevel: { type: "string", enum: ["org-internal", "analysis-team"] },
      evidence: { type: "array", maxItems: 60, items: { type: "object" } },
      planInstanceRef: { type: "string" },
      pilotResults: { type: "array", items: { type: "object" } },
      policyRef: { type: "string" },
      jurisdiction: { type: "string", enum: ["CN", "US", "other"] },
    },
  },
  stages: [
    // ── 状态机 A：diagnose_and_plan ──
    stage("intake", "准入（P1：并发键 + 流程负责人核验 + 证据可读性）", { caps: EVIDENCE_READ }),
    stage("map", "现状流程还原（as-is）", { skills: ["S018"], caps: EVIDENCE_READ }),
    stage("validate_map", "H1 流程图确认（可授予 analysis-team 受众）", {
      sideEffect: "none",
      gate: { roles: ["process_owner"], selfApproval: true },
    }),
    stage("diagnose", "流程偏差根因（process-deviation）", { skills: ["S011"] }),
    stage("screen", "H2 候选对策筛选（每个候选必须处置）", {
      sideEffect: "none",
      gate: { roles: ["process_owner"], selfApproval: true },
    }),
    stage("plan", "改进方案与试点设计（plan-from-rca）", { skills: ["S156"] }),
    stage("metrics", "试点指标设计（design-new，scope=process）", { skills: ["S162"] }),
    stage("approve_plan", "H3 方案批准（超 effort 阈值加预算责任人）", {
      sideEffect: "none",
      gate: { roles: ["process_owner", "budget_owner"] },
    }),
    stage("publish", "发布改进方案（P4）", { caps: ["artifact.write", "notify.inapp"], sideEffect: "write" }),
    // ── 状态机 B：pilot_review ──
    stage("pilot_intake", "准入（P1：planInstanceRef 属同组织同流程）", { caps: ["artifact.read"] }),
    stage("review", "试点复盘（review-pilot）", { skills: ["S156"], caps: ["analytics.read"] }),
    stage("metrics_check", "指标复核（review-existing）", { skills: ["S162"] }),
    stage("decide", "H4 逐试点决定（标准化 / 调整 / 放弃）", {
      sideEffect: "none",
      gate: { roles: ["process_owner"], selfApproval: true },
    }),
    stage("sop", "to-be SOP 草稿（仅标准化的试点）", { skills: ["S019"], caps: ["docs.read"] }),
    stage("approve_sop", "H5 SOP 草稿审批", {
      sideEffect: "none",
      gate: { roles: ["document_controller", "process_owner"], selfApproval: true },
    }),
    stage("pilot_publish", "发布试点结论与 SOP 草稿（P4；不写受控文档库）", { caps: ["artifact.write", "notify.inapp"], sideEffect: "write" }),
  ],
  gates: [
    gate("H1", "validate_map", { binds: ["processMapArtifactId"] }),
    gate("H2", "screen"),
    gate("H3", "approve_plan", { binds: ["planId", "planVersion"] }),
    gate("H4", "decide"),
    gate("H5", "approve_sop", { binds: ["sopDraftDigest"] }),
  ],
  constraints: {
    diagnoseAndPlanStages: ["intake", "map", "validate_map", "diagnose", "screen", "plan", "metrics", "approve_plan", "publish"],
    pilotReviewStages: ["pilot_intake", "review", "metrics_check", "decide", "sop", "approve_sop", "pilot_publish"],
    /** 文档同名阶段在本定义中的改名（B1→pilot_intake，B7→pilot_publish）。 */
    renamedFromDoc: ["B1:intake=pilot_intake", "B7:publish=pilot_publish"],
    /** 标准化发生在试点之后：S019 只出现在 pilot_review 模式（S156 决策 5）。 */
    skillOnlyInMode: ["S019:pilot_review"],
    /** `docs.publish` 只登记不执行（文档 B7）：不得出现在任何阶段。 */
    neverExecuteCapabilities: ["docs.publish"],
  },
};
