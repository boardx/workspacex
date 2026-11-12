"use client";

import * as React from "react";
import { useI18n } from "@/lib/i18n/provider";
import type { MessageKey } from "@/lib/i18n/messages";
import { ArrowLeft, Check, Copy, Mic, Pencil, X } from "lucide-react";
import { personalRealtimeTranscription as C } from "@repo/contracts";
import type { z } from "zod";
import { Button } from "@/components/ui/button";
import { WorkflowActionButton, WorkflowActionBar } from "@/components/research-studio/research-workflow-actions";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { LocalMicrophoneCheck } from "./local-microphone-check";
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
  errorIdentity,
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
  errorIdentity?: string | null;
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
  const { t } = useI18n();
  const recording = reconnecting || streamState === "recording" || streamState === "stopping" || session.status === "recording";
  const busy = streamState === "connecting" || streamState === "stopping";
  const [checkingMic, setCheckingMic] = React.useState(false);
  React.useEffect(() => { if (recording || busy) setCheckingMic(false); }, [recording, busy]);
  const selectedDevice = devices.find((device) => device.deviceId === selectedDeviceId);
  const inputDeviceName = selectedDeviceId === null
    ? devices.find((device) => device.deviceId === "default")?.label || t("rec.micCheck.defaultUnknown")
    : selectedDevice?.label || t("rec.micCheck.unknown");
  const [renaming, setRenaming] = React.useState(false);
  const [nameDraft, setNameDraft] = React.useState(session.name);
  const [nameError, setNameError] = React.useState<MessageKey | null>(null);
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
      setNameError("rec.workspace.invalidName"); return;
    }
    renamePending.current = true; setSavingName(true); setNameError(null);
    try { await onRename(name); setRenaming(false); }
    catch { setNameError("rec.workspace.nameFailed"); }
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
  const [saveError, setSaveError] = React.useState<MessageKey | null>(null);
  const [copied, setCopied] = React.useState(false);
  const [copyError, setCopyError] = React.useState<MessageKey | null>(null);
  const [copying, setCopying] = React.useState(false);
  const captureReturnBlocked = streamState === "recording" || streamState === "stopping";
  const returnBlocked = captureReturnBlocked || editing;
  const returnHint = captureReturnBlocked ? t("rec.workspace.stopBeforeBack")
    : saving ? t("rec.workspace.savingBeforeBack") : t("rec.workspace.editBeforeBack");
  const [errorDialogDismissed, setErrorDialogDismissed] = React.useState(false);
  React.useEffect(() => { if (!editing) setDraft(session.content); }, [editing, session.content]);
  const errorDialogIdentity = errorIdentity ?? errorMessage;
  React.useEffect(() => { if (errorDialogIdentity) setErrorDialogDismissed(false); }, [errorDialogIdentity]);
  const canStop = recording || streamState === "connecting";
  const visibleContent = [session.content, interimSegment].filter(Boolean).join(session.content && interimSegment ? " " : "");
  const transcriptScrollRef = React.useRef<HTMLDivElement>(null);
  const followTranscript = streamState === "recording" || streamState === "stopping";
  React.useEffect(() => {
    const body = transcriptScrollRef.current;
    if (followTranscript && body) body.scrollTop = body.scrollHeight;
  }, [followTranscript, visibleContent, session.sessionId]);

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
      setCopyError("rec.workspace.copyFailed");
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
      setSaveError("rec.workspace.saveFailed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section data-testid="rec-live-workspace" className="min-h-full bg-background px-4 py-4 md:px-6">
      <div className="mx-auto flex w-full max-w-screen-xl flex-col gap-4 md:gap-6">
        <header className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="flex min-w-0 items-center gap-3 md:flex-1">
            <Button data-testid="rec-live-back" type="button" variant="ghost" size="icon" aria-label={t("rec.workspace.back")} disabled={returnBlocked} aria-describedby={returnBlocked ? "rec-return-hint" : undefined} onClick={onBack}>
              <ArrowLeft aria-hidden className="h-4 w-4" />
            </Button>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                {renaming ? <div className="flex flex-wrap items-center gap-2">
                  <Input aria-label={t("rec.workspace.name")} autoFocus maxLength={C.operations.updatePersonalTranscriptionMetadata.in.shape.name.maxLength ?? undefined} disabled={savingName}
                    value={nameDraft} onChange={(event) => setNameDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.nativeEvent.isComposing) return;
                      if (event.key === "Enter") { event.preventDefault(); void saveName(); }
                      if (event.key === "Escape" && !savingName) { setRenaming(false); setNameError(null); }
                    }} className="min-w-0 max-w-full text-20" />
                  <Button size="icon" variant="ghost" aria-label={t("rec.workspace.saveName")} disabled={savingName} onClick={() => void saveName()}><Check aria-hidden className="h-4 w-4" /></Button>
                  <Button size="icon" variant="ghost" aria-label={t("rec.workspace.cancelName")} disabled={savingName} onClick={() => { setRenaming(false); setNameError(null); }}><X aria-hidden className="h-4 w-4" /></Button>
                  {nameError && <p role="alert" className="text-12 text-destructive">{t(nameError)}</p>}
                </div> : <h1 data-testid="rec-live-title" onDoubleClick={beginRename} className="min-w-0 truncate text-24 font-semibold tracking-tight md:text-30">
                  {onRename ? <button ref={titleButtonRef} type="button" aria-label={t("rec.workspace.rename")} disabled={recording || busy}
                    title={recording || busy ? t("rec.workspace.stopBeforeRename") : t("rec.workspace.doubleRename")}
                    className="max-w-full truncate rounded-sm text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); beginRename(); } }}>{session.name}</button> : session.name}
                </h1>}
              </div>
            </div>
          </div>
          <div className="flex w-full flex-wrap items-center gap-3 md:w-auto md:justify-end">
            <MicDevicePicker devices={devices} selectedDeviceId={selectedDeviceId}
              disabled={recording || busy} onSelect={onSelectDevice} testIdPrefix="rec" side="down" />
            <p data-testid="rec-input-device-name" className="w-full break-words text-12 text-muted-foreground">{t("rec.micCheck.device", { name: inputDeviceName })}</p>
            <Button type="button" size="sm" variant="outline" disabled={recording || busy || checkingMic} onClick={() => setCheckingMic(true)}>{t("rec.micCheck.open")}</Button>
            <div className="flex items-end gap-0.5" role="meter" aria-label={t("rec.workspace.level")}
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
              {reconnecting ? t("rec.workspace.reconnecting") : streamState === "connecting" ? t("rec.workspace.connecting") : streamState === "stopping" ? t("rec.workspace.stopping") : t("rec.workspace.slow")}
            </span>}
            <WorkflowActionButton
              data-testid="rec-live-toggle"
              className="w-full sm:ml-auto sm:w-auto"
              type="button"
              variant="primary"
              disabled={streamState === "stopping" || renaming || checkingMic || (editing && !canStop)}
              aria-describedby={editing && !canStop ? "rec-edit-capture-hint" : undefined}
              loading={streamState === "stopping"}
              onClick={canStop ? onStop : onStart}
            >
              {reconnecting ? t("rec.workspace.stop") : streamState === "connecting" ? t("rec.workspace.cancelConnection") : streamState === "stopping" ? t("rec.workspace.stopping") : recording ? t("rec.workspace.stop") : session.content ? t("rec.workspace.resume") : t("rec.workspace.start")}
            </WorkflowActionButton>
          </div>
        </header>

        {checkingMic && !recording && !busy && <LocalMicrophoneCheck key={session.sessionId} deviceId={selectedDeviceId} onClose={() => setCheckingMic(false)} />}

        {editing && !canStop && <p id="rec-edit-capture-hint" className="text-12 text-muted-foreground">{t("rec.workspace.editCaptureHint")}</p>}
        {returnBlocked && <p id="rec-return-hint" className="text-12 text-muted-foreground">{returnHint}</p>}
        {copyError && <p role="alert" data-testid="rec-live-copy-error" className="rounded-md border border-destructive px-3 py-2 text-12 text-destructive">{t(copyError)}</p>}
        {(errorMessage || saveError) && <p role="alert" data-testid="rec-live-error" className="rounded-md border border-destructive px-3 py-2 text-12 text-destructive">{errorMessage || (saveError ? t(saveError) : null)}</p>}
        {connectionNotice && <p role="status" className="text-12 text-muted-foreground">{connectionNotice}</p>}

        <Card className="min-h-64 p-4" data-testid="rec-live-transcript">
          <div className="border-b border-border pb-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0"><h2 className="text-16 font-semibold">{t("rec.workspace.transcript")}</h2><p data-testid="rec-live-reading-hint" className="mt-1 text-12 text-muted-foreground">{editing ? t("rec.workspace.editHint") : recording || busy ? t("rec.workspace.recordingHint") : visibleContent ? t("rec.workspace.savedHint") : t("rec.workspace.emptyHint")}</p></div>
              <div className={`grid w-full gap-2 sm:flex sm:w-auto sm:flex-wrap sm:items-center ${editing ? "grid-cols-1" : "grid-cols-2"}`}>
                <WorkflowActionButton data-testid="rec-live-copy" type="button" variant="outline"
                  disabled={!visibleContent} loading={copying} onClick={() => void copyContent()}>
                  {copied ? <Check aria-hidden className="h-4 w-4" /> : <Copy aria-hidden className="h-4 w-4" />}
                  {copied ? t("rec.workspace.copied") : t("rec.workspace.copy")}
                </WorkflowActionButton>
                {!editing && <WorkflowActionButton ref={editButtonRef} data-testid="rec-live-edit" type="button" variant="outline"
                  disabled={recording || busy || !onSaveContent} onClick={() => { editSessionRef.current = session.sessionId; restoreEditFocus.current = true; setSaveError(null); setDraft(session.content); setEditing(true); }}>
                  <Pencil aria-hidden className="h-4 w-4" />{t("rec.workspace.edit")}
                </WorkflowActionButton>}
              </div>
            </div>
          </div>

          {editing ? (
            <div className="mt-4">
              <Textarea autoFocus aria-label={t("rec.workspace.content")} data-testid="rec-live-editor" value={draft} onChange={(event) => setDraft(event.target.value)}
                className="min-h-72 w-full resize-y text-14 leading-8" />
              <WorkflowActionBar placement="footer">
                <WorkflowActionButton type="button" variant="outline" disabled={saving} onClick={() => { setSaveError(null); setEditing(false); }}>
                  <X aria-hidden className="h-4 w-4" />{t("common.cancel")}
                </WorkflowActionButton>
                <WorkflowActionButton data-testid="rec-live-save" type="button" variant="primary" disabled={saving} loading={saving}
                  onClick={() => void saveContent()}>{saving ? t("rec.workspace.saving") : t("studio.save")}</WorkflowActionButton>
              </WorkflowActionBar>
            </div>
          ) : visibleContent ? (
            <div ref={transcriptScrollRef} data-testid="rec-live-scroll" role="region"
              aria-label={t("rec.workspace.transcript")} tabIndex={0}
              className="mt-4 max-h-[55dvh] min-w-0 overflow-y-auto rounded-lg bg-card p-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <p data-testid="rec-live-content" className="w-full whitespace-pre-wrap text-left break-words text-14 leading-8 [overflow-wrap:anywhere]">{session.content}
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
                <p className="text-14 font-medium">{recording ? t("rec.workspace.waiting") : t("rec.workspace.empty")}</p>
              </div>
            </div>
          )}
        </Card>
      </div>
      <Dialog open={reconnectableError && Boolean(errorMessage) && !errorDialogDismissed} onOpenChange={(open) => { if (!open) setErrorDialogDismissed(true); }}>
        <DialogContent data-testid="rec-live-reconnect-dialog" className="max-w-md">
          <DialogTitle>{t("rec.workspace.connectionError")}</DialogTitle>
          <DialogDescription>{t("rec.workspace.reconnectHint")}</DialogDescription>
          <WorkflowActionBar placement="footer">
            <WorkflowActionButton type="button" variant="outline" onClick={() => setErrorDialogDismissed(true)}>{t("rec.workspace.dismiss")}</WorkflowActionButton>
            <WorkflowActionButton data-testid="rec-live-reconnect" type="button" variant="primary" disabled={!onReconnect}
              onClick={() => { setErrorDialogDismissed(true); onReconnect?.(); }}>{t("rec.workspace.reconnect")}</WorkflowActionButton>
          </WorkflowActionBar>
        </DialogContent>
      </Dialog>
    </section>
  );
}
