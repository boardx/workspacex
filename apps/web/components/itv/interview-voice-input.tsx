"use client";
import * as React from "react";
import { Mic, Square, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAsrDraft, appendTranscript } from "@/lib/use-asr-draft";
import { useComposerVoiceSession } from "@/lib/use-composer-voice-session";

/** ASR preview is transient; only an explicit finish/recovery appends to the parent's source. */
export function InterviewVoiceInput({ sessionToken, onAppend, onBusyChange, disabled = false, readOnly = false }: {
  readonly sessionToken: string;
  readonly onAppend: (text: string) => void;
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
  const busyCallback = React.useRef(onBusyChange); busyCallback.current = onBusyChange;
  React.useEffect(() => { busyCallback.current?.(active); }, [active]);
  React.useEffect(() => () => { busyCallback.current?.(false); }, []);
  React.useEffect(() => {
    if (voice.phase !== "done" || intent.current !== "finish" || speech.status !== "idle") return;
    intent.current = null;
    if (finalText.trim()) onAppend(finalText);
    setDraft(""); voice.dismiss();
  }, [voice.phase, speech.status, finalText, onAppend, voice]);
  const recoverable = !recovered && (speech.status === "error" || voice.phase === "done") && Boolean(finalText.trim());
  return <div data-testid="itv-voice-input" className="space-y-3">
    <div className="flex flex-wrap items-center gap-2">
      {!active && <Button variant="outline" disabled={disabled || readOnly || !sessionToken} onClick={() => { intent.current = null; draftRef.current = ""; setDraft(""); setRecovered(false); voice.dismiss(); voice.start(); }}><Mic className="size-4" aria-hidden />语音输入</Button>}
      {(voice.phase === "listening" || voice.phase === "paused") && <Button variant="outline" onClick={() => { intent.current = "finish"; voice.finish(); }}><Square className="size-4" aria-hidden />停止并追加文字</Button>}
      {active && <Button variant="ghost" disabled={voice.phase === "stopping"} onClick={() => { intent.current = "cancel"; voice.discard(); }}><X className="size-4" aria-hidden />取消语音输入</Button>}
      <span role="status" className="text-xs text-muted-foreground">{voice.phase === "connecting" ? "正在连接语音识别…" : voice.phase === "listening" ? `正在录音 · ${voice.totalSeconds} 秒` : voice.phase === "stopping" ? "正在停止，等待最终文字…" : voice.phase === "paused" ? "静音后已暂停，可停止并追加已确认文字" : "停录后追加文字；原始音频不保存。"}</span>
    </div>
    {active && <div aria-label="语音转录预览" className="rounded-lg bg-muted/40 p-3 text-sm leading-6"><span>{finalText}</span><span className="text-muted-foreground">{speech.partialText}</span></div>}
    {speech.error && <p role="alert" className="text-sm text-destructive">{speech.error} 当前研究原文保留。</p>}
    {recoverable && <div className="rounded-lg bg-muted/40 p-3"><p className="whitespace-pre-wrap text-sm text-foreground">{finalText}</p><Button className="mt-2" variant="outline" disabled={readOnly || disabled} onClick={() => { intent.current = null; setRecovered(true); onAppend(finalText); setDraft(""); voice.dismiss(); }}>保留已确认转录</Button></div>}
  </div>;
}
