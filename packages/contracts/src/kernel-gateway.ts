/**
 * 契约束 `kernel-gateway` —— 签核③（API 契约）落点。Phase 14 F01/F02。
 *
 * 设计签核见 `phases/phase-14-agent-kernel-unification/contracts/kernel-gateway/`
 * （`design-signoff.md` status: pending，待人类签核）。本文件是那份签核草案 §四
 * 「③ API 契约」承诺的 `packages/contracts/src/kernel-gateway.ts`——把
 * `requirements/01-kernel-unification.md` 的 R3/R4/R6/R7 翻译成 zod 单一事实源，
 * 不发挥、不新增需求未写的字段。
 *
 * ## 这是什么
 *
 * `apps/api` 网关与 `apps/deep-agent-service` 内核之间**内部**边界的契约：
 * ① 网关把用户任务转发给内核（`forwardRun`）；② 内核请求网关代理执行有副作用的
 * 工具调用（`proxyToolExecution`，网关是唯一有权决定"是否允许执行"的组件，R5）。
 * 这两个操作**不对前端暴露**——前端看到的是 `streaming-transport` 束的事件流与
 * `agent-runs` 资源，本束是网关↔内核这一层的契约，之所以进 `packages/contracts`
 * 而不是留在某个服务内部，是因为 R7 明确禁止 `apps/api` 侧再长出第二套规划/循环
 * 实现——契约在这里能被 `lint-arch-deps` 与跨语言一致性测试同时看见。
 *
 * ## 不变量对应（domain.md 权威，此处只引用）
 *
 * - I-1 单一执行内核：`forwardRun` 是 `apps/api` 侧允许存在的**唯一**規划/执行入口。
 * - I-2 网关代理执行：`proxyToolExecution` 是内核请求有副作用操作的**唯一**通路，
 *   内核不得绕过它直接执行任何工具（R5）。
 */
import { z } from "zod";

/* ── 一、健康检查与快速失败（R4 A1）───────────────────────────────────── */

export const KernelHealthStatus = z.enum(["healthy", "unavailable"]);
export type KernelHealthStatus = z.infer<typeof KernelHealthStatus>;

/* ── 二、网关转发 run 请求给内核（R3 步骤 1-2）────────────────────────── */

export const GatewayForwardRunError = z.enum([
  /** R4 A1：下发前健康检查未过，快速失败，不让请求悬挂等超时。 */
  "KERNEL_UNAVAILABLE",
  /** 鉴权/组织隔离校验未过。 */
  "FORBIDDEN",
]);
export type GatewayForwardRunError = z.infer<typeof GatewayForwardRunError>;

export const ForwardRunInput = z.object({
  threadId: z.string().min(1),
  /** 触发本次转发的用户消息，F05 一逻辑 run 多次续跑仍指向同一条消息。 */
  messageId: z.string().min(1),
  /** 从 checkpoint 续跑时携带；首次发起为 null（R4 E4，02 束共同消费本字段）。 */
  resumeFromCheckpointId: z.string().nullable(),
}).strict();
export type ForwardRunInput = z.infer<typeof ForwardRunInput>;

export const ForwardRunOutput = z.object({
  runId: z.string(),
  /** 内核侧承接该 run 的进程/图执行标识，供后续事件订阅与 checkpoint 关联。 */
  kernelSessionId: z.string(),
}).strict();
export type ForwardRunOutput = z.infer<typeof ForwardRunOutput>;

/* ── 三、内核请求网关代理执行工具调用（R3 步骤 4-5，R5）───────────────── */

export const ProxyToolExecutionError = z.enum([
  /** E2：沙箱本身故障，区别于模型/内核故障（呼应 error-observability 束的分类修复）。 */
  "SANDBOX_UNAVAILABLE",
  /** 该工具调用未被授权执行（权限判断结果，具体分级归 plan-permissions 束）。 */
  "EXECUTION_NOT_PERMITTED",
]);
export type ProxyToolExecutionError = z.infer<typeof ProxyToolExecutionError>;

export const ProxyToolExecutionRequest = z.object({
  runId: z.string().min(1),
  toolCallId: z.string().min(1),
  toolName: z.string().min(1),
  /** 完整入参，不是截断摘要（呼应 03 束 R6 后置条件对完整信息的要求）。 */
  args: z.record(z.unknown()),
}).strict();
export type ProxyToolExecutionRequest = z.infer<typeof ProxyToolExecutionRequest>;

export const ProxyToolExecutionResult = z.object({
  toolCallId: z.string(),
  ok: z.boolean(),
  /** 成功时的完整结果；失败时为 null，错误信息走 error 字段。 */
  result: z.unknown().nullable(),
  error: ProxyToolExecutionError.nullable(),
}).strict();
export type ProxyToolExecutionResult = z.infer<typeof ProxyToolExecutionResult>;

/* ── 四、能力开关默认状态（F02，仅供部署期一次性校验，非长期配置面）──── */

/**
 * R6 后置条件点名的六个开关符号。**本枚举不是"配置项契约"**——F02 的后置条件是
 * 这些开关本身从代码库移除，本枚举只是验证脚本用来遍历"曾经存在过的六个符号确实
 * 都已从代码中消失"的静态扫描目标清单，不代表运行时还有一个叫这个名字的可读配置。
 */
export const DEEP_AGENT_REMOVED_FLAG_NAMES = [
  "DEEP_AGENT_SUBAGENTS_ENABLED",
  "DEEP_AGENT_ASYNC_SUBTASKS_ENABLED",
  "DEEP_AGENT_TASK_AUTO_CLASSIFY",
  "DEEP_AGENT_PRECOMPLETION_CHECKLIST",
  "DEEP_AGENT_HITL_TOOLS",
  "DEEP_AGENT_CHECKPOINT_DB",
] as const;
export type DeepAgentRemovedFlagName = (typeof DEEP_AGENT_REMOVED_FLAG_NAMES)[number];

/* ── 五、操作 ──────────────────────────────────────────────────────────── */

export const operations = {
  /** R3 步骤 1-2：网关鉴权后转发 run 请求给内核。内部操作，不是公开 HTTP 路由。 */
  forwardRun: {
    in: ForwardRunInput,
    out: ForwardRunOutput,
    err: ["KERNEL_UNAVAILABLE", "FORBIDDEN"] as const,
  },
  /** R3 步骤 4-5：内核请求网关代理执行有副作用的工具调用。内部操作。 */
  proxyToolExecution: {
    in: ProxyToolExecutionRequest,
    out: ProxyToolExecutionResult,
    err: ["SANDBOX_UNAVAILABLE", "EXECUTION_NOT_PERMITTED"] as const,
  },
  /** R4 A1：下发前健康检查。 */
  checkKernelHealth: {
    in: z.object({}).strict(),
    out: z.object({ status: KernelHealthStatus }).strict(),
  },
};
