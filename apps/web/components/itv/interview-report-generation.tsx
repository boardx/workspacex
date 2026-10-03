"use client";
import { Loader2, Check } from "lucide-react";
import type { InterviewGenerationSession } from "@/lib/interview-generation-session";
import { InterviewReportMarkdown } from "./interview-report-markdown";
import { InterviewStepHeader } from "./interview-step-header";
const stages = [["context", "整理访谈材料"], ["model", "撰写研究报告"], ["validation", "检查报告质量"], ["storage", "保存报告"]] as const;
export function InterviewReportGeneration({ session }: { session: InterviewGenerationSession }) {
  const index = stages.findIndex(([stage]) => stage === session.stage);
  return <section aria-busy="true" data-testid="itv-report-generation">
    <InterviewStepHeader title="研究报告" />
    <ol aria-label="报告生成进度" className="mb-6 grid gap-3 sm:grid-cols-4">
      {stages.map(([stage, label], order) => <li key={stage} aria-current={order === index ? "step" : undefined} className="flex items-center gap-2 rounded-lg border border-border p-3 text-sm">
        {order < index ? <Check className="size-4" aria-hidden /> : order === index ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <span className="text-muted-foreground">{order + 1}</span>}{label}
      </li>)}
    </ol>
    <p role="status" className="mb-4 text-sm text-muted-foreground">{session.attempt && session.attempt > 1 ? "正在完善报告分析，以下为本次修订。" : "正在生成报告，内容将持续显示。"}当前内容尚未完成，保存后可导出。</p>
    {session.markdown ? <InterviewReportMarkdown markdown={session.markdown} longForm testId="itv-report-stream-markdown" /> : <p className="py-10 text-sm text-muted-foreground">正在准备报告…</p>}
  </section>;
}
