"use client";
import * as React from "react";
import { displaySurveyDiagnostic } from "@/lib/survey/display-diagnostic";
import { useI18n } from "@/lib/i18n/provider";
import { translate, type MessageKey } from "@/lib/i18n/messages";
import { createDisplaySurveyQuestion, surveyQuestionTypeLabel, surveyQuestionTypeDescription } from "@/lib/survey/question-display";
import { ArrowDown, ArrowUp, CalendarDays, CircleDot, Copy, FileText, Grid2X2, Hash, ImageIcon, ListOrdered, Mail, MapPin, Phone, Plus, Redo2, SquareCheck, Star, Trash2, Undo2, Upload } from "lucide-react";
import {
  SURVEY_QUESTION_TYPES,
  validateSurveyQuestion,
  visibleSurveyQuestions,
  type SurveyQuestionType,
  type SurveyWorkflowQuestion,
  type SurveyAnswerValue,
} from "@repo/contracts/survey-question-types";
import { surveyQuestionsContentSignature } from "@repo/contracts/survey-source";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { moveItem } from "@/lib/survey/report-template";
import { SurveyQuestionSettings } from "./question-settings";
import { SurveyQuestionRenderer } from "./question-renderer";
import { ResponsiveDesignerPanel } from "./responsive-designer-panel";
import { InlineQuestionText } from "./inline-question-text";
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
  const { t, locale } = useI18n();
  const createQuestion = (type: SurveyQuestionType, id: string, order: number) => createDisplaySurveyQuestion(type, id, order, locale, t);
  const typeLabel = (type: SurveyQuestionType) => surveyQuestionTypeLabel(type, t);
  const typeDescription = (type: SurveyQuestionType) => surveyQuestionTypeDescription(type, t);
  const categoryKeys: Record<string, MessageKey> = {"全部": "survey.design.categoryAll", "选择": "survey.design.categoryChoice", "输入": "survey.design.categoryInput", "评分": "survey.design.categoryRating", "矩阵": "survey.design.categoryMatrix", "比较": "survey.design.categoryComparison", "材料": "survey.design.categoryMaterial", "页面元素": "survey.design.categoryPage"};
  const [id, setId] = React.useState(questions[0]?.id);
  const [picking, setPicking] = React.useState(false);
  const [search, setSearch] = React.useState("");
  const [outlineOpen, setOutlineOpen] = React.useState(false);
  const outlineSelection = React.useRef<string | null>(null);
  const canvasRef = React.useRef<HTMLElement>(null);
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
  const appliedRepairTarget = React.useRef<string | null>(null);
  const questionsSignature = surveyQuestionsContentSignature(questions);
  React.useEffect(() => {
    if (lastEmittedSignature.current === questionsSignature) {
      lastEmittedSignature.current = null;
      return;
    }
    setUndoStack([]);
    setRedoStack([]);
  }, [questionsSignature]);
  React.useEffect(() => {
    if (!selectedQuestionId) {
      appliedRepairTarget.current = null;
      return;
    }
    if (appliedRepairTarget.current === selectedQuestionId) return;
    if (questions.some((q) => q.id === selectedQuestionId)) {
      appliedRepairTarget.current = selectedQuestionId;
      setId(selectedQuestionId);
    }
  }, [questions, selectedQuestionId]);
  const question = questions.find((q) => q.id === id) ?? questions[0];
  const index = questions.findIndex((q) => q.id === question?.id);
  const normalize = (all: SurveyWorkflowQuestion[]) =>
    all.map((q, i) => ({ ...q, order: i + 1 }));
  const snapshot = (all: SurveyWorkflowQuestion[]) => structuredClone(all);
  const emit = (all: SurveyWorkflowQuestion[]) => {
    lastEmittedSignature.current = surveyQuestionsContentSignature(all);
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
    const changed = JSON.stringify(next) !== JSON.stringify(questions.find((item) => item.id === next.id));
    const provenance = changed && next.provenance?.certifiedAt
      ? { ...next.provenance, certifiedAt: undefined }
      : next.provenance;
    change(questions.map((q) => (q.id === next.id ? { ...next, ...(provenance ? { provenance } : {}) } : q)));
  };
  function add(type: SurveyQuestionType) {
    const next = createQuestion(
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
    const next = createQuestion(type, question.id, question.order);
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
      <section aria-label={t("survey.design.trial")} className="flex min-h-0 flex-1 flex-col bg-muted/30 p-5 lg:h-full lg:overflow-hidden">
        <div className="mx-auto flex w-full max-w-4xl shrink-0 flex-wrap items-center justify-between gap-3 border-b border-border bg-background px-5 py-4">
          <div>
            <p className="text-12 font-medium text-muted-foreground">{t("survey.design.trialHint")}</p>
            <h2 className="mt-1 text-18 font-semibold">{t("survey.design.trialMode")}</h2>
          </div>
          <Button type="button" variant="outline" onClick={() => { setTrialMode(false); setTrialPage(0); }}>
            {t("survey.design.exitTrial")}
          </Button>
        </div>
        <div className="mx-auto w-full max-w-4xl flex-1 overflow-y-auto bg-background px-5 py-7">
          <div className="mx-auto max-w-2xl space-y-7">
            <header className="border-b border-border pb-6 text-center">
              <h1 className="text-24 font-semibold tracking-tight">{surveyTitle || t("survey.design.untitledSurvey")}</h1>
              <p className="mt-2 text-12 text-muted-foreground">{t("survey.design.trialInstructions")}</p>
            </header>
            {trialPages.length > 1 && (
              <p className="text-12 text-muted-foreground" aria-live="polite">
                {t("survey.design.pageCount", { page: currentTrialPage + 1, total: trialPages.length })}
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
              <p className="py-16 text-center text-13 text-muted-foreground">{t("survey.design.trialEmpty")}</p>
            )}
            {trialPages.length > 1 && (
              <div className="flex flex-wrap gap-3 border-t border-border pt-5">
                {currentTrialPage > 0 && (
                  <Button type="button" variant="outline" onClick={() => setTrialPage(currentTrialPage - 1)}>
                    {t("survey.design.previousPage")}
                  </Button>
                )}
                {currentTrialPage < trialPages.length - 1 && (
                  <Button type="button" onClick={() => setTrialPage(currentTrialPage + 1)}>
                    {t("survey.design.nextPage")}
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
            <h2 className="text-18 font-semibold">{t("survey.design.overview")}</h2>
            <p className="mt-1 text-12 text-muted-foreground">
              {t("survey.design.questionCount", { count: answerQuestions.length })}
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
              {t("survey.design.addQuestion")}
            </Button>
          )}
        </div>
        {questions.length ? (
          <ol className="space-y-4" aria-label={t("survey.design.allQuestions")}>
            {questions.map((item) => {
              const answerOrdinal = answerOrdinalById.get(item.id);
              const itemLabel = answerOrdinal
                ? t("survey.design.questionOrdinal", { index: answerOrdinal })
                : item.type === "page_break"
                  ? t("survey.design.section")
                  : t("survey.design.explanation");
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
                        aria-label={answerOrdinal ? t("survey.design.editQuestion", { index: answerOrdinal }) : t("survey.design.editItem", { item: itemLabel })}
                        onClick={() => {
                          setId(item.id);
                          setPendingType(undefined);
                          setEditing(true);
                        }}
                      >
                        {t("survey.design.edit")}
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
              {t("survey.design.emptyDesign")}
            </p>
          </div>
        )}
      </div>
    );
  }
  const outlineContent = <div className="min-w-0 space-y-4" data-testid="survey-question-outline">
          {!studioLayout && <h2 className="text-14 font-semibold">{t("survey.design.outline")}</h2>}
          <p className="text-12 text-muted-foreground">{t("survey.design.outlineCount", { count: questions.length })}</p>
          <Input type="search" aria-label={t("survey.design.searchQuestions")} placeholder={t("survey.design.searchQuestionsHint")} value={outlineSearch} onChange={(event) => setOutlineSearch(event.target.value)} />
          <ol className="space-y-1">
            {outlineQuestions.map((q) => {
              const questionIndex = questions.findIndex((item) => item.id === q.id);
              return <li key={q.id} className="flex items-center gap-1">
                <button
                  type="button"
                  aria-label={t("survey.design.selectQuestion", { index: q.order, title: q.title || t("survey.design.untitledQuestion") })}
                  aria-current={q.id === question?.id ? "true" : undefined}
                  onClick={() => {
                    setId(q.id);
                    setPendingType(undefined);
                    if (studioLayout) { outlineSelection.current = q.id; setOutlineOpen(false); }
                  }}
                  className={`min-w-0 flex-1 break-words rounded-md p-3 text-left text-12 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${q.id === question?.id ? "bg-accent" : "hover:bg-muted"}`}
                >
                  {q.type === "page_break" ? t("survey.design.sectionPrefix") : `${q.order}. `}
                  {q.title || t("survey.design.untitledQuestion")}
                </button>
                {studioLayout && !locked && <div className="flex shrink-0">
                  <Button type="button" size="xs" variant="ghost" aria-label={t("survey.design.moveQuestionUp", { title: q.title || t("survey.design.untitledQuestion") })} disabled={questionIndex === 0} onClick={() => { change(moveItem(questions, questionIndex, -1)); setId(q.id); }}><ArrowUp aria-hidden="true" className="h-3.5 w-3.5" /></Button>
                  <Button type="button" size="xs" variant="ghost" aria-label={t("survey.design.moveQuestionDown", { title: q.title || t("survey.design.untitledQuestion") })} disabled={questionIndex === questions.length - 1} onClick={() => { change(moveItem(questions, questionIndex, 1)); setId(q.id); }}><ArrowDown aria-hidden="true" className="h-3.5 w-3.5" /></Button>
                </div>}
              </li>;
            })}
          </ol>
  </div>;
  return (
    <div className={studioLayout ? "flex min-h-0 flex-col gap-4 p-5 lg:h-full lg:overflow-hidden" : "space-y-5 p-5"}>
      <div className={`flex flex-wrap items-center justify-between gap-3 ${studioLayout ? "shrink-0" : ""}`}>

        <div className="flex flex-wrap gap-2">
          {studioLayout && <Dialog open={outlineOpen} onOpenChange={setOutlineOpen}>
            <DialogTrigger asChild><Button type="button" variant="secondary" disabled={disabled} aria-expanded={outlineOpen}>
              <ListOrdered aria-hidden="true" className="h-4 w-4" />{t("survey.design.outline")}
            </Button></DialogTrigger>
            <DialogContent className="max-h-[80dvh] max-w-lg overflow-y-auto" onCloseAutoFocus={(event) => {
              const selected = outlineSelection.current;
              outlineSelection.current = null;
              if (!selected) return;
              const target = Array.from(canvasRef.current?.querySelectorAll<HTMLElement>("[data-survey-question-id]") ?? []).find(item => item.dataset.surveyQuestionId === selected);
              if (target) { event.preventDefault(); target.scrollIntoView?.({ block: "center" }); target.focus({ preventScroll: true }); }
            }}>
              <DialogTitle>{t("survey.design.outline")}</DialogTitle>
              <DialogDescription>{t("survey.design.panelHint")}</DialogDescription>
              <fieldset disabled={disabled} className="min-w-0">{outlineContent}</fieldset>
            </DialogContent>
          </Dialog>}
          {studioLayout && !locked && (
            <>
              <Button type="button" variant="secondary" onClick={() => { setTrialPage(0); setTrialMode(true); }}>
                {t("survey.design.trySurvey")}
              </Button>
              <Button type="button" variant="secondary" aria-label={t("survey.design.undoLabel")} disabled={!undoStack.length} onClick={undo}>
                <Undo2 aria-hidden="true" className="h-4 w-4" />{t("survey.design.undo")}
              </Button>
              <Button type="button" variant="secondary" aria-label={t("survey.design.redoLabel")} disabled={!redoStack.length} onClick={redo}>
                <Redo2 aria-hidden="true" className="h-4 w-4" />{t("survey.design.redo")}
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
              {t("survey.design.finishEditing")}
            </Button>
          )}
          {!overviewFirst && !studioLayout && (
            <Button
              type="button"
              variant="outline"
              aria-expanded={preview}
              onClick={() => setPreview(!preview)}
            >
              {preview ? t("survey.design.collapsePreview") : t("survey.design.expandPreview")}
            </Button>
          )}
        </div>
      </div>
      <div
        data-testid={studioLayout ? "survey-designer-grid" : undefined}
        className={`grid min-w-0 gap-4 ${studioLayout && preview ? "lg:h-full lg:min-h-0 lg:flex-1 lg:grid-cols-[16rem_minmax(0,1fr)_18rem] lg:overflow-hidden xl:grid-cols-[16rem_minmax(0,1fr)_20rem]" : preview ? "xl:grid-cols-[16rem_minmax(0,1fr)_minmax(0,1fr)]" : "lg:grid-cols-[16rem_minmax(0,1fr)]"}`}
      >
        <ResponsiveDesignerPanel title={t(studioLayout ? "survey.design.toolbox" : "survey.design.outline")} enabled={studioLayout} disabled={disabled}>
        <aside data-testid={studioLayout ? "survey-designer-toolbox" : undefined} aria-label={t(studioLayout ? "survey.design.toolbox" : "survey.design.outline")} className="min-w-0 space-y-5 rounded-lg border border-border bg-card p-4 lg:h-full lg:overflow-y-auto">
          {studioLayout && !locked && <section aria-label={t("survey.design.toolbox")} className="space-y-3">
            <div className="flex items-start justify-between gap-2"><h2 className="text-14 font-semibold">{t("survey.design.toolbox")}</h2><Button type="button" size="sm" variant="ghost" onClick={() => add("short")}>{t("survey.design.addQuestion")}</Button></div>
            {Array.from(new Set(SURVEY_QUESTION_TYPES.map(item => item.category))).map(group => <div key={group}>
              <h3 className="mb-2 text-12 font-medium text-muted-foreground">{t(categoryKeys[group]!)}</h3>
              <div className="grid grid-cols-2 gap-2">
                {SURVEY_QUESTION_TYPES.filter(item => item.category === group).map(item => {
                  const Icon = questionTypeIcons[item.type] ?? FileText;
                  return <button
                    key={item.type} type="button" draggable={!disabled}
                    data-testid={`add-question-${item.type}`}
                    onDragStart={(event) => handleToolDragStart(event, item.type)}
                    onDragEnd={() => setDraggingType(null)}
                    onClick={() => add(item.type)}
                    className="flex min-h-9 cursor-grab items-center gap-2 rounded-md bg-muted px-3 py-2 text-left text-12 font-medium transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing"
                  ><Icon aria-hidden="true" className="h-5 w-5" />{typeLabel(item.type)}</button>;
                })}
              </div>
            </div>)}
          </section>}
          {!studioLayout && outlineContent}
          {!locked && !studioLayout && (
            <div className="mt-4 flex flex-wrap gap-2">
              <Button type="button" onClick={() => setPicking(!picking)}>
                {t("survey.design.addQuestion")}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => add("page_break")}
              >
                {t("survey.design.addSection")}
              </Button>
            </div>
          )}
          {deleted && !locked && (
            <div role="status" className="mt-4 space-y-2 text-12">
              {t("survey.design.deletedQuestion", { title: deleted.question.title })}
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
                {t("survey.design.undoDelete")}
              </Button>
            </div>
          )}
        </aside>
        </ResponsiveDesignerPanel>
        <ResponsiveDesignerPanel title={t("survey.design.settings")} enabled={studioLayout} disabled={disabled}>
        <section data-testid={studioLayout ? "survey-designer-settings" : undefined} aria-label={t("survey.design.settings")} className={`min-w-0 space-y-4 ${studioLayout && preview ? 'lg:order-3 lg:h-full lg:overflow-y-auto' : ''}`}>
          {locked && (
            <p className="rounded-md bg-muted p-3 text-12">
              {t("survey.design.publishedLocked")}
            </p>
          )}
          {picking && !locked && !studioLayout && (
            <div
              className="space-y-3 rounded-lg border border-border p-4"
              aria-label={t("survey.design.typePicker")}
            >
              <Input
                aria-label={t("survey.design.searchTypes")}
                placeholder={t("survey.design.searchTypesHint")}
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
                    {t(categoryKeys[item]!)}
                  </Button>
                ))}
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                {SURVEY_QUESTION_TYPES.filter(
                  (item) =>
                    (category === "全部" || item.category === category) &&
                    `${item.label} ${item.description} ${translate("en", `survey.design.type.${item.type}.label`)} ${translate("en", `survey.design.type.${item.type}.description`)}`
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
                      {typeLabel(item.type)}
                    </span>
                    <span className="text-12 text-muted-foreground">
                      {typeDescription(item.type)}
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
                  {question.provenance.source === "question-library" ? t("survey.design.sourceLibrary") : question.provenance.source === "template" ? t("survey.design.sourceTemplate") : t("survey.design.sourceManual")}
                  {t("survey.design.certification")}{question.provenance.certifiedAt ? t("survey.design.certified") : t("survey.design.uncertified")}
                </p>
              )}
              {!studioLayout && <label className="block text-12">
                {t("survey.design.content")}
                <Textarea
                  aria-label={t("survey.design.content")}
                  value={question.title}
                  onChange={(event) =>
                    update({ ...question, title: event.target.value })
                  }
                />
              </label>}
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="text-12">
                  {t("survey.design.questionType")}
                  <select
                    aria-label={t("survey.design.questionType")}
                    className="mt-1 w-full rounded-md border border-border bg-background p-2"
                    value={question.type}
                    onChange={(event) => {
                      const type = event.target.value as SurveyQuestionType;
                      if (type !== question.type) setPendingType(type);
                    }}
                  >
                    {SURVEY_QUESTION_TYPES.map((item) => (
                      <option key={item.type} value={item.type}>
                        {typeLabel(item.type)}
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
                  {t("survey.design.required")}
                </label>
              </div>
              <label className="block text-12">
                {t("survey.design.chapter")}
                <Input
                  aria-label={t("survey.design.chapter")}
                  value={question.chapterId}
                  onChange={(event) =>
                    update({ ...question, chapterId: event.target.value })
                  }
                />
              </label>
              {pendingType && (
                <div
                  role="alertdialog"
                  aria-label={t("survey.design.confirmTypeTitle")}
                  className="space-y-3 rounded-md border border-border bg-muted p-4"
                >
                  <p className="text-13">
                    {t("survey.design.confirmTypeHint", { type: typeLabel(pendingType), options: question.options.length, rows: question.config?.rows?.length ?? 0 })}
                  </p>
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setPendingType(undefined)}
                    >
                      {t("survey.design.cancelType")}
                    </Button>
                    <Button
                      type="button"
                      onClick={() => changeType(pendingType)}
                    >
                      {t("survey.design.confirmType")}
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
                <ul className="text-12 text-destructive" aria-label={t("survey.design.configCheck")}>
                  {issues.map((message, issueIndex) => (
                    <li key={`${issueIndex}:${message}`}>{displaySurveyDiagnostic(message, t)}</li>
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
                  {t("survey.design.moveUp")}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={index === questions.length - 1}
                  onClick={() => change(moveItem(questions, index, 1))}
                >
                  {t("survey.design.moveDown")}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    const copy = {
                      ...structuredClone(question),
                      id: crypto.randomUUID(),
                      title: t("survey.design.copyTitle", { title: question.title }),
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
                  {t("survey.design.copyQuestion")}
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
                  {t("survey.design.deleteQuestion")}
                </Button>
              </div>
            </fieldset>
          ) : (
            <p className="py-16 text-center text-muted-foreground">
              {t("survey.design.emptyDesign")}
            </p>
          )}
        </section>
        </ResponsiveDesignerPanel>
        {preview && !overviewFirst && (
          <aside ref={canvasRef} data-testid={studioLayout ? "survey-designer-canvas-scroll" : undefined} aria-label={t("survey.design.livePreview")} className={`min-w-0 space-y-4 bg-muted/30 ${studioLayout ? 'lg:order-2 lg:h-full lg:overflow-y-auto' : 'rounded-lg border border-border bg-card p-4'}`}>
            <div role="region" aria-label={t("survey.design.designCanvas")} className="space-y-4">
            {studioLayout && <h2 className="sr-only">{t("survey.design.designCanvas")}</h2>}
            <div className="sticky top-0 z-10 flex justify-center gap-2 bg-card p-2">
              <Button type="button" variant={previewDevice === "desktop" ? "secondary" : "ghost"} aria-pressed={previewDevice === "desktop"} onClick={() => setPreviewDevice("desktop")}>
                {t("survey.design.desktop")}
              </Button>
              <Button type="button" variant={previewDevice === "tablet" ? "secondary" : "ghost"} aria-pressed={previewDevice === "tablet"} onClick={() => setPreviewDevice("tablet")}>
                {t("survey.design.tablet")}
              </Button>
              <Button type="button" variant={previewDevice === "mobile" ? "secondary" : "ghost"} aria-pressed={previewDevice === "mobile"} onClick={() => setPreviewDevice("mobile")}>
                {t("survey.design.mobile")}
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
              className={`mx-auto space-y-2 bg-card py-6 shadow-sm ${draggingType ? "ring-2 ring-ring" : ""} ${previewDevice === "mobile" ? "max-w-sm" : previewDevice === "tablet" ? "max-w-2xl" : "w-full max-w-4xl"}`}
            >
              {studioLayout && <section aria-label={t("survey.design.cover")} className="px-6 py-8 text-center">
                <h2 className="text-24 font-semibold tracking-tight">{surveyTitle || t("survey.design.untitledSurvey")}</h2>
              </section>}
              {(studioLayout ? questions : visibleSurveyQuestions(questions, answers)).map((q, questionIndex) => (
                <React.Fragment key={`${q.id}-${q.type}`}>
                  {studioLayout && (questionIndex === 0 || questions[questionIndex - 1]?.chapterId !== q.chapterId) &&
                    <div className="mx-6 flex items-center justify-between gap-3 border-b border-border px-2 py-3">
                      <h3 className="text-16 font-semibold">{q.chapterId || t("survey.design.ungrouped")}</h3>
                      <span className="shrink-0 text-11 text-muted-foreground">
                        {t("survey.design.chapterCount", { count: questions.filter((item) => item.chapterId === q.chapterId).length })}
                      </span>
                    </div>}
                  <section data-survey-question-id={studioLayout ? q.id : undefined} tabIndex={studioLayout ? -1 : undefined} onClick={studioLayout ? () => { setId(q.id); setPendingType(undefined); } : undefined} className={studioLayout ? `group border px-4 py-5 transition-colors sm:px-8 ${q.id === question?.id ? "border-ring" : "border-transparent hover:border-border"}` : ""}>
                    {studioLayout && <div className="mb-2 flex items-start gap-2">
                      <span aria-hidden="true" className="min-w-4 shrink-0 pt-2 text-destructive">{q.required ? "*" : ""}</span>
                      <span className="shrink-0 whitespace-nowrap pt-2 text-16 font-semibold tabular-nums">{String(questionIndex + 1).padStart(2, "0")}</span>
                      <InlineQuestionText key={`${q.id}-title`} label={t("survey.design.content")} editLabel={t("survey.design.editQuestionTitle", { index: questionIndex + 1, title: q.title || t("survey.design.untitledQuestion") })} multiline disabled={locked || disabled}
                        className="min-w-0 flex-1 text-16 font-medium" value={q.title} onSelect={() => { setId(q.id); setPendingType(undefined); }} onChange={(title) => update({ ...q, title })} />
                    </div>}
                    {studioLayout && ["single", "multi", "dropdown"].includes(q.type) ? (
                      <fieldset disabled={locked || disabled} className="pl-10 text-13" aria-label={t("survey.design.editQuestion", { index: questionIndex + 1 })}>
                        <SurveyQuestionSettings
                          key={`${q.id}-inline-content`}
                          question={q}
                          questions={questions}
                          onChange={update}
                          mode="content"
                          inline
                        />
                      </fieldset>
                    ) : (
                      <div className={studioLayout ? "space-y-3 pl-10" : ""}>
                      {studioLayout && <InlineQuestionText key={`${q.id}-description`} label={t("survey.design.description")} placeholder={t("survey.design.addDescription")} multiline disabled={locked || disabled}
                        className="text-13 text-muted-foreground" value={q.config?.description ?? ""} onChange={(description) => update({ ...q, config: { ...q.config, description } })} />}
                      <SurveyQuestionRenderer
                        question={q}
                        showTitle={!studioLayout}
                        showDescription={!studioLayout}
                        value={answers[q.id]}
                        onChange={(value) => setAnswers((current) => ({ ...current, [q.id]: value }))}
                      />
                      {studioLayout && q.id === question?.id && !locked && <details className="text-12 text-muted-foreground"><summary className="cursor-pointer py-2">{t("survey.design.editContent")}</summary>
                        <SurveyQuestionSettings question={q} questions={questions} onChange={update} mode="content" inline showDescription={false} />
                      </details>}
                      </div>
                    )}
                    {studioLayout && !locked && <div aria-label={t("survey.design.questionActions", { index: questionIndex + 1 })} className={`mt-3 flex justify-end gap-1 ${q.id === question?.id ? "" : "invisible group-hover:visible group-focus-within:visible"}`}>
                      <Button type="button" size="icon" variant="ghost" aria-label={t("survey.design.addAfter", { index: questionIndex + 1 })} disabled={disabled} onClick={(event) => { event.stopPropagation(); const next = createQuestion("short", crypto.randomUUID(), questionIndex + 2); next.chapterId = q.chapterId; const all = [...questions]; all.splice(questionIndex + 1, 0, next); change(all); setId(next.id); }}><Plus className="size-4" /></Button>
                      <Button type="button" size="icon" variant="ghost" aria-label={t("survey.design.copyOrdinal", { index: questionIndex + 1 })} disabled={disabled} onClick={(event) => { event.stopPropagation(); const copy = { ...structuredClone(q), id: crypto.randomUUID(), provenance: q.provenance ? { ...q.provenance, certifiedAt: undefined } : undefined }; const all = [...questions]; all.splice(questionIndex + 1, 0, copy); change(all); setId(copy.id); }}><Copy className="size-4" /></Button>
                      <Button type="button" size="icon" variant="ghost" aria-label={t("survey.design.moveUpOrdinal", { index: questionIndex + 1 })} disabled={disabled || questionIndex === 0} onClick={(event) => { event.stopPropagation(); change(moveItem(questions, questionIndex, -1)); setId(q.id); }}><ArrowUp className="size-4" /></Button>
                      <Button type="button" size="icon" variant="ghost" aria-label={t("survey.design.moveDownOrdinal", { index: questionIndex + 1 })} disabled={disabled || questionIndex === questions.length - 1} onClick={(event) => { event.stopPropagation(); change(moveItem(questions, questionIndex, 1)); setId(q.id); }}><ArrowDown className="size-4" /></Button>
                      <Button type="button" size="icon" variant="ghost" aria-label={t("survey.design.deleteOrdinal", { index: questionIndex + 1 })} disabled={disabled} onClick={(event) => { event.stopPropagation(); setDeleted({ question: q, index: questionIndex }); change(questions.filter((item) => item.id !== q.id)); setId(questions[questionIndex + 1]?.id ?? questions[questionIndex - 1]?.id); }}><Trash2 className="size-4" /></Button>
                    </div>}
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
