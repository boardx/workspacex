/**
 * issue #3367 —— 一个 `RUN_ERROR` 事件承载三类**完全不同的处置**，这里是它们的**唯一**声明处。
 *
 * ## 修的是什么（原始描述已作废，以 issue #3367 的协调裁决评论为准）
 *
 * #3367 最初的判断是「每一条写 `RUN_ERROR` 的出口都必须先把 run 落成终态」。前一条线用
 * 真栈（真 Postgres + 真 SSE，实测 SHA `6f4e55d66`）把这个前提**证伪**了：
 *   - `AGENT_RUN_TIMEOUT`：执行器**自己**会落终态（t+0 是 `running`，t+30s 变
 *     `failed/MODEL_CALL_FAILED`），SSE 这一侧抢着落库等于杀掉一条还活着的 run；
 *   - 8 个码抛出时 `runs=[]`，压根没有 run 可落；
 *   - `IDEMPOTENCY_CONFLICT` 读到的那条 `running` 是**第一轮请求正在跑的健康 run**；
 *   - `AGENT_RUN_NOT_AWAITING_TOOL_PERMISSION` 的 run 仍持有一条**有效的待批请求**，
 *     落库等于销毁一次合法的人类审批。
 * ⇒ 状态机一个字都不改。真正的缺陷在**处置**：三类事实被译成同一句
 *   「最近一次调用出错，正在等待执行状态更新……」。
 *
 * ## 三类处置
 *
 * 1. `settled`            —— 没有还活着的 run 在等（压根没创建，或已经落了终态）⇒
 *                            该收尾，别再让用户等一个不会来的更新。
 * 2. `executor_owns_run`  —— run 还活着、执行器持有它，终态会由执行器自己落
 *                            （30s–900s 内）⇒ 该继续轮询；那句「正在等待」是**诚实的**。
 * 3. `approval_pending`  —— run 停在 `awaiting_tool_permission`、仍有一条待批请求 ⇒
 *                            该**重新弹出审批卡**，而不是显示「出错了」。这一类被误译成
 *                            「出错」，正是用户看到的「永久卡死」。
 *
 * ## 这张表是门控本身，不是文档
 *
 * `AguiRunErrorCode = keyof typeof AGUI_RUN_ERROR_DISPOSITION`，而 SSE 桥
 * （`copilotkit-agui.controller.ts`）唯一的 `RUN_ERROR` 出口 `writeRunError(code)` 只收
 * 这个类型——**新增一个没在这里声明处置的码，tsc 当场红**。不是静态 grep（grep 挡不住
 * 换个写法的出口，也读不出「声明了哪一类」），也不是「新增 catch 不落库即红」那种假门
 * （上面每一支正确的「不落库」都会被它判成红）。
 *
 * ⚠ 第 3 类只是**这个码值得去核实**的声明，不是结论本身：客户端拿到它之后仍要向
 * `GET /agent-runs/:runId` 做一次权威读（`copilotkit-v2-failure-banner.ts`，与 #3280 /
 * #3261 的成因通道**同一次读、同一个模块**，不新开第二条），确认 run 真的还停在
 * `awaiting_tool_permission` 且 `pendingApproval` 非空才重挂卡片。读不到就退回横幅——
 * fail closed，绝不凭一个错误码凭空造一张审批卡出来。
 */
import { AgentRunError } from "./wave2-runtime";
import { z } from "zod";

export type AguiRunErrorDisposition = "settled" | "executor_owns_run" | "approval_pending";

/**
 * `AgentRunError` 的每一个码都意味着 run 已经被 `failRun` 落了终态（控制器只有在
 * `outcome.kind === "failed"` 之后才转发它们，见 `copilotkit-v2-failure-banner.ts` 头注
 * 逐字确认的那个顺序）⇒ 一律 `settled`。这里是 `Record<…>` 而不是散写的对象字面量：
 * zod 枚举加一个码而这里忘了跟，tsc 会红。
 */
const TERMINAL_RUN_ERROR_DISPOSITION: Record<z.infer<typeof AgentRunError>, AguiRunErrorDisposition> = {
  HITL_REJECTED: "settled",
  MODEL_PROVIDER_NOT_CONFIGURED: "settled",
  SKILL_VERSION_UNAVAILABLE: "settled",
  AGENT_VERSION_UNAVAILABLE: "settled",
  MODEL_CALL_FAILED: "settled",
  CHAT_WRITEBACK_FAILED: "settled",
  TOOL_LOOP_LIMIT_EXCEEDED: "settled",
  KERNEL_UNAVAILABLE: "settled",
  RUN_INTERRUPTED: "settled",
};

