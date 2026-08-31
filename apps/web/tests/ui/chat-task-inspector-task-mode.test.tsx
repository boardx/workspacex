/**
 * PROP-CHAT-UIUX-ITER-002 V3 —— 右栏 Inspector「运行详情」页签新增「当前模式」行，
 * 读的是 composer 上真实的 `taskMode` state（透传自 `copilotkit-v2-panel-body.tsx`），
 * 不是编出来的第二份状态。`taskMode` 未传（旧轨道两屏没有任务模式概念）时不得
 * 显示这一行，不能显示一句编造的默认值——同本组件其余行的既有纪律。
 */
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

afterEach(cleanup);

const api = vi.hoisted(() => ({ fetchPlanLedger: vi.fn() }));
vi.mock("@/lib/plan-control-api", () => api);

import { ChatTaskInspector } from "@/components/chat/chat-task-inspector";

function baseProps() {
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
  };
}

describe("ChatTaskInspector 运行详情页签 —— 当前模式行", () => {
  beforeEach(() => {
    api.fetchPlanLedger.mockReturnValue(new Promise(() => {}));
  });

  function openRunDetailsTab() {
    fireEvent.click(screen.getByTestId("chat-task-workbench-inspector-tab-run-details"));
  }

  it("taskMode 未传时，不显示「当前模式」行——不编造默认值", () => {
    render(<ChatTaskInspector {...baseProps()} />);
    openRunDetailsTab();
    expect(screen.queryByText("当前模式")).toBeNull();
  });

  it("taskMode=false 时显示「问答模式（直接回答）」", () => {
    render(<ChatTaskInspector {...baseProps()} taskMode={false} />);
    openRunDetailsTab();
    expect(screen.getByText("当前模式")).toBeTruthy();
    expect(screen.getByText("问答模式（直接回答）")).toBeTruthy();
  });

  it("taskMode=true 时显示「任务模式（先计划后执行）」", () => {
    render(<ChatTaskInspector {...baseProps()} taskMode={true} />);
    openRunDetailsTab();
    expect(screen.getByText("任务模式（先计划后执行）")).toBeTruthy();
  });
});
