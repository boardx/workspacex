/**
 * AG04（契约束 agent-role UC-4，ui.md / usecases.md UC-4）—— 成员 Agent 目录。
 *
 * `AgentDirectory` 接受可注入的 `fetchDirectory`，多数用例直接注入假实现断言渲染/交互
 * ——不经真实网络也不用 mock DB。最后一组用例改为 stub 全局 `fetch`，走真实
 * `lib/agent-directory.ts` 的 `listAgentDirectory`，证明它与 `@repo/contracts` 的
 * `agentRole` 契约形状对得上（路径、query、响应体解析），不是两边各写一份、看起来像
 * 却对不上。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { AgentDirectory } from "@/components/agent/agent-directory";
import { ApiError } from "@/lib/api-client";
import { listAgentDirectory, type AgentDirectoryCard } from "@/lib/agent-directory";

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function card(overrides: Partial<AgentDirectoryCard> & Pick<AgentDirectoryCard, "agentId" | "name" | "roleCategory">): AgentDirectoryCard {
  return {
    versionId: `${overrides.agentId}-v1`,
    initials: overrides.name.slice(0, 1),
    roleLabel: "Research & Knowledge Analyst",
    avatar: null,
    tags: [],
    catalogSource: "official",
    workflows: [{ stableId: "W001", name: "Research-to-Brief" }],
    readiness: "ready",
    ...overrides,
  };
}

describe("AgentDirectory（成员目录）", () => {
  it("加载中显示骨架态，随后按 roleCategory 分组渲染卡片", async () => {
    let resolveFetch!: (cards: readonly AgentDirectoryCard[]) => void;
    const fetchDirectory = vi.fn(() => new Promise<readonly AgentDirectoryCard[]>((resolve) => { resolveFetch = resolve; }));
    render(<AgentDirectory fetchDirectory={fetchDirectory} />);
    expect(screen.getByTestId("agent-directory-loading")).not.toBeNull();
    await waitFor(() => expect(fetchDirectory).toHaveBeenCalled());

    resolveFetch([
      card({ agentId: "a-research", name: "小析", roleCategory: "research" }),
      card({ agentId: "a-sales", name: "小销", roleCategory: "sales", roleLabel: "Sales Representative", catalogSource: "org" }),
    ]);

    await waitFor(() => expect(screen.queryByTestId("agent-directory-loading")).toBeNull());
    // 少量卡片：一张 2–3 列网格铺满容器（uiux-r1 #3：不再每类一列单卡、右半屏空着）
    const grid = screen.getByTestId("agent-directory-grid");
    expect(grid.className).toContain("md:grid-cols-2");
    expect(grid.className).toContain("xl:grid-cols-3");
    expect(screen.queryByTestId("agent-directory-group-research")).toBeNull();
    expect(within(screen.getByTestId("agent-card-a-research")).getByText("小析")).not.toBeNull();
    // 官方徽标只在 catalogSource=official 时出现
    expect(within(screen.getByTestId("agent-card-a-research")).getByTestId("agent-card-official-badge")).not.toBeNull();
    expect(within(screen.getByTestId("agent-card-a-sales")).queryByTestId("agent-card-official-badge")).toBeNull();
  });

  it("空结果渲染真实空态，不编造示例卡片", async () => {
    const fetchDirectory = vi.fn().mockResolvedValue([]);
    render(<AgentDirectory fetchDirectory={fetchDirectory} />);
    await waitFor(() => expect(screen.getByTestId("agent-directory-empty")).not.toBeNull());
    expect(screen.queryByTestId(/^agent-card-/)).toBeNull();
  });

  it("401 渲染无权占位（直链/会话失效同一处理）", async () => {
    const fetchDirectory = vi.fn().mockRejectedValue(new ApiError(401, "UNAUTHENTICATED", null));
    render(<AgentDirectory fetchDirectory={fetchDirectory} />);
    await waitFor(() => expect(screen.getByTestId("agent-directory-denied")).not.toBeNull());
  });

  it("API 错误只显示人话，不把 reasonCode 端上屏（曾显示 AGENT_NOT_FOUND）", async () => {
    const fetchDirectory = vi.fn().mockRejectedValue(new ApiError(404, "AGENT_NOT_FOUND", null));
    render(<AgentDirectory fetchDirectory={fetchDirectory} />);
    await waitFor(() => expect(screen.getByRole("alert")).not.toBeNull());
    const text = screen.getByRole("alert").textContent ?? "";
    expect(text).not.toContain("AGENT_NOT_FOUND");
    expect(text).not.toMatch(/[A-Z]{3,}_[A-Z_]+/);
    expect(text).toContain("角色目录加载失败");
  });

  it("其它失败渲染错误态并可重试", async () => {
    const fetchDirectory = vi.fn()
      .mockRejectedValueOnce(new Error("network down"))
      .mockResolvedValueOnce([card({ agentId: "a1", name: "小析", roleCategory: "research" })]);
    render(<AgentDirectory fetchDirectory={fetchDirectory} />);
    await waitFor(() => expect(screen.getByRole("alert")).not.toBeNull());
    expect(screen.getByRole("alert").textContent).not.toContain("network down");
    expect(screen.getByRole("alert").textContent).toContain("网络连接出了问题");
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    await waitFor(() => expect(screen.getByTestId("agent-card-a1")).not.toBeNull());
  });

  it("按分类筛选：点击分类按钮重新以 roleCategory 过滤请求", async () => {
    const fetchDirectory = vi.fn().mockResolvedValue([card({ agentId: "a1", name: "小析", roleCategory: "research" })]);
    render(<AgentDirectory fetchDirectory={fetchDirectory} />);
    await waitFor(() => expect(fetchDirectory).toHaveBeenCalledWith({ roleCategory: undefined, q: undefined }));
    fireEvent.click(within(screen.getByTestId("agent-directory-filter-category")).getByRole("button", { name: "研究" }));
    await waitFor(() => expect(fetchDirectory).toHaveBeenLastCalledWith({ roleCategory: "research", q: undefined }));
  });

  it("搜索框输入触发按 q 过滤的请求（防抖，最终只带最后一次输入的值）", async () => {
    vi.useFakeTimers();
    const fetchDirectory = vi.fn().mockResolvedValue([]);
    render(<AgentDirectory fetchDirectory={fetchDirectory} />);
    fireEvent.change(screen.getByTestId("agent-directory-search"), { target: { value: "析" } });
    fireEvent.change(screen.getByTestId("agent-directory-search"), { target: { value: "析师" } });
    await vi.advanceTimersByTimeAsync(300);
    expect(fetchDirectory).toHaveBeenLastCalledWith({ roleCategory: undefined, q: "析师" });
    vi.useRealTimers();
  });

  it("avatar=null → 卡片头像回退首字母；readiness=missing 显示「部分能力待开通」，不泄露细节", async () => {
    const fetchDirectory = vi.fn().mockResolvedValue([
      card({ agentId: "a1", name: "Design", roleCategory: "design", readiness: "missing", avatar: null }),
    ]);
    render(<AgentDirectory fetchDirectory={fetchDirectory} />);
    await waitFor(() => expect(screen.getByTestId("agent-card-a1")).not.toBeNull());
    const avatar = screen.getByTestId("agent-card-avatar");
    expect(avatar.getAttribute("role")).toBeNull();
    expect(within(screen.getByTestId("agent-card-a1")).getByTestId("agent-card-readiness").textContent).toBe("部分能力待开通");
  });

  it("avatar 为插画 key 时卡片头像渲染插画", async () => {
    const fetchDirectory = vi.fn().mockResolvedValue([
      card({ agentId: "a1", name: "Design", roleCategory: "design", avatar: { kind: "illustration", key: "person-9", alt: "Design" } }),
    ]);
    render(<AgentDirectory fetchDirectory={fetchDirectory} />);
    await waitFor(() => expect(screen.getByTestId("agent-card-avatar").getAttribute("data-avatar-key")).toBe("person-9"));
  });

  it("卡片显示数字人标签；没有标签时用角色类别兜一枚中性标签（uiux-r5）", async () => {
    const fetchDirectory = vi.fn().mockResolvedValue([
      card({ agentId: "a1", name: "小销", roleCategory: "sales", tags: ["销售", "客户"] }),
      card({ agentId: "a2", name: "小研", roleCategory: "research" }),
    ]);
    render(<AgentDirectory fetchDirectory={fetchDirectory} />);
    await waitFor(() => expect(screen.getByTestId("agent-card-a1")).not.toBeNull());
    expect(within(screen.getByTestId("agent-card-a1")).getByTestId("agent-card-tags")).toHaveTextContent("销售客户");
    expect(within(screen.getByTestId("agent-card-a2")).getByTestId("agent-card-tags")).toHaveTextContent("研究");
  });

  it("uiux-r5：无类别无标签的通用助手显示「通用」标签", async () => {
    render(<AgentDirectory fetchDirectory={vi.fn().mockResolvedValue([card({ agentId: "g1", name: "通用助手", roleCategory: null })])} />);
    await waitFor(() => expect(screen.getByTestId("agent-card-g1")).not.toBeNull());
    expect(within(screen.getByTestId("agent-card-g1")).getByTestId("agent-card-tags")).toHaveTextContent("通用");
  });

  it("uiux-r5：未就绪的卡片在行内和「开始对话」的提示里说明缺什么（销售 = CRM），就绪的没有", async () => {
    render(<AgentDirectory fetchDirectory={vi.fn().mockResolvedValue([
      card({ agentId: "s1", name: "销售代表", roleCategory: "sales", readiness: "missing" }),
      card({ agentId: "r1", name: "小研", roleCategory: "research", readiness: "ready" }),
    ])} />);
    await waitFor(() => expect(screen.getByTestId("agent-card-s1")).not.toBeNull());
    const sales = within(screen.getByTestId("agent-card-s1"));
    expect(sales.getByTestId("agent-card-readiness-reason")).toHaveTextContent("销售类流程需接入 CRM 后开放");
    expect(sales.getByTestId("agent-card-start-chat").getAttribute("title")).toContain("CRM");
    expect(within(screen.getByTestId("agent-card-r1")).queryByTestId("agent-card-readiness-reason")).toBeNull();
  });

  it("点击「开始对话」把 agentId 回传给宿主", async () => {
    const onStartChat = vi.fn();
    const fetchDirectory = vi.fn().mockResolvedValue([card({ agentId: "a1", name: "小析", roleCategory: "research" })]);
    render(<AgentDirectory fetchDirectory={fetchDirectory} onStartChat={onStartChat} />);
    await waitFor(() => expect(screen.getByTestId("agent-card-a1")).not.toBeNull());
    fireEvent.click(within(screen.getByTestId("agent-card-a1")).getByTestId("agent-card-start-chat"));
    expect(onStartChat).toHaveBeenCalledWith("a1");
  });
});

describe("lib/agent-directory.ts 与真实契约对得上（stub 全局 fetch）", () => {
  it("listAgentDirectory 打到契约路径，query 与响应体按契约解析", async () => {
    let seenUrl = "";
    vi.stubGlobal("fetch", async (url: string) => {
      seenUrl = url;
      return new Response(JSON.stringify({
        items: [{
          agentId: "agent-1", versionId: "v1", name: "小析", initials: "小",
          roleLabel: "Research & Knowledge Analyst", avatar: null, roleCategory: "research", tags: ["调研"],
          catalogSource: "official", workflows: [{ stableId: "W001", name: "Research-to-Brief" }], readiness: "ready",
        }],
      }), { status: 200 });
    });
    const items = await listAgentDirectory({ roleCategory: "research", q: "析" });
    expect(seenUrl).toContain("/agents/directory");
    expect(seenUrl).toContain("roleCategory=research");
    expect(seenUrl).toContain("q=%E6%9E%90");
    expect(items).toHaveLength(1);
    expect(items[0]!.agentId).toBe("agent-1");
  });

  it("非法响应体（不符 AgentDirectoryCard 契约）抛错，不静默吞掉", async () => {
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ items: [{ agentId: "x" }] }), { status: 200 }));
    await expect(listAgentDirectory()).rejects.toThrow();
  });

  it("卡片多（超过一屏）才按类分组", async () => {
    const many = Array.from({ length: 10 }, (_, i) => card({ agentId: `a${i}`, name: `角色${i}`, roleCategory: i % 2 ? "sales" : "research" }));
    render(<AgentDirectory fetchDirectory={vi.fn().mockResolvedValue(many)} />);
    await waitFor(() => expect(screen.getByTestId("agent-directory-group-research")).not.toBeNull());
    expect(screen.getByTestId("agent-directory-group-sales")).not.toBeNull();
  });

  it("官方数字人显示中文称呼；副标题与名字重复（英文原名）时不重复，回退到中文职责", async () => {
    render(<AgentDirectory fetchDirectory={vi.fn().mockResolvedValue([
      card({
        agentId: "d2", name: "Research & Knowledge Analyst", roleLabel: "Research & Knowledge Analyst", catalogSource: "official",
        roleCategory: "research", avatar: { kind: "illustration", key: "dh-02-research-knowledge-analyst", alt: "x" },
      }),
    ])} />);
    await waitFor(() => expect(screen.getByTestId("agent-card-d2")).not.toBeNull());
    const el = screen.getByTestId("agent-card-d2");
    expect(within(el).getByTestId("agent-card-detail-link").textContent).toBe("研究与知识分析师");
    expect(el.textContent).not.toContain("Research & Knowledge Analyst");
    expect(within(el).getByTestId("agent-card-subtitle").textContent).toContain("调研");
  });

  it("uiux-r3 #3.2：渲染出来的描述停在句子边界，且不再叠 CSS 行数截断（否则整句又被视觉切断）", async () => {
    const keys = ["dh-02-research-knowledge-analyst", "dh-03-product-manager", "dh-05-sales-representative", "dh-11-design-thinking-expert"] as const;
    render(<AgentDirectory fetchDirectory={vi.fn().mockResolvedValue(keys.map((key, i) => card({
      agentId: `o${i}`, name: key, roleLabel: key, catalogSource: "official", roleCategory: "research",
      avatar: { kind: "illustration", key, alt: "x" },
    })))} />);
    await waitFor(() => expect(screen.getByTestId("agent-card-o0")).not.toBeNull());
    for (let i = 0; i < keys.length; i++) {
      const sub = within(screen.getByTestId(`agent-card-o${i}`)).getByTestId("agent-card-subtitle");
      expect(sub.textContent, sub.textContent ?? "").toMatch(/[。！？]$/);
      expect(sub.textContent).not.toMatch(/[；，、…]$/);
      expect(sub.className).not.toMatch(/line-clamp|truncate/);
    }
  });

  it("未就绪时「开始对话」降为次要按钮，不与状态徽标打架", async () => {
    render(<AgentDirectory fetchDirectory={vi.fn().mockResolvedValue([card({ agentId: "a1", name: "小研", roleCategory: "research", readiness: "unknown" })])} />);
    await waitFor(() => expect(screen.getByTestId("agent-card-start-chat")).not.toBeNull());
    expect(screen.getByTestId("agent-card-start-chat").className).toContain("bg-secondary");
  });

  it("UIUX r4：每张卡的「可发起」走同一解析——全中文、不漏英文 id；可用徽标不折行", async () => {
    render(<AgentDirectory fetchDirectory={vi.fn().mockResolvedValue([
      card({ agentId: "a1", name: "小析", roleCategory: "research", workflows: [
        { stableId: "W001", name: "Research-to-Brief" },
        { stableId: "W010", name: "Knowledge Capture Loop" },
        { stableId: "W099", name: "Custom Flow（自定义流程）" },
      ] }),
      card({ agentId: "a2", name: "小产", roleCategory: "product", workflows: [{ stableId: "W029", name: "Problem to PRD" }] }),
    ])} />);
    await waitFor(() => expect(screen.getByTestId("agent-card-a1")).not.toBeNull());
    const line1 = within(screen.getByTestId("agent-card-a1")).getByTestId("agent-card-workflows").textContent ?? "";
    expect(line1).toBe("可发起：研究到简报、知识捕获闭环、自定义流程");
    expect(within(screen.getByTestId("agent-card-a2")).getByTestId("agent-card-workflows").textContent).toBe("可发起：问题定义到 PRD");
    expect(line1).not.toMatch(/[A-Za-z]{3,}/);
    const badge = within(screen.getByTestId("agent-card-a1")).getByTestId("agent-card-readiness");
    expect(badge.className).toContain("whitespace-nowrap");
    expect(badge.className).toContain("shrink-0");
  });
});
