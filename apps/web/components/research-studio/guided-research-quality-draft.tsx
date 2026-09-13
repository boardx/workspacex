import type { GuidedResearchRuntime } from "@/lib/guided-research-api";
import { researchReportDocument } from "@/lib/research-report-document";
import { GuidedResearchReportDocument } from "./guided-research-report-document";

export function GuidedResearchQualityDraft({ state }: { state: GuidedResearchRuntime }) {
  if (state.report || !state.reportDraft) return null;
  return <section className="space-y-4" data-testid="research-quality-draft">
    <GuidedResearchReportDocument document={researchReportDocument(state.reportDraft, state.sources, state.outline)} provisional />
  </section>;
}
