"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { pcmCheckWav } from "@/components/rec/use-local-microphone-check";
import { startCapture, TARGET_SAMPLE_RATE, type CaptureHandle } from "@/lib/live-recording";
import { openAsrDraftStream, type AsrDraftStreamHandle } from "@/lib/live-asr-draft";
import { readAidtResearchMaterial, uploadAidtResearchMaterial, type AidtMaterialReceipt, type AidtResearchMaterialReference } from "../lib/aidt-research-materials";

/** Keep browser PCM below the original-file ingestion limit, including its WAV header. */
const MAX_SAMPLES = (200 * 1024 * 1024 - 44) / 2;
const MAX_TRANSCRIPT_CHARS = 1700;

export type AidtRecordedInterview = {
  source: AidtResearchMaterialReference;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  draftTranscript: string;
  transcriptionStatus?: "complete" | "incomplete";
};

type Attempt = {
  abort: AbortController;
  handle?: CaptureHandle;
  asr?: Promise<AsrDraftStreamHandle | null>;
  listener?: (frame: Int16Array) => void;
  frames: Int16Array[];
  samples: number;
  startedAt: string;
  transcripts: { timeMs: number; text: string }[];
  asrFailed: boolean;
  stopping: boolean;
};

type Preview = {
  file: File;
  url: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  draftTranscript: string;
  transcriptionStatus?: AidtRecordedInterview["transcriptionStatus"];
  receipt?: AidtMaterialReceipt;
};

