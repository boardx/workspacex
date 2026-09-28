/**
 * Work Stack 评测与发布门 —— API 契约单一事实源（契约束 `work-eval`，Phase 20 EV01–EV05）。
 *
 * 依据：ADR-119（评测与发布门，权威）、ADR-117（门状态回写到可变目录行 `skill_catalog_entries`）、
 * ADR-118 #9（评测对象是固定版本）、ADR-120（G3 所用能力分类）、
 * `phases/phase-20-work-stack-foundation/requirements/04-eval-gates.md` R1–R12。
 *
 * ⚠ 草案，未签核：`contracts/work-eval/design-signoff.md` status 为 pending（2026-09-28 人类授权先开发后补签）。
 * 本文件不在 index.ts 中导出（导出由单独步骤负责）。
 *
 * 口径：本阶段判定 G0–G5（G6 生产门不在范围，requirements R6）；门枚举沿用
 * `work-skill-meta.ts` 的 `WorkSkillGateId`（G0–G6），不在此重复声明（同一事实不两处）。
 */
import { z } from "zod";
import { CapabilityCategory, WorkSkillChannel, WorkSkillGateId } from "./work-skill-meta";

const Id = z.string().uuid();
const Sha256 = z.string().regex(/^sha256:[a-f0-9]{64}$/, "digest must be sha256:<64 hex>");
const RelPath = z.string().min(1).max(1024).refine(p => !p.startsWith("/") && !p.includes(".."), "repo-relative path");

/* ── 实体与版本 ───────────────────────────────────────────────────────── */

/** 任一 Work Stack 实体编号：S=Skill、W=Workflow、D=Agent(DigitalHuman)。目录名 = stableId（ADR-119 #1）。 */
export const WorkEntityStableId = z.string().regex(/^[SWD]\d{3}$/);
export type WorkEntityStableId = z.infer<typeof WorkEntityStableId>;
export const WorkEntityKind = z.enum(["skill", "workflow", "agent"]);

/** 本阶段判定的门（G6 不在范围）。 */
export const PHASE1_GATES = ["G0", "G1", "G2", "G3", "G4", "G5"] as const satisfies readonly z.infer<typeof WorkSkillGateId>[];
export const WorkEvalGateId = z.enum(PHASE1_GATES);

/* ── 套件格式（EV01；evals/work-stack/<ID>/suite.json 与 cases.jsonl） ───── */

export const WorkEvalBaseline = z
  .object({
    /** 无该 Skill 的通用 Agent + 相同工具集（R3.4） */
    kind: z.literal("generic-agent-same-tools"),
    tools: z.array(z.string().min(1).max(128)).min(1),
  })
  .strict();

export const WorkEvalLlmJudge = z
  .object({
    calibrationDir: RelPath, // 相对套件目录，如 calibration/
    minAgreement: z.number().min(0).max(1), // 阈值只在此一处声明（R7）
  })
  .strict();

export const WorkEvalSuite = z
  .object({
    schemaVersion: z.literal(1),
    stableId: WorkEntityStableId, // 必须 = 目录名 = manifest.evalSuiteId（服务端/CLI 校验）
    entityKind: WorkEntityKind,
    /** 目标版本范围（semver range）；评测时仍按 content digest 固定具体版本 */
    targetVersionRange: z.string().min(1).max(64),
    toolsUnderTest: z.array(z.string().min(1).max(128)),
    baseline: WorkEvalBaseline.nullable(), // null → G5 fail「无基线」（E5）
    /** 实体文档指定的必过 case（S003 为 E2/E3/E6），G5 必须全过 */
    mustPassCaseIds: z.array(z.string().min(1).max(32)),
    caseTimeoutMs: z.number().int().positive().max(600_000).default(60_000), // E3
    llmJudge: WorkEvalLlmJudge.nullable().default(null),
    graderVersion: z.string().min(1).max(64),
  })
  .strict();
export type WorkEvalSuite = z.infer<typeof WorkEvalSuite>;

export const WorkEvalCaseTag = z.enum(["permission-denial", "prompt-injection", "functional", "edge"]);

