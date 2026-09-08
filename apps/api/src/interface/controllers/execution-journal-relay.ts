import {
  AGUI_ASSISTANT_MESSAGE_REPLACED_EVENT_NAME,
  type AguiAssistantMessageReplacedValue,
  parseWriteTodosSnapshot,
} from "@repo/contracts/agui-state-events";
import { EventType } from "@ag-ui/core";
import { AGUI_EXECUTION_EVENT_NAME, type ExecutionEvent } from "@repo/contracts/execution-journal";

type JournalWireEvent =
  | { type: EventType.STEP_STARTED | EventType.STEP_FINISHED; stepName: string }
  | { type: EventType.STATE_SNAPSHOT; snapshot: NonNullable<ReturnType<typeof parseWriteTodosSnapshot>> }
  | { type: EventType.CUSTOM; name: string; value: ExecutionEvent | AguiAssistantMessageReplacedValue }
  | { type: EventType.TEXT_MESSAGE_START; messageId: string; role: "assistant" }
  | { type: EventType.TEXT_MESSAGE_CONTENT; messageId: string; delta: string }
  | { type: EventType.TEXT_MESSAGE_END; messageId: string }
  | { type: EventType.TOOL_CALL_START; toolCallId: string; toolCallName: string }
  | { type: EventType.TOOL_CALL_ARGS; toolCallId: string; delta: string }
  | { type: EventType.TOOL_CALL_END; toolCallId: string }
  | { type: EventType.TOOL_CALL_RESULT; toolCallId: string; messageId: string; role: "tool"; content: string };

