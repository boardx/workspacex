/**
 * F05（phase-10 group-checkin 束，design-signoff.md 已签核 2026-08-20）—— 现场协作 Tab
 * 「主持台·全场」新增的「分组与签到」聚合视图：4 组卡片网格 · 复制链接 · 成员到场列表。
 *
 * 数据源是真实契约形状（`orgAdmin.operations.getCheckinBoard.out`），不是
 * `lib/mock/live-collab-orchestration.ts` 那套手写 mock——本文件直接构造契约推导出的
 * `CheckinBoardOut`，与 `checkin-writeback.test.ts`（应用层，真实 DB）覆盖的是同一个类型，
 * 只是这里测的是渲染层。
 */
import * as React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { TabLive } from "@/components/project/tab-live";
import type { CheckinBoardOut } from "@/lib/live-checkin";

vi.mock("@/components/session/session-provider", () => ({
  useOptionalSession: () => ({ session: null, identity: { groupName: null } }),
}));

function board(overrides: Partial<CheckinBoardOut> = {}): CheckinBoardOut {
  return {
    groups: [
      {
        groupId: "g-1",
        title: "第 1 组 · 业主首次评估",
        present: 1,
        total: 2,
        links: [{ url: "https://app.example/w/p-1/g/g-1?r=member&t=tok-1", qrPayload: null }],
        roster: [
          { alias: "138 •••• 1111", attendance: "present" },
          { alias: "138 •••• 2222", attendance: "absent" },
        ],
      },
      {
        groupId: "g-2",
        title: "第 2 组 · 采购比选",
        present: 0,
        total: 0,
        links: [],
        roster: [],
      },
    ],
    overall: { present: 1, total: 2 },
    realtime: false,
    ...overrides,
  };
}

describe("TabLive「分组与签到」聚合视图（真实渲染）", () => {
  it("facilitator + 全场：渲染真实的 4 组卡片、每组 present/total、成员到场徽标", () => {
    render(<TabLive view="facilitator" liveCheckin={board()} />);

    const grid = screen.getByTestId("lc-checkin-grid");
    expect(grid).toBeInTheDocument();

    const g1 = screen.getByTestId("lc-checkin-group-g-1");
    expect(g1).toHaveTextContent("第 1 组 · 业主首次评估");
    expect(g1).toHaveTextContent("1/2 已到");
    const roster = screen.getByTestId("lc-checkin-group-roster");
    expect(roster).toHaveTextContent("138 •••• 1111");
    expect(roster).toHaveTextContent("已到");
    expect(roster).toHaveTextContent("138 •••• 2222");
    expect(roster).toHaveTextContent("未到");

    // 全场汇总也是真实数字，不是编造的
    expect(screen.getByText("全场 1/2 已到")).toBeInTheDocument();
  });

  it("空名单组：如实显示『还没有名单条目』，不渲染假成员", () => {
    render(<TabLive view="facilitator" liveCheckin={board()} />);
    const g2 = screen.getByTestId("lc-checkin-group-g-2");
    expect(g2).toHaveTextContent("0/0 已到");
    expect(screen.getByTestId("lc-checkin-group-roster-empty")).toHaveTextContent("本组还没有名单条目");
  });

  it("复制链接按钮：真的调用 clipboard.writeText，写入该组真实链接 url", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    render(<TabLive view="facilitator" liveCheckin={board()} />);
    const g1 = screen.getByTestId("lc-checkin-group-g-1");
    const copyBtn = g1.querySelector('[data-testid="lc-checkin-group-copy-link"]') as HTMLElement;
    fireEvent.click(copyBtn);

    await waitFor(() => expect(writeText).toHaveBeenCalledWith("https://app.example/w/p-1/g/g-1?r=member&t=tok-1"));
    await waitFor(() => expect(copyBtn).toHaveTextContent("已复制"));
  });

  it("没有邀请链接的组：复制按钮禁用，如实显示『暂无可用邀请链接』", () => {
    render(<TabLive view="facilitator" liveCheckin={board()} />);
    const g2 = screen.getByTestId("lc-checkin-group-g-2");
    const copyBtn = g2.querySelector('[data-testid="lc-checkin-group-copy-link"]') as HTMLElement;
    expect(copyBtn).toBeDisabled();
    expect(screen.getByTestId("lc-checkin-group-no-link")).toBeInTheDocument();
  });

  it("读取失败 ⇒ 如实显示错误，不静默回退成空场或假数据", () => {
    render(<TabLive view="facilitator" liveCheckin={null} liveCheckinError="HTTP 500" />);
    expect(screen.getByTestId("lc-checkin-error")).toHaveTextContent("HTTP 500");
    expect(screen.queryByTestId("lc-checkin-grid")).not.toBeInTheDocument();
  });

  it("加载中 ⇒ 显示读取态，不是空白或假数据", () => {
    render(<TabLive view="facilitator" liveCheckin={null} liveCheckinLoading={true} />);
    expect(screen.getByTestId("lc-checkin-loading")).toBeInTheDocument();
  });

  it("『四组并行』诚实空态依然共存，没有被本 feature 顶掉", () => {
    render(<TabLive view="facilitator" liveCheckin={board()} />);
    expect(screen.getByTestId("project-live-groups-unavailable")).toBeInTheDocument();
    expect(screen.getByTestId("lc-checkin-grid")).toBeInTheDocument();
  });

  it("非引导师（observer）：不渲染『分组与签到』区块（F05 范围只做 facilitator 全场）", () => {
    render(<TabLive view="observer" liveCheckin={board()} />);
    expect(screen.queryByTestId("lc-checkin")).not.toBeInTheDocument();
  });

  it("切到某个具体分组视角后，『分组与签到』区块不重复出现（那是全场态专属）", () => {
    const groups: import("@/lib/live-project-prep").Group[] = [
      {
        groupId: "g-1",
        name: "第 1 组 · 业主首次评估",
        scenario: "业主首次评估储能投资",
        leaderUserId: "u-lead",
        status: "recording-ready",
        memberUserIds: ["u-2", "u-3"],
      },
    ];
    render(
      <TabLive
        view="facilitator"
        liveCheckin={board()}
        liveGrouping={{ groups, revision: "rev-1" }}
      />,
    );
    expect(screen.getByTestId("lc-checkin")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("lc-viewer-trigger"));
    fireEvent.click(screen.getByTestId("lc-viewer-option-g-1"));

    expect(screen.queryByTestId("lc-checkin")).not.toBeInTheDocument();
    expect(screen.getByTestId("lc-group-panel-name")).toHaveTextContent("第 1 组 · 业主首次评估");
  });
});
