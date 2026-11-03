"use client";
import { interviewCategoryText } from "@/lib/interview-category-text";
import { useI18n } from "@/lib/i18n/provider";
import type { MessageKey } from "@/lib/i18n/messages";

import * as React from "react";
import Link from "next/link";
import { ArrowRight, CalendarDays, Plus, Users } from "lucide-react";
import { WorkflowActionButton as ActionButton } from "@/components/research-studio/research-workflow-actions";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { INTERVIEW_PERSONA_CATEGORIES } from "@/lib/interview-personas/persona-library";
import { InterviewExpertLibrary } from "./interview-expert-library";
import { ExpertAvatarEditor } from "./expert-avatar";
import { ResourceCard } from "@/components/ui/resource-card";
import { StudioHistoryFilters, StudioHistoryCard, type HistorySort } from "@/components/studio/studio-history";
import { Badge } from "@/components/ui/badge";
import { ApiError } from "@/lib/api-client";
import { matchesQuery, matchesTags } from "@/lib/tag-utils";
import {
  loadDigitalExperts,
  loadDigitalInterviewHistory,
  type DigitalExpertCatalogRow,
  type DigitalInterviewHistoryRow,
} from "@/lib/interview-api";
import { cn } from "@/lib/utils";
import { DigitalInterviewCreateModal } from "./digital-interview-create-modal";
import { ProjectBreadcrumb } from "@/components/project/project-breadcrumb";
import { listMockDigitalInterviewDrafts, type MockDigitalInterviewDraft } from "@/lib/mock/digital-interview-drafts";
import { InterviewHistoryCardActions } from "./interview-history-card-actions";
import {
  MOCK_DIGITAL_EXPERTS,
} from "@/lib/mock/digital-expert-personas";

type Tab = "history" | "experts";
type LoadState<T> =
  | { kind: "loading" }
  | { kind: "ready"; items: readonly T[] }
  | { kind: "error"; reason: string };

const STATUS_LABEL: Record<DigitalInterviewHistoryRow["status"], MessageKey> = {
  draft: "itv.status.draft",
  topic_pending: "itv.status.topic_pending",
  experts_pending: "itv.status.experts_pending",
  questions_pending: "itv.status.questions_pending",
  running: "itv.status.running",
  report_pending: "itv.status.report_pending",
  completed: "itv.status.completed",
  failed: "itv.status.failed",
};

function reasonOf(error: unknown): string {
  if (error instanceof ApiError) return error.reasonCode ?? error.message;
  return error instanceof Error ? error.message : "DEPENDENCY_UNAVAILABLE";
}

