import * as React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { DigitalInterviewWorkflowView } from "@/lib/interview-api";
import { InterviewMarkdownWorkbench } from "@/components/itv/interview-markdown-workbench";
const { push, load, branch } = vi.hoisted(() => ({ push: vi.fn(), load: vi.fn(), branch: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("@/lib/interview-markdown-api", () => ({ loadInterviewMarkdown: load, branchInterviewMarkdown: branch }));
vi.mock("@/components/itv/interview-markdown-planning-step", () => ({ InterviewMarkdownPlanningStep: ({ onDirtyChange }: { onDirtyChange: (dirty: boolean) => void }) => <button onClick={() => onDirtyChange(true)}>修改原文</button> }));
vi.mock("@/components/itv/interview-markdown-editing-step", () => ({ InterviewMarkdownEditingStep: () => <div /> }));
vi.mock("@/components/itv/interview-markdown-results-step", () => ({ InterviewMarkdownResultsStep: () => <div /> }));
const identity: DigitalInterviewWorkflowView = {
  interviewId: "itv-route-7", name: "原文访谈", tags: [], topic: "旧 JSON 正文不得显示", status: "topic_pending", sourceQuickInterviewId: null,
  selectedExpertIds: [], reportId: null, version: 1, scope: { kind: "none", projectId: null, researchProjectId: null }, currentStep: "topic",
  revisionId: "revision-route-7", topicVersionId: null, expertSnapshotVersionId: null, questionVersionId: null, expertCandidates: [], questions: [], questionCandidates: [],
  skillThreadId: "thread-route-7", skillMessages: [], skillProposals: [], expertRuns: [], artifacts: [], studyEvidenceMode: "simulated",
  reportEvidenceEligibility: { eligibility: "blocked_missing_participant_evidence", message: "需要真实证据", action: "复核证据" },
  researchBrief: null, moderatorPolicy: null, reportReview: null,
  quality: { previewStatus: "unavailable", briefIssues: [], expertCoverage: [], questionFindings: [], readiness: null, readinessDecision: null, evidenceCoverage: [] },
};
beforeEach(() => { push.mockReset(); branch.mockReset(); load.mockResolvedValue({ documents: [], states: [] }); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
it("each named workbench stage navigates to its own canonical route without rendering legacy body", () => {
  render(<InterviewMarkdownWorkbench identity={identity} step="intake" />);
  for (const [step, label] of [["intake", "导入需求"], ["analysis", "确认分析"], ["experts", "选择专家"], ["outline", "访谈问题"], ["runs", "开始访谈"], ["report", "生成报告"]]) {
    fireEvent.click(screen.getByRole("button", { name: new RegExp(label!) }));
    expect(push).toHaveBeenLastCalledWith(`/itv/itv-route-7/${step}`);
  }
  expect(push).toHaveBeenCalledTimes(6);
  expect(screen.queryByText("旧 JSON 正文不得显示")).not.toBeInTheDocument();
});
it("refusing the dirty Markdown warning blocks both stage and list navigation", () => {
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
  render(<InterviewMarkdownWorkbench identity={identity} step="intake" />);
  fireEvent.click(screen.getByRole("button", { name: "修改原文" }));
  fireEvent.click(screen.getByTestId("itv-workbench-step-experts"));
  fireEvent.click(screen.getByRole("button", { name: "返回访谈列表" }));
  expect(confirm).toHaveBeenCalledTimes(2);
  expect(push).not.toHaveBeenCalled();
});
it("creates a new revision with the freshly read aggregate version, preserving the old confirmed document", async () => {
  const confirmed = { version: 8, revisionId: "old-rev", documents: [{ documentId: "intake-old", step: "intake", markdown: "# 原文" }], states: [{ documentId: "intake-old", status: "confirmed" }] };
  load.mockResolvedValue(confirmed);
  branch.mockResolvedValue({ ...confirmed, version: 9, revisionId: "new-rev", states: [{ documentId: "intake-old", status: "draft" }] });
  vi.spyOn(window, "confirm").mockReturnValue(true);
  render(<InterviewMarkdownWorkbench identity={identity} step="intake" />);
  fireEvent.click(await screen.findByRole("button", { name: "创建新修订并修改" }));
  await waitFor(() => expect(branch).toHaveBeenCalledWith("itv-route-7", { expectedVersion: 8, fromStep: "intake" }));
  expect(confirmed.documents[0]?.markdown).toBe("# 原文");
  expect(push).not.toHaveBeenCalled();
});
