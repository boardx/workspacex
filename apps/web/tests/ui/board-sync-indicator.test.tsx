import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { BoardSyncIndicator, boardSyncVisualState } from "@/components/whiteboard/board-sync-indicator";
afterEach(cleanup);
it("explicit provider pending cannot be overridden by a saved label", () => {
  const { rerender } = render(<BoardSyncIndicator status="已同步 · 序列 12" syncState={boardSyncVisualState({phase:"online",pending:1})} readOnly={false}/>);
  expect(screen.getByTestId("board-sync-status")).toHaveAttribute("data-sync-state","syncing");
  expect(screen.getByTestId("board-sync-spinner")).toHaveClass("animate-spin","motion-reduce:animate-none");
  rerender(<BoardSyncIndicator status="已同步 · 序列 13" syncState={boardSyncVisualState({phase:"online",pending:0})} readOnly={false}/>);
  expect(screen.queryByTestId("board-sync-spinner")).toBeNull(); expect(screen.getByTestId("board-sync-status")).toHaveAttribute("data-sync-state","saved");
});
it.each(["未确认修改不能视为已同步", "正在同步", "错误", "", "已同步 · 序列 abc"])("never paints unknown/unconfirmed label %s as saved", status => {
  render(<BoardSyncIndicator status={status} readOnly={false}/>); expect(screen.getByTestId("board-sync-status")).not.toHaveAttribute("data-sync-state","saved");
});
it("offline retry remains accessible and blocked/revoked offers no reconnect action", () => {
  const retry = vi.fn(); const { rerender } = render(<BoardSyncIndicator status="连接中断 · 2 项修改待确认" syncState="offline" readOnly={false} onRetry={retry}/>);
  fireEvent.click(screen.getByTestId("board-retry-sync")); expect(retry).toHaveBeenCalledOnce();
  rerender(<BoardSyncIndicator status="权限已撤销" syncState="blocked" readOnly onRetry={retry}/>);
  expect(screen.queryByTestId("board-retry-sync")).toBeNull(); expect(screen.getByTestId("board-sync-status")).toHaveAccessibleName("权限已撤销 · 只读");
});
