"use client";
import * as React from "react";
import { ArrowDown, ArrowUp, CalendarDays, CircleDot, FileText, Grid2X2, Hash, ImageIcon, ListOrdered, Mail, MapPin, Phone, Redo2, SquareCheck, Star, Undo2, Upload } from "lucide-react";
import {
  SURVEY_QUESTION_TYPES,
  createSurveyQuestion,
  validateSurveyQuestion,
  visibleSurveyQuestions,
  type SurveyQuestionType,
  type SurveyWorkflowQuestion,
  type SurveyAnswerValue,
} from "@repo/contracts/survey-question-types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { moveItem } from "@/lib/survey/report-template";
import { SurveyQuestionSettings } from "./question-settings";
import { SurveyQuestionRenderer } from "./question-renderer";
import { ResponsiveDesignerPanel } from "./responsive-designer-panel";
const questionTypeIcons: Partial<Record<SurveyQuestionType, typeof CircleDot>> = {
  single: CircleDot,
  multi: SquareCheck,
  dropdown: ListOrdered,
  image_single: ImageIcon,
  image_multi: ImageIcon,
  short: FileText,
  open: FileText,
  multiple_text: FileText,
  number: Hash,
  date: CalendarDays,
  email: Mail,
  phone: Phone,
  address: MapPin,
  rating: Star,
  matrix_single: Grid2X2,
  matrix_multi: Grid2X2,
  ranking: ListOrdered,
  file: Upload,
};
export function SurveyQuestionEditor({
  questions,
  onChange,
  locked = false,
  overviewFirst = false,
  selectedQuestionId,
  studioLayout = false,
  disabled = false,
  surveyTitle,
}: {
  questions: SurveyWorkflowQuestion[];
  onChange: (questions: SurveyWorkflowQuestion[]) => void;
  locked?: boolean;
  overviewFirst?: boolean;
  selectedQuestionId?: string | null;
  studioLayout?: boolean;
  disabled?: boolean;
  surveyTitle?: string;
}) {
  const [id, setId] = React.useState(questions[0]?.id);
  const [picking, setPicking] = React.useState(false);
  const [search, setSearch] = React.useState("");
  const [outlineSearch, setOutlineSearch] = React.useState("");
  const [undoStack, setUndoStack] = React.useState<SurveyWorkflowQuestion[][]>([]);
  const [redoStack, setRedoStack] = React.useState<SurveyWorkflowQuestion[][]>([]);
  const [category, setCategory] = React.useState("全部");
  const [pendingType, setPendingType] = React.useState<SurveyQuestionType>();
  const [deleted, setDeleted] = React.useState<{
    question: SurveyWorkflowQuestion;
    index: number;
  }>();
  const [preview, setPreview] = React.useState(studioLayout);
  const [trialMode, setTrialMode] = React.useState(false);
  const [trialPage, setTrialPage] = React.useState(0);
  const [editing, setEditing] = React.useState(!overviewFirst);
  const [previewDevice, setPreviewDevice] = React.useState<"desktop" | "tablet" | "mobile">("desktop");
  const [answers, setAnswers] = React.useState<
    Record<string, SurveyAnswerValue>
  >({});
  const [draggingType, setDraggingType] = React.useState<SurveyQuestionType | null>(null);
  const lastEmittedSignature = React.useRef<string | null>(null);
  const questionsSignature = JSON.stringify(questions);
  React.useEffect(() => {
    if (lastEmittedSignature.current === questionsSignature) {
      lastEmittedSignature.current = null;
      return;
    }
    setUndoStack([]);
    setRedoStack([]);
  }, [questionsSignature]);
  React.useEffect(() => {
    if (selectedQuestionId && questions.some((q) => q.id === selectedQuestionId))
      setId(selectedQuestionId);
  }, [questions, selectedQuestionId]);
  const question = questions.find((q) => q.id === id) ?? questions[0];
  const index = questions.findIndex((q) => q.id === question?.id);
  const normalize = (all: SurveyWorkflowQuestion[]) =>
    all.map((q, i) => ({ ...q, order: i + 1 }));
  const snapshot = (all: SurveyWorkflowQuestion[]) => structuredClone(all);
  const emit = (all: SurveyWorkflowQuestion[]) => {
    lastEmittedSignature.current = JSON.stringify(all);
    onChange(all);
  };
  const change = (all: SurveyWorkflowQuestion[], recordHistory = true) => {
    const next = normalize(all);
    if (JSON.stringify(next) === JSON.stringify(questions)) return;
    if (recordHistory) {
      setUndoStack((stack) => [...stack, snapshot(questions)].slice(-50));
      setRedoStack([]);
    }
    emit(next);
  };
  const restoreSelection = (all: SurveyWorkflowQuestion[]) => {
    if (!all.some((item) => item.id === id)) setId(all[0]?.id);
  };
  const undo = () => {
    const previous = undoStack.at(-1);
    if (!previous) return;
    setUndoStack((stack) => stack.slice(0, -1));
    setRedoStack((stack) => [...stack, snapshot(questions)].slice(-50));
    const next = normalize(previous);
    restoreSelection(next);
    emit(next);
  };
  const redo = () => {
    const nextSnapshot = redoStack.at(-1);
    if (!nextSnapshot) return;
    setRedoStack((stack) => stack.slice(0, -1));
    setUndoStack((stack) => [...stack, snapshot(questions)].slice(-50));
    const next = normalize(nextSnapshot);
    restoreSelection(next);
    emit(next);
  };
  const update = (next: SurveyWorkflowQuestion) => {
    const changed = JSON.stringify(next) !== JSON.stringify(question);
    const provenance = changed && next.provenance?.certifiedAt
      ? { ...next.provenance, certifiedAt: undefined }
      : next.provenance;
    change(questions.map((q) => (q.id === question?.id ? { ...next, ...(provenance ? { provenance } : {}) } : q)));
  };
  function add(type: SurveyQuestionType) {
    const next = createSurveyQuestion(
      type,
      crypto.randomUUID(),
      questions.length + 1,
    );
    change([...questions, next]);
    setId(next.id);
    setPicking(false);
  }
  function handleToolDragStart(event: React.DragEvent<HTMLButtonElement>, type: SurveyQuestionType) {
    event.dataTransfer.effectAllowed = "copy";
    event.dataTransfer.setData("application/x-survey-question-type", type);
    setDraggingType(type);
  }
  function changeType(type: SurveyQuestionType) {
    if (!question) return;
    const next = createSurveyQuestion(type, question.id, question.order);
    update({
      ...next,
      title: question.title,
      chapterId: question.chapterId,
      required: ["description", "page_break"].includes(type)
        ? false
        : question.required,
      config: { ...next.config, description: question.config?.description },
      provenance: question.provenance,
    });
    setPendingType(undefined);
  }
  const issues = question ? validateSurveyQuestion(question) : [];
  const normalizedOutlineSearch = outlineSearch.trim().toLocaleLowerCase();
  const outlineQuestions = normalizedOutlineSearch
    ? questions.filter((item) => `${item.order} ${item.title} ${item.chapterId}`.toLocaleLowerCase().includes(normalizedOutlineSearch))
    : questions;
  if (studioLayout && trialMode) {
    const trialQuestions = visibleSurveyQuestions(questions, answers);
    const trialPages: SurveyWorkflowQuestion[][] = [[]];
    for (const item of trialQuestions) {
      if (item.type === "page_break") {
        if (trialPages[trialPages.length - 1]!.length) trialPages.push([]);
      } else {
        trialPages[trialPages.length - 1]!.push(item);
      }
    }
    const currentTrialPage = Math.min(trialPage, trialPages.length - 1);
    return (
      <section aria-label="问卷试填" className="flex min-h-0 flex-1 flex-col bg-muted/30 p-5 lg:h-full lg:overflow-hidden">
        <div className="mx-auto flex w-full max-w-4xl shrink-0 flex-wrap items-center justify-between gap-3 border-b border-border bg-background px-5 py-4">
          <div>
            <p className="text-12 font-medium text-muted-foreground">受访者视角 · 不会提交答卷</p>
            <h2 className="mt-1 text-18 font-semibold">试填模式</h2>
          </div>
          <Button type="button" variant="outline" onClick={() => { setTrialMode(false); setTrialPage(0); }}>
            退出试填
          </Button>
        </div>
        <div className="mx-auto w-full max-w-4xl flex-1 overflow-y-auto bg-background px-5 py-7">
          <div className="mx-auto max-w-2xl space-y-7">
            <header className="border-b border-border pb-6 text-center">
              <h1 className="text-24 font-semibold tracking-tight">{surveyTitle || "未命名问卷"}</h1>
              <p className="mt-2 text-12 text-muted-foreground">请像受访者一样填写，检查题目顺序、选项与条件显示。</p>
            </header>
            {trialPages.length > 1 && (
              <p className="text-12 text-muted-foreground" aria-live="polite">
                第 {currentTrialPage + 1} / {trialPages.length} 页
              </p>
            )}
            {trialPages[currentTrialPage]!.length ? trialPages[currentTrialPage]!.map((item) => (
              <SurveyQuestionRenderer
                key={`${item.id}-${item.type}`}
                question={item}
                value={answers[item.id]}
                onChange={(value) => setAnswers((current) => ({ ...current, [item.id]: value }))}
              />
            )) : (
              <p className="py-16 text-center text-13 text-muted-foreground">当前没有可试填的题目。</p>
            )}
            {trialPages.length > 1 && (
              <div className="flex flex-wrap gap-3 border-t border-border pt-5">
                {currentTrialPage > 0 && (
                  <Button type="button" variant="outline" onClick={() => setTrialPage(currentTrialPage - 1)}>
                    上一页
                  </Button>
                )}
                {currentTrialPage < trialPages.length - 1 && (
                  <Button type="button" onClick={() => setTrialPage(currentTrialPage + 1)}>
                    下一页
                  </Button>
                )}
              </div>
            )}
          </div>
        </div>
      </section>
    );
  }
  if (overviewFirst && !editing) {
    const answerQuestions = questions.filter(
      (item) => !["description", "page_break"].includes(item.type),
    );
    const answerOrdinalById = new Map(
      answerQuestions.map((item, answerIndex) => [item.id, answerIndex + 1]),
    );
    return (
      <div className="mx-auto w-full max-w-4xl space-y-5 p-5 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-4">
          <div>
            <h2 className="text-18 font-semibold">一页查看问卷</h2>
            <p className="mt-1 text-12 text-muted-foreground">
              共 {answerQuestions.length} 题
            </p>
          </div>
          {!locked && (
            <Button
              type="button"
              onClick={() => {
                setPicking(true);
                setEditing(true);
              }}
            >
              新增题目
            </Button>
          )}
        </div>
        {questions.length ? (
          <ol className="space-y-4" aria-label="问卷全部题目">
            {questions.map((item) => {
              const answerOrdinal = answerOrdinalById.get(item.id);
              const itemLabel = answerOrdinal
                ? `第 ${answerOrdinal} 题`
                : item.type === "page_break"
                  ? "分节"
                  : "说明";
              return (
                <li
                  key={item.id}
                  className="rounded-lg border border-border bg-card p-4 sm:p-5"
                >
                  <div className="mb-3 flex items-start justify-between gap-3">
                    <span className="text-12 font-medium text-muted-foreground">
                      {itemLabel}
                    </span>
                    {!locked && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        aria-label={`编辑${itemLabel}`}
                        onClick={() => {
                          setId(item.id);
                          setPendingType(undefined);
                          setEditing(true);
                        }}
                      >
                        编辑
                      </Button>
                    )}
                  </div>
                  <SurveyQuestionRenderer
                    question={item}
                    value={answers[item.id]}
                    showDescription={false}
                    onChange={(value) =>
                      setAnswers((current) => ({
                        ...current,
                        [item.id]: value,
                      }))
                    }
                  />
                </li>
              );
            })}
          </ol>
        ) : (
          <div className="rounded-lg border border-dashed border-border py-16 text-center">
            <p className="text-13 text-muted-foreground">
              添加第一道题目，开始设计问卷。
            </p>
          </div>
        )}
      </div>
    );
  }
  return (
    <div className={studioLayout ? "flex min-h-0 flex-col gap-4 p-5 lg:h-full lg:overflow-hidden" : "space-y-5 p-5"}>
      <div className={`flex flex-wrap items-center justify-between gap-3 ${studioLayout ? "shrink-0" : ""}`}>
        <p className="text-12 text-muted-foreground">
          选择题型，配置题目，再用实时预览试填。
        </p>
        <div className="flex flex-wrap gap-2">
          {studioLayout && !locked && (
            <>
              <Button type="button" variant="outline" onClick={() => { setTrialPage(0); setTrialMode(true); }}>
                试填问卷
              </Button>
              <Button type="button" variant="outline" aria-label="撤销最近修改" disabled={!undoStack.length} onClick={undo}>
                <Undo2 aria-hidden="true" className="h-4 w-4" />撤销
              </Button>
              <Button type="button" variant="outline" aria-label="重做最近修改" disabled={!redoStack.length} onClick={redo}>
                <Redo2 aria-hidden="true" className="h-4 w-4" />重做
              </Button>
            </>
          )}
          {overviewFirst && (
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setPicking(false);
                setEditing(false);
              }}
            >
              完成编辑
            </Button>
          )}
          {!overviewFirst && !studioLayout && (
            <Button
              type="button"
              variant="outline"
              aria-expanded={preview}
              onClick={() => setPreview(!preview)}
            >
              {preview ? "收起实时预览" : "展开实时预览"}
            </Button>
          )}
        </div>
      </div>
      <div
        data-testid={studioLayout ? "survey-designer-grid" : undefined}
        className={`grid min-w-0 gap-4 ${studioLayout && preview ? "lg:h-full lg:min-h-0 lg:flex-1 lg:grid-cols-[16rem_minmax(0,1fr)_18rem] lg:overflow-hidden xl:grid-cols-[19rem_minmax(0,1fr)_22rem]" : preview ? "xl:grid-cols-[16rem_minmax(0,1fr)_minmax(0,1fr)]" : "lg:grid-cols-[16rem_minmax(0,1fr)]"}`}
      >
        <ResponsiveDesignerPanel title="题目大纲" enabled={studioLayout} disabled={disabled}>
        <aside data-testid={studioLayout ? "survey-designer-outline" : undefined} aria-label="题目大纲" className="min-w-0 space-y-5 rounded-lg border border-border bg-card p-4 lg:h-full lg:overflow-y-auto">
          {studioLayout && !locked && <section aria-label="题型工具箱" className="space-y-3">
            <div className="flex items-start justify-between gap-2"><div><h2 className="text-16 font-semibold">题型工具箱</h2><p className="mt-1 text-12 text-muted-foreground">选择题型，直接添加到问卷</p></div><Button type="button" size="sm" variant="outline" onClick={() => add("short")}>新增题目</Button></div>
            {Array.from(new Set(SURVEY_QUESTION_TYPES.map(item => item.category))).map(group => <div key={group}>
              <h3 className="mb-2 text-12 font-medium text-muted-foreground">{group}</h3>
              <div className="grid grid-cols-3 gap-2">
                {SURVEY_QUESTION_TYPES.filter(item => item.category === group).map(item => {
                  const Icon = questionTypeIcons[item.type] ?? FileText;
                  return <button
                    key={item.type} type="button" draggable={!disabled}
                    data-testid={`add-question-${item.type}`}
                    onDragStart={(event) => handleToolDragStart(event, item.type)}
                    onDragEnd={() => setDraggingType(null)}
                    onClick={() => add(item.type)}
                    className="flex min-h-20 cursor-grab flex-col items-center justify-center gap-2 rounded-md border border-border bg-background px-2 py-3 text-center text-12 font-medium transition-colors hover:border-primary hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing"
                  ><Icon aria-hidden="true" className="h-5 w-5" />{item.label}</button>;
                })}
              </div>
            </div>)}
          </section>}
          <h2 className="text-14 font-semibold">题目大纲</h2>
          <p className="text-12 text-muted-foreground">题目目录 · {questions.length}</p>
          <Input type="search" aria-label="搜索题目" placeholder="搜索题目或章节" value={outlineSearch} onChange={(event) => setOutlineSearch(event.target.value)} />
          <ol className="space-y-1">
            {outlineQuestions.map((q) => {
              const questionIndex = questions.findIndex((item) => item.id === q.id);
              return <li key={q.id} className="flex items-center gap-1">
                <button
                  type="button"
                  aria-label={`选择题目 ${q.order}：${q.title || "未命名题目"}`}
                  aria-current={q.id === question?.id ? "true" : undefined}
                  onClick={() => {
                    setId(q.id);
                    setPendingType(undefined);
                  }}
                  className={`min-w-0 flex-1 break-words rounded-md p-3 text-left text-12 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${q.id === question?.id ? "bg-accent" : "hover:bg-muted"}`}
                >
                  {q.type === "page_break" ? "分节 · " : `${q.order}. `}
                  {q.title || "未命名题目"}
                </button>
                {studioLayout && !locked && <div className="flex shrink-0">
                  <Button type="button" size="xs" variant="ghost" aria-label={`上移题目：${q.title || "未命名题目"}`} disabled={questionIndex === 0} onClick={() => { change(moveItem(questions, questionIndex, -1)); setId(q.id); }}><ArrowUp aria-hidden="true" className="h-3.5 w-3.5" /></Button>
                  <Button type="button" size="xs" variant="ghost" aria-label={`下移题目：${q.title || "未命名题目"}`} disabled={questionIndex === questions.length - 1} onClick={() => { change(moveItem(questions, questionIndex, 1)); setId(q.id); }}><ArrowDown aria-hidden="true" className="h-3.5 w-3.5" /></Button>
                </div>}
              </li>;
            })}
          </ol>
          {!locked && !studioLayout && (
            <div className="mt-4 flex flex-wrap gap-2">
              <Button type="button" onClick={() => setPicking(!picking)}>
                新增题目
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => add("page_break")}
              >
                添加分节
              </Button>
            </div>
          )}
          {deleted && !locked && (
            <div role="status" className="mt-4 space-y-2 text-12">
              已删除“{deleted.question.title}”。
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  const next = [...questions];
                  next.splice(deleted.index, 0, deleted.question);
                  change(next);
                  setId(deleted.question.id);
                  setDeleted(undefined);
                }}
              >
                撤销删除
              </Button>
            </div>
          )}
        </aside>
        </ResponsiveDesignerPanel>
        <ResponsiveDesignerPanel title="题目设置" enabled={studioLayout} disabled={disabled}>
        <section data-testid={studioLayout ? "survey-designer-settings" : undefined} aria-label="题目设置" className={`min-w-0 space-y-4 ${studioLayout && preview ? 'lg:order-3 lg:h-full lg:overflow-y-auto' : ''}`}>
          {locked && (
            <p className="rounded-md bg-muted p-3 text-12">
              已发布的题目已锁定，以保证答卷与题目一致。仍可调整报告模板。
            </p>
          )}
          {picking && !locked && !studioLayout && (
            <div
              className="space-y-3 rounded-lg border border-border p-4"
              aria-label="题型选择器"
            >
              <Input
                aria-label="搜索题型"
                placeholder="搜索题型或用途"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
              <div className="flex flex-wrap gap-2">
                {[
                  "全部",
                  ...new Set(
                    SURVEY_QUESTION_TYPES.map((item) => item.category),
                  ),
                ].map((item) => (
                  <Button
                    key={item}
                    type="button"
                    size="sm"
                    variant={category === item ? "primary" : "outline"}
                    aria-pressed={category === item}
                    onClick={() => setCategory(item)}
                  >
                    {item}
                  </Button>
                ))}
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                {SURVEY_QUESTION_TYPES.filter(
                  (item) =>
                    (category === "全部" || item.category === category) &&
                    `${item.label} ${item.description}`
                      .toLowerCase()
                      .includes(search.toLowerCase()),
                ).map((item) => (
                  <button
                    key={item.type}
                    type="button"
                    data-testid={`add-question-${item.type}`}
                    onClick={() => add(item.type)}
                    className="rounded-md border border-border p-3 text-left transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <span className="block text-13 font-medium">
                      {item.label}
                    </span>
                    <span className="text-12 text-muted-foreground">
                      {item.description}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}
          {question ? (
            <fieldset
              disabled={locked}
              className="min-w-0 space-y-5 rounded-lg border border-border bg-card p-5"
            >
              {question.provenance && (
                <p data-testid="question-provenance" className="text-12 text-muted-foreground">
                  {question.provenance.source === "question-library" ? "题库来源" : question.provenance.source === "template" ? "模板来源" : "手动创建"}
                  {" · "}{question.provenance.certifiedAt ? "已认证" : "需重新认证"}
                </p>
              )}
              {!studioLayout && <label className="block text-12">
                问题内容
                <Textarea
                  aria-label="问题内容"
                  value={question.title}
                  onChange={(event) =>
                    update({ ...question, title: event.target.value })
                  }
                />
              </label>}
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="text-12">
                  题型
                  <select
                    aria-label="题型"
                    className="mt-1 w-full rounded-md border border-border bg-background p-2"
                    value={question.type}
                    onChange={(event) => {
                      const type = event.target.value as SurveyQuestionType;
                      if (type !== question.type) setPendingType(type);
                    }}
                  >
                    {SURVEY_QUESTION_TYPES.map((item) => (
                      <option key={item.type} value={item.type}>
                        {item.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex items-center gap-2 text-12">
                  <input
                    type="checkbox"
                    disabled={["description", "page_break"].includes(
                      question.type,
                    )}
                    checked={question.required}
                    onChange={(event) =>
                      update({ ...question, required: event.target.checked })
                    }
                  />
                  必答
                </label>
              </div>
              <label className="block text-12">
                所属章节
                <Input
                  aria-label="所属章节"
                  value={question.chapterId}
                  onChange={(event) =>
                    update({ ...question, chapterId: event.target.value })
                  }
                />
              </label>
              {pendingType && (
                <div
                  role="alertdialog"
                  aria-label="确认切换题型"
                  className="space-y-3 rounded-md border border-border bg-muted p-4"
                >
                  <p className="text-13">
                    切换到
                    {
                      SURVEY_QUESTION_TYPES.find(
                        (item) => item.type === pendingType,
                      )?.label
                    }
                    将重置 {question.options.length} 个选项、
                    {question.config?.rows?.length ?? 0}{" "}
                    个矩阵行以及高级规则。保留题干、说明和章节。
                  </p>
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setPendingType(undefined)}
                    >
                      取消切换
                    </Button>
                    <Button
                      type="button"
                      onClick={() => changeType(pendingType)}
                    >
                      确认切换
                    </Button>
                  </div>
                </div>
              )}
              <SurveyQuestionSettings
                key={question.id}
                question={question}
                questions={questions}
                onChange={update}
                mode={studioLayout ? "advanced" : "all"}
              />
              {issues.length > 0 && (
                <ul className="text-12 text-destructive" aria-label="配置检查">
                  {issues.map((message) => (
                    <li key={message}>{message}</li>
                  ))}
                </ul>
              )}
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  disabled={index === 0}
                  onClick={() => change(moveItem(questions, index, -1))}
                >
                  上移
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={index === questions.length - 1}
                  onClick={() => change(moveItem(questions, index, 1))}
                >
                  下移
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    const copy = {
                      ...structuredClone(question),
                      id: crypto.randomUUID(),
                      title: `${question.title}（副本）`,
                      provenance: question.provenance
                        ? { ...question.provenance, certifiedAt: undefined }
                        : undefined,
                    };
                    const next = [...questions];
                    next.splice(index + 1, 0, copy);
                    change(next);
                    setId(copy.id);
                  }}
                >
                  复制题目
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setDeleted({ question, index });
                    change(questions.filter((q) => q.id !== question.id));
                    setId(questions[index + 1]?.id ?? questions[index - 1]?.id);
                  }}
                >
                  删除题目
                </Button>
              </div>
            </fieldset>
          ) : (
            <p className="py-16 text-center text-muted-foreground">
              添加第一道题目，开始设计问卷。
            </p>
          )}
        </section>
        </ResponsiveDesignerPanel>
        {preview && !overviewFirst && (
          <aside data-testid={studioLayout ? "survey-designer-canvas-scroll" : undefined} aria-label="实时预览" className={`min-w-0 space-y-4 rounded-lg border border-border bg-card p-4 ${studioLayout ? 'lg:order-2 lg:h-full lg:overflow-y-auto' : ''}`}>
            <div role="region" aria-label="问卷设计画布" className="space-y-4">
            {studioLayout && <div className="border-b border-border pb-3"><h2 className="text-16 font-semibold">问卷设计画布</h2></div>}
            <div className="flex gap-2">
              <Button type="button" variant={previewDevice === "desktop" ? "primary" : "outline"} aria-pressed={previewDevice === "desktop"} onClick={() => setPreviewDevice("desktop")}>
                桌面预览
              </Button>
              <Button type="button" variant={previewDevice === "tablet" ? "primary" : "outline"} aria-pressed={previewDevice === "tablet"} onClick={() => setPreviewDevice("tablet")}>
                平板预览
              </Button>
              <Button type="button" variant={previewDevice === "mobile" ? "primary" : "outline"} aria-pressed={previewDevice === "mobile"} onClick={() => setPreviewDevice("mobile")}>
                手机预览
              </Button>
            </div>
            <div
              data-testid="survey-question-drop-zone"
              onDragOver={(event) => {
                if (draggingType) {
                  event.preventDefault();
                  event.dataTransfer.dropEffect = "copy";
                }
              }}
              onDrop={(event) => {
                event.preventDefault();
                const type = event.dataTransfer.getData("application/x-survey-question-type") as SurveyQuestionType;
                if (type && SURVEY_QUESTION_TYPES.some((item) => item.type === type)) add(type);
                setDraggingType(null);
              }}
              className={`mx-auto space-y-7 rounded-lg border border-border bg-card p-4 ${draggingType ? "border-primary bg-accent/10" : ""} ${previewDevice === "mobile" ? "max-w-sm" : previewDevice === "tablet" ? "max-w-2xl" : "w-full"}`}
            >
              {studioLayout && <section aria-label="问卷封面" className="grid gap-5 rounded-lg border border-border bg-card p-5 sm:grid-cols-[8rem_minmax(0,1fr)] sm:items-center">
                <div className="flex aspect-[4/3] items-center justify-center rounded-md border border-dashed border-border bg-muted/50 text-muted-foreground" aria-label="尚未设置封面图">
                  <ImageIcon className="h-8 w-8" aria-hidden />
                </div>
                <div className="min-w-0">
                  <p className="text-12 font-medium text-muted-foreground">问卷封面</p>
                  <h2 className="mt-2 text-20 font-semibold tracking-tight">{surveyTitle || "未命名问卷"}</h2>
                  <p className="mt-2 text-12 leading-5 text-muted-foreground">封面与标题将作为答题页的开场信息，发布时随当前问卷版本一起固定。</p>
                </div>
              </section>}
              {(studioLayout ? questions : visibleSurveyQuestions(questions, answers)).map((q, questionIndex) => (
                <React.Fragment key={`${q.id}-${q.type}`}>
                  {studioLayout && (questionIndex === 0 || questions[questionIndex - 1]?.chapterId !== q.chapterId) &&
                    <div className="flex items-center justify-between gap-3 rounded-md border border-border bg-muted/30 px-4 py-3">
                      <h3 className="text-16 font-semibold">{q.chapterId || "未分组"}</h3>
                      <span className="shrink-0 text-11 text-muted-foreground">
                        {questions.filter((item) => item.chapterId === q.chapterId).length} 题
                      </span>
                    </div>}
                  <section className={studioLayout ? `group rounded-lg border p-4 transition-colors ${q.id === question?.id ? "border-primary bg-accent/20" : "border-border hover:border-primary/50"}` : ""}>
                    {studioLayout && <button type="button" aria-label={`编辑第 ${questionIndex + 1} 题：${q.title || "未命名题目"}`}
                      className={`mb-3 w-full text-left text-12 font-medium text-muted-foreground transition-colors hover:text-foreground ${q.id === question?.id ? "" : "invisible group-hover:visible group-focus-within:visible"}`}
                      onClick={() => { setId(q.id); setPendingType(undefined); }}>
                      Q{questionIndex + 1} · 点击编辑
                    </button>}
                    {studioLayout && q.id === question?.id ? (
                      <fieldset disabled={locked} className="space-y-4" aria-label={`编辑第 ${questionIndex + 1} 题`}>
                        <label className="block text-12 font-medium">
                          问题内容
                          <Textarea
                            aria-label="问题内容"
                            className="mt-1 text-16 font-medium"
                            value={q.title}
                            onChange={(event) => update({ ...q, title: event.target.value })}
                          />
                        </label>
                        <SurveyQuestionSettings
                          key={`${q.id}-inline-content`}
                          question={q}
                          questions={questions}
                          onChange={update}
                          mode="content"
                        />
                      </fieldset>
                    ) : (
                      <SurveyQuestionRenderer
                        question={q}
                        value={answers[q.id]}
                        onChange={(value) => setAnswers((current) => ({ ...current, [q.id]: value }))}
                      />
                    )}
                  </section>
                </React.Fragment>
              ))}
            </div>
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}
