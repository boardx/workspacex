"use client";
import { interviewZhCN } from "@/lib/i18n/namespaces/interview";
import { useI18n } from "@/lib/i18n/provider";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, CheckCircle2, Eye, FileText, FileUp, Lightbulb, ListChecks, MessageSquareText, Plus, Play, Sparkles, Trash2, UsersRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  appendDigitalInterviewSkillMessage,
  applyDigitalInterviewSkillProposal,
  confirmDigitalInterviewExperts,
  confirmDigitalInterviewBrief,
  confirmDigitalInterviewQuestions,
  decideDigitalInterviewReadiness,
  generateDigitalInterviewReportStream,
  loadDigitalInterviewWorkflow,
  observeDigitalInterviewReportStream,
  rejectDigitalInterviewSkillProposal,
  reviewDigitalInterviewReport,
  type DigitalInterviewQuestion,
  type DigitalInterviewModeratorPolicy,
  type DigitalInterviewResearchBrief,
  type DigitalInterviewStep,
  type DigitalInterviewWorkflowView,
  type DigitalExpertCatalogRow,
  type DigitalInterviewSkillDraftContext,
} from "@/lib/interview-api";
import { MOCK_DIGITAL_EXPERTS, findMockDigitalExpert, toDigitalExpertCatalogRow } from "@/lib/mock/digital-expert-personas";
import { ExpertAvatar, ExpertAvatarEditor } from "@/components/itv/expert-avatar";
import { interviewMarkdown } from "@repo/contracts";
import { ExpertPickerDialog } from "./expert-picker-dialog";
import { InterviewSkillAssistant } from "./interview-skill-assistant";
import { InterviewReportMarkdown } from "./interview-report-markdown";
import { InterviewMarkdownResultsStep } from "./interview-markdown-results-step";
import { InterviewMarkdownSurface } from "./interview-markdown-surface";
import { InterviewSkillDrawer } from "./interview-skill-drawer";
import { InterviewStageFrame } from "./interview-stage-frame";
import { InterviewWorkbenchHeader } from "./interview-workbench-header";
import { DigitalInterviewResearchBriefEditor } from "./digital-interview-research-brief";
import { InterviewMarkdownPlanningStep } from "./interview-markdown-planning-step";
import { InterviewMarkdownEditingStep } from "./interview-markdown-editing-step";
import { DigitalInterviewEvidenceReview } from "./digital-interview-evidence-review";
import { DigitalInterviewReadiness } from "./digital-interview-readiness";
import { reportMarkdownBody } from "@/lib/interview-report-export";
import { reconcileMockInterviewQuestions, updateMockDigitalInterviewDraft, type MockDigitalInterviewDraft, type MockInterviewStep, type MockSkillSuggestion } from "@/lib/mock/digital-interview-drafts";

const STEPS = [interviewZhCN["itv.legacy.step.topic"], interviewZhCN["itv.legacy.step.experts"], interviewZhCN["itv.legacy.step.questions"], interviewZhCN["itv.legacy.step.runs"], interviewZhCN["itv.legacy.step.report"]] as const;

const legacyQualityKeys = {"cross_answer_synthesis": "itv.legacy.quality.cross_answer_synthesis", "decision_implication": "itv.legacy.quality.decision_implication", "boundary_or_counterevidence": "itv.legacy.quality.boundary_or_counterevidence", "verifiable_action": "itv.legacy.quality.verifiable_action"} as const;
const legacyMockStepKeys = ["itv.legacy.step.topic", "itv.legacy.step.experts", "itv.legacy.step.questions", "itv.legacy.step.runs", "itv.legacy.step.report"] as const;
const legacyLiveStepKeys = {"topic": "itv.legacy.step.topic", "experts": "itv.legacy.step.experts", "questions": "itv.legacy.step.questions", "runs": "itv.legacy.step.runs", "report": "itv.legacy.step.report"} as const;
const legacyWorkbenchLabelKeys = {"intake": "itv.step.intake", "analysis": "itv.step.analysis", "experts": "itv.step.experts", "outline": "itv.legacy.expertOutline", "runs": "itv.step.runs", "report": "itv.step.report"} as const;
const legacyWorkbenchDetailKeys = {"intake": "itv.legacy.step.intake.detail", "analysis": "itv.legacy.step.analysis.detail", "experts": "itv.legacy.step.experts.detail", "outline": "itv.legacy.step.outline.detail", "runs": "itv.legacy.step.runs.detail", "report": "itv.legacy.step.report.detail"} as const;

const DEFAULT_MODERATOR_POLICY: DigitalInterviewModeratorPolicy = {
  probingDepth: "balanced", clarifyAmbiguity: true, seekCounterexamples: true,
  redirectOffTopic: true, stopWhenGoalSatisfied: true, maxFollowUpsPerQuestion: 2,
};

