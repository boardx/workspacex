import type { ReactNode } from "react";
import type { GuidedResearchRuntime } from "@/lib/guided-research-api";
import { researchReportDocument } from "@/lib/research-report-document";
import { GuidedResearchReportDocument } from "./guided-research-report-document";

export function GuidedResearchQualityDraft({ state, actions, onRegenerate }: { state: GuidedResearchRuntime; actions?: ReactNode; onRegenerate?: () => void }) {
  if (state.report || !state.reportDraft) return null;
  return <section className="space-y-4" data-testid="research-quality-draft">
    <GuidedResearchReportDocument document={researchReportDocument(state.reportDraft, state.sources, state.outline)} provisional title="研究报告" actions={actions} onRegenerate={onRegenerate} regenerateDisabled={state.busy} />
  </section>;
}