export const WorkEvalCase = z
  .object({
    id: z.string().regex(/^[A-Z][A-Za-z0-9-]{0,31}$/), // 如 E1
    title: z.string().min(1).max(200),
    tags: z.array(WorkEvalCaseTag).min(1),
    fixtureRefs: z.array(RelPath), // 相对 fixtures/；只允许合成数据（E11）
    input: z.record(z.string(), z.unknown()), // 须满足 manifest.inputSchema（G2）
    expect: z
      .object({
        assertions: z.array(z.object({ kind: z.string().min(1).max(64), spec: z.unknown() }).strict()).min(1),
        outputSample: z.unknown().optional(), // 须满足 manifest.outputSchema（G2）
      })
      .strict(),
    deterministic: z.boolean().default(true), // false 的 case 不计入 G4/G5（A3）
  })
  .strict();
export type WorkEvalCase = z.infer<typeof WorkEvalCase>;

/** 套件须至少一条权限拒绝与一条注入 case（G3，E7）。 */
export function suiteCoverageGaps(cases: readonly WorkEvalCase[]): ("permission-denial" | "prompt-injection")[] {
  const tags = new Set(cases.flatMap(c => c.tags));
  return (["permission-denial", "prompt-injection"] as const).filter(t => !tags.has(t));
}

/* ── 报告（EV02；evals/work-stack/<ID>/reports/<runId>.json） ──────────── */

export const WorkEvalCaseResult = z
  .object({
    caseId: z.string(),
    outcome: z.enum(["pass", "fail", "error"]), // error 永不计作 pass（E3）
    reason: z.string().max(2000).nullable(),
    durationMs: z.number().int().nonnegative(),
  })
  .strict();

export const WorkEvalRunSide = z
  .object({
    results: z.array(WorkEvalCaseResult),
    passed: z.number().int().nonnegative(),
    total: z.number().int().nonnegative(),
  })
  .strict();

export const WorkEvalReport = z
  .object({
    schemaVersion: z.literal(1),
    runId: z.string().min(1).max(64),
    stableId: WorkEntityStableId,
    subjectVersionDigest: Sha256, // ADR-118 #9：评测对象是具体版本
    subjectVersionLabel: z.string().min(1).max(64),
    fixturesDigest: Sha256,
    graderVersion: z.string().min(1).max(64),
    lane: z.enum(["loopback", "real-model"]), // real-model 不参与 G4/G5（A3，R7）
    partial: z.boolean(), // --case 单跑 → true，不能作 G4/G5 证据（A2）
    subject: WorkEvalRunSide,
    baseline: WorkEvalRunSide.nullable(),
    startedAt: z.string().datetime(),
    finishedAt: z.string().datetime(),
  })
  .strict();
export type WorkEvalReport = z.infer<typeof WorkEvalReport>;

/* ── 门状态（EV03 产出，EV04 回写） ───────────────────────────────────── */

export const WorkGateOutcome = z.enum(["pass", "fail", "not_applicable"]);

/** 机器可读失败原因；UI 据此出文案。 */
export const WorkGateReasonCode = z.enum([
  "OK",
  "STABLE_ID_MISMATCH", // G0
  "MANIFEST_UNPARSEABLE", // G0
  "PROVENANCE_LICENSE_MISSING", // G1
  "LICENSE_DISALLOWED", // G1
  "SCHEMA_INVALID", // G2 / E2
  "CAPABILITY_UNREGISTERED", // G3
  "INJECTION_OR_DENIAL_CASE_MISSING", // G3 / E7
  "INJECTION_OR_DENIAL_CASE_FAILED", // G3
  "NO_SUITE", // G4 / E1（不得判 not_applicable）
  "REPORT_STALE", // G4 / E4
  "CASE_FAILED", // G4
  "LLM_JUDGE_UNCALIBRATED", // G4/G5 / E8
  "NO_BASELINE", // G5 / E5
  "NOT_BETTER_THAN_BASELINE", // G5 / E6（持平即失败）
  "MUST_PASS_CASE_FAILED", // G5 / E6
  "PRIOR_GATE_FAILED", // G5 要求 G0–G4 全过
  "NOT_REQUIRED_FOR_KIND", // Workflow/Agent 的 G5（A1）
]);

