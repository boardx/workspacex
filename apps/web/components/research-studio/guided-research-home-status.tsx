import { useI18n } from "@/lib/i18n/provider";
import { translate, type MessageKey } from "@/lib/i18n/messages";
import { DEFAULT_LOCALE, type Locale } from "@/lib/i18n/locale";
import { AlertTriangle, CheckCircle2, CircleDot, FileCheck2 } from "lucide-react";
import type { GuidedResearchSession } from "@/lib/guided-research-api";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";

export type GuidedResearchHomeFilter = "active" | "attention" | "completed";

const STAGE_PRESENTATION: Record<GuidedResearchSession["resumeStage"], {
  label: MessageKey;
  step: number;
  action: MessageKey;
}> = {
  brief: { label: "research.stage.brief", step: 1, action: "research.action.brief" },
  directions: { label: "research.stage.plan", step: 2, action: "research.action.plan" },
  outline: { label: "research.stage.plan", step: 2, action: "research.action.plan" },
  researching: { label: "research.stage.report", step: 3, action: "research.action.generate" },
  report: { label: "research.stage.report", step: 3, action: "research.action.report" },
};

export function guidedResearchHomePresentation(session: GuidedResearchSession, locale: Locale = DEFAULT_LOCALE) {
  const t = (key: MessageKey) => translate(locale, key);
  const stage = STAGE_PRESENTATION[session.resumeStage];
  const completed = session.status === "completed";
  const failed = session.status === "failed";
  const evidenceRequired = session.resumeStage === "researching" || session.resumeStage === "report";
  // Zero sources is the normal start of `researching` while collection runs; only a report with no
  // sources is an evidence gap that needs attention (mod-user-research SKILL, issue #4026).
  const missingEvidence = session.resumeStage === "report" && session.sourceCount === 0;
  return {
    ...stage,
    label: t(stage.label),
    step: completed ? 3 : stage.step,
    action: t(completed ? "research.action.report" : failed ? "research.action.recover" : stage.action),
    attention: failed || missingEvidence,
    attentionLabel: missingEvidence ? t("research.status.gap") : failed ? t("research.status.interrupted") : null,
    statusLabel: t(completed ? "ui.completed" : failed ? "research.status.failed" : stage.label),
    statusTone: "neutral" as const,
    evidenceLabel: missingEvidence
      ? t("research.evidence.missing")
      : evidenceRequired && session.sourceCount === 0 ? t("research.evidence.collecting")
      : evidenceRequired || completed ? translate(locale, "research.evidence.count", { count: session.sourceCount }) : t("research.evidence.design"),
  };
}

export function guidedResearchMatchesHomeFilter(session: GuidedResearchSession, filter: GuidedResearchHomeFilter | undefined) {
  if (filter === "active") return session.status !== "completed";
  if (filter === "attention") return guidedResearchHomePresentation(session).attention;
  if (filter === "completed") return session.status === "completed";
  return true;
}

export function GuidedResearchHomeSummary({ sessions, selectedFilter, onFilterChange }: {
  sessions: readonly GuidedResearchSession[];
  selectedFilter?: GuidedResearchHomeFilter;
  onFilterChange: (filter: GuidedResearchHomeFilter | undefined) => void;
}) {
  const { t } = useI18n();
  const active = sessions.filter((session) => session.status !== "completed").length;
  const attention = sessions.filter((session) => guidedResearchHomePresentation(session).attention).length;
  const completed = sessions.filter((session) => session.status === "completed").length;
  const items = [
    { id: "active" as const, label: t("ui.inProgress"), value: active, icon: CircleDot },
    { id: "attention" as const, label: t("research.summary.attention"), value: attention, icon: AlertTriangle },
    { id: "completed" as const, label: t("ui.completed"), value: completed, icon: CheckCircle2 },
  ];
  return <section data-testid="research-home-summary" aria-label={t("research.summary.label")} className="grid gap-3 sm:grid-cols-3">
    {items.map(({ id, label, value, icon: Icon }) => <button
      key={id}
      type="button"
      aria-label={t("research.summary.count", { label, count: value })}
      aria-pressed={selectedFilter === id}
      onClick={() => onFilterChange(selectedFilter === id ? undefined : id)}
      className={cn(
        "flex items-center gap-3 rounded-lg border bg-card px-4 py-3 text-left shadow-sm transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        selectedFilter === id ? "border-primary bg-accent" : "border-border",
      )}
    >
      <span className="flex size-8 items-center justify-center rounded-full bg-muted text-muted-foreground"><Icon className="size-4" aria-hidden /></span>
      <div><p className="text-11 text-muted-foreground">{label}</p><p className="text-18 font-semibold">{value}</p></div>
    </button>)}
  </section>;
}

export function GuidedResearchCardProgress({ session }: { session: GuidedResearchSession }) {
  const { t, locale } = useI18n();
  const presentation = guidedResearchHomePresentation(session, locale);
  return <div className="space-y-2" data-testid={`research-stage-${session.sessionId}`}>
    <div className="flex items-center justify-between gap-3">
      <div className="flex items-center gap-2">
        <FileCheck2 className="size-3.5 text-muted-foreground" aria-hidden />
        <span className="text-12 font-medium">{presentation.label}</span>
      </div>
      <span className="text-11 text-muted-foreground">{t("research.step.count", { step: presentation.step })}</span>
    </div>
    <Progress value={presentation.step} max={3} label={t("research.step.progress", { step: presentation.step, label: presentation.label })} tone="primary" />
    {presentation.attention && <div className="flex items-center justify-between gap-3">
      <span className="text-11 text-muted-foreground">{presentation.evidenceLabel}</span>
      {presentation.attentionLabel && <Badge tone="neutral">{presentation.attentionLabel}</Badge>}
    </div>}
  </div>;
}
