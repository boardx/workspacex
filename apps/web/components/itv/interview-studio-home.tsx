"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowRight, Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ApiError } from "@/lib/api-client";
import {
  loadDigitalInterviewHistory,
  type DigitalExpertCatalogRow,
  type DigitalInterviewHistoryRow,
} from "@/lib/interview-api";
import { cn } from "@/lib/utils";
import { DigitalInterviewCreateModal } from "./digital-interview-create-modal";
import { listMockDigitalInterviewDrafts, type MockDigitalInterviewDraft } from "@/lib/mock/digital-interview-drafts";
import { InterviewHistoryCardActions } from "./interview-history-card-actions";
import {
  MOCK_DIGITAL_EXPERTS,
  MOCK_EXPERT_CATEGORIES,
  type MockDigitalExpertPersona,
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

export function InterviewStudioHome({ initialTab = "history", initialCreateOpen = false }: { initialTab?: Tab; initialCreateOpen?: boolean }) {
  const [tab, setTab] = React.useState<Tab>(initialTab);
  const [selectedTag, setSelectedTag] = React.useState<string | undefined>();
  const [domain, setDomain] = React.useState<string | undefined>();
  const [history, setHistory] = React.useState<LoadState<DigitalInterviewHistoryRow>>({ kind: "loading" });
  const [createOpen, setCreateOpen] = React.useState(initialCreateOpen);

  React.useEffect(() => {
    let active = true;
    setHistory({ kind: "loading" });
    void loadDigitalInterviewHistory().then(
      (result) => active && setHistory({
        kind: "ready",
        items: combineHistoryRows(result.items),
      }),
      (error: unknown) => active && setHistory({ kind: "error", reason: reasonOf(error) }),
    );
    return () => { active = false; };
  }, []);

  const refreshMockHistory = React.useCallback(() => {
    setHistory((current) => current.kind === "ready"
      ? { kind: "ready", items: combineHistoryRows(current.items) }
      : current);
  }, []);

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
  const visibleHistoryItems = selectedTag
    ? historyItems.filter((item) => item.tags.some((tag) => tag.trim() === selectedTag))
    : historyItems;

  React.useEffect(() => {
    if (selectedTag && !availableTags.includes(selectedTag)) setSelectedTag(undefined);
  }, [availableTags, selectedTag]);

  return (
    <main className="min-w-0 flex-1 overflow-y-auto bg-background">
      <div data-testid="itv-home-page" className="mx-auto w-full max-w-screen-2xl px-5 py-6 md:px-8 lg:px-10">
        <header className="flex flex-col gap-5 md:flex-row md:items-start md:justify-between">
          <div>
            <p className="text-11 font-medium text-muted-foreground">Studio&nbsp;&nbsp;/&nbsp;&nbsp;访谈</p>
            <h1 className="mt-2 text-24 font-semibold tracking-tight text-foreground">访谈 Studio</h1>
            <p className="mt-2 text-12 text-muted-foreground">
              回看或继续历史访谈，也可以选择一位数字专家快速开始对话。
            </p>
          </div>
          <button
            type="button"
            data-testid="itv-create"
            onClick={() => setCreateOpen(true)}
            className="inline-flex h-11 shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-lg bg-primary px-5 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90"
          >
            <Plus className="size-4" /> 新建访谈
          </button>
        </header>

        <div role="tablist" aria-label="访谈内容" className="mt-6 flex gap-6 border-b border-border">
          <TabButton active={tab === "history"} testId="itv-tab-history" onClick={() => setTab("history")}>
            历史访谈
          </TabButton>
          <TabButton active={tab === "experts"} testId="itv-tab-experts" onClick={() => setTab("experts")}>
            专家列表
          </TabButton>
        </div>

        {tab === "history" ? (
          <section aria-label="历史访谈" className="pt-6">
            <FilterBar>
              <FilterButton active={selectedTag === undefined} onClick={() => setSelectedTag(undefined)}>全部</FilterButton>
              {availableTags.map((tag) => (
                <FilterButton key={tag} active={selectedTag === tag} onClick={() => setSelectedTag(tag)}>{tag}</FilterButton>
              ))}
            </FilterBar>
            <HistoryContent state={history.kind === "ready" ? { kind: "ready", items: visibleHistoryItems } : history} onChanged={refreshMockHistory} />
          </section>
        ) : (
          <section aria-label="专家列表" className="pt-6">
            <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
              <FilterBar>
                {[undefined, ...MOCK_EXPERT_CATEGORIES].map((value) => (
                  <FilterButton key={value ?? "all"} active={domain === value} onClick={() => setDomain(value)}>
                    {value ?? "全部专家"}
                  </FilterButton>
                ))}
              </FilterBar>
              <p data-testid="itv-expert-count" className="py-2 text-xs text-muted-foreground">
                {domain === undefined ? MOCK_DIGITAL_EXPERTS.length : MOCK_DIGITAL_EXPERTS.filter((expert) => expert.domains.includes(domain)).length} 位 Mock 专家
              </p>
            </div>
            <ExpertContent
              state={{
                kind: "ready",
                items: domain === undefined
                  ? MOCK_DIGITAL_EXPERTS
                  : MOCK_DIGITAL_EXPERTS.filter((expert) => expert.domains.includes(domain)),
              }}
            />
          </section>
        )}
      </div>
      <DigitalInterviewCreateModal open={createOpen} onOpenChange={setCreateOpen} />
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

function combineHistoryRows(serverItems: readonly DigitalInterviewHistoryRow[]): readonly DigitalInterviewHistoryRow[] {
  return [
    ...listMockDigitalInterviewDrafts().map(mockDraftHistoryRow),
    ...serverItems.filter((item) => !item.interviewId.startsWith("mock-batch-")),
  ];
}

function TabButton({ active, testId, onClick, children }: {
  active: boolean; testId: string; onClick: () => void; children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      data-testid={testId}
      onClick={onClick}
      className={cn("-mb-px border-b-2 px-1 pb-4 text-sm transition-colors", active
        ? "border-foreground font-semibold text-foreground"
        : "border-transparent text-muted-foreground hover:text-foreground")}
    >{children}</button>
  );
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
      active ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background text-muted-foreground hover:text-foreground",
    )}>{children}</button>
  );
}

