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
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";

const getUsageReport = vi.fn();
const listOrgMembers = vi.fn();
const queryProvenance = vi.fn();
const listLimitEvents = vi.fn();

const useOptionalSession = vi.fn<() => { session: { currentOrgId: string } | null }>(
  () => ({ session: { currentOrgId: "org-1" } }),
);
vi.mock("@/components/session/session-provider", () => ({
  useOptionalSession: () => useOptionalSession(),
}));
vi.mock("@/lib/live-org-admin", () => ({
  getUsageReport: (...a: unknown[]) => getUsageReport(...a),
  listOrgMembers: (...a: unknown[]) => listOrgMembers(...a),
  // ⚠ 独立审查发现（PR #2425）：这里此前**没有**这一行——`overview-live.tsx` 真实调用
  // `listLimitEvents`，但这份 mock 没导出它，组件里拿到的是 `undefined`，调用即抛
  // `TypeError`，被组件自己的 `catch` 吞成 `limitError`。本文件的既有断言只看
  // token/活跃成员/活动流三块，从没检查过限额事件那块渲染了什么——于是「限额事件
  // 的真实读路径其实从没被跑通过」这件事，在全部测试绿灯的情况下完全看不出来。
  // 下面新增的 `describe("限额事件")` 就是补这个洞。
  listLimitEvents: (...a: unknown[]) => listLimitEvents(...a),
}));
vi.mock("@/lib/live-provenance", () => ({
  queryProvenance: (...a: unknown[]) => queryProvenance(...a),
}));

import { OverviewLive } from "@/components/admin/overview-live";

afterEach(() => { cleanup(); vi.clearAllMocks(); });
// `useOptionalSession.mockReturnValue(...)`（组织切换那条测试用它模拟换组织）不会被
// `clearAllMocks` 撤销——`clearAllMocks` 只清调用记录，不清已设置的返回值。所以每条
// 测试开始前显式重置回默认的 org-1，避免测试之间因为执行顺序互相污染。
beforeEach(() => { useOptionalSession.mockReturnValue({ session: { currentOrgId: "org-1" } }); });

const MEMBERS = ["u1", "u2", "u3", "u4", "u5"].map((userId, i) => ({
  userId, displayName: `成员${i + 1}`, email: `${userId}@x.com`,
  orgRole: i === 0 ? "admin" : "consultant", teamId: null,
  joinedAt: "2026-01-01T00:00:00.000Z", status: "active",
}));

