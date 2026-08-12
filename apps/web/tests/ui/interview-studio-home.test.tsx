import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { SESSION_TOKEN_STORAGE_KEY } from "@/lib/api-client";

vi.mock("@/components/session/session-provider", () => ({
  useSession: () => ({ session: { currentOrgId: "org-f02" } }),
}));

import { InterviewStudioHome } from "@/components/itv/interview-studio-home";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("F02 第 3 组 UI：访谈 Studio 首屏", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.localStorage.setItem(SESSION_TOKEN_STORAGE_KEY, "tok-f02");
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(typeof input === "string" ? input : input.toString());
      if (url.pathname === "/interviews/digital") {
        return json({ items: [{
          interviewId: "itv-1", kind: "batch", name: "德国采购决策链", tags: ["采购决策"], topic: "谁拥有否决权",
          status: "running", expertCount: 3, completedExpertCount: 2, primaryAction: "continue_runs",
          updatedAt: "2026-08-12T03:00:00.000Z",
        }, {
          interviewId: "itv-2", kind: "batch", name: "待生成报告", tags: ["报告"], topic: "归纳专家回答",
          status: "report_pending", expertCount: 2, completedExpertCount: 2, primaryAction: "generate_report",
          updatedAt: "2026-08-12T04:00:00.000Z",
        }] });
      }
      if (url.pathname === "/interviews/digital/experts") {
        return json({ items: [{
          expertId: "agent-de", initials: "DE", displayName: "德国采购总监", role: "采购与供应链",
          domains: ["采购与供应链"], materialBoundary: "未绑定已发布材料版本", exploratory: true,
        }] });
      }
      throw new Error(`unexpected fetch ${url.pathname}`);
    }));
  });

  afterEach(() => vi.unstubAllGlobals());

  it("默认显示历史卡，一级标签只有历史访谈与专家列表，新建按钮完整单行", async () => {
    render(<InterviewStudioHome initialTab="history" />);
    expect(screen.getAllByRole("tab")).toHaveLength(2);
    expect(screen.getByTestId("itv-tab-history")).toHaveTextContent("历史访谈");
    expect(screen.getByTestId("itv-tab-experts")).toHaveTextContent("专家列表");
    expect(screen.getByTestId("itv-create")).toHaveAttribute("href", "/itv/new");
    expect(screen.getByTestId("itv-create")).toHaveClass("whitespace-nowrap");

    const card = await screen.findByTestId("itv-history-card-itv-1");
    expect(within(card).getByText("德国采购决策链")).toBeInTheDocument();
    expect(within(card).getByText("进行中")).toBeInTheDocument();
    expect(within(card).getByText("2 / 3 位专家完成")).toBeInTheDocument();
    const reportCard = await screen.findByTestId("itv-history-card-itv-2");
    expect(within(reportCard).getByRole("link", { name: /生成报告/ })).toHaveAttribute("href", "/itv/itv-2/report");
    expect(within(reportCard).queryByText("继续访谈")).not.toBeInTheDocument();
  });

  it("切到专家列表后显示材料边界，快捷访谈进入独立页面", async () => {
    render(<InterviewStudioHome initialTab="history" />);
    fireEvent.click(screen.getByTestId("itv-tab-experts"));
    const card = await screen.findByTestId("itv-expert-card-agent-de");
    expect(within(card).getByText("未绑定已发布材料版本")).toBeInTheDocument();
    expect(screen.getByTestId("itv-quick-agent-de")).toHaveAttribute("href", "/itv/quick/new?expertId=agent-de");
  });

  it("依赖失败显示错误，不伪装成空列表", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ reasonCode: "DEPENDENCY_UNAVAILABLE" }, 503));
    render(<InterviewStudioHome initialTab="history" />);
    await waitFor(() => expect(screen.getByTestId("itv-history-error")).toHaveTextContent("DEPENDENCY_UNAVAILABLE"));
    expect(screen.queryByTestId("itv-history-empty")).not.toBeInTheDocument();
  });
});