export function InterviewStudioHome({
  initialTab = "history",
  initialCreateOpen = false,
  includeMockPreviews = false,
  projectId = null,
}: {
  initialTab?: Tab;
  initialCreateOpen?: boolean;
  includeMockPreviews?: boolean;
  /** 项目中枢 B2-S2：从项目「研究洞察 › 用户洞察」带 `?projectId=` 进来，新建访谈直接带项目 scope。 */
  projectId?: string | null;
}) {
  const { t, locale } = useI18n();
  const createInterview = () => setCreateOpen(true);
  const [query, setQuery] = React.useState("");
  const [sort, setSort] = React.useState<HistorySort>("recent");
  const [notice, setNotice] = React.useState(false);
  const [revision, setRevision] = React.useState(0);
  const [libraryCount,setLibraryCount] = React.useState(0);
  const [expertRevision, setExpertRevision] = React.useState(0);
  const [tab, setTab] = React.useState<Tab>(initialTab);
  const [selectedTags, setSelectedTags] = React.useState<readonly string[]>([]);
  const [domain, setDomain] = React.useState<string | undefined>();
  const [history, setHistory] = React.useState<LoadState<DigitalInterviewHistoryRow>>({ kind: "loading" });
  const [experts, setExperts] = React.useState<LoadState<DigitalExpertCatalogRow>>({ kind: "loading" });
  const [createOpen, setCreateOpen] = React.useState(initialCreateOpen);

  React.useEffect(() => {
    let active = true;
    setHistory({ kind: "loading" });
    void loadDigitalInterviewHistory().then(
      (result) => active && setHistory({
        kind: "ready",
        items: combineHistoryRows(result.items, includeMockPreviews),
      }),
      (error: unknown) => active && setHistory({ kind: "error", reason: reasonOf(error) }),
    );
    return () => { active = false; };
  }, [includeMockPreviews, revision]);

  React.useEffect(() => {
    if (tab !== "experts") return;
    if (includeMockPreviews) {
      setExperts({ kind: "ready", items: MOCK_DIGITAL_EXPERTS });
      return;
    }

    let active = true;
    setExperts({ kind: "loading" });
    void loadDigitalExperts().then(
      (result) => active && setExperts({ kind: "ready", items: result.items }),
      (error: unknown) => active && setExperts({ kind: "error", reason: reasonOf(error) }),
    );
    return () => { active = false; };
  }, [includeMockPreviews, tab, expertRevision]);

  const refreshHistory = React.useCallback(() => { setNotice(true); setRevision(value => value + 1); }, []);

  const historyItems = React.useMemo(
    () => history.kind === "ready" ? history.items : [],
    [history],
  );
  const availableTags = React.useMemo(() => {
    const tags = new Set<string>();
    for (const item of historyItems) {
      for (const tag of item.tags) {
        const normalizedTag = tag.trim();
        if (normalizedTag) tags.add(normalizedTag);
      }
    }
    return Array.from(tags);
  }, [historyItems]);
  const visibleHistoryItems = historyItems.filter(item => matchesTags(item.tags, selectedTags) && matchesQuery(query, [item.name, item.topic], item.tags))
    .sort((a, b) => (Date.parse(b.updatedAt) - Date.parse(a.updatedAt)) * (sort === "recent" ? 1 : -1));
  const expertItems = React.useMemo(
    () => experts.kind === "ready" ? experts.items : [],
    [experts],
  );
  const expertDomains = React.useMemo(
    () => Array.from(new Set([...INTERVIEW_PERSONA_CATEGORIES, ...expertItems.flatMap((expert) => expert.domains)])),
    [expertItems],
  );
  const visibleExperts = domain === undefined
    ? expertItems
    : expertItems.filter((expert) => expert.domains.includes(domain));

  React.useEffect(() => {
    if (history.kind === "ready" && selectedTags.some(t => !availableTags.includes(t))) setSelectedTags(selectedTags.filter(t => availableTags.includes(t)));
  }, [availableTags, history.kind, selectedTags]);

  return (
    <main className="min-w-0 flex-1 overflow-y-auto bg-background">
      <div data-testid="itv-home-page" className="mx-auto w-full max-w-screen-2xl px-4 py-4 md:px-6 lg:px-8">
        <ProjectBreadcrumb projectId={projectId} sub="itv" className="mb-3" />
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">

            <h1 className="text-30 font-semibold tracking-tight text-foreground">{t("itv.title")}</h1>

          </div>
          <div className="ml-auto flex items-center gap-3">
            {history.kind === "ready" && <span className="text-sm text-muted-foreground">{t("itv.history.count", { count: history.items.length })}</span>}
            <ActionButton type="button" variant="primary" data-testid="itv-create" onClick={createInterview}><Plus className="size-4" aria-hidden />{t("itv.new")}</ActionButton>
          </div>
        </header>

        <Tabs value={tab} onValueChange={value => setTab(value as Tab)}>
        <TabsList aria-label={t("itv.tabs")} className="mt-4 flex gap-4">
          <TabsTrigger value="history" data-testid="itv-tab-history">
            {t("itv.history")}
          </TabsTrigger>
          <TabsTrigger value="experts" data-testid="itv-tab-experts">
            {t("itv.experts")}
          </TabsTrigger>
        </TabsList>

        {tab === "history" ? (
          <TabsContent value="history" aria-label={t("itv.history")} className="pt-4">
            <StudioHistoryFilters business={t("itv.history.business")} prefix="itv-history" tags={availableTags} selectedTags={selectedTags} onTagsChange={setSelectedTags} query={query} onQueryChange={setQuery} sort={sort} onSortChange={setSort} />
            {notice && <p role="status" data-testid="itv-history-saved" className="mt-4 text-12 text-success">{t("itv.saved")}</p>}
            <div className="mt-4"><HistoryContent state={history.kind === "ready" ? { kind: "ready", items: visibleHistoryItems } : history} onChanged={refreshHistory} onCreate={createInterview} filtered={Boolean(query.trim() || selectedTags.length > 0)} onClearFilters={() => { setQuery(""); setSelectedTags([]); }} onRetry={() => setRevision(value => value + 1)} /></div>
          </TabsContent>
        ) : (
          <TabsContent value="experts" aria-label={t("itv.experts")} className="pt-4">
            <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
              <FilterBar>
                {[undefined, ...expertDomains].map((value) => (
                  <FilterButton key={value ?? "all"} active={domain === value} onClick={() => setDomain(value)}>
                    {value === undefined ? t("itv.experts.all") : interviewCategoryText(value, locale)}
                  </FilterButton>
                ))}
              </FilterBar>
              <p data-testid="itv-expert-count" className="py-2 text-xs text-muted-foreground">
                {t("itv.experts.count", { count: visibleExperts.length + (includeMockPreviews ? 0 : libraryCount) })}
              </p>
            </div>
            {!includeMockPreviews && <div className="mb-4"><InterviewExpertLibrary domain={domain} onCount={setLibraryCount}/></div>}
            <ExpertContent
              state={experts.kind === "ready" ? { kind: "ready", items: visibleExperts } : experts}
              preview={includeMockPreviews}
              filtered={Boolean(domain)}
              onRetry={() => setExpertRevision(value => value + 1)}
              onClearFilters={() => setDomain(undefined)}
            />
          </TabsContent>
        )}
        </Tabs>
      </div>
      <DigitalInterviewCreateModal open={createOpen} onOpenChange={setCreateOpen} projectId={projectId} knownTags={new Map(availableTags.map((t) => [t, 0] as const))} />
    </main>
  );
}

