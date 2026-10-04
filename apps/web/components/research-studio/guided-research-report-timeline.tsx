import { CheckCircle2, Circle, Loader2, AlertCircle } from "lucide-react";
import type { GuidedResearchRuntime } from "@/lib/guided-research-api";
const stages = { evidence: "整理研究证据", chapter: "生成", review: "生成", synthesis: "生成综合结论", validation: "保存报告" };
const statusLabels = { pending: "等待生成", running: "生成中", retrying: "生成中", completed: "生成完成", warning: "部分内容待核实", failed: "生成失败" };
type TimelineStep = NonNullable<GuidedResearchRuntime["reportTimeline"]>[number];
function generationSteps(timeline: TimelineStep[]): TimelineStep[] {
  const sections = new Set<string>();
  return timeline.flatMap((item) => {
    if ((item.stage !== "chapter" && item.stage !== "review") || !item.sectionId) return [{ ...item }];
    if (sections.has(item.sectionId)) return [];
    sections.add(item.sectionId);
    const chapter = timeline.find((step) => step.stage === "chapter" && step.sectionId === item.sectionId);
    const review = timeline.find((step) => step.stage === "review" && step.sectionId === item.sectionId);
    let status = chapter?.status ?? item.status;
    // A pending review must not hide active writing or mark a chapter complete.
    if (status === "completed" && review) status = review.status === "pending" ? "running" : review.status;
    else if (review && review.status !== "pending" && status !== "running" && status !== "retrying" && status !== "failed") status = review.status;
    return [{ ...item, stage: "chapter" as const, status, attempts: Math.max(chapter?.attempts ?? 0, review?.attempts ?? 0) }];
  });
}
export function GuidedResearchReportTimeline({ state, interrupted = false }: { state: GuidedResearchRuntime; interrupted?: boolean }) {
  if (!state.reportTimeline?.length) return null;
  const finished = Boolean(state.report && !state.busy && !state.errorCode && !interrupted && state.reportTimeline.some((step) => step.stage === "validation" && step.status === "completed"));
  const collapsed = finished || Boolean(state.reportDraft && !state.busy) || interrupted || Boolean(state.errorCode && !state.busy);
  return <details key={collapsed ? "settled" : "active"} open={!collapsed} className="rounded-xl border border-border bg-card p-5" data-testid="research-report-timeline" aria-label="报告生成过程">
    <summary className="cursor-pointer text-16 font-semibold">报告生成过程{collapsed ? " · 查看详情" : ""}</summary>
    {(interrupted || state.errorCode) && <p className="mt-2 text-12 text-muted-foreground">{interrupted ? "执行已中断，已保存的进度仍可继续。" : "本次生成已暂停，请查看错误后重试。"}</p>}
    <ol className="mt-4 space-y-4">{generationSteps(state.reportTimeline).map((item) => {
      const active = item.status === "running" || item.status === "retrying";
      const Icon = item.status === "completed" ? CheckCircle2 : item.status === "failed" || item.status === "warning" ? AlertCircle : active ? Loader2 : Circle;
      const title = item.sectionId && state.outline.find((section) => section.id === item.sectionId)?.title;
      const detail = interrupted && active ? "执行中断" : item.status === "failed" ? "生成失败" : item.status === "warning" ? (item.stage === "evidence" ? "存在证据缺口" : "部分内容待核实") : null;
      return <li key={item.id} className="relative flex min-w-0 gap-3 text-12 before:absolute before:-bottom-4 before:left-2 before:top-5 before:w-px before:bg-border last:before:hidden" data-testid="research-report-timeline-step" data-stage={item.stage} data-section-id={item.sectionId} data-status={item.status} aria-busy={active && !interrupted || undefined}>
        <Icon className={`mt-0.5 size-4 shrink-0 ${active && !interrupted ? "animate-spin motion-reduce:animate-none text-primary" : "text-muted-foreground"}`} aria-hidden />
        <p className="min-w-0 break-words font-medium"><span className="sr-only">{interrupted && active ? "执行中断" : statusLabels[item.status]}，</span>{stages[item.stage]}{title ? ` · ${title}` : ""}{detail && <span className="ml-2 font-normal text-muted-foreground">{detail}</span>}{item.stage === "evidence" && item.total !== undefined && <span className="ml-2 font-normal text-muted-foreground">整理进度 {Math.round(Math.min(1, (item.completed ?? 0) / Math.max(1, item.total)) * 100)}%</span>}</p>
      </li>;
    })}</ol>
  </details>;
}
