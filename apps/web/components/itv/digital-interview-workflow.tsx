"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, CheckCircle2, Download, Eye, FileText, FileUp, Lightbulb, ListChecks, MessageSquareText, Plus, Play, Sparkles, Trash2, UsersRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  appendDigitalInterviewSkillMessage,
  applyDigitalInterviewSkillProposal,
  confirmDigitalInterviewExperts,
  confirmDigitalInterviewQuestions,
  confirmDigitalInterviewTopic,
  generateDigitalInterviewReportStream,
  loadDigitalInterviewWorkflow,
  observeDigitalInterviewReportStream,
  rejectDigitalInterviewSkillProposal,
  type DigitalInterviewQuestion,
  type DigitalInterviewModeratorPolicy,
  type DigitalInterviewResearchBrief,
  type DigitalInterviewStep,
  type DigitalInterviewWorkflowView,
  type DigitalExpertCatalogRow,
  type DigitalInterviewSkillDraftContext,
} from "@/lib/interview-api";
import { MOCK_DIGITAL_EXPERTS, findMockDigitalExpert, toDigitalExpertCatalogRow } from "@/lib/mock/digital-expert-personas";
import { ExpertPickerDialog } from "./expert-picker-dialog";
import { InterviewSkillAssistant, PersistentInterviewSkillAssistant } from "./interview-skill-assistant";
import { InterviewReportMarkdown } from "./interview-report-markdown";
import { DigitalInterviewResearchBriefEditor } from "./digital-interview-research-brief";
import { evidenceModeLabel, exportInterviewReportPdf, exportInterviewReportWord, reportMarkdownBody } from "@/lib/interview-report-export";
import { reconcileMockInterviewQuestions, updateMockDigitalInterviewDraft, type MockDigitalInterviewDraft, type MockInterviewStep, type MockSkillSuggestion } from "@/lib/mock/digital-interview-drafts";

const STEPS = ["主题", "专家", "问题", "访谈", "报告"] as const;

const DEFAULT_MODERATOR_POLICY: DigitalInterviewModeratorPolicy = {
  probingDepth: "balanced", clarifyAmbiguity: true, seekCounterexamples: true,
  redirectOffTopic: true, stopWhenGoalSatisfied: true, maxFollowUpsPerQuestion: 2,
};

export function DigitalInterviewWorkflow({ initialDraft }: { initialDraft: MockDigitalInterviewDraft }) {
  const [draft, setDraft] = React.useState(initialDraft);
  const persist = React.useCallback((updater: (current: MockDigitalInterviewDraft) => MockDigitalInterviewDraft) => setDraft(updateMockDigitalInterviewDraft(initialDraft.interviewId, updater)), [initialDraft.interviewId]);

  function confirmTopic() {
    if (!draft.topic.trim()) return;
    persist((current) => ({ ...current, currentStep: 2, selectedExpertIds: current.selectedExpertIds.length ? current.selectedExpertIds : MOCK_DIGITAL_EXPERTS.slice(0, 3).map((expert) => expert.expertId) }));
  }
  function confirmExperts() {
    persist((current) => ({
      ...current,
      currentStep: 3,
      questions: reconcileMockInterviewQuestions(current.selectedExpertIds, current.questions, current.removedGeneratedQuestionIds),
    }));
  }
  function updateQuestion(questionId: string, text: string) { persist((current) => ({ ...current, questions: current.questions.map((question) => question.questionId === questionId ? { ...question, text } : question) })); }
  function addQuestion(expertId: string) { persist((current) => ({ ...current, questions: [...current.questions, { questionId: `manual-${crypto.randomUUID()}`, expertId, text: "", origin: "manual", purpose: "手动问题" }] })); }
  function deleteQuestion(questionId: string) { persist((current) => { const target = current.questions.find((question) => question.questionId === questionId); return { ...current, questions: current.questions.filter((question) => question.questionId !== questionId), removedGeneratedQuestionIds: target?.origin === "generated" ? Array.from(new Set([...current.removedGeneratedQuestionIds, questionId])) : current.removedGeneratedQuestionIds }; }); }
  function applySuggestion() {
    if (!draft.pendingSuggestion || draft.pendingSuggestion.applied) return;
    persist((current) => {
      const snapshot = { topic: current.topic, selectedExpertIds: current.selectedExpertIds, questions: current.questions, reportMarkdown: current.reportMarkdown };
      const suggestion = current.pendingSuggestion!;
      if (suggestion.target === "topic") return { ...current, topic: suggestion.text.replace(/^建议主题：/, ""), pendingSuggestion: { ...suggestion, applied: true }, undoSnapshot: snapshot };
      if (suggestion.target === "experts") return { ...current, selectedExpertIds: Array.from(new Set([...current.selectedExpertIds, ...MOCK_DIGITAL_EXPERTS.slice(0, 3).map((expert) => expert.expertId)])), pendingSuggestion: { ...suggestion, applied: true }, undoSnapshot: snapshot };
      if (suggestion.target === "questions") return { ...current, questions: current.questions.map((question) => ({ ...question, text: `${question.text} 请举一个反例。` })), pendingSuggestion: { ...suggestion, applied: true }, undoSnapshot: snapshot };
      return { ...current, reportMarkdown: reportFor(current, true), pendingSuggestion: { ...suggestion, applied: true }, undoSnapshot: snapshot };
    });
  }

  return <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
    <InterviewSkillAssistant draft={draft} onSend={(text, suggestion) => persist((current) => ({ ...current, skillMessages: [...current.skillMessages, { id: `skill-${crypto.randomUUID()}`, role: "user", text }, { id: `skill-${crypto.randomUUID()}`, role: "assistant", text: "我已根据当前访谈内容整理了一条可应用建议。" }], pendingSuggestion: suggestion }))} onApply={applySuggestion} onUndo={() => persist((current) => current.undoSnapshot ? { ...current, ...current.undoSnapshot, undoSnapshot: null, pendingSuggestion: null } : current)} />
    <main className="min-w-0 flex-1 overflow-y-auto bg-background p-6 lg:p-10">
      <div className="mx-auto max-w-5xl">
        <header className="flex items-start justify-between gap-4"><div><p className="text-xs text-primary">Mock 批量访谈流程</p><h1 className="mt-2 text-3xl font-semibold">{draft.name}</h1><div className="mt-3 flex flex-wrap gap-2">{draft.tags.map((tag) => <span key={tag} className="rounded-md bg-muted px-2 py-1 text-xs text-muted-foreground">{tag}</span>)}</div></div><Link href="/itv?tab=history" className="inline-flex shrink-0 items-center gap-2 rounded-lg border border-border bg-background px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted"><ArrowLeft className="size-4" aria-hidden />返回访谈列表</Link></header>
        <ol className="mt-7 grid gap-2 sm:grid-cols-5">{STEPS.map((label, index) => { const step = (index + 1) as MockInterviewStep; return <li key={label}><button data-testid={`itv-workflow-step-${step}`} type="button" aria-current={draft.currentStep === step ? "step" : undefined} onClick={() => persist((current) => ({ ...current, currentStep: step }))} className={draft.currentStep === step ? "w-full rounded-lg bg-primary p-3 text-left text-xs font-medium text-primary-foreground" : "w-full rounded-lg border border-border p-3 text-left text-xs text-muted-foreground"}>0{step} {label}</button></li>; })}</ol>
        <section className="mt-8 rounded-2xl border border-border bg-card p-6 shadow-sm lg:p-8">
          {draft.currentStep === 1 && <TopicStep draft={draft} onChange={(topic) => persist((current) => ({ ...current, topic }))} onConfirm={confirmTopic} />}
          {draft.currentStep === 2 && <ExpertStep draft={draft} onRemove={(expertId) => persist((current) => ({ ...current, selectedExpertIds: current.selectedExpertIds.filter((id) => id !== expertId) }))} onAdd={(expertIds) => persist((current) => ({ ...current, selectedExpertIds: Array.from(new Set(expertIds)) }))} onConfirm={confirmExperts} />}
          {draft.currentStep === 3 && <QuestionStep draft={draft} onChange={updateQuestion} onAdd={addQuestion} onDelete={deleteQuestion} onConfirm={() => persist((current) => ({ ...current, currentStep: 4 }))} />}
          {draft.currentStep === 4 && <RunStep draft={draft} onRun={() => persist((current) => ({ ...current, currentStep: 5, reportMarkdown: reportFor(current, false) }))} />}
          {draft.currentStep === 5 && <ReportStep draft={draft} />}
        </section>
      </div>
    </main>
  </div>;
}

