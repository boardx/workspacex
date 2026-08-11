/**
 * F161 —— 「用量监控」tab 只投影 `GET /organizations/:orgId/usage?window=…`。
 *
 * 核心反证只有一条：**换窗口必须发新请求**。旧实现的文件头自己写着「窗口切换只影响
 * 本地展示态（无后端）」——那种实现能通过任何「界面上有四个按钮」的断言，
 * 也能通过任何单窗口的数值断言，唯独通不过「点了另一个窗口，请求的 query 变了」。
 *
 * 另外三条：列由响应决定（不是写死五列）、零调用是空态（不是示例数字）、
 * 读取失败回显 reasonCode（不静默退回 mock）。
 */
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const sessionState = vi.hoisted(() => ({ currentOrgId: "org-f161" }));

vi.mock("@/components/session/session-provider", () => ({
  useOptionalSession: () => ({
    session: { currentOrgId: sessionState.currentOrgId },
    identity: { org: { id: sessionState.currentOrgId, name: "真实组织" }, orgRole: "admin" },
  }),
}));

import { UsageMonitorTab } from "@/components/admin/usage-monitor-tab";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function report(overrides: Record<string, unknown> = {}) {
  return {
    window: "week",
    totalTokens: 12_840_000,
    callCount: 431,
    failedCallCount: 7,
    activeMemberCount: 12,
    models: ["opus-4.6", "sonnet-4.6"],
    rows: [
      { userId: "u-linke", displayName: "林可", perModel: [2_000_000, 100_000], total: 2_100_000 },
    ],
    distribution: [
      { modelId: "opus-4.6", tokens: 12_000_000, share: 0.93 },
      { modelId: "sonnet-4.6", tokens: 840_000, share: 0.07 },
    ],
    ...overrides,
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

describe("F161 用量监控 —— 每个窗口一次真实请求", () => {
  it("【核心反证】换窗口发出新请求，且 query 里的 window 跟着变", async () => {
    fetchMock.mockImplementation((url: string) =>
      Promise.resolve(jsonResponse(report({
        window: new URL(url, "http://x").searchParams.get("window"),
        totalTokens: url.includes("window=5h") ? 1_000_000 : 12_840_000,
      }))),
    );

    render(<UsageMonitorTab />);

    await waitFor(() => expect(screen.getByTestId("admin-usage-matrix")).toBeTruthy());
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("window=week");

    fireEvent.click(screen.getByTestId("admin-usage-window-5h"));

    await waitFor(() =>
      expect(fetchMock.mock.calls.some((c) => String(c[0]).includes("window=5h"))).toBe(true));
    // 数字也真的跟着变了——只发请求不用响应同样是空转。
    await waitFor(() => expect(screen.getByTestId("admin-usage-stat-total").textContent).toContain("1.0M"));
  });

  it("矩阵的列来自响应，不是写死的五个模型名", async () => {
    fetchMock.mockResolvedValue(jsonResponse(report({
      models: ["deepseek-v4"],
      rows: [{ userId: "u-x", displayName: "某人", perModel: [500_000], total: 500_000 }],
      distribution: [{ modelId: "deepseek-v4", tokens: 500_000, share: 1 }],
    })));

    render(<UsageMonitorTab />);

    await waitFor(() => expect(screen.getByTestId("admin-usage-matrix")).toBeTruthy());
    const headers = screen.getByTestId("admin-usage-matrix").querySelectorAll("thead th");
    expect([...headers].map((h) => h.textContent)).toEqual(["成员", "deepseek-v4", "合计"]);
    expect(screen.queryByText("gpt-5.2")).toBeNull();
  });

  it("零调用 ⇒ 空态文案，不是示例数字", async () => {
    fetchMock.mockResolvedValue(jsonResponse(report({
      totalTokens: 0, callCount: 0, failedCallCount: 0, activeMemberCount: 0,
      models: [], rows: [], distribution: [],
    })));

    render(<UsageMonitorTab />);

    await waitFor(() => expect(screen.getByTestId("admin-usage-empty")).toBeTruthy());
    expect(screen.queryByTestId("admin-usage-matrix")).toBeNull();
  });

  it("读取失败回显 reasonCode，不静默退回 mock 数字", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ reasonCode: "FORBIDDEN" }, 403));

    render(<UsageMonitorTab />);

    await waitFor(() => expect(screen.getByTestId("admin-usage-load-failed")).toBeTruthy());
    expect(screen.queryByTestId("admin-usage-matrix")).toBeNull();
  });

  it("「近期限额事件」仍带着「尚未接入真实后端」提示（数据源要到 F162 才存在）", async () => {
    fetchMock.mockResolvedValue(jsonResponse(report()));

    render(<UsageMonitorTab />);

    await waitFor(() => expect(screen.getByTestId("admin-usage-recent-events")).toBeTruthy());
    expect(screen.getByTestId("admin-no-backend-notice")).toBeTruthy();
  });
});
