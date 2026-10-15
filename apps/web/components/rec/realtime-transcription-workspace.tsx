"use client";

import * as React from "react";
import { ArrowLeft, Check, Copy, Mic, Pencil, X } from "lucide-react";
import { personalRealtimeTranscription as C } from "@repo/contracts";
import type { z } from "zod";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "@/components/ui/dialog";
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
  const [renaming, setRenaming] = React.useState(false);
  const [nameDraft, setNameDraft] = React.useState(session.name);
  const [nameError, setNameError] = React.useState<string | null>(null);
  const [savingName, setSavingName] = React.useState(false);
  const renamePending = React.useRef(false);
  const beginRename = () => {
    if (!onRename || renamePending.current || recording || busy) return;
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
  const [draft, setDraft] = React.useState(session.content);
  const [saving, setSaving] = React.useState(false);
  const [copied, setCopied] = React.useState(false);
  const [errorDialogDismissed, setErrorDialogDismissed] = React.useState(false);
  React.useEffect(() => { if (!editing) setDraft(session.content); }, [editing, session.content]);
  React.useEffect(() => { if (errorMessage) setErrorDialogDismissed(false); }, [errorMessage]);
  const recording = reconnecting || streamState === "recording" || streamState === "stopping" || session.status === "recording";
  const busy = streamState === "connecting" || streamState === "stopping";
  const canStop = recording || streamState === "connecting";
  const visibleContent = [session.content, interimSegment].filter(Boolean).join(session.content && interimSegment ? " " : "");

  async function copyContent() {
    await navigator.clipboard.writeText(visibleContent);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1_500);
  }

  async function saveContent() {
    if (!onSaveContent) return;
    setSaving(true);
    try {
      await onSaveContent(draft);
      setEditing(false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <section data-testid="rec-live-workspace" className="min-h-full bg-background px-4 py-6 md:px-8 lg:px-10">
      <div className="mx-auto flex w-full max-w-screen-xl flex-col gap-6">
        <header className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="flex min-w-0 items-center gap-3 md:flex-1">
            <Button data-testid="rec-live-back" type="button" variant="ghost" size="icon" aria-label="返回历史转录" onClick={onBack}>
              <ArrowLeft aria-hidden className="h-4 w-4" />
            </Button>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                {renaming ? <div className="flex flex-wrap items-center gap-2">
                  <input aria-label="录音名称" autoFocus maxLength={C.operations.updatePersonalTranscriptionMetadata.in.shape.name.maxLength ?? undefined} disabled={savingName}
                    value={nameDraft} onChange={(event) => setNameDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.nativeEvent.isComposing) return;
                      if (event.key === "Enter") { event.preventDefault(); void saveName(); }
                      if (event.key === "Escape" && !savingName) { setRenaming(false); setNameError(null); }
                    }} className="min-w-0 max-w-full rounded-md border border-input bg-background px-2 py-1 text-20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
                  <Button size="icon" variant="ghost" aria-label="保存录音名称" disabled={savingName} onClick={() => void saveName()}><Check aria-hidden className="h-4 w-4" /></Button>
                  <Button size="icon" variant="ghost" aria-label="取消修改名称" disabled={savingName} onClick={() => { setRenaming(false); setNameError(null); }}><X aria-hidden className="h-4 w-4" /></Button>
                  {nameError && <p role="alert" className="text-12 text-destructive">{nameError}</p>}
                </div> : <h1 data-testid="rec-live-title" onDoubleClick={beginRename} className="truncate text-24 font-semibold tracking-tight">
                  {onRename ? <button type="button" aria-label="修改录音名称" disabled={recording || busy}
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
            <Button
              data-testid="rec-live-toggle"
              size="lg"
              className="ml-auto min-w-28"
              type="button"
              variant={canStop ? "destructive" : "primary"}
              disabled={streamState === "stopping" || renaming}
              onClick={canStop ? onStop : onStart}
            >
              {reconnecting ? "停止转录" : streamState === "connecting" ? "取消连接" : streamState === "stopping" ? "正在收尾" : recording ? "停止转录" : session.content ? "继续转录" : "开始转录"}
            </Button>
          </div>
        </header>

        {errorMessage && <p role="alert" data-testid="rec-live-error" className="rounded-md border border-destructive px-3 py-2 text-12 text-destructive">{errorMessage}</p>}
        {connectionNotice && <p role="status" className="text-12 text-muted-foreground">{connectionNotice}</p>}

        <Card className="min-h-96 p-4 sm:p-6" data-testid="rec-live-transcript">
          <div className="border-b border-border pb-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-16 font-semibold">实时逐字稿</h2>
              <div className="flex items-center gap-2">
                <Button data-testid="rec-live-copy" type="button" size="md" variant="outline"
                  disabled={!visibleContent} onClick={() => void copyContent()}>
                  {copied ? <Check aria-hidden className="h-4 w-4" /> : <Copy aria-hidden className="h-4 w-4" />}
                  {copied ? "已复制" : "复制全文"}
                </Button>
                {!editing && <Button data-testid="rec-live-edit" type="button" size="md" variant="outline"
                  disabled={recording || busy || !onSaveContent} onClick={() => { setDraft(session.content); setEditing(true); }}>
                  <Pencil aria-hidden className="h-4 w-4" />编辑
                </Button>}
              </div>
            </div>
          </div>

          {editing ? (
            <div className="mt-5">
              <textarea data-testid="rec-live-editor" value={draft} onChange={(event) => setDraft(event.target.value)}
                className="min-h-72 w-full resize-y rounded-lg border border-border bg-background p-4 text-13 leading-7 outline-none focus-visible:ring-2 focus-visible:ring-ring" />
              <div className="mt-3 flex justify-end gap-2">
                <Button type="button" variant="outline" disabled={saving} onClick={() => setEditing(false)}>
                  <X aria-hidden className="h-4 w-4" />取消
                </Button>
                <Button data-testid="rec-live-save" type="button" variant="primary" disabled={saving}
                  onClick={() => void saveContent()}>{saving ? "保存中" : "保存修改"}</Button>
              </div>
            </div>
          ) : visibleContent ? (
            <div className="mt-5 rounded-lg bg-card p-1">
              <p data-testid="rec-live-content" className="whitespace-pre-wrap text-14 leading-8">{session.content}
                {session.content && interimSegment ? " " : ""}
                {interimSegment && <span data-testid="rec-live-interim" className="text-muted-foreground">{interimSegment}</span>}
              </p>
            </div>
          ) : (
            <div className="flex min-h-72 flex-col items-center justify-center gap-4 text-center">
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
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setErrorDialogDismissed(true)}>暂不处理</Button>
            <Button data-testid="rec-live-reconnect" type="button" variant="primary" disabled={!onReconnect}
              onClick={() => { setErrorDialogDismissed(true); onReconnect?.(); }}>重新连接</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
