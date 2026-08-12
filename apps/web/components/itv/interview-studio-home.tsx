"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowRight, Plus } from "lucide-react";
import { ApiError } from "@/lib/api-client";
import {
  loadDigitalExperts,
  loadDigitalInterviewHistory,
  type DigitalExpertCatalogRow,
  type DigitalInterviewHistoryRow,
} from "@/lib/interview-api";
import { cn } from "@/lib/utils";

type Tab = "history" | "experts";
type LoadState<T> =
  | { kind: "loading" }
  | { kind: "ready"; items: readonly T[] }
  | { kind: "error"; reason: string };

const HISTORY_FILTERS = [
  { value: undefined, label: "全部" },
  { value: "running", label: "进行中" },
  { value: "questions_pending", label: "待确认" },
  { value: "completed", label: "已完成" },
] as const;

const EXPERT_DOMAINS = [undefined, "采购与供应链", "产品与市场", "交付与合规"] as const;

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

export function InterviewStudioHome({ initialTab = "history" }: { initialTab?: Tab }) {
  const [tab, setTab] = React.useState<Tab>(initialTab);
  const [status, setStatus] = React.useState<string | undefined>();
  const [domain, setDomain] = React.useState<string | undefined>();
  const [history, setHistory] = React.useState<LoadState<DigitalInterviewHistoryRow>>({ kind: "loading" });
  const [experts, setExperts] = React.useState<LoadState<DigitalExpertCatalogRow>>({ kind: "loading" });

  React.useEffect(() => {
    let active = true;
    setHistory({ kind: "loading" });
    void loadDigitalInterviewHistory(status).then(
      (result) => active && setHistory({ kind: "ready", items: result.items }),
      (error: unknown) => active && setHistory({ kind: "error", reason: reasonOf(error) }),
    );
    return () => { active = false; };
  }, [status]);

  React.useEffect(() => {
    if (tab !== "experts") return;
    let active = true;
    setExperts({ kind: "loading" });
    void loadDigitalExperts(domain).then(
      (result) => active && setExperts({ kind: "ready", items: result.items }),
      (error: unknown) => active && setExperts({ kind: "error", reason: reasonOf(error) }),
    );
    return () => { active = false; };
  }, [domain, tab]);

  return (
    <main className="min-w-0 flex-1 overflow-y-auto bg-background">
      <div className="mx-auto w-full max-w-[1380px] px-6 py-8 lg:px-10 lg:py-10">
        <header className="flex flex-col gap-5 border-b border-border pb-6 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight text-foreground">访谈 Studio</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              回看或继续历史访谈，也可以选择一位数字专家快速开始对话。
            </p>
          </div>
          <Link
            data-testid="itv-create"
            href="/itv/new"
            className="inline-flex h-11 shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-lg bg-foreground px-5 text-sm font-medium text-background transition-colors hover:bg-foreground/90"
          >
            <Plus className="size-4" /> 新建访谈
          </Link>
        </header>

        <div role="tablist" aria-label="访谈内容" className="mt-6 flex gap-8 border-b border-border">
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
              {HISTORY_FILTERS.map((filter) => (
                <FilterButton key={filter.label} active={status === filter.value} onClick={() => setStatus(filter.value)}>
                  {filter.label}
                </FilterButton>
              ))}
            </FilterBar>
            <HistoryContent state={history} />
          </section>
        ) : (
          <section aria-label="专家列表" className="pt-6">
            <FilterBar>
              {EXPERT_DOMAINS.map((value) => (
                <FilterButton key={value ?? "all"} active={domain === value} onClick={() => setDomain(value)}>
                  {value ?? "全部专家"}
                </FilterButton>
              ))}
            </FilterBar>
            <ExpertContent state={experts} />
          </section>
        )}
      </div>
    </main>
  );
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
  return <div className="mb-5 flex flex-wrap items-center gap-2">{children}</div>;
}

