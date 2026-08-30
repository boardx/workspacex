/**
 * Agent 目录（`/admin/agent`）接入 `EntityViewToggle` 的机械回归
 * （2026-08-15，人类原话：「后台的管理功能…右边列出卡片来表达当前的 entity 的列表，
 * 卡片也可以切换为列表」）。
 *
 * 覆盖 `entity-view-toggle.test.tsx` 覆盖不到的那一半：真实接入点
 * （`capability-catalog-screen.tsx` 的 `renderCapabilityRow`）——默认卡片视图渲染的
 * 网格容器 class 真的换了，且编辑 / 停用入口在两态下都存在、断言的是**真实按钮点击后
 * 的 DOM 结果**而不是元素存在与否的空转。
 */
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { agentRuntime } from "@repo/contracts";
import { SESSION_TOKEN_STORAGE_KEY } from "@/lib/api-client";

const sessionState = vi.hoisted(() => ({ currentOrgId: "org-view-toggle", orgRole: "admin" }));

vi.mock("@/components/session/session-provider", () => ({
  useSession: () => ({
    session: { currentOrgId: sessionState.currentOrgId },
    identity: {
      org: { id: sessionState.currentOrgId, name: "真实组织" },
      orgRole: sessionState.orgRole,
    },
  }),
}));

/**
 * 2026-08-30：「编辑」链接带 `?from=<当前 URL>`（见 `capability-catalog-screen.tsx`
 * 的 `editHrefFor`），需要 `usePathname`/`useSearchParams` 有确定返回值。
 */
vi.mock("next/navigation", () => ({
  usePathname: () => "/admin/agent",
  useSearchParams: () => new URLSearchParams(),
}));

import { AgentScreen } from "@/components/admin/agent-screen";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function agentRow(id: string, name: string) {
  return {
    id,
    orgId: sessionState.currentOrgId,
    kind: "agent",
    name,
    scope: "org-wide",
    enabled: true,
    endpoint: null,
    disabledReason: null,
  };
}

describe("Agent 目录：默认卡片视图，可切换为列表", () => {
  beforeEach(() => {
    sessionState.currentOrgId = "org-view-toggle";
    sessionState.orgRole = "admin";
    window.localStorage.clear();
    window.localStorage.setItem(SESSION_TOKEN_STORAGE_KEY, "tok-view-toggle");
    // ⚠ #1915 起 `AgentScreen` 还并行挂了 `AgentDefinitionListPanel`（独立的
    // `GET /agents`）——按路径分流，避免它吃到本测试给 `/capabilities` 准备的
    // capability-listing 形状（没有 `agentId` 字段，会在那边触发一个 React key 警告）。
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = new URL(typeof input === "string" ? input : input.toString());
        if (url.pathname === agentRuntime.operations.listAgents.path) return jsonResponse([]);
        return jsonResponse([agentRow("agent-vt-1", "视图切换测试 Agent")]);
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("首次渲染就是卡片网格容器（默认视图 = 卡片），且能看到这一行 Agent", async () => {
    render(<AgentScreen state="default" />);

    // `cardContainerTestId`/`listContainerTestId` 都指回 `admin-agent-list`——
    // 这里额外断言 DOM class 确实是网格排列，不是靠 testid 名字空转出「已经是卡片」。
    const container = await screen.findByTestId("admin-agent-list");
    expect(container.className).toContain("grid");
    expect(container).toHaveTextContent("视图切换测试 Agent");

    expect(screen.getByTestId("admin-agent-view-toggle-card")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByTestId("admin-agent-view-toggle-list")).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("点击列表切换按钮后：容器 class 从网格变成纵向 flex，行内容与编辑入口原样保留", async () => {
    render(<AgentScreen state="default" />);
    await screen.findByTestId("admin-agent-list");

    fireEvent.click(screen.getByTestId("admin-agent-view-toggle-list"));

    const container = screen.getByTestId("admin-agent-list");
    // 反空转关键点：真的点击之后 class 真的换了（网格 → 纵向单列），
    // 不是「按钮存在就算数」。
    expect(container.className).not.toContain("grid");
    expect(container.className).toContain("flex-col");
    expect(container).toHaveTextContent("视图切换测试 Agent");

    // 切到列表视图后，既有的编辑 / 停用入口（`CapabilityRow`，未被这次改动重写）
    // 仍然可达——保留现有的所有功能，只改展示层。
    const row = within(container).getByTestId("admin-agent-row-agent-vt-1");
    expect(within(row).getByTestId("admin-agent-row-agent-vt-1-edit")).toBeInTheDocument();
    expect(within(row).getByTestId("admin-agent-row-agent-vt-1-disable")).toBeInTheDocument();

    expect(screen.getByTestId("admin-agent-view-toggle-list")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("卡片视图下编辑入口同样可达——切换视图不改变功能，只改变排列方式", async () => {
    render(<AgentScreen state="default" />);
    const container = await screen.findByTestId("admin-agent-list");

    const row = within(container).getByTestId("admin-agent-row-agent-vt-1");
    // 人类反馈（2026-08-17）：「编辑」现在是一条指向独立页面的链接，不再是
    // 内联展开——断言的是 href，不是点击后本页出现表单字段。
    const link = within(row).getByTestId("admin-agent-row-agent-vt-1-edit");
    expect(link.getAttribute("href")).toBe("/admin/agent/agent-vt-1?from=%2Fadmin%2Fagent");
  });
});
