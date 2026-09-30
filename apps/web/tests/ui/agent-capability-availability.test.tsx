import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { CapabilityCardList, enableResultText } from "@/components/chat/chat-task-workbench-capability-picker";
import type { CapabilityListing } from "@/lib/live-capabilities";
import type { AgentDirectoryCard } from "@/lib/agent-directory";

afterEach(cleanup);
it("keeps configured unavailable Agents visible but unselectable alongside ready Agents", () => {
  const select = vi.fn();
  const saved: CapabilityListing = { id: "saved", orgId: "org", kind: "agent", name: "Saved Agent", scope: "org-wide", enabled: true, endpoint: null, abbr: "SA", duty: "Assistant", disabledReason: "该 Agent 尚无可用的已发布版本，请联系管理员。", agentAvailable: false };
  render(<CapabilityCardList listings={[saved, { ...saved, id: "ready", name: "Ready Agent", agentAvailable: true, disabledReason: null }]} selectedAgentId={null} onSelect={select} />);
  const unavailable = screen.getByRole("option", { name: /Saved Agent/ });
  expect(unavailable).toBeDisabled();
  expect(unavailable).toHaveTextContent("尚未发布");
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
    expect(group).toHaveTextContent("尚未发布");
    expect(group).not.toHaveTextContent("请联系管理员");
    // 卡片上不再常驻六项披露那行噪音
    expect(screen.queryByText("写权限未披露")).toBeNull();
  });

  it("手机抽屉：点一行进详情步（返回箭头 + 选择按钮），选择才回传；返回回到列表", () => {
    const select = vi.fn();
    render(<CapabilityCardList sheet listings={listings} selectedAgentId={null} onSelect={select} directory={directory} />);
    fireEvent.click(screen.getByRole("option", { name: /Product Manager/ }));
    expect(select).not.toHaveBeenCalled();
    const preview = screen.getByTestId("chat-task-workbench-capability-preview");
    expect(preview).toHaveAttribute("data-step", "detail");
    expect(preview).toHaveTextContent("适合这样问");
    expect(screen.getByRole("listbox").parentElement).toHaveClass("hidden");
    fireEvent.click(screen.getByTestId("chat-task-workbench-capability-detail-choose"));
    expect(select).toHaveBeenCalledWith("dh1");
    fireEvent.click(screen.getByTestId("chat-task-workbench-capability-detail-back"));
    expect(screen.getByRole("listbox").parentElement).not.toHaveClass("hidden");
  });

  it("可发起超过 5 项：「另有 n 个」点开显示全部，「收起」还原", () => {
    const many = { agentId: "a1", versionId: "v", name: "a1", initials: "XX", roleLabel: "x", avatar: null, roleCategory: "research", tags: [], catalogSource: "official", readiness: "ready", workflows: Array.from({ length: 7 }, (_, i) => ({ stableId: `w${i}` as AgentDirectoryCard["workflows"][number]["stableId"], name: `流程${i}` })) } as unknown as AgentDirectoryCard;
    render(<CapabilityCardList listings={[{ id: "a1", orgId: "org", kind: "agent", name: "研究员小林", scope: "org-wide", enabled: true, endpoint: null, abbr: "RL", duty: "文献检索", disabledReason: null, agentAvailable: true }]} selectedAgentId="a1" onSelect={vi.fn()} directory={new Map([["a1", many]])} />);
    fireEvent.click(screen.getByRole("button", { name: "另有 2 个" }));
    expect(screen.getByText("流程6")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "收起" }));
    expect(screen.queryByText("流程6")).toBeNull();
  });

  it("手机抽屉详情步：可发起超过 5 项用同一个展开/收起开关（不是纯文字「另有 n 个」）", () => {
    const many = { agentId: "a1", versionId: "v", name: "a1", initials: "XX", roleLabel: "x", avatar: null, roleCategory: "research", tags: [], catalogSource: "official", readiness: "ready", workflows: Array.from({ length: 6 }, (_, i) => ({ stableId: `w${i}` as AgentDirectoryCard["workflows"][number]["stableId"], name: `流程${i}` })) } as unknown as AgentDirectoryCard;
    render(<CapabilityCardList sheet listings={[{ id: "a1", orgId: "org", kind: "agent", name: "研究员小林", scope: "org-wide", enabled: true, endpoint: null, abbr: "RL", duty: "文献检索", disabledReason: null, agentAvailable: true }]} selectedAgentId={null} onSelect={vi.fn()} directory={new Map([["a1", many]])} />);
    fireEvent.click(screen.getByRole("option", { name: /研究员小林/ }));
    const preview = screen.getByTestId("chat-task-workbench-capability-preview");
    expect(preview).toHaveAttribute("data-step", "detail");
    expect(screen.queryByText("流程5")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "另有 1 个" }));
    expect(screen.getByText("流程5")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "收起" }));
    expect(screen.queryByText("流程5")).toBeNull();
  });

  it("待启用官方数字人详情步：「启用后可发起」超过 5 项同样可展开/收起", () => {
    const offer = { packId: "p", packVersion: "1", canEnable: false, pending: [
      { roleRef: "D002", name: "产品经理", roleLabel: "产品经理", avatar: null, roleCategory: "product" as const, tags: [], workflowAllowlist: ["W001", "W002", "W027", "W028", "W029", "W030"] },
    ] } as unknown as NonNullable<Parameters<typeof CapabilityCardList>[0]["official"]>["offer"];
    render(<CapabilityCardList sheet listings={[]} selectedAgentId={null} onSelect={vi.fn()} official={{ offer, enabling: false, error: null, enable: vi.fn() }} />);
    fireEvent.click(screen.getByTestId("chat-task-workbench-capability-pending"));
    expect(screen.queryByText("PRD 到迭代计划")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "另有 1 个" }));
    expect(screen.getByText("PRD 到迭代计划")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "收起" }));
    expect(screen.queryByText("PRD 到迭代计划")).toBeNull();
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

