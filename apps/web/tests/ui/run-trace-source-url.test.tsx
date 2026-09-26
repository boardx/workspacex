/**
 * 「它到底打开了哪个网页」——2026-09-23 人类交办里点名的「浏览网页」那一件。
 *
 * 改动前：`fetch_url` 抓回来的只剩正文文本。折叠行上是 `打开网页 · example.com`
 * （`toolObject` 刻意截到 host），完整地址埋在「技术细节」里那段 JSON 的第二层折叠下，
 * 而且**不可点**。用户想核对「这段结论是从哪一页来的」，要展开两层再用眼睛在 JSON 里找。
 *
 * 这份测试钉两件事：地址画出来了、而且**不合法的地址一条都不画**——后者是安全判据，
 * 地址来自模型写的工具参数，正文那层 rehype-sanitize 管不到这条新路径。
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { ExecutionEvent } from "@repo/contracts/execution-journal";
import { RunTracePanel } from "@/components/chat/workbench/run-trace-panel";

const base = { runId: "run-1", emittedAt: "2026-09-23T00:00:00Z" };
const fetched = (args: Record<string, unknown>): ExecutionEvent[] => [
  { ...base, seq: 1, kind: "tool_start", toolCallId: "c1", toolName: "fetch_url", args },
  { ...base, seq: 2, kind: "tool_end", toolCallId: "c1", toolName: "fetch_url", ok: true, result: "网页正文…" },
];

function openRow(): void {
  fireEvent.click(screen.getByTestId("chat-task-workbench-event-row"));
}

describe("执行过程 · 原始地址", () => {
  it("抓过的网页给出完整地址，并且是可点外链", () => {
    render(<RunTracePanel runId="run-1" events={fetched({ url: "https://example.com/report/2026?p=2" })} expanded />);
    openRow();
    const link = screen.getByTestId("run-trace-entry-source-url");
    expect(link).toHaveAttribute("href", "https://example.com/report/2026?p=2");
    // 完整地址要看得见：折叠行上那个 host 回答不了「是哪一页」。
    expect(link).toHaveTextContent("https://example.com/report/2026?p=2");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("browser_navigate 同样给地址——不是只认 fetch_url 一个工具名", () => {
    const events: ExecutionEvent[] = [
      { ...base, seq: 1, kind: "tool_start", toolCallId: "c1", toolName: "browser_navigate", args: { url: "https://b.com/" } },
      { ...base, seq: 2, kind: "tool_end", toolCallId: "c1", toolName: "browser_navigate", ok: true, result: "ok" },
    ];
    render(<RunTracePanel runId="run-1" events={events} expanded />);
    openRow();
    expect(screen.getByTestId("run-trace-entry-source-url")).toHaveAttribute("href", "https://b.com/");
  });

  // 本条是这次改动的安全支点：地址是模型写进工具参数的，渲染成可点链接就是一条注入路径。
  it.each(["javascript:alert(1)", "data:text/html,<script>alert(1)</script>", "file:///etc/passwd"])(
    "不可渲染的协议一条都不画：%s",
    (raw) => {
      render(<RunTracePanel runId="run-1" events={fetched({ url: raw })} expanded />);
      openRow();
      expect(screen.queryByTestId("run-trace-entry-source-url")).toBeNull();
    },
  );

  it("没有地址的工具不凭空多出这一行", () => {
    const events: ExecutionEvent[] = [
      { ...base, seq: 1, kind: "tool_start", toolCallId: "c1", toolName: "read_file", args: { file_path: "/w/a.png" } },
      { ...base, seq: 2, kind: "tool_end", toolCallId: "c1", toolName: "read_file", ok: true, result: "x" },
    ];
    render(<RunTracePanel runId="run-1" events={events} expanded />);
    openRow();
    expect(screen.queryByTestId("run-trace-entry-source-url")).toBeNull();
  });

  it("地址在第一层展开就看得见，不用再点开「技术细节」", () => {
    render(<RunTracePanel runId="run-1" events={fetched({ url: "https://example.com/a" })} expanded />);
    openRow();
    // 技术细节那层仍然是收起的——地址不在它里面。
    expect(screen.getByTestId("run-trace-entry-raw")).not.toHaveAttribute("open");
    expect(screen.getByTestId("run-trace-entry-source-url")).toBeInTheDocument();
  });
});
