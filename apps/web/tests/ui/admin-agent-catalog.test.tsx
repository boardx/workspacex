/**
 * Agent 目录（`/admin/agent`）简化后的形态（2026-09-02，人类原话：「简化…为一个卡片的
 * 列表，通过一个侧边面板来展示当前的实体的内容，可以增加删除修改，并通过 tag 来过滤和搜索」）。
 *
 * 覆盖 `entity-catalog.test.tsx` 覆盖不到的那一半：真实接入点——
 *   ① F15 目录条目（`GET /capabilities`）与 F55 可执行定义（`GET /agents`）在**同一个**
 *      网格里各是一种卡片，靠标签「目录条目 / 可执行」区分，不再各摆一个列表；
 *   ② 没有卡片/列表切换按钮、没有分页；
 *   ③ 点卡片打开侧边面板：能就地改名称（`CapabilityEditForm`）、能停用；
 *   ④ 卡片上「编辑」仍是指向独立编辑页的链接（人类 2026-08-17 裁决不变）。
 */
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { agentRuntime, identity } from "@repo/contracts";
import { SESSION_TOKEN_STORAGE_KEY } from "@/lib/api-client";

const sessionState = vi.hoisted(() => ({ currentOrgId: "org-catalog", orgRole: "admin" }));

vi.mock("@/components/session/session-provider", () => ({
  useSession: () => ({
    session: { currentOrgId: sessionState.currentOrgId },
    identity: {
      org: { id: sessionState.currentOrgId, name: "真实组织" },
      orgRole: sessionState.orgRole,
    },
  }),
}));

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

function listing(id: string, name: string, over: Record<string, unknown> = {}) {
  return {
    id,
    orgId: sessionState.currentOrgId,
    kind: "agent",
    name,
    scope: "org-wide",
    enabled: true,
    endpoint: null,
    disabledReason: null,
    ...over,
  };
}

const DEFINITION = {
  agentId: "agent-def-1",
  initials: "ZB",
  name: "值班助理",
  role: "值班一句话",
  roleLabel: "值班头衔",
  visibility: "全组织可用",
  publishState: "草稿",
  modelId: null,
  skillCount: 2,
  monthlyCallCount: null,
};

