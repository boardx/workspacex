"use client";
import * as React from "react";
import { listMessages, type ListMessagesOut } from "@/lib/live-chat";
import { aidtUiStageSummary, type AidtUiStageDraft } from "./aidt-ui-drafts";
import {
  AidtPersonalCheckpointError, loadAidtPersonalStageCheckpoints, saveAidtPersonalStageCheckpoint,
  type AidtPersonalStageCheckpoint, type AidtPersonalStageHead, type AidtPersonalStageLoadResult,
  type AidtPersonalStageScope,
} from "./aidt-stage-persistence";

export type AidtCheckpointLoadState = { key: string; phase: "loading" | "ready" | "error"; result: AidtPersonalStageLoadResult; error: string | null };
export type AidtCheckpointSaveState = { key: string; phase: "idle" | "saving" | "saved" | "error" | "conflict"; checkpoint?: AidtPersonalStageCheckpoint; error?: string; signature?: string };
const EMPTY_RESULT: AidtPersonalStageLoadResult = { checkpoints: [], heads: [] };
export function aidtCheckpointKey(value: AidtPersonalStageHead): string { return JSON.stringify([value.artifactId, value.immutableRevision]); }
function draftSignature(value: AidtUiStageDraft): string {
  return JSON.stringify(value, function (_key, item: unknown) {
    return item && typeof item === "object" && !Array.isArray(item) ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item;
  });
}
function failureText(error: unknown, action: "load" | "save"): string {
  return error instanceof AidtPersonalCheckpointError ? error.message : action === "load" ? "个人检查点读取失败。本页草稿仍保留，请重试。" : "尚未确认保存成功。本页草稿仍保留，可以重试或重新读取检查点。";
}