function mockDraftHistoryRow(draft: MockDigitalInterviewDraft): DigitalInterviewHistoryRow {
  const actionByStep = {
    1: "confirm_topic",
    2: "confirm_experts",
    3: "confirm_questions",
    4: "continue_runs",
    5: "view_report",
  } as const;
  const statusByStep = {
    1: "draft",
    2: "experts_pending",
    3: "questions_pending",
    4: "running",
    5: "completed",
  } as const;
  return {
    interviewId: draft.interviewId,
    kind: "batch",
    name: draft.name,
    tags: [...draft.tags],
    topic: draft.topic || "尚未确认访谈主题",
    status: statusByStep[draft.currentStep],
    expertCount: draft.selectedExpertIds.length,
    completedExpertCount: draft.currentStep === 5 ? draft.selectedExpertIds.length : 0,
    primaryAction: actionByStep[draft.currentStep],
    updatedAt: draft.updatedAt ?? new Date(0).toISOString(),
  };
}

function combineHistoryRows(serverItems: readonly DigitalInterviewHistoryRow[], includeMockPreviews: boolean): readonly DigitalInterviewHistoryRow[] {
  return [
    ...(includeMockPreviews ? listMockDigitalInterviewDrafts().map(mockDraftHistoryRow) : []),
    ...serverItems.filter((item) => !item.interviewId.startsWith("mock-batch-")),
  ];
}

function FilterBar({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-wrap items-center gap-2">{children}</div>;
}

function FilterButton({ active, onClick, children }: {
  active: boolean; onClick: () => void; children: React.ReactNode;
}) {
  return (
    <button type="button" onClick={onClick} className={cn(
      "h-7 rounded-md border px-2.5 text-12 font-medium transition-colors",
      active ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background text-muted-foreground hover:text-background-foreground",
    )}>{children}</button>
  );
}

function HistoryContent({ state, onChanged, onCreate, filtered, onClearFilters, onRetry }: { state: LoadState<DigitalInterviewHistoryRow>; onChanged: () => void; onCreate: () => void; filtered: boolean; onClearFilters: () => void; onRetry: () => void }) {
  const { t } = useI18n();
  if (state.kind === "loading") return <StatePanel>{t("itv.history.loading")}</StatePanel>;
  if (state.kind === "error") return <StatePanel testId="itv-history-error"><p>{t("itv.history.error")}</p><ActionButton variant="outline" className="mt-4" onClick={onRetry}>{t("itv.history.retry")}</ActionButton></StatePanel>;
  if (state.items.length === 0) return <StatePanel testId="itv-history-empty"><p>{filtered ? t("itv.history.filterEmpty") : t("itv.history.empty")}</p>{filtered ? <ActionButton variant="outline" className="mt-4" onClick={onClearFilters}>{t("itv.clearFilters")}</ActionButton> : <ActionButton variant="primary" className="mt-4" onClick={onCreate}><Plus className="size-4" aria-hidden />{t("itv.new")}</ActionButton>}</StatePanel>;
  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      {state.items.map((item) => <HistoryCard key={item.interviewId} item={item} onChanged={onChanged} />)}
    </div>
  );
}

