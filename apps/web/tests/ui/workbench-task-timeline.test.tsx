import * as React from "react";
import { z } from "zod";
import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
const cssPath = vi.hoisted(() => require.resolve("@copilotkit/react-core/v2/styles.css"));
vi.mock(cssPath, () => ({}));
import { CopilotKit, useRenderTool } from "@copilotkit/react-core/v2";
import { TaskTimeline } from "@/components/chat/workbench/task-timeline";
import { CopilotKitV2ToolRenderers } from "@/components/chat/copilotkit-v2-tool-renderers";
import type { ExecutionEvent } from "@repo/contracts/execution-journal";
const base = { runId: "run-a", emittedAt: "2026-09-07T00:00:00Z" };
const events: ExecutionEvent[] = [
  { ...base, seq: 0, kind: "text_delta", messageId: "progress", delta: "先列出资料" },
  { ...base, seq: 1, kind: "tool_start", toolCallId: "call-1", toolName: "list_org_skills", args: {} },
  { ...base, seq: 2, kind: "tool_end", toolCallId: "call-1", toolName: "list_org_skills", result: "已列出", ok: true },
  { ...base, seq: 3, kind: "text_delta", messageId: "answer", delta: "最终结论" },
  { ...base, seq: 4, kind: "final_message", messageId: "answer" },
];
function DecisionRenderer() {
  useRenderTool({ name: "confirm_task_intent", parameters: z.object({}), render: () => <button type="button">确认任务</button> });
  return null;
}
describe("framework task timeline", () => {
  it("groups multiple assistant messages once, hides progress from answer and reuses registered tool cards", () => {
    render(<CopilotKit runtimeUrl="/api/copilotkit" useSingleEndpoint={false}>
      <CopilotKitV2ToolRenderers />
      <TaskTimeline messages={[
        { id: "user", role: "user", content: "开始" },
        { id: "progress", role: "assistant", content: "先列出资料" },
        { id: "answer", role: "assistant", content: "最终结论" },
      ]} messageRuns={{ progress: "run-a", answer: "run-a" }} events={{ "run-a": events }} isRunning={false} />
    </CopilotKit>);
    expect(screen.getAllByTestId("run-trace-panel")).toHaveLength(1);
    expect(screen.getByText("最终结论")).toBeVisible();
    expect(screen.getByText("先列出资料", { exact: false })).not.toBeVisible();
    fireEvent.click(screen.getByTestId("run-trace-toggle"));
    expect(screen.getByText("先列出资料", { exact: false })).toBeVisible();
    const toolRow = screen.getByTestId("chat-task-workbench-event-row");
    expect(toolRow).toHaveTextContent("已执行工具操作");
    expect(toolRow).not.toHaveTextContent("list_org_skills");
    fireEvent.click(toolRow);
    expect(screen.getByTestId("copilotkit-v2-tool-generic")).toBeVisible();
  });
  it("keeps a registered decision renderer visible outside a collapsed trace", () => {
    const decisionEvents: ExecutionEvent[] = [{ ...base, seq: 0, kind: "tool_start", toolCallId: "decision", toolName: "confirm_task_intent", args: {} }];
    render(<CopilotKit runtimeUrl="/api/copilotkit" useSingleEndpoint={false}>
      <DecisionRenderer />
      <TaskTimeline messages={[{ id: "decision-message", role: "assistant", content: "", toolCalls: [{ id: "decision", type: "function", function: { name: "confirm_task_intent", arguments: "{}" } }] }]}
        messageRuns={{ "decision-message": "run-a" }} events={{ "run-a": decisionEvents }} isRunning />
    </CopilotKit>);
    expect(screen.getByTestId("run-trace-toggle")).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByRole("button", { name: "确认任务" })).toBeVisible();
  });

  it("keeps write_todos audit rows but never projects journal snapshots as duplicate plan cards", () => {
    const planEvents: ExecutionEvent[] = [
      { ...base, seq: 0, kind: "tool_start", toolCallId: "plan-1", toolName: "write_todos", args: { todos: [{ content: "旧计划", status: "pending" }] } },
      { ...base, seq: 1, kind: "tool_end", toolCallId: "plan-1", toolName: "write_todos", result: "ok", ok: true },
      { ...base, seq: 2, kind: "tool_start", toolCallId: "plan-2", toolName: "write_todos", args: { todos: [{ content: "新计划", status: "in_progress" }] } },
      { ...base, seq: 3, kind: "tool_end", toolCallId: "plan-2", toolName: "write_todos", result: "ok", ok: true },
      { ...base, seq: 4, kind: "tool_start", toolCallId: "search-1", toolName: "search_documents", args: { query: "资料" } },
      { ...base, seq: 5, kind: "tool_end", toolCallId: "search-1", toolName: "search_documents", result: "找到资料", ok: true },
    ];
    render(<CopilotKit runtimeUrl="/api/copilotkit" useSingleEndpoint={false}>
      <CopilotKitV2ToolRenderers />
      <TaskTimeline messages={[{ id: "answer", role: "assistant", content: "处理中" }]}
        messageRuns={{ answer: "run-a" }} events={{ "run-a": planEvents }} isRunning />
    </CopilotKit>);

    fireEvent.click(screen.getByTestId("run-trace-toggle"));
    const planRows = screen.getAllByTestId("chat-task-workbench-event-row");
    expect(planRows.filter((row) => row.textContent === "已更新执行计划")).toHaveLength(2);
    expect(planRows.some((row) => row.textContent?.includes("write_todos"))).toBe(false);
    expect(screen.queryByTestId("copilotkit-v2-tool-write-todos")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("已检索资料"));
    expect(screen.getByTestId("copilotkit-v2-tool-search-documents")).toBeVisible();
  });

});
