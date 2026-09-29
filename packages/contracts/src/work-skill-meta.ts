/**
 * Work Skill 元数据与目录 —— API 契约单一事实源（契约束 `work-skill-meta`，Phase 20 WS01–WS05）。
 *
 * 依据：ADR-117（元数据落包模型：manifest 不可变、目录行可变）、ADR-119（通道与门）、
 * ADR-120（依赖写能力分类，不写供应商）、ADR-118 #9（Workflow 固定 Skill 版本，不以挂载为条件）、
 * `phases/phase-20-work-stack-foundation/requirements/01-skill-catalog.md` R1–R12。
 *
 * ⚠ 草案，未签核：`contracts/work-skill-meta/design-signoff.md` status 为 pending（2026-09-28 人类授权先开发后补签）。
 * 本文件不在 index.ts 中导出（导出由单独步骤负责）。
 */
import { z } from "zod";

const Id = z.string().uuid();
const Cursor = z.string().min(1).max(512);
const Sha40 = z.string().regex(/^[a-f0-9]{40}$/, "commit must be a 40-char lowercase hex sha");

/* ── 值对象 ───────────────────────────────────────────────────────────── */

/** 实体稳定编号，如 `S003`（与 requirements/work-stack-v2 实体文档编号一致）。 */
export const WorkSkillStableId = z.string().regex(/^S\d{3}$/);
export type WorkSkillStableId = z.infer<typeof WorkSkillStableId>;

/**
 * 能力分类（ADR-120），形如 `knowledge.search` / `crm.read` / `mail.send`。
 * 只校验形状；是否已登记由服务端对照分类登记表判定（未登记 → WORK_SKILL_CAPABILITY_UNREGISTERED）。
 * 形状本身已排除供应商写法中常见的大写、空格、斜杠与 URL。
 */
export const CapabilityCategory = z.string().regex(/^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)+$/).max(64);
export type CapabilityCategory = z.infer<typeof CapabilityCategory>;

export const WorkSkillDomain = z.string().min(1).max(64); // 如 "Shared" / "Research"；领域清单以实体文档为准
export const WorkSkillRiskClass = z.enum(["low", "medium", "high"]);

export const WorkSkillProvenanceStrategy = z.enum(["adapt", "reference-only", "copy", "original"]);

export const WorkSkillProvenance = z
  .object({
    repo: z.string().min(1).max(255),
    path: z.string().min(1).max(1024),
    commit: Sha40,
    license: z.string().min(1).max(64), // SPDX 标识，如 Apache-2.0 / MIT
    strategy: WorkSkillProvenanceStrategy,
    copied: z.boolean(),
    notice: z.string().min(1).max(4000).optional(),
  })
  .strict()
  // E8：copied=true 必须带 notice（G1 许可要求）
  .refine(p => !p.copied || !!p.notice, { message: "copied provenance requires notice", path: ["notice"] });
export type WorkSkillProvenance = z.infer<typeof WorkSkillProvenance>;

/** JSON Schema 片段；只要求是对象，具体 schema 方言校验由 G2 门负责（ADR-119）。 */
const JsonSchemaObject = z.record(z.string(), z.unknown());

/**
 * `SKILL.md` frontmatter 的 `metadata.work`（ADR-117 #2）。导入后写入不可变的
 * `skill_versions.manifest.work`。通道/后继**不在此处**——它们属于可变目录行（R7：同一事实不在两处）。
 */
export const WorkSkillManifest = z
  .object({
    stableId: WorkSkillStableId,
    domain: WorkSkillDomain,
    riskClass: WorkSkillRiskClass,
    dependencies: z
      .object({
        required: z.array(CapabilityCategory).max(32),
        optional: z.array(CapabilityCategory).max(32),
      })
      .strict()
      .refine(d => d.required.every(c => !d.optional.includes(c)), {
        message: "category cannot be both required and optional",
      }),
    provenance: z.array(WorkSkillProvenance).min(1),
    locales: z.array(z.string().regex(/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/)).min(1),
    jurisdictions: z.array(z.string().min(2).max(16)).min(1),
    evalSuiteId: z.string().regex(/^[A-Z]\d{3}$/), // evals/work-stack/<ID>/（ADR-119 #1）
    inputSchema: JsonSchemaObject,
    outputSchema: JsonSchemaObject,
  })
  .strict();
export type WorkSkillManifest = z.infer<typeof WorkSkillManifest>;

