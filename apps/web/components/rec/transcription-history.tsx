"use client";

import * as React from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { ChevronDown, Clock3, MoreVertical, Pencil, Plus, Search, SlidersHorizontal, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useOptionalSession } from "@/components/session/session-provider";
import {
  createPersonalTranscription,
  deletePersonalTranscription,
  listPersonalTranscriptions,
  listPersonalTranscriptionTags,
  readPersonalTranscription,
  updatePersonalTranscriptionContent,
  updatePersonalTranscriptionMetadata,
  type PersonalTranscriptionDetail,
  type PersonalTranscriptionSummary,
} from "@/lib/live-personal-transcriptions";
import type { UiState } from "@/lib/ui-state";
import { openBoardxRealtimeAsr, type BoardxRealtimeAsrHandle } from "@/lib/BoardxRealtimeAsrClient";
import { LiveRecordingError } from "@/lib/live-recording";
import type { RealtimeAsrStreamState } from "@/lib/realtime-asr.types";
import type { TranscriptionHistoryItem } from "@/lib/mock/realtime-transcriptions";
import { CreateTranscriptionDialog, type NewTranscriptionDraft } from "./create-transcription-dialog";
import { DeleteTranscriptionDialog } from "./delete-transcription-dialog";
import { EditTranscriptionDialog } from "./edit-transcription-dialog";
import { RealtimeTranscriptionWorkspace } from "./realtime-transcription-workspace";

type ActiveTag = string;

