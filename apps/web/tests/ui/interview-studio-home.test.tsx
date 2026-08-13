import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { SESSION_TOKEN_STORAGE_KEY } from "@/lib/api-client";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

vi.mock("@/components/session/session-provider", () => ({
  useSession: () => ({ session: { currentOrgId: "org-f02" } }),
}));

import { InterviewStudioHome } from "@/components/itv/interview-studio-home";
import { createMockDigitalInterviewDraft } from "@/lib/mock/digital-interview-drafts";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("F02 第 3 组 UI：访谈 Studio 首屏", () => {
  beforeEach(() => {
    push.mockReset();
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
      throw new Error(`unexpected fetch ${url.pathname}`);
    }));
  });

  afterEach(() => vi.unstubAllGlobals());

  it("默认显示历史卡，一级标签只有历史访谈与专家列表，新建按钮完整单行", async () => {
    render(<InterviewStudioHome initialTab="history" />);
    expect(screen.getAllByRole("tab")).toHaveLength(2);
    expect(screen.getByTestId("itv-tab-history")).toHaveTextContent("历史访谈");
    expect(screen.getByTestId("itv-tab-experts")).toHaveTextContent("专家列表");
    expect(screen.getByTestId("itv-create")).toHaveAttribute("type", "button");
    expect(screen.getByTestId("itv-create")).toHaveClass("whitespace-nowrap");
    expect(screen.getByTestId("itv-create")).toHaveClass("bg-primary", "text-primary-foreground");

    const card = await screen.findByTestId("itv-history-card-itv-1");
    expect(within(card).getByText("德国采购决策链")).toBeInTheDocument();
    expect(within(card).getByText("进行中")).toBeInTheDocument();
    expect(within(card).getByText("2 / 3 位专家完成")).toBeInTheDocument();
    const reportCard = await screen.findByTestId("itv-history-card-itv-2");
    expect(within(reportCard).getByRole("link", { name: /生成报告/ })).toHaveAttribute("href", "/itv/itv-2/report");
    expect(within(reportCard).queryByText("继续访谈")).not.toBeInTheDocument();
  });

  it("通过弹窗填写名称和最多五个标签后直接进入访谈流程", async () => {
    render(<InterviewStudioHome initialTab="history" />);

    fireEvent.click(screen.getByTestId("itv-create"));
    const dialog = screen.getByTestId("itv-create-dialog");
    expect(dialog).toBeInTheDocument();
    expect(within(dialog).getByTestId("itv-create-submit")).toBeDisabled();

    fireEvent.change(within(dialog).getByTestId("itv-create-name"), {
      target: { value: "德国采购决策链" },
    });
    const tagInput = within(dialog).getByTestId("itv-create-tag-input");
    for (const tag of ["采购", "德国", "储能", "决策", "B2B"]) {
      fireEvent.change(tagInput, { target: { value: tag } });
      fireEvent.keyDown(tagInput, { key: "Enter" });
    }
    expect(within(dialog).getAllByTestId("itv-create-tag")).toHaveLength(5);
    expect(tagInput).toBeDisabled();

    fireEvent.click(within(dialog).getByLabelText("删除标签 B2B"));
    expect(tagInput).toBeEnabled();
    fireEvent.click(within(dialog).getByTestId("itv-create-submit"));

    await waitFor(() => expect(push).toHaveBeenCalledWith(expect.stringMatching(/^\/itv\/mock-batch-.+\/setup$/)));
    const drafts = JSON.parse(localStorage.getItem("wsx.mockDigitalInterviewDrafts.v1") ?? "{}");
    expect(Object.values(drafts)[0]).toMatchObject({
      name: "德国采购决策链",
      tags: ["采购", "德国", "储能", "决策"],
      topic: "",
      currentStep: 1,
    });
  });

  it("返回历史访谈后可以看到并继续本地 Mock 草稿", async () => {
    const draft = createMockDigitalInterviewDraft({ name: "德国储能采购", tags: ["采购"] });
    vi.mocked(fetch).mockResolvedValueOnce(json({ items: [] }));

    render(<InterviewStudioHome initialTab="history" />);

    const card = await screen.findByTestId(`itv-history-card-${draft.interviewId}`);
    expect(within(card).getByText("德国储能采购")).toBeInTheDocument();
    expect(within(card).getByText("草稿")).toBeInTheDocument();
    expect(within(card).getByRole("link", { name: /确认主题/ }))
      .toHaveAttribute("href", `/itv/${draft.interviewId}/setup`);
  });

  it("旧版 Mock 草稿缺少流程字段时仍可恢复为确认主题卡片", async () => {
    window.localStorage.setItem("wsx.mockDigitalInterviewDrafts.v1", JSON.stringify({
      "mock-batch-legacy": {
        interviewId: "mock-batch-legacy",
        name: "旧版采购访谈",
        tags: ["采购"],
        topic: "",
        status: "draft",
        sourceQuickInterviewId: null,
        selectedExpertIds: [],
        reportId: null,
        updatedAt: "2026-08-12T05:00:00.000Z",
        version: 1,
      },
    }));
    vi.mocked(fetch).mockResolvedValueOnce(json({ items: [] }));

    render(<InterviewStudioHome initialTab="history" />);

    const card = await screen.findByTestId("itv-history-card-mock-batch-legacy");
    expect(within(card).getByText("旧版采购访谈")).toBeInTheDocument();
    expect(within(card).getByRole("link", { name: /确认主题/ }))
      .toHaveAttribute("href", "/itv/mock-batch-legacy/setup");
  });

  it("切到专家列表后显示 persona mock、分类和快捷访谈入口", async () => {
    render(<InterviewStudioHome initialTab="history" />);
    fireEvent.click(screen.getByTestId("itv-tab-experts"));
    const card = await screen.findByTestId("itv-expert-card-mock-persona:68ecb1289191bb24396f9bd4");
    expect(within(card).getByText("张浩宇")).toBeInTheDocument();
    expect(within(card).getByText("AI/机器学习专家")).toBeInTheDocument();
    expect(within(card).getByText("Mock 专家")).toBeInTheDocument();
    expect(screen.getByTestId("itv-expert-count")).toHaveTextContent("97 位 Mock 专家");
    expect(screen.getByRole("button", { name: "技术专家" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "全部专家" }))
      .toHaveClass("bg-primary", "text-primary-foreground");
    expect(screen.getByTestId("itv-quick-mock-persona:68ecb1289191bb24396f9bd4"))
      .toHaveAttribute("href", "/itv/quick/new?expertId=mock-persona%3A68ecb1289191bb24396f9bd4");
    expect(screen.getByTestId("itv-quick-mock-persona:68ecb1289191bb24396f9bd4"))
      .toHaveClass("bg-primary", "text-primary-foreground");
    expect(within(card).getByRole("link", { name: "查看专家" }))
      .toHaveAttribute("href", "/itv/experts/mock-persona:68ecb1289191bb24396f9bd4");
  });

  it("依赖失败显示错误，不伪装成空列表", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ reasonCode: "DEPENDENCY_UNAVAILABLE" }, 503));
    render(<InterviewStudioHome initialTab="history" />);
    await waitFor(() => expect(screen.getByTestId("itv-history-error")).toHaveTextContent("DEPENDENCY_UNAVAILABLE"));
    expect(screen.queryByTestId("itv-history-empty")).not.toBeInTheDocument();
  });
});