/** 目录通道（ADR-117 #3 / ADR-119）。 */
export const WorkSkillChannel = z.enum(["candidate", "verified", "deprecated"]);
export type WorkSkillChannel = z.infer<typeof WorkSkillChannel>;

/** 合法通道转移（R7）；其余一律 WORK_SKILL_CHANNEL_TRANSITION_INVALID。deprecated 为终态。 */
export const WORK_SKILL_CHANNEL_TRANSITIONS: Readonly<Record<WorkSkillChannel, readonly WorkSkillChannel[]>> = {
  candidate: ["verified", "deprecated"],
  verified: ["deprecated"],
  deprecated: [],
};

/** 门状态占位（ADR-119 G0–G6）；本束只展示，判定由第 6 轮 eval runner 写回。 */
export const WorkSkillGateId = z.enum(["G0", "G1", "G2", "G3", "G4", "G5", "G6"]);
export const WorkSkillGateStatus = z
  .object({
    gate: WorkSkillGateId,
    state: z.enum(["not_run", "passed", "failed"]),
    evidenceRef: z.string().max(1024).nullable(),
  })
  .strict();

/* ── 就绪性（R3.8 / R7：实时计算，不缓存为事实） ─────────────────────── */

export const DependencyItemState = z.enum(["satisfied", "missing", "denied", "unknown"]);
export const DependencyReadinessItem = z
  .object({
    category: CapabilityCategory,
    kind: z.enum(["required", "optional"]),
    state: DependencyItemState,
    /** 机器可读原因：如 CATEGORY_UNREGISTERED / NO_ENABLED_TOOL / GRANT_DENIED / GRANT_LOOKUP_FAILED */
    reasonCode: z.enum(["OK", "CATEGORY_UNREGISTERED", "NO_ENABLED_TOOL", "GRANT_DENIED", "GRANT_LOOKUP_FAILED"]),
    /** 仅管理员可见：缺失时指向工具授权入口；成员恒为 null（R5） */
    grantHref: z.string().max(1024).nullable(),
  })
  .strict();

export const SkillReadinessOverall = z.enum(["ready", "not_ready", "unknown"]);
export const SkillReadiness = z
  .object({
    skillId: Id,
    skillVersionId: Id,
    overall: SkillReadinessOverall,
    /** required 中非 satisfied 的数量；overall=unknown 时为 null */
    missingRequired: z.number().int().nonnegative().nullable(),
    items: z.array(DependencyReadinessItem),
    computedAt: z.string().datetime(),
  })
  .strict();
export type SkillReadiness = z.infer<typeof SkillReadiness>;

export const SkillReadinessSummary = SkillReadiness.pick({ overall: true, missingRequired: true });

/* ── 目录行与详情 ─────────────────────────────────────────────────────── */

export const WorkSkillCatalogItem = z
  .object({
    skillId: Id,
    name: z.string().min(1).max(255),
    stableId: WorkSkillStableId,
    domain: WorkSkillDomain,
    channel: WorkSkillChannel,
    riskClass: WorkSkillRiskClass,
    currentVersionId: Id,
    currentVersionLabel: z.string().min(1).max(64), // skill_versions.semantic_label
    readiness: SkillReadinessSummary,
    successorSkillId: Id.nullable(),
  })
  .strict();
export type WorkSkillCatalogItem = z.infer<typeof WorkSkillCatalogItem>;

export const WorkSkillVersionRef = z
  .object({ skillVersionId: Id, semanticLabel: z.string().min(1).max(64), publishedAt: z.string().datetime(), current: z.boolean() })
  .strict();

export const WorkSkillCatalogDetail = WorkSkillCatalogItem.extend({
  description: z.string().max(4000),
  manifest: WorkSkillManifest, // 当前生效版本的 skill_versions.manifest.work
  gates: z.array(WorkSkillGateStatus),
  versions: z.array(WorkSkillVersionRef).min(1),
  successor: z.object({ skillId: Id, name: z.string(), stableId: WorkSkillStableId }).strict().nullable(),
  /** 调用者是否可改通道/后继；UI 据此决定是否渲染按钮（E9），服务端仍独立鉴权 */
  canManageChannel: z.boolean(),
}).strict();
export type WorkSkillCatalogDetail = z.infer<typeof WorkSkillCatalogDetail>;

/* ── 请求 ─────────────────────────────────────────────────────────────── */

export const ListWorkSkillCatalog = z
  .object({
    domain: WorkSkillDomain.optional(),
    channel: WorkSkillChannel.optional(),
    q: z.string().trim().max(200).optional(),
    /** A3：默认 false，deprecated 隐藏；channel=deprecated 时隐含 true */
    includeDeprecated: z.boolean().default(false),
    cursor: Cursor.optional(),
    limit: z.number().int().min(1).max(100).default(50),
  })
  .strict();

