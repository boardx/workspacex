"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, CheckCircle2, Eye, Plus, Play, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  appendDigitalInterviewSkillMessage,
  applyDigitalInterviewSkillProposal,
  confirmDigitalInterviewExperts,
  confirmDigitalInterviewQuestions,
  confirmDigitalInterviewTopic,
  rejectDigitalInterviewSkillProposal,
  type DigitalInterviewQuestion,
  type DigitalInterviewStep,
  type DigitalInterviewWorkflowView,
  type DigitalExpertCatalogRow,
  type DigitalInterviewSkillDraftContext,
} from "@/lib/interview-api";
import { MOCK_DIGITAL_EXPERTS, findMockDigitalExpert, toDigitalExpertCatalogRow } from "@/lib/mock/digital-expert-personas";
import { ExpertPickerDialog } from "./expert-picker-dialog";
import { InterviewSkillAssistant, PersistentInterviewSkillAssistant } from "./interview-skill-assistant";
import { reconcileMockInterviewQuestions, updateMockDigitalInterviewDraft, type MockDigitalInterviewDraft, type MockInterviewStep, type MockSkillSuggestion } from "@/lib/mock/digital-interview-drafts";

const STEPS = ["主题", "专家", "问题", "访谈", "报告"] as const;

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
function ReportStep({ draft }: { draft: MockDigitalInterviewDraft }) { const report = draft.reportMarkdown || reportFor(draft, false); return <div><h2 className="text-xl font-semibold">访谈报告</h2><div className="mt-3 rounded-lg border border-primary/20 bg-primary/5 p-3 text-xs text-muted-foreground">Mock 探索性报告，不作为真实证据</div><pre data-testid="itv-report-markdown" className="mt-5 whitespace-pre-wrap font-sans text-sm leading-7">{report}</pre><ol data-testid="itv-report-timeline" className="mt-6 border-l border-border pl-5 text-sm"><li><CheckCircle2 className="mr-2 inline size-4 text-primary" aria-hidden />主题与专家已确认</li><li className="mt-3"><CheckCircle2 className="mr-2 inline size-4 text-primary" aria-hidden />Mock 访谈已完成</li><li className="mt-3"><CheckCircle2 className="mr-2 inline size-4 text-primary" aria-hidden />报告已生成</li></ol></div>; }
function reportFor(draft: MockDigitalInterviewDraft, structured: boolean): string { return `# ${draft.name}\n\n> Mock 探索性内容，不作为真实证据。\n\n## ${structured ? "报告摘要" : "关键发现"}\n\n围绕“${draft.topic || draft.name}”，数字专家给出了角色、否决条件与待验证假设。\n\n## 待验证假设\n\n- 决策权与预算责任可能并不属于同一角色。\n- 需要用真实访谈补充反例与来源。`; }

const LIVE_STEPS: readonly { readonly id: DigitalInterviewStep; readonly label: string }[] = [
  { id: "topic", label: "主题" }, { id: "experts", label: "专家" }, { id: "questions", label: "问题" }, { id: "runs", label: "访谈" }, { id: "report", label: "报告" },
];

type LiveBuffers = { readonly topic: string; readonly expertIds: readonly string[]; readonly questions: readonly DigitalInterviewQuestion[] };
type PendingNavigation = { readonly step?: DigitalInterviewStep; readonly href?: string } | null;

function buffersFrom(view: DigitalInterviewWorkflowView): LiveBuffers {
  return {
    topic: view.topic ?? "",
    expertIds: view.selectedExpertIds.length ? view.selectedExpertIds : view.expertCandidates.map((expert) => expert.expertId),
    questions: view.questions.length ? view.questions : view.questionCandidates,
  };
}