/** Personal checkpoints only. Background reads never replace the student's current form. */
export function useAidtPersonalCheckpoints({ enabled, scope, lifecycleKey, threadId, stageId, draft, canWrite, onRestore }: {
  enabled: boolean; scope: AidtPersonalStageScope | null; lifecycleKey: string; threadId: string | null;
  stageId: number | null; draft: AidtUiStageDraft | null; canWrite: boolean; onRestore: (draft: AidtUiStageDraft) => void;
}) {
  const scopeKey = JSON.stringify([enabled, lifecycleKey, scope, threadId, stageId, canWrite]);
  const lifecycle = React.useRef({ scopeKey, generation: 0 });
  if (lifecycle.current.scopeKey !== scopeKey) lifecycle.current = { scopeKey, generation: lifecycle.current.generation + 1 };
  const key = JSON.stringify([scopeKey, lifecycle.current.generation]);
  const readyToRead = enabled && Boolean(scope && threadId && stageId);
  const currentKey = React.useRef(key); currentKey.current = key;
  const writable = React.useRef(canWrite); writable.current = canWrite;
  const [load, setLoad] = React.useState<AidtCheckpointLoadState | null>(null);
  const [save, setSave] = React.useState<AidtCheckpointSaveState | null>(null);
  const [source, setSource] = React.useState<{ key: string; messages: ListMessagesOut["messages"]; nextCursor: string | null; loading: boolean; error: string | null } | null>(null);
  const [selectedMessage, setSelectedMessage] = React.useState<{ key: string; id: string } | null>(null);
  const [baseChoice, setBaseChoice] = React.useState<{ key: string; value: string } | null>(null);
  const [review, setReview] = React.useState<string | null>(null);
  const [refresh, setRefresh] = React.useState(0);
  const attempt = React.useRef<{ key: string; signature: string; operationId: string } | null>(null);
  const inFlight = React.useRef<{ key: string; operationId: string; cancellation: AbortController } | null>(null);
  const currentLoad = load?.key === key ? load : null;
  const currentSave: AidtCheckpointSaveState = save?.key === key ? save : { key, phase: "idle" };
  const currentSource = source?.key === key ? source : null;
  const messageId = selectedMessage?.key === key ? selectedMessage.id : "";
  const heads = currentLoad?.result.heads ?? [];
  const needsBaseChoice = heads.length > 1 || review === key;
  const chosenHead = baseChoice?.key === key ? heads.find(head => aidtCheckpointKey(head) === baseChoice.value) : undefined;
  const baseHead = needsBaseChoice ? chosenHead : heads[0];
  const signature = draft ? draftSignature(draft) : "";
  const hasContent = Boolean(draft && stageId && aidtUiStageSummary(stageId, draft));
  const canSave = readyToRead && canWrite && hasContent && heads.length <= 1 && currentLoad?.phase === "ready" && currentSave.phase !== "saving" && Boolean(messageId && currentSource?.messages.some(message => message.id === messageId && message.authorKind === "human")) && (!needsBaseChoice || Boolean(baseHead));

  React.useEffect(() => {
    if (!readyToRead || !scope || !threadId || !stageId) return;
    const capturedScope = { ...scope }, cancellation = new AbortController();
    let active = true;
    setLoad({ key, phase: "loading", result: EMPTY_RESULT, error: null });
    setSource({ key, messages: [], nextCursor: null, loading: true, error: null });
    setSelectedMessage(null); setBaseChoice(null);
    void loadAidtPersonalStageCheckpoints(capturedScope, { threadId, stageId, signal: cancellation.signal }).then(async result => {
      if (!active || currentKey.current !== key) return;
      setLoad({ key, phase: "ready", result, error: null });
      // The checkpoint adapter validates thread/project ownership before any source text is loaded.
      if (!writable.current) { setSource({ key, messages: [], nextCursor: null, loading: false, error: null }); return; }
      try {
        const messages = await listMessages(threadId, { limit: 30 }, capturedScope.sessionToken);
        if (active && currentKey.current === key) setSource({ key, messages: messages.messages, nextCursor: messages.nextCursor, loading: false, error: null });
      } catch { if (active && currentKey.current === key) setSource({ key, messages: [], nextCursor: null, loading: false, error: "聊天来源读取失败，未把失败当作没有消息。请刷新后重试。" }); }
    }).catch(error => {
      if (active && currentKey.current === key) {
        setLoad({ key, phase: "error", result: EMPTY_RESULT, error: failureText(error, "load") });
        setSource({ key, messages: [], nextCursor: null, loading: false, error: null });
      }
    });
    return () => { active = false; cancellation.abort(); };
    // key captures every actor/project/token/stage/thread boundary; callers may create an equal DTO each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, refresh, readyToRead]);
  React.useEffect(() => () => {
    if (inFlight.current?.key === key) inFlight.current.cancellation.abort();
  }, [key]);

  function selectMessage(id: string) { if (currentKey.current === key) setSelectedMessage({ key, id }); }
  function selectHead(value: string) { if (currentKey.current === key) setBaseChoice({ key, value }); }
  function reload() { if (currentKey.current === key && currentSave.phase !== "saving") setRefresh(value => value + 1); }
  async function moreSources() {
    if (!scope || !threadId || !currentSource?.nextCursor || currentSource.loading) return;
    const cursor = currentSource.nextCursor, token = scope.sessionToken;
    setSource({ ...currentSource, loading: true, error: null });
    try {
      const page = await listMessages(threadId, { cursor, limit: 30 }, token);
      if (currentKey.current !== key) return;
      setSource(previous => previous?.key === key ? { key, loading: false, error: null, nextCursor: page.nextCursor, messages: Array.from(new Map([...previous.messages, ...page.messages].map(message => [message.id, message])).values()) } : previous);
    } catch { if (currentKey.current === key) setSource(previous => previous?.key === key ? { ...previous, loading: false, error: "更多聊天来源读取失败，已读取的来源与本页草稿仍保留。" } : previous); }
  }
  async function saveCurrent() {
    if (currentKey.current !== key || !writable.current || !canSave || !scope || !threadId || !stageId || !draft || inFlight.current?.key === key) return;
    const capturedScope = { ...scope }, snapshot = JSON.parse(JSON.stringify(draft)) as AidtUiStageDraft;
    const expectedHead = baseHead ? { artifactId: baseHead.artifactId, immutableRevision: baseHead.immutableRevision } : null;
    const inputSignature = JSON.stringify([threadId, stageId, messageId, expectedHead, signature]);
    if (attempt.current?.key !== key || attempt.current.signature !== inputSignature) attempt.current = { key, signature: inputSignature, operationId: crypto.randomUUID() };
    const operationId = attempt.current.operationId, cancellation = new AbortController();
    inFlight.current = { key, operationId, cancellation };
    setSave({ key, phase: "saving", signature });
    try {
      const checkpoint = await saveAidtPersonalStageCheckpoint(capturedScope, { threadId, stageId, messageId, draft: snapshot, expectedHead, operationId, readOnly: !canWrite, signal: cancellation.signal });
      if (currentKey.current !== key || !writable.current || cancellation.signal.aborted) return;
      setSave({ key, phase: "saved", checkpoint, signature });
      setLoad(previous => ({ key, phase: "ready", error: null, result: { checkpoints: [...(previous?.key === key ? previous.result.checkpoints.filter(item => item.artifactId !== checkpoint.artifactId) : []), checkpoint], heads: [checkpoint] } }));
      setBaseChoice({ key, value: aidtCheckpointKey(checkpoint) }); setReview(null);
    } catch (error: unknown) {
      if (currentKey.current !== key || cancellation.signal.aborted) return;
      if (error instanceof AidtPersonalCheckpointError && error.code === "AIDT_PERSONAL_CHECKPOINT_CONFLICT") {
        setReview(key); setBaseChoice(null);
        setSave({ key, phase: "conflict", checkpoint: error.checkpoint, error: failureText(error, "save"), signature });
        setLoad(previous => ({ key, phase: "ready", error: null, result: { heads: [...error.heads], checkpoints: Array.from(new Map([...(previous?.key === key ? previous.result.checkpoints : []), ...error.heads, ...(error.checkpoint ? [error.checkpoint] : [])].map(item => [aidtCheckpointKey(item), item])).values()) } }));
      } else setSave({ key, phase: "error", error: failureText(error, "save"), signature });
    } finally {
      if (inFlight.current?.key === key && inFlight.current.operationId === operationId) inFlight.current = null;
    }
  }
  function restore(checkpoint: AidtPersonalStageCheckpoint) {
    if (currentKey.current !== key || !writable.current || !currentLoad?.result.checkpoints.some(item => aidtCheckpointKey(item) === aidtCheckpointKey(checkpoint))) return;
    onRestore(JSON.parse(JSON.stringify(checkpoint.draft)) as AidtUiStageDraft);
  }
  return { key, readyToRead, load: currentLoad, save: currentSave, sources: currentSource, messageId, selectMessage, selectHead, needsBaseChoice, baseHead, canSave, hasContent, signature, savedCurrentDraft: currentSave.phase === "saved" && currentSave.signature === signature, reload, moreSources, saveCurrent, restore };
}
