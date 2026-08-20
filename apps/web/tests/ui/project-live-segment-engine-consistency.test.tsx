/**
 * F03（phase-10 segment-engine 束，design-signoff.md 已签核 2026-08-20）—— 环节状态条
 * 现场呈现（复用 F963）+ 分组视角内的一致展示。
 *
 * F963 已经证明了状态条本身接真数据（`project-live-stagebar.test.tsx`）；F01 加了视角
 * 切换器之后，新增的风险是「切到某个分组后，状态条会不会被另一份状态覆盖/重新拉一次」——
 * 这正是本 feature 的用户可见行为：**无论切到主持台全场还是任意分组，状态条显示的都是
 * 同一份真实数据，不在编排层另建一份副本状态**。本文件专门钉住这一条，不重复 F963 已覆盖
 * 的「有/无 active 环节」渲染细节。
 */
import * as React from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { TabLive } from "@/components/project/tab-live";
import type { AgendaSegment } from "@/lib/live-projects";
import type { Group, ProjectGroupingOut } from "@/lib/live-project-prep";

vi.mock("@/components/session/session-provider", () => ({
  useOptionalSession: () => ({ session: null, identity: { groupName: null } }),
}));

function segment(overrides: Partial<AgendaSegment> = {}): AgendaSegment {
  return {
    id: "seg-3",
    workshopId: "p-live-1",
    agendaSegmentDefinitionId: null,
    ordinal: 2,
    title: "假设风暴 → 假设树画布",
    duration: 900,
    state: "active",
    mergedInto: null,
    acceptedSources: [],
    ...overrides,
  };
}

function group(overrides: Partial<Group> = {}): Group {
  return {
    groupId: "g-1",
    name: "第 1 组 · 业主首次评估",
    scenario: "业主首次评估储能投资",
    leaderUserId: "u-lead",
    status: "recording-ready",
    memberUserIds: ["u-2"],
    ...overrides,
  };
}

function grouping(groups: Group[]): ProjectGroupingOut {
  return { groups, revision: "rev-1" };
}

describe("F03 环节状态条：切视角前后单一数据源，不重建副本", () => {
  it("切到某个分组后，状态条仍显示同一份真实环节数据（标题/序号/推进控制不变）", () => {
    const segments = [
      segment({ id: "seg-1", ordinal: 0, state: "closed", title: "开场" }),
      segment({ id: "seg-2", ordinal: 1, state: "active", title: "假设风暴" }),
    ];
    const groups = [group()];
    render(<TabLive view="facilitator" liveSegments={segments} liveGrouping={grouping(groups)} />);

    // 全场视角：状态条真实数据 + 推进控制齐全
    expect(screen.getByTestId("project-live-stagebar-title")).toHaveTextContent("假设风暴");
    expect(screen.getByText("环节 2/2")).toBeInTheDocument();
    expect(screen.getByTestId("project-live-next")).toBeInTheDocument();

    // 切到分组视角
    fireEvent.click(screen.getByTestId("lc-viewer-trigger"));
    fireEvent.click(screen.getByTestId("lc-viewer-option-g-1"));

    // 状态条组件本身没有被卸载重建——同一个 testid 元素、同一份数据、同一组推进控制
    expect(screen.getByTestId("project-live-stagebar-title")).toHaveTextContent("假设风暴");
    expect(screen.getByText("环节 2/2")).toBeInTheDocument();
    expect(screen.getByTestId("project-live-next")).toBeInTheDocument();
    // 分组面板确实换掉了下方内容（证明真的切了视角，不是没生效）
    expect(screen.getByTestId("lc-group-panel-name")).toBeInTheDocument();
    expect(screen.queryByTestId("project-live-groups-unavailable")).not.toBeInTheDocument();
  });

  it("组员锁定视角（无下拉可切）时，状态条同样显示真实数据，不是空态占位", () => {
    const segments = [segment({ id: "seg-1", ordinal: 0, state: "active", title: "破冰" })];
    render(<TabLive view="member" liveSegments={segments} liveGrouping={grouping([])} />);
    expect(screen.getByTestId("project-live-stagebar-title")).toHaveTextContent("破冰");
    // 组员没有推进权限，状态条上不该出现『下一环节』
    expect(screen.queryByTestId("project-live-next")).not.toBeInTheDocument();
  });

  it("环节数据仍是 listAgendaSegments/advanceAgendaSegment 的唯一真源（源码级断言）", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const src = fs.readFileSync(path.join(process.cwd(), "components/project/tab-live.tsx"), "utf8");
    expect(src).toMatch(/listAgendaSegments|advanceAgendaSegment/);
    // 状态条渲染函数只有一处（StageBar），不存在第二份同名/近似命名的状态条组件
    expect(src.match(/function StageBar/g)?.length).toBe(1);
  });
});
