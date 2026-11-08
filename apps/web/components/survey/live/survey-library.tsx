"use client";
import { RESOURCE_GRID_CLASS, RESOURCE_PAGE_CLASS } from "@/components/ui/resource-card";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { SurveyRuntime } from "@repo/contracts/survey-runtime";
import {
  ArrowRight, Clock3, FileText,
  MoreHorizontal, Plus, Search,
} from "lucide-react";
import { surveyRequest } from "@/lib/survey/runtime-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { TagFilterBar } from "@/components/ui/tag-filter-bar";
import { aggregateTags, matchesQuery, matchesTags, searchPlaceholder } from "@/lib/tag-utils";
import { Menu, MenuContent, MenuItem, MenuTrigger } from "@/components/ui/menu";
import { ResourceCard, ResourceCardTags } from "@/components/ui/resource-card";
import { ProjectBreadcrumb, withProjectId } from "@/components/project/project-breadcrumb";
import { linkProjectResource } from "@/lib/live-project-resources";
import { hasPendingAiImport } from "@/lib/survey/pending-ai-import";
import { surveyAuthoringStatusMessageKey } from "@/lib/survey/status-copy";
import { surveyPath } from "@/lib/survey/paths";
import { encodeSurveyCreationDraft } from "@/lib/survey/creation-draft";
import { CreateSurveyDialog } from "./create-survey-dialog";
import { SurveyLibraryNav } from "../library/survey-library-nav";
import { useI18n } from "@/lib/i18n/provider";
import { displaySurveyMessage, surveyErrorMessage, type SurveyDisplayMessage } from "@/lib/survey/display-message";

function statusFor(item: SurveyRuntime) {
  if (item.publication?.status === "collecting") return { key: "survey.library.statusPublished", tone: "success" } as const;
  if (item.publication) return { key: "survey.library.statusStopped", tone: "warning" } as const;
  const key = surveyAuthoringStatusMessageKey(item.status);
  return key ? { key, tone: "info" } as const : null;
}

function LibraryLoading() {
  const { t } = useI18n();
  return (
    <div role="status" aria-label={t("survey.library.loading")} data-testid="survey-library-loading" className={RESOURCE_GRID_CLASS}>
      <span className="sr-only">{t("survey.library.loading")}</span>
      {Array.from({ length: 4 }).map((_, index) => (
        <div key={index} className="animate-pulse rounded-card border border-border bg-card p-4 shadow-sm">
          <div className="h-4 w-2/3 rounded bg-muted" />
          <div className="mt-2 h-3 w-1/3 rounded bg-muted" />
          <div className="mt-4 h-3 w-full rounded bg-muted" />
          <div className="mt-4 h-8 w-24 rounded bg-muted" />
        </div>
      ))}
    </div>
  );
}

function SurveyStatus({ item }: { item: SurveyRuntime }) {
  const { t } = useI18n();
  const status = statusFor(item);
  if (!status) return null;
  const tone = status.tone === "success" ? "success" : status.tone === "warning" ? "warning" : "primary";
  return <Badge tone={tone} data-testid={`survey-status-${item.id}`}>{t(status.key)}</Badge>;
}

/** 问卷卡片：标准 `ResourceCard` 版式（2026-09-30 人类要求所有卡片统一成标准项目卡片）。 */
function SurveyCard({
  item, busy, projectId, onOpen, onRemove, onResponses,
}: {
  item: SurveyRuntime;
  busy: boolean;
  projectId: string | null;
  onOpen: (item: SurveyRuntime) => void;
  onRemove: (item: SurveyRuntime) => void;
  onResponses: (item: SurveyRuntime) => void;
}) {
  const { t, locale } = useI18n();
  const includedResponses = item.responses.filter((response) => response.analysis !== "excluded").length;
  return (
    <ResourceCard
      headingLevel={2}
      testId={`survey-card-${item.id}`}
      title={
        <Link
          className="block break-words transition-colors hover:text-muted-foreground"
          href={withProjectId(`/studio/survey/${item.id}`, projectId)}
          onClick={(event) => { event.preventDefault(); onOpen(item); }}
        >
          {item.title}
        </Link>
      }
      subtitle={t("survey.library.summary", { questions: item.questions.length, responses: item.responses.length, valid: includedResponses })}
      badges={<SurveyStatus item={item} />}
      menu={
        <Menu>
          <MenuTrigger asChild>
            <Button variant="ghost" size="icon" aria-label={t("survey.library.more", { name: item.title })}>
              <MoreHorizontal aria-hidden="true" className="h-4 w-4" />
            </Button>
          </MenuTrigger>
          <MenuContent align="end" sideOffset={4} className="w-36">
            <MenuItem disabled={busy} onSelect={() => onRemove(item)} className="text-destructive data-[highlighted]:text-destructive">{t("survey.library.delete")}</MenuItem>
          </MenuContent>
        </Menu>
      }
      description={item.questions[0]?.title
        ? t("survey.library.includesQuestion", { question: item.questions[0].title })
        : t("survey.library.addQuestions")}
      tags={<ResourceCardTags tags={item.tags ?? []} max={3} />}
      meta={
        <span className="inline-flex items-center gap-1.5">
          <Clock3 aria-hidden="true" className="h-3.5 w-3.5" />
          {t("survey.library.updated", { date: new Date(item.updatedAt).toLocaleString(locale) })}
        </span>
      }
      actions={
        <>
          <Button variant="primary" size="sm" onClick={() => onOpen(item)}>{t(item.publication ? "survey.library.continueEditing" : "survey.library.continueDesigning")}</Button>
          <Button variant="outline" size="sm" onClick={() => onResponses(item)}>{t("survey.library.responses")}</Button>
        </>
      }
    />
  );
}