/** One ordered journal drives both the visible trace and standard AG-UI messages. */
export function createExecutionJournalRelay(write: (event: JournalWireEvent) => void) {
  let openMessage: string | null = null;
  let messageId: string | null = null;
  let sawText = false;
  const seenMessages = new Set<string>();
  const messageText = new Map<string, string>();
  let finalMessageId: string | null = null;
  const cursors = new Map<string, number>();
  const activeSteps = new Map<string, string>();
  // The persisted step projection and journal are separate reads. Match completed
  // write_todos occurrences in their shared execution order, never public args.
  const planSteps: Array<ReturnType<typeof parseWriteTodosSnapshot>> = [];
  const planResults: boolean[] = [];
  const flushPlans = () => {
    while (planSteps.length && planResults.length) {
      const snapshot = planSteps.shift();
      const ok = planResults.shift();
      if (ok && snapshot) write({ type: EventType.STATE_SNAPSHOT, snapshot });
    }
  };
  const acceptPlanStep = (step: { toolName: string | null; status: string; toolArgsSummary: string | null }) => {
    if (step.toolName !== "write_todos" || !["succeeded", "failed"].includes(step.status)) return;
    planSteps.push(step.status === "succeeded" && step.toolArgsSummary !== null ? parseWriteTodosSnapshot(step.toolArgsSummary) : null);
    flushPlans();
  };
  const close = () => {
    if (openMessage) write({ type: EventType.TEXT_MESSAGE_END, messageId: openMessage });
    openMessage = null;
  };
  const closeTurn = () => {
    close();
    // AG-UI requires closed step envelopes before RUN_FINISHED, including HITL.
    // This closes presentation only; no tool result is fabricated.
    for (const stepName of activeSteps.values()) write({ type: EventType.STEP_FINISHED, stepName });
    activeSteps.clear();
  };
  const accept = (event: ExecutionEvent) => {
    if (event.seq <= (cursors.get(event.runId) ?? -1)) return { messageId, sawText };
    cursors.set(event.runId, event.seq);
    write({ type: EventType.CUSTOM, name: AGUI_EXECUTION_EVENT_NAME, value: event });
    if (event.kind === "text_delta") {
      if (openMessage !== event.messageId) {
        close();
        openMessage = event.messageId;
        messageId = event.messageId;
        seenMessages.add(messageId);
        write({ type: EventType.TEXT_MESSAGE_START, messageId, role: "assistant" });
      }
      sawText = true;
      messageText.set(event.messageId, (messageText.get(event.messageId) ?? "") + event.delta);
      write({ type: EventType.TEXT_MESSAGE_CONTENT, messageId: event.messageId, delta: event.delta });
    } else if (event.kind === "tool_start") {
      finalMessageId = null;
      close();
      activeSteps.set(event.toolCallId, event.toolName);
      write({ type: EventType.STEP_STARTED, stepName: event.toolName });
      if (!sawText && event.planningNote?.trim()) {
        const planningId = `${event.toolCallId}:planning`;
        write({ type: EventType.TEXT_MESSAGE_START, messageId: planningId, role: "assistant" });
        write({ type: EventType.TEXT_MESSAGE_CONTENT, messageId: planningId, delta: event.planningNote });
        write({ type: EventType.TEXT_MESSAGE_END, messageId: planningId });
      }
      write({ type: EventType.TOOL_CALL_START, toolCallId: event.toolCallId, toolCallName: event.toolName });
      write({ type: EventType.TOOL_CALL_ARGS, toolCallId: event.toolCallId, delta: JSON.stringify(event.args ?? {}) });
      write({ type: EventType.TOOL_CALL_END, toolCallId: event.toolCallId });
    } else if (event.kind === "tool_end") {
      write({ type: EventType.TOOL_CALL_RESULT, toolCallId: event.toolCallId,
        messageId: `${event.toolCallId}:result`, role: "tool",
        content: typeof event.result === "string" ? event.result : JSON.stringify(event.result ?? null) });
      if (activeSteps.delete(event.toolCallId)) write({ type: EventType.STEP_FINISHED, stepName: event.toolName });
      if (event.toolName === "write_todos") { planResults.push(event.ok); flushPlans(); }
    } else if (event.kind === "final_message") {
      finalMessageId = event.messageId;
      messageId = event.messageId;
      sawText = seenMessages.has(messageId);
    }
    return { messageId, sawText };
  };
  /**
   * 返回「wire 上承载本轮最终 assistant 正文的那条气泡的 id」。调用方据此发
   * `chat_message_id` 映射。返回值等于 `persistedMessageId` 只发生在「本轮一条流式气泡
   * 都没流出去」时——那时 wire 上唯一那条气泡的 id 本来就是主键，映射是一句真话而不是
   * 退化（见 `AguiChatMessageIdValue` 头注第 2 条）。有流式气泡时**必须**返回那条气泡的
   * id，绝不返回主键：那正是 #3069 的自映射形态。
   */
  const finish = (persistedMessageId: string, text: string): string => {
    closeTurn();
    // Identity proves which message is final; equality only verifies that its full
    // bytes reached this connection (a dropped SSE tail must not truncate the answer).
    if (finalMessageId && seenMessages.has(finalMessageId) && messageText.get(finalMessageId) === text) return finalMessageId;
    // issue #3069 —— 回放兜底是**替换**，不是追加。身份不成立时（典型：`tool_start`
    // 把 `finalMessageId` 清掉、此后账本再无正文）已经流出去的气泡带的是「预告」正文，
    // 与落库那行对不上；直接再发一条终稿气泡会让一轮里出现两条互相矛盾的 assistant
    // 正文，且映射事件退化成自映射（#3069 的基线红）。所以先撤回已流出的全部气泡，
    // 再用**它们当中的第一条**的 id 重新呈现落库正文——沿用第一条而不是另起 id，
    // 是为了不改写「wire 上第一个 TEXT_MESSAGE_START 就是这一轮的 assistant 气泡」
    // 这条既有不变量（`copilotkit-v2-roster-landing.spec.ts` 正是照它取证的）。
    // 一条都没流出去时无可撤回，直接用落库主键当气泡 id（此时它就是真主键，映射无事可做）。
    //
    // ⚠ 撤回范围就是 `seenMessages`（账本 `text_delta` 产生的气泡），不另立第二份清单：
    // `tool_start` 的 planningNote 气泡**不在**其中，它是「可见的规划步骤」
    // （chat-ux-acceptance-criteria.md 第 2 条），与回答正文并存而不是同一段话的另一版本
    // ——`agui-bridge-tool-call-events.test.ts` 在无流式正文时逐条断言「规划摘要 + 最终
    // 答案」两条气泡，那是刻意的，把它一并撤回等于悄悄改掉一个绿着的既有行为。
    const streamedBubbles = [...seenMessages];
    const carrier = streamedBubbles[0] ?? persistedMessageId;
    if (streamedBubbles.length > 0) {
      write({
        type: EventType.CUSTOM,
        name: AGUI_ASSISTANT_MESSAGE_REPLACED_EVENT_NAME,
        value: { replacedMessageIds: streamedBubbles, replacementMessageId: carrier },
      });
    }
    write({type:EventType.TEXT_MESSAGE_START,messageId:carrier,role:"assistant"});
    write({type:EventType.TEXT_MESSAGE_CONTENT,messageId:carrier,delta:text});
    write({type:EventType.TEXT_MESSAGE_END,messageId:carrier});
    return carrier;
  };
  return { accept, acceptPlanStep, close: closeTurn, finish };
}
