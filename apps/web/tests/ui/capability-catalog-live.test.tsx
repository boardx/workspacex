/**
 * #406 Wave 1 — Agent / Skill 正式目录只投影当前组织持久化 capability。
 *
 * 反证重点：空数组不能触发 mock / starter fallback；读取失败不能伪装成空目录；
 * 页面只能 GET 已签的 listCapabilities，不能出现 mutate / import / AgentRun 动作。
 */
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { agentRuntime } from "@repo/contracts";
import { SESSION_TOKEN_STORAGE_KEY } from "@/lib/api-client";

const sessionState = vi.hoisted(() => ({ currentOrgId: "org-live-406", orgRole: "consultant" }));

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
import { SkillScreen } from "@/components/admin/skill-screen";

type CapabilityKind = "agent" | "skill";

function capability(kind: CapabilityKind, index: number, overrides: Record<string, unknown> = {}) {
  return {
    id: `${kind}-${index}`,
    orgId: sessionState.currentOrgId,
    kind,
    name: `${kind === "agent" ? "Agent" : "Skill"} 真实条目 ${index}`,
    scope: index % 2 === 0 ? "team-only" : "org-wide",
    enabled: index !== 2,
    endpoint: null,
    disabledReason: index === 2 ? "由组织管理员停用" : null,
    ...overrides,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("#406 Agent / Skill 真实组织能力目录", () => {
  beforeEach(() => {
    sessionState.currentOrgId = "org-live-406";
    sessionState.orgRole = "consultant";
    window.localStorage.clear();
    window.localStorage.setItem(SESSION_TOKEN_STORAGE_KEY, "tok-live-406");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("Agent 使用 currentOrg + kind=agent 查询；11 条全部在一个网格里，靠搜索与标签收窄而不是分页", async () => {
    const rows = Array.from({ length: 11 }, (_, i) => capability("agent", i + 1));
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(typeof input === "string" ? input : input.toString());
      // 2026-09-02 起 Agent 目录同时读 F55 定义（`GET /agents`）——按路径分流，这里给空。
      if (url.pathname === agentRuntime.operations.listAgents.path) return jsonResponse([]);
      expect(url.pathname).toBe("/capabilities");
      expect(url.searchParams.get("orgId")).toBe("org-live-406");
      expect(url.searchParams.get("kind")).toBe("agent");
      expect(init?.method).toBe("GET");
      expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer tok-live-406");
      return jsonResponse(rows);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<AgentScreen state="default" />);

    const list = await screen.findByTestId("admin-agent-list");
    expect(within(list).getByText("Agent 真实条目 1")).toBeInTheDocument();
    expect(within(list).getByText("Agent 真实条目 11")).toBeInTheDocument();
    expect(screen.queryByTestId("admin-agent-page-status")).not.toBeInTheDocument();

    // 搜索是纯前端过滤：不再发第二次请求。
    fireEvent.change(screen.getByTestId("admin-agent-search"), { target: { value: "条目 11" } });
    expect(within(screen.getByTestId("admin-agent-list")).queryByText("Agent 真实条目 1")).not.toBeInTheDocument();
    expect(within(screen.getByTestId("admin-agent-list")).getByText("Agent 真实条目 11")).toBeInTheDocument();
    fireEvent.change(screen.getByTestId("admin-agent-search"), { target: { value: "" } });

    // 标签同样是本地过滤：「已停用」只剩第 2 条。
    fireEvent.click(screen.getByTestId("admin-agent-tag-filter-disabled"));
    expect(within(screen.getByTestId("admin-agent-list")).getByText("Agent 真实条目 2")).toBeInTheDocument();
    expect(within(screen.getByTestId("admin-agent-list")).queryByText("Agent 真实条目 1")).not.toBeInTheDocument();

    const capabilityCalls = fetchMock.mock.calls.filter(([input]) =>
      new URL(typeof input === "string" ? input : input.toString()).pathname === "/capabilities",
    );
    expect(capabilityCalls).toHaveLength(1);
  });

  it("Skill 使用 kind=skill 独立读取并只展示契约事实，不宣称可运行", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(typeof input === "string" ? input : input.toString());
      expect(url.searchParams.get("kind")).toBe("skill");
      expect(init?.method).toBe("GET");
      return jsonResponse([capability("skill", 2)]);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<SkillScreen state="default" />);

    const row = await screen.findByTestId("admin-skill-row-skill-2");
    expect(row).toHaveTextContent("Skill 真实条目 2");
    expect(row).toHaveTextContent("仅团队可见");
    expect(row).toHaveTextContent("已停用");
    expect(row).toHaveTextContent("由组织管理员停用");
    expect(screen.getByText(/这里只展示可选择的目录记录/)).toBeInTheDocument();
    expect(screen.queryByText(/试跑|运行中|调用量|版本/)).not.toBeInTheDocument();
  });

  it("读取失败显示错误而非空态，重试后才展示持久化结果", async () => {
    let attempts = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(typeof input === "string" ? input : input.toString());
      if (url.pathname === agentRuntime.operations.listAgents.path) return jsonResponse([]);
      attempts += 1;
      return attempts === 1
        ? jsonResponse({ reasonCode: "CAPABILITY_SERVICE_UNAVAILABLE" }, 503)
        : jsonResponse([capability("agent", 7)]);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<AgentScreen state="default" />);

    expect(await screen.findByTestId("admin-agent-error")).toHaveTextContent("CAPABILITY_SERVICE_UNAVAILABLE");
    expect(screen.queryByTestId("admin-agent-empty")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("admin-agent-retry"));
    expect(await screen.findByText("Agent 真实条目 7")).toBeInTheDocument();
    expect(attempts).toBe(2);
  });

  it("currentOrg 改变后立即隐藏旧组织 rows，新请求未完成时 fail-closed", async () => {
    let resolveNewOrg: ((response: Response) => void) | undefined;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(typeof input === "string" ? input : input.toString());
      if (url.pathname === agentRuntime.operations.listAgents.path) return jsonResponse([]);
      const orgId = url.searchParams.get("orgId");
      if (orgId === "org-live-406") {
        return jsonResponse([capability("agent", 1, { name: "旧组织 Agent" })]);
      }
      if (orgId === "org-new-406") {
        return new Promise<Response>((resolve) => {
          resolveNewOrg = resolve;
        });
      }
      throw new Error(`unexpected org: ${orgId}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const view = render(<AgentScreen state="default" />);
    expect(await screen.findByText("旧组织 Agent")).toBeInTheDocument();

    sessionState.currentOrgId = "org-new-406";
    view.rerender(<AgentScreen state="default" />);

    // 新 org header 绝不能与旧 org rows 同屏；新请求仍 pending 时只能显示 loading。
    expect(screen.queryByText("旧组织 Agent")).not.toBeInTheDocument();
    expect(screen.getByTestId("admin-agent-loading")).toBeInTheDocument();

    await waitFor(() => expect(resolveNewOrg).toBeDefined());
    resolveNewOrg!(jsonResponse([capability("agent", 2, {
      orgId: "org-new-406",
      name: "新组织 Agent",
    })]));
    expect(await screen.findByText("新组织 Agent")).toBeInTheDocument();
  });

  it("真实空数组保持诚实空态：非管理员不 seed、不 fallback、不暴露导入/创建/mutate/AgentRun", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(typeof input === "string" ? input : input.toString());
      expect(url.pathname).toBe("/capabilities");
      expect(url.searchParams.get("kind")).toBe("skill");
      expect(init?.method).toBe("GET");
      return jsonResponse([]);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<SkillScreen state="default" />);

    expect(await screen.findByTestId("admin-skill-empty")).toHaveTextContent("当前组织还没有 Skill 目录项");
    expect(screen.queryByTestId("admin-skill-list")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /导入|新建|创建|运行|试跑/ })).not.toBeInTheDocument();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  });
});
