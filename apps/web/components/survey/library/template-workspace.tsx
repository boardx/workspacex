"use client";
import { useI18n } from "@/lib/i18n/provider";
import type { MessageKey } from "@/lib/i18n/messages";
import { displaySurveyTemplateMessage } from "@/lib/survey/display-template-message";

import * as React from "react";
import { useSurveyUnsavedNavigation } from "@/lib/survey/use-unsaved-navigation";
import { useRouter } from "next/navigation";
import {
  SurveyLibraryTemplateSchema,
  SurveyTemplateInputSchema,
  type SurveyLibraryTemplate,
  type SurveyTemplateInput,
} from "@repo/contracts/survey-template-library";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { surveyRequest } from "@/lib/survey/runtime-client";
import { getBuiltinSurveyTemplate } from "@/lib/survey/builtin-templates";
import { SurveyQuestionEditor } from "../live/question-editor";
import { FlexibleReportEditor } from "../report/template-editor";

type Kind = SurveyTemplateInput["kind"];
const newDraft = (kind: Kind, title: string, reportTitle: string): SurveyTemplateInput => ({
  kind,
  title,
  description: "",
  questions: [],
  template: { id: crypto.randomUUID(), title: reportTitle, sections: [] },
});
const readTemplate = (value: unknown, kind: Kind): SurveyLibraryTemplate => {
  const result = SurveyLibraryTemplateSchema.safeParse(value);
  if (!result.success) throw new Error("模板数据格式不正确，请刷新后重试。");
  if (result.data.kind !== kind)
    throw new Error("模板类型不匹配，请返回模板列表选择。");
  return result.data;
};

// Response metadata is not part of the bounded write request.
const templateDraft = ({
  kind,
  title,
  description,
  questions,
  template,
}: SurveyTemplateInput): SurveyTemplateInput => ({
  kind,
  title,
  description,
  questions,
  template,
});

