/**
 * PR #2425 独立审查阻断项①：`AdminHeader` 的额度状态此前不按 `orgId` 归属清空——
 * 切组织时，界面会在新组织的身份（组织名/ID 已经切换）下短暂或持续显示上一个组织的
 * 额度数字，直到新请求成功才刷新；新请求失败时甚至永远不刷新。
 *
 * 本文件补上正向断言：`orgId` 一变，额度区必须**同步**（不等新请求 resolve）清空，
 * 不允许旧组织的数字在新组织身份下露出哪怕一帧。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";

const getTokenQuotas = vi.fn();
type FakeSession = {
  session: { currentOrgId: string } | null;
  identity: { org: { id: string; name: string } } | null;
};
const useOptionalSession = vi.fn<() => FakeSession>(() => ({
  session: { currentOrgId: "org-1" },
  identity: { org: { id: "org-1", name: "组织一" } },
}));

vi.mock("@/components/session/session-provider", () => ({
  useOptionalSession: () => useOptionalSession(),
}));
vi.mock("@/lib/live-org-admin", () => ({
  getTokenQuotas: (...a: unknown[]) => getTokenQuotas(...a),
}));

import { AdminHeader } from "@/components/admin/admin-header";

afterEach(() => { cleanup(); vi.clearAllMocks(); });
beforeEach(() => {
  useOptionalSession.mockReturnValue({
    session: { currentOrgId: "org-1" },
    identity: { org: { id: "org-1", name: "组织一" } },
  });
});

describe("AdminHeader：额度状态按 orgId 归属，不跨组织残留", () => {
  it("正常路径：读到 orgBudget 就画出真实百分比", async () => {
    getTokenQuotas.mockResolvedValue({ orgBudget: 1_000_000, orgUsed: 780_000 });
    render(<AdminHeader moduleLabel="总览" />);
    await waitFor(() => expect(screen.getByTestId("admin-header").textContent).toContain("78%"));
    expect(screen.getByTestId("admin-header-org-name").textContent).toBe("组织一");
  });

  it("切组织 ⇒ 旧组织的额度立即清空，不在新组织身份下露出一帧", async () => {
    getTokenQuotas.mockResolvedValue({ orgBudget: 1_000_000, orgUsed: 780_000 });
    const { rerender } = render(<AdminHeader moduleLabel="总览" />);
    await waitFor(() => expect(screen.getByTestId("admin-header").textContent).toContain("78%"));

    // 新组织的请求故意悬着不 resolve —— 断言必须在这一刻成立，而不是等它最终一致。
    getTokenQuotas.mockReturnValue(new Promise(() => {}));
    useOptionalSession.mockReturnValue({
      session: { currentOrgId: "org-2" },
      identity: { org: { id: "org-2", name: "组织二" } },
    });
    rerender(<AdminHeader moduleLabel="总览" />);

    expect(screen.getByTestId("admin-header-org-name").textContent).toBe("组织二");
    expect(screen.getByTestId("admin-header").textContent).not.toContain("78%");
    expect(screen.getByTestId("admin-header").textContent).not.toContain("780,000");
    expect(getTokenQuotas).toHaveBeenLastCalledWith("org-2");
  });

  it("组织变成 null（例如登出）⇒ 显示「尚未选择组织」，不是上一个组织的旧额度", async () => {
    getTokenQuotas.mockResolvedValue({ orgBudget: 1_000_000, orgUsed: 780_000 });
    const { rerender } = render(<AdminHeader moduleLabel="总览" />);
    await waitFor(() => expect(screen.getByTestId("admin-header").textContent).toContain("78%"));

    useOptionalSession.mockReturnValue({ session: null, identity: null });
    rerender(<AdminHeader moduleLabel="总览" />);

    expect(screen.getByTestId("admin-header-quota-no-org")).toBeTruthy();
    expect(screen.getByTestId("admin-header").textContent).not.toContain("78%");
  });

  it("读失败也要按 orgId 归属：换成一个会失败的新组织，旧组织的成功数字不能留着", async () => {
    getTokenQuotas.mockResolvedValue({ orgBudget: 1_000_000, orgUsed: 780_000 });
    const { rerender } = render(<AdminHeader moduleLabel="总览" />);
    await waitFor(() => expect(screen.getByTestId("admin-header").textContent).toContain("78%"));

    getTokenQuotas.mockRejectedValue(new Error("boom"));
    useOptionalSession.mockReturnValue({
      session: { currentOrgId: "org-3" },
      identity: { org: { id: "org-3", name: "组织三" } },
    });
    rerender(<AdminHeader moduleLabel="总览" />);
    await waitFor(() => expect(screen.getByTestId("admin-header-quota-error")).toBeTruthy());

    expect(screen.getByTestId("admin-header").textContent).not.toContain("78%");
    expect(screen.getByTestId("admin-header").textContent).not.toContain("780,000");
  });
});