function arrange(opts: {
  activeMemberCount?: number; totalTokens?: number;
  events?: unknown[]; fails?: boolean;
  limitEvents?: unknown[]; limitEventsFail?: boolean;
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
  // 独立的第二条真实请求（同 `usage-monitor-tab.tsx` 的既有纪律：限额事件不随
  // 别的窗口/失败而联动，是自己的一条读）——默认给空数组，不让旧断言意外撞上它。
  if (opts.limitEventsFail) listLimitEvents.mockRejectedValue(new Error("limit-boom"));
  else listLimitEvents.mockResolvedValue({ events: opts.limitEvents ?? [] });
}

const limitEvent = (over: Partial<{
  eventId: string; ruleId: string; subjectRef: string; actionTaken: string;
  observedTokens: number; thresholdTokens: number; occurredAt: string;
  scopeKind: string;
}> = {}) => ({
  eventId: "ev-1", ruleId: "rule-abcdef01", scopeKind: "member",
  subjectRef: "顾问·吴桐", actionTaken: "block",
  observedTokens: 4_100_000, thresholdTokens: 4_000_000,
  occurredAt: "2026-08-30T02:00:00.000Z",
  ...over,
});

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

describe("限额事件（F162 真数据；PR #2425 独立审查补的正向断言）", () => {
  it("渲染真实事件：动作徽标、subjectRef、观测/上限数值都来自接口返回值", async () => {
    arrange({ limitEvents: [limitEvent({ eventId: "ev-a", actionTaken: "block", subjectRef: "顾问·吴桐", observedTokens: 4_100_000, thresholdTokens: 4_000_000 })] });
    render(<OverviewLive />);
    await waitFor(() => expect(screen.getByTestId("admin-overview-anomaly-ev-a")).toBeTruthy());

    const row = screen.getByTestId("admin-overview-anomaly-ev-a").textContent ?? "";
    expect(row).toContain("顾问·吴桐");
    expect(row).toContain("4,100,000");
    expect(row).toContain("4,000,000");
    expect(row).toContain("已拒绝"); // actionTaken: "block" 的中文标签
    expect(listLimitEvents).toHaveBeenCalledWith("org-1");

    // 计数卡也要来自同一条真实数据，不是另编的数字。
    expect(screen.getByTestId("admin-overview-metric-anomaly").textContent).toContain("1 项");
  });

  it("空数组 ⇒ 如实显示「近期没有任何限额规则被触发」，不是「读取中」也不是假事件", async () => {
    arrange({ limitEvents: [] });
    render(<OverviewLive />);
    await waitFor(() => expect(screen.getByTestId("admin-overview-anomalies-empty")).toBeTruthy());
    expect(screen.queryByTestId(/^admin-overview-anomaly-/)).toBeNull();
  });

  it("读失败 ⇒ 显示失败原因，不回退演示数据，且不影响 token/活跃成员那两块的成功渲染", async () => {
    arrange({ totalTokens: 999, limitEventsFail: true });
    render(<OverviewLive />);
    await waitFor(() => expect(screen.getByTestId("admin-overview-anomalies-load-failed")).toBeTruthy());
    expect(screen.getByTestId("admin-overview-anomalies-load-failed").textContent).toContain("limit-boom");
    // 计数卡跟着读失败显示「—」，同 `MetricCard` 对 token 失败的既有规矩一致。
    expect(screen.getByTestId("admin-overview-metric-anomaly").textContent).toContain("—");
    // 一条读失败不能连累另一条已经成功的读——这正是两个独立 effect 的意义。
    await waitFor(() => expect(screen.getByTestId("admin-overview-metric-tokens").textContent).toContain("999"));
  });

  it("超过 5 条 ⇒ 只画前 5 条 + 一条「查看全部 N 项」的真实链接", async () => {
    const many = Array.from({ length: 8 }, (_, i) => limitEvent({ eventId: `ev-${i}` }));
    arrange({ limitEvents: many });
    render(<OverviewLive />);
    await waitFor(() => expect(screen.getByTestId("admin-overview-anomalies-more")).toBeTruthy());

    for (let i = 0; i < 5; i++) expect(screen.getByTestId(`admin-overview-anomaly-ev-${i}`)).toBeTruthy();
    for (let i = 5; i < 8; i++) expect(screen.queryByTestId(`admin-overview-anomaly-ev-${i}`)).toBeNull();
    expect(screen.getByTestId("admin-overview-anomalies-more").textContent).toContain("8");
  });

  it("规则已被删除（ruleId 为空串）⇒ 如实说「规则已删除」，不是空白或编一个 id", async () => {
    arrange({ limitEvents: [limitEvent({ eventId: "ev-deleted", ruleId: "" })] });
    render(<OverviewLive />);
    await waitFor(() => expect(screen.getByTestId("admin-overview-anomaly-ev-deleted")).toBeTruthy());
    expect(screen.getByTestId("admin-overview-anomaly-ev-deleted").textContent).toContain("规则已删除");
  });

  it("切组织 ⇒ 旧组织的限额事件立即清空，不会在新组织身份下露出一帧（独立审查阻断项①）", async () => {
    arrange({ limitEvents: [limitEvent({ eventId: "ev-old-org" })] });
    const { rerender } = render(<OverviewLive />);
    await waitFor(() => expect(screen.getByTestId("admin-overview-anomaly-ev-old-org")).toBeTruthy());
    // 换组织前记下这个区块的 DOM 节点引用——只有真正的 `key` 触发卸载重挂载，
    // 才会换成一个新节点；如果修法只是"在 effect 里清空 state"，React 会原地更新
    // 同一个节点。这条断言核对的是结构事实，不依赖任何"多快清空"的时序假设，
    // 不会被 `act()` 把渲染与 effect 一起 flush 掉这件事掩盖过去。
    const nodeBeforeSwitch = screen.getByTestId("admin-overview-anomalies");

    // 换组织：新组织的请求故意不 resolve——这个断言必须在新请求还悬着时就成立，
    // 否则测的是「最终一致」，不是「同步清空」，会让「旧组织内容多渲染一帧」这种
    // 缺陷继续测不出来。
    listLimitEvents.mockReturnValue(new Promise(() => {}));
    useOptionalSession.mockReturnValue({ session: { currentOrgId: "org-2" } });
    rerender(<OverviewLive />);

    expect(screen.queryByTestId("admin-overview-anomaly-ev-old-org")).toBeNull();
    expect(screen.queryByTestId("admin-overview-anomalies-empty")).toBeNull();
    expect(screen.queryByTestId("admin-overview-anomalies-load-failed")).toBeNull();
    expect(listLimitEvents).toHaveBeenCalledWith("org-2");
    // 结构性证据：换组织后拿到的是一个不同的 DOM 节点——`key={orgId}` 真的触发了
    // 卸载重挂载，不是同一个节点被原地改写、只是内容碰巧还没填进去。
    expect(screen.getByTestId("admin-overview-anomalies")).not.toBe(nodeBeforeSwitch);
  });

  it("组织变成 null（例如登出）⇒ 同样立即清空，不留上一个组织的痕迹", async () => {
    arrange({ limitEvents: [limitEvent({ eventId: "ev-before-logout" })] });
    const { rerender } = render(<OverviewLive />);
    await waitFor(() => expect(screen.getByTestId("admin-overview-anomaly-ev-before-logout")).toBeTruthy());

    useOptionalSession.mockReturnValue({ session: null });
    rerender(<OverviewLive />);

    expect(screen.queryByTestId("admin-overview-anomaly-ev-before-logout")).toBeNull();
    expect(screen.queryByTestId("admin-overview-anomalies-empty")).toBeNull();
  });
});
