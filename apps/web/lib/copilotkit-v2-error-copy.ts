/**
 * DA-19g 评分循环第 4 轮（issue #2012，chat-ux-acceptance-criteria.md 第 7 项
 * "错误处理透明度"）—— `/chat/copilotkit-v2` 面板真实失败终态的人读文案映射。
 *
 * ## 真实缺陷是什么（2026-08-25 排查确认，不是猜测）
 *
 * `copilotkit-v2-panel.tsx` 此前只在 `await copilotkit.runAgent(...)` 自己**抛出异常**
 * 时才 `setError(e.message)`——但 `copilotkit-agui.controller.ts` 把后端失败折成的
 * AG-UI `RUN_ERROR` **事件**（`outcome.error` 这类稳定枚举码，例如
 * `"MODEL_CALL_FAILED"`）走的是另一条路：`@copilotkit/core` 的
 * `CopilotKitCore.runAgent()` 内部把这类"由已收到的 SSE 事件描述的失败"完全吸收掉
 * （只经内部 `onError` 总线广播，`await copilotkit.runAgent(...)` 这次调用本身**正常
 * resolve、不 throw**）——`copilotkit-v2-error-banner.spec.ts` 用真实浏览器触发
 * `deepAgentFailureTrigger` 实测到：等了 45s，`copilotkit-v2-error` 横幅**从未出现**，
 * `send()` 的 `try/catch` 从未捕获到任何东西。这不是"文案不够人话"这种表层问题，是
 * "这整条路径压根没有把错误亮给用户看"——本文件同时修这两层：接上正确的错误源
 * （`copilotkit.subscribe({ onError })`），并把亮出来的码译成人话。
 *
 * ## 文案表
 *
 * 覆盖两类稳定枚举码：
 *   ① `wave2Runtime.AgentRunError`（run 执行层的终态错误码，`execute-run.ts` 产生）——
 *      与 `apps/web/lib/agent-run.ts` 的 `describeAgentRunError` 同一份文案，不重开
 *      一份措辞（唯一事实源原则），这里只是转调用。
 *   ② `copilotkit-agui.controller.ts` 自己在 AG-UI 桥接层额外产生的传输层码
 *      （`AGENT_RUN_TIMEOUT`/`THREAD_NOT_VISIBLE`/... ）——`AgentRunError` 枚举不包含
 *      它们，需要单独一份文案。
 * 两类之外的未知码给一句诚实但不带原始枚举字面量的兜底文案——不是因为"藏起来"，
 * 是因为裸枚举值本来就不是人话，露出来只会让用户以为自己该认得这串大写下划线。
 */
import { describeAgentRunError, type AgentRunError } from "./agent-run";
import { wave2Runtime } from "@repo/contracts";

const AGENT_RUN_ERROR_CODES = new Set<string>(wave2Runtime.AgentRunError.options);

/**
 * `copilotkit-agui.controller.ts` 里除了转发 `AgentRunError` 之外，自己额外写死的
 * `RUN_ERROR` code 字面量（见该文件 "write({ type: EventType.RUN_ERROR, ... })" 各处）。
 * 这个 Record 的 key 集合是手写的，不像 `AgentRunError` 那样有 zod 枚举做单一事实源——
 * 新增一个传输层 code 时记得同步加一条,否则会落进下面的兜底分支。
 */
const TRANSPORT_ERROR_TEXT: Record<string, string> = {
  AGENT_RUN_TIMEOUT: "这次执行超时了，还没有等到结果",
  THREAD_NOT_VISIBLE: "这个对话你当前没有查看权限",
  NO_WRITE_ROLE: "你在这个对话里没有发言权限",
  THREAD_ARCHIVED_READONLY: "这个对话已归档，仅可查看，不能继续发言",
  AGENT_NOT_FOUND: "找不到可用的 Agent，请联系管理员",
  IDEMPOTENCY_CONFLICT: "这次请求与另一次正在进行的请求冲突，请重试",
  TITLE_INVALID: "对话标题不合法",
  RESULT_UNREADABLE: "回复已生成，但暂时读取不到内容",
  AUTHZ_UNAVAILABLE: "权限校验服务暂时不可用，请稍后重试",
  NO_PENDING_APPROVAL: "没有待处理的审批请求",
  AGENT_RUN_NOT_AWAITING_APPROVAL: "这次执行当前不处于等待审批状态",
  INTERNAL_ERROR: "系统内部出了点问题",
  COPILOTKIT_RUNTIME_RUN_FAILED: "这次请求没有成功，请重试",
  // chat-parity-attachments (issue #2022)
  ATTACHMENT_NOT_PENDING: "有附件已经失效或不属于这个对话，请移除后重新上传",
};

/**
 * 把一个可能来自 wire 的稳定枚举码译成人读文案。`code` 传 `undefined`/空字符串/
 * 未登记的陌生值时，给一句诚实但不带原始字面量的兜底——不在界面上原样印一个只有
 * 排障时才有意义的常量名。
 */
export function describeCopilotkitV2RunError(code: string | null | undefined): string {
  if (code === null || code === undefined || code.trim() === "") {
    return "执行失败，原因未知";
  }
  if (AGENT_RUN_ERROR_CODES.has(code)) {
    return describeAgentRunError(code as AgentRunError);
  }
  return TRANSPORT_ERROR_TEXT[code] ?? "这次执行没有成功，请重试或联系管理员";
}