describe("Agent 目录：单个卡片网格 + 搜索 / 标签 + 侧边面板", () => {
  let capabilityCalls: { method: string; body?: unknown }[];

  beforeEach(() => {
    sessionState.currentOrgId = "org-catalog";
    sessionState.orgRole = "admin";
    capabilityCalls = [];
    window.localStorage.clear();
    window.localStorage.setItem(SESSION_TOKEN_STORAGE_KEY, "tok-catalog");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(typeof input === "string" ? input : input.toString());
        if (url.pathname === agentRuntime.operations.listAgents.path) return jsonResponse([DEFINITION]);
        if (url.pathname === identity.operations.mutateCapability.path) {
          capabilityCalls.push({ method: "POST", body: JSON.parse(String(init?.body)) });
          return jsonResponse({
            listing: listing("agent-1", "改过名的 Agent"),
            affectedInFlightCalls: 0,
            provenanceEventId: "prov-1",
          });
        }
        capabilityCalls.push({ method: init?.method ?? "GET" });
        return jsonResponse([
          listing("agent-1", "客服 Agent"),
          listing("agent-2", "结算 Agent", { enabled: false, disabledReason: "由组织管理员停用", scope: "team-only" }),
        ]);
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("① 两种来源的卡片在同一个网格里，靠标签区分；② 没有视图切换与分页", async () => {
    render(<AgentScreen state="default" />);
    const list = await screen.findByTestId("admin-agent-list");
    expect(list.className).toContain("grid");
    expect(within(list).getByTestId("admin-agent-row-agent-1")).toHaveTextContent("客服 Agent");
    await waitFor(() =>
      expect(within(screen.getByTestId("admin-agent-list")).getByTestId("admin-agent-definition-agent-def-1")).toHaveTextContent("值班助理"),
    );

    expect(screen.queryByTestId("admin-agent-view-toggle-card")).toBeNull();
    expect(screen.queryByTestId("admin-agent-view-toggle-list")).toBeNull();
    expect(screen.queryByTestId("admin-agent-page-status")).toBeNull();
    // 旧的独立「Agent 列表」面板不再渲染——它已并入网格。
    expect(screen.queryByTestId("admin-agent-definition-list-panel")).toBeNull();

    const filters = screen.getByTestId("admin-agent-tag-filters");
    expect(within(filters).getByTestId("admin-agent-tag-filter-listing").textContent).toContain("目录条目 2");
    expect(within(filters).getByTestId("admin-agent-tag-filter-executable").textContent).toContain("可执行 1");

    fireEvent.click(screen.getByTestId("admin-agent-tag-filter-executable"));
    expect(screen.getByTestId("admin-agent-list").textContent).toContain("值班助理");
    expect(screen.getByTestId("admin-agent-list").textContent).not.toContain("客服 Agent");

    fireEvent.click(screen.getByTestId("admin-agent-tag-filter-all"));
    fireEvent.change(screen.getByTestId("admin-agent-search"), { target: { value: "结算" } });
    expect(screen.getByTestId("admin-agent-list").textContent).toContain("结算 Agent");
    expect(screen.getByTestId("admin-agent-list").textContent).not.toContain("客服 Agent");
    expect(screen.getByTestId("admin-agent-list").textContent).not.toContain("值班助理");
  });

  it("③ 点卡片打开侧边面板：字段、就地改名（真的打 mutate）、停用确认都在面板里", async () => {
    render(<AgentScreen state="default" />);
    await screen.findByTestId("admin-agent-list");
    expect(screen.queryByTestId("admin-agent-detail")).toBeNull();

    fireEvent.click(screen.getByTestId("admin-agent-row-agent-1"));
    const drawer = screen.getByTestId("admin-agent-detail");
    expect(drawer).toHaveTextContent("客服 Agent");
    expect(drawer).toHaveTextContent("全组织可见");

    fireEvent.change(within(drawer).getByTestId("admin-agent-row-agent-1-name"), { target: { value: "改过名的 Agent" } });
    fireEvent.click(within(drawer).getByTestId("admin-agent-row-agent-1-save"));
    await waitFor(() => expect(capabilityCalls.some((c) => c.method === "POST")).toBe(true));
    const mutate = capabilityCalls.find((c) => c.method === "POST")!.body as { op: string; payload: { id: string; name: string } };
    expect(mutate.op).toBe("update");
    expect(mutate.payload.id).toBe("agent-1");
    expect(mutate.payload.name).toBe("改过名的 Agent");
    // 改完以服务端第二次 GET 为准（capabilityCalls 里 POST 之后还有一次 GET）。
    await waitFor(() => expect(capabilityCalls.filter((c) => c.method === "GET").length).toBeGreaterThanOrEqual(2));
    expect(await screen.findByTestId("admin-agent-mutate-notice")).toHaveTextContent("prov-1");
  });

  it("③′ 卡片上的「停用」把停用确认开在面板里；已停用的行没有这个按钮", async () => {
    render(<AgentScreen state="default" />);
    const list = await screen.findByTestId("admin-agent-list");
    expect(within(list).queryByTestId("admin-agent-row-agent-2-disable")).toBeNull();

    fireEvent.click(within(list).getByTestId("admin-agent-row-agent-1-disable"));
    const drawer = screen.getByTestId("admin-agent-detail");
    expect(within(drawer).getByTestId("admin-agent-disable-mode")).toBeInTheDocument();
    expect(within(drawer).getByTestId("admin-agent-disable-confirm")).toBeInTheDocument();
    // 点卡片上的按钮不会顺带把面板开成另一张卡片（stopPropagation）。
    expect(drawer).toHaveTextContent("客服 Agent");
  });

  it("④ 卡片上的「编辑」仍是指向独立编辑页的链接，带 ?from=", async () => {
    render(<AgentScreen state="default" />);
    const list = await screen.findByTestId("admin-agent-list");
    const link = within(list).getByTestId("admin-agent-row-agent-1-edit");
    expect(link.getAttribute("href")).toBe("/platform-admin/agent/agent-1?from=%2Fadmin%2Fagent");
  });

  it("可执行定义的面板：字段来自 listAgents，角色头衔真的打 PATCH", async () => {
    const patches: unknown[] = [];
    const base = globalThis.fetch as unknown as (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === "PATCH") {
          patches.push(JSON.parse(String(init.body)));
          return jsonResponse({ agentId: "agent-def-1" });
        }
        return base(input, init);
      }),
    );
    render(<AgentScreen state="default" />);
    await screen.findByTestId("admin-agent-list");
    const card = await screen.findByTestId("admin-agent-definition-agent-def-1");
    fireEvent.click(card);
    const drawer = screen.getByTestId("admin-agent-detail");
    expect(drawer).toHaveTextContent("值班一句话");
    expect(drawer).toHaveTextContent("2 个");
    // 与「不宣称可运行」同一条纪律：面板里没有调用量 / 试跑这类没有出处的字段。
    expect(drawer.textContent).not.toMatch(/调用量|试跑/);

    fireEvent.change(within(drawer).getByTestId("admin-agent-definition-agent-def-1-role-label"), { target: { value: "夜班头衔" } });
    fireEvent.click(within(drawer).getByTestId("admin-agent-definition-agent-def-1-save"));
    await waitFor(() => expect(patches).toHaveLength(1));
    expect(patches[0]).toMatchObject({ agentId: "agent-def-1", patch: { roleLabel: "夜班头衔" } });
  });

  it("非管理员：卡片与面板都没有写入口，但目录照常可看、可搜", async () => {
    sessionState.orgRole = "consultant";
    render(<AgentScreen state="default" />);
    const list = await screen.findByTestId("admin-agent-list");
    expect(within(list).queryByTestId("admin-agent-row-agent-1-edit")).toBeNull();
    expect(screen.queryByTestId("admin-agent-create")).toBeNull();
    expect(screen.queryByTestId("agent-create-open")).toBeNull();
    fireEvent.click(within(list).getByTestId("admin-agent-row-agent-1"));
    const drawer = screen.getByTestId("admin-agent-detail");
    expect(within(drawer).queryByTestId("admin-agent-row-agent-1-save")).toBeNull();
    expect(drawer).toHaveTextContent("只有组织管理员可以修改");
  });
});
