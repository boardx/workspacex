import * as React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ExecutionEvent } from "@repo/contracts/execution-journal";
import { traceEntries } from "@/lib/chat-workbench/run-trace";
import { RunTracePanel } from "@/components/chat/workbench/run-trace-panel";
vi.mock("@/components/chat/subtask-run-live-panel", () => ({
  SubtaskRunLivePanel: () => <div data-testid="subtask-live" />,
}));

/**
 * issue #3322（展示层那一半）—— 账本里出现了工具内进展之后，用户**不展开**就要看得到。
 *
 * 用户的原话是「等了很久没有任何的细节」。把进展渲染进 `<details>` 里、要点开才看得见，
 * 等于没修——他盯着的就是那一行折叠行。所以断言落在折叠行上。
 */
const base = { runId: "run-1", emittedAt: "2026-09-07T00:00:00Z" };
const start: ExecutionEvent = { ...base, seq: 1, kind: "tool_start", attemptId: "a1", toolCallId: "a1:call-1", sourceToolCallId: "call-1", toolName: "call_skill", args: {}, skillDisplayName: "PPT 生成" };
const progress = (seq: number, message: string): ExecutionEvent =>
  ({ ...base, seq, kind: "tool_progress", attemptId: "a1", toolCallId: "a1:call-1", sourceToolCallId: "call-1", toolName: "call_skill", message });
const end: ExecutionEvent = { ...base, seq: 9, kind: "tool_end", attemptId: "a1", toolCallId: "a1:call-1", sourceToolCallId: "call-1", toolName: "call_skill", result: "ok", ok: true };

describe("intra-tool progress in the run trace", () => {
  it("shows the latest progress line on the collapsed row while the tool is still running", () => {
    render(<RunTracePanel runId="run-1" events={[start, progress(2, "已开始生成…"), progress(3, "正在生成…已产出 1240 字")]} running />);

    const row = screen.getByTestId("run-trace-entry-progress");
    // 最新一条，不是第一条——折叠行只有一行的位置。
    expect(row).toHaveTextContent("正在生成…已产出 1240 字");
    expect(screen.queryByText("已开始生成…")).toBeNull();
  });

  it("attaches progress to the SAME tool row rather than creating an orphan entry", () => {
    const entries = traceEntries([start, progress(2, "正在生成…")]);

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ kind: "skill", text: "PPT 生成", status: "running", progressText: "正在生成…" });
  });

  /**
   * 反证的另一面：`traceEntries` 里处理 `tool_end` 的那个 `else` 读 `event.ok`。少了
   * `tool_progress` 的显式分支，进展会掉进去被读成 `ok: undefined` ⇒ 整行当场变"失败"。
   * 一条纯展示信号不许把一次正在正常推进的工具调用显示成红的。
   */
  it("never lets a progress event mark the still-running tool as failed", () => {
    const entries = traceEntries([start, progress(2, "正在生成…")]);

    expect(entries[0]!.status).toBe("running");
  });

  it("keeps the terminal outcome authoritative once the tool really ends", () => {
    const entries = traceEntries([start, progress(2, "正在生成…"), end]);

    expect(entries[0]).toMatchObject({ status: "succeeded", progressText: "正在生成…" });
  });
});
