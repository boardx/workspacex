/**
 * F964（2026-08-20）—— 成果沉淀 tab「成果去向」接真实 `getProjectOverview.backflow`
 * （`listBackflow` 的项目侧投影）、「审计与反馈」接真实 `queryProvenance`；「项目结论」/
 * 「假设状态」/「发布结论」/「候选决策」四块因契约未建模整块降级为如实空态。
 *
 * 直接测 `TabResults`（同 `project-live-stagebar.test.tsx` 对 `TabLive` 的测法）：
 * 父组件 `ProjectWorkbench` 的拉取链路已经是既有模式，这里只钉住 `TabResults`
 * 本身拿到 props 后怎么渲染各态、以及四块「未建模」区块不再显示编造数据。
 */
import * as React from "react";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { TabResults } from "@/components/project/tab-results";
import type { ProjectOverview } from "@/lib/live-projects";
import type { QueryProvenanceOut } from "@/lib/live-provenance";

function overview(overrides: Partial<ProjectOverview> = {}): ProjectOverview {
  return {
    projectId: "p-1",
    name: "欧洲进入策略 Kickoff 项目",
    kind: "workshop",
    status: "active",
    currentAgendaSegment: null,
    roleCounts: null,
    backflow: [],
    blueprint: null,
    ...overrides,
  };
}

describe("F964 TabResults：成果去向 / 审计与反馈接真，四块契约未建模区块如实降级", () => {
  it("四个契约未建模的区块（项目结论/假设状态/发布结论/候选决策）不再显示编造数据", () => {
    render(<TabResults view="facilitator" liveOverview={overview()} liveAudit={{ events: [], nextCursor: null }} />);
    expect(screen.getByTestId("project-results-conclusion-unavailable")).toBeInTheDocument();
    expect(screen.getByTestId("project-results-hypothesis-unavailable")).toBeInTheDocument();
    expect(screen.getByTestId("project-results-publish-unavailable")).toBeInTheDocument();
    expect(screen.getByTestId("project-results-candidates-unavailable")).toBeInTheDocument();
    // 旧的编造数据/危险按钮一律不应再出现
    expect(screen.queryByTestId("project-results-publish-btn")).not.toBeInTheDocument();
    expect(screen.queryByText("先用两周尽调锁定资质可转让性")).not.toBeInTheDocument();
  });

  it("观察者与组员看不到发布结论/候选决策两块（保持角色投影规则）", () => {
    render(<TabResults view="observer" liveOverview={overview()} liveAudit={{ events: [], nextCursor: null }} />);
    expect(screen.queryByTestId("project-results-publish-unavailable")).not.toBeInTheDocument();
    expect(screen.queryByTestId("project-results-candidates-unavailable")).not.toBeInTheDocument();
  });

  it("成果去向：没有 liveOverview（未登录/无 org）⇒ 诚实说明暂无数据，不是空列表假象", () => {
    render(<TabResults view="facilitator" liveOverview={null} />);
    expect(screen.getByTestId("project-results-destinations-signed-out")).toBeInTheDocument();
  });

  it("成果去向：加载中 ⇒ 显示加载态", () => {
    render(<TabResults view="facilitator" liveOverview={null} liveOverviewLoading />);
    expect(screen.getByTestId("project-results-destinations-loading")).toBeInTheDocument();
  });

  it("成果去向：读取失败 ⇒ 显示真实错误，不吞成空态", () => {
    render(<TabResults view="facilitator" liveOverview={null} liveOverviewError="DEPENDENCY_UNAVAILABLE" />);
    expect(screen.getByTestId("project-results-destinations-error")).toHaveTextContent("DEPENDENCY_UNAVAILABLE");
  });

  it("成果去向：空回流列表 ⇒ 真实空态，不生成示例条目", () => {
    render(<TabResults view="facilitator" liveOverview={overview({ backflow: [] })} />);
    expect(screen.getByTestId("project-results-destinations-empty")).toBeInTheDocument();
  });

  it("成果去向：有回流条目 ⇒ 显示真实 mode/version/pinnedBy/pinnedAt 四字段", () => {
    render(
      <TabResults
        view="facilitator"
        liveOverview={overview({
          backflow: [
            {
              title: "进入策略初步结论", bindingId: "bind-1", artifactId: "art-1",
              mode: "pinned", version: 2, pinnedBy: "周宁", pinnedAt: "2026-07-25T12:30:00.000Z", badge: "pinned",
            },
            {
              title: "现金流对比模型", bindingId: "bind-2", artifactId: "art-2",
              mode: "live", version: 5, pinnedBy: "林可", pinnedAt: "2026-08-01T09:00:00.000Z", badge: "live",
            },
          ],
        })}
      />,
    );
    const list = screen.getByTestId("project-results-destinations-list");
    expect(list).toHaveTextContent("版本 2");
    expect(list).toHaveTextContent("周宁");
    expect(list).toHaveTextContent("已定版");
    expect(list).toHaveTextContent("版本 5");
    expect(list).toHaveTextContent("实时 · 随源变动");
  });

  it("审计与反馈：没有 liveAudit（未登录/无 org）⇒ 诚实说明暂无数据", () => {
    render(<TabResults view="facilitator" liveAudit={null} />);
    expect(screen.getByTestId("project-results-audit-signed-out")).toBeInTheDocument();
  });

  it("审计与反馈：加载中 ⇒ 显示加载态", () => {
    render(<TabResults view="facilitator" liveAudit={null} liveAuditLoading />);
    expect(screen.getByTestId("project-results-audit-loading")).toBeInTheDocument();
  });

  it("审计与反馈：读取失败 ⇒ 显示真实错误", () => {
    render(<TabResults view="facilitator" liveAudit={null} liveAuditError="NO_ORG_MEMBERSHIP" />);
    expect(screen.getByTestId("project-results-audit-error")).toHaveTextContent("NO_ORG_MEMBERSHIP");
  });

  it("审计与反馈：空事件列表 ⇒ 真实空态文案，不生成示例条目", () => {
    render(<TabResults view="facilitator" liveAudit={{ events: [], nextCursor: null }} />);
    expect(screen.getByTestId("project-results-audit-empty")).toHaveTextContent("不生成示例条目");
  });

  it("审计与反馈：有事件 ⇒ 显示真实条数与 actor/target，不是 mock 的 214 条", () => {
    const audit: QueryProvenanceOut = {
      events: [
        {
          id: "prov-1", type: "unauthorized-attempt", actorId: "u-1", at: "2026-08-20T03:00:00.000Z",
          orgId: "org-1", target: { kind: "project", id: "p-1" }, detail: { reason: "NO_PROJECT_ROLE" },
        },
      ],
      nextCursor: null,
    };
    render(<TabResults view="facilitator" liveAudit={audit} />);
    const list = screen.getByTestId("project-results-audit-list");
    expect(list).toHaveTextContent("越权尝试");
    expect(list).toHaveTextContent("actor u-1 → project:p-1");
    expect(screen.getByTestId("project-results-audit-total")).toHaveTextContent("共 1 条");
  });
});
