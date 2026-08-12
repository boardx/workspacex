/**
 * F160 —— 「成员配额」tab 只投影 `GET /organizations/:orgId/token-quotas` 的真实响应。
 *
 * 反证重点（每条都对应一次真实的骗人模式）：
 *  · **null ≠ 0**：组织额度未设置时「未分配」必须显示「—」并写明「不限额」，
 *    显示成 0 会让新组织看起来像已经用尽（`seat_quota` 默认 0 的生产事故同款）；
 *  · 未分配额度的成员**不画进度条**——0% 的条会让「没分配」和「分了没用」长得一样；
 *  · 读取失败**不得回落到 mock 数字**：一屏数字看着正常但全是假的，比一条报错危险得多；
 *  · 超分配被拒时，界面必须把**还剩多少可分**说出来（O-29⑤：阻断要伴随可执行的下一步），
 *    只显示「超出额度」等于让管理员靠试；
 *  · 屏上不再渲染「尚未接入真实后端」——但另外两个 tab 仍是 mock，那条提示应当还在它们身上。
 */
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";

const sessionState = vi.hoisted(() => ({ currentOrgId: "org-f160", orgRole: "admin" }));

const sessionValue = () => ({
  session: { currentOrgId: sessionState.currentOrgId },
  identity: {
    org: { id: sessionState.currentOrgId, name: "真实组织" },
    orgRole: sessionState.orgRole,
  },
});

vi.mock("@/components/session/session-provider", () => ({
  useOptionalSession: () => sessionValue(),
  useSession: () => ({
    session: { currentOrgId: sessionState.currentOrgId },
    identity: {
      org: { id: sessionState.currentOrgId, name: "真实组织" },
      orgRole: sessionState.orgRole,
    },
  }),
}));

import { MemberQuotaTab } from "@/components/admin/member-quota-tab";

interface QuotaMember {
  userId: string; displayName: string; email: string; orgRole: string;
  teamId: string | null; monthlyLimit: number | null; usedTokens: number;
}

function member(overrides: Partial<QuotaMember> = {}): QuotaMember {
  return {
    userId: "u-linke", displayName: "林可", email: "linke@x.test", orgRole: "consultant",
    teamId: null, monthlyLimit: 4_000_000, usedTokens: 2_100_000, ...overrides,
  };
}

function payload(overrides: Record<string, unknown> = {}) {
  return {
    orgBudget: 62_000_000, allocated: 54_000_000, unallocated: 8_000_000,
    orgUsed: 12_840_000, overspendCount: 4, members: [member()], ...overrides,
  };
}

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