/** Live workflow deliberately has no persistence side effects on input events. */
export function PersistentDigitalInterviewWorkflow({ initialView }: { readonly initialView: DigitalInterviewWorkflowView }) {
  const router = useRouter();
  const [view, setView] = React.useState(initialView);
  const [buffers, setBuffers] = React.useState<LiveBuffers>(() => buffersFrom(initialView));
  const [dirty, setDirty] = React.useState(false);
  const [error, setError] = React.useState("");
  const [pendingNavigation, setPendingNavigation] = React.useState<PendingNavigation>(null);
  const requestIds = React.useRef(new Map<string, { readonly fingerprint: string; readonly requestId: string }>());

  React.useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (!dirty) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

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
    if (next?.step) setView((current) => ({ ...current, currentStep: next.step! }));
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
    const payload = { questions: buffers.questions, expectedVersion: view.version };
    const operation = "confirm-questions";
    try {
      const next = await confirmDigitalInterviewQuestions({ interviewId: view.interviewId, ...payload, requestId: requestIdFor(operation, payload) });
      replaceAfterConfirmation(next, operation);
    } catch (cause) { showError(cause); }
  }

  async function sendSkillMessage(text: string) {
    const payload = { currentStep: view.currentStep, text, draftContext: skillDraftContext(view.currentStep, buffers, view.name), expectedVersion: view.version };
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

  const active = view.currentStep;
  return <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
    <PersistentInterviewSkillAssistant view={view} currentStep={active} onSend={sendSkillMessage} onApply={applyProposal} onReject={rejectProposal} />
    <main className="min-w-0 flex-1 overflow-y-auto bg-background p-6 lg:p-10"><div className="mx-auto max-w-5xl">
      <header className="flex items-start justify-between gap-4"><div><p className="text-xs text-primary">批量访谈流程</p><h1 className="mt-2 text-3xl font-semibold">{view.name}</h1><div className="mt-3 flex flex-wrap gap-2">{view.tags.map((tag) => <span key={tag} className="rounded-md bg-muted px-2 py-1 text-xs text-muted-foreground">{tag}</span>)}</div></div><button data-testid="itv-return-history" type="button" onClick={() => requestNavigation({ href: "/itv?tab=history" })} className="inline-flex shrink-0 items-center gap-2 rounded-lg border border-border bg-background px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted"><ArrowLeft className="size-4" aria-hidden />返回访谈列表</button></header>
      <div className="mt-4 flex flex-wrap gap-3 text-xs text-muted-foreground"><span data-testid="itv-workflow-status">{view.status}</span><span data-testid="itv-workflow-version">版本 {view.version}</span>{view.topic && <span data-testid="itv-persisted-topic">已确认主题：{view.topic}</span>}</div>
      <ol className="mt-7 grid gap-2 sm:grid-cols-5">{LIVE_STEPS.map((step, index) => <li key={step.id}><button data-testid={`itv-workflow-step-${index + 1}`} type="button" aria-current={active === step.id ? "step" : undefined} onClick={() => requestNavigation({ step: step.id })} className={active === step.id ? "w-full rounded-lg bg-primary p-3 text-left text-xs font-medium text-primary-foreground" : "w-full rounded-lg border border-border p-3 text-left text-xs text-muted-foreground"}>0{index + 1} {step.label}</button></li>)}</ol>
      {error && <p role="alert" className="mt-4 rounded-lg border border-destructive/20 bg-destructive/5 p-3 text-sm text-destructive">操作未完成：{error}。请重试，当前草稿已保留。</p>}
      <section className="mt-8 rounded-2xl border border-border bg-card p-6 shadow-sm lg:p-8">
        {active === "topic" && <LiveTopicStep topic={buffers.topic} onChange={(topic) => { setBuffers((current) => ({ ...current, topic })); setDirty(true); }} onConfirm={() => void confirmTopic()} />}
        {active === "experts" && <LiveExpertStep expertIds={buffers.expertIds} candidates={view.expertCandidates} onChange={(expertIds) => { setBuffers((current) => ({ ...current, expertIds })); setDirty(true); }} onConfirm={() => void confirmExperts()} />}
        {active === "questions" && <LiveQuestionStep expertIds={buffers.expertIds} candidates={view.expertCandidates} questions={buffers.questions} onChange={(questions) => { setBuffers((current) => ({ ...current, questions })); setDirty(true); }} onConfirm={() => void confirmQuestions()} />}
        {active === "runs" && <LiveReadOnlyStep title="执行批量访谈" text="访谈执行进度会以服务端状态恢复。" />}
        {active === "report" && <LiveReadOnlyStep title="访谈报告" text="报告和来源会在服务端生成后显示。" />}
      </section>
    </div></main>
    {pendingNavigation && <UnsavedChangesDialog onKeepEditing={() => setPendingNavigation(null)} onDiscard={discardAndNavigate} />}
  </div>;
}

