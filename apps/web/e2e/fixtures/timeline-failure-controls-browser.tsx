import * as React from "react";
import { createRoot } from "react-dom/client";
import { CopilotKit } from "@copilotkit/react-core/v2";
import { TaskTimeline } from "@/components/chat/workbench/task-timeline";
import type { ExecutionEvent } from "@repo/contracts/execution-journal";
const base = { runId: "failed", emittedAt: "2026-11-05T00:00:00Z" };
const events: ExecutionEvent[] = [
  { ...base, seq: 1, kind: "tool_start", toolCallId: "t", toolName: "execute", args: {} },
  { ...base, seq: 2, kind: "tool_end", toolCallId: "t", toolName: "execute", ok: false, result: "失败" },
  { ...base, seq: 3, kind: "final_message", messageId: "failure" },
  { ...base, seq: 4, kind: "status", status: "succeeded", attemptId: "attempt-a" },
];
createRoot(document.getElementById("root")!).render(<CopilotKit runtimeUrl="/api/copilotkit" useSingleEndpoint={false}>
  <TaskTimeline failureScope="org/browser-thread" messages={[
    { id: "user", role: "user", content: "请生成图片" },
    { id: "failure", role: "assistant", content: "这次图片生成未完成。".repeat(80) },
    { id: "tail", role: "assistant", content: "失败后的补充说明" },
    { id: "success", role: "assistant", content: "其他任务成功结果" },
  ]} messageRuns={{ failure: "failed", tail: "failed", success: "success" }} events={{ failed: events,
    success: [{ ...base, runId: "success", seq: 1, kind: "status", status: "succeeded" }] }} isRunning={false} />
</CopilotKit>);
