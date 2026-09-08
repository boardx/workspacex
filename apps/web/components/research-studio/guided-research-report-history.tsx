import type { GuidedResearchRuntime } from "@/lib/guided-research-api";
import { researchReportDocument } from "@/lib/research-report-document";
import { researchReportPreview } from "@/lib/research-report-preview";
import { GuidedResearchReportDocument } from "./guided-research-report-document";
export function GuidedResearchReportHistory({ state }: { state: GuidedResearchRuntime }) {
  const previous = state.reportPrevious;
  if (!previous) return null;
  const streamed = researchReportPreview(previous.text);
  const sections = [...previous.chapters, ...streamed.sections.filter((section) => !previous.chapters.some((saved) => saved.sectionId === section.sectionId))];
  const content = previous.report ?? previous.draft ?? { ...streamed, title: streamed.title || previous.title, sections };
  const document = researchReportDocument(content, previous.sources, previous.outline, { provisional: !previous.report, aliases: previous.aliases });
  const current = researchReportPreview(state.reportStream?.text ?? "");
  const currentHasContent = Boolean(state.report || state.reportDraft || state.reportCheckpoint?.chapters.length || current.summary || current.introduction || current.conclusion || current.sections.some((section) => section.body));
  const expired = Boolean(state.leaseUntil && Date.parse(state.leaseUntil) <= Date.now());
  const fallback = !currentHasContent || Boolean(state.errorCode) || expired;
  return <details key={fallback ? "fallback" : "archive"} open={fallback} className="rounded-xl border border-border bg-muted/20 p-4" data-testid="research-report-history">
    <summary className="cursor-pointer text-13 font-semibold">上一轮{previous.report ? "报告" : "草稿"} · 历史内容，仅供查看</summary>
    <div className="mt-4 space-y-3"><p className="text-12 text-muted-foreground">上一轮内容独立保留，仅供回顾。保存时间：<time dateTime={previous.createdAt}>{previous.createdAt}</time></p>
      {previous.partial && <p className="text-12 text-muted-foreground" data-testid="previous-report-evidence-gap">上一轮报告基于已有来源生成，部分检索任务未成功，相关证据可能存在缺口。</p>}
      {!!previous.evidenceWarnings?.length && <p className="text-12 text-muted-foreground" data-testid="previous-report-evidence-warning">上一轮有 {previous.evidenceWarnings.length} 批证据包含未通过校验的内容，已排除无效部分。历史内容的证据覆盖可能不完整。</p>}
      {!!previous.qualityWarnings?.length && <p className="text-12 text-muted-foreground">上一轮草稿有 {previous.qualityWarnings.length} 个章节尚未通过质量核验。</p>}
      <GuidedResearchReportDocument document={document} provisional={!previous.report} historical idPrefix="previous-" />
      {!!document.unresolvedReferences && <p className="text-12 text-muted-foreground">{document.unresolvedReferences} 处历史草稿引用待核对。</p>}
    </div>
  </details>;
}
export function GuidedResearchEvidenceWarning({ state }: { state: GuidedResearchRuntime }) {
  const warnings = state.reportEvidenceWarnings ?? [];
  if (!warnings.length) return null;
  const generating = state.busy && !state.errorCode && (!state.leaseUntil || Date.parse(state.leaseUntil) > Date.now());
  return <aside className="space-y-2 rounded-lg border border-border bg-muted/30 p-4 text-12" data-testid="research-report-evidence-warning">
    <p role="status">本轮有 {warnings.length} 批证据包含未通过校验的内容，已排除无效部分，{state.report ? "报告基于其余有效证据生成。" : generating ? "继续使用其余有效证据生成。" : "其余有效证据已保留。"}</p>
    <p>证据覆盖可能不完整，请留意相关问题的证据缺口。</p>
  </aside>;
}
