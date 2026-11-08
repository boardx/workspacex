"use client";
import { RESOURCE_GRID_CLASS, RESOURCE_PAGE_CLASS } from "@/components/ui/resource-card";

import * as React from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { Clock3, MoreHorizontal, Pencil, Square, Trash2 } from "lucide-react";
import { WorkflowActionButton } from "@/components/research-studio/research-workflow-actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { StudioHistoryHeader, StudioHistoryFilters, StudioHistoryCard, type HistorySort } from "@/components/studio/studio-history";
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
import { RealtimeReconnect, isRetryableTranscriptionError, transcriptionFailureReason } from "@/lib/realtime-reconnect";
import type { RealtimeAsrFinalEvent, RealtimeAsrStreamState } from "@/lib/realtime-asr.types";
import type { RealtimeAsrFlowState } from "@/lib/realtime-asr-flow";
import { useAudioInputDevices } from "@/lib/use-audio-input-devices";
import type { TranscriptionHistoryItem } from "@/lib/mock/realtime-transcriptions";
import { CreateTranscriptionDialog, type NewTranscriptionDraft } from "./create-transcription-dialog";
import { DeleteTranscriptionDialog } from "./delete-transcription-dialog";
import { EditTranscriptionDialog } from "./edit-transcription-dialog";
import { RealtimeTranscriptionWorkspace } from "./realtime-transcription-workspace";
import { ProjectBreadcrumb } from "@/components/project/project-breadcrumb";
import { linkProjectResource } from "@/lib/live-project-resources";

import { useI18n } from "@/lib/i18n/provider";
import type { MessageKey } from "@/lib/i18n/messages";

type ActiveTag = string | undefined;

/**
 * 项目中枢 B2-S2 的三个可选入参：
 * - `projectId`：从项目「研究洞察 › 录音转写」带 `?projectId=` 进来；新建成功后 `linkProjectResource`
 *   挂回项目，顶部挂「返回项目」面包屑。
 * - `initialCreateOpen`：`?create=1` 直接打开新建弹窗（项目页「在本项目中新建」）。
 * - `initialSessionId`：`?session=<id>` 直达某条转写（项目页资源列表链过来）——转写没有独立详情路由，
 *   这里在挂载后按 id 读取并进入工作区。
 */
