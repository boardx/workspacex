"use client";

import * as React from "react";
import { ChevronDown, Clock3, MoreVertical, Plus, Search, SlidersHorizontal } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import type { UiState } from "@/lib/ui-state";
import {
  MOCK_TRANSCRIPTION_TOTAL,
  MOCK_TRANSCRIPTIONS,
  TRANSCRIPTION_TAGS,
  type TranscriptionHistoryItem,
  type TranscriptionTag,
} from "@/lib/mock/realtime-transcriptions";
import { CreateTranscriptionDialog, type NewTranscriptionDraft } from "./create-transcription-dialog";

type ActiveTag = "全部标签" | TranscriptionTag;

export function TranscriptionHistory({ uiState }: { uiState: UiState }) {
  const [items, setItems] = React.useState<readonly TranscriptionHistoryItem[]>(MOCK_TRANSCRIPTIONS);
  const [activeTag, setActiveTag] = React.useState<ActiveTag>("全部标签");
  const [query, setQuery] = React.useState("");
  const [createOpen, setCreateOpen] = React.useState(false);
  const [notice, setNotice] = React.useState<string | null>(null);

  const visibleItems = React.useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    return items.filter((item) => {
      const tagMatch = activeTag === "全部标签" || item.tags.includes(activeTag);
      const textMatch = !normalized || `${item.title} ${item.summary} ${item.project}`.toLocaleLowerCase().includes(normalized);
      return tagMatch && textMatch;
    });
  }, [activeTag, items, query]);

  function createTranscription(draft: NewTranscriptionDraft) {
    const created: TranscriptionHistoryItem = {
      id: `draft-${items.length + 1}`,
      title: draft.name,
      project: "当前项目",
      owner: "林可",
      ownerInitial: "林",
      summary: "实时转录已创建，等待麦克风音频输入。",
      tags: draft.tags.filter((tag): tag is TranscriptionTag => TRANSCRIPTION_TAGS.includes(tag as TranscriptionTag)),
      duration: "00:00",
      updatedAt: "刚刚",
      status: "recording",
    };
    setItems((current) => [created, ...current]);
    setNotice(`已创建“${draft.name}”，正在进入实时转录`);
  }

  return (
    <section data-testid="rec-history-page" className="min-h-full bg-background px-5 py-6 md:px-8 lg:px-10">
      <div className="mx-auto flex w-full max-w-screen-2xl flex-col gap-6">
        <header className="flex flex-col gap-5 md:flex-row md:items-start md:justify-between">
          <div className="flex flex-col gap-2">
            <p className="text-11 font-medium text-muted-foreground">Studio&nbsp;&nbsp;/&nbsp;&nbsp;转录</p>
            <div className="flex items-center gap-2">
              <h1 className="text-24 font-semibold tracking-tight">历史转录</h1>
              <span data-testid="rec-history-count" className="text-18 text-muted-foreground">· {MOCK_TRANSCRIPTION_TOTAL}</span>
            </div>
            <p className="text-12 text-muted-foreground">跨项目的全部历史转录。打开任意一条以查看内容、总结与洞察。</p>
          </div>
          <Button data-testid="rec-create-open" variant="primary" size="lg" onClick={() => setCreateOpen(true)}>
            <Plus aria-hidden className="h-4 w-4" />
            新建转录
          </Button>
        </header>

        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap gap-2" aria-label="按标签筛选转录">
            {(["全部标签", ...TRANSCRIPTION_TAGS] as const).map((tag) => (
              <Button
                key={tag}
                data-testid={`rec-history-tag-${tag}`}
                size="sm"
                variant={activeTag === tag ? "primary" : "outline"}
                aria-pressed={activeTag === tag}
                onClick={() => setActiveTag(tag)}
              >
                {tag}
              </Button>
            ))}
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <label className="relative block min-w-64">
              <span className="sr-only">搜索转录名称或内容</span>
              <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                data-testid="rec-history-search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜索转录名称或内容"
                className="h-9 pl-9"
              />
            </label>
            <Button data-testid="rec-history-sort" variant="outline" className="justify-between gap-5">
              <SlidersHorizontal aria-hidden className="h-4 w-4" />
              最近更新
              <ChevronDown aria-hidden className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {notice && <p data-testid="saved" className="rounded-md bg-success px-3 py-2 text-12 text-success-foreground">{notice}</p>}
        <HistoryState uiState={uiState} items={visibleItems} onCreate={() => setCreateOpen(true)} />
      </div>

      <CreateTranscriptionDialog open={createOpen} onOpenChange={setCreateOpen} onCreate={createTranscription} />
    </section>
  );
}

