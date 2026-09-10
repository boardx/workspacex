"use client";

import * as React from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { Clock3, MoreVertical, Pencil, Plus, Square, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { StudioHistoryHeader, StudioHistoryFilters, StudioHistoryCard, StudioHistoryCreateCard, type HistorySort } from "@/components/studio/studio-history";
import { useOptionalSession } from "@/components/session/session-provider";
import {
  createPersonalTranscription,
  deletePersonalTranscription,
  listPersonalTranscriptions,
  listPersonalTranscriptionTags,
  readPersonalTranscription,
  stopPersonalTranscription,
  updatePersonalTranscriptionContent,
  updatePersonalTranscriptionMetadata,
  type PersonalTranscriptionDetail,
  type PersonalTranscriptionSummary,
} from "@/lib/live-personal-transcriptions";
import type { UiState } from "@/lib/ui-state";
import { openBoardxRealtimeAsr, type BoardxRealtimeAsrHandle } from "@/lib/BoardxRealtimeAsrClient";
import { LiveRecordingError } from "@/lib/live-recording";
import type { RealtimeAsrFinalEvent, RealtimeAsrStreamState } from "@/lib/realtime-asr.types";
import type { TranscriptionHistoryItem } from "@/lib/mock/realtime-transcriptions";
import { CreateTranscriptionDialog, type NewTranscriptionDraft } from "./create-transcription-dialog";
import { DeleteTranscriptionDialog } from "./delete-transcription-dialog";
import { EditTranscriptionDialog } from "./edit-transcription-dialog";
import { RealtimeTranscriptionWorkspace } from "./realtime-transcription-workspace";

type ActiveTag = string | undefined;

export function TranscriptionHistory({ uiState }: { uiState: UiState }) {
  const sessionContext = useOptionalSession();
  const sessionToken = sessionContext?.session?.sessionToken;
  const [items, setItems] = React.useState<readonly TranscriptionHistoryItem[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [operationError, setOperationError] = React.useState<string | null>(null);
  const [listRevision, setListRevision] = React.useState(0);
  const [activeTag, setActiveTag] = React.useState<ActiveTag>();
  const [tags, setTags] = React.useState<readonly string[]>([]);
  const [sort, setSort] = React.useState<HistorySort>("recent");
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
      ...(activeTag === undefined ? {} : { tag: activeTag }),
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
    setActiveTag((current) => current === undefined || result.tags.includes(current) ? current : undefined);
  }, [sessionToken]);

  React.useEffect(() => { void refreshTags().catch(() => setOperationError("TRANSCRIPTION_TAGS_FAILED")); }, [refreshTags]);

  async function createTranscription(draft: NewTranscriptionDraft) {
    setOperationError(null);
    const summary = await createPersonalTranscription({
      name: draft.name,
      tags: [...draft.tags],
    }, sessionToken);
    const created = toHistoryItem(summary);
    setItems((current) => [created, ...current]);
    setNotice(`已创建“${draft.name}”，正在进入实时转录`);
    setActiveSession({ ...summary, content: "" });
    await refreshTags().catch(() => setOperationError("TRANSCRIPTION_TAGS_FAILED"));
  }

  async function saveMetadata(item: TranscriptionHistoryItem, draft: NewTranscriptionDraft) {
    const updated = await updatePersonalTranscriptionMetadata(item.id, { name: draft.name, tags: [...draft.tags] }, sessionToken);
    setNotice(`已更新“${updated.name}”`);
    setListRevision((current) => current + 1);
    void refreshTags().catch(() => setOperationError("TRANSCRIPTION_TAGS_FAILED"));
  }

  async function removeTranscription(item: TranscriptionHistoryItem) {
    await deletePersonalTranscription(item.id, sessionToken);
    setItems((current) => current.filter((entry) => entry.id !== item.id));
    setNotice(`已永久删除“${item.title}”`);
    void refreshTags().catch(() => setOperationError("TRANSCRIPTION_TAGS_FAILED"));
  }

  async function stopLegacyTranscription(item: TranscriptionHistoryItem) {
    setOperationError(null);
    try {
      const updated = await stopPersonalTranscription(item.id, sessionToken);
      setItems((current) => current.map((entry) => entry.id === item.id ? toHistoryItem(updated) : entry));
      setNotice(`已结束“${item.title}”的遗留转录状态`);
    } catch (error) {
      setOperationError(error instanceof Error ? error.message : "TRANSCRIPTION_STOP_FAILED");
    }
  }

  async function openTranscription(item: TranscriptionHistoryItem) {
    setOperationError(null);
    try {
      setActiveSession(await readPersonalTranscription(item.id, sessionToken));
    } catch (error) {
      setOperationError(error instanceof Error ? error.message : "TRANSCRIPTION_READ_FAILED");
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
    const sessionId = activeSession?.sessionId;
    if (!handle && activeSession?.status === "recording") {
      setStreamError(null);
      setStreamState("stopping");
      try {
        const updated = await stopPersonalTranscription(activeSession.sessionId, sessionToken);
        setActiveSession((current) => current ? { ...current, ...updated } : current);
        setListRevision((current) => current + 1);
        setStreamState("idle");
      } catch {
        setStreamState("error");
        setStreamError("无法结束遗留转录状态，请稍后重试。");
      }
      return;
    }
    if (!handle || !sessionId) return;
    setStreamError(null);
    setStreamState("stopping");
    try {
      await handle.stop();
      setInterimSegment("");
      setActiveSession(await readPersonalTranscription(sessionId, sessionToken));
      setListRevision((current) => current + 1);
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
      setListRevision((current) => current + 1);
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
        <StudioHistoryHeader business="转录" description="跨项目的全部历史转录。打开任意一条以查看内容、总结与洞察。" count={items.length} countTestId="rec-history-count" createTestId="rec-create-open" onCreate={() => setCreateOpen(true)} />
        <StudioHistoryFilters business="转录" prefix="rec-history" tags={tags} selectedTag={activeTag} onTagChange={setActiveTag} query={query} onQueryChange={setQuery} sort={sort} onSortChange={setSort} />

        {notice && <p data-testid="saved" className="rounded-md bg-success px-3 py-2 text-12 text-success-foreground">{notice}</p>}
        {(loadError || operationError) && <p role="alert" data-testid="rec-history-api-error" className="rounded-md border border-destructive px-3 py-2 text-12 text-destructive">{loadError ? "历史转录读取失败，请稍后重试。" : "操作失败，请重试。已加载的转录仍可继续使用。"}</p>}
        <HistoryState
          uiState={loadError ? "dep-failed" : loading && uiState === "default" ? "loading" : uiState}
          items={sort === "recent" ? items : [...items].reverse()}
          filtered={activeTag !== undefined || !!query.trim()}
          onCreate={() => setCreateOpen(true)}
          onOpen={(item) => void openTranscription(item)}
          onEdit={setEditItem}
          onStop={(item) => void stopLegacyTranscription(item)}
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
  event: RealtimeAsrFinalEvent,
): PersonalTranscriptionDetail | null {
  if (!current) return null;
  return { ...current, content: [current.content, event.text].filter(Boolean).join(" ") };
}

function streamErrorText(reason: string): string {
  const messages: Record<string, string> = {
    ASR_NOT_CONFIGURED: "当前环境尚未配置阿里云实时转录，请联系管理员配置服务后重试。",
    QUOTA_EXCEEDED: "当前实时转录额度不足。",
    AUDIO_FORMAT_REJECTED: "麦克风音频格式不受支持，请刷新页面后重试。",
    CAPTURE_ALREADY_ACTIVE: "这条转录已有正在进行的录音，请重新打开后继续。",
    TICKET_EXPIRED: "连接凭证已过期，请重新点击开始转录。",
    ASR_PROVIDER_UNAVAILABLE: "阿里云实时转录暂时不可用，请稍后重试。",
    CONNECTION_FAILED: "无法连接实时转录服务，请检查网络后重试。",
  };
  return messages[reason] ?? "无法启动实时转录，请稍后重试。";
}

function HistoryState({
  uiState, items, filtered, onCreate, onOpen, onEdit, onStop, onDelete,
}: {
  uiState: UiState;
  filtered: boolean;
  items: readonly TranscriptionHistoryItem[];
  onCreate: () => void;
  onOpen: (item: TranscriptionHistoryItem) => void;
  onEdit: (item: TranscriptionHistoryItem) => void;
  onStop: (item: TranscriptionHistoryItem) => void;
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
        <div><p className="text-14 font-medium">{filtered ? "没有符合条件的转录" : "还没有转录"}</p><p className="mt-1 text-12 text-muted-foreground">{filtered ? "请调整标签或搜索条件。" : "创建一次新的实时转录，名称和标签会保存在这里。"}</p></div>
        <Button variant="primary" onClick={onCreate}><Plus aria-hidden className="h-4 w-4" />新建转录</Button>
      </div>
    );
  }
  return (
    <div data-testid="rec-history-grid" className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
      {items.map((item) => <HistoryCard key={item.id} item={item} onOpen={onOpen} onEdit={onEdit} onStop={onStop} onDelete={onDelete} />)}
      <StudioHistoryCreateCard business="转录" testId="rec-create-card" onCreate={onCreate} />
    </div>
  );
}

function HistoryCard({
  item,
  onOpen, onEdit, onStop, onDelete,
}: {
  item: TranscriptionHistoryItem;
  onOpen: (item: TranscriptionHistoryItem) => void;
  onEdit: (item: TranscriptionHistoryItem) => void;
  onStop: (item: TranscriptionHistoryItem) => void;
  onDelete: (item: TranscriptionHistoryItem) => void;
}) {
  return (
    <StudioHistoryCard testId={`rec-history-card-${item.id}`} title={item.title}
      status={<Badge tone={item.status === "recording" ? "warning" : item.status === "failed" ? "danger" : "neutral"}>{item.status === "recording" ? "转录中" : item.status === "failed" ? "失败" : item.duration === "00:00" ? "待开始" : "可续录"}</Badge>}
      description={<>{item.project} · {item.owner}<br />{item.summary}</>} tags={item.tags}
      metadata={<><span>{item.duration}</span><time>{item.updatedAt}</time></>}
      primaryAction={<Button data-testid={`rec-history-open-${item.id}`} size="sm" variant="primary" onClick={() => onOpen(item)}>进入转录</Button>}
      management={
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild><Button data-testid={`rec-history-more-${item.id}`} size="icon" variant="ghost" aria-label={`${item.title} 更多操作`}><MoreVertical aria-hidden className="h-4 w-4" /></Button></DropdownMenu.Trigger>
          <DropdownMenu.Portal><DropdownMenu.Content align="end" className="z-50 min-w-32 rounded-md border border-border bg-card p-1 shadow-md">
            {item.status === "recording" && <DropdownMenu.Item data-testid={`rec-history-stop-${item.id}`} className="flex cursor-pointer items-center gap-2 rounded px-3 py-2 text-12 transition-colors hover:bg-muted focus:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onSelect={() => onStop(item)}><Square className="h-4 w-4" aria-hidden />结束转录</DropdownMenu.Item>}
            <DropdownMenu.Item data-testid={`rec-history-edit-${item.id}`} className="flex cursor-pointer items-center gap-2 rounded px-3 py-2 text-12 transition-colors hover:bg-muted focus:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onSelect={() => onEdit(item)}><Pencil className="h-4 w-4" aria-hidden />修改</DropdownMenu.Item>
            <DropdownMenu.Item data-testid={`rec-history-delete-${item.id}`} className="flex cursor-pointer items-center gap-2 rounded px-3 py-2 text-12 text-destructive transition-colors hover:bg-muted focus:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onSelect={() => onDelete(item)}><Trash2 className="h-4 w-4" aria-hidden />删除</DropdownMenu.Item>
          </DropdownMenu.Content></DropdownMenu.Portal>
        </DropdownMenu.Root>
      }
    />
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
