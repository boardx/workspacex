import { EventType } from "@ag-ui/core";
import { AGUI_EXECUTION_EVENT_NAME, type ExecutionEvent } from "@repo/contracts/execution-journal";

type JournalWireEvent =
  | { type: EventType.CUSTOM; name: string; value: ExecutionEvent }
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
  const close = () => {
    if (openMessage) write({ type: EventType.TEXT_MESSAGE_END, messageId: openMessage });
    openMessage = null;
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
      write({ type: EventType.TOOL_CALL_START, toolCallId: event.toolCallId, toolCallName: event.toolName });
      write({ type: EventType.TOOL_CALL_ARGS, toolCallId: event.toolCallId, delta: JSON.stringify(event.args ?? {}) });
      write({ type: EventType.TOOL_CALL_END, toolCallId: event.toolCallId });
    } else if (event.kind === "tool_end") {
      write({ type: EventType.TOOL_CALL_RESULT, toolCallId: event.toolCallId,
        messageId: `${event.toolCallId}:result`, role: "tool",
        content: typeof event.result === "string" ? event.result : JSON.stringify(event.result ?? null) });
    } else if (event.kind === "final_message") {
      finalMessageId = event.messageId;
      messageId = event.messageId;
      sawText = seenMessages.has(messageId);
    }
    return { messageId, sawText };
  };
  const finish = (persistedMessageId: string, text: string): string => {
    close();
    // Identity proves which message is final; equality only verifies that its full
    // bytes reached this connection (a dropped SSE tail must not truncate the answer).
    if (finalMessageId && seenMessages.has(finalMessageId) && messageText.get(finalMessageId) === text) return finalMessageId;
    write({type:EventType.TEXT_MESSAGE_START,messageId:persistedMessageId,role:"assistant"});
    write({type:EventType.TEXT_MESSAGE_CONTENT,messageId:persistedMessageId,delta:text});
    write({type:EventType.TEXT_MESSAGE_END,messageId:persistedMessageId});
    return persistedMessageId;
  };
  return { accept, close, finish };
}