export function TranscriptionHistory({ uiState }: { uiState: UiState }) {
  const sessionContext = useOptionalSession();
  const sessionToken = sessionContext?.session?.sessionToken;
  const [items, setItems] = React.useState<readonly TranscriptionHistoryItem[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [listRevision, setListRevision] = React.useState(0);
  const [activeTag, setActiveTag] = React.useState<ActiveTag>("全部标签");
  const [tags, setTags] = React.useState<readonly string[]>([]);
  const [query, setQuery] = React.useState("");
  const [createOpen, setCreateOpen] = React.useState(false);
  const [editItem, setEditItem] = React.useState<TranscriptionHistoryItem | null>(null);
  const [deleteItem, setDeleteItem] = React.useState<TranscriptionHistoryItem | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [activeSession, setActiveSession] = React.useState<PersonalTranscriptionDetail | null>(null);
  const [streamState, setStreamState] = React.useState<RealtimeAsrStreamState>("idle");
  const [interimSegment, setInterimSegment] = React.useState("");
  const [streamError, setStreamError] = React.useState<string | null>(null);
  const streamRef = React.useRef<BoardxRealtimeAsrHandle | null>(null);
  const receivedFinalIdsRef = React.useRef(new Set<string>());

  React.useEffect(() => {
    let active = true;
    setLoading(true);
    setLoadError(null);
    const input = {
      ...(query.trim() ? { query: query.trim() } : {}),
      ...(activeTag === "全部标签" ? {} : { tag: activeTag }),
    };
    void loadAllPersonalTranscriptions(input, sessionToken)
      .then((result) => {
        if (!active) return;
        setItems(result.items.map(toHistoryItem));
      })
      .catch((error: unknown) => {
        if (!active) return;
        setLoadError(error instanceof Error ? error.message : "TRANSCRIPTION_LIST_FAILED");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [activeTag, listRevision, query, sessionToken]);

  const refreshTags = React.useCallback(async () => {
    const result = await listPersonalTranscriptionTags(sessionToken);
    setTags(result.tags);
    setActiveTag((current) => current === "全部标签" || result.tags.includes(current) ? current : "全部标签");
  }, [sessionToken]);

  React.useEffect(() => { void refreshTags().catch(() => setLoadError("TRANSCRIPTION_TAGS_FAILED")); }, [refreshTags]);

  async function createTranscription(draft: NewTranscriptionDraft) {
    setLoadError(null);
    const summary = await createPersonalTranscription({
      name: draft.name,
      tags: [...draft.tags],
    }, sessionToken);
    const created = toHistoryItem(summary);
    setItems((current) => [created, ...current]);
    setNotice(`已创建“${draft.name}”，正在进入实时转录`);
    setActiveSession({ ...summary, content: "" });
    await refreshTags();
  }

  async function saveMetadata(item: TranscriptionHistoryItem, draft: NewTranscriptionDraft) {
    const updated = await updatePersonalTranscriptionMetadata(item.id, { name: draft.name, tags: [...draft.tags] }, sessionToken);
    setNotice(`已更新“${updated.name}”`);
    setListRevision((current) => current + 1);
    void refreshTags().catch(() => setLoadError("TRANSCRIPTION_TAGS_FAILED"));
  }

  async function removeTranscription(item: TranscriptionHistoryItem) {
    await deletePersonalTranscription(item.id, sessionToken);
    setItems((current) => current.filter((entry) => entry.id !== item.id));
    setNotice(`已永久删除“${item.title}”`);
    void refreshTags().catch(() => setLoadError("TRANSCRIPTION_TAGS_FAILED"));
  }

  async function openTranscription(item: TranscriptionHistoryItem) {
    setLoadError(null);
    try {
      setActiveSession(await readPersonalTranscription(item.id, sessionToken));
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "TRANSCRIPTION_READ_FAILED");
    }
  }

  async function startRealtimeTranscription() {
    if (!activeSession || streamRef.current || streamState === "connecting") return;
    setStreamError(null);
    setInterimSegment("");
    receivedFinalIdsRef.current.clear();
    setStreamState("connecting");
    try {
      streamRef.current = await openBoardxRealtimeAsr(activeSession.sessionId, {
        sessionToken,
        handlers: {
          onState: setStreamState,
          onInterim: setInterimSegment,
          onFinal: (event) => {
            if (receivedFinalIdsRef.current.has(event.segmentId)) return;
            receivedFinalIdsRef.current.add(event.segmentId);
            setInterimSegment("");
            setActiveSession((current) => appendFinalEvent(current, event));
          },
          onError: (reason) => {
            setStreamError(streamErrorText(reason));
            streamRef.current = null;
          },
        },
      });
    } catch (error) {
      streamRef.current = null;
      setStreamState("error");
      setStreamError(error instanceof LiveRecordingError ? error.message : streamErrorText(error instanceof Error ? error.message : "CONNECTION_FAILED"));
    }
  }

  async function stopRealtimeTranscription() {
    const handle = streamRef.current;
    if (!handle) return;
    setStreamError(null);
    setStreamState("stopping");
    try {
      await handle.stop();
      setInterimSegment("");
      setActiveSession(await readPersonalTranscription(activeSession!.sessionId, sessionToken));
      setStreamState("idle");
    } catch {
      setStreamState("error");
      setStreamError("转录收尾失败，已保存的最终文字不会丢失，请重新打开后重试。");
    } finally {
      streamRef.current = null;
    }
  }

  async function saveContent(content: string) {
    if (!activeSession) return;
    setStreamError(null);
    try {
      setActiveSession(await updatePersonalTranscriptionContent(activeSession.sessionId, content, sessionToken));
    } catch {
      setStreamError("正文保存失败，请稍后重试。");
      throw new Error("TRANSCRIPTION_CONTENT_SAVE_FAILED");
    }
  }

  React.useEffect(() => () => { void streamRef.current?.stop(); }, []);

  if (activeSession) {
    return <RealtimeTranscriptionWorkspace session={activeSession} streamState={streamState}
      interimSegment={interimSegment} errorMessage={streamError}
      onStart={() => void startRealtimeTranscription()} onStop={() => void stopRealtimeTranscription()}
      onSaveContent={saveContent}
      onBack={() => { if (!streamRef.current) setActiveSession(null); }} />;
  }

  return (
    <section data-testid="rec-history-page" className="min-h-full bg-background px-5 py-6 md:px-8 lg:px-10">
      <div className="mx-auto flex w-full max-w-screen-2xl flex-col gap-6">
        <header className="flex flex-col gap-5 md:flex-row md:items-start md:justify-between">
          <div className="flex flex-col gap-2">
            <p className="text-11 font-medium text-muted-foreground">Studio&nbsp;&nbsp;/&nbsp;&nbsp;转录</p>
            <div className="flex items-center gap-2">
              <h1 className="text-24 font-semibold tracking-tight">历史转录</h1>
              <span data-testid="rec-history-count" className="text-18 text-muted-foreground">· {items.length}</span>
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
            {["全部标签", ...tags].map((tag) => (
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
        {loadError && <p role="alert" data-testid="rec-history-api-error" className="rounded-md border border-destructive px-3 py-2 text-12 text-destructive">历史转录读取失败，请稍后重试。</p>}
        <HistoryState
          uiState={loading && uiState === "default" ? "loading" : uiState}
          items={items}
          onCreate={() => setCreateOpen(true)}
          onOpen={(item) => void openTranscription(item)}
          onEdit={setEditItem}
          onDelete={setDeleteItem}
        />
      </div>

      <CreateTranscriptionDialog open={createOpen} onOpenChange={setCreateOpen} onCreate={createTranscription} />
      {editItem && <EditTranscriptionDialog open initialName={editItem.title} initialTags={editItem.tags}
        onOpenChange={(open) => { if (!open) setEditItem(null); }}
        onSave={(draft) => saveMetadata(editItem, draft)} />}
      {deleteItem && <DeleteTranscriptionDialog open name={deleteItem.title}
        onOpenChange={(open) => { if (!open) setDeleteItem(null); }}
        onConfirm={() => removeTranscription(deleteItem)} />}
    </section>
  );
}

function appendFinalEvent(
  current: PersonalTranscriptionDetail | null,
  event: { captureId: string; segmentId: string; ordinal: number; text: string; startMs: number; endMs: number },
): PersonalTranscriptionDetail | null {
  if (!current) return null;
  return { ...current, status: "recording", content: [current.content, event.text].filter(Boolean).join(" ") };
}

function streamErrorText(reason: string): string {
  const messages: Record<string, string> = {
    ASR_NOT_CONFIGURED: "当前环境尚未配置阿里云实时转录，请联系管理员配置服务后重试。",
    QUOTA_EXCEEDED: "当前实时转录额度不足。",
    CAPTURE_ALREADY_ACTIVE: "这条转录已有正在进行的录音，请重新打开后继续。",
    TICKET_EXPIRED: "连接凭证已过期，请重新点击开始转录。",
    ASR_PROVIDER_UNAVAILABLE: "阿里云实时转录暂时不可用，请稍后重试。",
    CONNECTION_FAILED: "无法连接实时转录服务，请检查网络后重试。",
  };
  return messages[reason] ?? "无法启动实时转录，请稍后重试。";
}

function HistoryState({
  uiState, items, onCreate, onOpen, onEdit, onDelete,
}: {
  uiState: UiState;
  items: readonly TranscriptionHistoryItem[];
  onCreate: () => void;
  onOpen: (item: TranscriptionHistoryItem) => void;
  onEdit: (item: TranscriptionHistoryItem) => void;
  onDelete: (item: TranscriptionHistoryItem) => void;
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
      {items.map((item) => <HistoryCard key={item.id} item={item} onOpen={onOpen} onEdit={onEdit} onDelete={onDelete} />)}
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

function HistoryCard({
  item,
  onOpen, onEdit, onDelete,
}: {
  item: TranscriptionHistoryItem;
  onOpen: (item: TranscriptionHistoryItem) => void;
  onEdit: (item: TranscriptionHistoryItem) => void;
  onDelete: (item: TranscriptionHistoryItem) => void;
}) {
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
          <Badge tone={item.status === "recording" ? "warning" : item.status === "failed" ? "danger" : "neutral"}>
            {item.status === "recording" ? "转录中" : item.status === "failed" ? "失败" : item.duration === "00:00" ? "待开始" : "可续录"}
          </Badge>
        </div>
        <p className="line-clamp-3 text-12 leading-relaxed text-muted-foreground">{item.summary}</p>
        <div className="flex min-h-6 flex-wrap gap-1.5">
          {item.tags.map((tag) => <Badge key={tag} tone="neutral">{tag}</Badge>)}
        </div>
      </div>
      <div className="mt-5 flex items-end justify-between gap-3">
        <div className="flex flex-col gap-3">
          <span className="text-11 text-muted-foreground">{item.duration}&nbsp;&nbsp;·&nbsp;&nbsp;{item.updatedAt}</span>
          <Button
            data-testid={`rec-history-open-${item.id}`}
            size="sm"
            variant="primary"
            onClick={() => onOpen(item)}
          >
            进入转录
          </Button>
        </div>
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild><Button data-testid={`rec-history-more-${item.id}`} size="icon" variant="ghost" aria-label={`${item.title} 更多操作`}><MoreVertical aria-hidden className="h-4 w-4" /></Button></DropdownMenu.Trigger>
          <DropdownMenu.Portal><DropdownMenu.Content align="end" className="z-50 min-w-32 rounded-md border border-border bg-card p-1 shadow-md">
            <DropdownMenu.Item data-testid={`rec-history-edit-${item.id}`} className="flex cursor-pointer items-center gap-2 rounded px-3 py-2 text-12 transition-colors hover:bg-muted focus:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onSelect={() => onEdit(item)}><Pencil className="h-4 w-4" />修改</DropdownMenu.Item>
            <DropdownMenu.Item data-testid={`rec-history-delete-${item.id}`} className="flex cursor-pointer items-center gap-2 rounded px-3 py-2 text-12 text-destructive transition-colors hover:bg-muted focus:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onSelect={() => onDelete(item)}><Trash2 className="h-4 w-4" />删除</DropdownMenu.Item>
          </DropdownMenu.Content></DropdownMenu.Portal>
        </DropdownMenu.Root>
      </div>
    </Card>
  );
}

function toHistoryItem(item: PersonalTranscriptionSummary): TranscriptionHistoryItem {
  const durationSeconds = Math.floor(item.durationMs / 1_000);
  const minutes = Math.floor(durationSeconds / 60);
  const seconds = durationSeconds % 60;
  return {
    id: item.sessionId,
    title: item.name,
    project: "个人转录",
    owner: "我",
    ownerInitial: "我",
    summary: item.durationMs > 0 ? "内容已保存，可随时进入并继续追加转录。" : "等待麦克风音频输入。",
    tags: item.tags,
    duration: `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`,
    updatedAt: new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(item.updatedAt)),
    status: item.status,
  };
}

async function loadAllPersonalTranscriptions(
  input: { readonly query?: string; readonly tag?: string },
  sessionToken?: string | null,
): Promise<{ items: PersonalTranscriptionSummary[] }> {
  const items: PersonalTranscriptionSummary[] = [];
  let cursor: string | undefined;
  do {
    const page = await listPersonalTranscriptions(
      cursor === undefined ? input : { ...input, cursor },
      sessionToken,
    );
    items.push(...page.items);
    cursor = page.nextCursor ?? undefined;
  } while (cursor !== undefined);
  return { items };
}