describe("F160 成员配额 tab —— 只投影真实响应", () => {
  it("三张卡与成员行的数字全部来自响应，不是 mock 的 usedM/limitM", async () => {
    fetchMock.mockResolvedValue(jsonResponse(payload()));

    render(<MemberQuotaTab />);

    await waitFor(() => expect(screen.getByTestId("admin-quota-live")).toBeTruthy());
    expect(within(screen.getByTestId("admin-quota-card-allocated")).getByText("54.0M")).toBeTruthy();
    expect(within(screen.getByTestId("admin-quota-card-unallocated")).getByText("8.0M")).toBeTruthy();
    expect(within(screen.getByTestId("admin-quota-card-overspend")).getByText("4 人")).toBeTruthy();
    expect(screen.getByTestId("admin-member-quota-usage-u-linke").textContent).toBe("2.1M/4.0M");

    // 请求真的发出去了，且打的是契约里那条路径。
    const url = String(fetchMock.mock.calls[0]?.[0]);
    expect(url).toContain("/organizations/org-f160/token-quotas");
  });

  it("【反证】组织额度未设置：显示「—」与「不限额」，不是 0", async () => {
    fetchMock.mockResolvedValue(jsonResponse(payload({
      orgBudget: null, allocated: 0, unallocated: null, overspendCount: 0,
      members: [member({ monthlyLimit: null, usedTokens: 0 })],
    })));

    render(<MemberQuotaTab />);

    await waitFor(() => expect(screen.getByTestId("admin-quota-live")).toBeTruthy());
    expect(within(screen.getByTestId("admin-quota-card-unallocated")).getByText("—")).toBeTruthy();
    expect(screen.getByTestId("admin-quota-org-budget").textContent).toContain("未设置");
    // 「未设置 ⇒ 不限额」这句必须写在屏上：否则管理员会以为额度是 0。
    expect(screen.getByText(/不限额/)).toBeTruthy();
  });

  it("【反证】未分配额度的成员不画进度条，用量显示为 x/—", async () => {
    fetchMock.mockResolvedValue(jsonResponse(payload({
      members: [member({ monthlyLimit: null, usedTokens: 300_000 })],
    })));

    render(<MemberQuotaTab />);

    await waitFor(() => expect(screen.getByTestId("admin-quota-live")).toBeTruthy());
    expect(screen.getByTestId("admin-member-quota-usage-u-linke").textContent).toBe("30 万/—");
    expect(screen.getByText("未分配额度")).toBeTruthy();
    expect(screen.queryByRole("progressbar")).toBeNull();
  });

  it("【反证】读取失败回显 reasonCode，不回落到示例数字", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ reasonCode: "FORBIDDEN" }, 403));

    render(<MemberQuotaTab />);

    await waitFor(() => expect(screen.getByTestId("admin-quota-load-failed")).toBeTruthy());
    expect(screen.getByText(/FORBIDDEN/)).toBeTruthy();
    expect(screen.queryByTestId("admin-quota-live")).toBeNull();
  });

  it("超分配被拒时，界面说出「还能分配多少」而不只是「超了」", async () => {
    fetchMock.mockImplementation((_url: string, init?: RequestInit) =>
      Promise.resolve(
        init?.method === "PATCH"
          ? jsonResponse({ reasonCode: "QUOTA_OVERALLOCATED", remainingTokens: 4_000_000 }, 409)
          : jsonResponse(payload()),
      ),
    );

    render(<MemberQuotaTab />);
    await waitFor(() => expect(screen.getByTestId("admin-quota-live")).toBeTruthy());

    fireEvent.click(screen.getByTestId("admin-member-quota-u-linke"));
    fireEvent.change(screen.getByTestId("admin-member-quota-input"), { target: { value: "9000000" } });
    fireEvent.click(screen.getByTestId("admin-member-quota-save"));

    await waitFor(() => expect(screen.getByTestId("admin-member-quota-error")).toBeTruthy());
    expect(screen.getByTestId("admin-member-quota-error").textContent).toContain("4.0M");
  });

  it("保存成功后重新拉取（数字不是本地猜的，是服务端说了算）", async () => {
    let read = 0;
    fetchMock.mockImplementation((_url: string, init?: RequestInit) => {
      if (init?.method === "PATCH") {
        return Promise.resolve(jsonResponse({
          userId: "u-linke", monthlyLimit: 5_000_000, allocated: 55_000_000, unallocated: 7_000_000,
        }));
      }
      read += 1;
      return Promise.resolve(jsonResponse(payload(
        read === 1 ? {} : { members: [member({ monthlyLimit: 5_000_000 })] },
      )));
    });

    render(<MemberQuotaTab />);
    await waitFor(() => expect(screen.getByTestId("admin-quota-live")).toBeTruthy());

    fireEvent.click(screen.getByTestId("admin-member-quota-u-linke"));
    fireEvent.change(screen.getByTestId("admin-member-quota-input"), { target: { value: "5000000" } });
    fireEvent.click(screen.getByTestId("admin-member-quota-save"));

    await waitFor(() =>
      expect(screen.getByTestId("admin-member-quota-usage-u-linke").textContent).toBe("2.1M/5.0M"));
    expect(read).toBeGreaterThanOrEqual(2);
  });
});
