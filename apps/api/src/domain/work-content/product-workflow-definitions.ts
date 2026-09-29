/**
 * 产品线 Workflow 代码定义（CT05；05-content-lines.md R3 步骤 5–6 / R4 E2·E3；契约束 work-content）。
 *
 * 每个 Workflow 的阶段表逐行取自其实体文档 §5（`source` 字段指向出处），Skill 引用固定到
 * work-product / work-research starter-pack 的 semanticVersion（ADR-118 #9：Workflow 版本固定 Skill 版本）。
 * 本文件**不是**第二份组合表：Workflow→Skill 组合的权威仍是 WORKFLOW-SKILL-MATRIX.md，
 * `tests/work-content/product-skillpins-matrix.test.ts` 机械核对「本文件派生的 skillPins == 矩阵行」。
 *
 * 纯数据 + 纯函数，无 IO。
 */
import type { WorkflowDefinitionVersionInput, WorkflowStageDefinition } from "@repo/contracts/workflow-runtime";

/** 本阶段所有 Work Skill pack 的发布版本（work-product 1.0.0 / work-research 1.0.0 中每个 Skill 都是 1.0.0）。 */
export const PRODUCT_LINE_SKILL_VERSION = "1.0.0";
export const PRODUCT_LINE_DEFINITION_VERSION = 1;

export type ContentLine = "research" | "product" | "sales" | "shared";

export interface ContentStageDefinition {
  stageId: string;
  skills: readonly string[];
  capabilityCategories: readonly string[];
  sideEffect: WorkflowStageDefinition["sideEffect"];
  /** 文档 §5 中标为 required 的人工门编号（G1…）；ask / 条件 ask 不建门。 */
  gateId: string | null;
}

export interface ContentWorkflowDefinition {
  workflowId: string;
  key: string;
  title: string;
  line: ContentLine;
  /** 阶段表出处（实体文档 §5）。 */
  source: string;
  stages: readonly ContentStageDefinition[];
}

function st(
  stageId: string,
  skills: string[],
  capabilityCategories: string[],
  sideEffect: WorkflowStageDefinition["sideEffect"],
  gateId: string | null,
): ContentStageDefinition {
  return { stageId, skills, capabilityCategories, sideEffect, gateId };
}

