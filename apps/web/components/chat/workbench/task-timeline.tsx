"use client";
import * as React from "react";
import { CopilotChatMessageView, CopilotChatAssistantMessage, useRenderToolCall } from "@copilotkit/react-core/v2";
import { progressMessageIds, type TraceStore, type TraceEntry } from "@/lib/chat-workbench/run-trace";
import { V2AssistantMessage } from "@/components/chat/copilotkit-v2-assistant-message";
import { RunTracePanel } from "./run-trace-panel";
import { RunTraceCoveredContext, isDecisionTool } from "@/lib/chat-workbench/trace-context";

function ExecutionTool({ entry }: { entry: TraceEntry }): React.ReactNode {
  const render = useRenderToolCall();
  return render({
    toolCall: { id: entry.id, type: "function", function: { name: entry.kind === "skill" ? "call_skill" : entry.text, arguments: JSON.stringify(entry.args ?? {}) } },
    toolMessage: entry.result === undefined ? undefined : { id: `${entry.id}:result`, role: "tool", toolCallId: entry.id, content: typeof entry.result === "string" ? entry.result : JSON.stringify(entry.result) ?? "" },
  });
}
const renderExecutionTool = (entry: TraceEntry) => isDecisionTool(entry.kind === "skill" ? "call_skill" : entry.text) ? null : <ExecutionTool entry={entry} />;
type TraceContext = { events: TraceStore; messageRuns: Readonly<Record<string, string>>; expanded?: Record<string, boolean>; toggle?: (runId: string, value: boolean) => void };
const TraceContext = React.createContext<TraceContext>({ events: {}, messageRuns: {} });
function TraceAssistant(props: React.ComponentProps<typeof CopilotChatAssistantMessage>): JSX.Element {
  const { events, messageRuns, expanded, toggle } = React.useContext(TraceContext);
  const runId = messageRuns[props.message.id];
  const trace = runId ? events[runId] : undefined;
  const first = props.messages?.find((message) => message.role === "assistant" && messageRuns[message.id] === runId);
  return <>
    {runId && trace?.length && first?.id === props.message.id ? <RunTracePanel runId={runId} events={trace} renderTool={renderExecutionTool} running={props.isRunning && !trace.some((event) => event.kind === "final_message")} expanded={expanded?.[runId] ?? false} onExpandedChange={(value) => toggle?.(runId, value)} /> : null}
    <RunTraceCoveredContext.Provider value={Boolean(trace?.length)}><V2AssistantMessage {...props} message={trace && progressMessageIds(trace).has(props.message.id) ? { ...props.message, content: "" } : props.message} /></RunTraceCoveredContext.Provider>
  </>;
}
const TraceAssistantSlot = Object.assign(TraceAssistant, CopilotChatAssistantMessage);
export function TaskTimeline({ events, messageRuns, ...props }: React.ComponentProps<typeof CopilotChatMessageView> & TraceContext): JSX.Element {
  const [expanded, setExpanded] = React.useState<Record<string, boolean>>({});
  const toggle = React.useCallback((runId: string, state: boolean) => setExpanded((previous) => ({ ...previous, [runId]: state })), []);
  const value = React.useMemo(() => ({ events, messageRuns, expanded, toggle }), [events, messageRuns, expanded, toggle]);
  const displayed = new Set((props.messages ?? []).filter((message) => message.role === "assistant").map((message) => messageRuns[message.id]));
  return <TraceContext.Provider value={value}>
    <CopilotChatMessageView {...props} assistantMessage={TraceAssistantSlot} />
    {Object.entries(events).filter(([runId]) => !displayed.has(runId)).map(([runId, trace]) =>
      <RunTracePanel key={runId} runId={runId} events={trace} renderTool={renderExecutionTool} running={props.isRunning && !trace.some((event) => event.kind === "final_message")} expanded={expanded?.[runId] ?? false} onExpandedChange={(value) => toggle?.(runId, value)} />)}
  </TraceContext.Provider>;
}