function FilterButton({ active, onClick, children }: {
  active: boolean; onClick: () => void; children: React.ReactNode;
}) {
  return (
    <button type="button" onClick={onClick} className={cn(
      "rounded-lg border px-4 py-2 text-xs font-medium transition-colors",
      active ? "border-foreground bg-foreground text-background" : "border-border bg-background text-muted-foreground hover:text-foreground",
    )}>{children}</button>
  );
}

function HistoryContent({ state }: { state: LoadState<DigitalInterviewHistoryRow> }) {
  if (state.kind === "loading") return <StatePanel>正在加载历史访谈…</StatePanel>;
  if (state.kind === "error") return <StatePanel testId="itv-history-error">加载失败：{state.reason}</StatePanel>;
  if (state.items.length === 0) return <StatePanel testId="itv-history-empty">还没有符合条件的访谈。</StatePanel>;
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {state.items.map((item) => <HistoryCard key={item.interviewId} item={item} />)}
    </div>
  );
}

function HistoryCard({ item }: { item: DigitalInterviewHistoryRow }) {
  const action = historyPrimaryAction(item);
  return (
    <article data-testid={`itv-history-card-${item.interviewId}`} className="flex min-h-64 flex-col rounded-xl border border-border bg-card p-5 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="truncate text-base font-semibold text-card-foreground">{item.name}</h2>
          <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">{item.topic}</p>
        </div>
        <span className="shrink-0 rounded-md border border-border px-2 py-1 text-[11px] font-medium text-muted-foreground">
          {STATUS_LABEL[item.status]}
        </span>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        {item.tags.map((tag) => <span key={tag} className="rounded-md bg-muted px-2 py-1 text-[11px] text-muted-foreground">{tag}</span>)}
      </div>
      <div className="mt-auto border-t border-border pt-4">
        <div className="mb-4 flex items-center justify-between text-xs text-muted-foreground">
          <span>{item.completedExpertCount} / {item.expertCount} 位专家完成</span>
          <time>{new Date(item.updatedAt).toLocaleDateString("zh-CN")}</time>
        </div>
        <Link href={action.href} className="inline-flex items-center gap-2 text-sm font-medium text-foreground">
          {action.label}<ArrowRight className="size-4" />
        </Link>
      </div>
    </article>
  );
}

function historyPrimaryAction(item: DigitalInterviewHistoryRow): { readonly label: string; readonly href: string } {
  if (item.kind === "quick") return { label: "继续对话", href: `/itv/quick/${item.interviewId}` };
  const detail = `/itv/${item.interviewId}`;
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
      {state.items.map((expert) => (
        <article key={expert.expertId} data-testid={`itv-expert-card-${expert.expertId}`} className="rounded-xl border border-border bg-card p-6 shadow-sm">
          <div className="flex items-center gap-4">
            <div className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-sm font-semibold text-primary">{expert.initials}</div>
            <div>
              <h2 className="text-base font-semibold text-card-foreground">{expert.displayName}</h2>
              <p className="mt-1 text-xs text-muted-foreground">{expert.role}</p>
            </div>
          </div>
          <div className="mt-5 rounded-lg bg-muted/60 p-3 text-xs text-muted-foreground">
            <span className="font-medium text-foreground">材料边界：</span>{expert.materialBoundary}
          </div>
          <div className="mt-5 flex items-center gap-3">
            <Link data-testid={`itv-quick-${expert.expertId}`} href={`/itv/quick/new?expertId=${expert.expertId}`} className="inline-flex h-9 items-center rounded-lg bg-foreground px-4 text-xs font-medium text-background">
              快捷访谈
            </Link>
            <Link href={`/itv/experts/${expert.expertId}`} className="inline-flex h-9 items-center rounded-lg border border-border px-4 text-xs font-medium text-foreground">
              查看专家
            </Link>
          </div>
        </article>
      ))}
    </div>
  );
}

function StatePanel({ testId, children }: { testId?: string; children: React.ReactNode }) {
  return <div data-testid={testId} className="rounded-xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">{children}</div>;
}
