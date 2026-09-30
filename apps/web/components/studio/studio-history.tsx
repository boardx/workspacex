"use client";

import * as React from "react";
import { Plus, Search, ArrowDownWideNarrow } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ResourceCard, ResourceCardTags } from "@/components/ui/resource-card";

export type HistorySort = "recent" | "oldest";

export function StudioHistoryHeader({ business, title, description, count, createTestId, countTestId, onCreate }: {
  business: string; title?: string; description: string; count?: number; createTestId: string; countTestId?: string; onCreate: () => void;
}) {
  return <header className="flex flex-col gap-5 md:flex-row md:items-start md:justify-between">
    <div className="min-w-0 space-y-2">
      <p className="text-11 font-medium text-muted-foreground">Studio / {business}</p>
      <div className="flex items-center gap-2"><h1 className="text-24 font-semibold tracking-tight">{title ?? `历史${business}`}</h1>{count !== undefined && <span data-testid={countTestId} className="text-18 text-muted-foreground">· {count}</span>}</div>
      <p className="max-w-2xl text-12 leading-relaxed text-muted-foreground">{description}</p>
    </div>
    <Button type="button" variant="primary" size="lg" data-testid={createTestId} onClick={onCreate}><Plus className="size-4" aria-hidden />新建{business}</Button>
  </header>;
}

export function StudioHistoryFilters({ business, prefix, tags, selectedTag, onTagChange, query, onQueryChange, sort, onSortChange, searchFirst = false }: {
  business: string; prefix: string; tags: readonly string[]; selectedTag?: string; onTagChange: (tag: string | undefined) => void;
  query: string; onQueryChange: (value: string) => void; sort: HistorySort; onSortChange: (sort: HistorySort) => void;
  searchFirst?: boolean;
}) {
  return <div className={searchFirst ? "flex flex-col gap-4" : "flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between"}>
    <div className={`flex min-w-0 flex-wrap gap-2 ${searchFirst ? "order-2" : ""}`} aria-label={`按标签筛选${business}`}>
      <Button size="sm" variant={selectedTag === undefined ? "primary" : "outline"} aria-pressed={selectedTag === undefined} data-testid={`${prefix}-tag-all`} onClick={() => onTagChange(undefined)}>全部标签</Button>
      {tags.map(tag => <Button key={tag} size="sm" className="max-w-full whitespace-normal break-all text-left" variant={selectedTag === tag ? "primary" : "outline"} aria-pressed={selectedTag === tag} data-testid={`${prefix}-tag-${tag}`} onClick={() => onTagChange(tag)}>{tag}</Button>)}
    </div>
    <div className={searchFirst ? "order-1 flex w-full flex-col gap-2 sm:flex-row" : "flex shrink-0 flex-col gap-2 sm:flex-row"}>
      <label className={searchFirst ? "relative block min-w-0 flex-1" : "relative block min-w-0 sm:w-64"}><span className="sr-only">搜索{business}</span><Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /><Input data-testid={`${prefix}-search`} maxLength={100} value={query} onChange={event => onQueryChange(event.target.value)} placeholder={`搜索${business}名称或内容`} className={searchFirst ? "h-12 pl-10 text-base" : "h-9 pl-9"} /></label>
      <Button variant="outline" className={searchFirst ? "h-12" : "h-9"} data-testid={`${prefix}-sort`} onClick={() => onSortChange(sort === "recent" ? "oldest" : "recent")} aria-label={`当前${sort === "recent" ? "最近更新" : "最早更新"}，点击切换排序`}><ArrowDownWideNarrow className="size-4" aria-hidden />{sort === "recent" ? "最近更新" : "最早更新"}</Button>
    </div>
  </div>;
}

/**
 * 历史列表（研究 / 访谈 / 录音）的卡片——2026-09-30 起是标准 `ResourceCard` 的一层薄封装
 * （人类要求所有卡片统一成标准项目卡片版式）：状态徽标与「⋯」管理菜单在标题右侧，
 * 主按钮在底部，版式只在 `components/ui/resource-card.tsx` 一处定义。
 */
export function StudioHistoryCard({ testId, title, status, description, tags, metadata, primaryAction, management, children }: {
  testId: string; title: string; status: React.ReactNode; description: React.ReactNode; tags: readonly string[];
  metadata: React.ReactNode; primaryAction: React.ReactNode; management: React.ReactNode; children?: React.ReactNode;
}) {
  return <ResourceCard testId={testId} title={<span title={title}>{title}</span>} badges={status} menu={management}
    description={description} tags={<ResourceCardTags tags={tags} />} meta={metadata} actions={primaryAction}>{children}</ResourceCard>;
}

export function StudioHistoryCreateCard({ business, testId, onCreate }: { business: string; testId: string; onCreate: () => void }) {
  return <Button type="button" variant="outline" data-testid={testId} onClick={onCreate} className="h-auto min-h-64 flex-col gap-3 border-dashed p-6"><Plus aria-hidden className="size-6 text-muted-foreground" /><span className="text-13 font-semibold">新建{business}</span><span className="text-11 font-normal text-muted-foreground">开始一次新的{business}</span></Button>;
}