export const UpdateWorkSkillCatalogEntry = z
  .object({
    skillId: Id,
    expectedChannel: WorkSkillChannel, // 乐观并发：与当前通道不一致 → 409
    channel: WorkSkillChannel.optional(),
    successorSkillId: Id.nullable().optional(),
    /** candidate→verified 在门判定脚本落地前必须显式给出（ADR-119；R3.9） */
    gateEvidenceRef: z.string().min(1).max(1024).optional(),
    idempotencyKey: z.string().min(1).max(255),
  })
  .strict()
  .refine(v => v.channel !== undefined || v.successorSkillId !== undefined, { message: "nothing to update" });

/* ── 错误 ─────────────────────────────────────────────────────────────── */

export const WorkSkillManifestIssue = z
  .object({ file: z.string().min(1), fieldPath: z.string(), message: z.string() })
  .strict();

/** 导入端点在既有 `SkillStarterImportError`（wave2-runtime.ts）之外新增的失败码。 */
export const WorkSkillImportError = z.enum([
  "WORK_SKILL_MANIFEST_INVALID", // E1，422，附 issues[]
  "WORK_SKILL_CAPABILITY_UNREGISTERED", // E6，422
  "WORK_SKILL_PROVENANCE_LICENSE_MISSING", // E8，422
  "WORK_SKILL_STABLE_ID_CONFLICT", // E2，409
]);

export const WorkSkillCatalogError = z.enum([
  "UNAUTHENTICATED", // 401
  "WORK_SKILL_NOT_FOUND", // 404：不存在与跨组织不区分（R5）
  "WORK_SKILL_ADMIN_REQUIRED", // 403，E9
  "WORK_SKILL_CHANNEL_TRANSITION_INVALID", // 409，E4（含 candidate→verified 缺门证据、并发不一致）
  "WORK_SKILL_SUCCESSOR_INVALID", // 422，E3：不存在/自指/成环
  "WORK_SKILL_IDEMPOTENCY_CONFLICT", // 409
  "VALIDATION_FAILED", // 422
]);

export const WorkSkillErrorBody = z
  .object({
    code: z.union([WorkSkillImportError, WorkSkillCatalogError]),
    message: z.string(),
    issues: z.array(WorkSkillManifestIssue).optional(),
    allowedTransitions: z.array(WorkSkillChannel).optional(),
    conflictingSkillId: Id.optional(),
  })
  .strict();

/* ── 操作 ─────────────────────────────────────────────────────────────── */

export const operations = {
  listWorkSkillCatalog: {
    method: "GET", path: "/skills/catalog", in: ListWorkSkillCatalog,
    out: z.object({ items: z.array(WorkSkillCatalogItem), nextCursor: Cursor.nullable() }).strict(),
    err: ["UNAUTHENTICATED", "VALIDATION_FAILED"] as const,
  },
  getWorkSkillCatalogEntry: {
    method: "GET", path: "/skills/catalog/:skillId",
    in: z.object({ skillId: Id, versionId: Id.optional() }).strict(), // versionId：A2 按版本读旧 manifest
    out: WorkSkillCatalogDetail,
    err: ["UNAUTHENTICATED", "WORK_SKILL_NOT_FOUND"] as const,
  },
  getWorkSkillReadiness: {
    method: "GET", path: "/skills/catalog/:skillId/readiness",
    in: z.object({ skillId: Id, versionId: Id.optional() }).strict(),
    out: SkillReadiness, // 授权查询失败时 200 + overall=unknown（E5），不是 5xx
    err: ["UNAUTHENTICATED", "WORK_SKILL_NOT_FOUND"] as const,
  },
  updateWorkSkillCatalogEntry: {
    method: "PATCH", path: "/admin/skills/catalog/:skillId", in: UpdateWorkSkillCatalogEntry,
    out: WorkSkillCatalogItem,
    err: [
      "UNAUTHENTICATED", "WORK_SKILL_NOT_FOUND", "WORK_SKILL_ADMIN_REQUIRED",
      "WORK_SKILL_CHANNEL_TRANSITION_INVALID", "WORK_SKILL_SUCCESSOR_INVALID",
      "WORK_SKILL_IDEMPOTENCY_CONFLICT", "VALIDATION_FAILED",
    ] as const,
  },
} as const;
