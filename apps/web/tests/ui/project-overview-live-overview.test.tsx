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

/**
 * F964 —— 两个真实数据块的错误插槽（`project-overview-live-error` /
 * `project-overview-live-overview-error`）不再把 reasonCode 原样甩给用户。
 *
 * 分层的正常访问范围（`NO_PROJECT_ROLE` 项目层 / `ADMIN_NOT_SUPERUSER` 组织层）用人话说明
 * + 不给重试按钮（刷新不会改变角色）；真故障（`DEPENDENCY_UNAVAILABLE` /
 * `AUTH_SERVICE_UNAVAILABLE`）用醒目语气 + 给重试按钮。原始 reasonCode 仍保留在文案里，
 * 不丢失可追责信息（同时也是上面两条老用例继续断言 `toHaveTextContent(原始码)` 仍能过的原因）。
 */
describe("F964 project-overview：错误插槽人性化，区分组织层/项目层无权限与真故障", () => {
  it("NO_PROJECT_ROLE（项目层，正常状态不是异常）：人话说明 + 不给重试按钮", () => {
    render(<TabOverview view="facilitator" projectId="p1" liveOverviewError="NO_PROJECT_ROLE" />);
    const notice = screen.getByTestId("project-overview-live-overview-error");
    expect(notice).toHaveTextContent("还没有角色");
    expect(notice).toHaveTextContent("NO_PROJECT_ROLE");
    expect(notice.className).not.toContain("text-destructive");
    expect(screen.queryByTestId("project-overview-live-overview-error-retry")).not.toBeInTheDocument();
  });

  it("ADMIN_NOT_SUPERUSER（组织层）：人话说明「组织层限制」+ 不给重试按钮", () => {
    render(<TabOverview view="facilitator" projectId="p1" liveError="ADMIN_NOT_SUPERUSER" />);
    const notice = screen.getByTestId("project-overview-live-error");
    expect(notice).toHaveTextContent("组织层限制");
    expect(notice).toHaveTextContent("ADMIN_NOT_SUPERUSER");
    expect(notice.className).not.toContain("text-destructive");
    expect(screen.queryByTestId("project-overview-live-error-retry")).not.toBeInTheDocument();
  });

  it("DEPENDENCY_UNAVAILABLE（真故障）：destructive 语气 + 给重试按钮", () => {
    render(<TabOverview view="facilitator" projectId="p1" liveOverviewError="DEPENDENCY_UNAVAILABLE" />);
    const notice = screen.getByTestId("project-overview-live-overview-error");
    expect(notice.className).toContain("text-destructive");
    expect(screen.getByTestId("project-overview-live-overview-error-retry")).toBeInTheDocument();
  });

  it("AUTH_SERVICE_UNAVAILABLE（真故障）：destructive 语气 + 给重试按钮", () => {
    render(<TabOverview view="facilitator" projectId="p1" liveError="AUTH_SERVICE_UNAVAILABLE" />);
    const notice = screen.getByTestId("project-overview-live-error");
    expect(notice.className).toContain("text-destructive");
    expect(screen.getByTestId("project-overview-live-error-retry")).toBeInTheDocument();
  });

  it("未在名单里的未知 reasonCode：落到通用兜底文案，仍保留原始码，且可重试", () => {
    render(<TabOverview view="facilitator" projectId="p1" liveOverviewError="HTTP 503" />);
    const notice = screen.getByTestId("project-overview-live-overview-error");
    expect(notice).toHaveTextContent("HTTP 503");
    expect(notice.className).toContain("text-destructive");
    expect(screen.getByTestId("project-overview-live-overview-error-retry")).toBeInTheDocument();
  });

  it("反证：把 NO_PROJECT_ROLE 错标成 destructive 语气，断言必红——证明 tone 分支不是摆设", () => {
    render(<TabOverview view="facilitator" projectId="p1" liveOverviewError="NO_PROJECT_ROLE" />);
    const notice = screen.getByTestId("project-overview-live-overview-error");
    expect(() => expect(notice.className).toContain("text-destructive")).toThrow();
  });
});

