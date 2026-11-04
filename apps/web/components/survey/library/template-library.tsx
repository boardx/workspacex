"use client";
import { useI18n } from "@/lib/i18n/provider";
import type { MessageKey } from "@/lib/i18n/messages";
import { displaySurveyTemplateMessage } from "@/lib/survey/display-template-message";
import { WorkflowActionButton } from "@/components/research-studio/research-workflow-actions";


import { ResourceCard } from "@/components/ui/resource-card";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Copy, FileText, Plus, Search, Trash2 } from "lucide-react";
import {
  SurveyLibraryTemplateSchema,
  SurveyTemplateInputSchema,
  type SurveyLibraryTemplate,
  type SurveyTemplateInput,
} from "@repo/contracts/survey-template-library";
import { SurveyRuntimeSchema } from "@repo/contracts/survey-runtime";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { surveyRequest } from "@/lib/survey/runtime-client";

import { getBuiltinSurveyTemplates } from "@/lib/survey/builtin-templates";
import { BuiltinTemplateCards } from "./builtin-template-cards";
import { SurveyLibraryNav } from "./survey-library-nav";

type Kind = SurveyLibraryTemplate["kind"];
export function SurveyTemplateLibrary({ kind }: { kind: Kind }) {
  const router = useRouter();
  const { t, locale } = useI18n();
  const [items, setItems] = React.useState<SurveyLibraryTemplate[]>([]);
  const [query, setQuery] = React.useState("");
  const [loading, setLoading] = React.useState(true);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<Error | string>("");
  const [loadError, setLoadError] = React.useState<Error | string>("");
  const [notice, setNotice] = React.useState<MessageKey | null>(null);
  const generation = React.useRef(0);
  const createdDuringLoad = React.useRef<SurveyLibraryTemplate[]>([]);
  const invalidate = React.useCallback(() => {
    generation.current++;
  }, []);
  const locked = React.useRef(false);
  const label = t(kind === "question" ? "survey.templates.questionOne" : "survey.templates.reportOne");
  const base =
    kind === "question"
      ? "/studio/survey/question-templates"
      : "/studio/survey/templates";
  const readRow = (data: unknown) => {
    const parsed = SurveyLibraryTemplateSchema.safeParse(data);
    if (!parsed.success || parsed.data.kind !== kind)
      throw new Error("模板数据格式不正确，请刷新后重试。");
    return parsed.data;
  };
  const refresh = React.useCallback(async () => {
    const current = ++generation.current;
    createdDuringLoad.current = [];
    setLoading(true);
    setLoadError("");
    try {
      const parsed = SurveyLibraryTemplateSchema.array().safeParse(
        await surveyRequest("/surveys/templates", { query: { kind } }),
      );
      if (!parsed.success || parsed.data.some((item) => item.kind !== kind))
        throw new Error("模板数据格式不正确，请刷新后重试。");
      if (current === generation.current) {
        const created = createdDuringLoad.current;
        setItems([...created, ...parsed.data.filter(item => !created.some(copy => copy.id === item.id))]);
      }
    } catch (e) {
      if (current === generation.current)
        setLoadError(e instanceof Error ? e : "模板加载失败，请重试。");
    } finally {
      if (current === generation.current) setLoading(false);
    }
  }, [kind]);
  React.useEffect(() => {
    setItems([]);
    setQuery("");
    setNotice(null);
    void refresh();
    return invalidate;
  }, [refresh, invalidate]);
  const execute = async (action: (current: number) => Promise<void>) => {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    setError("");
    setNotice(null);
    const current = generation.current;
    try {
      await action(current);
    } catch (e) {
      if (current === generation.current)
        setError(e instanceof Error ? e : "操作未完成，请重试。");
    } finally {
      locked.current = false;
      setBusy(false);
    }
  };
  const duplicate = (item: SurveyTemplateInput) =>
    execute(async (current) => {
      const body = SurveyTemplateInputSchema.parse({
        kind: item.kind,
        title: `${item.title.slice(0, locale === "en" ? SurveyLibraryTemplateSchema.shape.title.maxLength! - t("survey.templates.copySuffix").length : 197)}${t("survey.templates.copySuffix")}`,
        description: item.description,
        questions: item.questions,
        template: item.template,
      });
      const saved = readRow(
        await surveyRequest("/surveys/templates", { method: "POST", body }),
      );
      if (current !== generation.current) return;
      if (loading) createdDuringLoad.current = [saved, ...createdDuringLoad.current];
      setItems((previous) => [saved, ...previous]);
      setQuery("");
      setNotice("survey.templates.copyCreated");
    });
  const remove = (item: SurveyLibraryTemplate) => {
    if (
      !window.confirm(
        t("survey.templates.deleteConfirm", { title: item.title }),
      )
    )
      return;
    void execute(async (current) => {
      await surveyRequest(`/surveys/templates/${encodeURIComponent(item.id)}`, {
        method: "DELETE",
        query: { expectedVersion: String(item.version) },
      });
      if (current !== generation.current) return;
      setItems((previous) => previous.filter((value) => value.id !== item.id));
      setNotice("survey.templates.deleted");
    });
  };
  const createSurvey = (item: SurveyTemplateInput) =>
    execute(async (current) => {
      const parsed = SurveyRuntimeSchema.safeParse(
        await surveyRequest("/surveys", {
          method: "POST",
          body: {
            title: item.title,
            questions: item.questions,
            template: item.template,
          },
        }),
      );
      if (!parsed.success)
        throw new Error("问卷创建结果无法确认，请返回问卷列表核对后再试。");
      if (current === generation.current)
        router.push(`/studio/survey/${encodeURIComponent(parsed.data.id)}`);
    });
  const visible = items.filter((item) =>
    `${item.title} ${item.description}`
      .toLocaleLowerCase()
      .includes(query.trim().toLocaleLowerCase()),
  );
  const builtins = getBuiltinSurveyTemplates(kind).filter(item => `${item.title} ${item.description}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  return (
    <main className="mx-auto max-w-screen-2xl space-y-7 p-5 text-background-foreground sm:p-7 lg:p-10">
      <header className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
        <div>
          <h1 className="text-30 font-semibold tracking-tight">{t(kind === "question" ? "survey.templates.question" : "survey.templates.report")}</h1>

        </div>
        <div className="flex w-full flex-col gap-2 sm:flex-row xl:w-auto">
          <div className="relative min-w-0 sm:w-72">
            <Search
              className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground"
              aria-hidden
            />
            <Input
              aria-label={t("survey.templates.search")}
              placeholder={t("survey.templates.searchPlaceholder")}
              className="w-full pl-9"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
          <Button
            variant="outline"
            disabled={loading || busy}
            onClick={() => void refresh()}
          >
            {t("survey.templates.refresh")}
          </Button>
          <WorkflowActionButton variant="primary" disabled={busy} onClick={() => router.push(`${base}/new`)}>
            <Plus className="h-4 w-4" aria-hidden />
            {t("survey.templates.create", { label })}
          </WorkflowActionButton>
        </div>
      </header>
      <div className="flex flex-col gap-6">
        <SurveyLibraryNav active={kind === "question" ? "modules" : "reports"} />
        <section className="min-w-0 space-y-6" aria-label={t("survey.templates.list", { label })}>
      {(error || loadError) && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/30 bg-card p-4">
          <p role="alert" className="text-13 text-destructive">
            {[loadError,error].filter(Boolean).map(message => displaySurveyTemplateMessage(message, t, locale)).join(locale === "en" ? "; " : "；")}
          </p>
          <Button
            variant="outline"
            disabled={loading || busy}
            onClick={() => void refresh()}
          >
            {t("survey.templates.retry")}
          </Button>
        </div>
      )}
      {notice && (
        <p role="status" className="text-13 text-muted-foreground">
          {t(notice, { label })}
        </p>
      )}
      <BuiltinTemplateCards items={builtins} base={base} busy={busy} onCopy={item=>void duplicate(item)} onCreate={item=>void createSurvey(item)} />
      <h2 className="border-t border-border pt-6 text-16 font-semibold">{t("survey.templates.mine")}</h2>
      {loading && (
        <p role="status" className="py-8 text-13 text-muted-foreground">
          {t("survey.templates.loading")}
        </p>
      )}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {visible.map((item) => (
          <ResourceCard
            key={item.id}
            title={item.title}
            leading={<FileText className="mt-0.5 h-5 w-5 text-primary" aria-hidden />}
            subtitle={t(kind === "report" ? "survey.templates.referenceCounts" : "survey.templates.counts", { questions: item.questions.length, sections: item.template.sections.length })}
            description={<span className="whitespace-pre-wrap break-words">{item.description || t("survey.templates.noDescription")}</span>}
            meta={<span>{t("survey.templates.updated", { date: new Date(item.updatedAt).toLocaleString(locale) })}</span>}
            actions={
              <>
                <Button asChild size="sm" variant="outline">
                  <Link href={`${base}/${encodeURIComponent(item.id)}`}>{t("survey.templates.edit")}</Link>
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={t("survey.templates.copyLabel")}
                  disabled={busy || loading}
                  onClick={() => void duplicate(item)}
                >
                  <Copy className="mr-1 h-3.5 w-3.5" aria-hidden />
                  {t("survey.templates.copy")}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={t("survey.templates.deleteLabel")}
                  disabled={busy || loading}
                  onClick={() => remove(item)}
                >
                  <Trash2 className="mr-1 h-3.5 w-3.5" aria-hidden />
                  {t("survey.templates.delete")}
                </Button>
              </>
            }
          >
            {kind === "question" && (
              <>
                <Button
                  className="w-full"
                  size="sm"
                  disabled={busy || loading || item.questions.length === 0}
                  onClick={() => void createSurvey(item)}
                >
                  {t("survey.templates.createSurvey")}
                </Button>
                {!item.questions.length && (
                  <p className="text-11 text-muted-foreground">
                    {t("survey.templates.addFirst")}
                  </p>
                )}
              </>
            )}
          </ResourceCard>
        ))}
      </div>
      {!loading && !error && !loadError && visible.length === 0 && (
        <div className="rounded-lg border border-dashed border-border px-6 py-14 text-center">
          <FileText
            className="mx-auto mb-4 h-8 w-8 text-muted-foreground"
            aria-hidden
          />
          <p className="text-16 font-medium">
            {items.length ? t("survey.templates.noMatches") : t("survey.templates.none", { label })}
          </p>
          <p className="mt-2 text-13 text-muted-foreground">
            {items.length
              ? t("survey.templates.otherKeywords")
              : t("survey.templates.emptyHint")}
          </p>
        </div>
      )}
        </section>
      </div>
    </main>
  );
}
