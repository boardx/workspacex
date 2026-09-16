/**
 * 相邻同名工具调用折成一行（`groupTraceRows` 的 `tool-group`）—— 纯函数门控。
 *
 * 2026-09-16 人类实测（非技术用户）：执行过程展开后是**七行一模一样**的
 * 「已执行 · read_file ✓」。折的是重复，不是事实——成员一条不少地留在组里，
 * 而且**失败/进行中/带进展文字的那一条永远不进组**：把唯一需要被看见的那行折起来，
 * 正是这次折叠要避免的反面。
 */
import { describe, expect, it } from "vitest";
import type { ExecutionEvent } from "@repo/contracts/execution-journal";
import { groupTraceRows, traceEntries } from "@/lib/chat-workbench/run-trace";

const base = { runId: "run-1", emittedAt: "2026-09-16T00:00:00Z" };
const call = (n: number, name: string, page: number, ok = true): ExecutionEvent[] => [
  { ...base, seq: n * 2, kind: "tool_start", toolCallId: `c${n}`, toolName: name, args: { file_path: `/workspace/page-0${page}.png` } },
  { ...base, seq: n * 2 + 1, kind: "tool_end", toolCallId: `c${n}`, toolName: name, ok, result: null },
];

describe("groupTraceRows —— 工具分组", () => {
  it("相邻的同名成功调用折成一行，成员一条不少", () => {
    const events = [...call(1, "read_file", 1), ...call(2, "read_file", 2), ...call(3, "read_file", 3)];
    const rows = groupTraceRows(traceEntries(events));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.kind).toBe("tool-group");
    expect(rows[0]!.kind === "tool-group" && rows[0]!.members).toHaveLength(3);
  });

  it("单独一次调用不成组（一行就是一行，不要为它套一层折叠）", () => {
    const rows = groupTraceRows(traceEntries(call(1, "read_file", 1)));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.kind).toBe("entry");
  });

  it("不同工具不混进同一组", () => {
    const rows = groupTraceRows(traceEntries([...call(1, "read_file", 1), ...call(2, "write_file", 2)]));
    expect(rows.map((row) => row.kind)).toEqual(["entry", "entry"]);
  });

  it("失败的那一条独立成行，不被折进组里", () => {
    const events = [...call(1, "read_file", 1), ...call(2, "read_file", 2), ...call(3, "read_file", 3, false)];
    const rows = groupTraceRows(traceEntries(events));
    expect(rows).toHaveLength(2);
    expect(rows[0]!.kind).toBe("tool-group");
    expect(rows[1]!.kind === "entry" && rows[1]!.entry.status).toBe("failed");
  });

  it("还在跑的那一条独立成行（没收到 tool_end）", () => {
    const events = [...call(1, "read_file", 1), ...call(2, "read_file", 2),
      { ...base, seq: 90, kind: "tool_start", toolCallId: "c9", toolName: "read_file", args: { file_path: "/workspace/page-09.png" } } as ExecutionEvent];
    const rows = groupTraceRows(traceEntries(events));
    expect(rows).toHaveLength(2);
    expect(rows[1]!.kind === "entry" && rows[1]!.entry.status).toBe("running");
  });
});
