import * as React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { DigitalInterviewWorkflowView } from "@/lib/interview-api";
import { InterviewMarkdownWorkbench } from "@/components/itv/interview-markdown-workbench";
import { InterviewCompletionProvider } from "@/components/itv/interview-completion-provider";
import { InterviewStepHeader, InterviewStepActions } from "@/components/itv/interview-step-header";
const { push, load, branch, sessionState } = vi.hoisted(() => ({ push: vi.fn(), load: vi.fn(), branch: vi.fn(), sessionState: { status: "authenticated", session: { userId: "actor-a", currentOrgId: "org-a", sessionToken: "fixture-a" } } }));
vi.mock("@/components/session/session-provider", () => ({ useOptionalSession: () => sessionState }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("@/lib/interview-markdown-api", () => ({ loadInterviewMarkdown: load, branchInterviewMarkdown: branch }));
vi.mock("@/components/itv/interview-markdown-planning-step", () => ({ InterviewMarkdownPlanningStep: ({ onDirtyChange, onRunningStepChange }: { onDirtyChange: (dirty: boolean) => void; onRunningStepChange: (step: string | null) => void }) => <><InterviewStepHeader title="导入需求" /><button onClick={() => onDirtyChange(true)}>修改原文</button><button onClick={() => onRunningStepChange("analysis")}>开始处理</button><InterviewStepActions/></> }));
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
beforeEach(() => { sessionState.session = { userId: "actor-a", currentOrgId: "org-a", sessionToken: "fixture-a" }; push.mockReset(); branch.mockReset(); load.mockResolvedValue({ documents: [], states: [] }); });
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

it("blocks revision creation while generation is active", async () => {
  load.mockResolvedValue({ documents: [{ documentId: "intake-old", step: "intake" }], states: [{ documentId: "intake-old", status: "confirmed" }] });
  render(<InterviewMarkdownWorkbench identity={identity} step="intake" />);
  const revise = await screen.findByRole("button", { name: "创建新修订并修改" });
  fireEvent.click(screen.getByRole("button", { name: "开始处理" }));
  expect(revise).toBeDisabled();
  fireEvent.click(revise);
  expect(branch).not.toHaveBeenCalled();
});

it("does not render unknown completion as upcoming while the canonical source is delayed", async () => {
 let resolve!: (source: {documents: {documentId:string;step:string}[];states:{documentId:string;status:string}[]}) => void;
 load.mockReturnValue(new Promise(done => {resolve=done;}));
 render(<InterviewMarkdownWorkbench identity={identity} step="runs"/>);
 expect(screen.getByTestId("itv-workbench-step-intake")).toHaveAttribute("data-state","unknown");
 resolve({documents:[{documentId:"saved",step:"intake"}],states:[{documentId:"saved",status:"confirmed"}]});
 await waitFor(()=>expect(screen.getByTestId("itv-workbench-step-intake")).toHaveAttribute("data-state","completed"));
});
it("offers retry when canonical completion cannot be loaded", async () => {
 load.mockRejectedValueOnce(new Error("offline"));
 render(<InterviewMarkdownWorkbench identity={identity} step="runs"/>);
 expect(await screen.findByRole("button",{name:"重试步骤状态"})).toBeEnabled();
 expect(screen.getByTestId("itv-workbench-step-intake")).toHaveAttribute("data-state","unknown");
 load.mockResolvedValue({documents:[{documentId:"saved",step:"intake"}],states:[{documentId:"saved",status:"confirmed"}]});
 fireEvent.click(screen.getByRole("button",{name:"重试步骤状态"}));
 await waitFor(()=>expect(screen.getByTestId("itv-workbench-step-intake")).toHaveAttribute("data-state","completed"));
});

it("retains canonical completion across stage remounts within the route provider", async () => {
 load.mockResolvedValue({version:8,documents:[{documentId:"saved",step:"intake"}],states:[{documentId:"saved",status:"confirmed"}]});
 const view = render(<InterviewCompletionProvider><InterviewMarkdownWorkbench key="intake" identity={identity} step="intake"/></InterviewCompletionProvider>);
 await waitFor(()=>expect(screen.getByTestId("itv-workbench-step-intake")).toHaveAttribute("data-state","current"));
 await screen.findByRole("button",{name:"创建新修订并修改"});
 load.mockReturnValue(new Promise(()=>{}));
 view.rerender(<InterviewCompletionProvider><InterviewMarkdownWorkbench key="runs" identity={identity} step="runs"/></InterviewCompletionProvider>);
 expect(screen.getByTestId("itv-workbench-step-intake")).toHaveAttribute("data-state","completed");
});
it("does not reuse completion for another interview or changed actor scope", async () => {
 load.mockResolvedValue({version:8,documents:[{documentId:"saved",step:"intake"}],states:[{documentId:"saved",status:"confirmed"}]});
 const view = render(<InterviewCompletionProvider><InterviewMarkdownWorkbench key="initial" identity={identity} step="intake"/></InterviewCompletionProvider>);
 await screen.findByRole("button",{name:"创建新修订并修改"});
 load.mockReturnValue(new Promise(()=>{}));
 view.rerender(<InterviewCompletionProvider><InterviewMarkdownWorkbench key="other" identity={{...identity,interviewId:"other-interview"}} step="runs"/></InterviewCompletionProvider>);
 expect(screen.getByTestId("itv-workbench-step-intake")).toHaveAttribute("data-state","unknown");
 sessionState.session = {userId:"actor-b",currentOrgId:"org-b",sessionToken:"fixture-b"};
 view.rerender(<InterviewCompletionProvider><InterviewMarkdownWorkbench key="actor" identity={identity} step="runs"/></InterviewCompletionProvider>);
 expect(screen.getByTestId("itv-workbench-step-intake")).toHaveAttribute("data-state","unknown");
});
it("applies the branched canonical state immediately without retaining downstream completion", async () => {
 const confirmed = {version:8,documents:[{documentId:"saved",step:"intake"},{documentId:"report",step:"report"}],states:[{documentId:"saved",status:"confirmed"},{documentId:"report",status:"completed"}]};
 load.mockResolvedValue(confirmed);
 branch.mockResolvedValue({...confirmed,version:9,states:[]});
 vi.spyOn(window,"confirm").mockReturnValue(true);
 render(<InterviewCompletionProvider><InterviewMarkdownWorkbench identity={identity} step="intake"/></InterviewCompletionProvider>);
 fireEvent.click(await screen.findByRole("button",{name:"创建新修订并修改"}));
 load.mockReturnValue(new Promise(()=>{}));
 await waitFor(()=>expect(screen.getByTestId("itv-workbench-step-report")).toHaveAttribute("data-state","upcoming"));
});