/** W027–W032 + W002（产品线第 8 轮范围）。 */
export const PRODUCT_LINE_WORKFLOWS: readonly ContentWorkflowDefinition[] = [
  {
    workflowId: "W027",
    key: "discovery-to-opportunity",
    title: "Discovery-to-Opportunity",
    line: "product",
    source: "requirements/work-stack-v2/workflows/W027-discovery-to-opportunity.md#5",
    stages: [
      st("hypothesize", ["S061"], ["knowledge.read", "sandbox.exec"], "read", "G1"),
      st("plan_interviews", ["S062"], ["knowledge.read", "interview.read", "sandbox.exec"], "read", "G2"),
      st("import_outline", [], ["interview.write"], "write", null),
      st("fieldwork", [], [], "none", "G3"),
      st("gather", ["S009"], ["transcript.read", "ticket.read", "survey.read", "web.fetch"], "read", null),
      st("synthesize", ["S063"], ["knowledge.read", "sandbox.exec"], "read", null),
      st("adjudicate", ["S061"], ["sandbox.exec"], "read", "G4"),
      st("frame", ["S064"], ["knowledge.read", "sandbox.exec"], "read", "G5"),
      st("map", ["S065"], ["knowledge.read", "sandbox.exec"], "read", "G6"),
      st("publish", [], ["artifact.write"], "write", null),
    ],
  },
  {
    workflowId: "W028",
    key: "research-to-insight",
    title: "Research-to-Insight",
    line: "product",
    source: "requirements/work-stack-v2/workflows/W028-research-to-insight.md#5",
    stages: [
      st("intake", [], [], "none", null),
      st("plan", ["S062"], ["knowledge.read"], "read", null),
      st("review_plan", [], [], "none", "G1"),
      st("import_outline", [], ["interview.outline.write"], "write", "G2"),
      st("fieldwork", [], [], "none", "G3"),
      st("collect", ["S009"], ["transcript.read", "knowledge.read", "survey.read", "ticket.read"], "read", null),
      st("coverage_check", [], [], "none", null),
      st("synthesize", ["S063"], ["knowledge.read"], "read", null),
      st("integrate", ["S169"], ["knowledge.read"], "read", null),
      st("audit", ["S171"], ["knowledge.read"], "read", null),
      st("recompute", [], ["sandbox.exec"], "none", null),
      st("map", ["S065"], [], "none", null),
      st("review_insight", [], [], "none", "G4"),
      st("publish", [], ["artifact.write"], "write", null),
      st("notify", [], ["notify.inapp"], "write", null),
    ],
  },
  {
    workflowId: "W029",
    key: "problem-to-prd",
    title: "Problem-to-PRD",
    line: "product",
    source: "requirements/work-stack-v2/workflows/W029-problem-to-prd.md#5",
    stages: [
      st("intake", [], ["project.read"], "read", null),
      st("frame", ["S064"], ["knowledge.read"], "read", null),
      st("frame_gate", [], [], "write", "G1"),
      st("map", ["S065"], ["knowledge.read"], "read", null),
      st("target_gate", [], [], "write", "G2"),
      st("solutions_fill", ["S065"], ["knowledge.read"], "read", null),
      st("estimate", [], ["notify.inapp"], "write", null),
      st("prioritize", ["S068"], ["knowledge.read"], "read", null),
      st("solution_gate", [], [], "write", "G3"),
      st("draft", ["S067"], ["knowledge.read"], "read", null),
      st("kpi", ["S162"], [], "none", null),
      st("kpi_bind", [], [], "none", null),
      st("revise", ["S067"], ["knowledge.read"], "read", null),
      st("prd_gate", [], [], "write", "G4"),
      st("persist", [], ["artifact.write"], "write", null),
      st("notify", [], ["notify.inapp"], "write", null),
    ],
  },
  {
    workflowId: "W030",
    key: "prd-to-sprint",
    title: "PRD-to-Sprint",
    line: "product",
    source: "requirements/work-stack-v2/workflows/W030-prd-to-sprint.md#5",
    stages: [
      st("intake", [], ["knowledge.read", "design.read", "project.read"], "read", null),
      st("readiness", ["S067"], ["knowledge.read"], "read", null),
      st("handoff", ["S076"], ["design.read", "knowledge.read"], "read", null),
      st("gaps_gate", [], [], "write", "G1"),
      st("estimation_gate", [], ["team.roster.read"], "write", "G2"),
      st("scope_cut", ["S068"], ["knowledge.read"], "none", null),
      st("scope_gate", [], [], "write", "G3"),
      st("planning", ["S070"], ["knowledge.read", "team.roster.read", "sprint.history.read"], "none", null),
      st("plan_gate", [], ["project.read"], "write", "G4"),
      st("commit_proposal", ["S142"], ["board.read"], "read", null),
      st("commit_gate", [], ["board.write"], "write", "G5"),
      st("publish_plan", [], ["artifact.write", "notify.inapp"], "write", null),
    ],
  },
  {
    workflowId: "W031",
    key: "experiment-loop",
    title: "Experiment Loop",
    line: "product",
    source: "requirements/work-stack-v2/workflows/W031-experiment-loop.md#5",
    stages: [
      st("intake", [], ["org.membership.read"], "read", null),
      st("activation_define", ["S074"], ["analytics.read", "sandbox.exec"], "read", null),
      st("diagnose", ["S074"], ["analytics.read", "sandbox.exec"], "read", null),
      st("metric_audit", ["S072"], ["analytics.read", "sandbox.exec"], "read", null),
      st("design", ["S071"], ["sandbox.exec", "report.read"], "read", null),
      st("preregister", [], ["workflow.record.write"], "write", "G1"),
      st("launch_attest", [], ["workflow.record.write"], "write", "G2"),
      st("health_check", ["S157"], ["data.read", "sandbox.exec"], "read", null),
      st("data_lock", [], ["data.read", "report.read"], "read", null),
      st("precheck", ["S157"], ["data.read", "sandbox.exec"], "read", null),
      st("analyze", ["S161"], ["data.read", "sandbox.exec"], "read", null),
      st("readout", ["S074"], ["sandbox.exec"], "none", null),
      st("decide", [], [], "none", "G4"),
      st("record", [], ["artifact.write", "notify.inapp"], "write", null),
      st("retention_followup", ["S157", "S161", "S074"], [], "write", null),
    ],
  },
  {
    workflowId: "W032",
    key: "roadmap-review",
    title: "Roadmap Review",
    line: "product",
    source: "requirements/work-stack-v2/workflows/W032-roadmap-review.md#5",
    stages: [
      st("scope", [], ["artifact.read", "project.read"], "read", "G1"),
      st("outcome_review", ["S072"], ["metrics.read"], "read", null),
      st("reconcile", ["S155"], ["artifact.read"], "read", null),
      st("demand_check", ["S009"], ["transcript.read", "knowledge.read", "crm.read"], "read", null),
      st("competition", ["S008"], ["web.fetch", "asset.read"], "read", null),
      st("rerank", ["S068"], [], "none", "G1b"),
      st("replan", ["S069"], [], "none", null),
      st("validate", [], ["sandbox.exec"], "read", null),
      st("decide", [], [], "none", "G2"),
      st("publish", [], ["artifact.write"], "write", null),
      st("notify", [], ["notify.inapp"], "external_send", "G3"),
      st("external_view", [], ["artifact.write"], "external_send", null),
    ],
  },
  {
    workflowId: "W002",
    key: "meeting-to-actions",
    title: "Meeting-to-Actions",
    line: "shared",
    source: "requirements/work-stack-v2/workflows/W002-meeting-to-actions.md#5",
    stages: [
      st("intake", [], ["recording.read", "knowledge.read"], "read", null),
      st("summarize", ["S006"], ["recording.read", "knowledge.read", "audio.transcribe"], "read", null),
      st("record_review", [], [], "none", "G1"),
      st("extract", ["S017"], [], "read", null),
      st("plan", ["S142"], ["board.read", "directory.read"], "read", "G2a"),
      st("approve_actions", [], [], "none", "G2"),
      st("apply", ["S142"], ["board.write"], "write", null),
      st("publish_record", [], ["artifact.write"], "write", null),
      st("track", ["S007"], ["board.read", "notify.inapp"], "read", null),
    ],
  },];

