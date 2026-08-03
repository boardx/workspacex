/**
 * F353 —— 项目工作台「概览」tab 的真实项目基本信息块。
 *
 * 直接测 `TabOverview`（不经过整条 `ProjectWorkbench` 拉取链路，那条链路的
 * fetch/orgId 分支已经在 `projects-screen-live.test.tsx` 里用同一套假 fetch 验证过）。
 * 这里钉住三种状态：有真实数据 / 没有（未登录或缺 org）/ 读取失败，且不再显示
 * mock 项目名「欧洲进入策略 Kickoff」作为「真实数据」。
 */
import * as React from "react";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { TabOverview } from "@/components/project/tab-overview";

describe("F353 project-overview：项目基本信息块只显示真实数据", () => {
  it("liveProject 为 null 时显示诚实的空态，不回退到 mock 名字", () => {
    render(<TabOverview view="facilitator" projectId="p1" liveProject={null} />);
    expect(screen.getByTestId("project-overview-live-empty")).toBeInTheDocument();
    expect(screen.queryByTestId("project-overview-live-name")).not.toBeInTheDocument();
  });

  it("liveProject 有值时渲染真实 name/kind/status/只读原因", () => {
    render(
      <TabOverview
        view="facilitator"
        projectId="p1"
        liveProject={{ id: "p1", name: "真实工作坊", kind: "workshop", status: "archived", readOnlyReason: "archived" }}
      />,
    );
    const block = screen.getByTestId("project-overview-live-name");
    expect(block).toHaveTextContent("真实工作坊");
    expect(block).toHaveTextContent("工作坊");
    expect(block).toHaveTextContent("已归档");
    expect(screen.getByTestId("project-overview-live-readonly")).toHaveTextContent("已归档");
  });

  it("liveError 有值时显示失败提示，而不是空态或伪数据", () => {
    render(<TabOverview view="facilitator" projectId="p1" liveProject={null} liveError="AUTH_SERVICE_UNAVAILABLE" />);
    expect(screen.getByTestId("project-overview-live-error")).toHaveTextContent("AUTH_SERVICE_UNAVAILABLE");
    expect(screen.queryByTestId("project-overview-live-empty")).not.toBeInTheDocument();
  });

  it("project workbench passes its real project id into the Chat surface", () => {
    render(<TabOverview view="facilitator" projectId="project-route-real" />);
    expect(screen.getByTestId("project-home-surface-chat")).toHaveAttribute(
      "href",
      "/chat?projectId=project-route-real",
    );
  });
});
