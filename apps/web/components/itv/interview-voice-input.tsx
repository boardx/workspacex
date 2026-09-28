"use client";
import * as React from "react";
import { Mic, Square, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAsrDraft, appendTranscript } from "@/lib/use-asr-draft";
import { useComposerVoiceSession } from "@/lib/use-composer-voice-session";

/** Show transient ASR text in the parent editor; only finish/recovery changes its source. */
export function InterviewVoiceInput({ sessionToken, onAppend, onPreview, onBusyChange, disabled = false, readOnly = false }: {
  readonly sessionToken: string;
  readonly onAppend: (text: string) => void;
  readonly onPreview?: (text: string) => void;
  readonly onBusyChange?: (busy: boolean) => void;
  readonly disabled?: boolean;
  readonly readOnly?: boolean;
}) {
  const [draft, setDraft] = React.useState("");
  const [recovered, setRecovered] = React.useState(false);
  const draftRef = React.useRef(draft); draftRef.current = draft;
  const getDraft = React.useCallback(() => draftRef.current, []);
  const speech = useAsrDraft({ sessionToken, getBaseText: getDraft, onTranscript: setDraft });
  const voice = useComposerVoiceSession(speech, { getDraft, setDraft });
  const intent = React.useRef<"finish" | "cancel" | null>(null);
  const finalText = appendTranscript(speech.baseText, speech.committedText);
  const active = ["connecting", "listening", "stopping", "paused"].includes(voice.phase);
  const recoverable = !recovered && (speech.status === "error" || voice.phase === "done") && Boolean(finalText.trim()) && intent.current !== "finish";
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
  return <div data-testid="itv-voice-input" className="space-y-3">
    <div className="flex flex-wrap items-center gap-2">
      {!active && <Button variant="outline" disabled={disabled || readOnly || !sessionToken || recoverable} onClick={() => { intent.current = null; draftRef.current = ""; setDraft(""); setRecovered(false); voice.dismiss(); voice.start(); }}><Mic className="size-4" aria-hidden />语音输入</Button>}
      {(voice.phase === "listening" || voice.phase === "paused") && <Button variant="outline" onClick={() => { intent.current = "finish"; voice.finish(); }}><Square className="size-4" aria-hidden />停止并追加文字</Button>}
      {active && <Button variant="ghost" disabled={voice.phase === "stopping"} onClick={() => { intent.current = "cancel"; voice.discard(); }}><X className="size-4" aria-hidden />取消语音输入</Button>}
      {active && <span role="status" className="text-xs text-muted-foreground">{voice.phase === "connecting" ? "正在连接…" : voice.phase === "listening" ? `正在录音 · ${voice.totalSeconds} 秒` : voice.phase === "stopping" ? "正在处理转写…" : "已暂停"}</span>}
    </div>
    {speech.error && <p role="alert" className="text-sm text-destructive">{speech.error} 当前研究原文保留。</p>}
    {recoverable && <div className="flex gap-2"><Button variant="outline" disabled={readOnly || disabled} onClick={() => { intent.current = null; previewCallback.current?.(""); setRecovered(true); onAppend(finalText); setDraft(""); voice.dismiss(); }}>保留已确认转录</Button><Button variant="ghost" onClick={() => { previewCallback.current?.(""); setRecovered(true); setDraft(""); voice.dismiss(); }}>丢弃转录</Button></div>}
  </div>;
}
