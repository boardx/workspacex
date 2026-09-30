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
  const card = (agentId: string, roleCategory: "research" | "product", key: string, workflow: string, tags: string[] = []): AgentDirectoryCard => ({
    agentId, versionId: `${agentId}-v1`, name: agentId, initials: "XX", roleLabel: `${workflow}专家`,
    avatar: { kind: "illustration", key, alt: "portrait" } as AgentDirectoryCard["avatar"],
    roleCategory, tags, catalogSource: "official" as AgentDirectoryCard["catalogSource"],
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
    expect(cards[0]).not.toHaveTextContent("随时可用");
    fireEvent.mouseEnter(cards[0]!);
    expect(screen.getByTestId("chat-task-workbench-capability-facet-status")).toHaveAttribute("data-status", "ready");
    expect(container.querySelector('img[src="/avatars/digital-humans/dh-02-research-knowledge-analyst.webp"]')).toBeTruthy();
  });

  it("真实标签：筛选 chip = 出现过的标签并集；没打标签的回退分类名；卡片显示标签", () => {
    const tagged = new Map([
      ["a1", card("a1", "research", "dh-02-research-knowledge-analyst", "深度研究", ["调研", "销售"])],
      ["a2", card("a2", "product", "dh-03-product-manager", "需求拆解")],
      ["a3", card("a3", "product", "dh-05-sales-representative", "商机推进", ["销售"])],
    ]);
    const three = [...listings, { ...base, id: "a3", name: "销售小王", abbr: "XW", duty: "跟进客户" }];
    render(<CapabilityCardList listings={three} selectedAgentId={null} onSelect={vi.fn()} directory={tagged} />);
    const group = screen.getByTestId("chat-task-workbench-capability-tags");
    expect(Array.from(group.querySelectorAll("[data-tag]")).map((el) => el.textContent)).toEqual(["调研", "销售", "产品"]);
    expect(screen.queryByRole("button", { name: "研究" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "销售" }));
    const cards = screen.getAllByTestId("chat-task-workbench-capability-card");
    expect(cards.map((el) => el.dataset.agentId)).toEqual(["a1", "a3"]);
    expect(cards[0]).toHaveTextContent("调研");
    fireEvent.click(screen.getByRole("button", { name: "产品" }));
    expect(screen.getAllByTestId("chat-task-workbench-capability-card").map((el) => el.dataset.agentId)).toEqual(["a2"]);
    fireEvent.click(screen.getByRole("button", { name: "全部" }));
    fireEvent.change(screen.getByRole("searchbox", { name: "搜索数字人" }), { target: { value: "调研" } });
    expect(screen.getAllByTestId("chat-task-workbench-capability-card").map((el) => el.dataset.agentId)).toEqual(["a1"]);
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

describe("2026-09-30 重设计：分组 / 副标题去重 / 预览披露 / 待启用官方数字人", () => {
  const mk = (id: string, name: string, extra: Partial<CapabilityListing> = {}): CapabilityListing => ({ id, orgId: "org", kind: "agent", name, scope: "org-wide", enabled: true, endpoint: null, abbr: null, duty: name, disabledReason: null, agentAvailable: true, ...extra });
  const dh: AgentDirectoryCard = {
    agentId: "dh1", versionId: "v", name: "Product Manager", initials: "PM", roleLabel: "Product Manager",
    avatar: { kind: "illustration", key: "dh-03-product-manager", alt: "pm" } as AgentDirectoryCard["avatar"],
    roleCategory: "product", tags: ["产品", "需求"], catalogSource: "official" as AgentDirectoryCard["catalogSource"],
    workflows: [{ stableId: "W027" as AgentDirectoryCard["workflows"][number]["stableId"], name: "机会评估" }], readiness: "ready",
  };
  const listings = [
    mk("gen", "DT Agent"),
    mk("off", "Broken", { agentAvailable: false, disabledReason: "该 Agent 尚无可用的已发布版本，请联系管理员。" }),
    mk("dh1", "Product Manager"),
  ];
  const directory = new Map([["dh1", dh]]);

  it("数字人分组在前、其他 Agent 其次、不可用折叠在底部并给短原因；名字=副标题时不重复", () => {
    render(<CapabilityCardList listings={listings} selectedAgentId={null} onSelect={vi.fn()} directory={directory} />);
    const ids = screen.getAllByTestId("chat-task-workbench-capability-card").map((el) => el.dataset.agentId);
    expect(ids).toEqual(["dh1", "gen", "off"]);
    const dt = screen.getByRole("option", { name: /DT Agent/ });
    expect(dt.textContent?.match(/DT Agent/g)).toHaveLength(1);
    const group = screen.getByTestId("chat-task-workbench-capability-group-unavailable");
    expect(group).toHaveTextContent("不可用（1）");
    expect(group).toHaveTextContent("尚无可用的已发布版本");
    expect(group).not.toHaveTextContent("请联系管理员");
    // 卡片上不再常驻六项披露那行噪音
    expect(screen.queryByText("写权限未披露")).toBeNull();
  });

  it("六项披露在预览栏里（高亮哪张显示哪张）", () => {
    render(<CapabilityCardList listings={listings} selectedAgentId={null} onSelect={vi.fn()} directory={directory} />);
    fireEvent.focus(screen.getByRole("option", { name: /Product Manager/ }));
    const preview = screen.getByTestId("chat-task-workbench-capability-preview");
    for (const f of ["strengths", "tools", "materials", "writes", "memory", "status"]) {
      expect(preview.querySelector(`[data-testid="chat-task-workbench-capability-facet-${f}"]`)).toBeTruthy();
    }
    expect(preview).toHaveTextContent("机会评估");
    expect(preview).toHaveTextContent("官方数字人");
  });

  it("待启用官方数字人：成员看到「需管理员启用」，管理员一键启用", () => {
    const enable = vi.fn();
    const offer = { packId: "official-digitalhuman-roles", packVersion: "1.2.0", canEnable: false, pending: [
      { roleRef: "D002", name: "Research & Knowledge Analyst", roleLabel: "Research & Knowledge Analyst", avatar: { kind: "illustration" as const, key: "dh-02-research-knowledge-analyst", alt: "r" }, roleCategory: "research" as const, tags: ["调研"], workflowAllowlist: ["W001"] },
    ] } as unknown as NonNullable<Parameters<typeof CapabilityCardList>[0]["official"]>["offer"];
    const { rerender } = render(<CapabilityCardList listings={[]} selectedAgentId={null} onSelect={vi.fn()} official={{ offer, enabling: false, error: null, enable }} />);
    expect(screen.getByTestId("chat-task-workbench-capability-pending")).toHaveTextContent("Research & Knowledge Analyst");
    expect(screen.getByText("需管理员启用")).toBeTruthy();
    expect(screen.queryByTestId("chat-task-workbench-capability-none")).toBeNull();
    rerender(<CapabilityCardList listings={[]} selectedAgentId={null} onSelect={vi.fn()} official={{ offer: { ...offer!, canEnable: true }, enabling: false, error: null, enable }} />);
    fireEvent.click(screen.getByTestId("chat-task-workbench-capability-enable-official"));
    expect(enable).toHaveBeenCalledOnce();
  });

  it("空组织给空态", () => {
    render(<CapabilityCardList listings={[]} selectedAgentId={null} onSelect={vi.fn()} />);
    expect(screen.getByTestId("chat-task-workbench-capability-none")).toBeTruthy();
  });
});
