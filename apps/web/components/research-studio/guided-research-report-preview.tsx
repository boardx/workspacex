import { researchReportPreview } from "@/lib/research-report-preview";
import type { GuidedResearchRuntime } from "@/lib/guided-research-api";
export function GuidedResearchReportPreview({ state, interrupted = false }: { state: GuidedResearchRuntime; interrupted?: boolean }) {
  const preview = researchReportPreview(state.reportStream?.text ?? "");
  const failed = state.reportStream?.status === "failed" || interrupted;
  return <section className="space-y-5 rounded-xl border border-border bg-card p-5" data-testid="research-report-preview" aria-busy={!failed}>
    <p role="status" className="text-12 text-muted-foreground">{failed ? "生成中断 · 以下为尚未完成、未经引用校验的草稿，请重新生成。" : "正在生成报告 · 正文实时更新，完成后校验引用并保存。"}</p>
    <div className="space-y-4" data-testid="research-report-preview-text">
      {preview.title && <h2 className="text-20 font-semibold">{preview.title}</h2>}
      {preview.summary && <p className="whitespace-pre-wrap text-12 leading-relaxed">{preview.summary}</p>}
      {preview.sections.map((section, index) => <div key={index} className="space-y-2"><h3 className="font-semibold">{state.outline.find((entry) => entry.id === section.sectionId)?.title}</h3><p className="whitespace-pre-wrap text-12 leading-relaxed">{section.body}</p></div>)}
      {!preview.title && !preview.summary && !preview.sections.some((section) => section.body) && <p className="text-12 text-muted-foreground">正在组织报告内容…</p>}
    </div>
  </section>;
}
