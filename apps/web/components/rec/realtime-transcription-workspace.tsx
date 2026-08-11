"use client";

import * as React from "react";
import { ArrowLeft, FileText, ListChecks, Mic, Quote, Radio, Sparkles, Square } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { TranscriptionHistoryItem } from "@/lib/mock/realtime-transcriptions";

type LiveStatus = "recording" | "finalizing" | "completed";

export function RealtimeTranscriptionWorkspace({
  session, onBack,
}: {
  session: TranscriptionHistoryItem;
  onBack: () => void;
}) {
  const [status, setStatus] = React.useState<LiveStatus>(session.status === "completed" ? "completed" : "recording");

  React.useEffect(() => {
    if (status !== "finalizing") return;
    const timer = window.setTimeout(() => setStatus("completed"), 800);
    return () => window.clearTimeout(timer);
  }, [status]);

  const completed = status === "completed";

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
                <h1 data-testid="rec-live-title" className="truncate text-24 font-semibold tracking-tight">{session.title}</h1>
                <Badge data-testid="rec-live-status" tone={completed ? "primary" : status === "finalizing" ? "warning" : "danger"}>
                  {completed ? "已完成" : status === "finalizing" ? "正在收尾" : "录音中"}
                </Badge>
              </div>
              <p className="mt-2 text-12 text-muted-foreground">{session.project} · {session.owner} · {session.tags.join(" / ") || "未添加标签"}</p>
            </div>
          </div>
          <div className="flex items-center gap-3 pl-11 md:pl-0">
            <div className="flex items-center gap-2 text-12 text-muted-foreground">
              <Radio aria-hidden className="h-4 w-4 text-success" />
              {completed ? "内容已保存" : status === "finalizing" ? "等待最终识别结果" : "已连接 · 00:00"}
            </div>
            {!completed && (
              <Button
                data-testid="rec-live-stop"
                type="button"
                variant="destructive"
                disabled={status === "finalizing"}
                onClick={() => setStatus("finalizing")}
              >
                <Square aria-hidden className="h-3.5 w-3.5" />
                {status === "finalizing" ? "正在收尾" : "停止转录"}
              </Button>
            )}
          </div>
        </header>

        <div className="grid gap-5 lg:grid-cols-3">
          <Card className="min-h-96 p-6 lg:col-span-2" data-testid="rec-live-transcript">
            <div className="flex items-center justify-between gap-3 border-b border-border pb-4">
              <div>
                <h2 className="text-16 font-semibold">实时逐字稿</h2>
                <p className="mt-1 text-11 text-muted-foreground">最终段与当前识别中内容分开显示，避免重复。</p>
              </div>
              {!completed && <Badge tone="outline">自动滚动</Badge>}
            </div>

            {completed ? (
              <div className="mt-5 flex flex-col gap-4">
                <TranscriptSegment time="00:04" text={session.summary} final />
                <TranscriptSegment time="00:18" text="本次转录已完成，可以继续生成总结、报告或提取带时间码的引用。" final />
              </div>
            ) : (
              <div className="flex min-h-72 flex-col items-center justify-center gap-4 text-center">
                <span className="flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
                  <Mic aria-hidden className="h-5 w-5" />
                </span>
                <div>
                  <p className="text-14 font-medium">{status === "finalizing" ? "正在接收最后一段识别结果" : "麦克风已就绪"}</p>
                  <p className="mt-1 text-12 text-muted-foreground">{status === "finalizing" ? "完成前暂不可调用 Skill。" : "开始说话后，实时文字会出现在这里。"}</p>
                </div>
              </div>
            )}
          </Card>

          <Card className="flex min-h-96 flex-col p-6" data-testid="rec-live-analysis">
            <div>
              <h2 className="text-16 font-semibold">转录分析</h2>
              <p className="mt-1 text-11 text-muted-foreground">转录完成后，调用 Skill 生成带原文引用的结果。</p>
            </div>
            <div className="mt-5 grid gap-2">
              <AnalysisAction icon={ListChecks} label="总结要点" disabled={!completed} />
              <AnalysisAction icon={FileText} label="生成报告" disabled={!completed} />
              <AnalysisAction icon={Quote} label="提取引用" disabled={!completed} />
            </div>
            <div className="mt-auto rounded-lg border border-dashed border-border bg-muted p-4">
              <div className="flex items-center gap-2 text-12 font-medium"><Sparkles aria-hidden className="h-4 w-4" />继续提问或调用 Skill</div>
              <p className="mt-2 text-11 text-muted-foreground">{completed ? "输入分析目标，生成内容会保留逐字稿来源。" : "请先停止并等待转录完成。"}</p>
            </div>
          </Card>
        </div>
      </div>
    </section>
  );
}

function TranscriptSegment({ time, text, final }: { time: string; text: string; final: boolean }) {
  return (
    <article className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-center gap-2 text-11 text-muted-foreground"><span>{time}</span><Badge tone={final ? "primary" : "warning"}>{final ? "最终" : "识别中"}</Badge></div>
      <p className="mt-3 text-13 leading-relaxed">{text}</p>
    </article>
  );
}

function AnalysisAction({ icon: Icon, label, disabled }: { icon: typeof ListChecks; label: string; disabled: boolean }) {
  return <Button variant="outline" className="justify-start" disabled={disabled}><Icon aria-hidden className="h-4 w-4" />{label}</Button>;
}
