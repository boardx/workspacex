/**
 * F04（#2712）—— 断线重连提示（`ReconnectToast`,
 * `components/agent-kernel/agent-kernel-units.tsx`）。
 *
 * `requirements/02-streaming-transport.md` R4 E2 / R8，`contracts/streaming-transport/
 * ui.md` 的 data-testid 表：`reconnect-toast` 携带 `data-state` 属性，三态直接对齐
 * 契约 `ReconnectState`（`reconnecting`/`restored`/`failed`）——`failed` 是签核复核项①
 * 采用的方案：复用本组件第三个 `data-state`，不是独立组件。
 *
 * 依据等级：[真实]——`state` prop 由 `lib/agent-kernel-stream.ts` 的
 * `useAgentKernelRunStream`（真实 WebSocket 订阅 + 有界重连）驱动，不是签核阶段的
 * 静态原型 mock 数据。本文件只测组件的渲染契约（给定 state → 对应 DOM），驱动它的
 * hook 由 `terminal-status-and-restore.test.tsx` 覆盖。
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ReconnectToast } from "@/components/agent-kernel/agent-kernel-units";

describe("ReconnectToast：data-testid=reconnect-toast，data-state 与契约 ReconnectState 一致", () => {
  it("state=reconnecting ⇒ data-state=reconnecting，文案「正在重连」", () => {
    render(<ReconnectToast state="reconnecting" />);
    const toast = screen.getByTestId("reconnect-toast");
    expect(toast).toHaveAttribute("data-state", "reconnecting");
    expect(toast).toHaveTextContent("正在重连");
  });

  it("state=restored ⇒ data-state=restored，文案「连接已恢复」", () => {
    render(<ReconnectToast state="restored" />);
    const toast = screen.getByTestId("reconnect-toast");
    expect(toast).toHaveAttribute("data-state", "restored");
    expect(toast).toHaveTextContent("连接已恢复");
  });

  it("state=failed（重连持续失败，R4 E2）⇒ data-state=failed，文案「连接中断，请手动刷新」", () => {
    render(<ReconnectToast state="failed" />);
    const toast = screen.getByTestId("reconnect-toast");
    expect(toast).toHaveAttribute("data-state", "failed");
    expect(toast).toHaveTextContent("连接中断，请手动刷新");
  });

  it("三态互斥：任一时刻只渲染一个 reconnect-toast 节点，不会三态同时挂载", () => {
    render(<ReconnectToast state="reconnecting" />);
    expect(screen.getAllByTestId("reconnect-toast")).toHaveLength(1);
  });

  it("默认（未传 state）⇒ restored，向后兼容既有调用方", () => {
    render(<ReconnectToast />);
    expect(screen.getByTestId("reconnect-toast")).toHaveAttribute("data-state", "restored");
  });
});
