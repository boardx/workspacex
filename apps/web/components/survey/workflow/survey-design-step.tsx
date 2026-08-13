"use client";

import * as React from "react";
import { GripVertical, Plus, Sparkles, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Toggle } from "@/components/ui/toggle";
import type { survey } from "@repo/contracts";
import { SectionTitle } from "./survey-workflow-shell";
import { useSectionNavigation } from "./use-section-navigation";

export function SurveyDesignStep({ model, setModel, readonly }: { model: survey.SurveyWorkflowModel; setModel: React.Dispatch<React.SetStateAction<survey.SurveyWorkflowModel>>; readonly: boolean }) {
  const [prompt, setPrompt] = React.useState("");
  const questionIds = React.useMemo(() => model.questions.map((question) => question.id), [model.questions]);
  const { activeId, navigateTo } = useSectionNavigation(questionIds, "survey-question");
  const activeQuestion = model.questions.find((question) => question.id === activeId) ?? model.questions[0];

  const updateQuestion = (questionId: string, patch: Partial<survey.SurveyWorkflowQuestion>) => {
    setModel((current) => ({
      ...current,
      questions: current.questions.map((question) => question.id === questionId ? { ...question, ...patch } : question),
    }));
  };

  return <div className="grid min-h-[calc(100vh-9rem)] grid-cols-1 xl:grid-cols-[22rem_minmax(28rem,1fr)_22rem]">
    <aside className="border-b border-border bg-card p-4 xl:sticky xl:top-0 xl:self-start xl:border-b-0 xl:border-r" data-testid="survey-design-question-list">
      <div className="mb-3 flex items-center justify-between"><h2 className="text-14 font-semibold">问题目录（{model.questions.length}）</h2>{!readonly && <Button size="xs" variant="ghost"><Plus className="h-3 w-3" />新增问题</Button>}</div>
      <p className="mb-3 text-10 text-muted-foreground">快捷定位问题，也可直接向下连续查看</p>
      <ol className="space-y-1">{model.questions.map((question) => <li key={question.id}><button type="button" data-testid={`survey-design-nav-${question.id}`} aria-current={activeId === question.id ? "location" : undefined} onClick={() => navigateTo(question.id)} className={`flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-11 transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${activeId === question.id ? "bg-accent text-primary" : "hover:bg-muted"}`}><span className="w-5 font-medium">{question.order}.</span><span className="min-w-0 flex-1 truncate">{question.title}</span><GripVertical className="h-3 w-3 text-muted-foreground" /></button></li>)}</ol>
    </aside>

    <section className="space-y-5 p-5" data-testid="survey-design-question-editor">
      <SectionTitle title="问题编辑" description="全部问题按顺序连续呈现，滚动即可查看和编辑" />
      {model.questions.map((question) => <QuestionEditor key={question.id} question={question} readonly={readonly} active={activeId === question.id} onUpdate={(patch) => updateQuestion(question.id, patch)} />)}
    </section>

    <aside className="border-t border-border bg-card p-5 xl:sticky xl:top-0 xl:self-start xl:border-l xl:border-t-0" data-testid="survey-design-ai-assistant">
      <SectionTitle icon={<Sparkles className="h-5 w-5 text-primary" />} title="AI 助手" description={activeQuestion ? `当前问题：${activeQuestion.id}` : undefined} />
      <div className="rounded-lg bg-ai-tint p-4 text-12"><p className="font-medium">我是您的问卷设计助手</p><p className="mt-2 text-muted-foreground">我会基于行业实践提供可预览、可确认的优化建议，不会自动覆盖题目。</p></div>
      <p className="mt-5 text-12 font-medium">您可以尝试</p><div className="mt-2 space-y-2">{["优化当前问题表述", "检查问卷逻辑与结构", "补充缺失的关键问题"].map((label) => <Button key={label} className="w-full justify-start" variant="outline" size="sm">{label}</Button>)}</div>
      <div className="mt-5"><Label htmlFor="ai-prompt">告诉我您想优化的内容</Label><Textarea id="ai-prompt" className="mt-2" rows={7} placeholder="例如：请优化本章节的结构与问题顺序…" value={prompt} disabled={readonly} onChange={(event) => setPrompt(event.target.value)} /></div>
      {!readonly && <div className="mt-3 grid grid-cols-2 gap-2"><Button variant="outline" size="sm">重新生成章节</Button><Button variant="primary" size="sm">生成变更预览</Button></div>}
    </aside>
  </div>;
}

function QuestionEditor({ question, readonly, active, onUpdate }: { question: survey.SurveyWorkflowQuestion; readonly: boolean; active: boolean; onUpdate: (patch: Partial<survey.SurveyWorkflowQuestion>) => void }) {
  const titleId = `question-title-${question.id}`;
  const typeId = `question-type-${question.id}`;
  const chapterId = `question-chapter-${question.id}`;
  return <article id={`survey-question-${question.id}`} data-section-id={question.id} data-testid={`survey-design-question-${question.id}`} className={`scroll-mt-4 rounded-lg border bg-card p-4 shadow-sm transition-colors ${active ? "border-primary/60" : "border-border"}`}>
    <div className="mb-4 flex items-center justify-between"><div><p className="text-10 font-medium text-primary">问题 {question.order}</p><h3 className="text-15 font-semibold">{question.id}</h3></div><span className="rounded-full bg-muted px-2.5 py-1 text-10 text-muted-foreground">{question.type === "single" ? "单选" : question.type === "scale" ? "量表" : "开放题"}</span></div>
    <div className="space-y-4"><div><Label htmlFor={titleId}>问题内容</Label><Textarea id={titleId} className="mt-1" value={question.title} disabled={readonly} onChange={(event) => onUpdate({ title: event.target.value })} /></div>
      <div className="grid gap-3 sm:grid-cols-2"><div><Label htmlFor={typeId}>题型</Label><Input id={typeId} className="mt-1" value={question.type === "single" ? "单选" : question.type === "scale" ? "量表" : "开放题"} readOnly /></div><div><Label htmlFor={chapterId}>所属章节</Label><Input id={chapterId} className="mt-1" value={question.chapterId || "未映射"} disabled={readonly} onChange={(event) => onUpdate({ chapterId: event.target.value })} /></div></div>
      <div className="flex items-center justify-between rounded-md border border-border-subtle p-3"><span className="text-12">是否必答</span><Toggle checked={question.required} onCheckedChange={(required) => onUpdate({ required })} label={`${question.id} 是否必答`} disabled={readonly} /></div>
      {question.options.length > 0 && <div><Label>选项设置</Label><div className="mt-2 divide-y divide-border rounded-md border border-border">{question.options.map((option, index) => <div key={`${question.id}-${index}`} className="flex items-center gap-2 p-2"><span className="h-4 w-4 rounded-full border border-input" /><Input aria-label={`${question.id} 选项 ${index + 1}`} value={option} readOnly={readonly} onChange={(event) => onUpdate({ options: question.options.map((item, itemIndex) => itemIndex === index ? event.target.value : item) })} />{!readonly && <Button size="icon" variant="ghost" aria-label={`删除 ${question.id} 选项 ${index + 1}`}><Trash2 className="h-3.5 w-3.5" /></Button>}</div>)}</div>{!readonly && <Button className="mt-2" size="xs" variant="ghost"><Plus className="h-3 w-3" />添加选项</Button>}</div>}
    </div>
  </article>;
}