export function SurveyTemplateWorkspace({
  templateId,
  kind,
}: {
  templateId: string;
  kind: Kind;
}) {
  const router = useRouter();
  const { t, locale } = useI18n();
  const currentTranslator = React.useRef(t);
  React.useEffect(() => { currentTranslator.current = t; }, [t]);
  const [saved, setSaved] = React.useState<SurveyLibraryTemplate | null>(null);
  const [draft, setDraft] = React.useState<SurveyTemplateInput | null>(null);
  const [builtinBaseline, setBuiltinBaseline] =
    React.useState<SurveyTemplateInput | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<Error | string>("");
  const [notice, setNotice] = React.useState<MessageKey | null>(null);
  const [tab, setTab] = React.useState<"questions" | "report">(
    kind === "question" ? "questions" : "report",
  );
  const generation = React.useRef(0);
  const invalidate = React.useCallback(() => {
    generation.current++;
  }, []);
  const lock = React.useRef(false);
  const label = t(kind === "question" ? "survey.templates.questionOne" : "survey.templates.reportOne");
  const base =
    kind === "question"
      ? "/studio/survey/question-templates"
      : "/studio/survey/templates";
  const list = `/studio/survey?tab=${kind === "question" ? "modules" : "reports"}`;
  const isBuiltin = templateId.startsWith("builtin-") && !saved;
  const baseline = saved ? templateDraft(saved) : builtinBaseline;
  const dirty =
    !!draft &&
    (!baseline || JSON.stringify(draft) !== JSON.stringify(baseline));
  const accept = React.useCallback((value: SurveyLibraryTemplate) => {
    setSaved(value);
    setBuiltinBaseline(null);
    setDraft(templateDraft(value));
  }, []);
  const load = React.useCallback(async () => {
    const current = ++generation.current;
    setLoading(true);
    setError("");
    setNotice(null);
    if (templateId === "new") {
      setSaved(null);
      setDraft(newDraft(kind,
        currentTranslator.current(kind === "question" ? "survey.templates.newQuestion" : "survey.templates.newReport"),
        currentTranslator.current("survey.templates.analysisReport"),
      ));
      setLoading(false);
      return;
    }
    try {
      if (templateId.startsWith("builtin-")) {
        const builtin = getBuiltinSurveyTemplate(templateId, kind);
        if (!builtin)
          throw new Error("内置模板不存在或类型不匹配，请返回模板列表选择。");
        const configuration = templateDraft(builtin);
        setSaved(null);
        setDraft(configuration);
        setBuiltinBaseline(structuredClone(configuration));
        return;
      }
      const value = readTemplate(
        await surveyRequest(
          `/surveys/templates/${encodeURIComponent(templateId)}`,
        ),
        kind,
      );
      if (current === generation.current) accept(value);
    } catch (e) {
      if (current === generation.current)
        setError(e instanceof Error ? e : "模板加载失败，请重试。");
    } finally {
      if (current === generation.current) setLoading(false);
    }
  }, [templateId, kind, accept]);
  React.useEffect(() => {
    setSaved(null);
    setDraft(null);
    setBuiltinBaseline(null);
    setTab(kind === "question" ? "questions" : "report");
    void load();
    return invalidate;
  }, [kind, load, invalidate]);
  useSurveyUnsavedNavigation(dirty);
  const save = async (asCopy = false) => {
    if (lock.current || !draft) return;
    lock.current = true;
    setBusy(true);
    setError("");
    setNotice(null);
    const current = generation.current;
    try {
      const parsed = SurveyTemplateInputSchema.safeParse({
        ...draft,
        ...(asCopy ? { title: `${draft.title.slice(0, locale === "en" ? SurveyLibraryTemplateSchema.shape.title.maxLength! - t("survey.templates.copySuffix").length : 197)}${t("survey.templates.copySuffix")}` } : {}),
      });
      if (!parsed.success)
        throw new Error(
          parsed.error.issues.find(
            (issue) => issue.code === "custom" && issue.path.length === 0,
          )?.message ?? "请检查模板名称、说明、题目选项和报告配置后重试。",
        );
      const create = asCopy || !saved;
      const result = readTemplate(
        await surveyRequest(
          create
            ? "/surveys/templates"
            : `/surveys/templates/${encodeURIComponent(saved.id)}`,
          {
            method: create ? "POST" : "PUT",
            body: {
              ...parsed.data,
              ...(!create ? { expectedVersion: saved.version } : {}),
            },
          },
        ),
        kind,
      );
      if (current !== generation.current) return;
      accept(result);
      setNotice(asCopy ? "survey.templates.copySaved" : "survey.templates.saved");
      if (create) router.replace(`${base}/${encodeURIComponent(result.id)}`);
    } catch (e) {
      if (current === generation.current)
        setError(
          e instanceof Error ? e : "保存失败，修改仍保留，请重试。",
        );
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  const back = () => {
    if (!dirty || window.confirm(t("survey.templates.leaveConfirm")))
      router.push(list);
  };
  const refresh = () => {
    if (
      !dirty ||
      window.confirm(
        t("survey.templates.refreshConfirm"),
      )
    )
      void load();
  };
  return (
    <main className="min-w-0 bg-background text-background-foreground">
      <header className="space-y-4 border-b border-border bg-card p-4 sm:p-6">
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="ghost" disabled={busy} onClick={back}>
            {t("survey.templates.back")}
          </Button>
          <div className="min-w-0 basis-full sm:basis-0 sm:flex-1">
            <h1 className="text-20 font-semibold">
              {t(isBuiltin ? "survey.templates.builtinHeading" : templateId === "new" ? "survey.templates.newHeading" : "survey.templates.editHeading", { label })}
            </h1>
            <p className="mt-1 text-11 text-muted-foreground">
              {dirty
                ? t("survey.templates.unsaved")
                : saved
                  ? t("survey.templates.savedDate", { date: new Date(saved.updatedAt).toLocaleString(locale) })
                  : builtinBaseline
                    ? t("survey.templates.builtinUnchanged")
                    : t("survey.templates.loadingShort")}
            </p>
          </div>
          {saved && (
            <>
              <Button
                variant="outline"
                disabled={busy || loading}
                onClick={refresh}
              >
                {t("survey.templates.refresh")}
              </Button>
              <Button
                variant="outline"
                disabled={busy || loading || !draft}
                onClick={() => void save(true)}
              >
                {t("survey.templates.saveCopy")}
              </Button>
            </>
          )}
          <Button
            disabled={busy || loading || !draft || (!dirty && !isBuiltin)}
            onClick={() => void save()}
          >
            {t(busy ? "survey.templates.saving" : isBuiltin ? "survey.templates.saveAsMine" : "survey.templates.save")}
          </Button>
        </div>
        {isBuiltin && draft && (
          <p className="text-12 text-muted-foreground">
            {t("survey.templates.builtinImmutable")}
          </p>
        )}
        {draft && (
          <div className="grid gap-4 md:grid-cols-2">
            <label className="space-y-1 text-12">
              <span>{t("survey.templates.name")}</span>
              <Input
                aria-label={t("survey.templates.name")}
                maxLength={200}
                disabled={busy || loading}
                value={draft.title}
                onChange={(event) =>
                  setDraft({ ...draft, title: event.target.value })
                }
              />
            </label>
            <label className="space-y-1 text-12">
              <span>{t("survey.templates.description")}</span>
              <Textarea
                aria-label={t("survey.templates.description")}
                className="min-h-10"
                rows={1}
                maxLength={2000}
                disabled={busy || loading}
                value={draft.description}
                onChange={(event) =>
                  setDraft({ ...draft, description: event.target.value })
                }
              />
            </label>
          </div>
        )}
      </header>
      {error && (
        <div className="m-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/30 p-4">
          <p role="alert" className="text-13 text-destructive">
            {displaySurveyTemplateMessage(error, t, locale)}
          </p>
          {!draft && (
            <Button
              variant="outline"
              disabled={busy || loading}
              onClick={() => void load()}
            >
              {t("survey.templates.retry")}
            </Button>
          )}
          {draft && (
            <p className="text-12 text-muted-foreground">
              {t(saved ? "survey.templates.retainedSaved" : "survey.templates.retainedNew")}
            </p>
          )}
        </div>
      )}
      {notice && (
        <p role="status" className="px-6 py-3 text-13 text-muted-foreground">
          {t(notice, { label })}
        </p>
      )}
      {loading && (
        <p role="status" className="p-8 text-13 text-muted-foreground">
          {t("survey.templates.loading")}
        </p>
      )}
      {draft && (
        <>
          <div className="border-b border-border px-4 pt-4 sm:px-6">
            <div role="tablist" aria-label={t("survey.templates.settings")} className="flex gap-2">
              {(
                [
                  ["questions", "survey.templates.questionsTab"],
                  ["report", "survey.templates.reportTab"],
                ] as const
              ).map(([id, name]) => (
                <button
                  type="button"
                  role="tab"
                  key={id}
                  id={`template-tab-${id}`}
                  aria-controls={`template-panel-${id}`}
                  aria-selected={tab === id}
                  disabled={busy || loading}
                  onClick={() => setTab(id)}
                  className={`rounded-t-md border-b-2 px-4 py-3 text-13 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${tab === id ? "border-primary bg-accent font-semibold" : "border-transparent text-muted-foreground hover:bg-muted"}`}
                >
                  {t(name)}
                </button>
              ))}
            </div>
            <p className="py-3 text-12 text-muted-foreground">
              {tab === "questions"
                ? kind === "report"
                  ? t("survey.templates.referenceHint")
                  : t("survey.templates.questionHint")
                : t("survey.templates.reportHint")}
            </p>
          </div>
          <fieldset
            disabled={busy || loading}
            role="tabpanel"
            id={`template-panel-${tab}`}
            aria-labelledby={`template-tab-${tab}`}
            className="min-w-0"
          >
            {tab === "questions" ? (
              <SurveyQuestionEditor
                questions={draft.questions}
                onChange={(questions) => setDraft({ ...draft, questions })}
                overviewFirst={kind === "question"}
              />
            ) : (
              <FlexibleReportEditor
                template={draft.template}
                onChange={(template) => setDraft({ ...draft, template })}
                questions={draft.questions}
                responses={[]}
              />
            )}
          </fieldset>
        </>
      )}
    </main>
  );
}
