"use client";
import * as React from "react";
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
export function SurveyQuestionEditor({
  questions,
  onChange,
  locked = false,
  overviewFirst = false,
}: {
  questions: SurveyWorkflowQuestion[];
  onChange: (questions: SurveyWorkflowQuestion[]) => void;
  locked?: boolean;
  overviewFirst?: boolean;
}) {
  const [id, setId] = React.useState(questions[0]?.id);
  const [picking, setPicking] = React.useState(false);
  const [search, setSearch] = React.useState("");
  const [category, setCategory] = React.useState("全部");
  const [pendingType, setPendingType] = React.useState<SurveyQuestionType>();
  const [deleted, setDeleted] = React.useState<{
    question: SurveyWorkflowQuestion;
    index: number;
  }>();
  const [preview, setPreview] = React.useState(false);
  const [editing, setEditing] = React.useState(!overviewFirst);
  const [previewDevice, setPreviewDevice] = React.useState<"desktop" | "tablet" | "mobile">("desktop");
  const [answers, setAnswers] = React.useState<
    Record<string, SurveyAnswerValue>
  >({});
  const question = questions.find((q) => q.id === id) ?? questions[0];
  const index = questions.findIndex((q) => q.id === question?.id);
  const change = (all: SurveyWorkflowQuestion[]) =>
    onChange(all.map((q, i) => ({ ...q, order: i + 1 })));
  const update = (next: SurveyWorkflowQuestion) =>
    change(questions.map((q) => (q.id === question?.id ? next : q)));
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
    });
    setPendingType(undefined);
  }
  const issues = question ? validateSurveyQuestion(question) : [];
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
    <div className="space-y-5 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-12 text-muted-foreground">
          选择题型，配置题目，再用实时预览试填。
        </p>
        <div className="flex flex-wrap gap-2">
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
          {!overviewFirst && (
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
        className={`grid min-w-0 gap-6 ${preview ? "xl:grid-cols-[14rem_minmax(0,1fr)_minmax(0,1fr)]" : "lg:grid-cols-[16rem_minmax(0,1fr)]"}`}
      >
        <aside className="min-w-0">
          <h2 className="mb-3 text-14 font-semibold">
            题目目录 · {questions.length}
          </h2>
          <ol className="space-y-1">
            {questions.map((q) => (
              <li key={q.id}>
                <button
                  type="button"
                  aria-current={q.id === question?.id ? "true" : undefined}
                  onClick={() => {
                    setId(q.id);
                    setPendingType(undefined);
                  }}
                  className={`w-full break-words rounded-md p-3 text-left text-12 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${q.id === question?.id ? "bg-accent" : "hover:bg-muted"}`}
                >
                  {q.type === "page_break" ? "分节 · " : `${q.order}. `}
                  {q.title || "未命名题目"}
                </button>
              </li>
            ))}
          </ol>
          {!locked && (
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
        <section className="min-w-0 space-y-4">
          {locked && (
            <p className="rounded-md bg-muted p-3 text-12">
              已发布的题目已锁定，以保证答卷与题目一致。仍可调整报告模板。
            </p>
          )}
          {picking && !locked && (
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
              <label className="block text-12">
                问题内容
                <Textarea
                  aria-label="问题内容"
                  value={question.title}
                  onChange={(event) =>
                    update({ ...question, title: event.target.value })
                  }
                />
              </label>
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
        {preview && !overviewFirst && (
          <aside aria-label="实时预览" className="min-w-0 space-y-4">
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
              className={`mx-auto space-y-7 rounded-lg border border-border bg-card p-4 ${previewDevice === "mobile" ? "max-w-sm" : previewDevice === "tablet" ? "max-w-2xl" : "w-full"}`}
            >
              {visibleSurveyQuestions(questions, answers).map((q) => (
                <SurveyQuestionRenderer
                  key={`${q.id}-${q.type}`}
                  question={q}
                  value={answers[q.id]}
                  onChange={(value) =>
                    setAnswers((current) => ({ ...current, [q.id]: value }))
                  }
                />
              ))}
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}
