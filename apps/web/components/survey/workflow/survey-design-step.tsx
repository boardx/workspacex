"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { GripVertical, Plus, Settings2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Toggle } from "@/components/ui/toggle";
import { SURVEY_QUESTION_MODULE_CARDS } from "@/lib/survey/resource-library";
import { getSurveyQuestionModuleQuestions } from "@/lib/survey/workflow-model";
import type { survey } from "@repo/contracts";
import { SectionTitle } from "./survey-workflow-shell";
import { useSectionNavigation } from "./use-section-navigation";

export function SurveyDesignStep({ model, setModel, readonly, editorKind }: { model: survey.SurveyWorkflowModel; setModel: React.Dispatch<React.SetStateAction<survey.SurveyWorkflowModel>>; readonly: boolean; editorKind: "survey" | "module" }) {
  const router = useRouter();
  const [showModuleChoices, setShowModuleChoices] = React.useState(false);
  const isModuleEditor = editorKind === "module";
  const emptyTitle = isModuleEditor ? "当前模块还没有题目" : "当前问卷还没有题目";
  const emptyDescription = isModuleEditor
    ? "从空白题目开始，或复制已有问卷模块作为基础后再修改。"
    : "从空白题目开始，或选择问卷模块作为新问卷的基础。";
  const questionIds = React.useMemo(() => model.questions.map((question) => question.id), [model.questions]);
  const { activeId, navigateTo } = useSectionNavigation(questionIds, "survey-question");
  const activeQuestion = model.questions.find((question) => question.id === activeId) ?? model.questions[0];

  const updateQuestion = (questionId: string, patch: Partial<survey.SurveyWorkflowQuestion>) => {
    setModel((current) => ({
      ...current,
      questions: current.questions.map((question) => question.id === questionId ? { ...question, ...patch } : question),
    }));
  };

  const addFirstQuestion = () => {
    setModel((current) => ({
      ...current,
      questions: [{ id: "Q01", order: 1, chapterId: "", type: "single", title: "请输入问题内容", required: true, options: ["选项 1"] }],
    }));
  };

  const copyModuleQuestions = (moduleId: string) => {
    setModel((current) => ({ ...current, questions: getSurveyQuestionModuleQuestions(moduleId) }));
    setShowModuleChoices(false);
  };

  if (model.questions.length === 0) {
    return <div className="flex min-h-[calc(100vh-5rem)] items-start justify-center p-6" data-testid="survey-design-empty-module">
      <div className="mt-16 w-full max-w-3xl rounded-xl border border-dashed border-border bg-card p-8 text-center shadow-sm">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-accent text-primary"><Plus className="h-6 w-6" aria-hidden /></div>
        <h2 className="mt-4 text-18 font-semibold">{emptyTitle}</h2>
        <p className="mt-2 text-12 text-muted-foreground">{emptyDescription}</p>
        {!readonly && <div className="mt-6 flex flex-wrap justify-center gap-3">
          <Button variant="primary" onClick={addFirstQuestion}><Plus className="h-4 w-4" aria-hidden />添加第一道题</Button>
          {isModuleEditor ? (
            <Button variant="outline" onClick={() => setShowModuleChoices((current) => !current)}>从已有问卷模块创建</Button>
          ) : (
            <Button variant="outline" onClick={() => router.push("/studio/survey?tab=modules&intent=create-survey")}>从问卷模块选择</Button>
          )}
        </div>}
        {!readonly && isModuleEditor && showModuleChoices && <div className="mt-6 grid gap-3 text-left sm:grid-cols-2" data-testid="survey-design-module-choices">
          {SURVEY_QUESTION_MODULE_CARDS.map((item) => <button key={item.id} type="button" onClick={() => copyModuleQuestions(item.id)} className="rounded-lg border border-border p-4 transition-colors hover:border-primary hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <span className="block text-13 font-semibold">{item.title}</span>
            <span className="mt-1 block text-11 text-muted-foreground">{item.description} · {item.questionCount} 题</span>
          </button>)}
        </div>}
      </div>
    </div>;
  }

  return <div className="grid min-h-[calc(100vh-9rem)] grid-cols-1 xl:grid-cols-[22rem_minmax(28rem,1fr)_22rem]">
    <aside className="border-b border-border bg-card p-4 xl:sticky xl:top-0 xl:self-start xl:border-b-0 xl:border-r" data-testid="survey-design-question-list">
      <div className="mb-3 flex items-center justify-between"><h2 className="text-14 font-semibold">问题目录（{model.questions.length}）</h2>{!readonly && <Button size="xs" variant="ghost"><Plus className="h-3 w-3" aria-hidden />新增问题</Button>}</div>
      <p className="mb-3 text-10 text-muted-foreground">快捷定位问题，也可直接向下连续查看</p>
      <ol className="space-y-1">{model.questions.map((question) => <li key={question.id}><button type="button" data-testid={`survey-design-nav-${question.id}`} aria-current={activeId === question.id ? "location" : undefined} onClick={() => navigateTo(question.id)} className={`flex w-full items-center gap-2 rounded-md border-l-2 px-2 py-2 text-left text-11 transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${activeId === question.id ? "border-primary bg-accent text-primary" : "border-transparent hover:bg-muted"}`}><span className="w-5 font-medium">{question.order}.</span><span className="min-w-0 flex-1 truncate">{question.title}</span><GripVertical className="h-3 w-3 text-muted-foreground" aria-hidden /></button></li>)}</ol>
    </aside>

    <section className="space-y-5 p-5" data-testid="survey-design-question-editor">
      <SectionTitle title="问题编辑" description="全部问题按顺序连续呈现，滚动即可查看和编辑" />
      {model.questions.map((question) => <QuestionEditor key={question.id} question={question} readonly={readonly} active={activeId === question.id} onUpdate={(patch) => updateQuestion(question.id, patch)} />)}
    </section>

    <aside className="border-t border-border bg-card p-5 xl:sticky xl:top-0 xl:self-start xl:border-l xl:border-t-0" data-testid="survey-design-question-settings">
      <SectionTitle icon={<Settings2 className="h-5 w-5 text-primary" aria-hidden />} title="题目设置" description={activeQuestion ? `当前题目：${activeQuestion.id}` : "选择题目进行设置"} />
      {activeQuestion && <div className="space-y-4">
        <div><Label htmlFor="survey-selected-question-title">题目内容</Label><Textarea id="survey-selected-question-title" className="mt-2" value={activeQuestion.title} disabled={readonly} onChange={(event) => updateQuestion(activeQuestion.id, { title: event.target.value })} data-testid="survey-design-setting-title" /></div>
        <div><Label htmlFor="survey-selected-question-chapter">所属章节</Label><Input id="survey-selected-question-chapter" className="mt-2" value={activeQuestion.chapterId} disabled={readonly} onChange={(event) => updateQuestion(activeQuestion.id, { chapterId: event.target.value })} data-testid="survey-design-setting-chapter" /></div>
        <div className="flex items-center justify-between rounded-md border border-border p-3"><span className="text-12">是否必答</span><Toggle checked={activeQuestion.required} onCheckedChange={(required) => updateQuestion(activeQuestion.id, { required })} label={`${activeQuestion.id} 是否必答`} disabled={readonly} /></div>
      </div>}
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
      {question.options.length > 0 && <div><Label>选项设置</Label><div className="mt-2 divide-y divide-border rounded-md border border-border">{question.options.map((option, index) => <div key={`${question.id}-${index}`} className="flex items-center gap-2 p-2"><span className="h-4 w-4 rounded-full border border-input" /><Input aria-label={`${question.id} 选项 ${index + 1}`} value={option} readOnly={readonly} onChange={(event) => onUpdate({ options: question.options.map((item, itemIndex) => itemIndex === index ? event.target.value : item) })} />{!readonly && <Button size="icon" variant="ghost" aria-label={`删除 ${question.id} 选项 ${index + 1}`}><Trash2 className="h-3.5 w-3.5" aria-hidden /></Button>}</div>)}</div>{!readonly && <Button className="mt-2" size="xs" variant="ghost"><Plus className="h-3 w-3" aria-hidden />添加选项</Button>}</div>}
    </div>
  </article>;
}
