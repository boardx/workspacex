"use client";
import { useI18n } from "@/lib/i18n/provider";
import type { MessageKey } from "@/lib/i18n/messages";
import { displaySurveyTemplateMessage } from "@/lib/survey/display-template-message";
import * as React from "react";
import Link from "next/link";
import {
  SurveyLibraryTemplateSchema,
  SurveyTemplateInputSchema,
  type SurveyLibraryTemplate,
} from "@repo/contracts/survey-template-library";
import type { SurveyDraftInput } from "@repo/contracts/survey-runtime";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { surveyRequest } from "@/lib/survey/runtime-client";
import {
  getBuiltinSurveyTemplates,
  type BuiltinSurveyTemplate,
} from "@/lib/survey/builtin-templates";
import {
  remapReportTemplate,
  requiredTemplateQuestions,
} from "@/lib/survey/template-reuse";

type Props = {
  kind: "question" | "report";
  draft: SurveyDraftInput;
  onApply: (draft: SurveyDraftInput, action?: "unbind" | "undo-unbind") => void;
  locked?: boolean;
  disabled?: boolean;
  saveOnly?: boolean;
};
const selectStyle =
  "w-full rounded-md border border-border bg-background p-2 text-12";
export function SurveyTemplateActions({
  kind,
  draft,
  onApply,
  locked = false,
  disabled = false,
  saveOnly = false,
}: Props) {
  const { t, locale } = useI18n();
  const label = t(kind === "question" ? "survey.templates.questionOne" : "survey.templates.reportOne");
  const [mode, setMode] = React.useState<"save" | "use" | null>(null);
  const [name, setName] = React.useState("");
  const [error, setError] = React.useState<Error | string>("");
  const [loadError, setLoadError] = React.useState<Error | string>("");
  const [notice, setNotice] = React.useState<MessageKey | null>(null);
  const [busy, setBusy] = React.useState(false);
  const saveLock = React.useRef(false);
  const [loading, setLoading] = React.useState(false);
  const [rows, setRows] = React.useState<SurveyLibraryTemplate[]>([]);
  const [selected, setSelected] = React.useState("");
  const [bindings, setBindings] = React.useState<Record<string, string>>({});
  const [attempt, setAttempt] = React.useState(0);
  const [unbound, setUnbound] = React.useState<{ previous: SurveyDraftInput["template"]; cleared: SurveyDraftInput["template"] } | null>(null);
  const canUndoUnbind = !!unbound && draft.template.id === unbound.cleared.id &&
    draft.template.title === unbound.cleared.title && draft.template.sections.length === 0;
  const builtins = React.useMemo(() => getBuiltinSurveyTemplates(kind), [kind]);
  const choices: (SurveyLibraryTemplate | BuiltinSurveyTemplate)[] = [
    ...builtins,
    ...rows,
  ];
  const source = choices.find((row) => row.id === selected);
  const refs =
    source && kind === "report"
      ? requiredTemplateQuestions(source.template)
      : [];
  React.useEffect(() => {
    if (mode !== "use") return;
    let active = true;
    setLoading(true);
    setLoadError("");
    setRows([]);
    void surveyRequest<unknown>(`/surveys/templates?kind=${kind}`)
      .then((data) => {
        const parsed = SurveyLibraryTemplateSchema.array().safeParse(data);
        if (!parsed.success || parsed.data.some((row) => row.kind !== kind))
          throw new Error("模板数据格式不正确，请重试加载。");
        if (active) setRows(parsed.data);
      })
      .catch((e) => {
        if (active) setLoadError(e instanceof Error ? e : String(e));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [mode, kind, attempt]);
  const open = (next: "save" | "use") => {
    setName(kind === "question" ? draft.title : draft.template.title);
    setError("");
    setNotice(null);
    setLoadError("");
    setSelected("");
    setBindings({});
    setMode(next);
  };
  const save = async () => {
    if (saveLock.current || disabled) return;
    saveLock.current = true;
    setBusy(true);
    setError("");
    try {
      const input = SurveyTemplateInputSchema.safeParse({
        kind,
        title: name,
        description: "",
        questions: draft.questions,
        template: draft.template,
      });
      if (!input.success)
        throw new Error(
          input.error.issues.find(
            (issue) => issue.code === "custom" && issue.path.length === 0,
          )?.message ?? "请填写模板名称，并先完善题目和内容块配置。",
        );
      const saved = SurveyLibraryTemplateSchema.safeParse(
        await surveyRequest("/surveys/templates", {
          method: "POST",
          body: input.data,
        }),
      );
      if (!saved.success || saved.data.kind !== kind)
        throw new Error("模板保存结果无法确认，请前往模板库核对后重试。");
      setNotice("survey.templates.savedLibrary");
      setMode(null);
    } catch (e) {
      setError(e instanceof Error ? e : String(e));
    } finally {
      saveLock.current = false;
      setBusy(false);
    }
  };
  const apply = () => {
    if (!source || busy || locked || disabled) return;
    setError("");
    try {
      const next =
        kind === "question"
          ? {
              ...draft,
              questions: structuredClone(source.questions).map((question) => ({
                ...question,
                provenance: { source: "template" as const, sourceId: source.id },
              })),
              template: structuredClone(source.template),
            }
          : {
              ...draft,
              template: remapReportTemplate(source, draft.questions, bindings),
            };
      if (kind === "question" && !next.questions.length)
        throw new Error("此模板还没有题目，请先在模板库完善。");
      if (
        !window.confirm(
          kind === "question"
            ? t("survey.templates.replaceQuestions")
            : t("survey.templates.replaceReport"),
        )
      )
        return;
      onApply(next);
      setUnbound(null);
      setMode(null);
      setNotice("survey.templates.applied");
    } catch (e) {
      setError(e instanceof Error ? e : String(e));
    }
  };
  return (
    <section
      className={saveOnly ? "" : "border-b border-border bg-card px-5 py-3"}
      aria-label={t("survey.templates.actions", { label })}
    >
      <div className="flex flex-wrap items-center gap-2">
        {!saveOnly && <Button
          variant="outline"
          disabled={disabled || locked}
          onClick={() => open("use")}
        >
          {t("survey.templates.use", { label })}
        </Button>}
        <Button
          variant={saveOnly ? "primary" : "outline"}
          className={saveOnly ? "w-full justify-start" : undefined}
          disabled={disabled}
          onClick={() => open("save")}
        >
          {t("survey.templates.saveAs", { label })}
        </Button>
        {!saveOnly && <Link
          className="px-2 text-12 text-muted-foreground underline"
          href={`/studio/survey?tab=${kind === "question" ? "modules" : "reports"}`}
        >
          {t("survey.templates.manage")}
        </Link>}
        {kind === "report" && !saveOnly && draft.template.sections.length > 0 && (
          <Button variant="outline" disabled={disabled || busy || locked} onClick={() => {
            if (disabled || busy || locked) return;
            const cleared = { id: crypto.randomUUID(), title: draft.title.trim(), sections: [] };
            setUnbound({ previous: structuredClone(draft.template), cleared });
            onApply({ ...draft, template: cleared }, "unbind");
            setNotice("survey.templates.unlinked");
          }}>{t("survey.templates.unlink")}</Button>
        )}
        {kind === "report" && !saveOnly && canUndoUnbind && (
          <Button variant="outline" disabled={disabled || busy || locked} onClick={() => {
            if (disabled || busy || locked || !unbound) return;
            onApply({ ...draft, template: structuredClone(unbound.previous) }, "undo-unbind");
            setUnbound(null);
            setNotice("survey.templates.restored");
          }}>{t("survey.templates.undo")}</Button>
        )}
        {locked && !saveOnly && (
          <span className="text-12 text-muted-foreground">
            {t("survey.templates.locked")}
          </span>
        )}
      </div>
      {notice && (
        <p role="status" className="mt-2 text-12 text-success">
          {t(notice, { label })}
        </p>
      )}
      <Dialog
        open={mode !== null}
        onOpenChange={(value) => {
          if (!value && !busy) setMode(null);
        }}
      >
        <DialogContent className={`max-h-[85vh] overflow-y-auto sm:max-w-xl ${saveOnly ? "[&_button:not(:disabled)]:bg-primary [&_button:not(:disabled)]:text-primary-foreground [&_button:not(:disabled):hover]:bg-primary-hover" : ""}`}>
          <DialogHeader>
            <DialogTitle>
              {t(mode === "save" ? "survey.templates.saveAs" : "survey.templates.use", { label })}
            </DialogTitle>
            <DialogDescription>
              {mode === "save"
                ? t("survey.templates.saveHint")
                : t("survey.templates.applyHint")}
            </DialogDescription>
          </DialogHeader>
          {error && (
            <p role="alert" className="text-12 text-destructive">
              {displaySurveyTemplateMessage(error, t, locale)}
            </p>
          )}
          {mode === "use" && loadError && (
            <p role="alert" className="text-12 text-destructive">
              {displaySurveyTemplateMessage(loadError, t, locale)}
            </p>
          )}
          {mode === "save" ? (
            <>
              <label className="space-y-2 text-12">
                {t("survey.templates.name")}
                <Input
                  aria-label={t("survey.templates.saveName")}
                  value={name}
                  maxLength={200}
                  disabled={busy || disabled}
                  onChange={(e) => setName(e.target.value)}
                />
              </label>
              <Button
                variant="primary"
                disabled={busy || disabled || !name.trim()}
                onClick={() => void save()}
              >
                {t(busy ? "survey.templates.saving" : "survey.templates.saveLibrary")}
              </Button>
            </>
          ) : (
            <>
              {loading && <p role="status">{t("survey.templates.loadingMine")}</p>}
              {loadError && (
                <Button
                  variant="outline"
                  disabled={loading}
                  onClick={() => setAttempt((n) => n + 1)}
                >
                  {t("survey.templates.retryLoad")}
                </Button>
              )}
              {!loading && !loadError && !rows.length && (
                <p className="text-12 text-muted-foreground">
                  {t("survey.templates.noPersonal", { label })}
                </p>
              )}
              {choices.length > 0 && (
                <label className="space-y-2 text-12">
                  {t("survey.templates.select", { label })}
                  <select
                    aria-label={t("survey.templates.select", { label })}
                    className={selectStyle}
                    value={selected}
                    disabled={busy || disabled}
                    onChange={(event) => {
                      setSelected(event.target.value);
                      setBindings({});
                      setError("");
                    }}
                  >
                    <option value="">{t("survey.templates.selectPlaceholder")}</option>
                    <optgroup label={t("survey.templates.builtin")}>
                      {builtins.map((row) => (
                        <option key={row.id} value={row.id}>
                          {row.title}
                        </option>
                      ))}
                    </optgroup>
                    {rows.length > 0 && (
                      <optgroup label={t("survey.templates.mine")}>
                        {rows.map((row) => (
                          <option key={row.id} value={row.id}>
                            {row.title}
                          </option>
                        ))}
                      </optgroup>
                    )}
                  </select>
                </label>
              )}
              {source && (
                <p className="text-12 text-muted-foreground">
                  {t("survey.templates.counts", { questions: source.questions.length, sections: source.template.sections.length })}
                  {source.id.startsWith("builtin-")
                    ? t("survey.templates.builtinIndependent")
                    : ""}
                </p>
              )}
              {refs.length > 0 && (
                <fieldset className="space-y-3" disabled={busy || disabled}>
                  <legend className="mb-3 text-14 font-medium">
                    {t("survey.templates.matchLegend")}
                  </legend>
                  {refs.map((id) => {
                    const question = source!.questions.find((q) => q.id === id);
                    return (
                      <label key={id} className="block space-y-1 text-12">
                        {question?.title ?? t("survey.templates.invalidReference")}
                        <select
                          aria-label={t("survey.templates.match", { title: question?.title ?? id })}
                          className={selectStyle}
                          value={bindings[id] ?? ""}
                          onChange={(event) =>
                            setBindings({
                              ...bindings,
                              [id]: event.target.value,
                            })
                          }
                        >
                          <option value="">{t("survey.templates.selectCurrent")}</option>
                          {draft.questions
                            .filter((q) => q.type === question?.type)
                            .map((q) => (
                              <option key={q.id} value={q.id}>
                                {q.order}. {q.title}
                              </option>
                            ))}
                        </select>
                      </label>
                    );
                  })}
                </fieldset>
              )}
              <Button
                disabled={
                  !source ||
                  busy ||
                  disabled ||
                  locked ||
                  refs.some((id) => !bindings[id])
                }
                onClick={apply}
              >
                {t("survey.templates.apply")}
              </Button>
            </>
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}
