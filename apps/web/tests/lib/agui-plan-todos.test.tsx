/**
 * DA-17（UX-9 Line D3）—— `apps/web/lib/agui-plan-todos.ts` 的反证套件。
 *
 * `deriveTodosFromStateSnapshot` 校验的是 `@repo/contracts/agui-state-events` 导出的
 * 同一个 `AguiTodosSnapshot` schema——不重新写一份形状判断（同一事实不得声明两处）。
 * 这里只反证「前端拿到 wire 上的 unknown 之后，好/坏输入分别落地成什么」，不重复
 * 契约包自己已经覆盖的 schema 细节。
 */
import { describe, expect, it } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { deriveTodosFromStateSnapshot, useAguiPlanTodos } from "@/lib/agui-plan-todos";

const GOOD_SNAPSHOT = {
  todos: [
    { content: "分析需求", status: "completed" },
    { content: "画架构图", status: "in_progress" },
  ],
};

describe("deriveTodosFromStateSnapshot", () => {
  it("合法快照 → PlanTodo[]，字段逐字透传", () => {
    expect(deriveTodosFromStateSnapshot(GOOD_SNAPSHOT)).toEqual(GOOD_SNAPSHOT.todos);
  });

  it.each([
    ["undefined（AG-UI schema 里 snapshot 可选）", undefined],
    ["不是对象", "just a string"],
    ["todos 不是数组", { todos: {} }],
    ["空数组", { todos: [] }],
    ["条目缺 content", { todos: [{ status: "pending" }] }],
    ["status 非法", { todos: [{ content: "x", status: "done" }] }],
  ])("非法输入 → null，不编造：%s", (_name, input) => {
    expect(deriveTodosFromStateSnapshot(input)).toBeNull();
  });
});

describe("useAguiPlanTodos", () => {
  it("onStateSnapshotEvent 收到合法快照后更新 todos", () => {
    const { result } = renderHook(() => useAguiPlanTodos());
    expect(result.current.todos).toBeNull();

    act(() => {
      result.current.onStateSnapshotEvent({ event: { snapshot: GOOD_SNAPSHOT } });
    });

    expect(result.current.todos).toEqual(GOOD_SNAPSHOT.todos);
  });

  it("坏帧不覆盖已有的合法快照（一次 wire 抖动不该清空已渲染的计划）", () => {
    const { result } = renderHook(() => useAguiPlanTodos());
    act(() => {
      result.current.onStateSnapshotEvent({ event: { snapshot: GOOD_SNAPSHOT } });
    });
    act(() => {
      result.current.onStateSnapshotEvent({ event: { snapshot: { todos: [] } } });
    });
    expect(result.current.todos).toEqual(GOOD_SNAPSHOT.todos);
  });

  it("reset() 清空回 null", () => {
    const { result } = renderHook(() => useAguiPlanTodos());
    act(() => {
      result.current.onStateSnapshotEvent({ event: { snapshot: GOOD_SNAPSHOT } });
    });
    act(() => {
      result.current.reset();
    });
    expect(result.current.todos).toBeNull();
  });
});