function HistoryContent({ state, onChanged }: { state: LoadState<DigitalInterviewHistoryRow>; onChanged: () => void }) {
  if (state.kind === "loading") return <StatePanel>正在加载历史访谈…</StatePanel>;
  if (state.kind === "error") return <StatePanel testId="itv-history-error">加载失败：{state.reason}</StatePanel>;
  if (state.items.length === 0) return <StatePanel testId="itv-history-empty">还没有符合条件的访谈。</StatePanel>;
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      {state.items.map((item) => <HistoryCard key={item.interviewId} item={item} onChanged={onChanged} />)}
    </div>
  );
}

function HistoryCard({ item, onChanged }: { item: DigitalInterviewHistoryRow; onChanged: () => void }) {
  const action = historyPrimaryAction(item);
  return (
    <article data-testid={`itv-history-card-${item.interviewId}`} className="flex min-h-64 flex-col rounded-lg border border-border bg-card p-5 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="truncate text-base font-semibold text-card-foreground">{item.name}</h2>
          <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">{item.topic}</p>
        </div>
        <Badge tone="outline" className="shrink-0">
          {STATUS_LABEL[item.status]}
        </Badge>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        {item.tags.map((tag) => <Badge key={tag} tone="neutral">{tag}</Badge>)}
      </div>
      <div className="mt-auto border-t border-border pt-4">
        <div className="mb-4 flex items-center justify-between text-xs text-muted-foreground">
          <span>{item.completedExpertCount} / {item.expertCount} 位专家完成</span>
          <time>{new Date(item.updatedAt).toLocaleDateString("zh-CN")}</time>
        </div>
        <div className="flex items-center justify-between gap-3">
          <Link href={action.href} className="inline-flex items-center gap-2 text-sm font-medium text-foreground">
            {action.label}<ArrowRight className="size-4" />
          </Link>
          <InterviewHistoryCardActions item={item} onChanged={onChanged} />
        </div>
      </div>
    </article>
  );
}

function historyPrimaryAction(item: DigitalInterviewHistoryRow): { readonly label: string; readonly href: string } {
  if (item.kind === "quick") return { label: "继续对话", href: `/itv/quick/${item.interviewId}` };
  const detail = item.interviewId.startsWith("mock-batch-") ? `/itv/${item.interviewId}/setup` : `/itv/${item.interviewId}`;
  const report = `${detail}/report`;
  return {
    confirm_topic: { label: "确认主题", href: detail },
    confirm_experts: { label: "确认专家", href: detail },
    confirm_questions: { label: "确认问题", href: detail },
    continue_runs: { label: "继续访谈", href: detail },
    generate_report: { label: "生成报告", href: report },
    view_report: { label: "查看报告", href: report },
    retry: { label: "重试", href: detail },
  }[item.primaryAction];
}

function ExpertContent({ state }: { state: LoadState<DigitalExpertCatalogRow> }) {
  if (state.kind === "loading") return <StatePanel>正在加载专家…</StatePanel>;
  if (state.kind === "error") return <StatePanel testId="itv-experts-error">加载失败：{state.reason}</StatePanel>;
  if (state.items.length === 0) return <StatePanel testId="itv-experts-empty">当前分类暂无可用专家。</StatePanel>;
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {state.items.map((expert) => {
        const mock = expert as MockDigitalExpertPersona;
        return (
        <article key={expert.expertId} data-testid={`itv-expert-card-${expert.expertId}`} className="rounded-xl border border-border bg-card p-6 shadow-sm">
          <div className="flex items-center gap-4">
            <div className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-sm font-semibold text-primary">{expert.initials}</div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-base font-semibold text-card-foreground">{expert.displayName}</h2>
                <span className="rounded-full bg-primary/10 px-2 py-1 text-[10px] font-medium text-primary">Mock 专家</span>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{expert.role}</p>
            </div>
          </div>
          {mock.bio && <p className="mt-4 line-clamp-2 text-sm leading-6 text-muted-foreground">{mock.bio}</p>}
          <div className="mt-5 rounded-lg bg-muted/60 p-3 text-xs text-muted-foreground">
            <span className="font-medium text-foreground">材料边界：</span>{expert.materialBoundary}
          </div>
          <div className="mt-5 flex items-center gap-3">
            <Link data-testid={`itv-quick-${expert.expertId}`} href={`/itv/quick/new?expertId=${encodeURIComponent(expert.expertId)}`} className="inline-flex h-9 items-center rounded-lg bg-primary px-4 text-xs font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90">
              快捷访谈
            </Link>
            <Link href={`/itv/experts/${expert.expertId}`} className="inline-flex h-9 items-center rounded-lg border border-border px-4 text-xs font-medium text-foreground">
              查看专家
            </Link>
          </div>
        </article>
      );})}
    </div>
  );
}

function StatePanel({ testId, children }: { testId?: string; children: React.ReactNode }) {
  return <div data-testid={testId} className="flex min-h-64 flex-col items-center justify-center rounded-lg border border-dashed border-border bg-card p-6 text-center text-12 text-muted-foreground">{children}</div>;
}
