/**
 * 契约束 `error-observability` —— 签核③（API 契约）落点。Phase 14 F13/F14/F15。
 *
 * 设计签核见 `phases/phase-14-agent-kernel-unification/contracts/error-observability/`
 * （`design-signoff.md` status: pending，待人类签核）。翻译自
 * `requirements/05-error-observability.md` 的 R3/R3'/R4/R6/R7，不发挥。
 *
 * ## 这是什么
 *
 * 三件事：① 精确的错误分类（`FailureCode`，取消"未识别异常一律 SANDBOX_UNAVAILABLE"
 * 的兜底误标）；② 错误人性化转换（`HumanizedError`，`message` + `suggestedAction`，
 * 每个 `FailureCode` 都有映射，可遍历验证无遗漏——R4 E2）；③ 完整可审计 transcript
 * （字段级加密存储 + RBAC 审计接口，取代"digest + 截断摘要"）。
 */
import { z } from "zod";

/* ── 一、错误分类（R3 步骤 2，R7：分类准确性优先于"总能给出一个分类"）──── */

export const FailureCode = z.enum([
  /** 模型调用失败（本 phase 触发 bug 回归用例：不得再误标为 SANDBOX_UNAVAILABLE）。 */
  "MODEL_CALL_FAILED",
  /** 沙箱不可用/超时——区别于模型/内核故障，不混淆（kernel-gateway 束的 E2 同源）。 */
  "SANDBOX_UNAVAILABLE",
  /** 内核进程崩溃或长时间无响应且未产生任何事件（streaming-transport 束 R4 E3）。 */
  "KERNEL_UNRESPONSIVE",
  /** 用户在计划确认阶段主动取消（R4 A1，非真正意义上的"失败"，但走同一错误通道呈现）。 */
  "USER_CANCELLED",
  /** 诚实的兜底类别：分类器无法归入以上任何一类，宁可标"未知"也不能张冠李戴（R7）。 */
  "UNKNOWN_EXECUTION_ERROR",
]);
export type FailureCode = z.infer<typeof FailureCode>;

/* ── 二、人性化转换（R3 步骤 3，R4 E2）─────────────────────────────────── */

export const SuggestedActionKind = z.enum(["retry", "simplify", "contact"]);
export type SuggestedActionKind = z.infer<typeof SuggestedActionKind>;

export const SuggestedAction = z.object({
  kind: SuggestedActionKind,
  label: z.string(),
  hint: z.string(),
}).strict();
export type SuggestedAction = z.infer<typeof SuggestedAction>;

export const HumanizedError = z.object({
  runId: z.string(),
  failureCode: FailureCode,
  /** 面向用户的可读消息，主展示区可见（R7：任何情况下不得直接暴露内部错误码/堆栈）。 */
  message: z.string(),
  /** 至少覆盖 重试/简化任务重试/联系支持 三种（R3 步骤 3）。 */
  suggestedActions: z.array(SuggestedAction).min(1),
  /** 原始技术信息，"查看详情"折叠区默认收起，仅 run 发起者本人可见（R5）。 */
  rawDetails: z.object({ errorCode: z.string(), stack: z.string().nullable() }).strict(),
}).strict();
export type HumanizedError = z.infer<typeof HumanizedError>;

/**
 * `FailureCode` → 至少一个 `SuggestedActionKind` 的映射，供契约测试遍历验证无遗漏
 * （R4 E2：某个错误码没有映射到任何 suggestedAction 应被视为契约不完整）。
 * 单一事实源——`HumanizedError.suggestedActions` 的生成不得绕开这份映射另写一份。
 */
export const FAILURE_CODE_SUGGESTED_ACTIONS: Record<FailureCode, readonly SuggestedActionKind[]> = {
  MODEL_CALL_FAILED: ["retry", "simplify", "contact"],
  SANDBOX_UNAVAILABLE: ["retry", "contact"],
  KERNEL_UNRESPONSIVE: ["retry", "contact"],
  USER_CANCELLED: ["retry"],
  UNKNOWN_EXECUTION_ERROR: ["retry", "contact"],
};

/* ── 三、完整可审计 transcript（R3'，R6：完整内容 + 字段级加密）──────── */

export const TranscriptStepKind = z.enum([
  "model_call", "tool_call", "plan_change", "permission_decision",
]);
export type TranscriptStepKind = z.infer<typeof TranscriptStepKind>;

export const TranscriptDecryptStatus = z.enum(["ok", "unreadable"]);
export type TranscriptDecryptStatus = z.infer<typeof TranscriptDecryptStatus>;

export const TranscriptStep = z.object({
  runStepId: z.string(),
  kind: TranscriptStepKind,
  /** 完整 prompt/response 内容（字段级加密存储；E3：密钥不可用时 status=unreadable）。 */
  decryptStatus: TranscriptDecryptStatus,
  /** decryptStatus === "ok" 时非 null；"unreadable" 时为 null，不静默返回空值伪装成功。 */
  fullContent: z.string().nullable(),
  createdAt: z.string(),
}).strict();
export type TranscriptStep = z.infer<typeof TranscriptStep>;

export const GetRunTranscriptError = z.enum([
  /** 仅限运维/开发角色；普通用户不能访问其他用户 run 的完整 transcript（R5）。 */
  "FORBIDDEN",
  "RUN_NOT_FOUND",
]);
export type GetRunTranscriptError = z.infer<typeof GetRunTranscriptError>;

export const GetRunTranscriptInput = z.object({ runId: z.string().min(1) }).strict();
export type GetRunTranscriptInput = z.infer<typeof GetRunTranscriptInput>;

export const GetRunTranscriptOutput = z.object({
  runId: z.string(),
  steps: z.array(TranscriptStep),
}).strict();
export type GetRunTranscriptOutput = z.infer<typeof GetRunTranscriptOutput>;

/* ── 四、操作 ──────────────────────────────────────────────────────────── */

export const operations = {
  /** R3 步骤 4-5：run 到达 failed 时事件携带的人性化结构（前端错误卡片消费）。 */
  getRunFailure: {
    method: "GET",
    path: "/agent-runs/:runId/failure",
    in: z.object({ runId: z.string().min(1) }).strict(),
    out: HumanizedError,
    err: ["NOT_VISIBLE"] as const,
  },
  /** R3'：审计接口，读取某次 run 的完整执行 transcript（仅运维/开发角色）。 */
  getRunTranscript: {
    method: "GET",
    path: "/agent-runs/:runId/transcript",
    in: GetRunTranscriptInput,
    out: GetRunTranscriptOutput,
    err: ["FORBIDDEN", "RUN_NOT_FOUND"] as const,
  },
};
