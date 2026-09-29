import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { CapabilityCardList } from "@/components/chat/chat-task-workbench-capability-picker";
import type { CapabilityListing } from "@/lib/live-capabilities";
import type { AgentDirectoryCard } from "@/lib/agent-directory";

afterEach(cleanup);
it("keeps configured unavailable Agents visible but unselectable alongside ready Agents", () => {
  const select = vi.fn();
  const saved: CapabilityListing = { id: "saved", orgId: "org", kind: "agent", name: "Saved Agent", scope: "org-wide", enabled: true, endpoint: null, abbr: "SA", duty: "Assistant", disabledReason: "该 Agent 尚无可用的已发布版本，请联系管理员。", agentAvailable: false };
  render(<CapabilityCardList listings={[saved, { ...saved, id: "ready", name: "Ready Agent", agentAvailable: true, disabledReason: null }]} selectedAgentId={null} onSelect={select} />);
  const unavailable = screen.getByRole("option", { name: /Saved Agent/ });
  expect(unavailable).toBeDisabled();
  expect(unavailable).toHaveTextContent("尚无可用的已发布版本");
  fireEvent.click(unavailable);
  expect(select).not.toHaveBeenCalled();
  const ready = screen.getByRole("option", { name: /Ready Agent/ });
  expect(ready).toBeEnabled();
  fireEvent.click(ready);
  expect(select).toHaveBeenCalledWith("ready");
});

describe("数字人选择器：搜索 / 标签 / 自动匹配 / 真人像", () => {
  const base: CapabilityListing = { id: "a1", orgId: "org", kind: "agent", name: "研究员小林", scope: "org-wide", enabled: true, endpoint: null, abbr: "RL", duty: "文献检索", disabledReason: null, agentAvailable: true };
  const listings: CapabilityListing[] = [base, { ...base, id: "a2", name: "产品经理阿周", abbr: "PM", duty: "写需求" }];
  const card = (agentId: string, roleCategory: "research" | "product", key: string, workflow: string): AgentDirectoryCard => ({
    agentId, versionId: `${agentId}-v1`, name: agentId, initials: "XX", roleLabel: `${workflow}专家`,
    avatar: { kind: "illustration", key, alt: "portrait" } as AgentDirectoryCard["avatar"],
    roleCategory, catalogSource: "official" as AgentDirectoryCard["catalogSource"],
    workflows: [{ stableId: `${agentId}-wf` as AgentDirectoryCard["workflows"][number]["stableId"], name: workflow }], readiness: "ready",
  });
  const directory = new Map([
    ["a1", card("a1", "research", "dh-02-research-knowledge-analyst", "深度研究")],
    ["a2", card("a2", "product", "dh-03-product-manager", "需求拆解")],
  ]);

  it("自动匹配是第一项，选它回传 null", () => {
    const select = vi.fn();
    render(<CapabilityCardList listings={listings} selectedAgentId="a1" onSelect={select} directory={directory} />);
    const options = screen.getAllByRole("option");
    expect(options[0]).toHaveTextContent("自动匹配");
    fireEvent.click(options[0]!);
    expect(select).toHaveBeenCalledWith(null);
  });

  it("按名字/能力搜索，无结果时给空态并可一键清除", () => {
    render(<CapabilityCardList listings={listings} selectedAgentId={null} onSelect={vi.fn()} directory={directory} />);
    const search = screen.getByRole("searchbox", { name: "搜索数字人" });
    fireEvent.change(search, { target: { value: "需求拆解" } });
    expect(screen.getAllByTestId("chat-task-workbench-capability-card").map((el) => el.dataset.agentId)).toEqual(["a2"]);
    fireEvent.change(search, { target: { value: "不存在的人" } });
    expect(screen.getByTestId("chat-task-workbench-capability-empty")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "清除搜索与筛选" }));
    expect(screen.getAllByTestId("chat-task-workbench-capability-card")).toHaveLength(2);
  });

  it("按分类标签筛选，卡片用 dh-* 真人像与能力标签", () => {
    const { container } = render(<CapabilityCardList listings={listings} selectedAgentId={null} onSelect={vi.fn()} directory={directory} />);
    fireEvent.click(screen.getByRole("button", { name: "研究" }));
    const cards = screen.getAllByTestId("chat-task-workbench-capability-card");
    expect(cards.map((el) => el.dataset.agentId)).toEqual(["a1"]);
    expect(cards[0]).toHaveTextContent("深度研究");
    expect(cards[0]).toHaveTextContent("随时可用");
    expect(container.querySelector('img[src="/avatars/digital-humans/dh-02-research-knowledge-analyst.webp"]')).toBeTruthy();
  });

  it("键盘：搜索框 ↓ 聚焦第一项，列表内 ↓ 移到下一项", () => {
    render(<CapabilityCardList listings={listings} selectedAgentId={null} onSelect={vi.fn()} directory={directory} />);
    fireEvent.keyDown(screen.getByRole("searchbox"), { key: "ArrowDown" });
    const options = screen.getAllByRole("option");
    expect(document.activeElement).toBe(options[0]);
    fireEvent.keyDown(options[0]!, { key: "ArrowDown" });
    expect(document.activeElement).toBe(options[1]);
  });
});