function skillDraftContext(step: DigitalInterviewStep, buffers: LiveBuffers, fallbackTopic: string): DigitalInterviewSkillDraftContext {
  if (step === "topic") return { step, topic: buffers.topic.trim() || fallbackTopic };
  if (step === "experts") return { step, expertIds: [...buffers.expertIds] };
  if (step === "questions") return { step, questions: [...buffers.questions] };
  if (step === "runs") return { step, instruction: "继续执行当前访谈" };
  return { step, instruction: "检查当前访谈报告" };
}

function LiveTopicStep({ topic, onChange, onConfirm }: { readonly topic: string; readonly onChange: (topic: string) => void; readonly onConfirm: () => void }) {
  return <div><h2 className="text-xl font-semibold">确认访谈主题</h2><textarea data-testid="itv-topic-input" value={topic} onChange={(event) => onChange(event.target.value)} placeholder="用一句业务问题说明需要验证什么" className="mt-5 min-h-40 w-full rounded-lg border border-input bg-background p-3" /><Button data-testid="itv-confirm-topic" className="mt-5" variant="primary" size="lg" disabled={!topic.trim()} onClick={onConfirm}>确认主题并生成专家</Button></div>;
}

function LiveExpertStep({ expertIds, candidates, onChange, onConfirm }: { readonly expertIds: readonly string[]; readonly candidates: readonly DigitalExpertCatalogRow[]; readonly onChange: (expertIds: readonly string[]) => void; readonly onConfirm: () => void }) {
  const [pickerOpen, setPickerOpen] = React.useState(false);
  const [detailExpertId, setDetailExpertId] = React.useState<string | null>(null);
  const detailExpert = detailExpertId
    ? candidates.find((candidate) => candidate.expertId === detailExpertId) ?? findMockDigitalExpert(detailExpertId)
    : undefined;
  return <div data-testid="itv-expert-step"><h2 className="text-xl font-semibold">确认访谈专家</h2><p className="mt-2 text-sm text-muted-foreground">审核模型生成的专家，也可以从静态专家列表添加互补角色。</p><div className="mt-5 grid gap-3">{expertIds.map((expertId) => { const expert = candidates.find((candidate) => candidate.expertId === expertId) ?? findMockDigitalExpert(expertId); const name = expert?.displayName ?? expertId; return <article key={expertId} className="flex items-center justify-between gap-3 rounded-lg border border-border p-4"><div className="min-w-0"><strong>{name}</strong>{expert && <p className="mt-1 text-xs text-muted-foreground">{expert.role} · {expert.materialBoundary}</p>}</div><div className="flex shrink-0 items-center gap-1"><button data-testid={`itv-expert-detail-trigger-${expertId}`} type="button" aria-label={`查看专家详情 ${name}`} onClick={() => setDetailExpertId(expertId)} className="inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"><Eye className="size-4" aria-hidden />查看详情</button><button type="button" disabled={expertIds.length <= 1} aria-label={`删除专家 ${name}`} onClick={() => onChange(expertIds.filter((id) => id !== expertId))} className="rounded-md p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:text-disabled-foreground"><Trash2 className="size-4" aria-hidden /></button></div></article>; })}</div><div className="mt-5 flex flex-wrap gap-3"><Button data-testid="itv-add-expert" type="button" variant="outline" onClick={() => setPickerOpen(true)}><Plus className="size-4" aria-hidden />添加专家</Button><Button data-testid="itv-confirm-experts" type="button" variant="primary" disabled={!expertIds.length} onClick={onConfirm}>确认并生成问题</Button></div><ExpertPickerDialog open={pickerOpen} selectedExpertIds={expertIds} onOpenChange={setPickerOpen} onConfirm={onChange} experts={MOCK_DIGITAL_EXPERTS} description="从静态专家列表中选择，本次选择会追加到访谈。" /><ExpertDetailDialog expert={detailExpert} open={Boolean(detailExpertId)} onOpenChange={(open) => { if (!open) setDetailExpertId(null); }} /></div>;
}

