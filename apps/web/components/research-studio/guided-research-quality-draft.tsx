import type { ReactNode } from "react";
import type { GuidedResearchRuntime } from "@/lib/guided-research-api";
import { researchReportDocument } from "@/lib/research-report-document";
import { GuidedResearchReportDocument } from "./guided-research-report-document";

export function GuidedResearchQualityDraft({ state, actions }: { state: GuidedResearchRuntime; actions?: ReactNode }) {
  if (state.report || !state.reportDraft) return null;
  return <section className="space-y-4" data-testid="research-quality-draft">
    <GuidedResearchReportDocument document={researchReportDocument(state.reportDraft, state.sources, state.outline)} provisional actions={actions} />
  </section>;
}
