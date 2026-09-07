import { researchReportDocument } from "@/lib/research-report-document";
import { GuidedResearchReportDocument } from "./guided-research-report-document";
import { researchReportPreview } from "@/lib/research-report-preview";
import type { GuidedResearchRuntime } from "@/lib/guided-research-api";
export function GuidedResearchReportPreview({ state, interrupted = false }: { state: GuidedResearchRuntime; interrupted?: boolean }) {
  const preview = researchReportPreview(state.reportStream?.text ?? "");
  const failed = state.reportStream?.status === "failed" || interrupted;
  return <section className="space-y-5 rounded-xl border border-border bg-card p-5" data-testid="research-report-preview" aria-busy={!failed}>
    <p role="status" className="text-12 text-muted-foreground">{failed ? "生成中断 · 以下为尚未完成、未经引用校验的草稿，请重新生成。" : "正在生成报告 · 正文实时更新，完成后校验引用并保存。"}</p>
    <p className="text-12 text-muted-foreground">已接收 {preview.sections.filter((section) => section.body).length} / {state.outline.filter((section) => section.enabled).length} 个章节的内容</p>
    <GuidedResearchReportDocument document={researchReportDocument(preview, state.sources, state.outline)} provisional />
    {!preview.title && !preview.summary && !preview.sections.some((section) => section.body) && <p className="text-12 text-muted-foreground">正在组织报告内容…</p>}
  </section>;
}
