"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowRight, CalendarDays, Plus, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ExpertAvatarEditor } from "./expert-avatar";
import { ResourceCard } from "@/components/ui/resource-card";
import { StudioHistoryFilters, StudioHistoryCard, StudioHistoryCreateCard, type HistorySort } from "@/components/studio/studio-history";
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

const STATUS_LABEL: Record<DigitalInterviewHistoryRow["status"], string> = {
  draft: "草稿",
  topic_pending: "待确认主题",
  experts_pending: "待确认专家",
  questions_pending: "待确认问题",
  running: "进行中",
  report_pending: "待生成报告",
  completed: "已完成",
  failed: "需重试",
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
  const createInterview = () => setCreateOpen(true);
  const [query, setQuery] = React.useState("");
  const [sort, setSort] = React.useState<HistorySort>("recent");
  const [notice, setNotice] = React.useState("");
  const [revision, setRevision] = React.useState(0);
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

  const refreshHistory = React.useCallback(() => { setNotice("访谈变更已保存"); setRevision(value => value + 1); }, []);

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
    () => Array.from(new Set(expertItems.flatMap((expert) => expert.domains))),
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
      <div data-testid="itv-home-page" className="mx-auto w-full max-w-screen-2xl px-5 py-6 md:px-8 lg:px-10">
        <ProjectBreadcrumb projectId={projectId} sub="itv" className="mb-4" />
        <header className="flex flex-wrap items-center justify-between gap-5">
          <div className="min-w-0">

            <h1 className="text-30 font-semibold tracking-tight text-foreground">用户访谈</h1>

          </div>
          <div className="flex items-center gap-4">
            {history.kind === "ready" && <span className="text-sm text-muted-foreground">共 {history.items.length} 次访谈</span>}
            <Button type="button" variant="primary" size="lg" data-testid="itv-create" onClick={createInterview}><Plus className="size-4" aria-hidden />新建访谈</Button>
          </div>
        </header>

        <Tabs value={tab} onValueChange={value => setTab(value as Tab)}>
        <TabsList aria-label="访谈内容" className="mt-6 flex gap-6">
          <TabsTrigger value="history" data-testid="itv-tab-history">
            历史访谈
          </TabsTrigger>
          <TabsTrigger value="experts" data-testid="itv-tab-experts">
            专家列表
          </TabsTrigger>
        </TabsList>

        {tab === "history" ? (
          <TabsContent value="history" aria-label="历史访谈" className="pt-6">
            <StudioHistoryFilters business="访谈" prefix="itv-history" tags={availableTags} selectedTags={selectedTags} onTagsChange={setSelectedTags} query={query} onQueryChange={setQuery} sort={sort} onSortChange={setSort} />
            {notice && <p role="status" data-testid="itv-history-saved" className="mt-4 text-12 text-success">{notice}</p>}
            <div className="mt-6"><HistoryContent state={history.kind === "ready" ? { kind: "ready", items: visibleHistoryItems } : history} onChanged={refreshHistory} onCreate={createInterview} filtered={Boolean(query.trim() || selectedTags.length > 0)} onClearFilters={() => { setQuery(""); setSelectedTags([]); }} onRetry={() => setRevision(value => value + 1)} /></div>
          </TabsContent>
        ) : (
          <TabsContent value="experts" aria-label="专家列表" className="pt-6">
            <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
              <FilterBar>
                {[undefined, ...expertDomains].map((value) => (
                  <FilterButton key={value ?? "all"} active={domain === value} onClick={() => setDomain(value)}>
                    {value ?? "全部专家"}
                  </FilterButton>
                ))}
              </FilterBar>
              <p data-testid="itv-expert-count" className="py-2 text-xs text-muted-foreground">
                {visibleExperts.length} 位专家
              </p>
            </div>
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
  if (state.kind === "loading") return <StatePanel>正在加载历史访谈…</StatePanel>;
  if (state.kind === "error") return <StatePanel testId="itv-history-error"><p>暂时无法加载访谈，请稍后重试。</p><Button variant="outline" className="mt-4" onClick={onRetry}>重新加载访谈</Button></StatePanel>;
  if (state.items.length === 0) return <StatePanel testId="itv-history-empty"><p>{filtered ? "没有符合条件的访谈，请调整标签或搜索条件。" : "还没有访谈，创建第一次访谈，开始了解用户。"}</p>{filtered ? <Button variant="outline" className="mt-4" onClick={onClearFilters}>清除筛选</Button> : <Button variant="primary" className="mt-4" onClick={onCreate}><Plus className="size-4" aria-hidden />新建访谈</Button>}</StatePanel>;
  return (
    <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
      {state.items.map((item) => <HistoryCard key={item.interviewId} item={item} onChanged={onChanged} />)}
      <StudioHistoryCreateCard business="访谈" testId="itv-create-card" onCreate={onCreate} />
    </div>
  );
}

function HistoryCard({ item, onChanged }: { item: DigitalInterviewHistoryRow; onChanged: () => void }) {
  const action = historyPrimaryAction(item);
  const completion = item.expertCount > 0 ? Math.min(100, Math.round(item.completedExpertCount / item.expertCount * 100)) : null;
  return <StudioHistoryCard testId={`itv-history-card-${item.interviewId}`} title={item.name}
    status={<Badge tone="neutral">{STATUS_LABEL[item.status]}</Badge>} description={item.topic} tags={item.tags}
    metadata={<><span className="inline-flex items-center gap-1.5"><Users className="size-4" aria-hidden />{item.expertCount > 0 ? `${item.completedExpertCount} / ${item.expertCount} 位专家完成` : "尚未选择专家"}</span><time dateTime={item.updatedAt} className="inline-flex items-center gap-1.5"><CalendarDays className="size-4" aria-hidden />{new Date(item.updatedAt).toLocaleDateString("zh-CN")}</time></>}
    primaryAction={<Button asChild variant="primary" size="sm"><Link href={action.href}>{action.label}<ArrowRight className="size-4" aria-hidden /></Link></Button>}
    management={<InterviewHistoryCardActions item={item} onChanged={onChanged} />}>
    {completion !== null && <div className="flex items-center gap-3">
      <div role="progressbar" aria-label="专家访谈完成进度" aria-valuemin={0} aria-valuemax={item.expertCount} aria-valuenow={Math.min(item.completedExpertCount, item.expertCount)} aria-valuetext={`${item.completedExpertCount} / ${item.expertCount} 位专家完成`} className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-foreground" style={{ width: `${completion}%` }} />
      </div>
      <span className="min-w-9 text-right text-xs tabular-nums text-muted-foreground">{completion}%</span>
    </div>}
  </StudioHistoryCard>;
}

function historyPrimaryAction(item: DigitalInterviewHistoryRow): { readonly label: string; readonly href: string } {
  if (item.kind === "quick") return { label: "继续对话", href: `/itv/quick/${item.interviewId}` };
  if (item.sourceStep) return { label: item.sourceStep === "report" ? "查看报告" : "继续访谈", href: `/itv/${encodeURIComponent(item.interviewId)}/${item.sourceStep}` };
  const detail = `/itv/${item.interviewId}/setup`;
  return {
    confirm_topic: { label: "确认主题", href: detail },
    confirm_experts: { label: "确认专家", href: detail },
    confirm_questions: { label: "确认问题", href: detail },
    continue_runs: { label: "继续访谈", href: detail },
    generate_report: { label: "生成报告", href: detail },
    view_report: { label: "查看报告", href: detail },
    retry: { label: "重试", href: detail },
  }[item.primaryAction];
}

function ExpertContent({ state, preview = false, filtered, onRetry, onClearFilters }: { state: LoadState<DigitalExpertCatalogRow>; preview?: boolean; filtered: boolean; onRetry: () => void; onClearFilters: () => void }) {
  if (state.kind === "loading") return <StatePanel>正在加载专家…</StatePanel>;
  if (state.kind === "error") return <StatePanel testId="itv-experts-error"><p>暂时无法加载专家，请稍后重试。</p><Button variant="outline" className="mt-4" onClick={onRetry}>重新加载专家</Button></StatePanel>;
  if (state.items.length === 0) return <StatePanel testId="itv-experts-empty"><p>{filtered ? "当前分类暂无可用专家。" : "还没有可用专家。你可以先新建访谈，根据访谈主题选择专家。"}</p>{filtered && <Button variant="outline" className="mt-4" onClick={onClearFilters}>查看全部专家</Button>}</StatePanel>;
  return (
    <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
      {state.items.map((expert) => (
        <ResourceCard
          key={expert.expertId}
          testId={`itv-expert-card-${expert.expertId}`}
          leading={<ExpertAvatarEditor expertId={expert.expertId} displayName={expert.displayName} compact />}
          title={expert.displayName}
          subtitle={expert.role}
          badges={preview ? <Badge tone="primary">Mock 专家</Badge> : undefined}
          actions={
            <>
              <Button asChild size="sm" variant="primary">
                <Link data-testid={`itv-quick-${expert.expertId}`} href={`/itv/quick/new?expertId=${encodeURIComponent(expert.expertId)}`}>快捷访谈</Link>
              </Button>
              <Button asChild size="sm" variant="outline">
                <Link href={`/itv/experts/${expert.expertId}`}>查看专家</Link>
              </Button>
            </>
          }
        >
          {expert.materialContextPackId && (
            <div className="rounded-lg bg-muted/60 p-3 text-11 text-muted-foreground">
              <span className="font-medium text-background-foreground">材料边界：</span>{expert.materialBoundary}
            </div>
          )}
        </ResourceCard>
      ))}
    </div>
  );
}

function StatePanel({ testId, children }: { testId?: string; children: React.ReactNode }) {
  return <div data-testid={testId} className="flex min-h-64 flex-col items-center justify-center rounded-lg border border-dashed border-border bg-card p-6 text-center text-12 text-muted-foreground">{children}</div>;
}
