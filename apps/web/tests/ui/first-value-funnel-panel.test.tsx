/**
 * issue #4248 —— 组织总览「第一个价值时刻」漏斗：步骤渲染 + 价值时刻标记、空态、超预算，
 * 以及 API 客户端经契约 schema 解析响应。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { firstValueEvents as FV } from "@repo/contracts";

const apiRequest = vi.fn();
vi.mock("@/lib/api-client", async (orig) => ({
  ...(await orig<typeof import("@/lib/api-client")>()),
  apiRequest: (...a: unknown[]) => apiRequest(...a),
}));

import { FirstValueFunnelPanel } from "@/components/admin/first-value-funnel-panel";
import { getOrgFirstValueFunnel } from "@/lib/live-first-value";

afterEach(() => { cleanup(); vi.clearAllMocks(); });

const T0 = Date.parse("2026-09-20T08:00:00.000Z");
const at = (min: number) => new Date(T0 + min * 60_000).toISOString();

function funnel(reachedMinutes: Partial<Record<FV.FirstValueStepValue, number>>) {
  return FV.orgFirstValueFunnel(
    Object.entries(reachedMinutes).map(([step, m]) => ({ step: step as FV.FirstValueStepValue, occurredAt: at(m!) })),
  );
}

describe("FirstValueFunnelPanel", () => {
  it("渲染全部步骤并标出价值时刻；预算内", async () => {
    apiRequest.mockResolvedValue(funnel({
      first_sign_in: 0, workspace_opened: 2, own_material_uploaded: 5,
      question_on_own_material: 7, cited_answer_own_material: 12,
    }));
    render(<FirstValueFunnelPanel />);
    await screen.findByTestId("admin-first-value-minutes");
    for (const step of FV.FirstValueStep.options) {
      expect(screen.getByTestId(`admin-first-value-step-${step}`)).toBeTruthy();
    }
    const value = screen.getByTestId(`admin-first-value-step-${FV.FIRST_VALUE_STEP}`);
    expect(value.getAttribute("data-value-moment")).toBe("true");
    expect(value.textContent).toContain("价值时刻");
    expect(document.querySelectorAll("[data-value-moment]").length).toBe(1);
    expect(screen.getByTestId("admin-first-value-minutes").textContent).toContain("12");
    expect(screen.getByTestId("admin-first-value-verdict").textContent).toBe("预算内");
    expect(screen.getByTestId("admin-first-value-budget").textContent).toContain("预算 15 分钟");
    expect(screen.getByTestId("admin-first-value-step-citation_opened").textContent).toContain("未到达");
  });

  it("没有任何记录时显示空态", async () => {
    apiRequest.mockResolvedValue(funnel({}));
    render(<FirstValueFunnelPanel />);
    await screen.findByTestId("admin-first-value-empty");
    expect(screen.queryByTestId("admin-first-value-budget")).toBeNull();
  });

  it("超过 15 分钟预算标为超出预算", async () => {
    apiRequest.mockResolvedValue(funnel({ first_sign_in: 0, cited_answer_own_material: 40 }));
    render(<FirstValueFunnelPanel />);
    await waitFor(() =>
      expect(screen.getByTestId("admin-first-value-verdict").textContent).toBe("超出预算"));
    expect(screen.getByTestId("admin-first-value-minutes").textContent).toContain("40");
  });
});

describe("getOrgFirstValueFunnel", () => {
  it("请求契约路径并经契约 schema 解析", async () => {
    const good = funnel({ first_sign_in: 0 });
    apiRequest.mockResolvedValue(good);
    await expect(getOrgFirstValueFunnel()).resolves.toEqual(good);
    expect(apiRequest).toHaveBeenCalledWith("/org/first-value-funnel", { method: "GET" });
  });

  it("响应不合契约时拒绝", async () => {
    apiRequest.mockResolvedValue({ steps: [], minutesToFirstValue: null, budgetMinutes: 30 });
    await expect(getOrgFirstValueFunnel()).rejects.toThrow();
  });
});
