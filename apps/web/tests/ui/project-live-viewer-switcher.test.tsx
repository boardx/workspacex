/**
 * F01（phase-10 viewer-role 束，design-signoff.md 已签核 2026-08-20）—— 现场协作 Tab
 * 的视角切换器：主持台·全场 / 分组 二档切换，角色锁定，数据全部真实（`getProjectGrouping`
 * 的 `Group[]` + 会话身份 `identity.groupName`），不编造。
 *
 * 覆盖 `computeViewerOptions`（纯函数，四角色分支）+ `TabLive` 的真实渲染/交互，
 * 同 `project-live-stagebar.test.tsx` 直接测 `TabLive` 不经过整条 `ProjectWorkbench`
 * 拉取链路的做法。
 */
import * as React from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { computeViewerOptions, TabLive } from "@/components/project/tab-live";
import type { Group, ProjectGroupingOut } from "@/lib/live-project-prep";

const sessionState = vi.hoisted(() => ({ groupName: null as string | null }));

vi.mock("@/components/session/session-provider", () => ({
  useOptionalSession: () => ({ session: null, identity: { groupName: sessionState.groupName } }),
}));

function group(overrides: Partial<Group> = {}): Group {
  return {
    groupId: "g-1",
    name: "第 1 组 · 业主首次评估",
    scenario: "业主首次评估储能投资",
    leaderUserId: "u-lead",
    status: "recording-ready",
    memberUserIds: ["u-2", "u-3"],
    ...overrides,
  };
}

function grouping(groups: Group[]): ProjectGroupingOut {
  return { groups, revision: "rev-1" };
}

describe("computeViewerOptions（纯函数）", () => {
  it("facilitator：全场 + 全部真实分组，可切换", () => {
    const groups = [group({ groupId: "g-1", name: "第1组" }), group({ groupId: "g-2", name: "第2组" })];
    const r = computeViewerOptions("facilitator", groups, null);
    expect(r.locked).toBe(false);
    expect(r.defaultId).toBe("stage");
    expect(r.options.map((o) => o.id)).toEqual(["stage", "g-1", "g-2"]);
  });

  it("groupLead：本组名对得上 ⇒ 锁定该组；对不上 ⇒ 空选项（不猜默认组）", () => {
    const groups = [group({ groupId: "g-1", name: "第1组" }), group({ groupId: "g-2", name: "第2组" })];
    const hit = computeViewerOptions("groupLead", groups, "第2组");
    expect(hit.locked).toBe(true);
    expect(hit.options.map((o) => o.id)).toEqual(["g-2"]);

    const miss = computeViewerOptions("groupLead", groups, "第9组不存在");
    expect(miss.locked).toBe(true);
    expect(miss.options).toEqual([]);
    expect(miss.defaultId).toBeNull();
  });

  it("member：与 groupLead 同规则", () => {
    const groups = [group({ groupId: "g-1", name: "第1组" })];
    const r = computeViewerOptions("member", groups, "第1组");
    expect(r.options.map((o) => o.id)).toEqual(["g-1"]);
  });

  it("observer：只有『主持台·全场』一个选项，不渲染任何分组（Q1 裁决）", () => {
    const groups = [group({ groupId: "g-1" }), group({ groupId: "g-2" })];
    const r = computeViewerOptions("observer", groups, "第1组"); // 即便 groupName 对得上也不放行
    expect(r.locked).toBe(true);
    expect(r.options.map((o) => o.id)).toEqual(["stage"]);
  });
});

describe("TabLive 视角切换器（真实渲染）", () => {
  it("facilitator：点开下拉能看到全场 + 真实分组名，选中后展示该组真实字段", () => {
    sessionState.groupName = null;
    const groups = [
      group({ groupId: "g-1", name: "第 1 组 · 业主首次评估", status: "needs-intervention" }),
      group({ groupId: "g-2", name: "第 2 组 · 采购比选" }),
    ];
    render(<TabLive view="facilitator" liveGrouping={grouping(groups)} />);

    expect(screen.getByTestId("lc-viewer-switcher")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("lc-viewer-trigger"));
    const menu = screen.getByTestId("lc-viewer-menu");
    expect(menu).toHaveTextContent("第 1 组 · 业主首次评估");
    expect(menu).toHaveTextContent("需介入"); // 真实 Group.status，不是编造的现场告警
    expect(menu).toHaveTextContent("第 2 组 · 采购比选");

    fireEvent.click(screen.getByTestId("lc-viewer-option-g-1"));
    expect(screen.getByTestId("lc-group-panel-name")).toHaveTextContent("第 1 组 · 业主首次评估");
    expect(screen.getByTestId("lc-group-panel-scenario")).toHaveTextContent("业主首次评估储能投资");
    // 切到某个分组后，「四组并行」整块空态说明不应该再重复出现（那是全场态才有的）
    expect(screen.queryByTestId("project-live-groups-unavailable")).not.toBeInTheDocument();
  });

  it("groupLead：视角切换器锁定本组，不出现下拉菜单", () => {
    sessionState.groupName = "第 2 组 · 采购比选";
    const groups = [group({ groupId: "g-1", name: "第 1 组" }), group({ groupId: "g-2", name: "第 2 组 · 采购比选" })];
    render(<TabLive view="groupLead" liveGrouping={grouping(groups)} />);

    const trigger = screen.getByTestId("lc-viewer-trigger");
    expect(trigger).toHaveTextContent("第 2 组 · 采购比选");
    expect(trigger).toBeDisabled();
    fireEvent.click(trigger);
    expect(screen.queryByTestId("lc-viewer-menu")).not.toBeInTheDocument();
    expect(screen.getByTestId("lc-group-panel-name")).toHaveTextContent("第 2 组 · 采购比选");
  });

  it("groupLead：真实分组列表里找不到同名组 ⇒ 如实显示『看不出你在哪一组』，不猜一个默认组", () => {
    sessionState.groupName = "一个不存在的组";
    const groups = [group({ groupId: "g-1", name: "第 1 组" })];
    render(<TabLive view="groupLead" liveGrouping={grouping(groups)} />);

    expect(screen.getByTestId("lc-viewer-unresolved")).toHaveTextContent("看不出你在哪一组");
    expect(screen.queryByTestId("lc-viewer-trigger")).not.toBeInTheDocument();
    expect(screen.queryByTestId("lc-group-panel-name")).not.toBeInTheDocument();
  });

  it("observer：锁定『主持台·全场』，即便有真实分组数据也不出现分组选项", () => {
    sessionState.groupName = null;
    const groups = [group({ groupId: "g-1", name: "第 1 组" })];
    render(<TabLive view="observer" liveGrouping={grouping(groups)} />);

    const trigger = screen.getByTestId("lc-viewer-trigger");
    expect(trigger).toHaveTextContent("主持台·全场");
    expect(trigger).toBeDisabled();
    expect(screen.getByTestId("project-live-groups-unavailable")).toBeInTheDocument();
  });

  it("分组读取失败 ⇒ 如实显示错误，不静默回退成空场", () => {
    render(<TabLive view="facilitator" liveGrouping={null} liveGroupingError="HTTP 500" />);
    expect(screen.getByTestId("lc-viewer-error")).toHaveTextContent("HTTP 500");
  });
});
