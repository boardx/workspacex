/**
 * 执行过程对**非技术用户**说人话（2026-09-16 人类实测截图的四件事）。
 *
 * 那一屏的原样是：七行「已执行 · read_file ✓」，展开一行是
 * `{"file_path":"/workspace/preview-xlsx-review/page-06.png"}` 和一个大写的 `null`。
 * 四条断言逐条对着它：
 *   ① 工具有中文名，且后面说出**对哪个东西**做的（文件名，不是整条沙箱路径）；
 *   ② 相邻的同名调用折成一行，成员一条不少；
 *   ③ 空结果说成一句人话，屏幕上不出现 `null`；
 *   ④ JSON 原文没被删掉，收在「技术细节」那层折叠里——渐进式披露，不是删减。
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { ExecutionEvent } from "@repo/contracts/execution-journal";
import { RunTracePanel } from "@/components/chat/workbench/run-trace-panel";

const base = { runId: "run-1", emittedAt: "2026-09-16T00:00:00Z" };
const read = (n: number, page: string): ExecutionEvent[] => [
  { ...base, seq: n * 2, kind: "tool_start", toolCallId: `c${n}`, toolName: "read_file", args: { file_path: `/workspace/preview-xlsx-review/${page}` } },
  { ...base, seq: n * 2 + 1, kind: "tool_end", toolCallId: `c${n}`, toolName: "read_file", ok: true, result: null },
];

describe("执行过程 · 说人话", () => {
  it("单次调用：中文工具名 + 文件名，不印整条沙箱路径", () => {
    render(<RunTracePanel runId="run-1" events={read(1, "page-06.png")} expanded />);
    const row = screen.getByTestId("chat-task-workbench-event-row");
    expect(row).toHaveTextContent("已执行 · 读取文件 · page-06.png");
    expect(row).not.toHaveTextContent("/workspace/");
    expect(row).not.toHaveTextContent("read_file");
  });

  it("空结果说成人话，屏幕上不出现 null", () => {
    render(<RunTracePanel runId="run-1" events={read(1, "page-06.png")} expanded />);
    fireEvent.click(screen.getByText("已执行 · 读取文件 · page-06.png"));
    expect(screen.getByTestId("run-trace-entry-empty-result")).toHaveTextContent("这一步没有返回内容");
    expect(screen.queryByText("null")).toBeNull();
  });

  it("JSON 原文收在「技术细节」里，没被删掉", () => {
    render(<RunTracePanel runId="run-1" events={read(1, "page-06.png")} expanded />);
    fireEvent.click(screen.getByText("已执行 · 读取文件 · page-06.png"));
    const raw = screen.getByTestId("run-trace-entry-raw");
    expect(raw).toHaveTextContent("/workspace/preview-xlsx-review/page-06.png");
    // 默认收起：第一屏是那句人话，不是 JSON。
    expect(raw).not.toHaveAttribute("open");
  });

  it("七次读取折成一行，七个文件名一个不少", () => {
    const events = [1, 2, 3, 4, 5, 6, 7].flatMap((n) => read(n, `page-0${n}.png`));
    render(<RunTracePanel runId="run-1" events={events} expanded />);
    expect(screen.getByTestId("chat-task-workbench-event-row")).toHaveTextContent("读取文件 · 7 次");
    const members = screen.getAllByTestId("run-trace-group-member");
    expect(members).toHaveLength(7);
    expect(members.map((member) => member.textContent)).toContain("page-06.png");
  });
});