export const WorkGateResult = z
  .object({
    gate: WorkEvalGateId,
    outcome: WorkGateOutcome,
    reasonCode: WorkGateReasonCode,
    reason: z.string().max(2000),
  })
  .strict()
  .refine(r => !(r.gate === "G4" && r.reasonCode === "NO_SUITE" && r.outcome !== "fail"), {
    message: "NO_SUITE must be fail, never not_applicable (E1)",
  });

/** 门脚本唯一产出物；任何角色只能回写此结构，不能手改门字段（R5）。 */
export const WorkGateStatus = z
  .object({
    stableId: WorkEntityStableId,
    subjectVersionDigest: Sha256,
    gates: z.array(WorkGateResult).length(PHASE1_GATES.length),
    evidenceReportPath: RelPath.nullable(), // evals/work-stack/<ID>/reports/<runId>.json
    subjectPassed: z.number().int().nonnegative().nullable(),
    baselinePassed: z.number().int().nonnegative().nullable(),
    deterministicTotal: z.number().int().nonnegative().nullable(),
    decidedAt: z.string().datetime(),
    scriptVersion: z.string().min(1).max(64), // lint-work-stack-gates 版本
  })
  .strict()
  .refine(s => new Set(s.gates.map(g => g.gate)).size === PHASE1_GATES.length, { message: "each of G0–G5 exactly once" });
export type WorkGateStatus = z.infer<typeof WorkGateStatus>;

/** G5 判定纯函数（R3.7 / R7）：严格大于基线且必过 case 全过，且 G0–G4 已全过。 */
export function decideG5(input: {
  priorGatesPassed: boolean;
  subjectPassed: number;
  baselinePassed: number | null;
  mustPassAllPassed: boolean;
}): { outcome: "pass" | "fail"; reasonCode: z.infer<typeof WorkGateReasonCode> } {
  if (!input.priorGatesPassed) return { outcome: "fail", reasonCode: "PRIOR_GATE_FAILED" };
  if (input.baselinePassed === null) return { outcome: "fail", reasonCode: "NO_BASELINE" };
  if (!input.mustPassAllPassed) return { outcome: "fail", reasonCode: "MUST_PASS_CASE_FAILED" };
  if (input.subjectPassed <= input.baselinePassed) return { outcome: "fail", reasonCode: "NOT_BETTER_THAN_BASELINE" };
  return { outcome: "pass", reasonCode: "OK" };
}

/* ── 目录读视图（成员可见；不含夹具原文/grader 细节，R5） ─────────────── */

export const WorkGateBadgeState = z.enum(["pass", "fail", "not_applicable", "not_evaluated"]);

export const WorkGateView = z
  .object({
    skillVersionId: Id,
    semanticLabel: z.string().min(1).max(64),
    evalSuiteId: WorkEntityStableId.nullable(),
    /** 当前版本无记录 → 六门全 not_evaluated、decidedAt=null（A4） */
    gates: z
      .array(z.object({ gate: WorkEvalGateId, state: WorkGateBadgeState, reasonCode: WorkGateReasonCode.nullable(), reason: z.string().max(2000).nullable() }).strict())
      .length(PHASE1_GATES.length),
    subjectPassed: z.number().int().nonnegative().nullable(),
    baselinePassed: z.number().int().nonnegative().nullable(),
    deterministicTotal: z.number().int().nonnegative().nullable(),
    decidedAt: z.string().datetime().nullable(),
    /** 当前版本 digest ≠ 记录 digest 的报告已过期（E4），UI 黄色提示 */
    stale: z.boolean(),
    /** 调用者可否执行 candidate→verified（平台运营 && G5 pass && channel=candidate）；服务端仍独立鉴权 */
    canMarkVerified: z.boolean(),
    markVerifiedBlockedReason: WorkGateReasonCode.nullable(),
  })
  .strict();
export type WorkGateView = z.infer<typeof WorkGateView>;