function elapsed(samples: number) { return Math.round(samples * 1000 / TARGET_SAMPLE_RATE); }
function timestamp(milliseconds: number) {
  const seconds = Math.floor(milliseconds / 1000);
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

export function AidtInterviewRecorder({ projectId, participantCode, sessionToken, disabled, asrAllowed, onAttached }: {
  projectId: string;
  participantCode: string;
  sessionToken: string;
  disabled: boolean;
  asrAllowed: boolean;
  onAttached: (recorded: AidtRecordedInterview) => void;
}) {
  const active = React.useRef<Attempt | null>(null);
  const saving = React.useRef<AbortController | null>(null);
  const url = React.useRef<string | null>(null);
  const mounted = React.useRef(false);
  const [phase, setPhase] = React.useState<"idle" | "starting" | "recording" | "stopping" | "saving">("idle");
  const [recordedSeconds, setRecordedSeconds] = React.useState(0);
  const [preview, setPreview] = React.useState<Preview | null>(null);
  const [asrSelected, setAsrSelected] = React.useState(false);
  const [message, setMessage] = React.useState("");
  const [liveTranscript, setLiveTranscript] = React.useState("");
  const [partialTranscript, setPartialTranscript] = React.useState("");
  const [asrInterrupted, setAsrInterrupted] = React.useState(false);

  const clear = React.useCallback(() => {
    if (url.current) URL.revokeObjectURL(url.current);
    url.current = null;
  }, []);

  React.useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      const attempt = active.current;
      active.current = null;
      attempt?.abort.abort();
      void attempt?.handle?.stop().catch(() => undefined);
      void attempt?.asr?.then(handle => handle?.stop()).catch(() => undefined);
      saving.current?.abort();
      clear();
    };
  }, [clear]);

  async function stop() {
    const attempt = active.current;
    if (!attempt || attempt.stopping || !attempt.handle) return;
    attempt.stopping = true;
    setPhase("stopping");
    const finishedAt = new Date().toISOString();
    await attempt.handle.stop().catch(() => undefined);
    attempt.abort.abort();
    if (attempt.asr) await attempt.asr.then(handle => handle?.stop()).catch(() => { attempt.asrFailed = true; });
    if (active.current !== attempt) return;
    active.current = null;
    setPhase("idle");
    if (!attempt.samples) {
      setMessage("没有获得可保存的录音，请检查麦克风并重试。");
      return;
    }
    const blob = pcmCheckWav(attempt.frames, attempt.samples);
    const file = new File([blob], `${participantCode}-${attempt.startedAt.replace(/[:.]/g, "-")}.wav`, { type: blob.type });
    clear();
    const previewUrl = URL.createObjectURL(file);
    url.current = previewUrl;
    const transcript = attempt.transcripts.map(part => `[${timestamp(part.timeMs)}] ${part.text}`).join("\n");
    const draftTranscript = transcript.length > MAX_TRANSCRIPT_CHARS
      ? transcript.slice(0, MAX_TRANSCRIPT_CHARS - 12) + "\n（摘录已截断）" : transcript;
    const transcriptionStatus = attempt.asr ? attempt.asrFailed || !attempt.transcripts.length ? "incomplete" : "complete" : undefined;
    setPreview({ file, url: previewUrl, startedAt: attempt.startedAt, finishedAt, durationMs: elapsed(attempt.samples), draftTranscript, transcriptionStatus });
    setMessage(transcriptionStatus === "incomplete" ? "转写服务未返回完整结果。请保存音频原件，之后可人工校对摘录。" : "录音已结束。保存后可在此访谈回听原件。");
  }

  async function start() {
    if (disabled || active.current || preview || saving.current) return;
    const attempt: Attempt = {
      abort: new AbortController(), frames: [], samples: 0, startedAt: "", transcripts: [], asrFailed: false, stopping: false,
    };
    active.current = attempt;
    setRecordedSeconds(0);
    setLiveTranscript("");
    setPartialTranscript("");
    setAsrInterrupted(false);
    setPhase("starting");
    setMessage("");
    try {
      const handle = await startCapture();
      if (active.current !== attempt) { await handle.stop(); return; }
      attempt.handle = handle;
      attempt.startedAt = new Date().toISOString();
      handle.onFrame(frame => {
        if (active.current !== attempt || attempt.stopping) return;
        const buffered = frame.slice(0, MAX_SAMPLES - attempt.samples);
        if (buffered.length) {
          attempt.frames.push(buffered);
          const previousSeconds = Math.floor(attempt.samples / TARGET_SAMPLE_RATE);
          attempt.samples += buffered.length;
          const seconds = Math.floor(attempt.samples / TARGET_SAMPLE_RATE);
          if (seconds !== previousSeconds) setRecordedSeconds(seconds);
          attempt.listener?.(buffered);
        }
        if (attempt.samples >= MAX_SAMPLES) void stop();
      });
      if (asrAllowed && asrSelected) {
        attempt.asr = openAsrDraftStream({
          onPartial: text => {
            if (active.current === attempt) setPartialTranscript(text.slice(0, MAX_TRANSCRIPT_CHARS));
          },
          onFinal: text => {
            if (active.current !== attempt) return;
            setPartialTranscript("");
            const size = attempt.transcripts.reduce((total, entry) => total + entry.text.length, 0);
            if (size <= MAX_TRANSCRIPT_CHARS) {
              const part = { timeMs: elapsed(attempt.samples), text: text.slice(0, MAX_TRANSCRIPT_CHARS + 1) };
              attempt.transcripts.push(part);
              setLiveTranscript(previous => `${previous}[${timestamp(part.timeMs)}] ${part.text}\n`.slice(0, MAX_TRANSCRIPT_CHARS));
            }
          },
          onError: () => {
            attempt.asrFailed = true;
            if (active.current === attempt) setAsrInterrupted(true);
          },
          onFinished: () => undefined,
        }, {
          sessionToken,
          signal: attempt.abort.signal,
          capture: async () => ({
            sourceSampleRate: handle.sourceSampleRate,
            onFrame: listener => { if (!attempt.stopping) attempt.listener = listener; },
            stop: async () => { attempt.listener = undefined; },
          }),
        }).catch(() => {
          attempt.asrFailed = true;
          if (active.current === attempt) setAsrInterrupted(true);
          return null;
        });
      }
      setPhase("recording");
    } catch {
      if (active.current !== attempt) return;
      active.current = null;
      setPhase("idle");
      setMessage("无法开始录音。请确认浏览器已获麦克风权限，且麦克风可用。");
    }
  }

  async function save() {
    if (disabled || saving.current || !preview) return;
    const controller = new AbortController();
    saving.current = controller;
    const context = { projectId, sessionToken, signal: controller.signal };
    setPhase("saving");
    try {
      const receipt = preview.receipt ?? await uploadAidtResearchMaterial(context, preview.file, "use-existing");
      controller.signal.throwIfAborted();
      setPreview({ ...preview, receipt });
      const { reference } = await readAidtResearchMaterial(context, receipt);
      controller.signal.throwIfAborted();
      if (reference.projectId !== projectId || reference.mime !== "audio/wav") throw new Error("AIDT_RECORDING_SCOPE_MISMATCH");
      onAttached({ source: reference, startedAt: preview.startedAt, finishedAt: preview.finishedAt, durationMs: preview.durationMs, draftTranscript: preview.draftTranscript, transcriptionStatus: preview.transcriptionStatus });
      clear();
      setPreview(null);
      setMessage("原件已上传并回读，访谈关联会自动保存。");
    } catch {
      if (mounted.current && !controller.signal.aborted) setMessage("录音保存或回读未通过。本页仍可回听原件，也可重试。");
    } finally {
      if (saving.current === controller) saving.current = null;
      if (mounted.current && !controller.signal.aborted) setPhase("idle");
    }
  }

  return <section className="min-w-0 space-y-3 rounded-lg border border-border bg-card p-3" aria-label="当前受访者录音">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h5 className="text-14 font-semibold">访谈录音 · {participantCode}</h5>
      {phase === "recording" && <span role="timer" aria-label="已录制时长" className="text-13 tabular-nums">{timestamp(recordedSeconds * 1000)}</span>}
    </div>
    {asrAllowed && <label className="flex items-center gap-2 text-12"><input type="checkbox" checked={asrSelected} disabled={disabled || phase !== "idle" || !!preview} onChange={event => setAsrSelected(event.currentTarget.checked)} />本次录音同时请求实时转写</label>}
    <div className="flex flex-wrap gap-2">
      {!preview && <Button type="button" size="sm"
        disabled={disabled && phase === "idle"}
        aria-disabled={phase === "starting" || phase === "stopping"}
        onClick={() => { if (phase === "recording") void stop(); else if (phase === "idle") void start(); }}>
        {phase === "recording" || phase === "stopping" ? "停止录音" : "开始录音"}
      </Button>}
      {preview && <Button type="button" size="sm" disabled={disabled || phase !== "idle"} onClick={() => void save()}>{preview.receipt ? "重试录音回读" : "保存本次录音原件"}</Button>}
      {preview && <Button type="button" size="sm" variant="ghost" disabled={phase !== "idle"} onClick={() => { clear(); setPreview(null); setMessage(""); }}>舍弃本页录音</Button>}
    </div>
    {phase === "starting" && <p role="status" className="text-12">正在请求麦克风…</p>}
    {phase === "recording" && <p role="status" className="text-12">正在录音 · {participantCode}</p>}
    {asrSelected && (phase === "recording" || phase === "stopping") && <div className="space-y-2 rounded-md bg-muted p-3">
      <h6 className="text-12 font-semibold">{asrInterrupted ? "实时转写中断" : phase === "stopping" ? "正在收取最终转写" : "实时转写"}</h6>
      {asrInterrupted && <p className="text-12 text-muted-foreground">录音仍可保存。请用原件校对摘录。</p>}
      {!asrInterrupted && !liveTranscript && !partialTranscript && <p className="text-12 text-muted-foreground">等待转写文字…</p>}
      {!!liveTranscript && <p className="whitespace-pre-wrap break-words text-12">{liveTranscript}</p>}
      {!asrInterrupted && !!partialTranscript && <p className="whitespace-pre-wrap break-words text-12 text-muted-foreground">{partialTranscript}</p>}
    </div>}
    {phase === "stopping" && <p role="status" className="text-12">正在结束录音…</p>}
    {phase === "saving" && <p role="status" className="text-12">正在保存并核对录音原件…</p>}
    {preview && <>
      <audio controls src={preview.url} aria-label="本页录音预览" className="w-full" />
      <p className="text-12 text-muted-foreground">{timestamp(preview.durationMs)} · 本页待保存</p>
      {!!preview.draftTranscript && <p className="whitespace-pre-wrap text-12">自动转写摘录（时间为浏览器收到文本时的录音位置，需人工校对）{"\n"}{preview.draftTranscript}</p>}
    </>}
    {message && <p role="status" className="text-12">{message}</p>}
  </section>;
}
