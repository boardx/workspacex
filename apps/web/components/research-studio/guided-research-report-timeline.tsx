import { CheckCircle2, Circle, Loader2, AlertCircle } from "lucide-react";
import type { GuidedResearchRuntime } from "@/lib/guided-research-api";
const stages = { evidence: "整理研究证据", chapter: "撰写章节", review: "核验章节", synthesis: "综合研究结论", validation: "最终验证" };
const statuses = { pending: "等待处理", running: "正在处理", retrying: "正在自动重试", completed: "已完成", warning: "已处理，存在证据缺口", failed: "处理失败" };
export function GuidedResearchReportTimeline({ state, interrupted = false }: { state: GuidedResearchRuntime; interrupted?: boolean }) {
  if (!state.reportTimeline?.length) return null;
  const finished = Boolean(state.report && !state.busy && !state.errorCode && !interrupted && state.reportTimeline.some((step) => step.stage === "validation" && step.status === "completed"));
  return <section className="rounded-xl border border-border bg-card p-5" data-testid="research-report-timeline" aria-label="报告生成过程">
    <h2 className="text-16 font-semibold">报告生成过程</h2>
    <p className="mt-2 text-12 text-muted-foreground">{finished ? "报告已生成并保存。" : interrupted ? "执行已中断，已保存的进度仍可继续。" : state.errorCode ? "本次生成已暂停，请查看错误后重试。" : "各阶段连续处理，进度自动保存。"}</p>
    <ol className="mt-4 space-y-4">{state.reportTimeline.map((item) => {
      const active = item.status === "running" || item.status === "retrying";
      const Icon = item.status === "completed" ? CheckCircle2 : item.status === "failed" || item.status === "warning" ? AlertCircle : active ? Loader2 : Circle;
      const title = item.sectionId && state.outline.find((section) => section.id === item.sectionId)?.title;
      return <li key={item.id} className="relative flex min-w-0 gap-3 text-12 before:absolute before:-bottom-4 before:left-2 before:top-5 before:w-px before:bg-border last:before:hidden" data-testid="research-report-timeline-step" data-stage={item.stage} data-section-id={item.sectionId} data-status={item.status}>
        <Icon className={`mt-0.5 size-4 shrink-0 ${active && !interrupted ? "animate-spin text-primary" : "text-muted-foreground"}`} aria-hidden />
        <div className="min-w-0 space-y-1"><p className="break-words font-medium">{stages[item.stage]}{title ? ` · ${title}` : ""}</p><p className="text-muted-foreground">{interrupted && active ? "执行中断" : statuses[item.status]}{item.attempts > 1 ? (item.stage === "evidence" ? ` · 已调用模型 ${item.attempts} 次` : ` · 第 ${item.attempts} 次尝试`) : ""}{item.total !== undefined && item.completed !== undefined ? ` · ${item.completed} / ${item.total}` : ""}</p></div>
      </li>;
    })}</ol>
  </section>;
}
