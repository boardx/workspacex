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
  attachmentId: z.string().optional(),
  basedOnVersion: z.number().int().min(1).nullable().optional(),
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

/** Browser read models expose only an authenticated content route, never storage keys. */
export const ArtifactPublicVersionInfo = ArtifactVersionInfo.omit({ storageKey: true }).extend({ contentUrl: z.string() });
export const ArtifactPublicRecord = ArtifactRecord.omit({ versions: true }).extend({ versions: z.array(ArtifactPublicVersionInfo) });
export type ArtifactPublicRecord = z.infer<typeof ArtifactPublicRecord>;

export const ArtifactError = z.enum([
  "NOT_VISIBLE",
  "ARTIFACT_NOT_FOUND",
  /** E2：指定版本已不存在（不允许默默使用错误版本）。 */
  "ARTIFACT_VERSION_NOT_FOUND",
]);
export type ArtifactError = z.infer<typeof ArtifactError>;

export const ArtifactContinuationContext = z.object({
  artifactId: z.string().min(1), basedOnVersion: z.number().int().min(1),
}).strict();
export type ArtifactContinuationContext = z.infer<typeof ArtifactContinuationContext>;

export const ContinueArtifactInput = z.object({
  clientRequestId: z.string().uuid().optional(),
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

/* ── 二′、插话回灌内核（Phase 14 后续 A，#2755）───────────────────────── */

/**
 * 网关侧对一条插话的判定（R7：插话默认是对当前任务的调整；E3：方向性改变要重新走
 * L2 授权确认）。判定算法属于内核实现细节、不在契约里规定（A2/E3）——契约只固定
 * 两个取值，供 TS 网关（`interjection-handling.ts`）与 Python 内核（`harness.py`）
 * 共用同一份枚举，不各写一份。
 */
export const InterjectionClassification = z.enum(["adjustment", "direction_change"]);
export type InterjectionClassification = z.infer<typeof InterjectionClassification>;

/**
 * 一条已被网关检查点消费、待投递给内核的插话——`ModelCallInput.interjection` 的形状，
 * 也是投影到 LangGraph `config.configurable[KERNEL_INTERJECTION_CONFIGURABLE_KEY]`
 * 的**线上形状**（字段名逐字跨语言：Python 侧 `harness.py` 按同一组键名读，
 * `packages/contracts/tests/artifacts-steering/cross-lang-interjection-parity.test.ts`
 * 机械比对两侧）。
 *
 * 这不是 HTTP 操作的 in/out（不进 `operations`）——它走的是 kernel-gateway 束
 * `forwardRun` 已有的 per-run configurable 通道（同 `org_skills`/`script_protocol`），
 * 是那条通道上新增的一个键。
 */
export const KernelInterjection = z.object({
  interjectionId: z.string().min(1),
  text: z.string().refine((s) => s.trim() !== "", "text 不得为空白"),
  classification: InterjectionClassification,
  /** 同 `InterjectOutput.receivedAt`：服务端收到插话的时刻。 */
  receivedAt: z.string(),
}).strict();
export type KernelInterjection = z.infer<typeof KernelInterjection>;

/**
 * LangGraph `config.configurable` 里承载 `KernelInterjection` 的键名——TS provider
 * 写、Python `harness.py` 读，唯一事实源在这里。
 */
export const KERNEL_INTERJECTION_CONFIGURABLE_KEY = "interjection";

/* ── 三、操作 ──────────────────────────────────────────────────────────── */

export const operations = {
  getArtifact: {
    method: "GET",
    path: "/artifacts/:artifactId",
    in: z.object({ artifactId: z.string().min(1) }).strict(),
    out: ArtifactPublicRecord,
    err: ["NOT_VISIBLE", "ARTIFACT_NOT_FOUND"] as const,
  },
  listArtifactVersions: {
    method: "GET",
    path: "/artifacts/:artifactId/versions",
    in: ListArtifactVersionsInput,
    out: ListArtifactVersionsOutput.omit({ versions: true }).extend({ versions: z.array(ArtifactPublicVersionInfo) }),
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
