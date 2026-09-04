/**
 * issue #2695 —— 右侧任务检查器不许自动展开，只能靠用户手点。
 *
 * 根因回顾（见 `chat-task-inspector.tsx` 内对应改动头注）：此前 `override` 为
 * `null`（未手动操作）时，折叠态跟随 `isInspectorCollapsed(signals, ...)` 自动
 * 判定——一旦有素材/产物/运行信号，面板自己弹开；且新信号到达时还会主动清掉
 * 用户点「收起」写下的 `"collapsed"` 覆盖，逼着面板重新弹开。两条路径本测试
 * 都要钉死其反面。
 */
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

afterEach(cleanup);

const api = vi.hoisted(() => ({ fetchPlanLedger: vi.fn() }));
vi.mock("@/lib/plan-control-api", () => api);

import { ChatTaskInspector, type ChatTaskInspectorProps } from "@/components/chat/chat-task-inspector";

function baseProps(overrides: Partial<ChatTaskInspectorProps> = {}): ChatTaskInspectorProps {
  return {
    hasSelection: true,
    threadId: "t-1",
    artifacts: null,
    materials: null,
    loading: false,
    artifactsError: null,
    materialsError: null,
    onRetry: () => {},
    pendingMaterialsCount: 0,
    planTodos: null,
    isRunning: false,
    runPhaseLabel: null,
    runStartedAt: null,
    ...overrides,
  };
}

function isCollapsed(): boolean {
  return screen.getByTestId("chat-task-workbench-inspector").getAttribute("data-collapsed") === "true";
}

const artifactItem = {
  artifactId: "a1",
  title: "报告",
  mode: "live" as const,
  pinnedBy: null,
  pinnedAt: null,
  version: null,
  messageId: "m1",
  hasSource: false,
};

describe("ChatTaskInspector 折叠态 —— 只手点，不自动展开（issue #2695）", () => {
  beforeEach(() => {
    api.fetchPlanLedger.mockReturnValue(new Promise(() => {})); // 永不 resolve，不干扰本组测试
  });

  it("首次挂载即使已有产物/在运行，也默认折叠——不是替用户点开", () => {
    render(
      <ChatTaskInspector
        {...baseProps({
          isRunning: true,
          artifacts: { items: [artifactItem] },
        })}
      />,
    );
    expect(isCollapsed()).toBe(true);
  });

  it("展开后新增产物（信号跃迁）不应把用户点「收起」的状态重新弹开", () => {
    const { rerender } = render(
      <ChatTaskInspector {...baseProps({ artifacts: { items: [] } })} />,
    );
    // 用户手点展开，再手点收起。
    fireEvent.click(screen.getByTestId("chat-task-workbench-inspector-expand"));
    expect(isCollapsed()).toBe(false);
    fireEvent.click(screen.getByTestId("chat-task-workbench-inspector-collapse"));
    expect(isCollapsed()).toBe(true);

    // 新产物到达——`nextInspectorTab` 判定的跃迁——过去的版本会借此清掉
    // `"collapsed"` 覆盖，把面板弹开；现在不许。
    rerender(
      <ChatTaskInspector
        {...baseProps({ artifacts: { items: [artifactItem] } })}
      />,
    );
    expect(isCollapsed()).toBe(true);
  });

  it("点「展开」按钮真的会展开；再点「收起」真的会收起", () => {
    render(<ChatTaskInspector {...baseProps()} />);
    expect(isCollapsed()).toBe(true);

    fireEvent.click(screen.getByTestId("chat-task-workbench-inspector-expand"));
    expect(isCollapsed()).toBe(false);

    fireEvent.click(screen.getByTestId("chat-task-workbench-inspector-collapse"));
    expect(isCollapsed()).toBe(true);
  });
});