function TopicStep({ draft, onChange, onConfirm }: { draft: MockDigitalInterviewDraft; onChange: (topic: string) => void; onConfirm: () => void }) { return <div><h2 className="text-xl font-semibold">确认访谈主题</h2><textarea data-testid="itv-topic-input" value={draft.topic} onChange={(event) => onChange(event.target.value)} placeholder="用一句业务问题说明需要验证什么" className="mt-5 min-h-40 w-full rounded-lg border border-input bg-background p-3" /><Button data-testid="itv-confirm-topic" className="mt-5" variant="primary" size="lg" disabled={!draft.topic.trim()} onClick={onConfirm}>确认主题并生成专家</Button></div>; }
function ExpertStep({ draft, onRemove, onAdd, onConfirm }: { draft: MockDigitalInterviewDraft; onRemove: (id: string) => void; onAdd: (ids: readonly string[]) => void; onConfirm: () => void }) {
  const [pickerOpen, setPickerOpen] = React.useState(false);
  return <div><h2 className="text-xl font-semibold">确认访谈专家</h2><p className="mt-2 text-sm text-muted-foreground">审核系统推荐的专家，也可以从完整目录添加互补角色。</p><div className="mt-5 grid gap-3">{draft.selectedExpertIds.map((id) => { const expert = findMockDigitalExpert(id); return <article data-testid="itv-selected-expert" key={id} className="flex items-center justify-between rounded-lg border border-border p-4"><div><strong>{expert?.displayName}</strong><p className="text-xs text-muted-foreground">{expert?.role} · Mock 专家</p></div><button type="button" aria-label={`删除专家 ${expert?.displayName}`} onClick={() => onRemove(id)} disabled={draft.selectedExpertIds.length <= 1} className="rounded-md p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:bg-disabled disabled:text-disabled-foreground"><Trash2 className="size-4" aria-hidden /></button></article>; })}</div><div className="mt-5 flex flex-wrap gap-3"><Button data-testid="itv-add-expert" type="button" variant="outline" onClick={() => setPickerOpen(true)}><Plus className="size-4" aria-hidden />添加专家</Button><Button data-testid="itv-confirm-experts" type="button" variant="primary" disabled={!draft.selectedExpertIds.length} onClick={onConfirm}>确认并生成问题</Button></div><ExpertPickerDialog open={pickerOpen} selectedExpertIds={draft.selectedExpertIds} onOpenChange={setPickerOpen} onConfirm={onAdd} /></div>;
}
function QuestionStep({ draft, onChange, onAdd, onDelete, onConfirm }: { draft: MockDigitalInterviewDraft; onChange: (questionId: string, text: string) => void; onAdd: (expertId: string) => void; onDelete: (questionId: string) => void; onConfirm: () => void }) {
  return <div><h2 className="text-xl font-semibold">确认针对性问题</h2><p className="mt-2 text-sm text-muted-foreground">每位专家默认 3 个问题，你可以逐条编辑、删除并继续补充追问。</p><div className="mt-4 space-y-4">{draft.selectedExpertIds.map((expertId) => { const expert = findMockDigitalExpert(expertId); const questions = draft.questions.filter((question) => question.expertId === expertId); return <section data-testid="itv-question-group" key={expertId} className="rounded-xl border border-border p-4"><header className="flex items-baseline gap-2"><h3 className="font-semibold">{expert?.displayName}</h3><p className="text-xs text-muted-foreground">{expert?.role} · {questions.length} 个问题</p></header><div className="mt-3 space-y-3">{questions.map((question, index) => <div key={question.questionId} className="rounded-lg bg-muted/35 p-3"><div className="mb-1.5 flex items-center justify-between gap-3"><label htmlFor={question.questionId} className="text-xs font-medium">问题 {index + 1} · {question.purpose}</label><button data-testid="itv-delete-question" type="button" aria-label={`删除${expert?.displayName}的问题 ${index + 1}`} onClick={() => onDelete(question.questionId)} className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"><Trash2 className="size-4" aria-hidden /></button></div><textarea rows={2} id={question.questionId} data-testid="itv-question-input" value={question.text} onChange={(event) => onChange(question.questionId, event.target.value)} placeholder="输入针对这位专家的问题" className="w-full resize-y rounded-lg border border-input bg-background px-3 py-2 text-sm leading-5" /></div>)}</div><Button data-testid="itv-add-question" type="button" variant="outline" size="sm" className="mt-3" onClick={() => onAdd(expertId)}><Plus className="size-4" aria-hidden />添加问题</Button></section>; })}</div><Button data-testid="itv-confirm-questions" className="mt-5" variant="primary" disabled={!draft.questions.length || draft.questions.some((question) => !question.text.trim())} onClick={onConfirm}>确认问题并进入访谈</Button></div>;
}
function RunStep({ draft, onRun }: { draft: MockDigitalInterviewDraft; onRun: () => void }) { return <div><h2 className="text-xl font-semibold">执行 Mock 访谈</h2><p className="mt-2 text-sm text-muted-foreground">将为 {draft.selectedExpertIds.length} 位数字专家生成探索性回答。</p><div className="mt-5 grid gap-3">{draft.selectedExpertIds.map((id) => <div key={id} className="flex items-center justify-between rounded-lg border border-border p-4"><span>{findMockDigitalExpert(id)?.displayName}</span><span className="text-xs text-muted-foreground">等待开始</span></div>)}</div><Button data-testid="itv-run-all" className="mt-5" variant="primary" onClick={onRun}><Play className="size-4" aria-hidden />开始全部访谈</Button></div>; }
function ReportStep({ draft }: { draft: MockDigitalInterviewDraft }) { const report = draft.reportMarkdown || reportFor(draft, false); return <div><h2 className="text-xl font-semibold">访谈报告</h2><div className="mt-3 rounded-lg border border-primary/20 bg-primary/5 p-3 text-xs text-muted-foreground">Mock 探索性报告，不作为真实证据</div><InterviewReportMarkdown markdown={report} testId="itv-report-markdown" /><ol data-testid="itv-report-timeline" className="mt-6 border-l border-border pl-5 text-sm"><li><CheckCircle2 className="mr-2 inline size-4 text-primary" aria-hidden />主题与专家已确认</li><li className="mt-3"><CheckCircle2 className="mr-2 inline size-4 text-primary" aria-hidden />Mock 访谈已完成</li><li className="mt-3"><CheckCircle2 className="mr-2 inline size-4 text-primary" aria-hidden />报告已生成</li></ol></div>; }
function reportFor(draft: MockDigitalInterviewDraft, structured: boolean): string { return `# ${draft.name}\n\n> Mock 探索性内容，不作为真实证据。\n\n## ${structured ? "报告摘要" : "关键发现"}\n\n围绕“${draft.topic || draft.name}”，数字专家给出了角色、否决条件与待验证假设。\n\n## 待验证假设\n\n- 决策权与预算责任可能并不属于同一角色。\n- 需要用真实访谈补充反例与来源。`; }

const LIVE_STEPS: readonly { readonly id: DigitalInterviewStep; readonly label: string }[] = [
  { id: "topic", label: "主题" }, { id: "experts", label: "专家" }, { id: "questions", label: "问题" }, { id: "runs", label: "访谈" }, { id: "report", label: "报告" },
];

type WorkbenchStep = "intake" | "analysis" | "experts" | "outline" | "runs" | "report";

const WORKBENCH_STEPS: readonly { readonly id: WorkbenchStep; readonly label: string; readonly detail: string; readonly liveStep: DigitalInterviewStep }[] = [
  { id: "intake", label: "导入需求", detail: "明确研究问题与材料边界", liveStep: "topic" },
  { id: "analysis", label: "确认分析", detail: "校准目标、对象与预期产出", liveStep: "experts" },
  { id: "experts", label: "选择专家", detail: "组合互补的访谈视角", liveStep: "experts" },
  { id: "outline", label: "专家提纲", detail: "逐位确认问题与追问", liveStep: "questions" },
  { id: "runs", label: "开始访谈", detail: "执行并保留可追溯回答", liveStep: "runs" },
  { id: "report", label: "汇总报告", detail: "输出洞察、边界与行动", liveStep: "report" },
];

function workbenchStepFor(step: DigitalInterviewStep): WorkbenchStep {
  if (step === "topic") return "intake";
  if (step === "experts") return "experts";
  if (step === "questions") return "outline";
  return step;
}

type LiveBuffers = { readonly topic: string; readonly researchBrief: DigitalInterviewResearchBrief; readonly expertIds: readonly string[]; readonly questions: readonly DigitalInterviewQuestion[] };
type PendingNavigation = { readonly step?: DigitalInterviewStep; readonly href?: string } | null;

function buffersFrom(view: DigitalInterviewWorkflowView): LiveBuffers {
  return {
    topic: view.topic ?? "",
    researchBrief: view.researchBrief ?? { decision: view.topic ?? view.name, learningGoals: [{ goalId: "goal-1", statement: view.topic ?? view.name }], targetRoles: ["目标用户"], outOfScope: [], successCriteria: ["形成可追溯的决策依据"] },
    expertIds: view.selectedExpertIds.length ? view.selectedExpertIds : view.expertCandidates.map((expert) => expert.expertId),
    questions: view.questions.length ? view.questions : view.questionCandidates,
  };
}

/** Live workflow deliberately has no persistence side effects on input events. */
export function PersistentDigitalInterviewWorkflow({ initialView }: { readonly initialView: DigitalInterviewWorkflowView }) {
  const router = useRouter();
  const [view, setView] = React.useState(initialView);
  const [activeStep, setActiveStep] = React.useState<DigitalInterviewStep>(initialView.currentStep);
  const [activeWorkbenchStep, setActiveWorkbenchStep] = React.useState<WorkbenchStep>(() => workbenchStepFor(initialView.currentStep));
  const [buffers, setBuffers] = React.useState<LiveBuffers>(() => buffersFrom(initialView));
  const [dirty, setDirty] = React.useState(false);
  const [error, setError] = React.useState("");
  const [pendingNavigation, setPendingNavigation] = React.useState<PendingNavigation>(null);
  const [reportPending, setReportPending] = React.useState(initialView.reportGeneration?.status === "running");
  const [regeneration, setRegeneration] = React.useState(false);
  const requestIds = React.useRef(new Map<string, { readonly fingerprint: string; readonly requestId: string }>());
  const localReportStream = React.useRef(false);
  const latestView = React.useRef(view);
  latestView.current = view;

  React.useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (!dirty) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  React.useEffect(() => {
    if (view.currentStep !== "runs" || !view.expertRuns.some((run) => run.status === "running")) return;
    const timer = window.setInterval(() => {
      void loadDigitalInterviewWorkflow(view.interviewId).then((next) => {
        setView(next);
        setError("");
      }, showError);
    }, 1500);
    return () => window.clearInterval(timer);
  }, [view.currentStep, view.expertRuns, view.interviewId]);

  const reportRunning = view.reportGeneration?.status === "running";
  React.useEffect(() => {
    if (!reportRunning || localReportStream.current) return;
    const controller = new AbortController();
    setReportPending(true);
    void observeDigitalInterviewReportStream(
      view.interviewId,
      latestView.current,
      (next) => { setView(next); setError(""); },
      controller.signal,
    ).catch((cause) => {
      if (!controller.signal.aborted) showError(cause);
    }).finally(() => {
      if (!controller.signal.aborted) setReportPending(false);
    });
    return () => controller.abort();
  }, [reportRunning, view.interviewId]);

  function requestIdFor(operation: string, payload: unknown): string {
    const fingerprint = JSON.stringify(payload);
    const existing = requestIds.current.get(operation);
    if (existing?.fingerprint === fingerprint) return existing.requestId;
    const requestId = crypto.randomUUID();
    requestIds.current.set(operation, { fingerprint, requestId });
    return requestId;
  }

  function replaceAfterConfirmation(next: DigitalInterviewWorkflowView, operation: string) {
    requestIds.current.delete(operation);
    setView(next);
    setActiveStep(next.currentStep);
    setActiveWorkbenchStep(workbenchStepFor(next.currentStep));
    setBuffers(buffersFrom(next));
    setDirty(false);
    setError("");
  }

  function retainView(next: DigitalInterviewWorkflowView, operation: string) {
    requestIds.current.delete(operation);
    setView(next);
    setError("");
  }

  function showError(cause: unknown) {
    const reason = typeof cause === "object" && cause !== null && "reasonCode" in cause && typeof cause.reasonCode === "string"
      ? cause.reasonCode
      : cause instanceof Error ? cause.message : "DEPENDENCY_UNAVAILABLE";
    setError(reason);
  }

  function requestNavigation(next: PendingNavigation) {
    if (dirty) {
      setPendingNavigation(next);
      return;
    }
    navigate(next);
  }

  function navigate(next: PendingNavigation) {
    if (next?.step) {
      setActiveStep(next.step);
      setActiveWorkbenchStep(workbenchStepFor(next.step));
    }
    if (next?.href) router.push(next.href);
  }

  function discardAndNavigate() {
    setBuffers(buffersFrom(view));
    setDirty(false);
    const next = pendingNavigation;
    setPendingNavigation(null);
    navigate(next);
  }

  async function confirmTopic() {
    const topic = buffers.topic.trim();
    if (!topic) return;
    const payload = { topic, expectedVersion: view.version };
    const operation = "confirm-topic";
    try {
      const next = await confirmDigitalInterviewTopic({ interviewId: view.interviewId, ...payload, requestId: requestIdFor(operation, payload) });
      replaceAfterConfirmation(next, operation);
    } catch (cause) { showError(cause); }
  }

  async function confirmExperts() {
    if (!buffers.expertIds.length) return;
    const knownCandidateIds = new Set(view.expertCandidates.map((expert) => expert.expertId));
    const addedExperts = MOCK_DIGITAL_EXPERTS
      .filter((expert) => buffers.expertIds.includes(expert.expertId) && !knownCandidateIds.has(expert.expertId))
      .map(toDigitalExpertCatalogRow);
    const payload = { expertIds: buffers.expertIds, addedExperts, expectedVersion: view.version };
    const operation = "confirm-experts";
    try {
      const next = await confirmDigitalInterviewExperts({ interviewId: view.interviewId, ...payload, requestId: requestIdFor(operation, payload) });
      replaceAfterConfirmation(next, operation);
    } catch (cause) { showError(cause); }
  }

  async function confirmQuestions() {
    if (!buffers.questions.length || buffers.questions.some((question) => !question.text.trim() || !question.purpose.trim())) return;
    const payload = { questions: buffers.questions, moderatorPolicy: view.moderatorPolicy ?? DEFAULT_MODERATOR_POLICY, expectedVersion: view.version };
    const operation = "confirm-questions";
    try {
      const next = await confirmDigitalInterviewQuestions({ interviewId: view.interviewId, ...payload, requestId: requestIdFor(operation, payload) });
      replaceAfterConfirmation(next, operation);
    } catch (cause) { showError(cause); }
  }

  async function generateReport() {
    const payload = { expectedVersion: view.version };
    const operation = "generate-report";
    localReportStream.current = true;
    setActiveStep("report");
    setActiveWorkbenchStep("report");
    setReportPending(true);
    try {
      const next = await generateDigitalInterviewReportStream(
        { interviewId: view.interviewId, ...payload, requestId: requestIdFor(operation, payload) },
        view,
        (progress) => { setView(progress); setError(""); },
      );
      replaceAfterConfirmation(next, operation);
    } catch (cause) { showError(cause); }
    finally { localReportStream.current = false; setReportPending(false); }
  }

  function requestReportGeneration() {
    if (view.report || view.reportGeneration?.status === "failed") { setRegeneration(true); return; }
    void generateReport();
  }

  async function sendSkillMessage(text: string) {
    const payload = { currentStep: activeStep, text, draftContext: skillDraftContext(activeStep, buffers, view.name, view.expertCandidates), expectedVersion: view.version };
    const operation = "append-skill-message";
    try {
      const next = await appendDigitalInterviewSkillMessage({ interviewId: view.interviewId, ...payload, requestId: requestIdFor(operation, payload) });
      retainView(next, operation);
      return true;
    } catch (cause) { showError(cause); return false; }
  }

  async function applyProposal(proposalId: string) {
    const payload = { proposalId, expectedVersion: view.version };
    const operation = `apply-proposal:${proposalId}`;
    try {
      const next = await applyDigitalInterviewSkillProposal({ interviewId: view.interviewId, ...payload, requestId: requestIdFor(operation, payload) });
      retainView(next, operation);
      const proposal = next.skillProposals.find((candidate) => candidate.proposalId === proposalId);
      if (proposal?.status === "applied_to_draft" && proposal.baseRevisionId === next.revisionId) {
        applyPatchToActiveBuffer(proposal.targetStep, proposal.patch, setBuffers);
        setDirty(true);
      }
      return true;
    } catch (cause) { showError(cause); return false; }
  }

  async function rejectProposal(proposalId: string) {
    const payload = { proposalId, expectedVersion: view.version };
    const operation = `reject-proposal:${proposalId}`;
    try {
      const next = await rejectDigitalInterviewSkillProposal({ interviewId: view.interviewId, ...payload, requestId: requestIdFor(operation, payload) });
      retainView(next, operation);
      return true;
    } catch (cause) { showError(cause); return false; }
  }

  const active = activeStep;
  const activeWorkbench = activeWorkbenchStep;
  function requestWorkbenchNavigation(step: WorkbenchStep) {
    if (step === "analysis") {
      setActiveWorkbenchStep(step);
      return;
    }
    setActiveWorkbenchStep(step);
    requestNavigation({ step: WORKBENCH_STEPS.find((candidate) => candidate.id === step)!.liveStep });
  }
  return <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
    <PersistentInterviewSkillAssistant view={view} currentStep={active} onSend={sendSkillMessage} onApply={applyProposal} onReject={rejectProposal} />
    <main className="min-w-0 flex-1 overflow-y-auto bg-background p-5 lg:p-8"><div className="mx-auto max-w-6xl">
      <header className="rounded-2xl border border-border bg-card p-5 shadow-sm lg:p-6"><div className="flex items-start justify-between gap-4"><div><p className="flex items-center gap-2 text-xs font-medium text-primary"><Sparkles className="size-4" aria-hidden />AI 模拟访谈工作台</p><h1 className="mt-2 text-3xl font-semibold tracking-tight">{view.name}</h1><p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">将需求、分析、专家意见和访谈证据收敛为可审阅的 Markdown 研究资产。</p><div className="mt-3 flex flex-wrap gap-2">{view.tags.map((tag) => <span key={tag} className="rounded-full bg-muted px-3 py-1 text-xs text-muted-foreground">{tag}</span>)}</div></div><Button data-testid="itv-return-history" type="button" variant="outline" onClick={() => requestNavigation({ href: "/itv?tab=history" })}><ArrowLeft className="size-4" aria-hidden />返回访谈列表</Button></div>
      <div className="mt-5 flex flex-wrap gap-3 border-t border-border pt-4 text-xs text-muted-foreground"><span data-testid="itv-workflow-status">状态：{view.status}</span><span data-testid="itv-workflow-version">版本 {view.version}</span>{view.topic && <span data-testid="itv-persisted-topic">已确认主题：{view.topic}</span>}</div></header>
      <ol data-testid="itv-workbench-navigation" className="mt-6 grid gap-2 sm:grid-cols-2 lg:grid-cols-6">{WORKBENCH_STEPS.map((step, index) => <li key={step.id}><Button data-testid={`itv-workbench-step-${step.id}`} type="button" variant={activeWorkbench === step.id ? "primary" : "outline"} aria-current={activeWorkbench === step.id ? "step" : undefined} onClick={() => requestWorkbenchNavigation(step.id)} className="h-auto w-full justify-start whitespace-normal px-3 py-3 text-left"><span className="mr-2 grid size-6 shrink-0 place-items-center rounded-full bg-background/20 text-xs">{index + 1}</span><span><span className="block text-sm">{step.label}</span><span className="mt-1 block text-xs font-normal opacity-80">{step.detail}</span></span></Button></li>)}</ol>
      <ol className="sr-only">{LIVE_STEPS.map((step, index) => <li key={step.id}><Button data-testid={`itv-workflow-step-${index + 1}`} type="button" aria-current={active === step.id ? "step" : undefined} onClick={() => requestNavigation({ step: step.id })}>0{index + 1} {step.label}</Button></li>)}</ol>
      {error && !view.report && <p role="alert" className="mt-4 rounded-lg border border-destructive/20 bg-destructive/5 p-3 text-sm text-destructive">操作未完成：{error}。请重试，当前草稿已保留。</p>}
      <section className="mt-6 rounded-2xl border border-border bg-card p-5 shadow-sm lg:p-7">
        <WorkflowArtifactPanel artifacts={view.artifacts} workbenchStep={activeWorkbench} topic={buffers.topic || view.topic || view.name} />
        {activeWorkbench === "intake" && <DigitalInterviewResearchBriefEditor topic={buffers.topic} brief={buffers.researchBrief} onTopicChange={(topic) => { setBuffers((current) => ({ ...current, topic })); setDirty(true); }} onChange={(researchBrief) => { setBuffers((current) => ({ ...current, researchBrief })); setDirty(true); }} onConfirm={() => void confirmTopic()} />}
        {activeWorkbench === "analysis" && <LiveAnalysisWorkbench topic={buffers.topic || view.topic || view.name} onContinue={() => requestWorkbenchNavigation("experts")} />}
        {activeWorkbench === "experts" && <LiveExpertStep expertIds={buffers.expertIds} candidates={view.expertCandidates} onChange={(expertIds) => { setBuffers((current) => ({ ...current, expertIds })); setDirty(true); }} onConfirm={() => void confirmExperts()} />}
        {activeWorkbench === "outline" && <LiveQuestionStep expertIds={buffers.expertIds} candidates={view.expertCandidates} questions={buffers.questions} onChange={(questions) => { setBuffers((current) => ({ ...current, questions })); setDirty(true); }} onConfirm={() => void confirmQuestions()} />}
        {activeWorkbench === "runs" && <LiveRunStep runs={view.expertRuns} reportPending={reportPending} onGenerateReport={requestReportGeneration} />}
        {activeWorkbench === "report" && (view.report ? <LiveReportStep report={view.report} boundary={{ evidenceMode: view.studyEvidenceMode, review: view.reportEvidenceEligibility }} onViewSource={(expertId, questionId) => {
          setActiveStep("runs");
          setActiveWorkbenchStep("runs");
          window.setTimeout(() => document.getElementById(`answer-${expertId}-${questionId}`)?.scrollIntoView({ block: "center" }), 0);
        }} generation={view.reportGeneration} error={error} onRetry={requestReportGeneration} /> : view.reportGeneration ? <LiveReportGenerationStep generation={view.reportGeneration} onRetry={requestReportGeneration} />
          : <LiveReadOnlyStep title="访谈报告" text="请先确认访谈回答并生成报告。" />)}
      </section>
    </div></main>
    <Dialog open={regeneration} onOpenChange={setRegeneration}><DialogContent><DialogHeader><DialogTitle>是否重新生成？</DialogTitle><DialogDescription>将替换当前报告；取消会保留现有内容和当前草稿。</DialogDescription></DialogHeader><div className="mt-4 flex justify-end gap-3"><Button type="button" variant="outline" onClick={() => setRegeneration(false)}>保留现有内容</Button><Button type="button" variant="primary" onClick={() => { setRegeneration(false); void generateReport(); }}>确认重新生成</Button></div></DialogContent></Dialog>
    {pendingNavigation && <UnsavedChangesDialog onKeepEditing={() => setPendingNavigation(null)} onDiscard={discardAndNavigate} />}
  </div>;
}

function WorkflowArtifactPanel({ artifacts, workbenchStep, topic }: { readonly artifacts: DigitalInterviewWorkflowView["artifacts"] | undefined; readonly workbenchStep: WorkbenchStep; readonly topic: string }) {
  const artifact = (artifacts ?? []).find((candidate) => candidate.step === workbenchStep);
  const fallbackMarkdown = workbenchStep === "analysis" ? analysisMarkdown(topic) : "";
  if (!artifact && !fallbackMarkdown) return null;
  return <aside data-testid="itv-step-markdown-artifact" className="mb-6 rounded-xl border border-primary/20 bg-primary/5 p-4">
    <div className="flex flex-wrap items-center justify-between gap-2"><div><p className="text-xs font-medium text-primary">Markdown 产物 {artifact ? `· v${artifact.version}` : "· 待确认"}</p><h2 className="mt-1 text-sm font-semibold">{artifact?.title ?? "分析建议.md"}</h2></div><span className="rounded-full bg-background px-2.5 py-1 text-xs text-muted-foreground">{artifact ? artifact.evidenceMode === "simulated" ? "模拟证据 · 待真人验证" : artifact.evidenceMode === "mixed" ? "混合证据" : "真人证据" : "基于已确认需求"}</span></div>
    {(artifact?.markdown || fallbackMarkdown) && <details className="mt-3"><summary className="cursor-pointer text-sm font-medium">查看 Markdown</summary><pre className="mt-3 max-h-56 overflow-auto whitespace-pre-wrap rounded-lg bg-background p-3 text-xs leading-5 text-muted-foreground">{artifact?.markdown || fallbackMarkdown}</pre></details>}
    {artifact?.status === "failed" && <p role="alert" className="mt-3 text-sm text-destructive">生成失败：{artifact.failure?.code ?? "DEPENDENCY_UNAVAILABLE"}。已保存内容，可重试。</p>}
  </aside>;
}

function analysisMarkdown(topic: string): string {
  return `# 分析建议\n\n## 研究目标\n\n- 围绕“${topic}”识别关键决策、约束与反例。\n\n## 建议访谈方向\n\n- 决策链与实际行为\n- 采用障碍与替代方案\n- 可验证的成功指标\n\n## 预期产出\n\n- 专家组合、访谈提纲、可追溯研究发现。`;
}

function LiveAnalysisWorkbench({ topic, onContinue }: { readonly topic: string; readonly onContinue: () => void }) {
  const cards = [
    { title: "研究目标", icon: Lightbulb, items: ["澄清需要验证的核心决策", "识别影响选择的真实约束", "找出需用真人访谈验证的假设"] },
    { title: "建议访谈方向", icon: MessageSquareText, items: ["决策者的触发点与否决条件", "现有流程中的高摩擦环节", "替代方案与反例"] },
    { title: "目标人群", icon: UsersRound, items: ["最终决策者", "一线使用者", "影响预算或风险的人"] },
    { title: "预期产出", icon: ListChecks, items: ["可审阅的专家提纲", "带边界的探索性发现", "下一步真人研究建议"] },
  ] as const;
  return <div data-testid="itv-analysis-workbench"><div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-xs font-medium text-primary">AI 分析结果</p><h2 className="mt-1 text-2xl font-semibold">从需求开始，校准研究方向</h2><p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">围绕“{topic}”生成的分析仅用于组织后续模拟访谈；关键结论仍需用真实用户证据验证。</p></div><Button type="button" variant="primary" onClick={onContinue}>下一步：选择专家</Button></div><div className="mt-6 grid gap-4 md:grid-cols-2">{cards.map(({ title, icon: Icon, items }) => <article key={title} className="rounded-xl border border-border bg-background p-5"><div className="flex items-center gap-2"><span className="grid size-9 place-items-center rounded-lg bg-primary/10 text-primary"><Icon className="size-5" aria-hidden /></span><h3 className="font-semibold">{title}</h3></div><ul className="mt-4 space-y-2 text-sm leading-6 text-muted-foreground">{items.map((item) => <li key={item} className="flex gap-2"><CheckCircle2 className="mt-1 size-3.5 shrink-0 text-primary" aria-hidden />{item}</li>)}</ul></article>)}</div></div>;
}

function skillDraftContext(step: DigitalInterviewStep, buffers: LiveBuffers, fallbackTopic: string, generatedExperts: readonly DigitalExpertCatalogRow[]): DigitalInterviewSkillDraftContext {
  if (step === "topic") return { step, topic: buffers.topic.trim() || fallbackTopic };
  if (step === "experts") return {
    step,
    expertIds: [...buffers.expertIds],
    availableExperts: Array.from(new Map(
      [...generatedExperts, ...MOCK_DIGITAL_EXPERTS.map(toDigitalExpertCatalogRow)]
        .map(({ expertId, displayName, role }) => [expertId, { expertId, displayName, role }]),
    ).values()),
  };
  if (step === "questions") return { step, questions: [...buffers.questions] };
  if (step === "runs") return { step, instruction: "继续执行当前访谈" };
  return { step, instruction: "检查当前访谈报告" };
}

function LiveTopicStep({ topic, onChange, onConfirm }: { readonly topic: string; readonly onChange: (topic: string) => void; readonly onConfirm: () => void }) {
  return <div data-testid="itv-intake-workbench"><div><p className="text-xs font-medium text-primary">导入需求</p><h2 className="mt-1 text-2xl font-semibold">你想研究什么？</h2><p className="mt-2 text-sm leading-6 text-muted-foreground">先用一句清晰的业务问题定义研究范围；确认后，系统会保留一份可审阅的需求 Markdown。</p></div><div className="mt-6 grid gap-3 sm:grid-cols-3"><div className="rounded-xl border border-primary/30 bg-primary/5 p-4"><FileUp className="size-5 text-primary" aria-hidden /><p className="mt-3 text-sm font-medium">粘贴或录入</p><p className="mt-1 text-xs leading-5 text-muted-foreground">当前支持直接录入研究需求。</p></div><div className="rounded-xl border border-border p-4"><FileText className="size-5 text-muted-foreground" aria-hidden /><p className="mt-3 text-sm font-medium">上传文件</p><p className="mt-1 text-xs leading-5 text-muted-foreground">文件导入即将接入，不会丢弃当前草稿。</p></div><div className="rounded-xl border border-border p-4"><MessageSquareText className="size-5 text-muted-foreground" aria-hidden /><p className="mt-3 text-sm font-medium">语音输入</p><p className="mt-1 text-xs leading-5 text-muted-foreground">语音转写接入后会明确标注来源。</p></div></div><label htmlFor="itv-topic-input" className="mt-6 block text-sm font-medium">研究需求</label><textarea id="itv-topic-input" data-testid="itv-topic-input" value={topic} onChange={(event) => onChange(event.target.value)} placeholder="例如：德国储能采购中，谁拥有最终否决权，以及怎样验证他们的真实顾虑？" className="mt-2 min-h-40 w-full rounded-xl border border-input bg-background p-4 text-sm leading-6 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" /><div className="mt-5 flex flex-wrap items-center justify-between gap-3"><p className="text-xs text-muted-foreground">确认后生成「需求说明.md」，并进入分析校准。</p><Button data-testid="itv-confirm-topic" variant="primary" size="lg" disabled={!topic.trim()} onClick={onConfirm}>确认需求并生成分析</Button></div></div>;
}

function LiveExpertStep({ expertIds, candidates, onChange, onConfirm }: { readonly expertIds: readonly string[]; readonly candidates: readonly DigitalExpertCatalogRow[]; readonly onChange: (expertIds: readonly string[]) => void; readonly onConfirm: () => void }) {
  const [pickerOpen, setPickerOpen] = React.useState(false);
  const [detailExpertId, setDetailExpertId] = React.useState<string | null>(null);
  const detailExpert = detailExpertId
    ? candidates.find((candidate) => candidate.expertId === detailExpertId) ?? findMockDigitalExpert(detailExpertId)
    : undefined;
  const roles = expertIds.map((id) => (candidates.find((candidate) => candidate.expertId === id) ?? findMockDigitalExpert(id))?.role ?? "专家角色暂不可用");
  return <div data-testid="itv-expert-step"><div><p className="text-xs font-medium text-primary">选择专家</p><h2 className="mt-1 text-2xl font-semibold">用互补视角覆盖研究问题</h2><p className="mt-2 text-sm text-muted-foreground">系统推荐与主题相关的专家；你可以从目录补充角色，并在确认前查看其能力与材料边界。</p></div><div className="mt-6 grid gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]"><section className="rounded-xl border border-border bg-background p-4"><div className="flex items-center justify-between gap-3"><h3 className="font-semibold">候选专家库</h3><Button data-testid="itv-add-expert" type="button" variant="outline" size="sm" onClick={() => setPickerOpen(true)}><Plus className="size-4" aria-hidden />从目录添加</Button></div><div className="mt-4 grid gap-3">{expertIds.map((expertId, index) => { const expert = candidates.find((candidate) => candidate.expertId === expertId) ?? findMockDigitalExpert(expertId); const name = expert?.role ?? "专家角色暂不可用"; const actionName = roles.filter((role) => role === name).length > 1 ? `${name}（第 ${index + 1} 位）` : name; return <article key={expertId} className="flex items-center justify-between gap-3 rounded-lg border border-border p-4"><div className="min-w-0"><strong>{name}</strong>{expert && <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">{expert.bio}</p>}</div><Button data-testid={`itv-expert-detail-trigger-${expertId}`} type="button" variant="ghost" size="sm" aria-label={`查看专家详情 ${actionName}`} onClick={() => setDetailExpertId(expertId)}><Eye className="size-4" aria-hidden />详情</Button></article>; })}</div></section><aside className="rounded-xl border border-primary/20 bg-primary/5 p-4"><p className="text-xs font-medium text-primary">已选择专家</p><p className="mt-1 text-2xl font-semibold">{expertIds.length}<span className="ml-1 text-sm font-normal text-muted-foreground">位</span></p><div className="mt-4 space-y-2">{expertIds.map((expertId, index) => { const expert = candidates.find((candidate) => candidate.expertId === expertId) ?? findMockDigitalExpert(expertId); const name = expert?.role ?? "专家角色暂不可用"; const actionName = roles.filter((role) => role === name).length > 1 ? `${name}（第 ${index + 1} 位）` : name; return <div key={expertId} className="flex items-center justify-between gap-2 rounded-lg bg-card p-3"><span className="min-w-0 text-sm font-medium">{expert?.displayName ?? name}</span><Button type="button" variant="ghost" size="icon" disabled={expertIds.length <= 1} aria-label={`删除专家 ${actionName}`} onClick={() => onChange(expertIds.filter((id) => id !== expertId))}><Trash2 className="size-4" aria-hidden /></Button></div>; })}</div><Button data-testid="itv-confirm-experts" type="button" variant="primary" className="mt-5 w-full" disabled={!expertIds.length} onClick={onConfirm}>确认专家并生成提纲</Button></aside></div><ExpertPickerDialog open={pickerOpen} selectedExpertIds={expertIds} onOpenChange={setPickerOpen} onConfirm={onChange} experts={MOCK_DIGITAL_EXPERTS} description="从静态专家列表中选择，本次选择会追加到访谈。" /><ExpertDetailDialog expert={detailExpert} open={Boolean(detailExpertId)} onOpenChange={(open) => { if (!open) setDetailExpertId(null); }} /></div>;
}

function ExpertDetailDialog({ expert, open, onOpenChange }: { readonly expert: DigitalExpertCatalogRow | undefined; readonly open: boolean; readonly onOpenChange: (open: boolean) => void }) {
  const staticExpert = expert ? findMockDigitalExpert(expert.expertId) : undefined;
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent data-testid="itv-expert-detail-dialog" closeTestId="itv-expert-detail-close" className="max-h-[85vh] max-w-2xl overflow-y-auto"><DialogHeader><DialogTitle>{expert?.displayName ?? "专家详情"}</DialogTitle><DialogDescription>{staticExpert ? "静态专家档案" : "模型生成专家档案"}</DialogDescription></DialogHeader>{expert && <div className="space-y-4 text-sm"><DetailField testId="itv-expert-detail-role" label="角色" value={expert.role} /><DetailField testId="itv-expert-detail-category" label="分类" value={expert.category} /><DetailField testId="itv-expert-detail-occupation" label="职业" value={expert.occupation} /><DetailField testId="itv-expert-detail-age" label="年龄" value={`${expert.age} 岁`} /><div data-testid="itv-expert-detail-domains"><p className="text-xs font-medium text-muted-foreground">领域</p><div className="mt-2 flex flex-wrap gap-2">{expert.domains.map((domain) => <span key={domain} className="rounded-full bg-muted px-2.5 py-1 text-xs">{domain}</span>)}</div></div><DetailField testId="itv-expert-detail-location" label="地区" value={expert.location} /><DetailField testId="itv-expert-detail-bio" label="简介" value={expert.bio} /><DetailList testId="itv-expert-detail-goals" label="目标" values={expert.goals} /><DetailList testId="itv-expert-detail-interests" label="兴趣" values={expert.interests} /><DetailList testId="itv-expert-detail-pain-points" label="痛点" values={expert.painPoints} /><DetailList testId="itv-expert-detail-motivations" label="动机" values={expert.motivations} /><DetailList testId="itv-expert-detail-influences" label="影响来源" values={expert.influences} /><DetailField testId="itv-expert-detail-traits" label="性格维度" value={`内外向 ${expert.personalityTraits.introvertExtrovert}/10 · 分析创造 ${expert.personalityTraits.analyticalCreative}/10 · 忙闲程度 ${expert.personalityTraits.busyTimeRich}/10`} /><DetailField testId="itv-expert-detail-service-value" label="服务价值" value={expert.serviceValue} /><DetailField testId="itv-expert-detail-advice" label="典型建议" value={expert.typicalAdvice} />{expert.materialContextPackId && <DetailField testId="itv-expert-detail-boundary" label="材料边界" value={expert.materialBoundary} />}</div>}</DialogContent></Dialog>;
}

function DetailField({ testId, label, value }: { readonly testId: string; readonly label: string; readonly value: string }) {
  return <div data-testid={testId}><p className="text-xs font-medium text-muted-foreground">{label}</p><p className="mt-1 leading-6">{value}</p></div>;
}

function DetailList({ testId, label, values }: { readonly testId: string; readonly label: string; readonly values: readonly string[] }) {
  return <div data-testid={testId}><p className="text-xs font-medium text-muted-foreground">{label}</p><ul className="mt-1 list-disc space-y-1 pl-5 leading-6">{values.map((value) => <li key={value}>{value}</li>)}</ul></div>;
}

function LiveQuestionStep({ expertIds, candidates, questions, onChange, onConfirm }: { readonly expertIds: readonly string[]; readonly candidates: readonly DigitalExpertCatalogRow[]; readonly questions: readonly DigitalInterviewQuestion[]; readonly onChange: (questions: readonly DigitalInterviewQuestion[]) => void; readonly onConfirm: () => void }) {
  const addQuestion = (expertId: string) => onChange([...questions, { questionId: `manual-${crypto.randomUUID()}`, expertId, order: questions.length + 1, text: "", purpose: "手动问题", section: "core", goalIds: [] }]);
  return <div><div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-xs font-medium text-primary">专家提纲</p><h2 className="mt-1 text-2xl font-semibold">让每位专家回答他们最擅长的问题</h2><p className="mt-2 text-sm text-muted-foreground">编辑后的问题会被写入「访谈提纲.md」；未确认的改动不会覆盖已确认版本。</p></div><span className="rounded-full bg-muted px-3 py-1.5 text-xs text-muted-foreground">{questions.length} 个问题</span></div><div className="mt-6 grid gap-5 lg:grid-cols-[13rem_minmax(0,1fr)]"><aside className="rounded-xl border border-border bg-background p-4"><p className="text-xs font-medium text-muted-foreground">已选专家</p><div className="mt-3 space-y-2">{expertIds.map((expertId) => <div key={expertId} className="rounded-lg bg-muted p-3 text-sm font-medium">{candidates.find((candidate) => candidate.expertId === expertId)?.displayName ?? expertId}</div>)}</div></aside><div className="space-y-4">{expertIds.map((expertId) => <section data-testid="itv-question-group" key={expertId} className="rounded-xl border border-border p-4"><h3 className="font-semibold">{candidates.find((candidate) => candidate.expertId === expertId)?.displayName ?? expertId}</h3><p className="mt-1 text-xs text-muted-foreground">围绕职责、证据和反例组织追问。</p>{questions.filter((question) => question.expertId === expertId).map((question, index) => <div key={question.questionId} className="mt-3 rounded-lg bg-muted/50 p-3"><label htmlFor={question.questionId} className="text-xs font-medium text-muted-foreground">问题 {index + 1} · {question.purpose}</label><textarea id={question.questionId} rows={2} data-testid="itv-question-input" value={question.text} onChange={(event) => onChange(questions.map((candidate) => candidate.questionId === question.questionId ? { ...candidate, text: event.target.value } : candidate))} className="mt-2 w-full resize-y rounded-lg border border-input bg-background px-3 py-2 text-sm leading-6 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" /></div>)}<Button type="button" variant="outline" size="sm" className="mt-3" onClick={() => addQuestion(expertId)}><Plus className="size-4" aria-hidden />添加追问</Button></section>)}</div></div><div className="mt-6 flex justify-end"><Button data-testid="itv-confirm-questions" variant="primary" disabled={!questions.length || questions.some((question) => !question.text.trim())} onClick={onConfirm}>确认提纲并开始访谈</Button></div></div>;
}

function LiveReadOnlyStep({ title, text }: { readonly title: string; readonly text: string }) { return <div><h2 className="text-xl font-semibold">{title}</h2><p className="mt-2 text-sm text-muted-foreground">{text}</p></div>; }

function LiveRunStep({ runs, reportPending, onGenerateReport }: { readonly runs: DigitalInterviewWorkflowView["expertRuns"]; readonly reportPending: boolean; readonly onGenerateReport: () => void }) {
  const ready = runs.length > 0 && runs.every((run) => run.status !== "running") && runs.some((run) => run.status === "completed" && run.answers.length > 0);
  return <div data-testid="itv-expert-runs"><div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-xs font-medium text-primary">开始访谈</p><h2 className="mt-1 text-2xl font-semibold">逐位执行并保留可追溯回答</h2><p className="mt-2 text-sm text-muted-foreground">每位专家独立运行；刷新或离开页面后会从服务端恢复。</p></div><div className="rounded-xl bg-muted px-4 py-3 text-right"><p className="text-xs text-muted-foreground">完成进度</p><p className="mt-1 text-xl font-semibold">{runs.filter((run) => run.status === "completed").length}/{runs.length || 0}</p></div></div><div className="mt-6 space-y-4">{runs.map((run) => <article key={run.expertId} data-testid="itv-expert-run" className="rounded-xl border border-border bg-background p-5"><div className="flex items-center justify-between gap-3"><div><h3 className="font-semibold">{run.displayName}</h3><p className="mt-1 text-xs text-muted-foreground">模拟专家访谈 · 回答可回溯至问题</p></div><span className="rounded-full bg-muted px-3 py-1 text-xs text-muted-foreground">{run.status === "completed" ? "已完成" : run.status === "failed" ? "失败" : "进行中"} · {run.completedQuestions}/{run.totalQuestions}</span></div>{run.errorCode && <p role="alert" className="mt-3 text-sm text-destructive">{run.errorCode}</p>}<div className="mt-4 space-y-3">{run.answers.map((answer) => <section id={`answer-${run.expertId}-${answer.questionId}`} key={answer.questionId} className="scroll-mt-6 rounded-lg border border-border bg-muted/30 p-4"><p className="text-sm font-medium">{answer.question}</p><p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-muted-foreground">{answer.answer}</p></section>)}</div></article>)}</div>{runs.length === 0 && <p data-testid="itv-runs-empty" className="mt-5 rounded-lg border border-dashed border-border p-5 text-sm text-muted-foreground">访谈任务正在创建，请稍后刷新。</p>}<div className="mt-6 flex justify-end"><Button data-testid="itv-confirm-answers-generate-report" variant="primary" size="lg" disabled={!ready || reportPending} onClick={onGenerateReport}>{reportPending ? "正在生成报告…" : "确认回答并汇总报告"}</Button></div></div>;
}

function LiveReportStep({ report, boundary, generation, error, onRetry, onViewSource }: { readonly report: NonNullable<DigitalInterviewWorkflowView["report"]>; readonly boundary: { readonly evidenceMode: DigitalInterviewWorkflowView["studyEvidenceMode"]; readonly review: DigitalInterviewWorkflowView["reportEvidenceEligibility"] }; readonly generation: DigitalInterviewWorkflowView["reportGeneration"]; readonly error: string; readonly onRetry: () => void; readonly onViewSource: (expertId: string, questionId: string) => void }) {
  const retryFailed = generation?.status === "failed" || Boolean(error);
  return <div id="itv-report-print-root" data-testid="itv-report"><div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-xs font-medium text-primary">汇总报告</p><h2 className="mt-1 text-2xl font-semibold">{report.title}</h2></div><div className="flex flex-wrap gap-2 print:hidden"><Button data-testid="itv-report-export-word" type="button" variant="outline" onClick={() => void exportInterviewReportWord(report, boundary)}><FileText className="size-4" aria-hidden />导出 Word</Button><Button data-testid="itv-report-export-pdf" type="button" variant="outline" onClick={() => exportInterviewReportPdf("itv-report-print-root")}><Download className="size-4" aria-hidden />导出 PDF</Button></div></div>{retryFailed && <div className="mt-4 rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm"><p role="alert">操作未完成：{generation?.errorCode || error || "AI_GENERATION_UNAVAILABLE"}</p><p className="mt-1">报告重新生成失败，已保留上一份报告。请重试。</p><Button className="mt-3" type="button" variant="outline" onClick={onRetry}>重新生成报告</Button></div>}<section data-testid="itv-report-decision-brief" className="mt-5 border-l-2 border-primary/70 pl-4"><p data-testid="itv-study-evidence-label" className="text-xs font-medium text-muted-foreground">{evidenceModeLabel(boundary.evidenceMode)}</p><h3 className="mt-2 text-sm font-semibold">决策摘要</h3><p className="mt-2 leading-7 text-muted-foreground">{report.executiveSummary}</p><p className="mt-2 text-sm">{boundary.review.message}</p><p className="mt-1 text-sm text-muted-foreground">下一步：{boundary.review.action ?? "可提交人工批准"}</p></section><div data-testid="itv-evidence-review-empty" className="mt-4 text-sm text-muted-foreground">尚无可展示的目标与专家证据覆盖</div><div className="mt-7"><InterviewReportMarkdown markdown={reportMarkdownBody(report.title, report.markdown)} testId="itv-report-markdown" /></div><div className="mt-8 space-y-3"><h3 className="font-semibold">来源发现</h3>{report.findings.map((finding) => <article key={finding.findingId} className="rounded-lg border border-border bg-background p-4"><strong>{finding.title}</strong><p className="mt-2 text-sm leading-6 text-muted-foreground">{finding.summary}</p><Button type="button" variant="ghost" size="sm" className="mt-3 print:hidden" onClick={() => onViewSource(finding.expertId, finding.questionId)}>查看原始回答</Button></article>)}</div></div>;
}

function LiveReportGenerationStep({ generation, onRetry }: { readonly generation: NonNullable<DigitalInterviewWorkflowView["reportGeneration"]>; readonly onRetry: () => void }) {
  return <div data-testid="itv-report-generation">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h2 className="text-xl font-semibold">{generation.title ?? "正在生成访谈报告"}</h2>
      <span className="rounded-full bg-muted px-3 py-1 text-xs text-muted-foreground">
        {generation.status === "running" ? "流式生成中" : "生成失败"}
      </span>
    </div>
    {generation.executiveSummary && <p className="mt-3 leading-7 text-muted-foreground">{generation.executiveSummary}</p>}
    {generation.markdown
      ? <InterviewReportMarkdown markdown={generation.markdown} testId="itv-report-stream-markdown" />
      : generation.status === "running" && <p className="mt-5 text-sm text-muted-foreground">模型正在整理第一段内容…</p>}
    {generation.findings.length > 0 && <div className="mt-8 space-y-3"><h3 className="font-semibold">已生成的来源发现</h3>{generation.findings.map((finding) => <article key={finding.findingId} className="rounded-lg border border-border p-4"><strong>{finding.title}</strong><p className="mt-2 text-sm leading-6 text-muted-foreground">{finding.summary}</p><p className="mt-3 text-xs text-muted-foreground">探索性发现 · 待真人验证</p></article>)}</div>}
    {generation.status === "failed" && <div className="mt-5 rounded-lg border border-destructive/20 bg-destructive/5 p-3"><p role="alert" className="text-sm text-destructive">{generation.errorCode === "AI_GENERATION_UNAVAILABLE" ? "模型服务暂时不可用或返回内容不完整。" : "报告服务暂时不可用。"} 已生成内容和失败状态已保存，刷新后不会丢失。</p><Button data-testid="itv-retry-report" type="button" variant="outline" className="mt-3" onClick={onRetry}>重新生成报告</Button></div>}
  </div>;
}

function UnsavedChangesDialog({ onKeepEditing, onDiscard }: { readonly onKeepEditing: () => void; readonly onDiscard: () => void }) {
  return <div role="alert" className="fixed inset-0 z-50 flex items-center justify-center bg-background-foreground/35 p-4"><div className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-lg"><h2 className="text-lg font-semibold">有未确认的更改</h2><p className="mt-2 text-sm text-muted-foreground">这些更改尚未保存。继续编辑不会写入服务端。</p><div className="mt-6 flex justify-end gap-3"><Button type="button" variant="outline" onClick={onKeepEditing}>继续编辑</Button><Button type="button" variant="destructive" onClick={onDiscard}>放弃更改</Button></div></div></div>;
}

function applyPatchToActiveBuffer(targetStep: DigitalInterviewStep, patch: Record<string, unknown>, setBuffers: React.Dispatch<React.SetStateAction<LiveBuffers>>) {
  setBuffers((current) => {
    if (targetStep === "topic" && typeof patch.topic === "string") return { ...current, topic: patch.topic };
    const expertIds = Array.isArray(patch.expertIds) ? patch.expertIds : patch.selectedExpertIds;
    if (targetStep === "experts" && Array.isArray(expertIds) && expertIds.every((id) => typeof id === "string")) return { ...current, expertIds: expertIds as string[] };
    if (targetStep === "questions" && Array.isArray(patch.questions)) return { ...current, questions: patch.questions as DigitalInterviewQuestion[] };
    return current;
  });
}
