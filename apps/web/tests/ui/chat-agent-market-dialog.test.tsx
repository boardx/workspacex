/**
 * 人类原话（2026-08-29）：「从市场导入应该改为弹出一个新的对话框，让我通过 tags 来
 * 过滤或文字搜索浏览 agent，然后加入讨论」——钉住 `RosterPanel` 的
 * 「从 Agent 市场加入」按钮不再是死链跳转，而是弹出 `AgentMarketDialog`，
 * 在弹窗里能用文字搜索 + 标签 chip 过滤候选、点击「加入」调用 `onAdd`。
 *
 * 只挂 `RosterPanel` 本身（同 `chat-artifact-preview-dialog.test.tsx` 的隔离风格），
 * 不经过整条 `ChatReadScreen`：这条钉的是弹窗交互本身，不是编制读写的接线
 * （那条已由 `chat-roster-mutate.test.tsx` 覆盖）。
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { RosterPanel } from "@/components/chat/chat-roster-panel";
import type { CapabilityListing } from "@/lib/live-capabilities";
import type { GetAgentPanelOut } from "@/lib/live-chat";

function listing(overrides: Partial<CapabilityListing> & { id: string; name: string }): CapabilityListing {
  return {
    orgId: "org-current", kind: "agent", scope: "org-wide", enabled: true,
    endpoint: null, abbr: null, duty: null, disabledReason: null,
    ...overrides,
  };
}

const CANDIDATES: readonly CapabilityListing[] = [
  listing({ id: "a-strategist", name: "战略分析师", duty: "拆问题、标致命假设", scope: "org-wide" }),
  listing({ id: "a-writer", name: "文案助手", duty: "写营销文案", scope: "team-only" }),
];

const ROSTER: GetAgentPanelOut = {
  agents: [], presentCount: 0, rosterCount: 0, marketEntry: "/admin/agent", rosterVersion: 1,
};

function renderPanel(onAdd = vi.fn()) {
  render(
    <RosterPanel
      roster={ROSTER}
      loading={false}
      error={null}
      hasSelection
      canMutate
      pending={false}
      mutateFailure={null}
      candidates={CANDIDATES}
      candidatesError={null}
      onAdd={onAdd}
      onRemove={vi.fn()}
      onRetry={vi.fn()}
    />,
  );
  return { onAdd };
}

describe("「从 Agent 市场加入」弹窗", () => {
  it("点击按钮弹出对话框，而不是跳转链接", () => {
    renderPanel();
    expect(screen.queryByTestId("chat-agent-market-dialog")).toBeNull();

    fireEvent.click(screen.getByTestId("chat-roster-market-entry"));

    expect(screen.getByTestId("chat-agent-market-dialog")).toBeTruthy();
    expect(screen.getByTestId("chat-agent-market-row-a-strategist")).toBeTruthy();
    expect(screen.getByTestId("chat-agent-market-row-a-writer")).toBeTruthy();
  });

  it("文字搜索按名称/职责过滤候选", () => {
    renderPanel();
    fireEvent.click(screen.getByTestId("chat-roster-market-entry"));

    fireEvent.change(screen.getByTestId("chat-agent-market-search"), { target: { value: "文案" } });

    expect(screen.queryByTestId("chat-agent-market-row-a-strategist")).toBeNull();
    expect(screen.getByTestId("chat-agent-market-row-a-writer")).toBeTruthy();
  });

  it("标签 chip（可见范围）过滤候选，且可清除", () => {
    renderPanel();
    fireEvent.click(screen.getByTestId("chat-roster-market-entry"));

    fireEvent.click(screen.getByTestId("chat-agent-market-tag-team-only"));
    expect(screen.queryByTestId("chat-agent-market-row-a-strategist")).toBeNull();
    expect(screen.getByTestId("chat-agent-market-row-a-writer")).toBeTruthy();

    fireEvent.click(screen.getByTestId("chat-agent-market-clear"));
    expect(screen.getByTestId("chat-agent-market-row-a-strategist")).toBeTruthy();
  });

  it("搜索词与标签都不匹配时显示「无匹配」，而不是假装候选是空的", () => {
    renderPanel();
    fireEvent.click(screen.getByTestId("chat-roster-market-entry"));

    fireEvent.change(screen.getByTestId("chat-agent-market-search"), { target: { value: "不存在的名字" } });

    expect(screen.getByTestId("chat-agent-market-no-match")).toBeTruthy();
    expect(screen.queryByTestId("chat-agent-market-empty")).toBeNull();
  });

  it("点击「加入」调用 onAdd，携带该行的 agent id", () => {
    const { onAdd } = renderPanel();
    fireEvent.click(screen.getByTestId("chat-roster-market-entry"));

    fireEvent.click(screen.getByTestId("chat-agent-market-add-a-writer"));

    expect(onAdd).toHaveBeenCalledWith("a-writer");
  });

  it("marketEntry 为 null 时整块入口不渲染（服务端没下发就不造死链）", () => {
    render(
      <RosterPanel
        roster={{ ...ROSTER, marketEntry: null }}
        loading={false}
        error={null}
        hasSelection
        canMutate
        pending={false}
        mutateFailure={null}
        candidates={CANDIDATES}
        candidatesError={null}
        onAdd={vi.fn()}
        onRemove={vi.fn()}
        onRetry={vi.fn()}
      />,
    );
    expect(screen.queryByTestId("chat-roster-market-entry")).toBeNull();
  });
});
