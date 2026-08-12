"use client";

import { ArrowLeft, Mic, Radio } from "lucide-react";
import type { personalRealtimeTranscription as C } from "@repo/contracts";
import type { z } from "zod";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { RealtimeAsrStreamState } from "@/lib/realtime-asr.types";

type PersonalTranscriptionDetail = z.infer<typeof C.PersonalTranscriptionDetail>;
type PersonalTranscriptionStatus = z.infer<typeof C.PersonalTranscriptionStatus>;
type PersonalTranscriptionCapture = PersonalTranscriptionDetail["captures"][number];
type PersonalTranscriptionSegment = PersonalTranscriptionCapture["segments"][number];

const STATUS_LABEL: Record<PersonalTranscriptionStatus, string> = {
  idle: "待开始",
  recording: "录音中",
  completed: "已完成",
  failed: "转录失败",
};

export function RealtimeTranscriptionWorkspace({
  session,
  onBack,
  streamState = "idle",
  interimSegment = "",
  errorMessage,
  onStart,
  onStop,
}: {
  session: PersonalTranscriptionDetail;
  onBack: () => void;
  streamState?: RealtimeAsrStreamState;
  interimSegment?: string;
  errorMessage?: string | null;
  onStart: () => void;
  onStop: () => void;
}) {
  const segments = session.captures.flatMap((capture: PersonalTranscriptionCapture) => capture.segments);
  const recording = streamState === "recording" || streamState === "stopping" || session.status === "recording";
  const busy = streamState === "connecting" || streamState === "stopping";
  const canStart = session.status === "idle" || session.status === "completed" || session.status === "failed";

  return (
    <section data-testid="rec-live-workspace" className="min-h-full bg-background px-5 py-6 md:px-8 lg:px-10">
      <div className="mx-auto flex w-full max-w-screen-xl flex-col gap-6">
        <header className="flex flex-col gap-4 border-b border-border pb-5 md:flex-row md:items-center md:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <Button data-testid="rec-live-back" type="button" variant="ghost" size="icon" aria-label="返回历史转录" onClick={onBack}>
              <ArrowLeft aria-hidden className="h-4 w-4" />
            </Button>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 data-testid="rec-live-title" className="truncate text-24 font-semibold tracking-tight">{session.name}</h1>
                <Badge
                  data-testid="rec-live-status"
                  tone={session.status === "completed" ? "primary" : session.status === "recording" ? "danger" : session.status === "failed" ? "danger" : "neutral"}
                >
                  {STATUS_LABEL[session.status]}
                </Badge>
              </div>
              <p className="mt-2 text-12 text-muted-foreground">个人转录 · {session.tags.join(" / ") || "未添加标签"}</p>
            </div>
          </div>
          <div className="flex items-center gap-3 pl-11 md:pl-0">
            <div className="flex items-center gap-2 text-12 text-muted-foreground">
              <Radio aria-hidden className={`h-4 w-4 ${recording ? "text-success" : ""}`} />
              {streamState === "connecting" ? "正在连接" : streamState === "stopping" ? "正在等待尾部结果" : session.status === "completed" ? "内容已保存" : recording ? "正在接收音频" : session.status === "failed" ? "上次转录失败，可重新开始" : "尚未开始"}
            </div>
            <Button
              data-testid="rec-live-toggle"
              type="button"
              variant={recording ? "destructive" : "primary"}
              disabled={busy}
              onClick={recording ? onStop : onStart}
            >
              {streamState === "connecting" ? "正在连接" : streamState === "stopping" ? "正在收尾" : recording ? "停止转录" : canStart ? "开始转录" : "开始转录"}
            </Button>
          </div>
        </header>

        {errorMessage && <p role="alert" data-testid="rec-live-error" className="rounded-md border border-destructive px-3 py-2 text-12 text-destructive">{errorMessage}</p>}

        <Card className="min-h-96 p-6" data-testid="rec-live-transcript">
          <div className="border-b border-border pb-4">
            <h2 className="text-16 font-semibold">实时逐字稿</h2>
            <p className="mt-1 text-11 text-muted-foreground">这里只显示已由服务端确认并持久化的最终段。</p>
          </div>

          {segments.length > 0 || interimSegment ? (
            <div className="mt-5 flex flex-col gap-4">
              {segments.map((segment: PersonalTranscriptionSegment) => (
                <TranscriptSegment
                  key={segment.segmentId}
                  time={formatTime(segment.startMs)}
                  text={segment.text}
                />
              ))}
              {interimSegment && (
                <article data-testid="rec-live-interim" className="rounded-lg border border-dashed border-border bg-muted p-4">
                  <div className="text-11 text-muted-foreground">识别中</div>
                  <p className="mt-3 text-13 leading-relaxed">{interimSegment}</p>
                </article>
              )}
            </div>
          ) : (
            <div className="flex min-h-72 flex-col items-center justify-center gap-4 text-center">
              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
                <Mic aria-hidden className="h-5 w-5" />
              </span>
              <div>
                <p className="text-14 font-medium">{recording ? "正在等待识别结果" : "还没有逐字稿"}</p>
                <p className="mt-1 text-12 text-muted-foreground">{recording ? "最终文字会在服务端保存后显示。" : "点击开始转录后，最终文字会显示在这里。"}</p>
              </div>
            </div>
          )}
        </Card>
      </div>
    </section>
  );
}

function TranscriptSegment({ time, text }: { time: string; text: string }) {
  return (
    <article className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-center gap-2 text-11 text-muted-foreground">
        <span>{time}</span>
        <Badge tone="primary">最终</Badge>
      </div>
      <p className="mt-3 text-13 leading-relaxed">{text}</p>
    </article>
  );
}

function formatTime(valueMs: number): string {
  const seconds = Math.floor(valueMs / 1_000);
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}