/** 从阶段表派生 skillPins：按首次出现顺序去重，版本固定。 */
export function skillPinsOf(def: ContentWorkflowDefinition, version = PRODUCT_LINE_SKILL_VERSION): { skillId: string; semanticVersion: string }[] {
  const seen = new Set<string>();
  const pins: { skillId: string; semanticVersion: string }[] = [];
  for (const stage of def.stages) {
    for (const id of stage.skills) {
      if (seen.has(id)) continue;
      seen.add(id);
      pins.push({ skillId: id, semanticVersion: version });
    }
  }
  return pins;
}

export function graphRefOf(def: Pick<ContentWorkflowDefinition, "key">, version = PRODUCT_LINE_DEFINITION_VERSION): string {
  return `${def.key}:${version}`;
}

/** 转成 Runtime 的 Definition 版本元数据（发布 / 注册用；versionRange 为精确版本 = 固定）。 */
export function toRuntimeDefinition(def: ContentWorkflowDefinition): WorkflowDefinitionVersionInput {
  return {
    key: def.key,
    version: PRODUCT_LINE_DEFINITION_VERSION,
    graphRef: graphRefOf(def),
    title: `${def.workflowId} ${def.title}`,
    inputSchema: { type: "object" },
    stages: def.stages.map((s) => ({
      stageId: s.stageId,
      title: s.stageId,
      skills: s.skills.map((id) => ({ stableId: id, versionRange: PRODUCT_LINE_SKILL_VERSION })),
      capabilityCategories: [...s.capabilityCategories],
      sideEffect: s.sideEffect,
      humanGate:
        s.gateId === null
          ? null
          : { approverRoles: ["workflow_initiator"], approverUserIds: [], allowSelfApproval: true, onDenyStageId: null },
      maxAttempts: 1,
    })),
  };
}