function ExpertDetailDialog({ expert, open, onOpenChange }: { readonly expert: DigitalExpertCatalogRow | undefined; readonly open: boolean; readonly onOpenChange: (open: boolean) => void }) {
  const staticExpert = expert ? findMockDigitalExpert(expert.expertId) : undefined;
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent data-testid="itv-expert-detail-dialog" closeTestId="itv-expert-detail-close" className="max-w-xl"><DialogHeader><DialogTitle>{expert?.displayName ?? "专家详情"}</DialogTitle><DialogDescription>{staticExpert ? "静态专家档案" : "模型生成专家档案"}</DialogDescription></DialogHeader>{expert && <div className="space-y-4 text-sm"><DetailField testId="itv-expert-detail-role" label="角色" value={expert.role} /><DetailField testId="itv-expert-detail-category" label="分类" value={expert.category} /><div data-testid="itv-expert-detail-domains"><p className="text-xs font-medium text-muted-foreground">领域</p><div className="mt-2 flex flex-wrap gap-2">{expert.domains.map((domain) => <span key={domain} className="rounded-full bg-muted px-2.5 py-1 text-xs">{domain}</span>)}</div></div><DetailField testId="itv-expert-detail-location" label="地区" value={expert.location} /><DetailField testId="itv-expert-detail-bio" label="简介" value={expert.bio} /><DetailField testId="itv-expert-detail-advice" label="典型建议" value={expert.typicalAdvice} /><DetailField testId="itv-expert-detail-boundary" label="材料边界" value={expert.materialBoundary} /></div>}</DialogContent></Dialog>;
}

function DetailField({ testId, label, value }: { readonly testId: string; readonly label: string; readonly value: string }) {
  return <div data-testid={testId}><p className="text-xs font-medium text-muted-foreground">{label}</p><p className="mt-1 leading-6">{value}</p></div>;
}

function LiveQuestionStep({ expertIds, candidates, questions, onChange, onConfirm }: { readonly expertIds: readonly string[]; readonly candidates: readonly DigitalExpertCatalogRow[]; readonly questions: readonly DigitalInterviewQuestion[]; readonly onChange: (questions: readonly DigitalInterviewQuestion[]) => void; readonly onConfirm: () => void }) {
  const addQuestion = (expertId: string) => onChange([...questions, { questionId: `manual-${crypto.randomUUID()}`, expertId, order: questions.length + 1, text: "", purpose: "手动问题" }]);
  return <div><h2 className="text-xl font-semibold">确认针对性问题</h2><div className="mt-4 space-y-4">{expertIds.map((expertId) => <section data-testid="itv-question-group" key={expertId} className="rounded-xl border border-border p-4"><h3 className="font-semibold">{candidates.find((candidate) => candidate.expertId === expertId)?.displayName ?? expertId}</h3>{questions.filter((question) => question.expertId === expertId).map((question) => <textarea key={question.questionId} rows={2} data-testid="itv-question-input" value={question.text} onChange={(event) => onChange(questions.map((candidate) => candidate.questionId === question.questionId ? { ...candidate, text: event.target.value } : candidate))} className="mt-3 w-full resize-y rounded-lg border border-input bg-background px-3 py-2 text-sm" />)}<Button type="button" variant="outline" size="sm" className="mt-3" onClick={() => addQuestion(expertId)}><Plus className="size-4" aria-hidden />添加问题</Button></section>)}</div><Button data-testid="itv-confirm-questions" className="mt-5" variant="primary" disabled={!questions.length || questions.some((question) => !question.text.trim())} onClick={onConfirm}>确认问题并进入访谈</Button></div>;
}

function LiveReadOnlyStep({ title, text }: { readonly title: string; readonly text: string }) { return <div><h2 className="text-xl font-semibold">{title}</h2><p className="mt-2 text-sm text-muted-foreground">{text}</p></div>; }

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