/** 项目入口保留 projectId；问卷数据和操作均来自正式 API。 */
export function LiveSurveyLibrary({ projectId = null, initialCreateOpen = false }: { projectId?: string | null; initialCreateOpen?: boolean }) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [items, setItems] = React.useState<SurveyRuntime[]>([]);
  const [busy, setBusy] = React.useState(true);
  const [error, setError] = React.useState<SurveyDisplayMessage | null>(null);
  const [query, setQuery] = React.useState("");
  const [selectedTags, setSelectedTags] = React.useState<readonly string[]>([]);
  const [creating, setCreating] = React.useState(initialCreateOpen);
  const createControl = React.useRef<HTMLButtonElement>(null);
  const searchControl = React.useRef<HTMLInputElement>(null);
  const refreshing = React.useRef(false);
  const tagMap = React.useMemo(() => aggregateTags(items), [items]);
  const filtering = Boolean(query.trim() || selectedTags.length);
  const visibleItems = items
    .filter((item) => matchesTags(item.tags ?? [], selectedTags) && matchesQuery(query, [item.title], item.tags ?? []))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  const refresh = React.useCallback(async (restoreFocus = false) => {
    if (refreshing.current) return;
    refreshing.current = true;
    setBusy(true);
    try {
      setItems(await surveyRequest<SurveyRuntime[]>("/surveys"));
      setError(null);
      if (restoreFocus) searchControl.current?.focus();
    }
    catch (reason) { setError(surveyErrorMessage(reason, "survey.library.loadFailed")); }
    finally { refreshing.current = false; setBusy(false); }
  }, []);

  React.useEffect(() => { void refresh(); }, [refresh]);

  const remove = async (item: SurveyRuntime) => {
    if (!window.confirm(t("survey.library.deleteConfirm"))) return;
    setBusy(true);
    try {
      await surveyRequest(`/surveys/${encodeURIComponent(item.id)}`, {
        method: "DELETE",
        query: { expectedVersion: String(item.version) },
      });
      await refresh();
    } catch (reason) { setError(surveyErrorMessage(reason, "survey.library.loadFailed")); }
    finally { setBusy(false); }
  };

  const open = (item: SurveyRuntime) => {
    const pendingImport = !item.publication && hasPendingAiImport(item.id);
    router.push(withProjectId(
      pendingImport ? `/studio/survey/${item.id}?step=import&mode=ai` : surveyPath(item.id, "design"),
      projectId,
    ));
  };

  return (
    <main className={`${RESOURCE_PAGE_CLASS} space-y-6`}>
      <ProjectBreadcrumb projectId={projectId} sub="survey" className="" />
      <header className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
        <div>
          <h1 className="text-30 font-semibold tracking-tight">{t("survey.library.title")}</h1>
        </div>
        <div className="flex w-full flex-col gap-2 sm:flex-row xl:w-auto">
          <div className="relative min-w-0 sm:w-72">
            <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              ref={searchControl}
              className="w-full pl-9"
              aria-label={t("survey.library.search")}
              placeholder={searchPlaceholder(t("survey.library.business"), locale)}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
          <Button ref={createControl} variant="primary" data-testid="survey-create-primary" onClick={() => setCreating(true)}><Plus aria-hidden="true" className="h-4 w-4" />{t("survey.create.title")}</Button>
        </div>
      </header>

      <div className="flex flex-col gap-6">
        <SurveyLibraryNav active="surveys" />

        <section className="min-w-0 space-y-5" aria-label={t("survey.library.myList")} aria-busy={busy}>
          <div className="flex flex-wrap items-center gap-2">
            <TagFilterBar tags={[...tagMap.entries()].map(([tag, count]) => ({ tag, count }))} selected={selectedTags} onChange={setSelectedTags} prefix="survey" business={t("survey.library.business")} maxVisible={7} />
            {!busy && !error && <span role="status" aria-label={t("survey.library.countLabel")} className="ml-auto text-12 text-muted-foreground">
              {filtering ? t("survey.library.matchedCount", { matched: visibleItems.length, total: items.length }) : t("survey.library.count", { count: items.length })}
            </span>}
          </div>

          {error && <div role="alert" data-testid="err-survey-library" className="flex flex-col items-start gap-3 rounded-lg border border-destructive bg-card p-4 text-13 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0 break-words"><p className="font-medium">{t("survey.library.loadFailed")}</p><p className="mt-1 text-muted-foreground">{displaySurveyMessage(error, t, locale)}</p></div>
            <Button variant="outline" className="shrink-0" disabled={busy} onClick={() => void refresh(true)}>{t(busy ? "survey.library.reloading" : "survey.library.reload")}</Button>
          </div>}
          {busy && <LibraryLoading />}
          {!busy && !error && (
            <div className={RESOURCE_GRID_CLASS}>
              {visibleItems.map((item) => (
                <SurveyCard
                  key={item.id}
                  item={item}
                  busy={busy}
                  projectId={projectId}
                  onOpen={open}
                  onRemove={(value) => void remove(value)}
                  onResponses={(value) => router.push(withProjectId(surveyPath(value.id, "responses"), projectId))}
                />
              ))}
            </div>
          )}

          {!busy && !error && items.length > 0 && !filtering && (
            <aside className="relative overflow-hidden rounded-xl border border-border bg-card p-5 shadow-sm">
              <div className="relative z-10 max-w-md">
                <p className="inline-flex rounded-full bg-muted px-3 py-1 text-11 text-muted-foreground">{t("survey.library.optionalReport")}</p>
                <h2 className="mt-3 text-18 font-semibold">{t("survey.library.designReport")}</h2>
                <Link href="/studio/survey?tab=reports" className="mt-5 inline-flex items-center gap-2 rounded-control border border-border px-4 py-2 text-13 font-medium transition-colors hover:bg-muted">{t("survey.library.createReport")}<ArrowRight aria-hidden="true" className="h-4 w-4" /></Link>
              </div>
            </aside>
          )}

          {!busy && !error && items.length > 0 && visibleItems.length === 0 && (
            <div role="status" className="space-y-4 rounded-xl border border-dashed border-border p-6 py-16 text-center text-muted-foreground"><p>{t("survey.library.noMatches")}</p><Button variant="outline" onClick={() => { setQuery(""); setSelectedTags([]); searchControl.current?.focus(); }}>{t("survey.library.clearFilters")}</Button></div>
          )}
          {!busy && !error && items.length === 0 && (
            <div data-testid="empty" className="space-y-4 rounded-xl border border-dashed border-border p-6 py-16 text-center">
              <h2 className="text-18 font-semibold">{t("survey.library.emptyTitle")}</h2>
              <p className="text-14 text-muted-foreground">{t("survey.library.emptyHint")}</p>
            </div>
          )}
        </section>
      </div>

      <CreateSurveyDialog onReturnFocus={()=>{const control=createControl.current;if(control?.isConnected&&!control.disabled&&control.getAttribute("aria-disabled")!=="true")control.focus();}} knownTags={tagMap} open={creating} onOpenChange={setCreating} onCreated={async (id, mode, draft) => {
        if (mode === "ai" && draft) {
          router.push(withProjectId(`/studio/survey/new/import?draft=${encodeURIComponent(encodeSurveyCreationDraft(draft))}`, projectId));
          return;
        }
        if (!id) return;
        if (projectId) {
          try { await linkProjectResource({ projectId, kind: "survey", resourceId: id }); }
          catch { /* 项目页可补挂 */ }
        }
        router.push(withProjectId(surveyPath(id, "design"), projectId));
      }} />
    </main>
  );
}
