/**
 * F162 —— 「限额策略」的规则区只投影 `GET /organizations/:orgId/limit-rules`。
 *
 * 反证重点：
 *  · **百分比来自服务端的 `usedRatio`**，不是前端拿一个分子去除自己猜的分母——
 *    两条规则的窗口可以不同（5 小时 / 月），前端算会得到两个同时显示且互相矛盾的数；
 *  · **`agent` 范围的规则不画 0%**，而是明说「该范围暂无计量维度」（`GAP-LIMIT-AGENT-SCOPE`）：
 *    一条永远不会触发的规则不该看起来在正常工作；
 *  · **选「自动降级」时目标模型输入框才出现**，且服务端拒绝时把原因说清楚——
 *    「降级」而不说降到哪等于运行时静默换模型；
 *  · 读取失败回显 reasonCode，不回落到示例规则。
 */
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const sessionState = vi.hoisted(() => ({ currentOrgId: "org-f162" }));

vi.mock("@/components/session/session-provider", () => ({
  useOptionalSession: () => ({
    session: { currentOrgId: sessionState.currentOrgId },
    identity: { org: { id: sessionState.currentOrgId, name: "真实组织" }, orgRole: "admin" },
  }),
}));

import { LimitRulesLive } from "@/components/admin/limit-rules-live";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function rule(overrides: Record<string, unknown> = {}) {
  return {
    ruleId: "rule-1", scopeKind: "member", scopeRef: "u-wutong", modelId: "opus-4.6",
    windowKind: "hour", thresholdTokens: 800_000, action: "degrade",
    degradeToModelId: "sonnet-4.6", enabled: true,
    observedTokens: 768_000, usedRatio: 0.96, ...overrides,
  };
}

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("F162 限额规则 —— 只投影真实响应", () => {
  it("规则卡片的百分比来自服务端的 usedRatio，不是前端自己除", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ rules: [rule()] }));

    render(<LimitRulesLive />);

    await waitFor(() => expect(screen.getByTestId("admin-limit-rules-live")).toBeTruthy());
    expect(screen.getByTestId("admin-limit-rule-used-rule-1").textContent).toContain("96%");
    // 触顶动作与降级目标一起显示——只说「降级」不说降到哪，界面上就看不出会换成什么。
    expect(screen.getByText(/自动降级 → sonnet-4\.6/)).toBeTruthy();
  });

  it("【反证】agent 范围的规则不画 0%，明说「暂无计量维度」", async () => {
    fetchMock.mockResolvedValue(jsonResponse({
      rules: [rule({ ruleId: "rule-agent", scopeKind: "agent", scopeRef: "agent-scout", observedTokens: 0, usedRatio: 0 })],
    }));

    render(<LimitRulesLive />);

    await waitFor(() => expect(screen.getByTestId("admin-limit-rule-nometric-rule-agent")).toBeTruthy());
    expect(screen.queryByTestId("admin-limit-rule-used-rule-agent")).toBeNull();
  });

  it("零规则 ⇒ 空态，不是示例规则", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ rules: [] }));

    render(<LimitRulesLive />);

    await waitFor(() => expect(screen.getByTestId("admin-limit-rules-empty")).toBeTruthy());
    expect(screen.queryByText("吴桐")).toBeNull();
  });

  it("读取失败回显 reasonCode，不回落到示例规则", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ reasonCode: "FORBIDDEN" }, 403));

    render(<LimitRulesLive />);

    await waitFor(() => expect(screen.getByTestId("admin-limit-rules-failed")).toBeTruthy());
    expect(screen.queryByTestId("admin-limit-rules-live")).toBeNull();
  });

  it("选「自动降级」时才出现目标模型输入框（不让用户撞一次 400 才知道它必填）", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ rules: [] }));

    render(<LimitRulesLive />);
    await waitFor(() => expect(screen.getByTestId("admin-limit-rule-new")).toBeTruthy());
    fireEvent.click(screen.getByTestId("admin-limit-rule-new"));

    expect(screen.queryByTestId("admin-limit-degrade-to")).toBeNull();
    fireEvent.change(screen.getByTestId("admin-limit-action"), { target: { value: "degrade" } });
    expect(screen.getByTestId("admin-limit-degrade-to")).toBeTruthy();
  });

  it("服务端拒绝「降级但没目标」时，界面说清原因而不是只回一个错误码", async () => {
    fetchMock.mockImplementation((_url: string, init?: RequestInit) =>
      Promise.resolve(
        init?.method === "POST"
          ? jsonResponse({ reasonCode: "DEGRADE_TARGET_REQUIRED" }, 400)
          : jsonResponse({ rules: [] }),
      ),
    );

    render(<LimitRulesLive />);
    await waitFor(() => expect(screen.getByTestId("admin-limit-rule-new")).toBeTruthy());
    fireEvent.click(screen.getByTestId("admin-limit-rule-new"));
    fireEvent.change(screen.getByTestId("admin-limit-scope-ref"), { target: { value: "u-x" } });
    fireEvent.change(screen.getByTestId("admin-limit-threshold"), { target: { value: "1000" } });
    fireEvent.change(screen.getByTestId("admin-limit-action"), { target: { value: "degrade" } });
    fireEvent.click(screen.getByTestId("admin-limit-rule-create-save"));

    await waitFor(() => expect(screen.getByTestId("admin-limit-rule-error")).toBeTruthy());
    expect(screen.getByTestId("admin-limit-rule-error").textContent).toContain("静默换模型");
  });

  it("新建成功后重新拉取（列表不是本地拼出来的）", async () => {
    let reads = 0;
    fetchMock.mockImplementation((_url: string, init?: RequestInit) => {
      if (init?.method === "POST") return Promise.resolve(jsonResponse({ ruleId: "rule-new" }));
      reads += 1;
      return Promise.resolve(jsonResponse({
        rules: reads === 1 ? [] : [rule({ ruleId: "rule-new", action: "warn", degradeToModelId: null })],
      }));
    });

    render(<LimitRulesLive />);
    await waitFor(() => expect(screen.getByTestId("admin-limit-rules-empty")).toBeTruthy());
    fireEvent.click(screen.getByTestId("admin-limit-rule-new"));
    fireEvent.change(screen.getByTestId("admin-limit-scope-ref"), { target: { value: "u-x" } });
    fireEvent.change(screen.getByTestId("admin-limit-threshold"), { target: { value: "1000" } });
    fireEvent.click(screen.getByTestId("admin-limit-rule-create-save"));

    await waitFor(() => expect(screen.getByTestId("admin-limit-rule-rule-new")).toBeTruthy());
    expect(reads).toBeGreaterThanOrEqual(2);
  });

  describe("2026-08-15 · 卡片/列表视图切换", () => {
    it("默认卡片视图：规则网格可见，切到列表视图后同一条规则仍在，字段不丢", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ rules: [rule()] }));

      render(<LimitRulesLive />);
      await waitFor(() => expect(screen.getByTestId("admin-limit-rules-live")).toBeTruthy());
      expect(screen.getByTestId("admin-limit-rules-cards")).toBeTruthy();
      expect(screen.queryByTestId("admin-limit-rules-list")).toBeNull();
      expect(screen.getByTestId("admin-limit-rule-used-rule-1").textContent).toContain("96%");

      fireEvent.click(screen.getByTestId("admin-limits-view-toggle-list"));

      expect(screen.getByTestId("admin-limit-rules-list")).toBeTruthy();
      expect(screen.queryByTestId("admin-limit-rules-cards")).toBeNull();
      // 切到列表视图后同一条规则（同一个 ruleId）仍然可见，字段没有丢。
      expect(screen.getByTestId("admin-limit-rule-used-rule-1").textContent).toContain("96%");
      expect(screen.getByText(/自动降级 → sonnet-4\.6/)).toBeTruthy();
    });
  });
});
