import type { GuidedResearchRuntime } from "@/lib/guided-research-api";
import { researchReportDocument } from "@/lib/research-report-document";
import { GuidedResearchReportDocument } from "./guided-research-report-document";

export function GuidedResearchQualityDraft({ state }: { state: GuidedResearchRuntime }) {
  const warnings = state.reportQualityWarnings ?? [];
  if (!warnings.length && !state.reportDraft) return null;
  return <section className="space-y-4" data-testid="research-quality-draft">
    <aside className="space-y-3 rounded-lg border border-border bg-muted/30 p-4 text-12" aria-label="报告待核验事项">
      <p role="status" className="font-medium">{state.reportDraft ? "完整草稿已生成并保存，以下章节仍需核验。" : "部分章节仍需核验，正在继续生成后续内容。"}</p>
      <p>草稿中的分析尚未全部通过质量检查，不代表正式报告。请结合具体问题补充证据或调整大纲后重新生成。</p>
      <ul className="space-y-3">{warnings.map((warning) => <li key={warning.sectionId}>
        <p className="font-medium">{state.outline.find((section) => section.id === warning.sectionId)?.title ?? "研究章节"}</p>
        <ul className="mt-1 list-disc space-y-1 pl-4">{warning.issues.map((issue, index) => <li key={index} className="break-words">{issue}</li>)}</ul>
      </li>)}</ul>
    </aside>
    {state.reportDraft && <GuidedResearchReportDocument document={researchReportDocument(state.reportDraft, state.sources, state.outline)} provisional />}
  </section>;
}
