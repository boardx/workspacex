import { useI18n } from "@/lib/i18n/provider";
import { FileText, Users, Clock3, Target, CircleHelp, Lightbulb, LayoutGrid } from "lucide-react";

export function ResearchPrototypeTips({ topic = false }: { topic?: boolean }) {
  const { t } = useI18n();
  const rows = topic ? [
    [FileText, t("research.intake.topic"), t("research.tips.topic")],
    [Target, t("research.intake.goal"), t("research.tips.goal")],
    [LayoutGrid, t("research.intake.focus"), t("research.tips.focus")],
  ] as const : [
    [FileText, t("research.intake.goal"), t("research.tips.goalDescription")],
    [Users, t("research.tips.region"), t("research.tips.regionDescription")],
    [Clock3, t("research.intake.timeRange"), t("research.tips.time")],
    [Target, t("research.intake.focus"), t("research.tips.focusDescription")],
    [CircleHelp, t("research.tips.questions"), t("research.tips.questionsDescription")],
  ] as const;
  return <aside className="rounded-xl border border-border bg-card p-5 shadow-sm">
    <h2 className="flex items-center gap-2 text-lg font-bold"><Lightbulb className="size-5" aria-hidden />{t("research.tips.heading")}</h2>
    <p className="mt-2 border-b border-border pb-3 text-sm leading-snug text-muted-foreground">{topic ? t("research.tips.topicHint") : t("research.tips.intakeHint")}</p>
    <h3 className="mb-3 mt-3 text-sm font-semibold">{t(topic ? "research.tips.improve" : "research.tips.describe")}</h3>
    <div className="space-y-3">{rows.map(([Icon, title, description]) => <div key={title} className="flex gap-3"><span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted"><Icon className="size-5" aria-hidden /></span><div><h4 className="text-sm font-semibold">{title}</h4><p className="text-xs leading-snug text-muted-foreground">{description}</p></div></div>)}</div>
  </aside>;
}
