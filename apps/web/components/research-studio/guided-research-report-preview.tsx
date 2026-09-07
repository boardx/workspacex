import { researchStageLabels } from "./guided-research-runtime-progress";
import { researchReportDocument } from "@/lib/research-report-document";
import { GuidedResearchReportDocument } from "./guided-research-report-document";
import { researchReportPreview } from "@/lib/research-report-preview";
import type { GuidedResearchRuntime } from "@/lib/guided-research-api";
export function GuidedResearchReportPreview({ state, interrupted = false }: { state: GuidedResearchRuntime; interrupted?: boolean }) {
  const preview = researchReportPreview(state.reportStream?.text ?? "");
  const saved = state.reportCheckpoint?.chapters ?? [];
  const sections = [...saved, ...preview.sections.filter((section) => !saved.some((chapter) => chapter.sectionId === section.sectionId))];
  const document = researchReportDocument({ ...preview, title: preview.title || state.brief.topic, sections }, state.sources, state.outline, { provisional: true, aliases: state.reportSourceAliases });
  const failed = state.reportStream?.status === "failed" || interrupted || Boolean(state.errorCode && !state.busy);
  return <section className="space-y-5 rounded-xl border border-border bg-card p-5" data-testid="research-report-preview" aria-busy={!failed}>
    <p role="status" className="text-12 text-muted-foreground">{failed ? (state.reportCheckpoint ? "生成中断 · 以下为尚未完成的草稿，已保存的章节可以继续生成。" : "生成中断 · 以下为尚未完成、未经引用校验的草稿，请重新生成。") : "正在生成报告 · 正文实时更新，完成后校验引用并保存。"}</p>
    <p className="text-12 text-muted-foreground" data-testid="research-report-validation-status">已校验并保存 {saved.length} / {state.outline.filter((section) => section.enabled).length} 个章节。报告尚未完成，仍需综合与最终校验。</p>
    {state.progress && <p className="text-12 font-medium">当前阶段：{researchStageLabels[state.progress.stage]}</p>}
    {Boolean(document.unresolvedReferences) && <p role="status" className="text-12 text-muted-foreground" data-testid="research-preview-citations-pending">{document.unresolvedReferences} 处草稿引用待核对，完成校验后才会纳入正式报告。</p>}
    <GuidedResearchReportDocument document={document} provisional />
    {!preview.title && !preview.summary && !sections.some((section) => section.body) && <p className="text-12 text-muted-foreground">正在组织报告内容…</p>}
  </section>;
}