describe("UIUX 复审 r1（picker）", () => {
  const mk = (id: string, name: string, extra: Partial<CapabilityListing> = {}): CapabilityListing => ({ id, orgId: "org", kind: "agent", name, scope: "org-wide", enabled: true, endpoint: null, abbr: null, duty: name, disabledReason: null, agentAvailable: true, ...extra });
  const dhCard = (agentId: string, name: string, tags: string[], workflows: { stableId: string; name: string }[] = []): AgentDirectoryCard => ({
    agentId, versionId: "v", name, initials: name.slice(0, 1), roleLabel: name, avatar: null, roleCategory: "design",
    tags, catalogSource: "official" as AgentDirectoryCard["catalogSource"], workflows: workflows as AgentDirectoryCard["workflows"], readiness: "ready",
  });

  it("预览栏：擅长由标签派生、不回显名字；无数据的披露不再逐行写「暂缺该项披露」，六个锚点仍在", () => {
    const directory = new Map([["d", dhCard("d", "设计思维专家", ["设计", "创新", "用户研究"])]]);
    render(<CapabilityCardList listings={[mk("d", "设计思维专家")]} selectedAgentId={null} onSelect={vi.fn()} directory={directory} />);
    fireEvent.focus(screen.getByRole("option", { name: /设计思维专家/ }));
    const preview = screen.getByTestId("chat-task-workbench-capability-preview");
    expect(screen.getByTestId("chat-task-workbench-capability-facet-strengths")).toHaveTextContent("设计、创新、用户研究");
    expect(preview).not.toHaveTextContent("暂缺该项披露");
    expect(preview).not.toHaveTextContent("未登记");
    for (const f of ["strengths", "tools", "materials", "writes", "memory", "status"]) {
      expect(preview.querySelectorAll(`[data-testid="chat-task-workbench-capability-facet-${f}"]`)).toHaveLength(1);
    }
  });

  it("默认（自动匹配）预览不再空白：列出可能接手的数字人", () => {
    const directory = new Map([["d", dhCard("d", "产品经理", ["产品"], [{ stableId: "W029", name: "问题到需求文档" }])]]);
    render(<CapabilityCardList listings={[mk("d", "产品经理")]} selectedAgentId={null} onSelect={vi.fn()} directory={directory} />);
    expect(screen.getByTestId("chat-task-workbench-capability-auto-candidates")).toHaveTextContent("产品经理");
  });

  it("标签行换行不裁切；超过一行的收进「更多」", () => {
    const tags = ["a", "b", "c", "d", "e", "f", "g", "h"];
    const directory = new Map([["d", dhCard("d", "X", tags)]]);
    render(<CapabilityCardList listings={[mk("d", "X")]} selectedAgentId={null} onSelect={vi.fn()} directory={directory} />);
    const row = screen.getByTestId("chat-task-workbench-capability-tags");
    expect(row.className).toContain("flex-wrap");
    expect(row.className).not.toContain("overflow-x-auto");
    expect(row.querySelector('[data-tag="h"]')).toBeNull();
    fireEvent.click(screen.getByTestId("chat-task-workbench-capability-tags-more"));
    expect(row.querySelector('[data-tag="h"]')).toBeTruthy();
  });

  it("一键启用显示进度与结果", () => {
    const offer = { packId: "p", packVersion: "1", canEnable: true, requiredSkillPacks: [], pending: [
      { roleRef: "D003", name: "产品经理", roleLabel: "产品经理", avatar: null, roleCategory: "product" as const, tags: [], workflowAllowlist: ["W029"] },
    ] } as unknown as NonNullable<Parameters<typeof CapabilityCardList>[0]["official"]>["offer"];
    const { rerender } = render(<CapabilityCardList listings={[]} selectedAgentId={null} onSelect={vi.fn()} official={{ offer, enabling: true, error: null, enable: vi.fn(), progress: { step: 2, total: 3, label: "准备数字人需要的技能与流程" } }} />);
    expect(screen.getByTestId("chat-task-workbench-capability-enable-progress")).toHaveTextContent("（2/3）");
    rerender(<CapabilityCardList listings={[]} selectedAgentId={null} onSelect={vi.fn()} official={{ offer: { ...offer!, pending: [] }, enabling: false, error: null, enable: vi.fn(), result: "已启用 4 位官方数字人，可发起 9 个流程。" }} />);
    expect(screen.getByTestId("chat-task-workbench-capability-enable-result")).toHaveTextContent("可发起 9 个流程");
  });

  it("启用结果文案按目录如实数：可发起流程数去重，没有流程的点名", () => {
    const cards = [
      dhCard("a", "产品经理", [], [{ stableId: "W029", name: "x" }, { stableId: "W027", name: "y" }]),
      dhCard("b", "设计思维专家", [], [{ stableId: "W029", name: "x" }]),
      dhCard("c", "销售代表", []),
    ];
    expect(enableResultText(cards)).toBe("已启用 3 位官方数字人，可发起 2 个流程。销售代表暂无可发起的流程，可先直接对话。");
  });
});
