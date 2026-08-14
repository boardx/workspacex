"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowLeft, CheckCircle2, Plus, Play, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MOCK_DIGITAL_EXPERTS, findMockDigitalExpert } from "@/lib/mock/digital-expert-personas";
import { ExpertPickerDialog } from "./expert-picker-dialog";
import { InterviewSkillAssistant } from "./interview-skill-assistant";
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
        <header className="flex items-start justify-between gap-4"><div><p className="text-xs text-primary">Mock 批量访谈流程</p><h1 className="mt-2 text-3xl font-semibold">{draft.name}</h1><div className="mt-3 flex flex-wrap gap-2">{draft.tags.map((tag) => <span key={tag} className="rounded-md bg-muted px-2 py-1 text-xs text-muted-foreground">{tag}</span>)}</div></div><Link href="/itv?tab=history" className="inline-flex shrink-0 items-center gap-2 rounded-lg border border-border bg-background px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted"><ArrowLeft className="size-4" />返回访谈列表</Link></header>
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
  return <div><h2 className="text-xl font-semibold">确认访谈专家</h2><p className="mt-2 text-sm text-muted-foreground">审核系统推荐的专家，也可以从完整目录添加互补角色。</p><div className="mt-5 grid gap-3">{draft.selectedExpertIds.map((id) => { const expert = findMockDigitalExpert(id); return <article data-testid="itv-selected-expert" key={id} className="flex items-center justify-between rounded-lg border border-border p-4"><div><strong>{expert?.displayName}</strong><p className="text-xs text-muted-foreground">{expert?.role} · Mock 专家</p></div><button type="button" aria-label={`删除专家 ${expert?.displayName}`} onClick={() => onRemove(id)} disabled={draft.selectedExpertIds.length <= 1} className="rounded-md p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:bg-disabled disabled:text-disabled-foreground"><Trash2 className="size-4" /></button></article>; })}</div><div className="mt-5 flex flex-wrap gap-3"><Button data-testid="itv-add-expert" type="button" variant="outline" onClick={() => setPickerOpen(true)}><Plus className="size-4" />添加专家</Button><Button data-testid="itv-confirm-experts" type="button" variant="primary" disabled={!draft.selectedExpertIds.length} onClick={onConfirm}>确认并生成问题</Button></div><ExpertPickerDialog open={pickerOpen} selectedExpertIds={draft.selectedExpertIds} onOpenChange={setPickerOpen} onConfirm={onAdd} /></div>;
}
function QuestionStep({ draft, onChange, onAdd, onDelete, onConfirm }: { draft: MockDigitalInterviewDraft; onChange: (questionId: string, text: string) => void; onAdd: (expertId: string) => void; onDelete: (questionId: string) => void; onConfirm: () => void }) {
  return <div><h2 className="text-xl font-semibold">确认针对性问题</h2><p className="mt-2 text-sm text-muted-foreground">每位专家默认 3 个问题，你可以逐条编辑、删除并继续补充追问。</p><div className="mt-4 space-y-4">{draft.selectedExpertIds.map((expertId) => { const expert = findMockDigitalExpert(expertId); const questions = draft.questions.filter((question) => question.expertId === expertId); return <section data-testid="itv-question-group" key={expertId} className="rounded-xl border border-border p-4"><header className="flex items-baseline gap-2"><h3 className="font-semibold">{expert?.displayName}</h3><p className="text-xs text-muted-foreground">{expert?.role} · {questions.length} 个问题</p></header><div className="mt-3 space-y-3">{questions.map((question, index) => <div key={question.questionId} className="rounded-lg bg-muted/35 p-3"><div className="mb-1.5 flex items-center justify-between gap-3"><label htmlFor={question.questionId} className="text-xs font-medium">问题 {index + 1} · {question.purpose}</label><button data-testid="itv-delete-question" type="button" aria-label={`删除${expert?.displayName}的问题 ${index + 1}`} onClick={() => onDelete(question.questionId)} className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"><Trash2 className="size-4" /></button></div><textarea rows={2} id={question.questionId} data-testid="itv-question-input" value={question.text} onChange={(event) => onChange(question.questionId, event.target.value)} placeholder="输入针对这位专家的问题" className="w-full resize-y rounded-lg border border-input bg-background px-3 py-2 text-sm leading-5" /></div>)}</div><Button data-testid="itv-add-question" type="button" variant="outline" size="sm" className="mt-3" onClick={() => onAdd(expertId)}><Plus className="size-4" />添加问题</Button></section>; })}</div><Button data-testid="itv-confirm-questions" className="mt-5" variant="primary" disabled={!draft.questions.length || draft.questions.some((question) => !question.text.trim())} onClick={onConfirm}>确认问题并进入访谈</Button></div>;
}
function RunStep({ draft, onRun }: { draft: MockDigitalInterviewDraft; onRun: () => void }) { return <div><h2 className="text-xl font-semibold">执行 Mock 访谈</h2><p className="mt-2 text-sm text-muted-foreground">将为 {draft.selectedExpertIds.length} 位数字专家生成探索性回答。</p><div className="mt-5 grid gap-3">{draft.selectedExpertIds.map((id) => <div key={id} className="flex items-center justify-between rounded-lg border border-border p-4"><span>{findMockDigitalExpert(id)?.displayName}</span><span className="text-xs text-muted-foreground">等待开始</span></div>)}</div><Button data-testid="itv-run-all" className="mt-5" variant="primary" onClick={onRun}><Play className="size-4" />开始全部访谈</Button></div>; }
function ReportStep({ draft }: { draft: MockDigitalInterviewDraft }) { const report = draft.reportMarkdown || reportFor(draft, false); return <div><h2 className="text-xl font-semibold">访谈报告</h2><div className="mt-3 rounded-lg border border-primary/20 bg-primary/5 p-3 text-xs text-muted-foreground">Mock 探索性报告，不作为真实证据</div><pre data-testid="itv-report-markdown" className="mt-5 whitespace-pre-wrap font-sans text-sm leading-7">{report}</pre><ol data-testid="itv-report-timeline" className="mt-6 border-l border-border pl-5 text-sm"><li><CheckCircle2 className="mr-2 inline size-4 text-primary" />主题与专家已确认</li><li className="mt-3"><CheckCircle2 className="mr-2 inline size-4 text-primary" />Mock 访谈已完成</li><li className="mt-3"><CheckCircle2 className="mr-2 inline size-4 text-primary" />报告已生成</li></ol></div>; }
function reportFor(draft: MockDigitalInterviewDraft, structured: boolean): string { return `# ${draft.name}\n\n> Mock 探索性内容，不作为真实证据。\n\n## ${structured ? "报告摘要" : "关键发现"}\n\n围绕“${draft.topic || draft.name}”，数字专家给出了角色、否决条件与待验证假设。\n\n## 待验证假设\n\n- 决策权与预算责任可能并不属于同一角色。\n- 需要用真实访谈补充反例与来源。`; }
