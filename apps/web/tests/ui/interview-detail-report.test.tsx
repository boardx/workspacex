import * as React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DigitalInterviewWorkflowView } from "@/lib/interview-api";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
import { PersistentDigitalInterviewWorkflow } from "@/components/itv/digital-interview-workflow";

const completed: DigitalInterviewWorkflowView = {
  interviewId: "itv-f06", name: "江西足球", tags: ["足球"], topic: "江西足球的崛起", status: "running",
  sourceQuickInterviewId: null, selectedExpertIds: ["expert-f06"], reportId: null, report: null, version: 12,
  scope: { kind: "none", projectId: null, researchProjectId: null }, currentStep: "runs", revisionId: "revision-f06",
  topicVersionId: "topic-f06", expertSnapshotVersionId: "experts-f06", questionVersionId: "questions-f06",
  expertCandidates: [], questions: [], questionCandidates: [], skillThreadId: "thread-f06", skillMessages: [], skillProposals: [],
  expertRuns: [{
    expertId: "expert-f06", displayName: "陈指导", status: "completed", completedQuestions: 1, totalQuestions: 1,
    answers: [{ questionId: "question-f06", question: "如何建设基层体系？", answer: "先培养教练，再连接赛事。" }],
    errorCode: null, updatedAt: "2026-09-01T02:00:00.000Z",
  }],
};

afterEach(() => vi.unstubAllGlobals());

describe("F06 interview answers to report", () => {
  it("renders persisted report chunks before the final report arrives", async () => {
    const streaming = { ...completed, status: "report_pending" as const, currentStep: "report" as const, version: 13,
      reportGeneration: { reportId: "report-f06", requestId: "request-f06", status: "running" as const,
        title: "江西足球访谈报告", executiveSummary: "基层体系需要协同。", markdown: "## 基层体系",
        findings: [], errorCode: null, updatedAt: "2026-09-01T02:00:30.000Z" } };
    const final = { ...streaming, status: "completed" as const, version: 14, reportGeneration: null,
      reportId: "report-f06", report: { reportId: "report-f06", title: "江西足球访谈报告",
        executiveSummary: "基层体系需要教练与赛事协同。", markdown: "# 江西足球访谈报告\n\n## 基层体系",
        findings: [{ findingId: "finding-f06", title: "基层优先", summary: "先培养教练。", expertId: "expert-f06",
          questionId: "question-f06", sourceAnswerId: "expert-f06:question-f06", exploratory: true as const }],
        generatedAt: "2026-09-01T02:01:00.000Z" } };
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      expect(body).toMatchObject({ expectedVersion: 12, requestId: expect.any(String) });
      const encoder = new TextEncoder();
      return new Response(new ReadableStream({ start(controller) {
        controller.enqueue(encoder.encode(`${JSON.stringify({ type: "progress", value: streaming })}\n`));
        window.setTimeout(() => { controller.enqueue(encoder.encode(`${JSON.stringify({ type: "complete", value: final })}\n`)); controller.close(); }, 10);
      } }), { status: 200, headers: { "content-type": "application/x-ndjson" } });
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<PersistentDigitalInterviewWorkflow initialView={completed} />);
    const button = screen.getByTestId("itv-confirm-answers-generate-report");
    expect(button).toBeEnabled();
    fireEvent.click(button);
    expect(await screen.findByTestId("itv-report-stream-markdown")).toHaveTextContent("基层体系");
    expect(await screen.findByTestId("itv-report")).toHaveTextContent("江西足球访谈报告");
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  });

  it("reconnects from a persisted running generation after refresh", async () => {
    const recovered = { ...completed, status: "report_pending" as const, currentStep: "report" as const, version: 13,
      reportGeneration: { reportId: "report-f06", requestId: "request-f06", status: "running" as const,
        title: "恢复中的报告", executiveSummary: null, markdown: "## 已持久化段落", findings: [], errorCode: null,
        updatedAt: "2026-09-01T02:00:30.000Z" } };
    const fetchMock = vi.fn(async (_input: RequestInfo | URL) => new Response(`${JSON.stringify({ type: "progress", value: recovered })}\n`, {
      status: 200, headers: { "content-type": "application/x-ndjson" },
    }));
    vi.stubGlobal("fetch", fetchMock);
    render(<PersistentDigitalInterviewWorkflow initialView={recovered} />);
    expect(await screen.findByTestId("itv-report-stream-markdown")).toHaveTextContent("已持久化段落");
    await waitFor(() => expect(fetchMock.mock.calls[0]?.[0]).toEqual(expect.stringContaining("/report/stream")));
  });

  it("recovers from a network interruption after the report POST already started", async () => {
    const streaming = { ...completed, status: "report_pending" as const, currentStep: "report" as const, version: 13,
      reportGeneration: { reportId: "report-reconnect", requestId: "request-reconnect", status: "running" as const,
        title: "恢复中的报告", executiveSummary: null, markdown: "## 已持久化段落", findings: [], errorCode: null,
        updatedAt: "2026-09-03T02:00:30.000Z" } };
    const final = { ...streaming, status: "completed" as const, version: 14, reportGeneration: null,
      reportId: "report-reconnect", report: { reportId: "report-reconnect", title: "自动恢复报告",
        executiveSummary: "长连接断开后从服务端状态恢复。", markdown: "# 自动恢复报告",
        findings: [{ findingId: "finding-reconnect", title: "断线可恢复", summary: "服务端继续生成。",
          expertId: "expert-f06", questionId: "question-f06", sourceAnswerId: "expert-f06:question-f06",
          exploratory: true as const }], generatedAt: "2026-09-03T02:01:00.000Z" } };
    const encoder = new TextEncoder();
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (init?.method === "POST") {
        return new Response(new ReadableStream({ start(controller) {
          controller.enqueue(encoder.encode(`${JSON.stringify({ type: "progress", value: streaming })}\n`));
          window.setTimeout(() => controller.error(new TypeError("network error")), 10);
        } }), { status: 200, headers: { "content-type": "application/x-ndjson" } });
      }
      if (url.endsWith(`/interviews/digital/${completed.interviewId}`)) {
        return new Response(JSON.stringify(streaming), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (url.endsWith(`/interviews/digital/${completed.interviewId}/report/stream`)) {
        return new Response(`${JSON.stringify({ type: "complete", value: final })}\n`, {
          status: 200, headers: { "content-type": "application/x-ndjson" },
        });
      }
      throw new Error(`unexpected request ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<PersistentDigitalInterviewWorkflow initialView={completed} />);
    fireEvent.click(screen.getByTestId("itv-confirm-answers-generate-report"));

    expect(await screen.findByTestId("itv-report-stream-markdown")).toHaveTextContent("已持久化段落");
    expect(await screen.findByTestId("itv-report")).toHaveTextContent("自动恢复报告");
    expect(screen.queryByRole("alert")).toBeNull();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
  });
});