/**
 * F172 —— 概览 tab 去掉没有契约出处的编造数据。
 *
 * 这组测试的重点不是「新块渲染出来了」，而是**旧的编造值不再出现**。
 * 改前这一屏同时存在两份「当前环节」：F362 接真的那块，和一张 mock 卡
 * （标题 + 一个不走动的假倒计时 `12:48` + 三角色「各该做什么」的文案）。
 * 一真一假并列时，用户没有任何办法分辨——所以每条断言都钉「那个具体的编造值没了」。
 */
describe("F172 project-overview：没有契约出处的板块不再编造数据", () => {
  it("当前环节卡接真：显示真实环节，不再有假倒计时", () => {
    render(<TabOverview view="facilitator" projectId="p1" liveOverview={FULL_OVERVIEW} />);

    expect(screen.getByTestId("project-overview-current-segment-title")).toHaveTextContent("破冰环节");
    // 反证：mock 的标题与倒计时都不得再出现在任何地方
    expect(screen.queryByText(/12:48/)).not.toBeInTheDocument();
    expect(screen.queryByText(/假设风暴/)).not.toBeInTheDocument();
    // 三角色分工没有契约出处 ⇒ 如实说明，且不得再出现原来的编造文案
    expect(screen.getByTestId("project-overview-current-segment-roles-unavailable")).toBeInTheDocument();
    expect(screen.queryByText(/第 4 组落后/)).not.toBeInTheDocument();
  });

  it("没有进行中环节时，当前环节卡说实话而不是显示上一次的值", () => {
    render(
      <TabOverview view="facilitator" projectId="p1" liveOverview={{ ...FULL_OVERVIEW, currentAgendaSegment: null }} />,
    );
    expect(screen.getByTestId("project-overview-current-segment-title")).toHaveTextContent("当前没有进行中的环节");
  });

  it("状态条只画有出处的两项（当前环节 / 角色人数），其余三项不再编造", () => {
    render(<TabOverview view="facilitator" projectId="p1" liveOverview={FULL_OVERVIEW} />);

    expect(screen.getByTestId("project-overview-statusbar-segment")).toHaveTextContent("破冰环节");
    expect(screen.getByTestId("project-overview-statusbar-attendance")).toHaveTextContent("组员 6");
    // 反证：原型那三项（阶段 / 就绪检查 / 计时）契约里没有 ⇒ 不得出现
    expect(screen.queryByText(/就绪检查/)).not.toBeInTheDocument();
    expect(screen.queryByText(/12 人在场/)).not.toBeInTheDocument();
    expect(screen.queryByText(/09:00 开始/)).not.toBeInTheDocument();
  });

  it("待办与动态整块降级为如实空态，不再渲染示例行", () => {
    render(<TabOverview view="facilitator" projectId="p1" liveOverview={FULL_OVERVIEW} />);

    expect(screen.getByTestId("project-overview-todos-unavailable")).toBeInTheDocument();
    expect(screen.getByTestId("project-overview-activity-unavailable")).toBeInTheDocument();
    // 反证：三条示例待办与「1 项阻塞」这种看起来算过的计数都不得再出现
    expect(screen.queryByText(/催回 14 份问卷/)).not.toBeInTheDocument();
    expect(screen.queryByText(/给第 3 组补 1 位/)).not.toBeInTheDocument();
    expect(screen.queryByText(/1 项阻塞/)).not.toBeInTheDocument();
  });

  it("白名单四件块不受影响（F362 的行为不回退）", () => {
    render(<TabOverview view="facilitator" projectId="p1" liveOverview={FULL_OVERVIEW} />);
    expect(screen.getByTestId("project-overview-live-agenda-segment")).toHaveTextContent("破冰环节");
    expect(screen.getByTestId("project-overview-live-role-counts")).toHaveTextContent("组长 2");
    expect(screen.getByTestId("project-overview-live-backflow-count")).toHaveTextContent("1 条");
    expect(screen.getByTestId("project-overview-live-blueprint")).toHaveTextContent("标准工作坊蓝本 · v2");
  });
});
