/**
 * #1182 —— 总览屏三个真格子的行为断言。
 *
 * ## 「活跃成员」那条是反证找出来的缺口，不是想出来的
 *
 * 第一版只在 `overview-mixed-state.test.tsx` 里断言了那行说明文字。造反证时把
 * `foot="本月有过调用的人数，不是成员总数"` 改成 `foot="组织成员总数"`——**5 条全绿**。
 * 也就是说：改文案没红，那把**取值**从 `usage.activeMemberCount` 换成
 * `members.length` 更不会红。而后者永远更大、永远更好看，且没有任何东西会发现它错了。
 *
 * ⇒ 下面这条断言让两个数**故意不相等**（活跃 2 / 成员 5），再断言屏上显示的是 2。
 *   取错了源当场红。文案断言留在原处，但它只是文案。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";

const getUsageReport = vi.fn();
const listOrgMembers = vi.fn();
const queryProvenance = vi.fn();

vi.mock("@/components/session/session-provider", () => ({
  useOptionalSession: () => ({ session: { currentOrgId: "org-1" } }),
}));
vi.mock("@/lib/live-org-admin", () => ({
  getUsageReport: (...a: unknown[]) => getUsageReport(...a),
  listOrgMembers: (...a: unknown[]) => listOrgMembers(...a),
}));
vi.mock("@/lib/live-provenance", () => ({
  queryProvenance: (...a: unknown[]) => queryProvenance(...a),
}));

import { OverviewLive } from "@/components/admin/overview-live";

afterEach(() => { cleanup(); vi.clearAllMocks(); });

const MEMBERS = ["u1", "u2", "u3", "u4", "u5"].map((userId, i) => ({
  userId, displayName: `成员${i + 1}`, email: `${userId}@x.com`,
  orgRole: i === 0 ? "admin" : "consultant", teamId: null,
  joinedAt: "2026-01-01T00:00:00.000Z", status: "active",
}));

function arrange(opts: {
  activeMemberCount?: number; totalTokens?: number;
  events?: unknown[]; fails?: boolean;
} = {}) {
  if (opts.fails) getUsageReport.mockRejectedValue(new Error("boom"));
  else getUsageReport.mockResolvedValue({
    window: "month",
    totalTokens: opts.totalTokens ?? 48_200_000,
    callCount: 1200, failedCallCount: 7,
    activeMemberCount: opts.activeMemberCount ?? 2,
    models: [], rows: [], distribution: [],
  });
  listOrgMembers.mockResolvedValue({ members: MEMBERS });
  queryProvenance.mockResolvedValue({ events: opts.events ?? [], nextCursor: null });
}

const event = (id: string, actorId: string, type: string) => ({
  id, type, actorId, at: "2026-08-14T10:00:00.000Z",
  orgId: "org-1", target: { kind: "organization", id: "org-1" }, detail: {},
});

describe("#1182 总览屏真数据", () => {
  it("活跃成员显示的是 activeMemberCount，不是成员总数（两个数故意不相等）", async () => {
    arrange({ activeMemberCount: 2 });          // 成员表里有 5 个人
    render(<OverviewLive />);
    await waitFor(() => expect(screen.getByTestId("admin-overview-metric-members").textContent).toMatch(/\d/));

    const text = screen.getByTestId("admin-overview-metric-members").textContent ?? "";
    expect(text).toContain("2 人");
    expect(text, "显示了成员总数 —— 取错了源").not.toContain("5 人");
    expect(getUsageReport).toHaveBeenCalledWith("org-1", "month");
  });

  it("token 消耗来自 usage.totalTokens 并带千分位", async () => {
    arrange({ totalTokens: 48_200_000 });
    render(<OverviewLive />);
    await waitFor(() => expect(screen.getByTestId("admin-overview-metric-tokens").textContent).toContain("48,200,000"));
  });

  it("活动流按 actorId 映射显示名；映射不到就显示 id，**不隐藏该行**", async () => {
    arrange({ events: [event("e1", "u2", "project-created"), event("e2", "ghost", "unauthorized-attempt")] });
    render(<OverviewLive />);
    await waitFor(() => expect(screen.getByTestId("admin-activity-e2")).toBeTruthy());

    expect(screen.getByTestId("admin-activity-e1").textContent).toContain("成员2");
    // 已离开组织的人 / 系统身份映射不到——隐藏会让审计流少掉记录，那比显示一个丑 id 严重得多。
    const ghost = screen.getByTestId("admin-activity-e2").textContent ?? "";
    expect(ghost).toContain("ghost");
    expect(ghost).toContain("越权尝试被拦截");
  });

  it("读失败 ⇒ 指标显示「—」而不是 0，且不退回演示数据", async () => {
    // 阳性对照：同一路径成功时确实画得出数字（否则下面只是在为「什么都不渲染」背书）。
    arrange({ totalTokens: 123 });
    const ok = render(<OverviewLive />);
    await waitFor(() => expect(screen.getByTestId("admin-overview-metric-tokens").textContent).toContain("123"));
    ok.unmount();

    arrange({ fails: true });
    render(<OverviewLive />);
    await waitFor(() => expect(screen.getByTestId("admin-overview-load-failed")).toBeTruthy());
    const tokens = screen.getByTestId("admin-overview-metric-tokens").textContent ?? "";
    expect(tokens).toContain("—");
    expect(tokens, "读失败却显示 0 —— 一次故障看起来像一个平静的月份").not.toMatch(/\b0\b/);
    expect(screen.queryByTestId(/^admin-activity-/)).toBeNull();
  });
});
