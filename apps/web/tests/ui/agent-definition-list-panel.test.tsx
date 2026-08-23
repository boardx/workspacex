/**
 * #1915 —— `AgentDefinitionListPanel`：`listAgents`（`GET /agents`）在前端的第一条真实
 * 读路径。规避的空转形状：
 * ① ⛔ 只断言"打了请求"——断言请求真的打到契约声明的路径。
 * ② ⛔ 只测成功态——空态、错误态、`refreshKey` 变化触发重新拉取都要断言。
 */
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { agentRuntime } from "@repo/contracts";
import { SESSION_TOKEN_STORAGE_KEY } from "@/lib/api-client";
import { AgentDefinitionListPanel } from "@/components/admin/agent-definition-list-panel";

const PREFIX = "i1915-list";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("#1915 AgentDefinitionListPanel：listAgents 读路径", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.localStorage.setItem(SESSION_TOKEN_STORAGE_KEY, "tok-1915");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("挂载时打到契约声明的 GET /agents 路径，渲染出返回的行", async () => {
    const calls: { method: string; path: string }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(typeof input === "string" ? input : input.toString());
        calls.push({ method: init?.method ?? "GET", path: url.pathname });
        return jsonResponse([
          {
            agentId: "agent-1",
            initials: "ZB",
            name: "值班助理",
            role: "值班一句话",
            roleLabel: "值班头衔",
            visibility: "全组织可用",
            publishState: "草稿",
            modelId: null,
            skillCount: 0,
            monthlyCallCount: null,
          },
        ]);
      }),
    );

    render(<AgentDefinitionListPanel prefix={PREFIX} refreshKey={0} />);

    await waitFor(() => expect(screen.getByTestId(`${PREFIX}-list-rows`)).toBeTruthy());
    expect(screen.getByTestId(`${PREFIX}-list-row-agent-1`).textContent).toContain("值班助理");

    const call = calls.find((c) => c.path === agentRuntime.operations.listAgents.path);
    expect(call, `没有打到 listAgents 路径；实际打过：${calls.map((c) => `${c.method} ${c.path}`).join(", ")}`)
      .toBeTruthy();
    expect(call?.method).toBe("GET");
  });

  it("空列表 ⇒ 显示空态文案，不是一片空白", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse([])));
    render(<AgentDefinitionListPanel prefix={PREFIX} refreshKey={0} />);
    await waitFor(() => expect(screen.getByTestId(`${PREFIX}-list-empty`)).toBeTruthy());
  });

  it("403 / ROLE_INSUFFICIENT ⇒ 原样显示 reasonCode，不是一句「加载失败」", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ reasonCode: "ROLE_INSUFFICIENT" }, 403)));
    render(<AgentDefinitionListPanel prefix={PREFIX} refreshKey={0} />);
    await waitFor(() => expect(screen.getByTestId(`${PREFIX}-list-error`)).toBeTruthy());
    expect(screen.getByTestId(`${PREFIX}-list-error`).textContent).toContain("ROLE_INSUFFICIENT");
  });

  it("refreshKey 变化 ⇒ 重新打一次请求（新建 agent 后能刷新出来的机械证据）", async () => {
    const fetchMock = vi.fn(async () => jsonResponse([]));
    vi.stubGlobal("fetch", fetchMock);
    const { rerender } = render(<AgentDefinitionListPanel prefix={PREFIX} refreshKey={0} />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    rerender(<AgentDefinitionListPanel prefix={PREFIX} refreshKey={1} />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  });
});