function HistoryState({
  uiState, items, onCreate,
}: {
  uiState: UiState;
  items: readonly TranscriptionHistoryItem[];
  onCreate: () => void;
}) {
  if (uiState === "loading") {
    return (
      <div data-testid="loading" className="grid animate-pulse grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 8 }).map((_, index) => <div key={index} className="h-64 rounded-lg bg-muted" />)}
      </div>
    );
  }
  if (uiState === "dep-failed" || uiState === "denied" || uiState === "invalid") {
    return (
      <div role="alert" data-testid="rec-history-error" className="rounded-lg border border-destructive bg-card p-6 text-13 text-destructive">
        历史转录暂时无法读取，请稍后重试。
      </div>
    );
  }
  if (uiState === "empty" || items.length === 0) {
    return (
      <div data-testid="rec-history-empty" className="flex min-h-64 flex-col items-center justify-center gap-4 rounded-lg border border-dashed border-border bg-card text-center">
        <Clock3 aria-hidden className="h-8 w-8 text-muted-foreground" />
        <div><p className="text-14 font-medium">还没有转录</p><p className="mt-1 text-12 text-muted-foreground">创建一次新的实时转录，内容会保存在这里。</p></div>
        <Button variant="primary" onClick={onCreate}><Plus aria-hidden className="h-4 w-4" />新建转录</Button>
      </div>
    );
  }
  return (
    <div data-testid="rec-history-grid" className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
      {items.map((item) => <HistoryCard key={item.id} item={item} />)}
      <button
        type="button"
        data-testid="rec-create-card"
        onClick={onCreate}
        className="flex min-h-64 flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border bg-card p-6 text-center transition-all duration-200 hover:border-primary hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      >
        <Plus aria-hidden className="h-6 w-6 text-muted-foreground" />
        <span className="text-13 font-semibold">新建转录</span>
        <span className="text-11 text-muted-foreground">开始一次新的实时转录</span>
      </button>
    </div>
  );
}

function HistoryCard({ item }: { item: TranscriptionHistoryItem }) {
  return (
    <Card data-testid={`rec-history-card-${item.id}`} className="flex min-h-64 flex-col justify-between p-5 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md">
      <div className="flex flex-col gap-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted text-12 font-semibold text-muted-foreground">{item.ownerInitial}</span>
            <div className="min-w-0">
              <h2 className="truncate text-14 font-semibold">{item.title}</h2>
              <p className="mt-1 truncate text-11 text-muted-foreground">{item.project} · {item.owner}</p>
            </div>
          </div>
          <Badge tone={item.status === "recording" ? "warning" : "primary"}>{item.status === "recording" ? "转录中" : "已完成"}</Badge>
        </div>
        <p className="line-clamp-3 text-12 leading-relaxed text-muted-foreground">{item.summary}</p>
        <div className="flex min-h-6 flex-wrap gap-1.5">
          {item.tags.map((tag) => <Badge key={tag} tone="neutral">{tag}</Badge>)}
        </div>
      </div>
      <div className="mt-5 flex items-end justify-between gap-3">
        <div className="flex flex-col gap-3">
          <span className="text-11 text-muted-foreground">{item.duration}&nbsp;&nbsp;·&nbsp;&nbsp;{item.updatedAt}</span>
          <Button size="sm" variant={item.status === "recording" ? "primary" : "outline"}>{item.status === "recording" ? "进入转录" : "打开转录"}</Button>
        </div>
        <Button size="icon" variant="ghost" aria-label={`${item.title} 更多操作`}><MoreVertical aria-hidden className="h-4 w-4" /></Button>
      </div>
    </Card>
  );
}
