/**
 * AG04 review 指出的缺口——`/agent` 目录页「开始对话」跳到 `/chat?agent=<agentId>`，
 * 但没有任何代码读这个 query，深链落地后仍是未选中任何 Agent 的通用聊天。
 * 这里证 `CopilotKitV2ShellRoute` 真的把 `?agent=` 写进
 * `CopilotKitV2AgentSelectionProvider`（只在挂载时、且当前未选择时写一次，
 * 不覆盖用户后续在 picker 里的手动切换——同 `initialAgentId` 那条纪律）。
 */
import * as React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { CopilotKitV2ShellRoute } from "@/components/chat/copilotkit-v2-shell-route";
import {
  CopilotKitV2AgentSelectionProvider,
  useCopilotKitV2AgentSelection,
} from "@/lib/copilotkit-v2-agent-selection";

let searchParams = new URLSearchParams();

vi.mock("next/navigation", () => ({
  useParams: () => ({}),
  useSearchParams: () => searchParams,
}));

vi.mock("@/components/chat/copilotkit-v2-shell", () => ({
  CopilotKitV2Shell: () => <div data-testid="shell" />,
}));

function SelectedAgentProbe() {
  const { selectedAgentId } = useCopilotKitV2AgentSelection();
  return <div data-testid="selected-agent">{selectedAgentId ?? "(none)"}</div>;
}

function renderWithProvider() {
  return render(
    <CopilotKitV2AgentSelectionProvider>
      <SelectedAgentProbe />
      <CopilotKitV2ShellRoute />
    </CopilotKitV2AgentSelectionProvider>,
  );
}

describe("AG04 CopilotKitV2ShellRoute ?agent= 深链", () => {
  it("带 ?agent= 打开 /chat → 写进选择状态", async () => {
    searchParams = new URLSearchParams({ agent: "agent-1" });
    renderWithProvider();
    expect(await screen.findByTestId("selected-agent")).toHaveTextContent("agent-1");
  });

  it("agent id 需要 URL 解码", async () => {
    searchParams = new URLSearchParams();
    searchParams.set("agent", "a b");
    renderWithProvider();
    expect(await screen.findByTestId("selected-agent")).toHaveTextContent("a b");
  });

  it("没有 ?agent= → 维持未选择（与既有行为逐字相同）", () => {
    searchParams = new URLSearchParams();
    renderWithProvider();
    expect(screen.getByTestId("selected-agent")).toHaveTextContent("(none)");
  });

  it("已经选中别的 agent 时不覆盖（只设初值的纪律）", () => {
    searchParams = new URLSearchParams({ agent: "agent-2" });
    render(
      <CopilotKitV2AgentSelectionProvider initialAgentId="agent-pinned">
        <SelectedAgentProbe />
        <CopilotKitV2ShellRoute />
      </CopilotKitV2AgentSelectionProvider>,
    );
    expect(screen.getByTestId("selected-agent")).toHaveTextContent("agent-pinned");
  });
});