/** 列表行缩略（如「G4✓ G5✗」）：只给 G4/G5 两门。 */
export const WorkGateSummary = z
  .object({ g4: WorkGateBadgeState, g5: WorkGateBadgeState })
  .strict();

/* ── 请求 ─────────────────────────────────────────────────────────────── */

export const WriteBackWorkGateStatus = z
  .object({
    skillId: Id,
    status: WorkGateStatus,
    idempotencyKey: z.string().min(1).max(255),
  })
  .strict();

export const GetWorkGateStatus = z
  .object({ skillId: Id, versionId: Id.optional() }) // versionId：A4 读旧版本记录
  .strict();

/* ── 错误 ─────────────────────────────────────────────────────────────── */

export const WorkEvalError = z.enum([
  "UNAUTHENTICATED", // 401
  "WORK_SKILL_NOT_FOUND", // 404：不存在与跨组织不区分
  "WORK_EVAL_PLATFORM_ADMIN_REQUIRED", // 403：回写仅平台运营（E9）
  "WORK_EVAL_DIGEST_MISMATCH", // 409：status.subjectVersionDigest 不对应该 Skill 任何版本
  "WORK_EVAL_STABLE_ID_MISMATCH", // 422：status.stableId ≠ 目录行 stableId
  "WORK_EVAL_G5_NOT_PASSED", // 409：candidate→verified 时当前版本 G5 未 pass（取代临时 gateEvidenceRef）
  "WORK_EVAL_IDEMPOTENCY_CONFLICT", // 409
  "VALIDATION_FAILED", // 422
]);

export const WorkEvalErrorBody = z
  .object({ code: WorkEvalError, message: z.string(), gates: z.array(WorkGateResult).optional() })
  .strict();

/** CLI（非 HTTP）退出语义——供 EV02/EV03 测试断言。 */
export const WorkEvalCliExit = z.enum([
  "OK", // 0
  "CASE_FAILED_OR_ERROR", // 1
  "SUITE_INVALID", // 2，打印文件与字段路径（E1）
  "FIXTURE_REAL_DATA_SUSPECTED", // 3，拒绝运行（E11）
  "WRITE_BACK_FAILED", // 4，本地报告已生成但未回写（E9）
]);

/* ── 操作 ─────────────────────────────────────────────────────────────── */

export const operations = {
  writeBackWorkGateStatus: {
    method: "POST", path: "/admin/skills/catalog/:skillId/gate-status", in: WriteBackWorkGateStatus,
    out: WorkGateView,
    err: [
      "UNAUTHENTICATED", "WORK_SKILL_NOT_FOUND", "WORK_EVAL_PLATFORM_ADMIN_REQUIRED",
      "WORK_EVAL_DIGEST_MISMATCH", "WORK_EVAL_STABLE_ID_MISMATCH", "WORK_EVAL_IDEMPOTENCY_CONFLICT", "VALIDATION_FAILED",
    ] as const,
  },
  getWorkGateStatus: {
    method: "GET", path: "/skills/catalog/:skillId/gate-status", in: GetWorkGateStatus,
    out: WorkGateView,
    err: ["UNAUTHENTICATED", "WORK_SKILL_NOT_FOUND"] as const,
  },
  /**
   * 扩展 `work-skill-meta.ts` 的 `updateWorkSkillCatalogEntry`：candidate→verified 以门状态为准，
   * 追加失败码 WORK_EVAL_G5_NOT_PASSED；路径与入参形状不变（此处只登记追加码，不复述形状）。
   */
  updateWorkSkillCatalogEntryGateCheck: {
    method: "PATCH", path: "/admin/skills/catalog/:skillId",
    in: z.object({ skillId: Id, channel: WorkSkillChannel }).passthrough(),
    out: z.unknown(),
    err: ["WORK_EVAL_G5_NOT_PASSED"] as const,
  },
} as const;

/** 仅供类型引用：G3 用的能力分类来自 ADR-120 登记表。 */
export type WorkEvalCapabilityCategory = z.infer<typeof CapabilityCategory>;
