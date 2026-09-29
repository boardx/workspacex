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
    expect(screen.getByTestId("agent-directory-group-research")).not.toBeNull();
    expect(screen.getByTestId("agent-directory-group-sales")).not.toBeNull();
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

  it("其它失败渲染错误态并可重试", async () => {
    const fetchDirectory = vi.fn()
      .mockRejectedValueOnce(new Error("network down"))
      .mockResolvedValueOnce([card({ agentId: "a1", name: "小析", roleCategory: "research" })]);
    render(<AgentDirectory fetchDirectory={fetchDirectory} />);
    await waitFor(() => expect(screen.getByRole("alert")).not.toBeNull());
    expect(screen.getByRole("alert").textContent).toContain("network down");
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

  it("avatar=null → 卡片头像回退首字母；readiness=missing 显示「能力未就绪」，不泄露细节", async () => {
    const fetchDirectory = vi.fn().mockResolvedValue([
      card({ agentId: "a1", name: "Design", roleCategory: "design", readiness: "missing", avatar: null }),
    ]);
    render(<AgentDirectory fetchDirectory={fetchDirectory} />);
    await waitFor(() => expect(screen.getByTestId("agent-card-a1")).not.toBeNull());
    const avatar = screen.getByTestId("agent-card-avatar");
    expect(avatar.getAttribute("role")).toBeNull();
    expect(within(screen.getByTestId("agent-card-a1")).getByTestId("agent-card-readiness").textContent).toBe("能力未就绪");
  });

  it("avatar 为插画 key 时卡片头像渲染插画", async () => {
    const fetchDirectory = vi.fn().mockResolvedValue([
      card({ agentId: "a1", name: "Design", roleCategory: "design", avatar: { kind: "illustration", key: "person-9", alt: "Design" } }),
    ]);
    render(<AgentDirectory fetchDirectory={fetchDirectory} />);
    await waitFor(() => expect(screen.getByTestId("agent-card-avatar").getAttribute("data-avatar-key")).toBe("person-9"));
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
          roleLabel: "Research & Knowledge Analyst", avatar: null, roleCategory: "research",
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
});