export function DigitalInterviewWorkflow({ initialDraft }: { initialDraft: MockDigitalInterviewDraft }) {
  const { t } = useI18n();
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
        <header className="space-y-4"><Link href="/itv?tab=history" className="inline-flex shrink-0 items-center gap-2 rounded-lg border border-border bg-background px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted"><ArrowLeft className="size-4" aria-hidden />{t("itv.back")}</Link><div><p className="text-xs text-primary">{t("itv.legacy.mockWorkflow")}</p><h1 className="mt-2 text-3xl font-semibold">{draft.name}</h1><div className="mt-3 flex flex-wrap gap-2">{draft.tags.map((tag) => <span key={tag} className="rounded-md bg-muted px-2 py-1 text-xs text-muted-foreground">{tag}</span>)}</div></div></header>
        <ol className="mt-7 grid gap-2 sm:grid-cols-5">{STEPS.map((label, index) => { const step = (index + 1) as MockInterviewStep; return <li key={label}><button data-testid={`itv-workflow-step-${step}`} type="button" aria-current={draft.currentStep === step ? "step" : undefined} onClick={() => persist((current) => ({ ...current, currentStep: step }))} className={draft.currentStep === step ? "w-full rounded-lg bg-primary p-3 text-left text-xs font-medium text-primary-foreground" : "w-full rounded-lg border border-border p-3 text-left text-xs text-muted-foreground"}>0{step} {t(legacyMockStepKeys[index]!)}</button></li>; })}</ol>
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

function TopicStep({ draft, onChange, onConfirm }: { draft: MockDigitalInterviewDraft; onChange: (topic: string) => void; onConfirm: () => void }) {
  const { t } = useI18n(); return <div><h2 className="text-xl font-semibold">{t("itv.legacy.confirmTopicTitle")}</h2><textarea data-testid="itv-topic-input" value={draft.topic} onChange={(event) => onChange(event.target.value)} placeholder={t("itv.legacy.topicPlaceholder")} className="mt-5 min-h-40 w-full rounded-lg border border-input bg-background p-3" /><Button data-testid="itv-confirm-topic" className="mt-5" variant="primary" size="lg" disabled={!draft.topic.trim()} onClick={onConfirm}>{t("itv.legacy.confirmTopic")}</Button></div>; }
function ExpertStep({ draft, onRemove, onAdd, onConfirm }: { draft: MockDigitalInterviewDraft; onRemove: (id: string) => void; onAdd: (ids: readonly string[]) => void; onConfirm: () => void }) {
  const { t } = useI18n();
  const [pickerOpen, setPickerOpen] = React.useState(false);
  return <div><h2 className="text-xl font-semibold">{t("itv.legacy.confirmExpertsTitle")}</h2><p className="mt-2 text-sm text-muted-foreground">{t("itv.legacy.expertHint")}</p><div className="mt-5 grid gap-3">{draft.selectedExpertIds.map((id) => { const expert = findMockDigitalExpert(id); return <article data-testid="itv-selected-expert" key={id} className="flex items-center justify-between rounded-lg border border-border p-4"><div><strong>{expert?.displayName}</strong><p className="text-xs text-muted-foreground">{expert?.role} · {t("itv.experts.mock")}</p></div><button type="button" aria-label={t("itv.legacy.deleteExpert", { name: expert?.displayName ?? t("itv.legacy.roleUnavailable") })} onClick={() => onRemove(id)} disabled={draft.selectedExpertIds.length <= 1} className="rounded-md p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:bg-disabled disabled:text-disabled-foreground"><Trash2 className="size-4" aria-hidden /></button></article>; })}</div><div className="mt-5 flex flex-wrap gap-3"><Button data-testid="itv-add-expert" type="button" variant="outline" onClick={() => setPickerOpen(true)}><Plus className="size-4" aria-hidden />{t("itv.library.add")}</Button><Button data-testid="itv-confirm-experts" type="button" variant="primary" disabled={!draft.selectedExpertIds.length} onClick={onConfirm}>{t("itv.legacy.confirmExperts")}</Button></div><ExpertPickerDialog open={pickerOpen} selectedExpertIds={draft.selectedExpertIds} onOpenChange={setPickerOpen} onConfirm={onAdd} /></div>;
}
function QuestionStep({ draft, onChange, onAdd, onDelete, onConfirm }: { draft: MockDigitalInterviewDraft; onChange: (questionId: string, text: string) => void; onAdd: (expertId: string) => void; onDelete: (questionId: string) => void; onConfirm: () => void }) {
  const { t } = useI18n();
  return <div><h2 className="text-xl font-semibold">{t("itv.legacy.confirmQuestionsTitle")}</h2><p className="mt-2 text-sm text-muted-foreground">{t("itv.legacy.questionsHint")}</p><div className="mt-4 space-y-4">{draft.selectedExpertIds.map((expertId) => { const expert = findMockDigitalExpert(expertId); const questions = draft.questions.filter((question) => question.expertId === expertId); return <section data-testid="itv-question-group" key={expertId} className="rounded-xl border border-border p-4"><header className="flex items-baseline gap-2"><h3 className="font-semibold">{expert?.displayName}</h3><p className="text-xs text-muted-foreground">{expert?.role} · {t("itv.legacy.questionCount", { count: questions.length })}</p></header><div className="mt-3 space-y-3">{questions.map((question, index) => <div key={question.questionId} className="rounded-lg bg-muted/35 p-3"><div className="mb-1.5 flex items-center justify-between gap-3"><label htmlFor={question.questionId} className="text-xs font-medium">{t("itv.legacy.questionLabel", { count: index + 1, purpose: question.purpose })}</label><button data-testid="itv-delete-question" type="button" aria-label={t("itv.legacy.deleteQuestion", { name: expert?.displayName ?? t("itv.legacy.roleUnavailable"), count: index + 1 })} onClick={() => onDelete(question.questionId)} className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"><Trash2 className="size-4" aria-hidden /></button></div><textarea rows={2} id={question.questionId} data-testid="itv-question-input" value={question.text} onChange={(event) => onChange(question.questionId, event.target.value)} placeholder={t("itv.legacy.questionPlaceholder")} className="w-full resize-y rounded-lg border border-input bg-background px-3 py-2 text-sm leading-5" /></div>)}</div><Button data-testid="itv-add-question" type="button" variant="outline" size="sm" className="mt-3" onClick={() => onAdd(expertId)}><Plus className="size-4" aria-hidden />{t("itv.outline.add")}</Button></section>; })}</div><Button data-testid="itv-confirm-questions" className="mt-5" variant="primary" disabled={!draft.questions.length || draft.questions.some((question) => !question.text.trim())} onClick={onConfirm}>{t("itv.legacy.confirmQuestions")}</Button></div>;
}
function RunStep({ draft, onRun }: { draft: MockDigitalInterviewDraft; onRun: () => void }) {
  const { t } = useI18n(); return <div><h2 className="text-xl font-semibold">{t("itv.legacy.runMock")}</h2><p className="mt-2 text-sm text-muted-foreground">{t("itv.legacy.mockCount", { count: draft.selectedExpertIds.length })}</p><div className="mt-5 grid gap-3">{draft.selectedExpertIds.map((id) => <div key={id} className="flex items-center justify-between rounded-lg border border-border p-4"><span>{findMockDigitalExpert(id)?.displayName}</span><span className="text-xs text-muted-foreground">{t("itv.legacy.waiting")}</span></div>)}</div><Button data-testid="itv-run-all" className="mt-5" variant="primary" onClick={onRun}><Play className="size-4" aria-hidden />{t("itv.legacy.runAll")}</Button></div>; }
function ReportStep({ draft }: { draft: MockDigitalInterviewDraft }) {
  const { t } = useI18n(); const report = draft.reportMarkdown || reportFor(draft, false); return <div><h2 className="text-xl font-semibold">{t("itv.legacy.reportTitle")}</h2><div className="mt-3 rounded-lg border border-primary/20 bg-primary/5 p-3 text-xs text-muted-foreground">{t("itv.legacy.mockReport")}</div><InterviewReportMarkdown markdown={report} testId="itv-report-markdown" /><ol data-testid="itv-report-timeline" className="mt-6 border-l border-border pl-5 text-sm"><li><CheckCircle2 className="mr-2 inline size-4 text-primary" aria-hidden />{t("itv.legacy.topicExpertsConfirmed")}</li><li className="mt-3"><CheckCircle2 className="mr-2 inline size-4 text-primary" aria-hidden />{t("itv.legacy.mockCompleted")}</li><li className="mt-3"><CheckCircle2 className="mr-2 inline size-4 text-primary" aria-hidden />{t("itv.legacy.reportCreated")}</li></ol></div>; }
function reportFor(draft: MockDigitalInterviewDraft, structured: boolean): string { return `# ${draft.name}\n\n> Mock 探索性内容，不作为真实证据。\n\n## ${structured ? "报告摘要" : "关键发现"}\n\n围绕“${draft.topic || draft.name}”，数字专家给出了角色、否决条件与待验证假设。\n\n## 待验证假设\n\n- 决策权与预算责任可能并不属于同一角色。\n- 需要用真实访谈补充反例与来源。`; }

const LIVE_STEPS: readonly { readonly id: DigitalInterviewStep; readonly label: string }[] = [
  { id: "topic", label: interviewZhCN["itv.legacy.step.topic"] }, { id: "experts", label: interviewZhCN["itv.legacy.step.experts"] }, { id: "questions", label: interviewZhCN["itv.legacy.step.questions"] }, { id: "runs", label: interviewZhCN["itv.legacy.step.runs"] }, { id: "report", label: interviewZhCN["itv.legacy.step.report"] },
];

export type WorkbenchStep = "intake" | "analysis" | "experts" | "outline" | "runs" | "report";

const WORKBENCH_STEPS: readonly { readonly id: WorkbenchStep; readonly label: string; readonly detail: string; readonly liveStep: DigitalInterviewStep }[] = [
  { id: "intake", label: interviewZhCN["itv.step.intake"], detail: interviewZhCN["itv.legacy.step.intake.detail"], liveStep: "topic" },
  { id: "analysis", label: interviewZhCN["itv.step.analysis"], detail: interviewZhCN["itv.legacy.step.analysis.detail"], liveStep: "experts" },
  { id: "experts", label: interviewZhCN["itv.step.experts"], detail: interviewZhCN["itv.legacy.step.experts.detail"], liveStep: "experts" },
  { id: "outline", label: interviewZhCN["itv.legacy.expertOutline"], detail: interviewZhCN["itv.legacy.step.outline.detail"], liveStep: "questions" },
  { id: "runs", label: interviewZhCN["itv.step.runs"], detail: interviewZhCN["itv.legacy.step.runs.detail"], liveStep: "runs" },
  { id: "report", label: interviewZhCN["itv.step.report"], detail: interviewZhCN["itv.legacy.step.report.detail"], liveStep: "report" },
];

function workbenchStepFor(step: DigitalInterviewStep): WorkbenchStep {
  if (step === "topic") return "intake";
  if (step === "experts") return "experts";
  if (step === "questions") return "outline";
  return step;
}

type LiveBuffers = { readonly topic: string; readonly researchBrief: DigitalInterviewResearchBrief; readonly expertIds: readonly string[]; readonly questions: readonly DigitalInterviewQuestion[] };
type PendingNavigation = { readonly step?: DigitalInterviewStep; readonly workbenchStep?: WorkbenchStep; readonly href?: string } | null;

function workbenchHref(interviewId: string, step: WorkbenchStep) {
  const path = `/itv/${encodeURIComponent(interviewId)}/${step}`;
  const projectId = typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("projectId");
  return projectId ? `${path}?projectId=${encodeURIComponent(projectId)}` : path;
}

function buffersFrom(view: DigitalInterviewWorkflowView): LiveBuffers {
  return {
    topic: view.topic ?? "",
    researchBrief: view.researchBrief ?? { decision: view.topic ?? view.name, learningGoals: [{ goalId: "goal-1", statement: view.topic ?? view.name }], targetRoles: ["目标用户"], outOfScope: [], successCriteria: ["形成可追溯的决策依据"] },
    expertIds: view.selectedExpertIds.length ? view.selectedExpertIds : view.expertCandidates.map((expert) => expert.expertId),
    questions: view.questions.length ? view.questions : view.questionCandidates,
  };
}

/** Live workflow deliberately has no persistence side effects on input events. */
export function PersistentDigitalInterviewWorkflow({ initialView, initialWorkbenchStep, markdownWorkbenchEnabled = false }: { readonly initialView: DigitalInterviewWorkflowView; readonly initialWorkbenchStep?: WorkbenchStep; readonly markdownWorkbenchEnabled?: boolean }) {
  const { t } = useI18n();
  const router = useRouter();
  const [view, setView] = React.useState(initialView);
  const [activeStep, setActiveStep] = React.useState<DigitalInterviewStep>(initialView.currentStep);
  const [activeWorkbenchStep, setActiveWorkbenchStep] = React.useState<WorkbenchStep>(() => initialWorkbenchStep ?? workbenchStepFor(initialView.currentStep));
  const [buffers, setBuffers] = React.useState<LiveBuffers>(() => buffersFrom(initialView));
  const [dirty, setDirty] = React.useState(false);
  const [skillDrawerOpen, setSkillDrawerOpen] = React.useState(false);
  const [error, setError] = React.useState("");
  const [pendingNavigation, setPendingNavigation] = React.useState<PendingNavigation>(null);
  const [reportPending, setReportPending] = React.useState(initialView.reportGeneration?.status === "running");
  const [readinessPending, setReadinessPending] = React.useState(false);
  const [reviewPending, setReviewPending] = React.useState(false);
  const [regeneration, setRegeneration] = React.useState<"topic" | "experts" | "questions" | "report" | null>(null);
  const [confirming, setConfirming] = React.useState(false);
  const confirmationLock = React.useRef(false);
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
    const nextWorkbenchStep = workbenchStepFor(next.currentStep);
    setActiveWorkbenchStep(nextWorkbenchStep);
    router.replace?.(workbenchHref(next.interviewId, nextWorkbenchStep));
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
    }
    if (next?.workbenchStep) setActiveWorkbenchStep(next.workbenchStep);
    else if (next?.step) setActiveWorkbenchStep(workbenchStepFor(next.step));
    if (next?.href) {
      const projectId = new URLSearchParams(window.location.search).get("projectId") ?? view.scope.projectId;
      const href = next.href;
      router.push(projectId && !new URL(href, window.location.origin).searchParams.has("projectId") ? `${href}${href.includes("?") ? "&" : "?"}projectId=${encodeURIComponent(projectId)}` : href);
    }
  }

  function discardAndNavigate() {
    setBuffers(buffersFrom(view));
    setDirty(false);
    const next = pendingNavigation;
    setPendingNavigation(null);
    navigate(next);
  }

  function requestConfirmation(step: "topic" | "experts" | "questions" | "report") {
    if (confirmationLock.current || reportPending) return;
    const generated = step === "topic" ? Boolean(view.topicVersionId || view.expertCandidates.length)
      : step === "experts" ? Boolean(view.expertSnapshotVersionId || view.questionCandidates.length || view.questions.length)
      : step === "questions" ? Boolean(view.questionVersionId || view.expertRuns.length)
      : Boolean(view.report || view.reportGeneration);
    if (generated) setRegeneration(step);
    else void executeConfirmation(step);
  }

  async function executeConfirmation(step: "topic" | "experts" | "questions" | "report") {
    if (confirmationLock.current) return;
    confirmationLock.current = true;
    setConfirming(true);
    setRegeneration(null);
    try {
      if (step === "topic") await confirmTopic();
      else if (step === "experts") await confirmExperts();
      else if (step === "questions") await confirmQuestions();
      else await generateReport();
    } finally {
      confirmationLock.current = false;
      setConfirming(false);
    }
  }

  async function confirmTopic() {
    const topic = buffers.topic.trim();
    if (!topic) return;
    const payload = { topic, researchBrief: buffers.researchBrief, expectedVersion: view.version };
    const operation = "confirm-brief";
    try {
      const next = await confirmDigitalInterviewBrief({ interviewId: view.interviewId, ...payload, requestId: requestIdFor(operation, payload) });
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
      const readiness = next.quality.readiness;
      replaceAfterConfirmation(next, operation);
      if (readiness?.status === "ready") await decideReadiness(next, "ready", null);
    } catch (cause) { showError(cause); }
  }

  async function decideReadiness(source: DigitalInterviewWorkflowView, status: "ready" | "warning_accepted", rationale: string | null) {
    const readiness = source.quality.readiness;
    if (!readiness || readiness.status === "blocking" || readinessPending) return;
    const payload = { assessmentRuleVersion: readiness.ruleVersion, status, rationale, expectedVersion: source.version };
    setReadinessPending(true);
    try {
      const next = await decideDigitalInterviewReadiness({ interviewId: source.interviewId, ...payload, requestId: requestIdFor("decide-readiness", payload) });
      replaceAfterConfirmation(next, "decide-readiness");
    } catch (cause) { showError(cause); }
    finally { setReadinessPending(false); }
  }

  async function generateReport() {
    const payload = { expectedVersion: view.version };
    const operation = "generate-report";
    localReportStream.current = true;
    setActiveStep("report");
    setActiveWorkbenchStep("report");
    router.replace?.(workbenchHref(view.interviewId, "report"));
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

  function requestReportGeneration() { requestConfirmation("report"); }

  async function reviewReport(status: "approved" | "changes_requested", note: string | null) {
    if (!view.report || reviewPending) return;
    const payload = { reportId: view.report.reportId, status, note, expectedVersion: view.version };
    setReviewPending(true);
    try {
      const next = await reviewDigitalInterviewReport({ interviewId: view.interviewId, ...payload, requestId: requestIdFor("review-report", payload) });
      replaceAfterConfirmation(next, "review-report");
    } catch (cause) { showError(cause); }
    finally { setReviewPending(false); }
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
  // Source editors remain opt-in until their confirmations drive the execution
  // workflow. Named URLs must not silently bypass readiness or run creation.
  const markdownPlanning = markdownWorkbenchEnabled && (activeWorkbench === "intake" || activeWorkbench === "analysis");
  const markdownEditing = markdownWorkbenchEnabled && (activeWorkbench === "experts" || activeWorkbench === "outline");
  const markdownResults = markdownWorkbenchEnabled && (activeWorkbench === "runs" || activeWorkbench === "report");
  function requestWorkbenchNavigation(step: WorkbenchStep) {
    const target = WORKBENCH_STEPS.find((candidate) => candidate.id === step)!;
    requestNavigation({ step: target.liveStep, workbenchStep: step, href: workbenchHref(view.interviewId, step) });
  }
  return <div className="min-h-0 flex-1 bg-background">
    <main className="min-w-0 overflow-y-auto p-5 lg:p-8"><div className="mx-auto max-w-6xl">
      <InterviewWorkbenchHeader name={view.name} tags={view.tags} steps={WORKBENCH_STEPS.map(step => ({ ...step, label: t(legacyWorkbenchLabelKeys[step.id]), detail: t(legacyWorkbenchDetailKeys[step.id]) }))} activeStep={activeWorkbench} status={view.status} version={view.version} topic={view.topic} onStepChange={(step) => requestWorkbenchNavigation(step as WorkbenchStep)} onReturnToList={() => requestNavigation({ href: "/itv?tab=history" })} onOpenSkill={() => setSkillDrawerOpen(true)} />
      <ol className="sr-only">{LIVE_STEPS.map((step, index) => <li key={step.id}><Button data-testid={`itv-workflow-step-${index + 1}`} type="button" aria-current={active === step.id ? "step" : undefined} onClick={() => requestNavigation({ step: step.id })}>0{index + 1} {t(legacyLiveStepKeys[step.id])}</Button></li>)}</ol>
      {error && !view.report && <p role="alert" className="mt-4 rounded-lg border border-destructive/20 bg-destructive/5 p-3 text-sm text-destructive">{t("itv.legacy.operationFailed", { detail: error })}</p>}
      <InterviewStageFrame>
        {!markdownPlanning && !markdownEditing && !markdownResults && <WorkflowArtifactPanel artifacts={view.artifacts} workbenchStep={activeWorkbench} topic={buffers.topic || view.topic || view.name} />}
        {markdownResults && <InterviewMarkdownResultsStep interviewId={view.interviewId} step={activeWorkbench as "runs" | "report"} runs={view.expertRuns} legacySelectedExpertIds={view.selectedExpertIds} onVersionChange={(version) => setView((current) => ({ ...current, version }))} onReport={() => requestWorkbenchNavigation("report")} />}
        {markdownEditing && <InterviewMarkdownEditingStep interviewId={view.interviewId} step={activeWorkbench as "experts" | "outline"} onVersionChange={(version) => setView((current) => ({ ...current, version }))} onDirtyChange={setDirty} onContinue={requestWorkbenchNavigation} />}
        {markdownPlanning && <InterviewMarkdownPlanningStep interviewId={view.interviewId} step={activeWorkbench as "intake" | "analysis"} onVersionChange={(version) => setView((current) => ({ ...current, version }))} onDirtyChange={setDirty} onContinue={requestWorkbenchNavigation} />}
        {!markdownPlanning && activeWorkbench === "intake" && <DigitalInterviewResearchBriefEditor topic={buffers.topic} brief={buffers.researchBrief} onTopicChange={(topic) => { setBuffers((current) => ({ ...current, topic })); setDirty(true); }} onChange={(researchBrief) => { setBuffers((current) => ({ ...current, researchBrief })); setDirty(true); }} onConfirm={() => requestConfirmation("topic")} />}
        {!markdownPlanning && activeWorkbench === "analysis" && <LiveAnalysisWorkbench topic={buffers.topic || view.topic || view.name} onContinue={() => requestWorkbenchNavigation("experts")} />}
        {!markdownEditing && activeWorkbench === "experts" && <LiveExpertStep expertIds={buffers.expertIds} candidates={view.expertCandidates} onChange={(expertIds) => { setBuffers((current) => ({ ...current, expertIds })); setDirty(true); }} onConfirm={() => requestConfirmation("experts")} />}
        {!markdownEditing && activeWorkbench === "outline" && <><LiveQuestionStep expertIds={buffers.expertIds} candidates={view.expertCandidates} questions={buffers.questions} learningGoals={buffers.researchBrief.learningGoals} onChange={(questions) => { setBuffers((current) => ({ ...current, questions })); setDirty(true); }} onConfirm={() => requestConfirmation("questions")} />{view.quality.readiness && <DigitalInterviewReadiness quality={view.quality} pending={readinessPending} onDecide={(status, rationale) => void decideReadiness(view, status, rationale)} />}</>}
        {!markdownResults && activeWorkbench === "runs" && <LiveRunStep runs={view.expertRuns} reportPending={reportPending} onGenerateReport={requestReportGeneration} />}
        {!markdownResults && activeWorkbench === "report" && (view.report ? <><LiveReportStep interviewId={view.interviewId} report={view.report} boundary={{ evidenceMode: view.studyEvidenceMode, review: view.reportEvidenceEligibility }} onViewSource={(expertId, questionId) => {
          setActiveStep("runs");
          setActiveWorkbenchStep("runs");
          window.setTimeout(() => document.getElementById(`answer-${expertId}-${questionId}`)?.scrollIntoView({ block: "center" }), 0);
        }} generation={view.reportGeneration} error={error} onRetry={requestReportGeneration} /><DigitalInterviewEvidenceReview view={view} pending={reviewPending} onReview={reviewReport} /></> : view.reportGeneration ? <LiveReportGenerationStep generation={view.reportGeneration} onRetry={requestReportGeneration} />
          : <LiveReadOnlyStep title={t("itv.legacy.reportTitle")} text={t("itv.legacy.reportNotReady")} />)}
      </InterviewStageFrame>
    </div></main>
    <InterviewSkillDrawer open={skillDrawerOpen} onOpenChange={setSkillDrawerOpen} view={view} currentStep={active} onSend={sendSkillMessage} onApply={applyProposal} onReject={rejectProposal} />
    <Dialog open={regeneration !== null} onOpenChange={(open) => { if (!open) setRegeneration(null); }}><DialogContent><DialogHeader><DialogTitle>{t("itv.legacy.regenerateTitle")}</DialogTitle><DialogDescription>{t("itv.legacy.regenerationHint", { content: regeneration === "topic" ? t("itv.legacy.replaceAll") : regeneration === "experts" ? t("itv.legacy.replaceQuestions") : regeneration === "questions" ? t("itv.legacy.replaceResults") : t("itv.legacy.reportWord") })}</DialogDescription></DialogHeader><div className="mt-4 flex justify-end gap-3"><Button type="button" variant="outline" onClick={() => setRegeneration(null)}>{t("itv.legacy.keep")}</Button><Button type="button" variant="primary" disabled={confirming} onClick={() => { if (regeneration) void executeConfirmation(regeneration); }}>{t("itv.legacy.regenerate")}</Button></div></DialogContent></Dialog>
    {pendingNavigation && <UnsavedChangesDialog onKeepEditing={() => setPendingNavigation(null)} onDiscard={discardAndNavigate} />}
  </div>;
}

function WorkflowArtifactPanel({ artifacts, workbenchStep, topic }: { readonly artifacts: DigitalInterviewWorkflowView["artifacts"] | undefined; readonly workbenchStep: WorkbenchStep; readonly topic: string }) {
  const { t } = useI18n();
  const artifact = (artifacts ?? []).find((candidate) => candidate.step === workbenchStep);
  const fallbackMarkdown = workbenchStep === "analysis" ? analysisMarkdown(topic) : "";
  const markdown = artifact?.markdown || fallbackMarkdown;
  if (!markdown) return null;
  const evidenceLabel = artifact
    ? artifact.evidenceMode === "simulated" ? t("itv.legacy.artifact.simulated") : artifact.evidenceMode === "mixed" ? t("itv.legacy.artifact.mixed") : t("itv.legacy.artifact.participant")
    : t("itv.legacy.artifact.confirmed");
  return <InterviewMarkdownSurface title={artifact?.title ?? t("itv.legacy.artifact.filename")} markdown={markdown} version={artifact?.version} evidenceLabel={evidenceLabel} failure={artifact?.status === "failed" ? artifact.failure?.code ?? "DEPENDENCY_UNAVAILABLE" : null} />;
}

function analysisMarkdown(topic: string): string {
  return `# 分析建议\n\n## 研究目标\n\n- 围绕“${topic}”识别关键决策、约束与反例。\n\n## 建议访谈方向\n\n- 决策链与实际行为\n- 采用障碍与替代方案\n- 可验证的成功指标\n\n## 预期产出\n\n- 专家组合、访谈提纲、可追溯研究发现。`;
}

function LiveAnalysisWorkbench({ topic, onContinue }: { readonly topic: string; readonly onContinue: () => void }) {
  const { t } = useI18n();
  const cards = [
    { title: t("itv.legacy.analysis.goals"), icon: Lightbulb, items: [t("itv.legacy.analysis.clarify"), t("itv.legacy.analysis.constraints"), t("itv.legacy.analysis.hypotheses")] },
    { title: t("itv.legacy.analysis.directions"), icon: MessageSquareText, items: [t("itv.legacy.analysis.triggers"), t("itv.legacy.analysis.friction"), t("itv.legacy.analysis.alternatives")] },
    { title: t("itv.legacy.analysis.participants"), icon: UsersRound, items: [t("itv.legacy.analysis.deciders"), t("itv.legacy.analysis.users"), t("itv.legacy.analysis.influencers")] },
    { title: t("itv.legacy.analysis.outputs"), icon: ListChecks, items: [t("itv.legacy.analysis.outlines"), t("itv.legacy.analysis.findings"), t("itv.legacy.analysis.next")] },
  ] as const;
  return <div data-testid="itv-analysis-workbench"><div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-xs font-medium text-primary">{t("itv.analysis.title")}</p><h2 className="mt-1 text-2xl font-semibold">{t("itv.legacy.analysisTitle")}</h2><p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">{t("itv.legacy.analysisHint", { topic })}</p></div><Button type="button" variant="primary" onClick={onContinue}>{t("itv.legacy.nextExperts")}</Button></div><div className="mt-6 grid gap-4 md:grid-cols-2">{cards.map(({ title, icon: Icon, items }, cardIndex) => <article key={cardIndex} className="rounded-xl border border-border bg-background p-5"><div className="flex items-center gap-2"><span className="grid size-9 place-items-center rounded-lg bg-primary/10 text-primary"><Icon className="size-5" aria-hidden /></span><h3 className="font-semibold">{title}</h3></div><ul className="mt-4 space-y-2 text-sm leading-6 text-muted-foreground">{items.map((item, itemIndex) => <li key={itemIndex} className="flex gap-2"><CheckCircle2 className="mt-1 size-3.5 shrink-0 text-primary" aria-hidden />{item}</li>)}</ul></article>)}</div></div>;
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
  const { t } = useI18n();
  const [pickerOpen, setPickerOpen] = React.useState(false);
  const [detailExpertId, setDetailExpertId] = React.useState<string | null>(null);
  const detailExpert = detailExpertId
    ? candidates.find((candidate) => candidate.expertId === detailExpertId) ?? findMockDigitalExpert(detailExpertId)
    : undefined;
  const roles = expertIds.map((id) => (candidates.find((candidate) => candidate.expertId === id) ?? findMockDigitalExpert(id))?.role ?? t("itv.legacy.roleUnavailable"));
  return <div data-testid="itv-expert-step"><div><p className="text-xs font-medium text-primary">{t("itv.analysis.next")}</p><h2 className="mt-1 text-2xl font-semibold">{t("itv.legacy.expertsTitle")}</h2><p className="mt-2 text-sm text-muted-foreground">{t("itv.legacy.expertsHint")}</p></div><div className="mt-6 grid gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]"><section className="rounded-xl border border-border bg-background p-4"><div className="flex items-center justify-between gap-3"><h3 className="font-semibold">{t("itv.legacy.candidates")}</h3><Button data-testid="itv-add-expert" type="button" variant="outline" size="sm" onClick={() => setPickerOpen(true)}><Plus className="size-4" aria-hidden />{t("itv.legacy.addDirectory")}</Button></div><div className="mt-4 grid gap-3">{expertIds.map((expertId, index) => { const expert = candidates.find((candidate) => candidate.expertId === expertId) ?? findMockDigitalExpert(expertId); const name = expert?.role ?? t("itv.legacy.roleUnavailable"); const actionName = roles.filter((role) => role === name).length > 1 ? t("itv.legacy.namedOrder", { name, count: index + 1 }) : name; return <article key={expertId} className="flex items-center justify-between gap-3 rounded-lg border border-border p-4"><ExpertAvatar expertId={expertId} displayName={expert?.displayName ?? name} /><div className="min-w-0"><strong>{name}</strong>{expert && <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">{expert.bio}</p>}</div><Button data-testid={`itv-expert-detail-trigger-${expertId}`} type="button" variant="ghost" size="sm" aria-label={t("itv.legacy.viewExpert", { name: actionName })} onClick={() => setDetailExpertId(expertId)}><Eye className="size-4" aria-hidden />{t("itv.legacy.details")}</Button></article>; })}</div></section><aside className="rounded-xl border border-primary/20 bg-primary/5 p-4"><p className="text-xs font-medium text-primary">{t("itv.legacy.selectedExperts")}</p><p className="mt-1 text-2xl font-semibold">{expertIds.length}<span className="ml-1 text-sm font-normal text-muted-foreground">{t("itv.legacy.peopleUnit")}</span></p><div className="mt-4 space-y-2">{expertIds.map((expertId, index) => { const expert = candidates.find((candidate) => candidate.expertId === expertId) ?? findMockDigitalExpert(expertId); const name = expert?.role ?? t("itv.legacy.roleUnavailable"); const actionName = roles.filter((role) => role === name).length > 1 ? t("itv.legacy.namedOrder", { name, count: index + 1 }) : name; return <div key={expertId} className="flex items-center justify-between gap-2 rounded-lg bg-card p-3"><ExpertAvatar expertId={expertId} displayName={expert?.displayName ?? name} /><span className="min-w-0 text-sm font-medium">{expert?.displayName ?? name}</span><Button type="button" variant="ghost" size="icon" disabled={expertIds.length <= 1} aria-label={t("itv.legacy.deleteExpert", { name: actionName })} onClick={() => onChange(expertIds.filter((id) => id !== expertId))}><Trash2 className="size-4" aria-hidden /></Button></div>; })}</div><Button data-testid="itv-confirm-experts" type="button" variant="primary" className="mt-5 w-full" disabled={!expertIds.length} onClick={onConfirm}>{t("itv.legacy.confirmOutline")}</Button></aside></div><ExpertPickerDialog open={pickerOpen} selectedExpertIds={expertIds} onOpenChange={setPickerOpen} onConfirm={onChange} experts={MOCK_DIGITAL_EXPERTS} description={t("itv.legacy.staticPicker")} /><ExpertDetailDialog expert={detailExpert} open={Boolean(detailExpertId)} onOpenChange={(open) => { if (!open) setDetailExpertId(null); }} /></div>;
}

function ExpertDetailDialog({ expert, open, onOpenChange }: { readonly expert: DigitalExpertCatalogRow | undefined; readonly open: boolean; readonly onOpenChange: (open: boolean) => void }) {
  const { t } = useI18n();
  const staticExpert = expert ? findMockDigitalExpert(expert.expertId) : undefined;
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent data-testid="itv-expert-detail-dialog" closeTestId="itv-expert-detail-close" className="max-h-[85vh] max-w-2xl overflow-y-auto"><DialogHeader><DialogTitle>{expert?.displayName ?? t("itv.legacy.expertDetail")}</DialogTitle><DialogDescription>{staticExpert ? t("itv.legacy.staticExpert") : t("itv.legacy.generatedExpert")}</DialogDescription></DialogHeader>{expert && <div className="space-y-4 text-sm"><ExpertAvatarEditor expertId={expert.expertId} displayName={expert.displayName} /><DetailField testId="itv-expert-detail-role" label={t("itv.legacy.role")} value={expert.role} /><DetailField testId="itv-expert-detail-category" label={t("itv.profile.category")} value={expert.category} /><DetailField testId="itv-expert-detail-occupation" label={t("itv.profile.occupation")} value={expert.occupation} /><DetailField testId="itv-expert-detail-age" label={t("itv.profile.age")} value={t("itv.legacy.years", { count: expert.age })} /><div data-testid="itv-expert-detail-domains"><p className="text-xs font-medium text-muted-foreground">{t("itv.legacy.domains")}</p><div className="mt-2 flex flex-wrap gap-2">{expert.domains.map((domain) => <span key={domain} className="rounded-full bg-muted px-2.5 py-1 text-xs">{domain}</span>)}</div></div><DetailField testId="itv-expert-detail-location" label={t("itv.legacy.location")} value={expert.location} /><DetailField testId="itv-expert-detail-bio" label={t("itv.experts.bio")} value={expert.bio} /><DetailList testId="itv-expert-detail-goals" label={t("itv.profile.goals")} values={expert.goals} /><DetailList testId="itv-expert-detail-interests" label={t("itv.profile.interests")} values={expert.interests} /><DetailList testId="itv-expert-detail-pain-points" label={t("itv.profile.painPoints")} values={expert.painPoints} /><DetailList testId="itv-expert-detail-motivations" label={t("itv.profile.motivations")} values={expert.motivations} /><DetailList testId="itv-expert-detail-influences" label={t("itv.legacy.influences")} values={expert.influences} /><DetailField testId="itv-expert-detail-traits" label={t("itv.legacy.traits")} value={t("itv.legacy.traitValues", { social: expert.personalityTraits.introvertExtrovert, creative: expert.personalityTraits.analyticalCreative, time: expert.personalityTraits.busyTimeRich })} /><DetailField testId="itv-expert-detail-service-value" label={t("itv.profile.serviceValue")} value={expert.serviceValue} /><DetailField testId="itv-expert-detail-advice" label={t("itv.profile.typicalAdvice")} value={expert.typicalAdvice} />{expert.materialContextPackId && <DetailField testId="itv-expert-detail-boundary" label={t("itv.legacy.boundary")} value={expert.materialBoundary} />}</div>}</DialogContent></Dialog>;
}

function DetailField({ testId, label, value }: { readonly testId: string; readonly label: string; readonly value: string }) {
  return <div data-testid={testId}><p className="text-xs font-medium text-muted-foreground">{label}</p><p className="mt-1 leading-6">{value}</p></div>;
}

function DetailList({ testId, label, values }: { readonly testId: string; readonly label: string; readonly values: readonly string[] }) {
  return <div data-testid={testId}><p className="text-xs font-medium text-muted-foreground">{label}</p><ul className="mt-1 list-disc space-y-1 pl-5 leading-6">{values.map((value) => <li key={value}>{value}</li>)}</ul></div>;
}

function LiveQuestionStep({ expertIds, candidates, questions, learningGoals, onChange, onConfirm }: { readonly expertIds: readonly string[]; readonly candidates: readonly DigitalExpertCatalogRow[]; readonly questions: readonly DigitalInterviewQuestion[]; readonly learningGoals: readonly DigitalInterviewResearchBrief["learningGoals"][number][]; readonly onChange: (questions: readonly DigitalInterviewQuestion[]) => void; readonly onConfirm: () => void }) {
  const { t } = useI18n();
  const addQuestion = (expertId: string) => onChange([...questions, { questionId: `manual-${crypto.randomUUID()}`, expertId, order: questions.length + 1, text: "", purpose: "手动问题", section: "core", goalIds: learningGoals.slice(0, 1).map((goal) => goal.goalId) }]);
  return <div><div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-xs font-medium text-primary">{t("itv.legacy.expertOutline")}</p><h2 className="mt-1 text-2xl font-semibold">{t("itv.legacy.questionsTitle")}</h2><p className="mt-2 text-sm text-muted-foreground">{t("itv.legacy.questionsSaved")}</p></div><span className="rounded-full bg-muted px-3 py-1.5 text-xs text-muted-foreground">{t("itv.legacy.questionCount", { count: questions.length })}</span></div><div className="mt-6 grid gap-5 lg:grid-cols-[13rem_minmax(0,1fr)]"><aside className="rounded-xl border border-border bg-background p-4"><p className="text-xs font-medium text-muted-foreground">{t("itv.legacy.selectedShort")}</p><div className="mt-3 space-y-2">{expertIds.map((expertId) => <div key={expertId} className="rounded-lg bg-muted p-3 text-sm font-medium">{candidates.find((candidate) => candidate.expertId === expertId)?.displayName ?? expertId}</div>)}</div></aside><div className="space-y-4">{expertIds.map((expertId) => <section data-testid="itv-question-group" key={expertId} className="rounded-xl border border-border p-4"><h3 className="flex items-center gap-3 font-semibold"><ExpertAvatar expertId={expertId} displayName={candidates.find((candidate) => candidate.expertId === expertId)?.displayName ?? t("itv.legacy.expertWord")} />{candidates.find((candidate) => candidate.expertId === expertId)?.displayName ?? expertId}</h3><p className="mt-1 text-xs text-muted-foreground">{t("itv.legacy.followupHint")}</p>{questions.filter((question) => question.expertId === expertId).map((question, index) => <div key={question.questionId} className="mt-3 rounded-lg bg-muted/50 p-3"><label htmlFor={question.questionId} className="text-xs font-medium text-muted-foreground">{t("itv.legacy.questionLabel", { count: index + 1, purpose: question.purpose })}</label><textarea id={question.questionId} rows={2} data-testid="itv-question-input" value={question.text} onChange={(event) => onChange(questions.map((candidate) => candidate.questionId === question.questionId ? { ...candidate, text: event.target.value } : candidate))} className="mt-2 w-full resize-y rounded-lg border border-input bg-background px-3 py-2 text-sm leading-6 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" /><div className="mt-3 grid gap-3 sm:grid-cols-2"><label className="grid gap-1 text-xs text-muted-foreground">{t("itv.legacy.section")}<select data-testid="itv-question-section" value={question.section} onChange={(event) => onChange(questions.map((candidate) => candidate.questionId === question.questionId ? { ...candidate, section: event.target.value as DigitalInterviewQuestion["section"] } : candidate))} className="rounded-md border border-input bg-background px-2 py-1.5 text-sm text-foreground"><option value="warmup">{t("itv.legacy.warmup")}</option><option value="core">{t("itv.legacy.core")}</option><option value="counterexample">{t("itv.legacy.counterexample")}</option><option value="closing">{t("itv.legacy.closing")}</option></select></label><fieldset><legend className="text-xs text-muted-foreground">{t("itv.legacy.goalCoverage")}</legend><div className="mt-1 flex flex-wrap gap-2">{learningGoals.map((goal) => <label key={goal.goalId} className="inline-flex items-center gap-1 text-xs"><input data-testid="itv-question-goal" type="checkbox" checked={question.goalIds.includes(goal.goalId)} onChange={() => onChange(questions.map((candidate) => candidate.questionId === question.questionId ? { ...candidate, goalIds: candidate.goalIds.includes(goal.goalId) ? candidate.goalIds.filter((id) => id !== goal.goalId) : [...candidate.goalIds, goal.goalId] } : candidate))} />{goal.statement}</label>)}</div></fieldset></div></div>)}<Button type="button" variant="outline" size="sm" className="mt-3" onClick={() => addQuestion(expertId)}><Plus className="size-4" aria-hidden />{t("itv.legacy.addFollowup")}</Button></section>)}</div></div><div className="mt-6 flex justify-end"><Button data-testid="itv-confirm-questions" variant="primary" disabled={!questions.length || questions.some((question) => !question.text.trim() || question.goalIds.length === 0)} onClick={onConfirm}>{t("itv.legacy.confirmStart")}</Button></div></div>;
}

function LiveReadOnlyStep({ title, text }: { readonly title: string; readonly text: string }) { return <div><h2 className="text-xl font-semibold">{title}</h2><p className="mt-2 text-sm text-muted-foreground">{text}</p></div>; }

function LiveRunStep({ runs, reportPending, onGenerateReport }: { readonly runs: DigitalInterviewWorkflowView["expertRuns"]; readonly reportPending: boolean; readonly onGenerateReport: () => void }) {
  const { t } = useI18n();
  const ready = runs.length > 0 && runs.every((run) => run.status !== "running") && runs.some((run) => run.status === "completed" && run.answers.length > 0);
  return <div data-testid="itv-expert-runs"><div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-xs font-medium text-primary">{t("itv.legacy.start")}</p><h2 className="mt-1 text-2xl font-semibold">{t("itv.legacy.runTitle")}</h2><p className="mt-2 text-sm text-muted-foreground">{t("itv.legacy.runHint")}</p></div><div className="rounded-xl bg-muted px-4 py-3 text-right"><p className="text-xs text-muted-foreground">{t("itv.legacy.progress")}</p><p className="mt-1 text-xl font-semibold">{runs.filter((run) => run.status === "completed").length}/{runs.length || 0}</p></div></div><div className="mt-6 space-y-4">{runs.map((run) => <article key={run.expertId} data-testid="itv-expert-run" className="rounded-xl border border-border bg-background p-5"><div className="flex items-center justify-between gap-3"><div><h3 className="flex items-center gap-3 font-semibold"><ExpertAvatar expertId={run.expertId} displayName={run.displayName} />{run.displayName}</h3><p className="mt-1 text-xs text-muted-foreground">{t("itv.legacy.simulatedRun")}</p></div><span className="rounded-full bg-muted px-3 py-1 text-xs text-muted-foreground">{run.status === "completed" ? t("itv.runs.completed") : run.status === "failed" ? t("itv.legacy.failed") : t("itv.running")} · {run.completedQuestions}/{run.totalQuestions}</span></div>{run.errorCode && <p role="alert" className="mt-3 text-sm text-destructive">{run.errorCode}</p>}<div className="mt-4 space-y-3">{run.answers.map((answer) => <section id={`answer-${run.expertId}-${answer.questionId}`} key={answer.questionId} className="scroll-mt-6 rounded-lg border border-border bg-muted/30 p-4"><p className="text-sm font-medium">{answer.question}</p><p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-muted-foreground">{answer.answer}</p></section>)}</div></article>)}</div>{runs.length === 0 && <p data-testid="itv-runs-empty" className="mt-5 rounded-lg border border-dashed border-border p-5 text-sm text-muted-foreground">{t("itv.legacy.creatingTasks")}</p>}<div className="mt-6 flex justify-end"><Button data-testid="itv-confirm-answers-generate-report" variant="primary" size="lg" disabled={!ready || reportPending} onClick={onGenerateReport}>{reportPending ? t("itv.runs.generatingReport") : t("itv.generateReport")}</Button></div></div>;
}

function LiveReportStep({ interviewId, report, boundary, generation, error, onRetry, onViewSource }: { readonly interviewId: string; readonly report: NonNullable<DigitalInterviewWorkflowView["report"]>; readonly boundary: { readonly evidenceMode: DigitalInterviewWorkflowView["studyEvidenceMode"]; readonly review: DigitalInterviewWorkflowView["reportEvidenceEligibility"] }; readonly generation: DigitalInterviewWorkflowView["reportGeneration"]; readonly error: string; readonly onRetry: () => void; readonly onViewSource: (expertId: string, questionId: string) => void }) {
  const { t, locale } = useI18n();
  const retryFailed = generation?.status === "failed" || Boolean(error);
  const quality = interviewMarkdown.assessInterviewReportAnalysis(report.markdown);
  const canExport = quality.ok && interviewMarkdown.hasInterviewReportVerifiableAction(report.markdown);
  return <div id="itv-report-print-root" data-testid="itv-report"><div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-xs font-medium text-primary">{t("itv.legacy.reportSummary")}</p><h2 className="mt-1 text-2xl font-semibold">{report.title}</h2></div><div className="flex flex-wrap gap-2 print:hidden">{canExport && <a data-testid="itv-report-current-files" className="text-sm text-primary underline underline-offset-4" href={`/itv/${encodeURIComponent(interviewId)}/report`}>{t("itv.legacy.currentFiles")}</a>}</div></div>{!canExport && <div data-testid="itv-live-report-quality" className="mt-4 rounded-lg border border-warning/40 bg-warning/5 p-4 text-sm"><p className="font-semibold">{t("itv.legacy.exportBlocked")}</p><p className="mt-1 text-muted-foreground">{t("itv.legacy.missingQuality", { gaps: quality.missing.map(gap => t(legacyQualityKeys[gap])).join(locale === "zh-CN" ? "、" : ", ") })}</p></div>}{retryFailed && <div className="mt-4 rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm"><p role="alert">{t("itv.legacy.reportOperationFailed", { detail: generation?.errorCode || error || "AI_GENERATION_UNAVAILABLE" })}</p><p className="mt-1">{t("itv.legacy.regenerationFailed")}</p><Button className="mt-3" type="button" variant="outline" onClick={onRetry}>{t("itv.legacy.regenerateReport")}</Button></div>}<section data-testid="itv-report-decision-brief" className="mt-5 border-l-2 border-primary/70 pl-4"><p data-testid="itv-study-evidence-label" className="text-xs font-medium text-muted-foreground">{t(boundary.evidenceMode === "simulated" ? "itv.legacy.evidence.simulated" : boundary.evidenceMode === "mixed" ? "itv.legacy.evidence.mixed" : "itv.legacy.evidence.participant")}</p><h3 className="mt-2 text-sm font-semibold">{t("itv.legacy.decisionSummary")}</h3><p className="mt-2 leading-7 text-muted-foreground">{report.executiveSummary}</p><p className="mt-2 text-sm">{boundary.review.message}</p><p className="mt-1 text-sm text-muted-foreground">{t("itv.legacy.nextAction", { action: boundary.review.action ?? t("itv.legacy.maySubmit") })}</p></section><div className="mt-7"><InterviewReportMarkdown markdown={reportMarkdownBody(report.title, report.markdown)} testId="itv-report-markdown" /></div><div className="mt-8 space-y-3"><h3 className="font-semibold">{t("itv.legacy.findings")}</h3>{report.findings.map((finding) => <article key={finding.findingId} className="rounded-lg border border-border bg-background p-4"><strong>{finding.title}</strong><p className="mt-2 text-sm leading-6 text-muted-foreground">{finding.summary}</p><Button type="button" variant="ghost" size="sm" className="mt-3 print:hidden" onClick={() => onViewSource(finding.expertId, finding.questionId)}>{t("itv.legacy.viewAnswer")}</Button></article>)}</div></div>;
}

function LiveReportGenerationStep({ generation, onRetry }: { readonly generation: NonNullable<DigitalInterviewWorkflowView["reportGeneration"]>; readonly onRetry: () => void }) {
  const { t } = useI18n();
  return <div data-testid="itv-report-generation">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h2 className="text-xl font-semibold">{generation.title ?? t("itv.legacy.generatingTitle")}</h2>
      <span className="rounded-full bg-muted px-3 py-1 text-xs text-muted-foreground">
        {generation.status === "running" ? t("itv.legacy.streaming") : t("itv.legacy.generationFailed")}
      </span>
    </div>
    {generation.executiveSummary && <p className="mt-3 leading-7 text-muted-foreground">{generation.executiveSummary}</p>}
    {generation.markdown
      ? <InterviewReportMarkdown markdown={generation.markdown} testId="itv-report-stream-markdown" />
      : generation.status === "running" && <p className="mt-5 text-sm text-muted-foreground">{t("itv.legacy.firstContent")}</p>}
    {generation.findings.length > 0 && <div className="mt-8 space-y-3"><h3 className="font-semibold">{t("itv.legacy.generatedFindings")}</h3>{generation.findings.map((finding) => <article key={finding.findingId} className="rounded-lg border border-border p-4"><strong>{finding.title}</strong><p className="mt-2 text-sm leading-6 text-muted-foreground">{finding.summary}</p><p className="mt-3 text-xs text-muted-foreground">{t("itv.legacy.exploratory")}</p></article>)}</div>}
    {generation.status === "failed" && <div className="mt-5 rounded-lg border border-destructive/20 bg-destructive/5 p-3"><p role="alert" className="text-sm text-destructive">{generation.errorCode === "AI_GENERATION_UNAVAILABLE" ? t("itv.legacy.modelUnavailable") : t("itv.legacy.reportUnavailable")}{t("itv.legacy.generatedPreserved")}</p><Button data-testid="itv-retry-report" type="button" variant="outline" className="mt-3" onClick={onRetry}>{t("itv.legacy.regenerateReport")}</Button></div>}
  </div>;
}

function UnsavedChangesDialog({ onKeepEditing, onDiscard }: { readonly onKeepEditing: () => void; readonly onDiscard: () => void }) {
  const { t } = useI18n();
  return <div role="alert" className="fixed inset-0 z-50 flex items-center justify-center bg-background-foreground/35 p-4"><div className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-lg"><h2 className="text-lg font-semibold">{t("itv.legacy.unsavedTitle")}</h2><p className="mt-2 text-sm text-muted-foreground">{t("itv.legacy.unsavedHint")}</p><div className="mt-6 flex justify-end gap-3"><Button type="button" variant="outline" onClick={onKeepEditing}>{t("itv.legacy.keepEditing")}</Button><Button type="button" variant="destructive" onClick={onDiscard}>{t("itv.legacy.discard")}</Button></div></div></div>;
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
