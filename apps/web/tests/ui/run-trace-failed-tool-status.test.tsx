/**
 * issue #3204 ① —— 轨迹卡片状态自相矛盾的反证。
 *
 * 人类 2026-09-09 在 devapp 实测：`fetch_url` 失败的那一步，**外层折叠行**写
 * 「执行工具操作失败」+ 红色感叹号，**内层卡片**里 `fetch_url` 左侧却是**绿色对勾**。
 *
 * 根因是同一件事实（这次工具调用成没成）在两处各算一遍：
 *   · 外层：`TraceEntry.status` ← 执行日志 `tool_end.ok`（权威）；
 *   · 内层：`@copilotkit/react-core` 的 `ToolCallRenderer` —— 它只看
 *     「有没有 toolMessage」，有就发 `ToolCallStatus.Complete`，框架**根本没有失败态**
 *     （见 `dist/copilotkit-*.mjs` 的 `if (toolMessage) return ... status: ToolCallStatus.Complete`）。
 *     失败这件事在 `render()` 边界上被丢掉，然后被重新发明成"成功"。
 *
 * 这条断言就是那道闸：两处状态必须来自同一个源。用的是**生产**的
 * `renderExecutionTool` + **生产**的 `CopilotKitV2ToolRenderers`，不是测试自造的渲染器。
 */
import * as React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";

const copilotkitV2CssPath = vi.hoisted(() => require.resolve("@copilotkit/react-core/v2/styles.css"));
vi.mock(copilotkitV2CssPath, () => ({}));
vi.mock("@/components/chat/subtask-run-live-panel", () => ({
  SubtaskRunLivePanel: () => null,
}));

import { CopilotKit } from "@copilotkit/react-core/v2";
import type { ExecutionEvent } from "@repo/contracts/execution-journal";
import { RunTracePanel } from "@/components/chat/workbench/run-trace-panel";
import { renderExecutionTool } from "@/components/chat/workbench/task-timeline";
import { CopilotKitV2ToolRenderers } from "@/components/chat/copilotkit-v2-tool-renderers";

const base = { runId: "run-1", emittedAt: "2026-09-09T00:00:00Z" };
const REFUSAL =
  "Web source unavailable or refused; no content confirmed. Do not cite this failed source.";

function renderTrace(events: ExecutionEvent[]) {
  render(
    <CopilotKit runtimeUrl="/api/copilotkit" useSingleEndpoint={false}>
      <CopilotKitV2ToolRenderers />
      <RunTracePanel runId="run-1" events={events} renderTool={renderExecutionTool} expanded />
    </CopilotKit>,
  );
  // 内层卡片在每条 entry 自己的 `<details>` 里，默认收起——展开它才能看到卡片。
  for (const summary of screen.getAllByTestId("chat-task-workbench-event-row")) {
    fireEvent.click(summary);
  }
}

describe("issue #3204 ① 轨迹外层状态与内层卡片状态同源", () => {
  it("工具调用失败时，内层卡片不得显示成功态（不得出现绿色对勾）", () => {
    const events: ExecutionEvent[] = [
      { ...base, seq: 1, kind: "tool_start", toolCallId: "t-1", toolName: "fetch_url", args: { url: "https://openai.com/index/navier-stokes-solution/" } },
      { ...base, seq: 2, kind: "tool_end", toolCallId: "t-1", toolName: "fetch_url", result: REFUSAL, ok: false },
    ];
    renderTrace(events);

    // 外层：权威事实说"失败"。
    expect(screen.getByTestId("run-trace-entry")).toHaveAttribute("data-status", "failed");
    expect(screen.getByTestId("chat-task-workbench-event-row")).toHaveTextContent("执行失败 · ");

    // 内层：必须说同一件事。修复前这里是 `complete` —— 绿色对勾。
    const card = screen.getByTestId("copilotkit-v2-tool-generic");
    expect(card).toHaveAttribute("data-tool-status", "failed");
    expect(within(card).getByLabelText("失败")).toBeInTheDocument();
    // 失败态不是"进行中"。
    expect(within(card).queryByText("进行中")).toBeNull();
    // 失败原因照样要看得见——收敛状态不等于把结果藏起来。
    expect(card).toHaveTextContent("Web source unavailable or refused");
  });

  it("工具调用成功时，内层卡片仍是成功态（反面：没有把所有卡片一律染成失败）", () => {
    const events: ExecutionEvent[] = [
      { ...base, seq: 1, kind: "tool_start", toolCallId: "t-2", toolName: "fetch_url", args: { url: "https://example.com/" } },
      { ...base, seq: 2, kind: "tool_end", toolCallId: "t-2", toolName: "fetch_url", result: "Example Domain", ok: true },
    ];
    renderTrace(events);
    expect(screen.getByTestId("run-trace-entry")).toHaveAttribute("data-status", "succeeded");
    const card = screen.getByTestId("copilotkit-v2-tool-generic");
    expect(card).toHaveAttribute("data-tool-status", "complete");
    expect(within(card).queryByLabelText("失败")).toBeNull();
  });

  it("工具还在跑时，内层卡片是进行中（反面：没有把未完成态也判成失败）", () => {
    const events: ExecutionEvent[] = [
      { ...base, seq: 1, kind: "tool_start", toolCallId: "t-3", toolName: "fetch_url", args: { url: "https://example.com/" } },
    ];
    renderTrace(events);
    expect(screen.getByTestId("run-trace-entry")).toHaveAttribute("data-status", "running");
    const card = screen.getByTestId("copilotkit-v2-tool-generic");
    expect(card).not.toHaveAttribute("data-tool-status", "complete");
    expect(within(card).queryByLabelText("失败")).toBeNull();
  });
});
