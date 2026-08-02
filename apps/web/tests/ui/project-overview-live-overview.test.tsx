/**
 * F362 —— 项目工作台「概览」tab 的真实概览白名单四件块
 * （当前议程环节 / 四类角色人数 / 回流列表 / 蓝本名与版本）。
 *
 * 同 `project-overview-live-info.test.tsx` 的纪律：直接测 `TabOverview`，不经过
 * `ProjectWorkbench` 的拉取链路。钉住三种状态：有真实数据 / 没有（未登录） / 读取失败，
 * 且不新造白名单以外的第五个板块。
 */
import * as React from "react";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { TabOverview } from "@/components/project/tab-overview";
import type { ProjectOverview } from "@/lib/live-projects";

const FULL_OVERVIEW: ProjectOverview = {
  projectId: "p1",
  name: "真实工作坊",
  kind: "workshop",
  status: "active",
  currentAgendaSegment: {
    id: "seg-1",
    workshopId: "p1",
    agendaSegmentDefinitionId: null,
    ordinal: 0,
    title: "破冰环节",
    duration: 10,
    state: "active",
    mergedInto: null,
    acceptedSources: [],
  },
  roleCounts: { facilitator: 1, groupLead: 2, member: 6, observer: 1 },
  backflow: [
    {
      bindingId: "b1",
      artifactId: "a1",
      title: "回流产出",
      mode: "pinned",
      version: 1,
      pinnedBy: "u1",
      pinnedAt: "2026-08-01T00:00:00.000Z",
      badge: "pinned",
    },
  ],
  blueprint: { name: "标准工作坊蓝本", version: 2 },
};

describe("F362 project-overview：真实概览白名单四件块只显示真实数据", () => {
  it("liveOverview 为 null 时显示诚实的空态", () => {
    render(<TabOverview view="facilitator" projectId="p1" liveOverview={null} />);
    expect(screen.getByTestId("project-overview-live-overview-empty")).toBeInTheDocument();
    expect(screen.queryByTestId("project-overview-live-overview-body")).not.toBeInTheDocument();
  });

  it("liveOverview 有值时渲染白名单四件（不多不少）", () => {
    render(<TabOverview view="facilitator" projectId="p1" liveOverview={FULL_OVERVIEW} />);
    expect(screen.getByTestId("project-overview-live-agenda-segment")).toHaveTextContent("破冰环节");
    expect(screen.getByTestId("project-overview-live-role-counts")).toHaveTextContent("组长 2");
    expect(screen.getByTestId("project-overview-live-backflow-count")).toHaveTextContent("1 条");
    expect(screen.getByTestId("project-overview-live-blueprint")).toHaveTextContent("标准工作坊蓝本 · v2");
  });

  it("空态字段（非工作坊 / 空白新建 / 无回流）各自显示诚实空值，不编数据", () => {
    render(
      <TabOverview
        view="facilitator"
        projectId="p1"
        liveOverview={{ ...FULL_OVERVIEW, currentAgendaSegment: null, roleCounts: null, backflow: [], blueprint: null }}
      />,
    );
    expect(screen.getByTestId("project-overview-live-agenda-segment-empty")).toBeInTheDocument();
    expect(screen.queryByTestId("project-overview-live-role-counts")).not.toBeInTheDocument();
    expect(screen.getByTestId("project-overview-live-backflow-empty")).toBeInTheDocument();
    expect(screen.getByTestId("project-overview-live-blueprint-empty")).toBeInTheDocument();
  });

  it("liveOverviewError 有值时显示失败提示，而不是空态或伪数据", () => {
    render(
      <TabOverview view="facilitator" projectId="p1" liveOverview={null} liveOverviewError="DEPENDENCY_UNAVAILABLE" />,
    );
    expect(screen.getByTestId("project-overview-live-overview-error")).toHaveTextContent("DEPENDENCY_UNAVAILABLE");
    expect(screen.queryByTestId("project-overview-live-overview-empty")).not.toBeInTheDocument();
  });
});
