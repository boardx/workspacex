/**
 * 后台顶部 `AdminHeader` —— 反证：这条常驻在每个后台屏顶部的组织标识 + 额度条，
 * 曾经全部来自写死的 mock（`lib/mock/admin.ORG_HEADER`：组织名"远洋咨询"、
 * `org_8f21`、78%、4,820万/6,200万、还剩6天），且没有任何演示标记——
 * 挂在总览等"真数据"屏正上方，是最容易误导人类的一处（见组织总览审查）。
 *
 * 每条用例对应一次真实的骗人模式：
 *  · 组织名/组织 ID 必须来自真实会话身份，不是写死的"远洋咨询"/"org_8f21"；
 *  · 额度百分比/已用/总量必须来自 `GET /organizations/:orgId/token-quotas`
 *    的真实响应，不是写死的 78%/4,820万/6,200万；
 *  · 组织额度未设置（`orgBudget: null`）要显示"未设置"，不能显示成 0%；
 *  · 读取失败要显示错误，不能回落到任何写死的数字掩盖失败。
 */
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

const sessionState = vi.hoisted(() => ({ currentOrgId: "org-real-42", orgName: "真实组织" }));

vi.mock("@/components/session/session-provider", () => ({
  useOptionalSession: () => ({
    session: { currentOrgId: sessionState.currentOrgId },
    identity: { org: { id: sessionState.currentOrgId, name: sessionState.orgName } },
  }),
}));

import { AdminHeader } from "@/components/admin/admin-header";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status, headers: { "content-type": "application/json" },
  });
}

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("AdminHeader —— 组织标识与额度条只投影真实数据", () => {
  it("组织名/组织 ID 来自会话身份，不是写死的「远洋咨询」/「org_8f21」", async () => {
    fetchMock.mockResolvedValue(jsonResponse({
      orgBudget: 62_000_000, allocated: 0, unallocated: 62_000_000,
      orgUsed: 12_000_000, overspendCount: 0, members: [],
    }));

    render(<AdminHeader moduleLabel="总览" />);

    expect(screen.getByTestId("admin-header-org-name").textContent).toBe("真实组织");
    expect(screen.getByText("组织 ID org-real-42")).toBeTruthy();
    expect(screen.queryByText("远洋咨询")).toBeNull();
    expect(screen.queryByText(/org_8f21/)).toBeNull();

    const url = String(fetchMock.mock.calls[0]?.[0]);
    expect(url).toContain("/organizations/org-real-42/token-quotas");
  });

  it("额度条数字来自 getTokenQuotas 响应，不是写死的 78% / 4,820万 / 6,200万", async () => {
    fetchMock.mockResolvedValue(jsonResponse({
      orgBudget: 62_000_000, allocated: 0, unallocated: 62_000_000,
      orgUsed: 12_000_000, overspendCount: 0, members: [],
    }));

    render(<AdminHeader moduleLabel="总览" />);

    await waitFor(() => expect(screen.getByText(/本月组织额度 19%/)).toBeTruthy());
    expect(screen.getByText(/1,200 万 \/ 6,200 万 tokens/)).toBeTruthy();
    expect(screen.queryByText(/78%/)).toBeNull();
    expect(screen.queryByText(/4,820/)).toBeNull();
  });

  it("【反证】组织额度未设置时显示「未设置」，不是 0%", async () => {
    fetchMock.mockResolvedValue(jsonResponse({
      orgBudget: null, allocated: 0, unallocated: null,
      orgUsed: 0, overspendCount: 0, members: [],
    }));

    render(<AdminHeader moduleLabel="总览" />);

    await waitFor(() => expect(screen.getByTestId("admin-header-quota-unset")).toBeTruthy());
    expect(screen.queryByText(/0%/)).toBeNull();
  });

  it("【反证】额度读取失败时显示错误，不回落到任何写死数字", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ reasonCode: "FORBIDDEN" }, 403));

    render(<AdminHeader moduleLabel="总览" />);

    await waitFor(() => expect(screen.getByTestId("admin-header-quota-error")).toBeTruthy());
    expect(screen.getByText(/FORBIDDEN/)).toBeTruthy();
    expect(screen.queryByText(/%/)).toBeNull();
  });
});
