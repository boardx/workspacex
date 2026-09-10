"use client";

import * as React from "react";
import { Plus, Search, ArrowDownWideNarrow } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export type HistorySort = "recent" | "oldest";

export function StudioHistoryHeader({ business, description, count, createTestId, countTestId, onCreate }: {
  business: string; description: string; count?: number; createTestId: string; countTestId?: string; onCreate: () => void;
}) {
  return <header className="flex flex-col gap-5 md:flex-row md:items-start md:justify-between">
    <div className="min-w-0 space-y-2">
      <p className="text-11 font-medium text-muted-foreground">Studio / {business}</p>
      <div className="flex items-center gap-2"><h1 className="text-24 font-semibold tracking-tight">历史{business}</h1>{count !== undefined && <span data-testid={countTestId} className="text-18 text-muted-foreground">· {count}</span>}</div>
      <p className="max-w-2xl text-12 leading-relaxed text-muted-foreground">{description}</p>
    </div>
    <Button type="button" variant="primary" size="lg" data-testid={createTestId} onClick={onCreate}><Plus className="size-4" aria-hidden />新建{business}</Button>
  </header>;
}

export function StudioHistoryFilters({ business, prefix, tags, selectedTag, onTagChange, query, onQueryChange, sort, onSortChange }: {
  business: string; prefix: string; tags: readonly string[]; selectedTag?: string; onTagChange: (tag: string | undefined) => void;
  query: string; onQueryChange: (value: string) => void; sort: HistorySort; onSortChange: (sort: HistorySort) => void;
}) {
  return <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
    <div className="flex min-w-0 flex-wrap gap-2" aria-label={`按标签筛选${business}`}>
      <Button size="sm" variant={selectedTag === undefined ? "primary" : "outline"} aria-pressed={selectedTag === undefined} data-testid={`${prefix}-tag-all`} onClick={() => onTagChange(undefined)}>全部标签</Button>
      {tags.map(tag => <Button key={tag} size="sm" className="max-w-full whitespace-normal break-all text-left" variant={selectedTag === tag ? "primary" : "outline"} aria-pressed={selectedTag === tag} data-testid={`${prefix}-tag-${tag}`} onClick={() => onTagChange(tag)}>{tag}</Button>)}
    </div>
    <div className="flex shrink-0 flex-col gap-2 sm:flex-row">
      <label className="relative block min-w-0 sm:w-64"><span className="sr-only">搜索{business}</span><Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /><Input data-testid={`${prefix}-search`} maxLength={100} value={query} onChange={event => onQueryChange(event.target.value)} placeholder={`搜索${business}名称或内容`} className="h-9 pl-9" /></label>
      <Button variant="outline" className="h-9" data-testid={`${prefix}-sort`} onClick={() => onSortChange(sort === "recent" ? "oldest" : "recent")} aria-label={`当前${sort === "recent" ? "最近更新" : "最早更新"}，点击切换排序`}><ArrowDownWideNarrow className="size-4" aria-hidden />{sort === "recent" ? "最近更新" : "最早更新"}</Button>
    </div>
  </div>;
}

export function StudioHistoryCard({ testId, title, status, description, tags, metadata, primaryAction, management, children }: {
  testId: string; title: string; status: React.ReactNode; description: React.ReactNode; tags: readonly string[];
  metadata: React.ReactNode; primaryAction: React.ReactNode; management: React.ReactNode; children?: React.ReactNode;
}) {
  return <article data-testid={testId} className="flex min-h-64 min-w-0 flex-col rounded-lg border border-border bg-card p-5 text-card-foreground shadow-sm transition-shadow duration-base hover:shadow-md">
    <div className="flex items-start justify-between gap-3"><h2 className="min-w-0 break-words text-14 font-semibold" title={title}>{title}</h2><div className="shrink-0">{status}</div></div>
    <div className="mt-3 line-clamp-3 text-12 leading-relaxed text-muted-foreground">{description}</div>
    <div className="mt-3 flex min-h-6 flex-wrap gap-1.5">{tags.map(tag => <Badge key={tag} tone="neutral" className="max-w-full whitespace-normal break-all">{tag}</Badge>)}</div>
    <div className="mt-auto space-y-3 pt-5">{children}<div className="flex flex-wrap items-center justify-between gap-2 text-11 text-muted-foreground">{metadata}</div><div className="flex items-center justify-between gap-3">{primaryAction}{management}</div></div>
  </article>;
}

export function StudioHistoryCreateCard({ business, testId, onCreate }: { business: string; testId: string; onCreate: () => void }) {
  return <Button type="button" variant="outline" data-testid={testId} onClick={onCreate} className="h-auto min-h-64 flex-col gap-3 border-dashed p-6"><Plus aria-hidden className="size-6 text-muted-foreground" /><span className="text-13 font-semibold">新建{business}</span><span className="text-11 font-normal text-muted-foreground">开始一次新的{business}</span></Button>;
}
