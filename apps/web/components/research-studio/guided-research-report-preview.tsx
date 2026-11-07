import { useI18n } from "@/lib/i18n/provider";
import type { ReactNode } from "react";
import { researchStageMessageKeys } from "./guided-research-runtime-progress";
import { researchReportDocument } from "@/lib/research-report-document";
import { GuidedResearchReportDocument } from "./guided-research-report-document";
import { researchReportPreview } from "@/lib/research-report-preview";
import type { GuidedResearchRuntime } from "@/lib/guided-research-api";
export function GuidedResearchReportPreview({ state, interrupted = false, moreActions, onRegenerate }: { state: GuidedResearchRuntime; interrupted?: boolean; moreActions?: ReactNode; onRegenerate?: () => void }) {
  const { t } = useI18n();
  const preview = researchReportPreview(state.reportStream?.text ?? "");
  const saved = state.reportCheckpoint?.chapters ?? [];
  const savedCount = state.reportSavedChapterCount ?? (state.reportCheckpoint ? saved.length : undefined);
  const sections = [...saved, ...preview.sections.filter((section) => !saved.some((chapter) => chapter.sectionId === section.sectionId))];
  const document = researchReportDocument({ ...preview, title: preview.title || state.brief.topic, sections }, state.sources, state.outline, { provisional: true, aliases: state.reportSourceAliases });
  if (!preview.summary && !preview.introduction && !preview.conclusion && !sections.some((section) => section.body)) return <p role="status" className="rounded-xl border border-border bg-card p-5 text-12 text-muted-foreground" data-testid="research-report-preview-empty">{state.controlStatus === "paused" ? t("research.preview.paused") : interrupted || state.errorCode ? t("research.preview.empty") : t("research.preview.organizing")}</p>;
  const failed = state.reportStream?.status === "failed" || interrupted || Boolean(state.errorCode && !state.busy);
  return <section className="space-y-5 rounded-xl border border-border bg-card p-5" data-testid="research-report-preview" aria-busy={!failed}>
    <p role="status" className="text-12 text-muted-foreground">{failed ? (state.reportCheckpoint ? t("research.preview.interruptedSaved") : t("research.preview.interrupted")) : t("research.preview.running")}</p>
    <p className="text-12 text-muted-foreground" data-testid="research-report-validation-status">{savedCount !== undefined ? t("research.preview.savedChapters", { saved: savedCount, count: state.outline.filter((section) => section.enabled).length }) : t("research.preview.displayedChapters", { count: sections.length })}{t("research.preview.validation")}</p>
    {!state.reportTimeline?.length && state.progress && <p className="text-12 font-medium">{t("research.preview.stage", { stage: t(researchStageMessageKeys[state.progress.stage]) })}</p>}
    {Boolean(document.unresolvedReferences) && <p role="status" className="text-12 text-muted-foreground" data-testid="research-preview-citations-pending">{t("research.preview.citations", { count: document.unresolvedReferences! })}</p>}
    <GuidedResearchReportDocument document={document} provisional moreActions={moreActions} onRegenerate={onRegenerate} regenerateDisabled={state.busy && !interrupted} />
    {!preview.title && !preview.summary && !sections.some((section) => section.body) && <p className="text-12 text-muted-foreground">{t("research.preview.organizingShort")}</p>}
  </section>;
}