/** 桥接层自己产生的码（`AgentRunError` 枚举不含它们）。逐条理由见各自注释。 */
const BRIDGE_RUN_ERROR_DISPOSITION = {
  /**
   * 实测：SSE 这一侧的轮询预算耗尽时，run 在服务端**仍在跑**（`poll-budget.ts` 逐字：
   * "the run keeps executing server-side either way; nothing here cancels it"），
   * 执行器 30s 后自己落了 `failed/MODEL_CALL_FAILED`。所以这一支该继续轮询。
   */
  AGENT_RUN_TIMEOUT: "executor_owns_run",
  /** 第一轮请求正在跑的那条健康 run 还在——该等它，不是该报错收尾。 */
  IDEMPOTENCY_CONFLICT: "executor_owns_run",
  /* 以下都在 run 被创建之前就抛了（实测 `runs=[]`）：没有任何东西会再变。 */
  THREAD_NOT_VISIBLE: "settled",
  NO_WRITE_ROLE: "settled",
  THREAD_ARCHIVED_READONLY: "settled",
  AGENT_NOT_FOUND: "settled",
  ATTACHMENT_NOT_PENDING: "settled",
  TITLE_INVALID: "settled",
  AUTHZ_UNAVAILABLE: "settled",
  INTERNAL_ERROR: "settled",
  /** run 已经成功，只是结果读不回来——没有待批、也没有还在跑的东西。 */
  RESULT_UNREADABLE: "settled",
  /**
   * `decideToolPermission` / `decideAgentRun` 在 run **仍停在** `awaiting_tool_permission`
   * 时也会抛这个码：`stale_permission_request`（客户端拿着上一张卡的 requestId 来裁决）与
   * `form_decision_required`（这次待批的是表单类中断，走的不是权限通路）两支都是——
   * 那条**待批请求依然有效**，用户该看到的是一张能点的审批卡，不是一句「出错了」。
   */
  AGENT_RUN_NOT_AWAITING_TOOL_PERMISSION: "approval_pending",
  /**
   * `findAwaitingToolPermissionRunId` 没找到待批 run。多数情况确实已被裁决（该收尾），
   * 但按 #3367 裁决同样归入第 3 类去**核实**一次：客户端的权威读若读到仍有 `pendingApproval`
   * 就重挂卡片，读不到就退回横幅。核实是权威的，误判方向只会多一次只读请求。
   */
  NO_PENDING_APPROVAL: "approval_pending",
  /**
   * `agui-bridge.ts` 的 `projection.error ?? "UNKNOWN"` 兜底：run 已经是 `failed`
   * （只是这一行没留下码），仍然是终态 ⇒ `settled`。
   */
  UNKNOWN: "settled",
} as const satisfies Record<string, AguiRunErrorDisposition>;

/**
 * 「这个 `RUN_ERROR` 码该怎么处置」的唯一事实源，服务端（出口类型门）与客户端
 * （`copilotkit-v2-failure-banner.ts`）读的是**同一张表**——不是各写一份。
 */
export const AGUI_RUN_ERROR_DISPOSITION: Readonly<Record<string, AguiRunErrorDisposition>>
  & typeof BRIDGE_RUN_ERROR_DISPOSITION
  & Record<z.infer<typeof AgentRunError>, AguiRunErrorDisposition> = {
    ...TERMINAL_RUN_ERROR_DISPOSITION,
    ...BRIDGE_RUN_ERROR_DISPOSITION,
  };

/** SSE 桥允许写上 wire 的 `RUN_ERROR` 码——等价于「已在上表声明过处置的码」。 */
export type AguiRunErrorCode =
  | z.infer<typeof AgentRunError>
  | keyof typeof BRIDGE_RUN_ERROR_DISPOSITION;

/**
 * `agui-bridge.ts` 的 `failed` outcome 把码带成裸 `string`（`agent_runs.error_code` 由
 * SQL CHECK 约束成 `AgentRunError`，但那个约束在类型系统里到不了这一层）。这里做一次
 * **有校验的**收窄：登记过的原样透传，没登记的落到 `UNKNOWN`——与该文件原本
 * `?? "UNKNOWN"` 的兜底逐字同值，wire 上的行为一个字没变。
 *
 * ⚠ 这不是类型门的漏洞：这一支转发的是 `AgentRunError` 枚举，而上面
 * `TERMINAL_RUN_ERROR_DISPOSITION` 是 `Record<AgentRunError, …>`——枚举加一个码而这里
 * 忘了跟，tsc 照样红。
 */
export function asAguiRunErrorCode(value: string): AguiRunErrorCode {
  return Object.prototype.hasOwnProperty.call(AGUI_RUN_ERROR_DISPOSITION, value)
    ? (value as AguiRunErrorCode) : "UNKNOWN";
}

/** 未登记的码（例如纯客户端兜底 `COPILOTKIT_RUNTIME_RUN_FAILED`）按最保守的一类处置。 */
export function dispositionOf(code: string | null | undefined): AguiRunErrorDisposition {
  if (typeof code !== "string") return "settled";
  return AGUI_RUN_ERROR_DISPOSITION[code] ?? "settled";
}
