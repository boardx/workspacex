/**
 * 从执行过程里读计划（评测集 ② 的产品侧修复）。
 *
 * 判据全在这里逐字钉住：取最后一次、认不出的形状返回 null（不编一个空计划占位）。
 */
import { describe, expect, it } from "vitest";
import { planFromTrace } from "@/lib/chat-workbench/trace-plan";
import type { TraceEntry } from "@/lib/chat-workbench/run-trace";

const todo = (args: unknown, id = "c1"): TraceEntry =>
  ({ id, kind: "tool", text: "write_todos", status: "succeeded", args } as unknown as TraceEntry);
const other = (): TraceEntry =>
  ({ id: "x", kind: "tool", text: "search_documents", status: "succeeded", args: { query: "a" } } as unknown as TraceEntry);

describe("planFromTrace", () => {
  it("解析出 content + status", () => {
    expect(planFromTrace([other(), todo({ todos: [
      { content: "理解用户问题", status: "completed" },
      { content: "查询当前时间", status: "in_progress" },
    ] })])).toEqual([
      { content: "理解用户问题", status: "completed" },
      { content: "查询当前时间", status: "in_progress" },
    ]);
  });

  // 同一条 run 里 write_todos 会被多次调用来推进状态；用户要看的是现在的计划。
  it("取最后一次，不是第一次", () => {
    const plan = planFromTrace([
      todo({ todos: [{ content: "A", status: "pending" }] }, "c1"),
      todo({ todos: [{ content: "A", status: "completed" }] }, "c2"),
    ]);
    expect(plan).toEqual([{ content: "A", status: "completed" }]);
  });

  it("没有 write_todos ⇒ null", () => {
    expect(planFromTrace([other()])).toBeNull();
    expect(planFromTrace([])).toBeNull();
  });

  // 认不出就返回 null——编一个空计划出来占位，比没有计划更糟。
  it.each([
    ["args 不是对象", "nope"],
    ["没有 todos", { other: 1 }],
    ["todos 是空数组", { todos: [] }],
    ["缺 content", { todos: [{ status: "pending" }] }],
    ["content 是空串", { todos: [{ content: "  ", status: "pending" }] }],
    ["status 不在闭集里", { todos: [{ content: "A", status: "running" }] }],
  ])("认不出的形状返回 null：%s", (_name, args) => {
    expect(planFromTrace([todo(args)])).toBeNull();
  });
});
