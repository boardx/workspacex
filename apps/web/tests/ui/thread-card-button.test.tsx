/**
 * `ThreadCardButton`（`thread-list-shell.tsx`）——2026-08-14 人类要求重做的 hover「…」
 * 菜单 + 双击改名交互本体。`chat-thread-crud.test.tsx`/`personal-chat-screen.test.tsx`
 * 已经覆盖了「改名/删除真的调用了 API、乐观并发版本号、失败态」这条主线（走整屏渲染）；
 * 这里只测**组件自己新增的交互形状**（菜单开合、双击、点击外部关闭、ESC 取消）——
 * 不重复接线到真实 API 的部分，纯组件层面、无 IO。
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ThreadCardButton } from "@/components/chat/thread-list-shell";
import type { ThreadCard } from "@/lib/live-chat";

const CARD: ThreadCard = {
  id: "thr-a", title: "对话 A", subtitle: "", badges: [], agentSummary: "",
  lastActivityAt: "2026-08-14T00:00:00.000Z", visibilityScope: "private",
};

describe("ThreadCardButton", () => {
  it("未选中的卡片不渲染「…」菜单入口——即便调用方传了 onRename/onDelete", () => {
    render(
      <ThreadCardButton card={CARD} selected={false} onSelect={vi.fn()} onRename={vi.fn()} onDelete={vi.fn()} pending={null} failure={null} />,
    );
    expect(screen.queryByTestId("chat-thread-card-menu-trigger")).not.toBeInTheDocument();
  });

  it("选中且可写 ⇒ 渲染「…」菜单入口；点开显示改名/删除两个菜单项", () => {
    render(
      <ThreadCardButton card={CARD} selected onSelect={vi.fn()} onRename={vi.fn()} onDelete={vi.fn()} pending={null} failure={null} />,
    );
    const trigger = screen.getByTestId("chat-thread-card-menu-trigger");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByTestId("chat-thread-rename")).toBeVisible();
    expect(screen.getByTestId("chat-thread-delete")).toBeVisible();
  });

  it("双击卡片标题直接进入行内改名——不需要先点开菜单", () => {
    const onRename = vi.fn();
    render(
      <ThreadCardButton card={CARD} selected onSelect={vi.fn()} onRename={onRename} onDelete={vi.fn()} pending={null} failure={null} />,
    );
    fireEvent.doubleClick(screen.getByTestId("chat-thread-thr-a"));
    const input = screen.getByTestId("chat-thread-title-input");
    expect(input).toHaveValue("对话 A"); // 预填当前标题，不是空白起手
    fireEvent.change(input, { target: { value: "新标题" } });
    fireEvent.click(screen.getByTestId("chat-thread-title-submit"));
    expect(onRename).toHaveBeenCalledWith("新标题");
  });

  it("点击菜单外部关闭菜单，不触发改名/删除", () => {
    render(
      <div>
        <ThreadCardButton card={CARD} selected onSelect={vi.fn()} onRename={vi.fn()} onDelete={vi.fn()} pending={null} failure={null} />
        <button type="button" data-testid="outside">外部</button>
      </div>,
    );
    fireEvent.click(screen.getByTestId("chat-thread-card-menu-trigger"));
    expect(screen.getByTestId("chat-thread-rename")).toBeVisible();
    fireEvent.mouseDown(screen.getByTestId("outside"));
    expect(screen.queryByTestId("chat-thread-rename")).not.toBeInTheDocument();
  });

  it("行内改名时按 Escape 取消，不提交、不发起改名", () => {
    const onRename = vi.fn();
    render(
      <ThreadCardButton card={CARD} selected onSelect={vi.fn()} onRename={onRename} onDelete={vi.fn()} pending={null} failure={null} />,
    );
    fireEvent.doubleClick(screen.getByTestId("chat-thread-thr-a"));
    const input = screen.getByTestId("chat-thread-title-input");
    fireEvent.change(input, { target: { value: "改到一半" } });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByTestId("chat-thread-title-input")).not.toBeInTheDocument();
    expect(onRename).not.toHaveBeenCalled();
  });

  it("删除需要二次确认——点「删除」进二次确认态，未填原因禁止提交", () => {
    render(
      <ThreadCardButton card={CARD} selected onSelect={vi.fn()} onRename={vi.fn()} onDelete={vi.fn()} pending={null} failure={null} />,
    );
    fireEvent.click(screen.getByTestId("chat-thread-card-menu-trigger"));
    fireEvent.click(screen.getByTestId("chat-thread-delete"));
    expect(screen.getByTestId("chat-thread-delete-submit")).toBeDisabled();
    expect(screen.queryByTestId("chat-thread-card-menu-trigger")).not.toBeInTheDocument(); // 二次确认期间不重复显示菜单入口
  });

  it("点击卡片本身仍然触发 onSelect（选择行为在菜单/双击之外照常工作）", () => {
    const onSelect = vi.fn();
    render(
      <ThreadCardButton card={CARD} selected={false} onSelect={onSelect} />,
    );
    fireEvent.click(screen.getByTestId("chat-thread-thr-a"));
    expect(onSelect).toHaveBeenCalledTimes(1);
  });
});
