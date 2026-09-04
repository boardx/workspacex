/**
 * 契约束 `artifacts-steering` —— 签核③（API 契约）落点。Phase 14 F09/F10/F11/F12。
 *
 * 设计签核见 `phases/phase-14-agent-kernel-unification/contracts/artifacts-steering/`
 * （`design-signoff.md` status: pending，待人类签核）。翻译自
 * `requirements/04-artifacts-steering.md` 的 R3/R3'/R4/R6/R7，不发挥。
 *
 * ## 这是什么
 *
 * 两件事：① 产出物版本化领域模型 + API（`Artifact`/`ArtifactVersion`）；
 * ② 中途插话（`interject`），run 处于 `running` 时用户可发送新指令重新引导。
 * `AgentKernelRunStatus` 复用 `streaming-transport.ts`，不重复定义。
 */
import { z } from "zod";

/* ── 一、产出物版本化（R3）─────────────────────────────────────────────── */

export const ArtifactKind = z.enum(["pdf", "docx", "png", "other"]);
export type ArtifactKind = z.infer<typeof ArtifactKind>;

export const ArtifactVersionInfo = z.object({
  version: z.number().int().min(1),
  /** 每个版本必须能明确追溯到产生它的 run/step（R7 业务规则）。 */
  producedByRunId: z.string(),
  producedByStepId: z.string(),
  createdAt: z.string(),
  sizeBytes: z.number().int().min(0),
  /** 触发这个版本的用户指令摘要（首版为初始生成意图）。 */
  changeNote: z.string(),
  /** 对象存储定位，沿用现有聊天附件的存储与访问控制策略（R9）。 */
  storageKey: z.string(),
}).strict();
export type ArtifactVersionInfo = z.infer<typeof ArtifactVersionInfo>;

export const ArtifactRecord = z.object({
  artifactId: z.string(),
  threadId: z.string(),
  name: z.string(),
  kind: ArtifactKind,
  /** 版本按创建顺序排列，最新版本在末尾；不可变——每次修改追加新版本，不改写旧版本。 */
  versions: z.array(ArtifactVersionInfo).min(1),
}).strict();
export type ArtifactRecord = z.infer<typeof ArtifactRecord>;

export const ArtifactError = z.enum([
  "NOT_VISIBLE",
  "ARTIFACT_NOT_FOUND",
  /** E2：指定版本已不存在（不允许默默使用错误版本）。 */
  "ARTIFACT_VERSION_NOT_FOUND",
]);
export type ArtifactError = z.infer<typeof ArtifactError>;

export const ContinueArtifactInput = z.object({
  artifactId: z.string().min(1),
  /** E2：显式指定基于哪个版本继续，不能默默用最新版本代替。 */
  basedOnVersion: z.number().int().min(1),
  /** 用户的修改指令，如"把第二页标题改成 X"。 */
  instruction: z.string().refine((s) => s.trim() !== "", "instruction 不得为空白"),
}).strict();
export type ContinueArtifactInput = z.infer<typeof ContinueArtifactInput>;

export const ContinueArtifactOutput = z.object({
  /** 新发起的 run（新逻辑 run，不是 streaming-transport 束 F05 的续跑）。 */
  runId: z.string(),
  artifactId: z.string(),
}).strict();
export type ContinueArtifactOutput = z.infer<typeof ContinueArtifactOutput>;

export const ListArtifactVersionsInput = z.object({
  artifactId: z.string().min(1),
  /** R9：版本历史查询支持分页，避免长期迭代后单次加载过多版本。 */
  cursor: z.string().nullable(),
  limit: z.number().int().min(1).max(100).default(20),
}).strict();
export type ListArtifactVersionsInput = z.infer<typeof ListArtifactVersionsInput>;

export const ListArtifactVersionsOutput = z.object({
  versions: z.array(ArtifactVersionInfo),
  nextCursor: z.string().nullable(),
}).strict();
export type ListArtifactVersionsOutput = z.infer<typeof ListArtifactVersionsOutput>;

/* ── 二、中途插话（R3'）───────────────────────────────────────────────── */

export const InterjectError = z.enum([
  "NOT_VISIBLE",
  /** 只能对 running 状态的 run 插话（其余非终态各自有专属交互，不复用本操作）。 */
  "RUN_NOT_RUNNING",
]);
export type InterjectError = z.infer<typeof InterjectError>;

export const InterjectInput = z.object({
  runId: z.string().min(1),
  text: z.string().refine((s) => s.trim() !== "", "text 不得为空白"),
}).strict();
export type InterjectInput = z.infer<typeof InterjectInput>;

export const InterjectOutput = z.object({
  runId: z.string(),
  interjectionId: z.string(),
  /** R9：< 1 秒内前端展示"已收到"，本字段是该反馈的数据来源（服务端已接收即返回）。 */
  receivedAt: z.string(),
}).strict();
export type InterjectOutput = z.infer<typeof InterjectOutput>;

/* ── 三、操作 ──────────────────────────────────────────────────────────── */

export const operations = {
  getArtifact: {
    method: "GET",
    path: "/artifacts/:artifactId",
    in: z.object({ artifactId: z.string().min(1) }).strict(),
    out: ArtifactRecord,
    err: ["NOT_VISIBLE", "ARTIFACT_NOT_FOUND"] as const,
  },
  listArtifactVersions: {
    method: "GET",
    path: "/artifacts/:artifactId/versions",
    in: ListArtifactVersionsInput,
    out: ListArtifactVersionsOutput,
    err: ["NOT_VISIBLE", "ARTIFACT_NOT_FOUND"] as const,
  },
  continueArtifact: {
    method: "POST",
    path: "/artifacts/:artifactId/continue",
    in: ContinueArtifactInput,
    out: ContinueArtifactOutput,
    err: ["NOT_VISIBLE", "ARTIFACT_NOT_FOUND", "ARTIFACT_VERSION_NOT_FOUND"] as const,
  },
  interject: {
    method: "POST",
    path: "/agent-runs/:runId/interject",
    in: InterjectInput,
    out: InterjectOutput,
    err: ["NOT_VISIBLE", "RUN_NOT_RUNNING"] as const,
  },
};
