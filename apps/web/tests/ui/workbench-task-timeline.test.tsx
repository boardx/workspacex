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
    fireEvent.click(screen.getByText("Tool · list_org_skills"));
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

});