function HistoryCard({ item, onChanged }: { item: DigitalInterviewHistoryRow; onChanged: () => void }) {
  const { t, locale } = useI18n();
  const action = historyPrimaryAction(item, t);
  const completion = item.expertCount > 0 ? Math.min(100, Math.round(item.completedExpertCount / item.expertCount * 100)) : null;
  return <StudioHistoryCard testId={`itv-history-card-${item.interviewId}`} title={item.name}
    status={<Badge tone="neutral">{t(STATUS_LABEL[item.status])}</Badge>} description={item.topic} tags={item.tags}
    metadata={<><span className="inline-flex items-center gap-1.5"><Users className="size-4" aria-hidden />{item.expertCount > 0 ? t("itv.experts.completed", { completed: item.completedExpertCount, total: item.expertCount }) : t("itv.experts.noneSelected")}</span><time dateTime={item.updatedAt} className="inline-flex items-center gap-1.5"><CalendarDays className="size-4" aria-hidden />{new Date(item.updatedAt).toLocaleDateString(locale)}</time></>}
    primaryAction={<ActionButton asChild variant="primary"><Link href={action.href}>{action.label}<ArrowRight className="size-4" aria-hidden /></Link></ActionButton>}
    management={<InterviewHistoryCardActions item={item} onChanged={onChanged} />}>
    {completion !== null && item.status !== "completed" && <div className="flex items-center gap-3">
      <div role="progressbar" aria-label={t("itv.experts.progress")} aria-valuemin={0} aria-valuemax={item.expertCount} aria-valuenow={Math.min(item.completedExpertCount, item.expertCount)} aria-valuetext={t("itv.experts.completed", { completed: item.completedExpertCount, total: item.expertCount })} className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-foreground" style={{ width: `${completion}%` }} />
      </div>
      <span className="min-w-9 text-right text-xs tabular-nums text-muted-foreground">{completion}%</span>
    </div>}
  </StudioHistoryCard>;
}

function historyPrimaryAction(item: DigitalInterviewHistoryRow, t: ReturnType<typeof useI18n>["t"]): { readonly label: string; readonly href: string } {
  if (item.kind === "quick") return { label: t("itv.continueChat"), href: `/itv/quick/${item.interviewId}` };
  if (item.sourceStep) return { label: item.sourceStep === "report" ? t("itv.viewReport") : t("itv.continue"), href: `/itv/${encodeURIComponent(item.interviewId)}/${item.sourceStep}` };
  const detail = `/itv/${item.interviewId}/setup`;
  return {
    confirm_topic: { label: t("itv.confirmTopic"), href: detail },
    confirm_experts: { label: t("itv.confirmExperts"), href: detail },
    confirm_questions: { label: t("itv.confirmQuestions"), href: detail },
    continue_runs: { label: t("itv.continue"), href: detail },
    generate_report: { label: t("itv.generateReport"), href: detail },
    view_report: { label: t("itv.viewReport"), href: detail },
    retry: { label: t("itv.retry"), href: detail },
  }[item.primaryAction];
}

function ExpertContent({ state, preview = false, filtered, onRetry, onClearFilters }: { state: LoadState<DigitalExpertCatalogRow>; preview?: boolean; filtered: boolean; onRetry: () => void; onClearFilters: () => void }) {
  const { t } = useI18n();
  if (state.kind === "loading") return <StatePanel>{t("itv.experts.loading")}</StatePanel>;
  if (state.kind === "error") return <StatePanel testId="itv-experts-error"><p>{t("itv.experts.error")}</p><ActionButton variant="outline" className="mt-4" onClick={onRetry}>{t("itv.experts.retry")}</ActionButton></StatePanel>;
  if (state.items.length === 0) return <StatePanel testId="itv-experts-empty"><p>{filtered ? t("itv.experts.filterEmpty") : t("itv.experts.empty")}</p>{filtered && <ActionButton variant="outline" className="mt-4" onClick={onClearFilters}>{t("itv.experts.viewAll")}</ActionButton>}</StatePanel>;
  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      {state.items.map((expert) => (
        <ResourceCard
          key={expert.expertId}
          testId={`itv-expert-card-${expert.expertId}`}
          leading={<ExpertAvatarEditor expertId={expert.expertId} displayName={expert.displayName} compact />}
          title={expert.displayName}
          subtitle={expert.role}
          badges={preview ? <Badge tone="primary">{t("itv.experts.mock")}</Badge> : undefined}
          actions={
            <>
              <ActionButton asChild variant="primary">
                <Link data-testid={`itv-quick-${expert.expertId}`} href={`/itv/quick/new?expertId=${encodeURIComponent(expert.expertId)}`}>{t("itv.experts.quick")}</Link>
              </ActionButton>
              <ActionButton asChild variant="outline">
                <Link href={`/itv/experts/${expert.expertId}`}>{t("itv.experts.view")}</Link>
              </ActionButton>
            </>
          }
        >
          {expert.materialContextPackId && (
            <div className="rounded-lg bg-muted/60 p-3 text-11 text-muted-foreground">
              <span className="font-medium text-background-foreground">{t("itv.experts.boundary")}</span>{expert.materialBoundary}
            </div>
          )}
        </ResourceCard>
      ))}
    </div>
  );
}

function StatePanel({ testId, children }: { testId?: string; children: React.ReactNode }) {
  return <div data-testid={testId} className="flex min-h-40 flex-col items-center justify-center rounded-lg border border-dashed border-border bg-card p-4 text-center text-12 text-muted-foreground">{children}</div>;
}
