import * as React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DigitalInterviewWorkflowView } from "@/lib/interview-api";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
import { PersistentDigitalInterviewWorkflow } from "@/components/itv/digital-interview-workflow";

const exportWord = vi.fn();
const exportPdf = vi.fn();
vi.mock("@/lib/interview-report-export", () => ({
  exportInterviewReportWord: (...args: unknown[]) => exportWord(...args),
  exportInterviewReportPdf: (...args: unknown[]) => exportPdf(...args),
  reportMarkdownBody: (title: string, markdown: string) => markdown.replace(`# ${title}\n\n`, ""),
  evidenceModeLabel: (mode: string) => (mode === "simulated" ? "模拟探索" : mode === "mixed" ? "混合证据" : "真实访谈"),
}));

const completed: DigitalInterviewWorkflowView = {
  researchBrief: null, moderatorPolicy: null, reportReview: null,
  quality: { previewStatus: "unavailable", briefIssues: [], expertCoverage: [], questionFindings: [], readiness: null, readinessDecision: null, evidenceCoverage: [] },
  interviewId: "itv-f06", name: "江西足球", tags: ["足球"], topic: "江西足球的崛起", status: "running",
  sourceQuickInterviewId: null, selectedExpertIds: ["expert-f06"], reportId: null, report: null, version: 12,
  scope: { kind: "none", projectId: null, researchProjectId: null }, currentStep: "runs", revisionId: "revision-f06",
  topicVersionId: "topic-f06", expertSnapshotVersionId: "experts-f06", questionVersionId: "questions-f06",
  expertCandidates: [], questions: [], questionCandidates: [], skillThreadId: "thread-f06", skillMessages: [], skillProposals: [],
  studyEvidenceMode: "simulated",
  reportEvidenceEligibility: { eligibility: "blocked_missing_participant_evidence", message: "需要真实受访者证据后才能批准。", action: "添加并复核真实受访者回答" },
  expertRuns: [{
    expertId: "expert-f06", displayName: "陈指导", status: "completed", completedQuestions: 1, totalQuestions: 1,
    answers: [{ questionId: "question-f06", question: "如何建设基层体系？", answer: "先培养教练，再连接赛事。" }],
    errorCode: null, updatedAt: "2026-09-01T02:00:00.000Z",
  }],
};

afterEach(() => vi.unstubAllGlobals());

