"use client";
import * as React from "react";
import { MessageRunContext } from "@/lib/chat-workbench/trace-context";
import { CopilotChatMessageView, CopilotChatAssistantMessage, useRenderToolCall } from "@copilotkit/react-core/v2";
import { progressMessageIds, type TraceStore, type TraceEntry } from "@/lib/chat-workbench/run-trace";
import { V2AssistantMessage } from "@/components/chat/copilotkit-v2-assistant-message";
import { RunInterjections } from "./run-interjections";
import { RunTracePanel } from "./run-trace-panel";
import { RunTraceCoveredContext, isDecisionTool } from "@/lib/chat-workbench/trace-context";

function ExecutionTool({ entry }: { entry: TraceEntry }): React.ReactNode {
  const render = useRenderToolCall();
  return render({
    toolCall: { id: entry.id, type: "function", function: { name: entry.kind === "skill" ? "call_skill" : entry.text, arguments: JSON.stringify(entry.args ?? {}) } },
    toolMessage: entry.result === undefined ? undefined : { id: `${entry.id}:result`, role: "tool", toolCallId: entry.id, content: typeof entry.result === "string" ? entry.result : JSON.stringify(entry.result) ?? "" },
  });
}
const EMPTY_IDS: ReadonlySet<string> = new Set();
const renderExecutionTool = (entry: TraceEntry) => {
  const toolName = entry.kind === "skill" ? "call_skill" : entry.text;
  // write_todos is already projected as the single durable plan ledger. Keep its
  // trace row, arguments and status for audit, but do not turn every journal
  // snapshot into another full plan card inside the expanded trace.
  return isDecisionTool(toolName) || toolName === "write_todos" ? null : <ExecutionTool entry={entry} />;
};
type TraceContext = { events: TraceStore; messageRuns: Readonly<Record<string, string>>; toolCallMessageIds?: ReadonlySet<string>; expanded?: Record<string, boolean>; toggle?: (runId: string, value: boolean) => void };
const TraceContext = React.createContext<TraceContext & { anchors?: Readonly<Record<string, string>> }>({ events: {}, messageRuns: {} });
/**
 * 每个 run 的执行轨迹面板挂在哪条消息下——**唯一**一份事实。
 *
 * 以前这条事实被声明了两次：`TraceAssistant` 自己用 `props.messages.find(...)` 算一次
 * 决定「我要不要画面板」，`TaskTimeline` 底部又用 `displayed` 算一次决定「fallback 槽
 * 要不要画」。两处算法看着等价，实际会分叉——`props.messages` 经过
 * `MemoizedAssistantMessage` 的 `React.memo`，可能是**旧数组**；长线程里被选中的锚点
 * 还可能落在虚拟化窗口之外**根本没渲染**。两边一分叉就是最坏情况：inline 不画、
 * fallback 又被抑制，用户一个面板都看不到（issue #3168 引入的 D2 回归）。
 *
 * 现在只算一次、从 context 下发，`displayed` 就是 `Object.keys(anchors)`。
 *
 * `toolCallMessageIds` = `@ag-ui/client` 为不带 `parentMessageId` 的 `TOOL_CALL_START`
 * 新造的合成气泡（见 `use-run-trace.ts`）。它们**绑**到 run（D1 需要，否则定制卡片
 * 掉回 legacy 分组），但**不当锚点**：它们排在本轮回答正文前面，会把面板从回答上方
 * 拽到用户提问正下方。
 */
export function resolveTraceAnchors(
  messages: readonly { id: string; role?: string }[] | undefined,
  messageRuns: Readonly<Record<string, string>>,
  toolCallMessageIds: ReadonlySet<string>,
): Record<string, string> {
  const anchors: Record<string, string> = {};
  for (const message of messages ?? []) {
    if (message.role !== "assistant" || toolCallMessageIds.has(message.id)) continue;
    const runId = messageRuns[message.id];
    if (runId && anchors[runId] === undefined) anchors[runId] = message.id;
  }
  return anchors;
}
function TraceAssistant(props: React.ComponentProps<typeof CopilotChatAssistantMessage>): JSX.Element {
  const { events, messageRuns, anchors, expanded, toggle } = React.useContext(TraceContext);
  const runId = messageRuns[props.message.id];
  const trace = runId ? events[runId] : undefined;
  // 锚点从 context 读（永远是最新的一份），不再从可能被 memo 冻住的 `props.messages` 里重算。
  const isAnchor = runId !== undefined && anchors?.[runId] === props.message.id;
  return <>
    {runId && trace?.length && isAnchor ? <RunTracePanel runId={runId} events={trace} renderTool={renderExecutionTool} running={props.isRunning && !trace.some((event) => event.kind === "final_message")} expanded={expanded?.[runId] ?? false} onExpandedChange={(value) => toggle?.(runId, value)} /> : null}
    {trace && isAnchor ? <RunInterjections events={trace} readHistory={runId ? expanded?.[runId] : false} /> : null}
    <MessageRunContext.Provider value={runId ?? null}><RunTraceCoveredContext.Provider value={Boolean(trace?.length)}><V2AssistantMessage {...props} message={trace && progressMessageIds(trace).has(props.message.id) ? { ...props.message, content: "" } : props.message} /></RunTraceCoveredContext.Provider></MessageRunContext.Provider>
  </>;
}
const TraceAssistantSlot = Object.assign(TraceAssistant, CopilotChatAssistantMessage);
export function TaskTimeline({ events, messageRuns, toolCallMessageIds = EMPTY_IDS, ...props }: React.ComponentProps<typeof CopilotChatMessageView> & TraceContext): JSX.Element {
  const [expanded, setExpanded] = React.useState<Record<string, boolean>>({});
  const toggle = React.useCallback((runId: string, state: boolean) => setExpanded((previous) => ({ ...previous, [runId]: state })), []);
  const anchors = React.useMemo(() => resolveTraceAnchors(props.messages, messageRuns, toolCallMessageIds), [props.messages, messageRuns, toolCallMessageIds]);
  const value = React.useMemo(() => ({ events, messageRuns, anchors, expanded, toggle }), [events, messageRuns, anchors, expanded, toggle]);
  // 同一份事实的另一面：有锚点的 run 由 inline 槽画，没锚点的才由 fallback 槽画。
  const displayed = new Set(Object.keys(anchors));
  return <TraceContext.Provider value={value}>
    <CopilotChatMessageView {...props} assistantMessage={TraceAssistantSlot} />
    {Object.entries(events).filter(([runId]) => !displayed.has(runId)).map(([runId, trace]) =>
      <React.Fragment key={runId}><RunInterjections events={trace} readHistory={runId ? expanded?.[runId] : false} /><RunTracePanel runId={runId} events={trace} renderTool={renderExecutionTool} running={props.isRunning && !trace.some((event) => event.kind === "final_message")} expanded={expanded?.[runId] ?? false} onExpandedChange={(value) => toggle?.(runId, value)} /></React.Fragment>)}
  </TraceContext.Provider>;
}