export function TranscriptionHistory({ uiState, projectId = null, initialCreateOpen = false, initialSessionId = null }: {
  uiState: UiState; projectId?: string | null; initialCreateOpen?: boolean; initialSessionId?: string | null;
}) {
  const { t } = useI18n();
  const sessionContext = useOptionalSession();
  /**
   * #1057 —— bearer 只有一条来源：真实 SessionProvider 的会话。
   *
   * 这里此前落到 `undefined`，而 `apiRequest` 把 `undefined` 定义为"调用方没表态"，
   * 于是回落去读 `localStorage` 的 `wsx.sessionToken`（见 `api-client.ts` 的
   * `opts.sessionToken !== undefined ? … : getStoredSessionToken()`）。结果是：真实会话
   * 已经没有身份了，这一屏仍然带着上一位用户留下的陈旧 token 去问 API——页面看起来是
   * 登录态，直到 `POST /recording/realtime-asr/sessions` 才报一个通用错误。
   *
   * `?? null` 把"没有会话"表达成显式的**不带 bearer**（fail-closed），与全仓其他真实
   * 会话消费点一致（`chat-read-screen` / `copilotkit-v2-shell` / `rail-notifications`
   * 都是 `session?.sessionToken ?? null`）。同一事实不得有第二处来源。
   */
  const sessionToken = sessionContext?.session?.sessionToken ?? null;
  const [items, setItems] = React.useState<readonly TranscriptionHistoryItem[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [operationError, setOperationError] = React.useState<string | null>(null);
  const [listRevision, setListRevision] = React.useState(0);
  const [activeTag, setActiveTag] = React.useState<ActiveTag>();
  const [tags, setTags] = React.useState<readonly string[]>([]);
  const [sort, setSort] = React.useState<HistorySort>("recent");
  const [query, setQuery] = React.useState("");
  const historyRef = React.useRef<HTMLElement>(null);
  const focusSearch = () => historyRef.current?.querySelector<HTMLInputElement>('[data-testid="rec-history-search"]')?.focus();
  const [createOpen, setCreateOpen] = React.useState(initialCreateOpen);
  const createOpener = React.useRef<HTMLButtonElement | null>(null);
  const openCreate: React.MouseEventHandler<HTMLButtonElement> = (event) => {
    createOpener.current = event.currentTarget;
    setCreateOpen(true);
  };
  const [editItem, setEditItem] = React.useState<TranscriptionHistoryItem | null>(null);
  const [deleteItem, setDeleteItem] = React.useState<TranscriptionHistoryItem | null>(null);
  const [notice, setNotice] = React.useState<{ key: MessageKey; name: string } | null>(null);
  const [activeSession, setActiveSession] = React.useState<PersonalTranscriptionDetail | null>(null);
  const [streamState, setStreamState] = React.useState<RealtimeAsrStreamState>("idle");
  const [flowState, setFlowState] = React.useState<RealtimeAsrFlowState>("normal");
  const [interimSegment, setInterimSegment] = React.useState("");
  const [streamError, setStreamError] = React.useState<MessageKey | null>(null);
  const [reconnectableError, setReconnectableError] = React.useState(false);
  const [reconnecting, setReconnecting] = React.useState(false);
  const [connectionNotice, setConnectionNotice] = React.useState<MessageKey | null>(null);
  const [inputLevel, setInputLevel] = React.useState(0);
  const micDevices = useAudioInputDevices();
  const streamRef = React.useRef<BoardxRealtimeAsrHandle | null>(null);
  const stoppingRef = React.useRef(false);
  const receivedFinalIdsRef = React.useRef(new Set<string>());
  const generationRef = React.useRef(0);
  const openingRef = React.useRef(false);
  const mountedRef = React.useRef(true);
  const abortRef = React.useRef<AbortController | null>(null);
  const restartRef = React.useRef<() => void>(() => undefined);
  const retryRef = React.useRef<RealtimeReconnect | null>(null);
  if (!retryRef.current) retryRef.current = new RealtimeReconnect(
    () => restartRef.current(),
    () => { setReconnecting(false); setReconnectableError(true); },
  );

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
    if (projectId) {
      try {
        await linkProjectResource({ projectId, kind: "personal_transcription", resourceId: summary.sessionId });
      } catch {
        setOperationError("PROJECT_LINK_FAILED");
      }
    }
    setNotice({ key: "rec.notice.created", name: draft.name });
    setActiveSession({ ...summary, content: "" });
    await refreshTags().catch(() => setOperationError("TRANSCRIPTION_TAGS_FAILED"));
  }

  async function saveMetadata(item: TranscriptionHistoryItem, draft: NewTranscriptionDraft) {
    const updated = await updatePersonalTranscriptionMetadata(item.id, { name: draft.name, tags: [...draft.tags] }, sessionToken);
    setNotice({ key: "rec.notice.updated", name: updated.name });
    setListRevision((current) => current + 1);
    void refreshTags().catch(() => setOperationError("TRANSCRIPTION_TAGS_FAILED"));
  }

  async function removeTranscription(item: TranscriptionHistoryItem) {
    await deletePersonalTranscription(item.id, sessionToken);
    setItems((current) => current.filter((entry) => entry.id !== item.id));
    setNotice({ key: "rec.notice.deleted", name: item.title });
    void refreshTags().catch(() => setOperationError("TRANSCRIPTION_TAGS_FAILED"));
  }

  async function stopLegacyTranscription(item: TranscriptionHistoryItem) {
    setOperationError(null);
    try {
      const updated = await stopPersonalTranscription(item.id, sessionToken);
      setItems((current) => current.map((entry) => entry.id === item.id ? toHistoryItem(updated) : entry));
      setNotice({ key: "rec.notice.stopped", name: item.title });
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

  async function startRealtimeTranscription(automatic = false) {
    if (!activeSession || streamRef.current || stoppingRef.current || openingRef.current) return;
    const recovering = automatic || reconnectableError;
    if (!automatic) { retryRef.current!.begin(); if (!recovering) setConnectionNotice(null); }
    const generation = ++generationRef.current;
    const current = () => generation === generationRef.current;
    const abort = new AbortController();
    abortRef.current = abort;
    openingRef.current = true;
    let failed = false;
    let retryableFailure = false;
    const reportFailure = (reason: string, message = streamErrorKey(reason)) => {
      if (!current() || failed || stoppingRef.current) return;
      failed = true;
      setInputLevel(0);
      setStreamState("error");
      streamRef.current = null;
      const retryable = isRetryableTranscriptionError(reason);
      retryableFailure = retryable;
      setStreamError(message);
      setReconnecting(retryable);
      if (retryable) setConnectionNotice("rec.error.interrupted");
      if (!openingRef.current) retryRef.current!.failed(retryable);
    };
    setStreamError(null);
    setReconnectableError(false);
    setInterimSegment("");
    setFlowState("normal");
    setInputLevel(0);
    receivedFinalIdsRef.current.clear();
    setStreamState("connecting");
    try {
      if (recovering) {
        const saved = await readPersonalTranscription(activeSession.sessionId, sessionToken, abort.signal);
        if (!current()) return;
        setActiveSession(saved);
      }
      const handle = await openBoardxRealtimeAsr(activeSession.sessionId, {
        sessionToken,
        signal: abort.signal,
        deviceId: micDevices.selectedDeviceId ?? undefined,
        handlers: {
          onState: (state) => {
            if (!current() || failed) return;
            setStreamState(stoppingRef.current && state === "idle" ? "stopping" : state);
            if (state === "recording") { setReconnecting(false); setStreamError(null); retryRef.current!.connected(); }
          },
          onInterim: (text) => { if (current() && !failed) setInterimSegment(text); },
          onFinal: (event) => {
            if (!current() || failed) return;
            if (receivedFinalIdsRef.current.has(event.segmentId)) return;
            receivedFinalIdsRef.current.add(event.segmentId);
            setInterimSegment("");
            setActiveSession((current) => appendFinalEvent(current, event));
          },
          onLevel: (level) => { if (current() && !failed) setInputLevel(level); },
          onFlow: (event) => { if (current() && !failed) setFlowState(event.state); },
          onError: reportFailure,
        },
      });
      if (!current() || failed) { void handle.stop().catch(() => undefined); return; }
      streamRef.current = handle;
    } catch (error) {
      const reason = transcriptionFailureReason(error);
      reportFailure(reason, streamErrorKey(error instanceof LiveRecordingError ? error.kind : reason));
    } finally {
      openingRef.current = false;
      if (current()) {
        if (failed) retryRef.current!.failed(retryableFailure);
      } else if (mountedRef.current && stoppingRef.current) {
        stoppingRef.current = false;
        setStreamState("idle");
      }
    }
  }
  restartRef.current = () => void startRealtimeTranscription(true);

  async function stopRealtimeTranscription() {
    retryRef.current!.cancel();
    setReconnecting(false);
    if (openingRef.current) {
      ++generationRef.current;
      abortRef.current?.abort();
      stoppingRef.current = true;
      setStreamState("stopping");
      setStreamError(null);
      return;
    }
    const handle = streamRef.current;
    const sessionId = activeSession?.sessionId;
    if (!handle && activeSession?.status === "recording") {
      setStreamError(null);
      setReconnectableError(false);
      setStreamState("stopping");
      try {
        const updated = await stopPersonalTranscription(activeSession.sessionId, sessionToken);
        setActiveSession((current) => current ? { ...current, ...updated } : current);
        setListRevision((current) => current + 1);
        setStreamState("idle");
      } catch {
        setStreamState("error");
        setStreamError("rec.error.legacyStop");
      }
      return;
    }
    if (!handle || !sessionId || stoppingRef.current) {
      setStreamState("idle");
      setStreamError(null);
      return;
    }
    stoppingRef.current = true;
    setStreamError(null);
    setReconnectableError(false);
    setStreamState("stopping");
    setInputLevel(0);
    try {
      await handle.stop();
    } catch (error) {
      setStreamState("error");
      setStreamError(error instanceof Error && error.message === "FINISH_TIMEOUT"
        ? "rec.error.finishTimeout"
        : "rec.error.stopInterrupted");
      streamRef.current = null;
      stoppingRef.current = false;
      return;
    }
    // A completed ASR handshake already confirms persistence. A failed GET must
    // not turn that successful stop into a failed transcription.
    setInterimSegment("");
    setActiveSession((current) => current?.sessionId === sessionId ? { ...current, status: "idle" } : current);
    try {
      let updated: PersonalTranscriptionDetail | undefined;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          updated = await readPersonalTranscription(sessionId, sessionToken);
          break;
        } catch (error) {
          if (attempt === 2) throw error;
          await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
        }
      }
      if (updated) setActiveSession((current) => current?.sessionId === sessionId ? updated : current);
      setStreamError(null);
      setListRevision((current) => current + 1);
    } catch {
      setStreamError("rec.error.refresh");
    } finally {
      setStreamState("idle");
      streamRef.current = null;
      stoppingRef.current = false;
    }
  }

  async function saveContent(content: string) {
    if (!activeSession) return;
    setStreamError(null);
    try {
      setActiveSession(await updatePersonalTranscriptionContent(activeSession.sessionId, content, sessionToken));
      setListRevision((current) => current + 1);
    } catch {
      setStreamError("rec.workspace.saveFailed");
      throw new Error("TRANSCRIPTION_CONTENT_SAVE_FAILED");
    }
  }

  React.useEffect(() => {
    mountedRef.current = true;
    const generationCounter = generationRef;
    const online = () => retryRef.current!.online();
    window.addEventListener("online", online);
    return () => {
      window.removeEventListener("online", online);
      retryRef.current!.cancel();
      mountedRef.current = false;
      ++generationCounter.current;
      abortRef.current?.abort();
      void streamRef.current?.stop().catch(() => undefined);
    };
  }, []);

  // `?session=<id>` 直达：只在挂载时读一次；读不到就留在列表并如实报错。
  React.useEffect(() => {
    if (!initialSessionId) return;
    let active = true;
    readPersonalTranscription(initialSessionId, sessionToken)
      .then((detail) => { if (active) setActiveSession(detail); })
      .catch(() => { if (active) setOperationError("TRANSCRIPTION_READ_FAILED"); });
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 只按 URL 进入时的 id 读一次
  }, [initialSessionId]);

  if (activeSession) {
    return <RealtimeTranscriptionWorkspace session={activeSession} streamState={streamState}
      interimSegment={interimSegment} flowState={flowState} errorMessage={streamError ? t(streamError) : null} errorIdentity={streamError} reconnectableError={reconnectableError}
      reconnecting={reconnecting} connectionNotice={connectionNotice ? t(connectionNotice) : null}
      inputLevel={inputLevel} devices={micDevices.devices} selectedDeviceId={micDevices.selectedDeviceId}
      onSelectDevice={micDevices.select}
      onStart={() => void startRealtimeTranscription()} onStop={() => void stopRealtimeTranscription()}
      onReconnect={() => void startRealtimeTranscription()}
      onSaveContent={saveContent}
      onRename={async (name) => {
        const updated = await updatePersonalTranscriptionMetadata(activeSession.sessionId,
          { name, tags: [...activeSession.tags] }, sessionToken);
        setActiveSession((current) => current?.sessionId === updated.sessionId ? { ...current, name: updated.name, tags: updated.tags } : current);
        setListRevision((current) => current + 1);
      }}
      onBack={() => {
        if (streamRef.current || stoppingRef.current) return;
        retryRef.current!.cancel();
        ++generationRef.current;
        abortRef.current?.abort();
        setReconnecting(false);
        setStreamState("idle");
        setStreamError(null);
        setConnectionNotice(null);
        setActiveSession(null);
      }} />;
  }

  return (
    <section ref={historyRef} data-testid="rec-history-page" className="min-h-full bg-background">
      <div className={`${RESOURCE_PAGE_CLASS} flex flex-col gap-4`}>
        <ProjectBreadcrumb projectId={projectId} sub="transcript" className="" />
        <StudioHistoryHeader business={t("rec.business")} title={t("rec.history.title")} description={t("rec.history.description")} count={items.length} countTestId="rec-history-count" createTestId="rec-create-open" onCreate={openCreate} />
        <StudioHistoryFilters business={t("rec.businessPlural")} prefix="rec-history" tags={tags} selectedTags={activeTag === undefined ? [] : [activeTag]} onTagsChange={(next) => setActiveTag(next[0])} tagMode="single" query={query} onQueryChange={setQuery} sort={sort} onSortChange={setSort} />

        {notice && <p data-testid="saved" className="rounded-md bg-success px-3 py-2 text-12 text-success-foreground">{t(notice.key, { name: notice.name })}</p>}
        {operationError && <p role="alert" data-testid="rec-history-api-error" className="rounded-md border border-destructive px-3 py-2 text-12 text-destructive">{t("rec.history.operationFailed")}</p>}
        <HistoryState
          uiState={loadError ? "dep-failed" : loading && uiState === "default" ? "loading" : uiState}
          items={sort === "recent" ? items : [...items].reverse()}
          filtered={activeTag !== undefined || !!query.trim()}
          onRetry={() => { setListRevision((current) => current + 1); focusSearch(); }}
          onClearFilters={() => { setQuery(""); setActiveTag(undefined); focusSearch(); }}
          onOpen={(item) => void openTranscription(item)}
          onEdit={setEditItem}
          onStop={(item) => void stopLegacyTranscription(item)}
          onDelete={setDeleteItem}
        />
      </div>

      <CreateTranscriptionDialog openerRef={createOpener} open={createOpen} onOpenChange={setCreateOpen} onCreate={createTranscription} knownTags={new Map(tags.map((t) => [t, 0] as const))} />
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

function streamErrorKey(reason: string): MessageKey {
  const messages: Readonly<Record<string, MessageKey>> = {
    "CREDIT_REQUIRED": "rec.error.CREDIT_REQUIRED",
    "CREDIT_ACCOUNTING_UNAVAILABLE": "rec.error.CREDIT_ACCOUNTING_UNAVAILABLE",
    "ASR_NOT_CONFIGURED": "rec.error.ASR_NOT_CONFIGURED",
    "QUOTA_EXCEEDED": "rec.error.QUOTA_EXCEEDED",
    "AUDIO_FORMAT_REJECTED": "rec.error.AUDIO_FORMAT_REJECTED",
    "CAPTURE_ALREADY_ACTIVE": "rec.error.CAPTURE_ALREADY_ACTIVE",
    "TICKET_EXPIRED": "rec.error.TICKET_EXPIRED",
    "ASR_PROVIDER_UNAVAILABLE": "rec.error.ASR_PROVIDER_UNAVAILABLE",
    "CONNECTION_FAILED": "rec.error.CONNECTION_FAILED",
    "permission-denied": "rec.error.permission-denied",
    "no-microphone": "rec.error.no-microphone",
    "capture-failed": "rec.error.capture-failed",
  };
  return Object.hasOwn(messages, reason) ? messages[reason]! : "rec.error.default";
}

function HistoryState({
  uiState, items, filtered, onRetry, onClearFilters, onOpen, onEdit, onStop, onDelete,
}: {
  uiState: UiState;
  filtered: boolean;
  onRetry: () => void;
  onClearFilters: () => void;
  items: readonly TranscriptionHistoryItem[];
  onOpen: (item: TranscriptionHistoryItem) => void;
  onEdit: (item: TranscriptionHistoryItem) => void;
  onStop: (item: TranscriptionHistoryItem) => void;
  onDelete: (item: TranscriptionHistoryItem) => void;
}) {
  const { t } = useI18n();
  if (uiState === "loading") {
    return (
      <div data-testid="loading" className={`${RESOURCE_GRID_CLASS} animate-pulse`}>
        {Array.from({ length: 8 }).map((_, index) => <div key={index} className="h-40 rounded-lg bg-muted" />)}
      </div>
    );
  }
  const errorState = uiState === "dep-failed" || uiState === "denied" || uiState === "invalid";
  const errorPanel = errorState ? (
    <div role="alert" data-testid="rec-history-error" className="flex flex-col items-start gap-3 rounded-lg border border-destructive bg-card p-4 text-13 text-destructive sm:flex-row sm:items-center sm:justify-between">
      <p>{t("rec.history.loadFailed")}</p>
      {uiState === "dep-failed" && <WorkflowActionButton variant="outline" onClick={onRetry}>{t("rec.history.reload")}</WorkflowActionButton>}
    </div>
  ) : null;
  if (errorState) return errorPanel;
  if (uiState === "empty" || items.length === 0) {
    return (
      <div data-testid="rec-history-empty" className="flex min-h-48 flex-col items-center justify-center gap-3 rounded-lg bg-card p-4 text-center">
        <Clock3 aria-hidden className="h-8 w-8 text-muted-foreground" />
        <div><p className="text-14 font-medium">{filtered ? t("rec.history.noMatch") : t("rec.history.empty")}</p><p className="mt-1 text-12 text-muted-foreground">{filtered ? t("rec.history.adjust") : t("rec.history.begin")}</p></div>
        {filtered ? <WorkflowActionButton variant="outline" onClick={onClearFilters}>{t("rec.history.clear")}</WorkflowActionButton> : null}
      </div>
    );
  }
  return (
    <div data-testid="rec-history-grid" className={RESOURCE_GRID_CLASS}>
      {items.map((item) => <HistoryCard key={item.id} item={item} onOpen={onOpen} onEdit={onEdit} onStop={onStop} onDelete={onDelete} />)}
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
  const { t, locale } = useI18n();
  return (
    <StudioHistoryCard testId={`rec-history-card-${item.id}`} title={item.title}
      status={<Badge tone={item.status === "recording" ? "warning" : item.status === "failed" ? "danger" : "neutral"}>{item.status === "recording" ? t("rec.history.recording") : item.status === "failed" ? t("rec.history.failed") : item.duration === "00:00" ? t("rec.history.pending") : t("rec.history.resume")}</Badge>}
      description={t("rec.history.personal")} tags={item.tags}
      metadata={<><span>{item.duration}</span><time dateTime={item.updatedAt}>{new Intl.DateTimeFormat(locale, { year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(item.updatedAt))}</time></>}
      primaryAction={<WorkflowActionButton data-testid={`rec-history-open-${item.id}`} variant="primary" onClick={() => onOpen(item)}>{t("rec.history.open")}</WorkflowActionButton>}
      management={
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild><Button data-testid={`rec-history-more-${item.id}`} size="icon" variant="ghost" aria-label={t("rec.history.more", { name: item.title })}><MoreHorizontal aria-hidden className="h-4 w-4" /></Button></DropdownMenu.Trigger>
          <DropdownMenu.Portal><DropdownMenu.Content align="end" className="z-50 min-w-32 rounded-md border border-border bg-card p-1 shadow-md">
            {item.status === "recording" && <DropdownMenu.Item data-testid={`rec-history-stop-${item.id}`} className="flex cursor-pointer items-center gap-2 rounded px-3 py-2 text-12 transition-colors hover:bg-muted focus:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onSelect={() => onStop(item)}><Square className="h-4 w-4" aria-hidden />{t("rec.history.stop")}</DropdownMenu.Item>}
            <DropdownMenu.Item data-testid={`rec-history-edit-${item.id}`} className="flex cursor-pointer items-center gap-2 rounded px-3 py-2 text-12 transition-colors hover:bg-muted focus:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onSelect={() => onEdit(item)}><Pencil className="h-4 w-4" aria-hidden />{t("rec.history.edit")}</DropdownMenu.Item>
            <DropdownMenu.Item data-testid={`rec-history-delete-${item.id}`} className="flex cursor-pointer items-center gap-2 rounded px-3 py-2 text-12 text-destructive transition-colors hover:bg-muted focus:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onSelect={() => onDelete(item)}><Trash2 className="h-4 w-4" aria-hidden />{t("rec.history.delete")}</DropdownMenu.Item>
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
    updatedAt: item.updatedAt,
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
