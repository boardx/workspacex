"use client";
import { displaySurveyReportIssue } from "@/lib/survey/display-report-issue";
import { surveyRuntimeMessages } from "@/lib/survey/runtime-error-copy";
import type { MessageKey } from "@/lib/i18n/messages";
import { displaySurveyRuntimeError, SurveyDesignDiagnosticsError } from "@/lib/survey/display-runtime-error";
import { displaySurveyDiagnostic } from "@/lib/survey/display-diagnostic";
import { useI18n } from "@/lib/i18n/provider";
import { WorkflowActionBar, WorkflowActionButton } from "@/components/research-studio/research-workflow-actions";

import * as React from "react";
import { parseSurveyDesignMarkdown, serializeSurveyDesignMarkdown, serializeSurveyReportTemplateMarkdown } from "@repo/contracts/survey-source";
import { useSurveyUnsavedNavigation } from "@/lib/survey/use-unsaved-navigation";
import { useRouter } from "next/navigation";
import { projectResearchHref, withProjectId } from "@/components/project/project-breadcrumb";
import { linkProjectResource } from "@/lib/live-project-resources";
import { survey } from "@repo/contracts";
import { surveyReportShareBlockedReason } from "@repo/contracts/survey-report";
import { surveyCollectionAccessError } from "@repo/contracts/survey-collection-window";
import { CollectionScheduleFields, collectionScheduleInput } from "./collection-schedule";
import {
  SurveyRuntimeSchema,
  SurveyDraftInputSchema,
  type SurveyRuntime,
  type SurveyDraftInput,
} from "@repo/contracts/survey-runtime";
import type { SurveyPublishBlocker } from "@repo/contracts/survey";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  surveyRequest,
  SurveyPublishBlockedError,
  SurveySystemError,
  SurveyConflictError,
} from "@/lib/survey/runtime-client";
import { FlexibleReportEditor } from "../report/template-editor";
import { SurveyReportDocument } from "../report/report-document";
import {
  exportSurveyReportWord,
  printSurveyReport,
} from "../report/report-export";
import { SurveyQuestionEditor } from "./question-editor";
import { MarkdownSurveyEditor } from "./markdown-survey-editor";
import { SurveyAiProposal } from './ai-proposal';
import { downloadReportMarkdown, surveyReportMarkdown } from "../report/report-markdown";
import { CollectionOverview, RecentCollectionActivity } from "./collection-overview";
import { SurveyShareCode } from "./share-code";
import { useSurveyAutosave } from "./use-survey-autosave";
import { SurveyDraftCopy } from "./survey-draft-copy";
import { SurveyCollectionSettingsEditor } from './collection-settings';
import { SurveyTemplateActions } from "../library/template-actions";
import { LiveResponseList } from "./response-list";
import { assessPublishReadiness } from "@/lib/survey/publish-readiness";
import { clearPendingAiImport } from "@/lib/survey/pending-ai-import";
import { surveyPath, type SurveyDestination } from "@/lib/survey/paths";
import { evaluateSurveyForPublish } from "@repo/contracts/survey-publish-readiness";
import { WorkflowTimeline } from "./workflow-timeline";
const STEPS = [
  ["design", "survey.workspace.designStep"],
  ["publish", "survey.workspace.publishStep"],
  ["responses", "survey.workspace.responsesStep"],
] as const;
const IMPORT_STEPS = [["import", "survey.workspace.importStep"], ...STEPS] as const;
const BLOCKER_MESSAGES: Record<SurveyPublishBlocker["code"], MessageKey> = {
  QUESTIONS_EMPTY: "survey.workspace.blockerEmpty",
  QUESTION_OPTIONS_EMPTY: "survey.workspace.blockerOptions",
  MAPPING_INCOMPLETE: "survey.workspace.blockerMapping",
  LEADING_QUESTION: "survey.workspace.blockerLeading",
  QUESTION_CONFIG_INVALID: "survey.workspace.blockerConfig",
  LOGIC_INVALID: "survey.workspace.blockerLogic",
};
function collectionStatusKey(publication: SurveyRuntime["publication"], now: number): MessageKey {
  const state = publication ? surveyCollectionAccessError(publication, now) : null;
  return state === "closed" ? "survey.workspace.closed" : state === "expired" ? "survey.workspace.expired" : state === "not_started" ? "survey.workspace.pending" : "survey.workspace.collecting";
}
function emptyDraft(title: string, reportTitle: string): SurveyDraftInput {
  return {
    title,
    questions: [],
    template: { id: crypto.randomUUID(), title: reportTitle, sections: [] },
  };
}
export function LiveSurveyWorkspace({
  surveyId,
  initialStep = "design",
  creationMode,
  projectId = null,
}: {
  surveyId: string;
  initialStep?: string;
  creationMode?: "ai";
  /**
   * 项目中枢 B2-S2：带 `?projectId=` 进来的新建问卷，首次 `POST /surveys` 成功后立即
   * `linkProjectResource` 挂到该项目；挂失败不回滚问卷（问卷已经存在），只提示。
   */
  projectId?: string | null;
}) {
  const { t, locale } = useI18n();
  const creationText = React.useRef(t);
  creationText.current = t;
  const displayRecommendation = (code: SurveyPublishBlocker["code"]) => t(({
    QUESTIONS_EMPTY: "survey.workspace.recommendEmpty",
    QUESTION_CONFIG_INVALID: "survey.workspace.recommendConfig",
    QUESTION_OPTIONS_EMPTY: "survey.workspace.recommendOptions",
    MAPPING_INCOMPLETE: "survey.workspace.recommendMapping",
    LEADING_QUESTION: "survey.workspace.recommendLeading",
    LOGIC_INVALID: "survey.workspace.recommendLogic",
  } as const)[code]);
  const router = useRouter();
  const [runtime, setRuntime] = React.useState<SurveyRuntime | null>(null);
  const [draft, updateDraft] = React.useState<SurveyDraftInput | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [operation, setOperation] = React.useState<"idle" | "saving" | "processing">("idle");
  const [generatingReport, setGeneratingReport] = React.useState(false);
  const [secondaryActionsOpen, setSecondaryActionsOpen] = React.useState(false);
  const [error, setError] = React.useState<string | Error>("");
  const [retryable, setRetryable] = React.useState(false);
  const [blockers, setBlockers] = React.useState<SurveyPublishBlocker[]>([]);
  const [templateAutosaveDraft, setTemplateAutosaveDraft] = React.useState<string | null>(null);
  const setDraft = React.useCallback((next: SurveyDraftInput | null) => {
    setBlockers([]);
    setTemplateAutosaveDraft(null);
    updateDraft(next);
  }, []);
  const [notice, setNotice] = React.useState<MessageKey | "">("");
  const [step, setStep] = React.useState(initialStep);
  const [repairQuestionId, setRepairQuestionId] = React.useState<string | null>(null);
  const [expires, setExpires] = React.useState("");
  const [starts, setStarts] = React.useState("");
  const [collectionClock, setCollectionClock] = React.useState(0);
  const [selectedBatchId, setSelectedBatchId] = React.useState<string | null>(null);
  const [markdown, setMarkdown] = React.useState("");
  const [savedMarkdown, setSavedMarkdown] = React.useState("");
  const [publicationMarkdown,setPublicationMarkdown]=React.useState('# 发布与回收\n');
  const [markdownNeedsApply, setMarkdownNeedsApply] = React.useState(false);
  const [conflicted, setConflicted] = React.useState(false);
  const [remoteVersion, setRemoteVersion] = React.useState<SurveyRuntime | null>(null);
  const reportRef = React.useRef<HTMLDivElement>(null);
  const lock = React.useRef(false);
  const accept = React.useCallback((value: SurveyRuntime) => {
    setRuntime(value);
    setSelectedBatchId(value.activeCollectionBatchId ?? value.collectionBatches?.at(-1)?.id ?? null);
    setConflicted(false);
    setRemoteVersion(null);
    const text = value.source?.documents.design.markdown ?? serializeSurveyDesignMarkdown(value);
    setMarkdown(text);
    setSavedMarkdown(text);
    setPublicationMarkdown(value.publication?.sourceSnapshot?.documents.publication.markdown ?? value.source?.documents.publication.markdown ?? '# 发布与回收\n');
    setMarkdownNeedsApply(false);
    setDraft({
      title: value.title,
      tags: value.tags,
      questions: value.questions,
      template: value.template,
    });
  }, [setDraft]);
  React.useEffect(() => {
    setStep(initialStep);
  }, [initialStep]);
  React.useEffect(() => {
    let active = true;
    setError("");
    setRuntime(null);
    setDraft(null);
    if (surveyId === "new") {
      const title = creationText.current("survey.design.untitledSurvey");
      setDraft(emptyDraft(title, creationText.current("survey.workspace.newReportDefault")));
      setMarkdown(`# ${title}\n\n## q1 [open]\n${creationText.current("survey.workspace.newFeedbackDefault")}\n`);
      return;
    }
    void surveyRequest(`/surveys/${encodeURIComponent(surveyId)}`, {}, SurveyRuntimeSchema)
      .then((data) => {
        if (active) accept(data);
      })
      .catch((e) => {
        if (active) setError(e instanceof Error ? e : surveyRuntimeMessages.operation);
      });
    return () => {
      active = false;
    };
  }, [surveyId, accept, setDraft]);
  const dirty =
    publicationMarkdown !== (runtime?.publication?.sourceSnapshot?.documents.publication.markdown ?? runtime?.source?.documents.publication.markdown ?? '# 发布与回收\n') ||
    markdown !== savedMarkdown ||
    !!draft &&
    (!runtime ||
      JSON.stringify(draft) !==
        JSON.stringify({
          title: runtime.title,
          tags: runtime.tags,
          questions: runtime.questions,
          template: runtime.template,
        }));
  useSurveyUnsavedNavigation(dirty);
  const previousCollectionStep = React.useRef(step);
  // Refresh collection data on return and while viewing results. Never replace local edits.
  React.useEffect(() => {
    if (surveyId === "new" || !runtime || dirty || busy) return;
    let active = true;
    let pending = false;
    const reload = async () => {
      if (pending || document.visibilityState === "hidden") return;
      pending = true;
      try {
        const next = await surveyRequest(`/surveys/${encodeURIComponent(surveyId)}`, {}, SurveyRuntimeSchema);
        if (active) setRuntime(next);
      } catch { /* Keep the last successful snapshot; manual refresh exposes errors. */ }
      finally { pending = false; }
    };
    window.addEventListener("focus", reload);
    document.addEventListener("visibilitychange", reload);
    if (previousCollectionStep.current !== step && step === "responses") void reload();
    previousCollectionStep.current = step;
    const timer = window.setInterval(reload, 15_000);
    return () => {
      active = false;
      window.clearInterval(timer);
      window.removeEventListener("focus", reload);
      document.removeEventListener("visibilitychange", reload);
    };
  }, [surveyId, runtime, dirty, busy, step]);

  const execute = async (action: () => Promise<void>, nextOperation: "saving" | "processing" = "processing") => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setOperation(nextOperation);
    setError("");
    setRetryable(false);
    setNotice("");
    try {
      await action();
    } catch (e) {
      if (e instanceof SurveyPublishBlockedError) { setBlockers(e.blockers); selectStep("design"); }
      else {
        setConflicted(e instanceof SurveyConflictError);
        setError(e instanceof Error ? e : surveyRuntimeMessages.operation);
        setRetryable(e instanceof SurveySystemError);
      }
    } finally {
      lock.current = false;
      setBusy(false);
      setOperation("idle");
    }
  };
  const save = async () => {
    if (!draft) throw new Error(surveyRuntimeMessages.notLoaded);
    const sourceParsed = parseSurveyDesignMarkdown(markdown);
    if (!sourceParsed.ok) throw new SurveyDesignDiagnosticsError(sourceParsed.diagnostics);
    if (markdownNeedsApply) throw new Error(surveyRuntimeMessages.applyMarkdown);
    const parsed = SurveyDraftInputSchema.safeParse({ ...draft, title: sourceParsed.draft.title, tags: sourceParsed.draft.tags, questions: sourceParsed.draft.questions });
    if (!parsed.success)
      throw new Error(surveyRuntimeMessages.invalidDraft);
    const next = runtime ?? await surveyRequest("/surveys", {
        method: "POST",
        body: {
          ...parsed.data,
        },
      }, SurveyRuntimeSchema);
    // Retain the created identity even if the following source mutation fails.
    // A retry must update that draft rather than POST a duplicate survey.
    if (!runtime) {
      setRuntime(next);
      router.replace(withProjectId(surveyPath(next.id, step as SurveyDestination), projectId));
    }
    if (next.publication) {
      const persisted = await surveyRequest(`/surveys/${next.id}`, { method: "PUT", body: { ...parsed.data, expectedVersion: next.version } }, SurveyRuntimeSchema);
      accept(persisted);
      setNotice("survey.workspace.templateSaved");
      return persisted;
    }
    const persisted = await surveyRequest(`/surveys/${next.id}/source`, { method: "PUT", body: {
      expectedVersion: next.version,
      documents: { design: markdown, publication: publicationMarkdown, reportTemplate: serializeSurveyReportTemplateMarkdown(parsed.data.template) },
    } }, SurveyRuntimeSchema);
    accept(persisted);
    setNotice("survey.workspace.saved");
    if (surveyId === "new") {
      if (projectId) {
        try {
          await linkProjectResource({ projectId, kind: "survey", resourceId: next.id });
          setNotice("survey.workspace.createdLinked");
        } catch {
          setNotice("survey.workspace.createdNotLinked");
        }
      }
      router.replace(withProjectId(surveyPath(next.id, step as SurveyDestination), projectId));
    }
    return persisted;
  };
  const command = async (name: string, extra: Record<string, unknown> = {}) => {
    const current = dirty ? await save() : runtime;
    if (!current) throw new Error(surveyRuntimeMessages.saveFirst);
    const action = name === "begin-collection" ? current.status === "ready" ? "start-collection" : "publish" : name;
    const next = await surveyRequest(`/surveys/${current.id}/${action}`, {
        method: "POST",
        body: { expectedVersion: current.version, ...extra },
      }, SurveyRuntimeSchema);
    accept(next);
    setBlockers([]);
    setNotice("survey.workspace.operationDone");
  };
  const refresh = () =>
    execute(async () => {
      if (!runtime) return;
      if (dirty && !window.confirm(t("survey.workspace.refreshConfirm"))) return;
      accept(await surveyRequest(`/surveys/${runtime.id}`, {}, SurveyRuntimeSchema));
    });
  const collectionBatches = runtime?.collectionBatches ?? [];
  const activeBatchId = runtime?.activeCollectionBatchId ?? collectionBatches.at(-1)?.id ?? null;
  const selectedBatch = collectionBatches.find((batch) => batch.id === selectedBatchId) ??
    collectionBatches.find((batch) => batch.id === activeBatchId) ?? null;
  const selectedPublication = selectedBatch ?? runtime?.publication ?? null;
  const collectionBoundaries = React.useMemo(() => [
    ...(runtime?.collectionBatches ?? []), ...(runtime?.publication ? [runtime.publication] : []),
  ].filter(publication => publication.status === "collecting").flatMap(publication => [publication.startsAt, publication.expiresAt])
    .filter((value): value is string => !!value).map(Date.parse), [runtime?.collectionBatches, runtime?.publication]);
  React.useEffect(() => {
    const now = Date.now();
    const boundaries = collectionBoundaries.filter(value => value > now);
    if (!boundaries.length) return;
    const timer = window.setTimeout(() => setCollectionClock(clock => clock + 1), Math.min(Math.min(...boundaries) - now + 1, 2_147_483_647));
    return () => window.clearTimeout(timer);
  }, [collectionBoundaries, collectionClock]);
  React.useEffect(() => {
    if (runtime?.publication?.token) { setStarts(""); setExpires(""); }
  }, [runtime?.publication?.token]);
  const selectedIsActive = !selectedBatch || selectedBatch.id === activeBatchId;
  const selectedResponseCount = runtime?.responses.filter((response) =>
    !selectedBatch ||
    response.collectionBatchId === selectedBatch.id ||
    (collectionBatches.length <= 1 && response.collectionBatchId === undefined),
  ).length ?? 0;
  const link = selectedPublication && typeof window !== "undefined"
    ? `${window.location.origin}/surveys/${encodeURIComponent(selectedPublication.token)}`
    : "";
  const compiled = React.useMemo(() => {
    if (!draft) return null;
    const valid = survey.SurveyReportTemplateSchema.safeParse(draft.template);
    return valid.success
      ? survey.compileSurveyReport(
          valid.data,
          draft.questions,
          runtime?.responses ?? [],
        )
      : null;
  }, [draft, runtime?.responses]);
  const designBlockers = React.useMemo(() => blockers.length ? blockers : draft ? evaluateSurveyForPublish(draft) : [], [draft, blockers]);
  const readiness = React.useMemo(
    () => assessPublishReadiness({ questions: draft?.questions ?? [], blockers: designBlockers }),
    [draft?.questions, designBlockers],
  );
  const reportIsStale = !!runtime?.report && (dirty || runtime.reportBasisVersion !== runtime.version - 1 || runtime.reportBasisAnswerRevision !== runtime.answerRevision);
  const reportShareBlockedReason = runtime?.report
    ? surveyReportShareBlockedReason(runtime.report)
    : undefined;
  const hasImportStep = creationMode === "ai" || initialStep === "import";
  const workflowSteps = (hasImportStep ? IMPORT_STEPS : STEPS).map(([id, key]) => [id, t(key)] as const);
  React.useEffect(() => {
    if (surveyId === "new") return;
    const restoreStep = () => {
      const prefix = `/studio/survey/${encodeURIComponent(surveyId)}/`;
      if (!window.location.pathname.startsWith(prefix)) return;
      const destination = window.location.pathname.slice(prefix.length);
      if (!(["design", "publish", "responses", "template", "report"] as string[]).includes(destination)) return;
      setStep(destination);
      setRepairQuestionId(null);
    };
    window.addEventListener("popstate", restoreStep);
    return () => window.removeEventListener("popstate", restoreStep);
  }, [surveyId]);
  const collectionNow = Date.now();
  const collectionAccessError = selectedPublication ? surveyCollectionAccessError(selectedPublication, collectionNow) : null;
  const collectionExpired = collectionAccessError === "expired";
  const collectionPending = collectionAccessError === "not_started";
  const collectionLabel = t(collectionStatusKey(selectedPublication, collectionNow));
  const selectStep = (next: string, targetQuestionId?: string) => {
    setStep(next);
    setRepairQuestionId(targetQuestionId ?? null);
    if (surveyId !== "new") window.history.pushState(null, "", withProjectId(surveyPath(surveyId, next as SurveyDestination), projectId));
  };
  const projectedInSync = !!draft && !markdownNeedsApply;
  const autosaveEligible = !!draft && ((!runtime?.publication && step === "design") || (step === "template" && templateAutosaveDraft === JSON.stringify(draft))) && dirty &&
    !busy && !error && !conflicted && projectedInSync && parseSurveyDesignMarkdown(markdown).ok;
  useSurveyAutosave(autosaveEligible ? JSON.stringify([runtime?.version, markdown, draft?.template]) : null,
    () => execute(async () => { await save(); }, "saving"));
  const openPublish = () => {
    if (conflicted || busy) return;
    if (!dirty) { selectStep("publish"); return; }
    void execute(async () => {
      const persisted = await save();
      selectStep("publish");
      if (surveyId === "new") router.replace(withProjectId(surveyPath(persisted.id, "publish"), projectId));
    }, "saving");
  };
  return (
    <main className={`min-w-0 bg-background ${step === "design" ? "lg:flex lg:h-full lg:min-h-0 lg:flex-col lg:overflow-hidden" : ""}`}>
      <header className="flex flex-wrap items-center gap-3 border-b border-border bg-card px-5 py-3">
        <Button
          variant="ghost"
          onClick={() => {
            if (!dirty || window.confirm(t("survey.workspace.backConfirm")))
              router.push(projectId ? projectResearchHref(projectId, "survey") : "/studio/survey");
          }}
        >
          {projectId ? t("survey.workspace.backProject") : t("survey.workspace.backList")}
        </Button>
        <div className="min-w-48 flex-1">
          <Input
            aria-label={t("survey.workspace.name")}
            className="max-w-xl border-transparent bg-transparent text-18 font-semibold shadow-none focus-visible:border-border"
            disabled={!draft}
            readOnly={busy}
            value={draft?.title ?? ""}
            onChange={(e) =>
              draft && (() => { const next = { ...draft, title: e.target.value }; setDraft(next); setMarkdown((text) => text.replace(/^#\s+.*$/m, () => `# ${e.target.value}`)); })()
            }
          />
          <p className="mt-1 text-10 text-muted-foreground">
            {operation === "saving" ? step === "design" ? t("survey.workspace.autosaving") : t("survey.workspace.saving") : dirty
              ? t("survey.workspace.unsaved")
              : runtime
                ? t("survey.workspace.savedAt", { date: new Date(runtime.updatedAt).toLocaleString(locale) })
                : t("survey.workspace.loadingShort")}
          </p>
        </div>
        <div className="relative">
          <Button variant="outline" aria-expanded={secondaryActionsOpen} aria-controls="survey-secondary-actions" onClick={() => setSecondaryActionsOpen(value => !value)}>{t("survey.workspace.more")}</Button>
          {secondaryActionsOpen && (
            <div id="survey-secondary-actions" className="absolute right-0 top-full z-20 mt-2 flex min-w-52 flex-col gap-1 rounded-lg border border-border bg-card p-2 shadow-md">
              {step === "design" && draft && <SurveyTemplateActions saveOnly kind="question" draft={draft} onApply={() => undefined} locked={!!runtime?.publication} disabled={busy || !projectedInSync} />}
              <Button variant="ghost" className="justify-start" onClick={() => { setSecondaryActionsOpen(false); selectStep("template"); }}>{t("survey.workspace.designReportOptional")}</Button>
              {runtime && <Button variant="ghost" className="justify-start" onClick={() => { setSecondaryActionsOpen(false); selectStep("report"); }}>{t("survey.workspace.reportOptional")}</Button>}
              {runtime?.publication && <SurveyDraftCopy runtime={runtime} projectId={projectId} disabled={busy} onCreated={id => router.push(withProjectId(surveyPath(id, "design"), projectId))} />}
              <Button variant="ghost" className="justify-start" disabled={busy || !runtime} onClick={() => { setSecondaryActionsOpen(false); void refresh(); }}>{t("survey.workspace.refresh")}</Button>
            </div>
          )}
        </div>
        {step === "design" ? <Button variant="primary" disabled={busy || !draft || conflicted} onClick={openPublish}>{t("survey.workspace.publishStep")}</Button> : <Button
          variant="primary"
          disabled={busy || !draft || !dirty}
          onClick={() =>
            void execute(async () => {
              await save();
            }, "saving")
          }
        >
          {operation === "saving" ? t("survey.workspace.savingButton") : error && dirty && !conflicted ? t("survey.workspace.retrySave") : busy ? t("survey.workspace.processing") : t("survey.workspace.save")}
        </Button>}
      </header>
      <WorkflowTimeline
        steps={workflowSteps}
        activeStep={step === "template" ? "design" : step}
        onSelect={(next) => step === "design" && next === "publish" ? openPublish() : selectStep(next)}
      />
      {error && (
        <div
          role="alert"
          className="m-4 rounded-md border border-destructive/30 p-3 text-12 text-destructive"
        >
          <p>{displaySurveyRuntimeError(error, t, locale)}</p>
          {step === "design" && dirty && !conflicted && <>
            <p role="status">{t("survey.workspace.saveFailed")}</p>
            <Button variant="primary" disabled={busy} onClick={() => void execute(async () => { await save(); }, "saving")}>{t("survey.workspace.retrySave")}</Button>
          </>}
          {retryable && step === "publish" && runtime?.status === "draft" && (
            <Button
              className="mt-3"
              variant="outline"
              onClick={() => void execute(() => command("begin-collection", collectionScheduleInput(starts, expires)))}
            >{t("survey.workspace.retryPublish")}</Button>
          )}
        </div>
      )}
      {notice && (
        <p role="status" className={step === "design" ? "sr-only" : "px-5 pt-3 text-12 text-success"}>
          {t(notice)}
        </p>
      )}
      {conflicted && runtime && (
        <section className="m-5 space-y-3 rounded-lg border border-border bg-card p-4" aria-label={t("survey.workspace.conflictRegion")}>
          <p>{t("survey.workspace.conflictHelp")}</p>
          <Button variant="outline" disabled={busy} onClick={() => void execute(async () => {
            const latest = await surveyRequest(`/surveys/${runtime.id}`, {}, SurveyRuntimeSchema);
            setRemoteVersion(latest);
          })}>{t("survey.workspace.readLatest")}</Button>
          {remoteVersion && <>
            <textarea aria-label={t("survey.workspace.remoteMarkdown")} className="min-h-48 w-full rounded-md border border-border p-3 font-mono text-13" readOnly value={remoteVersion.source?.documents.design.markdown ?? serializeSurveyDesignMarkdown(remoteVersion)} />
            <Button disabled={busy} onClick={() => {
              setRuntime(remoteVersion);
              setSavedMarkdown(remoteVersion.source?.documents.design.markdown ?? serializeSurveyDesignMarkdown(remoteVersion));
              setConflicted(false); setRemoteVersion(null); setError("");
              setNotice("survey.workspace.localKept");
            }}>{t("survey.workspace.keepLocal")}</Button>
            <Button variant="outline" disabled={busy} onClick={() => {
              if (window.confirm(t("survey.workspace.remoteConfirm"))) accept(remoteVersion);
            }}>{t("survey.workspace.useRemote")}</Button>
          </>}
        </section>
      )}
      {!draft && !error && <p className="p-8">{t("survey.workspace.loading")}</p>}
      {draft && (
        <fieldset disabled={busy} className={`min-w-0 ${step === "design" ? "lg:flex lg:min-h-0 lg:flex-1 lg:flex-col lg:overflow-hidden" : ""}`}>
          {step === "import" && (<section className="mx-auto max-w-6xl space-y-5 p-5" aria-label={t("survey.workspace.importRegion")}>
            <div><h1 className="text-24 font-semibold">{t("survey.workspace.importStep")}</h1><p className="mt-1 text-13 text-muted-foreground">{t("survey.workspace.importHelp")}</p></div>
            <SurveyAiProposal locked={!!runtime?.publication} onApply={text=>{
              const result=parseSurveyDesignMarkdown(text);if(!result.ok)return;
              const canonical=result.draft.tags===undefined&&draft.tags?.length
                ? serializeSurveyDesignMarkdown({...result.draft,tags:draft.tags}) : text;
              setMarkdown(canonical);setMarkdownNeedsApply(false);setError('');
              setDraft({...draft,title:result.draft.title,tags:result.draft.tags??draft.tags,questions:result.draft.questions});
              clearPendingAiImport(surveyId);
              selectStep("design");
            }}/>
            <details className="rounded-lg border border-border bg-card p-4"><summary className="cursor-pointer text-13 font-medium">{t("survey.workspace.editMarkdown")}</summary>
              <div className="mt-4"><MarkdownSurveyEditor value={markdown} locked={!!runtime?.publication} onChange={(text) => { setMarkdown(text); setMarkdownNeedsApply(true); }} onPreview={() => {
                const result = parseSurveyDesignMarkdown(markdown);
                if (!result.ok) { setError(new SurveyDesignDiagnosticsError(result.diagnostics)); return; }
                setError(""); setDraft({ ...draft, title: result.draft.title, tags: result.draft.tags, questions: result.draft.questions });
                setMarkdownNeedsApply(false);clearPendingAiImport(surveyId);selectStep("design");
              }} /></div>
            </details>
            <div className="flex justify-end"><Button variant="outline" onClick={() => {clearPendingAiImport(surveyId);selectStep("design");}}>{t("survey.workspace.skipImport")}</Button></div>
          </section>)}
          {(step === "design" || step === "template") && (<>
            {!designBlockers.length && <section aria-label={t("survey.workspace.checks")} className="border-b border-success/30 px-5 py-2 text-12 text-success">{t("survey.workspace.checksPassed")}</section>}
            {designBlockers.length > 0 && (
              <section aria-label={t("survey.workspace.checks")} className="rounded-md border border-warning/40 bg-warning/5 p-4">
                <h2 className="text-14 font-semibold">{t("survey.workspace.issuesCount", { count: designBlockers.length })}</h2>
                <div data-testid="survey-design-readiness" className="mt-3 grid gap-2 rounded-md border border-border bg-card p-3 text-12 sm:grid-cols-3">
                  <p><span className="text-muted-foreground">{t("survey.workspace.quality")}{" "}</span>{readiness.qualityScore ?? t("survey.workspace.unknown")}{readiness.qualityScore !== null && " / 100"}</p>
                  <p><span className="text-muted-foreground">{t("survey.workspace.estimatedTime")}{" "}</span>{readiness.estimatedSeconds === null ? t("survey.workspace.unknown") : t("survey.workspace.minutes", { count: Math.ceil(readiness.estimatedSeconds / 60) })}</p>
                  <p><span className="text-muted-foreground">{t("survey.workspace.predictedRate")}{" "}</span>{readiness.predictedCompletionRate === null ? t("survey.workspace.unknown") : `${readiness.predictedCompletionRate}%`}</p>
                </div>
                <ul className="mt-3 space-y-2 text-12">
                  {readiness.recommendations.map((blocker) => (
                    <li key={`${blocker.code}:${blocker.side}:${blocker.subjectId}`}>
                      <strong>{t(BLOCKER_MESSAGES[blocker.code])}</strong>
                      <span className="ml-2 text-muted-foreground">{draft.questions.find((q) => q.id === blocker.subjectId)?.title ?? draft.template.sections.find((section) => section.id === blocker.subjectId)?.title ?? t("survey.workspace.survey")}</span>
                      {(blocker.code === "QUESTION_CONFIG_INVALID" || blocker.code === "LOGIC_INVALID") && blocker.missingFields.length > 0 && (
                        <p className="mt-1 text-muted-foreground">{blocker.missingFields.map(message => displaySurveyDiagnostic(message, t)).join(locale === "en" ? "; " : "；")}</p>
                      )}
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="ml-2"
                        aria-label={t("survey.workspace.repairLabel", { action: displayRecommendation(blocker.code) })}
                        onClick={() => {
                          const templateRepair = blocker.code === "MAPPING_INCOMPLETE" || blocker.side === "section";
                          const targetQuestionId = blocker.side === "question"
                            ? blocker.subjectId
                            : undefined;
                          selectStep(
                            templateRepair ? "template" : "design",
                            targetQuestionId,
                          );
                        }}
                      >{t("survey.workspace.repair")}</Button>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </>)}
          {step === "design" && (<>
            <fieldset disabled={!projectedInSync} className="lg:flex lg:min-h-0 lg:flex-1 lg:flex-col lg:overflow-hidden">
            {!projectedInSync && <p className="px-5 text-12 text-muted-foreground">{t("survey.workspace.applyBeforeEditing")}</p>}
            <SurveyQuestionEditor
              studioLayout
              surveyTitle={draft.title}
              disabled={busy || !projectedInSync}
              questions={draft.questions}
              locked={!!runtime?.publication}
              selectedQuestionId={repairQuestionId}
              onChange={(questions) => { const next = { ...draft, questions }; setDraft(next); setMarkdown(serializeSurveyDesignMarkdown(next)); }}
            />
            </fieldset>
          </>)}
          {step === "template" && (<>
            <SurveyTemplateActions kind="report" draft={draft} onApply={(next, action) => {
              setDraft(next);
              if (action === "unbind" || action === "undo-unbind") setTemplateAutosaveDraft(JSON.stringify(next));
            }} disabled={busy} />
            {repairQuestionId && (
              <p
                data-testid="survey-mapping-repair-target"
                className="border-b border-warning/40 bg-warning/5 px-5 py-3 text-12"
              >
                {t("survey.workspace.mappingTarget", { question: draft.questions.find((question) => question.id === repairQuestionId)?.title ?? repairQuestionId })}
              </p>
            )}
            <FlexibleReportEditor
              template={draft.template}
              onChange={(template) => setDraft({ ...draft, template })}
              questions={draft.questions}
              responses={runtime?.responses ?? []}
            />
          </>)}
          {step === "publish" && (
            <section className="mx-auto max-w-screen-2xl space-y-4 p-4 sm:p-5 lg:p-6">
              <h1 className="text-20 font-semibold">{t("survey.workspace.publishHeading")}</h1>
              <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1.8fr)_minmax(18rem,1fr)]">
              <div className="space-y-4">
              <section aria-label={t("survey.workspace.collectionStatus")} className="rounded-lg border border-border bg-card p-4">
                <p className="text-12 font-medium text-muted-foreground">{selectedPublication ? t("survey.workspace.collectionStatus") : t("survey.workspace.collectionSettings")}</p>
                <h2 className="mt-3 text-24 font-semibold">{selectedPublication ? t(collectionAccessError === "closed" ? "survey.workspace.closedHeading" : collectionExpired ? "survey.workspace.expiredHeading" : collectionPending ? "survey.workspace.pendingHeading" : "survey.workspace.collectingHeading") : t("survey.workspace.notCollecting")}</h2>
                <p className="mt-2 text-13 text-muted-foreground">{selectedPublication ? collectionExpired || selectedPublication.status === "closed" ? t("survey.workspace.closedHelp") : collectionPending ? t("survey.workspace.pendingHelp") : t("survey.workspace.collectingHelp") : t("survey.workspace.unpublishedHelp")}</p>
                {selectedPublication && <p className="mt-4 text-12 text-muted-foreground">{t("survey.workspace.publishedVersion", { version: selectedPublication.version })}</p>}
                {selectedPublication && <p className="mt-2 text-13 font-medium">{t("survey.workspace.responsesCount", { state: collectionLabel, count: selectedResponseCount })}</p>}
                {selectedPublication && !selectedIsActive && <p className="mt-2 text-12 font-medium text-muted-foreground">{t("survey.workspace.historical")}</p>}
              </section>
              {runtime && (runtime.status === "draft" || runtime.status === "ready") ? (
                <section className="space-y-4 rounded-lg border border-border bg-card p-4">
                  <div>
                    <h2 className="text-16 font-semibold">{t("survey.workspace.schedule")}</h2>
                    {designBlockers.length > 0 && <p className="mt-2 text-12 text-warning">{t("survey.workspace.fixBeforeCollect", { count: designBlockers.length })}</p>}
                  </div>
                  <CollectionScheduleFields starts={starts} expires={expires} onStartChange={setStarts} onEndChange={setExpires} disabled={busy} />
                  <WorkflowActionBar placement="footer">
                    <WorkflowActionButton variant="outline" onClick={() => selectStep("design")}>{t("survey.workspace.backEditing")}</WorkflowActionButton>
                    <WorkflowActionButton
                      variant="primary"
                      disabled={designBlockers.length > 0}
                      onClick={() => void execute(() => command("begin-collection", collectionScheduleInput(starts, expires)))}
                    >{t("survey.workspace.startCollection")}</WorkflowActionButton>
                  </WorkflowActionBar>
                </section>
              ) : runtime && selectedPublication ? (
                <>
                  <CollectionOverview runtime={runtime} batchId={selectedBatch?.id} />
                  <section aria-label={t("survey.workspace.share")} className="space-y-4 rounded-lg border border-border bg-card p-4">
                    <div>
                      <h2 className="text-16 font-semibold">{t("survey.workspace.share")}</h2>
                      <p className="mt-1 text-12 text-muted-foreground">{t("survey.workspace.shareHelp")}{" "}{selectedPublication.startsAt && <>{t("survey.workspace.shareStart", { date: new Date(selectedPublication.startsAt).toLocaleString(locale) })}</>}{t("survey.workspace.shareEnd", { date: new Date(selectedPublication.expiresAt).toLocaleString(locale) })}</p>
                    </div>
                    <Input aria-label={t("survey.workspace.responseLink")} readOnly value={link} />
                    <div className="flex flex-wrap items-center gap-4">
                      <SurveyShareCode link={link} />
                      <div className="flex flex-wrap gap-2">
                    <Button
                      variant="outline"
                      onClick={() =>
                        void execute(async () => {
                          await navigator.clipboard.writeText(link);
                          setNotice("survey.workspace.linkCopied");
                        })
                      }
                    >{t("survey.workspace.copyLink")}</Button>
                    <a
                      className="rounded-md border border-border px-4 py-2 text-12"
                      href={link}
                      target="_blank"
                      rel="noreferrer"
                    >{t("survey.workspace.openForm")}</a>
                      </div>
                    </div>
                  </section>
                  {selectedIsActive && selectedPublication.status === "collecting" && (
                      <Button
                        variant="outline"
                        onClick={() => {
                          if (
                            window.confirm(
                              t("survey.workspace.stopConfirm"),
                            )
                          )
                            void execute(() => command("close"));
                        }}
                      >{t("survey.workspace.stopCollection")}</Button>
                    )}
                  {selectedIsActive && selectedPublication.status === "closed" && (
                    <section aria-label={t("survey.workspace.republishSettings")} className="space-y-4 rounded-lg border border-border bg-card p-4">
                      <h2 className="text-16 font-semibold">{t("survey.workspace.republish")}</h2>
                      <CollectionScheduleFields starts={starts} expires={expires} onStartChange={setStarts} onEndChange={setExpires} disabled={busy} />
                      <Button disabled={busy} onClick={() => void execute(() => command("republish", collectionScheduleInput(starts, expires)))}>{t("survey.workspace.republish")}</Button>
                    </section>
                  )}
                </>
              ) : (
                <p className="text-12 text-muted-foreground">{t("survey.workspace.syncStatus")}</p>
              )}
              </div>
              <aside className="space-y-4" aria-label={t("survey.workspace.settingsPanel")}>
                {runtime && !runtime.publication && <section className="rounded-lg border border-border bg-card p-4">
                  <label className="flex items-center justify-between gap-4 text-13 font-medium">{t("survey.workspace.anonymous")}<input type="checkbox" disabled={busy} checked={runtime.anonymity === "anonymous"} onChange={event => {
                      const anonymity = event.target.checked ? "anonymous" : "identified";
                      void execute(async () => {
                        const current = dirty ? await save() : runtime;
                        if (!current) throw new Error(surveyRuntimeMessages.saveFirst);
                        const next = await surveyRequest(`/surveys/${current.id}`, { method: "PUT", body: {
                          expectedVersion: current.version,
                          draft: { title: current.title, tags: current.tags, questions: current.questions, template: current.template },
                          anonymity,
                        } }, SurveyRuntimeSchema);
                        accept(next);
                      });
                    }} />
                  </label>
                  <p className="mt-2 text-12 text-muted-foreground">{t("survey.workspace.anonymousHelp")}</p>
                </section>}
                <SurveyCollectionSettingsEditor markdown={selectedPublication?.sourceSnapshot?.documents.publication.markdown ?? publicationMarkdown} locked={busy || !!selectedPublication} onChange={setPublicationMarkdown}/>
                {collectionBatches.length > 1 && (
                  <label className="block rounded-lg border border-border bg-card p-4 text-13">{t("survey.workspace.batch")}<select aria-label={t("survey.workspace.batch")} className="mt-3 h-9 w-full rounded-md border border-border bg-background px-3" value={selectedBatch?.id ?? activeBatchId ?? ""} onChange={(event) => setSelectedBatchId(event.target.value)}>
                      {collectionBatches.map((batch, index) => <option key={batch.id} value={batch.id}>{index + 1}. {t(collectionStatusKey(batch, collectionNow))} · {new Date(batch.createdAt).toLocaleString(locale)}</option>)}
                    </select>
                  </label>
                )}
                {selectedPublication && <div className="rounded-lg border border-border bg-card p-4 text-13"><h2 className="font-semibold">{t("survey.workspace.publishedSettings")}</h2><p className="mt-3">{t("survey.workspace.startPrefix")}{selectedPublication.startsAt ? new Date(selectedPublication.startsAt).toLocaleString(locale) : t("survey.workspace.immediate")}</p><p className="mt-2">{t("survey.workspace.endPrefix")}{new Date(selectedPublication.expiresAt).toLocaleString(locale)}</p><p className="mt-2">{t("survey.workspace.anonymousPrefix")}{runtime?.anonymity === "anonymous" ? t("survey.workspace.on") : t("survey.workspace.off")}</p><p className="mt-2 text-12 text-muted-foreground">{t("survey.workspace.frozenSettings")}</p></div>}
                {runtime && selectedPublication && <RecentCollectionActivity runtime={runtime} batchId={selectedBatch?.id} />}
              </aside>
              </div>
            </section>
          )}
          {step === "responses" && (<>
            <LiveResponseList
              surveyId={runtime?.id}
              responses={runtime?.responses ?? []}
              questions={runtime?.publication?.questions ?? draft.questions}
              busy={busy}
              onAnalysis={(id, analysis, exclusionReason) =>
                void execute(async () => {
                  const current = dirty ? await save() : runtime;
                  if (!current) return;
                  accept(
                    SurveyRuntimeSchema.parse(
                      await surveyRequest(
                        `/surveys/${current.id}/responses/${id}`,
                        {
                          method: "PATCH",
                          body: {
                            expectedVersion: current.version,
                            analysis,
                            ...(analysis === "excluded" ? { exclusionReason } : {}),
                          },
                        },
                      ),
                    ),
                  );
                })
              }
              onReview={(id, quality) =>
                void execute(async () => {
                  const current = dirty ? await save() : runtime;
                  if (!current) return;
                  accept(
                    SurveyRuntimeSchema.parse(
                      await surveyRequest(
                        `/surveys/${current.id}/responses/${id}`,
                        {
                          method: "PATCH",
                          body: { expectedVersion: current.version, quality },
                        },
                      ),
                    ),
                  );
                })
              }
            />
            <details aria-label={t("survey.workspace.reportOptional")} className="group mx-5 mb-5 rounded-lg border border-border bg-card p-4">
              <summary className="cursor-pointer list-none text-14 font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <span aria-hidden="true" className="mr-2 inline-block transition-transform group-open:rotate-90">›</span>{t("survey.workspace.reportOptional")}<span className="ml-2 text-12 font-normal text-muted-foreground">{runtime?.report ? reportIsStale ? t("survey.workspace.pendingUpdate") : t("survey.workspace.generated") : t("survey.workspace.notGenerated")}</span>
              </summary>
              <div className="mt-4 space-y-4 border-t border-border pt-4">
                <p className="text-12 text-muted-foreground">{t("survey.workspace.reportHelp")}</p>
                <p className="text-12 text-muted-foreground">{runtime?.report
                  ? reportIsStale ? t("survey.workspace.reportNeedsUpdate") : t("survey.workspace.reportSample", { count: runtime.responses.filter(response => response.analysis !== 'excluded').length })
                  : t("survey.workspace.reportNotGenerated")}</p>
                <div className="flex flex-wrap gap-2"><Button variant="outline" onClick={() => selectStep('template')}>{t("survey.workspace.designReport")}</Button><Button variant="outline" onClick={() => selectStep('report')}>{runtime?.report ? t("survey.workspace.viewReport") : t("survey.workspace.makeAnalysis")}</Button></div>
              </div>
            </details>
          </>)}
          {step === "report" && (
            <section className="mx-auto max-w-5xl space-y-5 p-5">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="w-full text-20 font-semibold sm:w-auto sm:flex-1">{t("survey.workspace.analysisReport")}</h1>
                <Button variant="primary" aria-busy={generatingReport} onClick={() => void execute(async () => {
                  setGeneratingReport(true);
                  try {
                    await command("report");
                    setNotice("survey.workspace.reportRegenerated");
                  } finally { setGeneratingReport(false); }
                })}>
                  {generatingReport ? t("survey.workspace.generatingReport") : runtime?.report ? t("survey.workspace.regenerateReport") : t("survey.workspace.generateReport")}
                </Button>
                {runtime?.report && (
                  <>
                    <Button variant="outline" disabled={!!reportShareBlockedReason} onClick={() => void execute(async () => { downloadReportMarkdown(runtime.report!); })}>{t("survey.workspace.exportMarkdown")}</Button>
                    <Button
                      variant="outline"
                      disabled={!!reportShareBlockedReason}
                      onClick={() =>
                        void execute(async () => {
                          await exportSurveyReportWord(runtime.report!);
                        })
                      }
                    >{t("survey.workspace.exportWord")}</Button>
                    <Button
                      variant="outline"
                      disabled={!!reportShareBlockedReason}
                      onClick={() =>
                        void execute(async () => {
                          if (reportRef.current)
                            await printSurveyReport(reportRef.current, runtime.report!);
                        })
                      }
                    >{t("survey.workspace.exportPdf")}</Button>
                  </>
                )}
              </div>
              {reportShareBlockedReason && (
                <p
                  className="rounded-md border border-warning/30 bg-warning/10 p-3 text-12"
                  data-testid="survey-report-share-privacy-warning"
                  role="status"
                >
                  {displaySurveyReportIssue(reportShareBlockedReason, t)}
                </p>
              )}
              {runtime?.reportGeneratedAt && (
                <p className="text-12 text-muted-foreground" data-testid="survey-report-generated-at">{t("survey.workspace.generatedPrefix")}{new Date(runtime.reportGeneratedAt).toLocaleString(locale)}
                </p>
              )}
              {!runtime?.report && (
                <p className="rounded-md bg-muted p-4 text-12">{t("survey.workspace.optionalReportHelp")}</p>
              )}
              {compiled?.issues.length ? (
                <div className="rounded-md border border-warning/30 p-4 text-12">
                  <p className="font-medium">{t("survey.workspace.checkBeforeGenerating")}</p>
                  <ul className="mt-2 list-inside list-disc">
                    {[...new Set(compiled.issues)].map((issue) => (
                      <li key={issue}>{displaySurveyReportIssue(issue, t)}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {reportIsStale && (
                  <p className="text-12 text-muted-foreground">{t("survey.workspace.staleReport")}</p>
                )}
              {runtime?.report && (
                <div className="rounded-lg bg-muted p-3 sm:p-6">
                  <details className="mb-4 rounded-md border border-border bg-card p-3">
                    <summary className="cursor-pointer text-13">{t("survey.workspace.reportMarkdown")}</summary>
                    <textarea aria-label={t("survey.workspace.reportMarkdown")} readOnly className="mt-3 min-h-48 w-full rounded-md border border-border bg-card p-3 font-mono text-12" value={surveyReportMarkdown(runtime.report)} />
                  </details>
                <div ref={reportRef}>
                  <SurveyReportDocument report={runtime.report} />
                </div>
                </div>
              )}
            </section>
          )}
        </fieldset>
      )}
    </main>
  );
}
