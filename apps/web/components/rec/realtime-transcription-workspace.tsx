"use client";

import * as React from "react";
import { ArrowLeft, Check, Copy, Mic, Pencil, X } from "lucide-react";
import { personalRealtimeTranscription as C } from "@repo/contracts";
import type { z } from "zod";
import { Button } from "@/components/ui/button";
import { WorkflowActionButton, WorkflowActionBar } from "@/components/research-studio/research-workflow-actions";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { MicDevicePicker } from "@/components/chat/chat-composer-pickers";
import type { AudioInputDevice } from "@/lib/live-recording";
import type { RealtimeAsrStreamState } from "@/lib/realtime-asr.types";
import type { RealtimeAsrFlowState } from "@/lib/realtime-asr-flow";

type PersonalTranscriptionDetail = z.infer<typeof C.PersonalTranscriptionDetail>;

export function RealtimeTranscriptionWorkspace({
  session,
  onBack,
  streamState = "idle",
  interimSegment = "",
  flowState = "normal",
  errorMessage,
  reconnectableError = false,
  reconnecting = false,
  connectionNotice,
  onStart,
  onStop,
  onSaveContent,
  onRename,
  onReconnect,
  inputLevel = 0,
  devices = [],
  selectedDeviceId = null,
  onSelectDevice = () => undefined,
}: {
  session: PersonalTranscriptionDetail;
  onBack: () => void;
  streamState?: RealtimeAsrStreamState;
  interimSegment?: string;
  flowState?: RealtimeAsrFlowState;
  errorMessage?: string | null;
  reconnectableError?: boolean;
  reconnecting?: boolean;
  connectionNotice?: string | null;
  onStart: () => void;
  onStop: () => void;
  onSaveContent?: (content: string) => Promise<void>;
  onRename?: (name: string) => Promise<void>;
  onReconnect?: () => void;
  inputLevel?: number;
  devices?: readonly AudioInputDevice[];
  selectedDeviceId?: string | null;
  onSelectDevice?: (deviceId: string | null) => void;
}) {
  const recording = reconnecting || streamState === "recording" || streamState === "stopping" || session.status === "recording";
  const busy = streamState === "connecting" || streamState === "stopping";
  const [renaming, setRenaming] = React.useState(false);
  const [nameDraft, setNameDraft] = React.useState(session.name);
  const [nameError, setNameError] = React.useState<string | null>(null);
  const [savingName, setSavingName] = React.useState(false);
  const renamePending = React.useRef(false);
  const titleButtonRef = React.useRef<HTMLButtonElement>(null);
  const restoreTitleFocus = React.useRef(false);
  React.useEffect(() => {
    if (renaming || !restoreTitleFocus.current) return;
    restoreTitleFocus.current = false;
    const button = titleButtonRef.current;
    if (button?.isConnected && !button.disabled) button.focus();
  }, [renaming]);
  const beginRename = () => {
    if (!onRename || renamePending.current || recording || busy) return;
    restoreTitleFocus.current = true;
    setNameDraft(session.name); setNameError(null); setRenaming(true);
  };
  async function saveName() {
    const name = nameDraft.trim();
    if (!onRename || renamePending.current || recording || busy) return;
    if (!C.operations.updatePersonalTranscriptionMetadata.in.shape.name.safeParse(name).success) {
      setNameError("请输入有效的录音名称，或缩短名称后重试。"); return;
    }
    renamePending.current = true; setSavingName(true); setNameError(null);
    try { await onRename(name); setRenaming(false); }
    catch { setNameError("名称保存失败，请重试。"); }
    finally { renamePending.current = false; setSavingName(false); }
  }
  const [editing, setEditing] = React.useState(false);
  const editButtonRef = React.useRef<HTMLButtonElement>(null);
  const restoreEditFocus = React.useRef(false);
  const editSessionRef = React.useRef(session.sessionId);
  React.useEffect(() => {
    if (editing || !restoreEditFocus.current) return;
    if (editSessionRef.current !== session.sessionId) {
      restoreEditFocus.current = false;
      return;
    }
    const button = editButtonRef.current;
    if (!button?.isConnected) return;
    if (button.disabled) {
      // User navigation takes priority over a delayed restoration after recording.
      const cancelRestore = () => { restoreEditFocus.current = false; };
      document.addEventListener("focusin", cancelRestore);
      return () => document.removeEventListener("focusin", cancelRestore);
    }
    restoreEditFocus.current = false;
    if (document.activeElement === document.body || document.activeElement === button) button.focus();
  }, [editing, recording, busy, onSaveContent, session.sessionId]);
  const [draft, setDraft] = React.useState(session.content);
  const [saving, setSaving] = React.useState(false);
  const [saveError, setSaveError] = React.useState<string | null>(null);
  const [copied, setCopied] = React.useState(false);
  const [copyError, setCopyError] = React.useState<string | null>(null);
  const [copying, setCopying] = React.useState(false);
  const captureReturnBlocked = streamState === "recording" || streamState === "stopping";
  const returnBlocked = captureReturnBlocked || editing;
  const returnHint = captureReturnBlocked ? "停止转录并完成收尾后可返回历史。"
    : saving ? "正文正在保存，请稍候再返回历史。" : "保存或取消编辑后可返回历史。";
  const [errorDialogDismissed, setErrorDialogDismissed] = React.useState(false);
  React.useEffect(() => { if (!editing) setDraft(session.content); }, [editing, session.content]);
  React.useEffect(() => { if (errorMessage) setErrorDialogDismissed(false); }, [errorMessage]);
  const canStop = recording || streamState === "connecting";
  const visibleContent = [session.content, interimSegment].filter(Boolean).join(session.content && interimSegment ? " " : "");

  async function copyContent() {
    if (copying) return;
    setCopying(true);
    setCopied(false);
    setCopyError(null);
    try {
      await navigator.clipboard.writeText(visibleContent);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1_500);
    } catch {
      setCopyError("复制失败，请允许剪贴板访问后重试，或手动选择正文复制。");
    } finally {
      setCopying(false);
    }
  }

  async function saveContent() {
    if (!onSaveContent) return;
    setSaving(true);
    setSaveError(null);
    try {
      await onSaveContent(draft);
      setEditing(false);
    } catch {
      setSaveError("正文保存失败，请稍后重试。");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section data-testid="rec-live-workspace" className="min-h-full bg-background px-4 py-4 md:px-6">
      <div className="mx-auto flex w-full max-w-screen-xl flex-col gap-4 md:gap-6">
        <header className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="flex min-w-0 items-center gap-3 md:flex-1">
            <Button data-testid="rec-live-back" type="button" variant="ghost" size="icon" aria-label="返回历史转录" disabled={returnBlocked} aria-describedby={returnBlocked ? "rec-return-hint" : undefined} onClick={onBack}>
              <ArrowLeft aria-hidden className="h-4 w-4" />
            </Button>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                {renaming ? <div className="flex flex-wrap items-center gap-2">
                  <Input aria-label="录音名称" autoFocus maxLength={C.operations.updatePersonalTranscriptionMetadata.in.shape.name.maxLength ?? undefined} disabled={savingName}
                    value={nameDraft} onChange={(event) => setNameDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.nativeEvent.isComposing) return;
                      if (event.key === "Enter") { event.preventDefault(); void saveName(); }
                      if (event.key === "Escape" && !savingName) { setRenaming(false); setNameError(null); }
                    }} className="min-w-0 max-w-full text-20" />
                  <Button size="icon" variant="ghost" aria-label="保存录音名称" disabled={savingName} onClick={() => void saveName()}><Check aria-hidden className="h-4 w-4" /></Button>
                  <Button size="icon" variant="ghost" aria-label="取消修改名称" disabled={savingName} onClick={() => { setRenaming(false); setNameError(null); }}><X aria-hidden className="h-4 w-4" /></Button>
                  {nameError && <p role="alert" className="text-12 text-destructive">{nameError}</p>}
                </div> : <h1 data-testid="rec-live-title" onDoubleClick={beginRename} className="min-w-0 truncate text-24 font-semibold tracking-tight md:text-30">
                  {onRename ? <button ref={titleButtonRef} type="button" aria-label="修改录音名称" disabled={recording || busy}
                    title={recording || busy ? "停止转录后可修改录音名称" : "双击修改录音名称"}
                    className="max-w-full truncate rounded-sm text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); beginRename(); } }}>{session.name}</button> : session.name}
                </h1>}
              </div>
            </div>
          </div>
          <div className="flex w-full flex-wrap items-center gap-3 md:w-auto md:justify-end">
            <MicDevicePicker devices={devices} selectedDeviceId={selectedDeviceId}
              disabled={recording || busy} onSelect={onSelectDevice} testIdPrefix="rec" side="down" iconOnly />
            <div className="flex items-end gap-0.5" role="meter" aria-label="麦克风输入音量"
              aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(inputLevel * 100)}
              data-testid="rec-live-input-level">
              {([
                { threshold: 0.15, height: "h-2" },
                { threshold: 0.35, height: "h-3" },
                { threshold: 0.6, height: "h-4" },
                { threshold: 0.85, height: "h-5" },
              ] as const).map(({ threshold, height }) => (
                <span key={threshold} aria-hidden data-level-threshold={threshold}
                  className={`w-1 rounded-full transition-colors ${height} ${inputLevel >= threshold ? "bg-success" : "bg-muted"}`} />
              ))}
            </div>
            {(reconnecting || streamState === "connecting" || streamState === "stopping" || (recording && flowState === "slow")) && <span role="status" className="text-12 text-muted-foreground">
              {reconnecting ? "正在重连" : streamState === "connecting" ? "正在连接" : streamState === "stopping" ? "正在收尾" : "音频仍在传输或确认中"}
            </span>}
            <WorkflowActionButton
              data-testid="rec-live-toggle"
              className="w-full sm:ml-auto sm:w-auto"
              type="button"
              variant="primary"
              disabled={streamState === "stopping" || renaming || (editing && !canStop)}
              aria-describedby={editing && !canStop ? "rec-edit-capture-hint" : undefined}
              loading={streamState === "stopping"}
              onClick={canStop ? onStop : onStart}
            >
              {reconnecting ? "停止转录" : streamState === "connecting" ? "取消连接" : streamState === "stopping" ? "正在收尾" : recording ? "停止转录" : session.content ? "继续转录" : "开始转录"}
            </WorkflowActionButton>
          </div>
        </header>

        {editing && !canStop && <p id="rec-edit-capture-hint" className="text-12 text-muted-foreground">保存或取消正文编辑后可继续转录，避免覆盖正在修改的内容。</p>}
        {returnBlocked && <p id="rec-return-hint" className="text-12 text-muted-foreground">{returnHint}</p>}
        {copyError && <p role="alert" data-testid="rec-live-copy-error" className="rounded-md border border-destructive px-3 py-2 text-12 text-destructive">{copyError}</p>}
        {(errorMessage || saveError) && <p role="alert" data-testid="rec-live-error" className="rounded-md border border-destructive px-3 py-2 text-12 text-destructive">{errorMessage || saveError}</p>}
        {connectionNotice && <p role="status" className="text-12 text-muted-foreground">{connectionNotice}</p>}

        <Card className="min-h-64 p-4" data-testid="rec-live-transcript">
          <div className="border-b border-border pb-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0"><h2 className="text-16 font-semibold">实时逐字稿</h2><p data-testid="rec-live-reading-hint" className="mt-1 text-12 text-muted-foreground">{editing ? "编辑完成后保存修改，或取消以保留原文。" : recording || busy ? "正文可复制；停止转录并完成收尾后可编辑。" : "已保存的正文可复制和编辑；实时识别中的文字以浅色显示。"}</p></div>
              <div className={`grid w-full gap-2 sm:flex sm:w-auto sm:flex-wrap sm:items-center ${editing ? "grid-cols-1" : "grid-cols-2"}`}>
                <WorkflowActionButton data-testid="rec-live-copy" type="button" variant="outline"
                  disabled={!visibleContent} loading={copying} onClick={() => void copyContent()}>
                  {copied ? <Check aria-hidden className="h-4 w-4" /> : <Copy aria-hidden className="h-4 w-4" />}
                  {copied ? "已复制" : "复制全文"}
                </WorkflowActionButton>
                {!editing && <WorkflowActionButton ref={editButtonRef} data-testid="rec-live-edit" type="button" variant="outline"
                  disabled={recording || busy || !onSaveContent} onClick={() => { editSessionRef.current = session.sessionId; restoreEditFocus.current = true; setSaveError(null); setDraft(session.content); setEditing(true); }}>
                  <Pencil aria-hidden className="h-4 w-4" />编辑
                </WorkflowActionButton>}
              </div>
            </div>
          </div>

          {editing ? (
            <div className="mt-4">
              <Textarea autoFocus aria-label="逐字稿正文" data-testid="rec-live-editor" value={draft} onChange={(event) => setDraft(event.target.value)}
                className="min-h-72 w-full resize-y text-14 leading-8" />
              <WorkflowActionBar placement="footer">
                <WorkflowActionButton type="button" variant="outline" disabled={saving} onClick={() => { setSaveError(null); setEditing(false); }}>
                  <X aria-hidden className="h-4 w-4" />取消
                </WorkflowActionButton>
                <WorkflowActionButton data-testid="rec-live-save" type="button" variant="primary" disabled={saving} loading={saving}
                  onClick={() => void saveContent()}>{saving ? "保存中" : "保存修改"}</WorkflowActionButton>
              </WorkflowActionBar>
            </div>
          ) : visibleContent ? (
            <div className="mt-4 rounded-lg bg-card p-1">
              <p data-testid="rec-live-content" className="mx-auto max-w-prose whitespace-pre-wrap break-words text-14 leading-8 [overflow-wrap:anywhere]">{session.content}
                {session.content && interimSegment ? " " : ""}
                {interimSegment && <span data-testid="rec-live-interim" className="text-muted-foreground">{interimSegment}</span>}
              </p>
            </div>
          ) : (
            <div className="flex min-h-40 flex-col items-center justify-center gap-4 text-center">
              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
                <Mic aria-hidden className="h-5 w-5" />
              </span>
              <div>
                <p className="text-14 font-medium">{recording ? "正在等待识别结果" : "还没有逐字稿"}</p>
              </div>
            </div>
          )}
        </Card>
      </div>
      <Dialog open={reconnectableError && Boolean(errorMessage) && !errorDialogDismissed} onOpenChange={(open) => { if (!open) setErrorDialogDismissed(true); }}>
        <DialogContent data-testid="rec-live-reconnect-dialog" className="max-w-md">
          <DialogTitle>实时转录连接异常</DialogTitle>
          <DialogDescription>已保存的正文不会丢失。你可以重新连接后继续转录。</DialogDescription>
          <WorkflowActionBar placement="footer">
            <WorkflowActionButton type="button" variant="outline" onClick={() => setErrorDialogDismissed(true)}>暂不处理</WorkflowActionButton>
            <WorkflowActionButton data-testid="rec-live-reconnect" type="button" variant="primary" disabled={!onReconnect}
              onClick={() => { setErrorDialogDismissed(true); onReconnect?.(); }}>重新连接</WorkflowActionButton>
          </WorkflowActionBar>
        </DialogContent>
      </Dialog>
    </section>
  );
}
