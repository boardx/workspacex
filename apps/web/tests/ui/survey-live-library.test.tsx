import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LiveSurveyLibrary } from "@/components/survey/live/survey-library";

const request = vi.hoisted(() => vi.fn());
const push = vi.hoisted(() => vi.fn());
vi.mock("@/lib/survey/runtime-client", () => ({ surveyRequest: request }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

const survey = (patch = {}) => ({
  id: "survey-1", title: "客户满意度", version: 1, status: "collecting", anonymity: "anonymous",
  answerRevision: 0, reportBasisAnswerRevision: null, updatedAt: "2026-09-27T10:00:00.000Z",
  questions: [{ id: "q1", title: "满意吗", type: "single", chapterId: "general", order: 1, required: true, options: ["是", "否"] }],
  template: { id: "t1", title: "报告", sections: [] }, responses: [{ id: "r1" }], publication: { token: "token", status: "collecting", version: 1, expiresAt: "2026-10-01T00:00:00.000Z", questions: [] },
  report: null, reportBasisVersion: null, reportGeneratedAt: null, ...patch,
});

beforeEach(() => { request.mockReset(); push.mockReset(); });

describe("LiveSurveyLibrary", () => {
  it("shows real survey status and routes collecting surveys to response review", async () => {
    request.mockResolvedValueOnce([survey()]);
    render(<LiveSurveyLibrary />);
    expect(await screen.findByRole("heading", { name: "我的问卷" })).toBeInTheDocument();
    expect(screen.getByTestId("survey-status-survey-1")).toHaveTextContent("回收中");
    fireEvent.click(screen.getByRole("button", { name: "查看答卷" }));
    expect(push).toHaveBeenCalledWith("/studio/survey/survey-1?step=responses");
  });

  it("distinguishes a failed list request from an empty survey list", async () => {
    request.mockRejectedValueOnce(new Error("无访问权限"));
    render(<LiveSurveyLibrary />);
    expect(await screen.findByRole("alert")).toHaveTextContent("无访问权限");
    expect(screen.queryByText("还没有问卷")).not.toBeInTheDocument();
  });

  it("renders a focused empty state with create and template actions", async () => {
    request.mockResolvedValueOnce([]);
    render(<LiveSurveyLibrary />);
    expect(await screen.findByRole("heading", { name: "还没有问卷" })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "新建问卷" })).toHaveLength(2);
    expect(screen.getByRole("link", { name: "问卷模板" })).toHaveAttribute("href", "/studio/survey?tab=modules");
  });
});