describe("F06 interview answers to report", () => {
  it("keeps an empty evidence matrix out of the report reading path and explains the review block", async () => {
    const reportView = {
      ...completed,
      status: "completed" as const,
      currentStep: "report" as const,
      reportId: "report-empty-evidence",
      report: {
        reportId: "report-empty-evidence",
        title: "江西足球访谈报告",
        executiveSummary: "基层体系需要教练与赛事协同。",
        markdown: "# 江西足球访谈报告\n\n## 决策摘要\n\n先培养教练。",
        findings: [],
        generatedAt: "2026-09-01T02:01:00.000Z",
      },
    };
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(reportView), { status: 200, headers: { "content-type": "application/json" } })));

    render(<PersistentDigitalInterviewWorkflow initialView={reportView} />);

    expect(await screen.findByTestId("itv-report-decision-brief")).toHaveTextContent("决策摘要");
    expect(screen.getByTestId("itv-evidence-review-blocked")).toHaveTextContent("尚无可展示的目标与专家证据覆盖");
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("puts the evidence boundary and next validation action before report analysis", () => {
    const report: DigitalInterviewWorkflowView = {
      ...completed, currentStep: "report", status: "completed",
      report: { reportId: "report-decision", title: "报告", executiveSummary: "摘要", markdown: "## 发现", findings: [], generatedAt: "2026-09-01T02:01:00.000Z" },
    };
    render(<PersistentDigitalInterviewWorkflow initialView={report} />);
    expect(screen.getByTestId("itv-study-evidence-label")).toHaveTextContent("模拟探索");
    expect(screen.getByTestId("itv-report-decision-brief")).toHaveTextContent("需要真实受访者证据后才能批准。");
    expect(screen.getByTestId("itv-report-decision-brief")).toHaveTextContent("添加并复核真实受访者回答");
  });

  it("lets the user retry a failed first report without leaving the report step", async () => {
    const failed: DigitalInterviewWorkflowView = { ...completed, status: "report_pending", currentStep: "report",
      reportGeneration: { reportId: "report-failed", requestId: "request-failed", status: "failed",
        title: "已保存的部分报告", executiveSummary: "已保存摘要", markdown: "已保存正文", findings: [],
        errorCode: "AI_GENERATION_UNAVAILABLE", updatedAt: "2026-09-24T14:00:00.000Z" } };
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ reasonCode: "AI_GENERATION_UNAVAILABLE" }), {
      status: 503, headers: { "content-type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    render(<PersistentDigitalInterviewWorkflow initialView={failed} />);

    expect(screen.getByTestId("itv-report-stream-markdown")).toHaveTextContent("已保存正文");
    expect(screen.getByRole("alert")).toHaveTextContent("模型服务暂时不可用或返回内容不完整");
    fireEvent.click(screen.getByRole("button", { name: "重新生成报告" }));
    expect(screen.getByRole("dialog")).toHaveTextContent("报告");
    fireEvent.click(screen.getByRole("button", { name: "确认重新生成" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
  });

  it("keeps an existing report on cancellation and asks before regeneration", async () => {
    const view: DigitalInterviewWorkflowView = { ...completed, status: "completed", reportId: "r-existing",
      report: { reportId: "r-existing", title: "现有报告", executiveSummary: "原摘要", markdown: "原内容", findings: [], generatedAt: "2026-09-01T02:01:00.000Z" } };
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ reasonCode: "DEPENDENCY_UNAVAILABLE" }), { status: 503, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    render(<PersistentDigitalInterviewWorkflow initialView={view} />);
    fireEvent.click(screen.getByTestId("itv-confirm-answers-generate-report"));
    expect(screen.getByRole("dialog")).toHaveTextContent("报告");
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "保留现有内容" }));
    fireEvent.click(screen.getByTestId("itv-workflow-step-5"));
    expect(screen.getByTestId("itv-report-markdown")).toHaveTextContent("原内容");
    fireEvent.click(screen.getByTestId("itv-workflow-step-4"));
    fireEvent.click(screen.getByTestId("itv-confirm-answers-generate-report"));
    fireEvent.click(screen.getByRole("button", { name: "确认重新生成" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
  });

  it("shows the preserved report and a failure notice when regeneration fails", async () => {
    const prior: DigitalInterviewWorkflowView = { ...completed, status: "completed", reportId: "r-existing",
      report: { reportId: "r-existing", title: "保留的报告", executiveSummary: "原摘要", markdown: "不可丢失的原内容", findings: [], generatedAt: "2026-09-01T02:01:00.000Z" } };
    vi.stubGlobal("fetch", vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method !== "POST") return new Response(JSON.stringify({ ...prior, version: prior.version + 2,
        reportGeneration: { reportId: "r-existing", requestId: "new-request", status: "failed", title: "未完成的新报告",
          executiveSummary: null, markdown: "部分新内容", findings: [], errorCode: "AI_GENERATION_UNAVAILABLE",
          updatedAt: "2026-09-01T02:02:00.000Z" } }), { headers: { "content-type": "application/json" } });
      const snapshot = { type: "snapshot", seq: 0, reportId: "r-existing", requestId: "new-request", status: "running",
        title: "未完成的新报告", executiveSummary: null, markdown: "部分新内容", findings: [], errorCode: null, updatedAt: "2026-09-01T02:02:00.000Z" };
      return new Response(`${JSON.stringify(snapshot)}\n${JSON.stringify({ type: "error", seq: 1, reasonCode: "AI_GENERATION_UNAVAILABLE" })}\n`, { headers: { "content-type": "application/x-ndjson" } });
    }));
    render(<PersistentDigitalInterviewWorkflow initialView={prior} />);
    fireEvent.click(screen.getByTestId("itv-confirm-answers-generate-report"));
    fireEvent.click(screen.getByRole("button", { name: "确认重新生成" }));
    expect(await screen.findByTestId("itv-report-markdown")).toHaveTextContent("不可丢失的原内容");
    expect(await screen.findByText(/操作未完成：AI_GENERATION_UNAVAILABLE/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "重新生成报告" }));
    expect(screen.getByRole("dialog")).toHaveTextContent("是否重新生成？");
  });

  it("reloads a preserved report after an observing stream receives the regeneration failure", async () => {
    const partial: DigitalInterviewWorkflowView = { ...completed, currentStep: "report", status: "report_pending",
      reportGeneration: { reportId: "r-observed", requestId: "req-observed", status: "running", title: "新报告", executiveSummary: null,
        markdown: "未完成的新正文", findings: [], errorCode: null, updatedAt: "2026-09-01T02:02:00.000Z" } };
    const restored: DigitalInterviewWorkflowView = { ...partial, status: "completed", version: 14,
      report: { reportId: "r-observed", title: "观察连接恢复的旧报告", executiveSummary: "旧摘要", markdown: "恢复的旧正文", findings: [], generatedAt: "2026-09-01T02:01:00.000Z" },
      reportGeneration: { ...partial.reportGeneration!, status: "failed", errorCode: "AI_GENERATION_UNAVAILABLE" } };
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => String(input).endsWith("/report/stream")
      ? new Response(`${JSON.stringify({ type: "snapshot", seq: 0, ...partial.reportGeneration })}\n${JSON.stringify({ type: "error", seq: 1, reasonCode: "AI_GENERATION_UNAVAILABLE" })}\n`, { headers: { "content-type": "application/x-ndjson" } })
      : new Response(JSON.stringify(restored), { headers: { "content-type": "application/json" } })));
    render(<PersistentDigitalInterviewWorkflow initialView={partial} />);
    expect(await screen.findByTestId("itv-report-markdown")).toHaveTextContent("恢复的旧正文");
    expect(await screen.findByText("报告重新生成失败，已保留上一份报告。请重试。" )).toBeInTheDocument();
  });

  it("reconstructs the report from append-only chunks and then loads the final state once", async () => {
    const streaming = { ...completed, status: "report_pending" as const, currentStep: "report" as const, version: 13,
      reportGeneration: { reportId: "report-f06", requestId: "request-f06", status: "running" as const,
        title: "江西足球访谈报告", executiveSummary: "基层体系需要协同。", markdown: "## 基层体系",
        findings: [], errorCode: null, updatedAt: "2026-09-01T02:00:30.000Z" } };
    const final = { ...streaming, status: "completed" as const, version: 14, reportGeneration: null,
      reportId: "report-f06", report: { reportId: "report-f06", title: "江西足球访谈报告",
        executiveSummary: "基层体系需要教练与赛事协同。", markdown: "# 江西足球访谈报告\n\n## 基层体系\n\n- 培养教练\n- 连接赛事\n\n<script>alert('xss')</script>",
        findings: [{ findingId: "finding-f06", title: "基层优先", summary: "先培养教练。", expertId: "expert-f06",
          questionId: "question-f06", sourceAnswerId: "expert-f06:question-f06", exploratory: true as const }],
        generatedAt: "2026-09-01T02:01:00.000Z" } };
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method !== "POST") {
        return new Response(JSON.stringify(final), { status: 200, headers: { "content-type": "application/json" } });
      }
      expect(JSON.parse(String(init.body))).toMatchObject({ expectedVersion: 12, requestId: expect.any(String) });
      const encoder = new TextEncoder();
      return new Response(new ReadableStream({ start(controller) {
        const generation = streaming.reportGeneration!;
        controller.enqueue(encoder.encode(`${JSON.stringify({ type: "snapshot", seq: 0, ...generation, markdown: "", findings: [] })}\n`));
        controller.enqueue(encoder.encode(`${JSON.stringify({ type: "section", seq: 1, markdown: generation.markdown })}\n`));
        controller.enqueue(encoder.encode(`${JSON.stringify({ type: "finding", seq: 2, finding: final.report!.findings[0] })}\n`));
        window.setTimeout(() => { controller.enqueue(encoder.encode(`${JSON.stringify({ type: "complete", seq: 3, reportId: "report-f06", version: 14 })}\n`)); controller.close(); }, 100);
      } }), { status: 200, headers: { "content-type": "application/x-ndjson" } });
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<PersistentDigitalInterviewWorkflow initialView={completed} />);
    const button = screen.getByTestId("itv-confirm-answers-generate-report");
    expect(button).toBeEnabled();
    fireEvent.click(button);
    expect(await screen.findByTestId("itv-report")).toHaveTextContent("江西足球访谈报告");
    expect(screen.getByTestId("itv-report-markdown")).toHaveTextContent("基层体系");
    expect(screen.getByTestId("itv-report-markdown").querySelector("h1")).toBeNull();
    expect(screen.getByTestId("itv-report-markdown").querySelector("h2")).toBeNull();
    // Generated `##` headings render two levels lower than markdown's h2 so they nest under the
    // report's h2 title and the "研究发现" h3 section wrapper (see interview-report-markdown.tsx).
    expect(screen.getByTestId("itv-report-markdown").querySelector("h4")).toHaveTextContent("基层体系");
    expect(screen.getByTestId("itv-report-markdown").querySelectorAll("li")).toHaveLength(2);
    expect(screen.getByTestId("itv-report-markdown").querySelector("script")).toBeNull();
    expect(screen.getByTestId("itv-report-markdown").querySelector("pre")).toBeNull();

    fireEvent.click(screen.getByTestId("itv-report-export-word"));
    fireEvent.click(screen.getByTestId("itv-report-export-pdf"));
    expect(exportWord).toHaveBeenCalledWith(final.report, { evidenceMode: completed.studyEvidenceMode, review: completed.reportEvidenceEligibility });
    expect(exportPdf).toHaveBeenCalledWith("itv-report-print-root");
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  });

  it("reconnects from a persisted running generation after refresh", async () => {
    const recovered = { ...completed, status: "report_pending" as const, currentStep: "report" as const, version: 13,
      reportGeneration: { reportId: "report-f06", requestId: "request-f06", status: "running" as const,
        title: "恢复中的报告", executiveSummary: null, markdown: "## 已持久化段落", findings: [], errorCode: null,
        updatedAt: "2026-09-01T02:00:30.000Z" } };
    const final = { ...recovered, status: "completed" as const, reportGeneration: null, reportId: "report-f06",
      report: { reportId: "report-f06", title: "恢复中的报告", executiveSummary: "已恢复。",
        markdown: "## 已持久化段落\n\n## 追加段落", findings: [], generatedAt: "2026-09-01T02:01:00.000Z" } };
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).endsWith("/report/stream")) {
        const generation = recovered.reportGeneration!;
        return new Response([
          JSON.stringify({ type: "snapshot", seq: 0, ...generation }),
          JSON.stringify({ type: "section", seq: 1, markdown: "\n\n## 追加段落" }),
          JSON.stringify({ type: "complete", seq: 2, reportId: "report-f06", version: 14 }),
        ].join("\n") + "\n", { status: 200, headers: { "content-type": "application/x-ndjson" } });
      }
      return new Response(JSON.stringify(final), { status: 200, headers: { "content-type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<PersistentDigitalInterviewWorkflow initialView={recovered} />);
    expect(await screen.findByTestId("itv-report-stream-markdown")).toHaveTextContent("已持久化段落");
    expect(await screen.findByTestId("itv-report")).toHaveTextContent("追加段落");
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
          controller.enqueue(encoder.encode(`${JSON.stringify({ type: "snapshot", seq: 0, ...streaming.reportGeneration })}\n`));
          window.setTimeout(() => controller.error(new TypeError("network error")), 10);
        } }), { status: 200, headers: { "content-type": "application/x-ndjson" } });
      }
      if (url.endsWith(`/interviews/digital/${completed.interviewId}`)) {
        const fullReads = fetchMock.mock.calls.filter(([requested]) => String(requested).endsWith(`/interviews/digital/${completed.interviewId}`)).length;
        return new Response(JSON.stringify(fullReads === 1 ? streaming : final), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (url.endsWith(`/interviews/digital/${completed.interviewId}/report/stream`)) {
        return new Response(`${JSON.stringify({ type: "snapshot", seq: 0, ...streaming.reportGeneration })}\n${JSON.stringify({ type: "complete", seq: 1, reportId: "report-reconnect", version: 14 })}\n`, {
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
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));
  });
});
