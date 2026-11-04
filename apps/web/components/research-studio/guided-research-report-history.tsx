import { useI18n } from "@/lib/i18n/provider";
import type { GuidedResearchRuntime } from "@/lib/guided-research-api";
import { researchReportDocument } from "@/lib/research-report-document";
import { researchReportPreview } from "@/lib/research-report-preview";
import { GuidedResearchReportDocument } from "./guided-research-report-document";
export function GuidedResearchReportHistory({ state }: { state: GuidedResearchRuntime }) {
  const { t } = useI18n();
  const previous = state.reportPrevious;
  if (!previous) return null;
  const streamed = researchReportPreview(previous.text);
  const sections = [...previous.chapters, ...streamed.sections.filter((section) => !previous.chapters.some((saved) => saved.sectionId === section.sectionId))];
  const content = previous.report ?? previous.draft ?? { ...streamed, title: streamed.title || previous.title, sections };
  const document = researchReportDocument(content, previous.sources, previous.outline, { provisional: !previous.report, aliases: previous.aliases, brief: { topic: previous.title, goal: "", focus: "", timeRange: "", region: "" } });
  const current = researchReportPreview(state.reportStream?.text ?? "");
  const currentHasContent = Boolean(state.report || state.reportDraft || state.reportCheckpoint?.chapters.length || current.summary || current.introduction || current.conclusion || current.sections.some((section) => section.body));
  const expired = Boolean(state.leaseUntil && Date.parse(state.leaseUntil) <= Date.now());
  const fallback = !currentHasContent || (!state.report && !state.reportDraft && (Boolean(state.errorCode) || expired));
  return <details key={fallback ? "fallback" : "archive"} open={fallback} className="rounded-xl border border-border bg-muted/20 p-4" data-testid="research-report-history">
    <summary className="cursor-pointer text-13 font-semibold">{t("research.history.summary")}</summary>
    <div className="mt-4 space-y-3"><p className="text-12 text-muted-foreground">{t("research.history.savedAt")}<time dateTime={previous.createdAt}>{previous.createdAt}</time></p>
      {previous.partial && <p className="text-12 text-muted-foreground" data-testid="previous-report-evidence-gap">{t("research.history.partial")}</p>}
      {!!previous.evidenceWarnings?.filter(warning => warning.reason === "invalid_model_evidence").length && <p className="text-12 text-muted-foreground" data-testid="previous-report-evidence-warning">{t("research.history.invalid", { count: previous.evidenceWarnings.filter(warning => warning.reason === "invalid_model_evidence").length })}</p>}
      {previous.evidenceWarnings?.some(warning => warning.reason === "batch_provider_content_rejected") && <p className="text-12 text-muted-foreground">{t("research.history.rejected")}</p>}
      {!!previous.qualityWarnings?.length && <p className="text-12 text-muted-foreground">{t("research.history.quality", { count: previous.qualityWarnings.length })}</p>}
      <GuidedResearchReportDocument document={document} provisional={!previous.report} historical idPrefix="previous-" />
      {!!document.unresolvedReferences && <p className="text-12 text-muted-foreground">{t("research.history.references", { count: document.unresolvedReferences! })}</p>}
    </div>
  </details>;
}
export function GuidedResearchEvidenceWarning({ state }: { state: GuidedResearchRuntime }) {
  const { t } = useI18n();
  const warnings = [...(state.sourceScreenRejections ?? []), ...(state.reportEvidenceWarnings ?? [])];
  const invalidCount = warnings.filter(warning => warning.reason === "invalid_model_evidence").length;
  if (!warnings.length || (!state.busy && (state.report || state.reportDraft))) return null;
  const generating = state.busy && !state.errorCode && (!state.leaseUntil || Date.parse(state.leaseUntil) > Date.now());
  return <aside className="space-y-2 rounded-lg border border-border bg-muted/30 p-4 text-12" data-testid="research-report-evidence-warning">
    <p role="status">{invalidCount ? t("research.evidenceWarning.invalidPrefix", { count: invalidCount }) : t("research.evidenceWarning.rejectedPrefix")}{state.report ? t("research.evidenceWarning.generated") : generating ? t("research.evidenceWarning.generating") : t("research.evidenceWarning.retained")}</p>
    <p>{t("research.evidenceWarning.gaps")}</p>
    {warnings.some(warning => warning.reason === "batch_provider_content_rejected") && <p>{t("research.evidenceWarning.rejected")}</p>}
  </aside>;
}
