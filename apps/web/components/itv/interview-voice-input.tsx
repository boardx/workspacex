"use client";
import * as React from "react";
import { useI18n } from "@/lib/i18n/provider";
import { Mic, Square, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAsrDraft, appendTranscript } from "@/lib/use-asr-draft";
import { useComposerVoiceSession } from "@/lib/use-composer-voice-session";

/** Show transient ASR text in the parent editor; only finish/recovery changes its source. */
export function InterviewVoiceInput({ sessionToken, onAppend, onPreview, onBusyChange, disabled = false, readOnly = false, compact = false }: {
  readonly sessionToken: string;
  readonly onAppend: (text: string) => void;
  readonly onPreview?: (text: string) => void;
  readonly onBusyChange?: (busy: boolean) => void;
  readonly disabled?: boolean;
  readonly readOnly?: boolean;
  readonly compact?: boolean;
}) {
  const { t, locale } = useI18n();
  const [draft, setDraft] = React.useState("");
  const [recovered, setRecovered] = React.useState(false);
  const draftRef = React.useRef(draft); draftRef.current = draft;
  const getDraft = React.useCallback(() => draftRef.current, []);
  const speech = useAsrDraft({ sessionToken, getBaseText: getDraft, onTranscript: setDraft, autoReconnect: true });
  const voice = useComposerVoiceSession(speech, { getDraft, setDraft });
  const intent = React.useRef<"finish" | "cancel" | null>(null);
  const finalText = appendTranscript(speech.baseText, speech.committedText);
  const active = ["connecting", "listening", "stopping", "paused"].includes(voice.phase);
  const recoverable = !recovered && (speech.status === "error" || (voice.phase === "done" && intent.current !== "finish")) && Boolean(finalText.trim());
  const preview = active ? appendTranscript(finalText, speech.partialText) : recoverable ? finalText : "";
  const busyCallback = React.useRef(onBusyChange); busyCallback.current = onBusyChange;
  const previewCallback = React.useRef(onPreview); previewCallback.current = onPreview;
  React.useEffect(() => { busyCallback.current?.(active || recoverable); }, [active, recoverable]);
  React.useEffect(() => { previewCallback.current?.(preview); }, [preview]);
  React.useEffect(() => () => { busyCallback.current?.(false); previewCallback.current?.(""); }, []);
  React.useEffect(() => {
    if (voice.phase !== "done" || intent.current !== "finish" || speech.status !== "idle") return;
    intent.current = null;
    previewCallback.current?.("");
    if (finalText.trim()) onAppend(finalText);
    setDraft(""); voice.dismiss();
  }, [voice.phase, speech.status, finalText, onAppend, voice]);
  return <div data-testid="itv-voice-input" className={compact ? "flex min-w-0 flex-wrap items-center gap-2" : "space-y-3"}>
    <div className="flex flex-wrap items-center gap-2">
      {!active && <Button variant="outline" disabled={disabled || readOnly || !sessionToken || recoverable} onClick={() => { intent.current = null; draftRef.current = ""; setDraft(""); setRecovered(false); voice.dismiss(); voice.start(); }}><Mic className="size-4" aria-hidden />{t("voice.input")}</Button>}
      {(voice.phase === "listening" || voice.phase === "paused" || speech.reconnecting) && <Button variant="outline" onClick={() => { intent.current = "finish"; voice.finish(); }}><Square className="size-4" aria-hidden />{t("voice.finish")}</Button>}
      {active && <Button variant="ghost" disabled={voice.phase === "stopping"} onClick={() => { intent.current = "cancel"; voice.discard(); }}><X className="size-4" aria-hidden />{t("voice.cancel")}</Button>}
      {active && <span role="status" className="text-xs text-muted-foreground">{speech.reconnecting ? t("voice.reconnecting") : voice.phase === "connecting" ? t("voice.connecting") : voice.phase === "listening" ? t("voice.listening", { seconds: voice.totalSeconds }) : voice.phase === "stopping" ? t("voice.stopping") : t("voice.paused")}</span>}
    </div>
    {speech.error && <p role="alert" className={compact ? "basis-full text-xs text-destructive" : "text-sm text-destructive"}>{speech.errorReason ? t(`voice.error.${speech.errorReason}`) : locale === "zh-CN" ? speech.error : t("voice.error.generic")}{!compact && t("voice.originalPreserved")}</p>}
    {speech.connectionInterrupted && <p className={compact ? "basis-full text-xs text-muted-foreground" : "text-xs text-muted-foreground"}>{t("voice.audioGap")}</p>}
    {speech.status === "error" && speech.errorReason === "ASR_PROVIDER_UNAVAILABLE" && !recovered && <Button variant="outline" disabled={disabled || readOnly || !sessionToken} onClick={() => { intent.current = null; voice.dismiss(); speech.retry?.(); }}>{t("voice.reconnect")}</Button>}
    {recoverable && <div className="flex flex-wrap gap-2"><Button variant="outline" disabled={readOnly || disabled} onClick={() => { intent.current = null; previewCallback.current?.(""); setRecovered(true); onAppend(finalText); setDraft(""); voice.dismiss(); }}>{t("voice.keep")}</Button><Button variant="ghost" onClick={() => { previewCallback.current?.(""); setRecovered(true); setDraft(""); voice.dismiss(); }}>{t("voice.discard")}</Button></div>}
  </div>;
}
