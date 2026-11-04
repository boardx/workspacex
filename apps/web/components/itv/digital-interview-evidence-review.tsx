"use client";
import { useI18n } from "@/lib/i18n/provider";

import * as React from "react";
import { CheckCircle2, CircleAlert, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { DigitalInterviewWorkflowView } from "@/lib/interview-api";

export function DigitalInterviewEvidenceReview({ view, pending, onReview }: { readonly view: DigitalInterviewWorkflowView;
  readonly pending?: boolean; readonly onReview?: (status: "approved" | "changes_requested", note: string | null) => void }) {
 const { t } = useI18n();
  const [note, setNote] = React.useState(view.reportReview?.note ?? "");
  const blocked = !view.researchBrief || view.quality.evidenceCoverage.some((cell) => cell.status === "missing");
  return <section data-testid="itv-evidence-review" className="mt-5 rounded-xl border border-border bg-card p-5"><header><p className="text-xs font-medium text-primary">{t("itv.review.eyebrow")}</p><h3 className="mt-1 font-semibold">{t("itv.review.title")}</h3>
    <p className="mt-1 text-sm text-muted-foreground">{t("itv.review.hint")}</p></header>
    {view.quality.evidenceCoverage.length === 0 ? <div data-testid="itv-evidence-review-blocked" className="mt-4 rounded-lg border border-dashed border-warning/40 bg-warning/5 p-4 text-sm"><p className="font-medium">{t("itv.review.emptyTitle")}</p><p className="mt-1 text-muted-foreground">{t("itv.review.emptyHint")}</p></div> : <div className="mt-3 overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr><th className="p-2">{t("itv.review.goal")}</th><th className="p-2">{t("itv.review.expert")}</th><th className="p-2">{t("itv.review.status")}</th><th className="p-2">{t("itv.review.counts")}</th></tr></thead><tbody>{view.quality.evidenceCoverage.map((cell) => { const Icon = cell.status === "supported" ? CheckCircle2 : cell.status === "missing" ? XCircle : CircleAlert; return <tr key={`${cell.goalId}-${cell.expertId}`} className="border-t border-border"><td className="p-2">{cell.goalId}</td><td className="p-2">{cell.expertId}</td><td className="p-2"><span className="inline-flex items-center gap-1"><Icon className="size-4" aria-hidden />{t(cell.status === "supported" ? "itv.review.supported" : cell.status === "missing" ? "itv.review.missing" : "itv.review.partial")}</span></td><td className="p-2">{cell.answerCount} / {cell.findingCount} / {cell.counterexampleCount}</td></tr>; })}</tbody></table></div>}
    <p className="mt-3 rounded-lg border border-warning/30 bg-warning/5 p-3 text-xs">{t("itv.review.boundary")}</p>
    <div className="mt-4 border-t border-border pt-4"><p className="text-sm font-medium">{t("itv.review.reviewStatus", { status: t(view.reportReview?.status === "approved" ? "itv.review.approved" : view.reportReview?.status === "changes_requested" ? "itv.review.changesRequested" : "itv.review.pending") })}</p><label className="mt-3 grid gap-2 text-sm">{t("itv.review.notes")}<textarea className="rounded-lg border border-input bg-background px-3 py-2" rows={3} value={note} onChange={(event) => setNote(event.target.value)} /></label>{blocked && <p className="mt-2 text-sm text-destructive">{t("itv.review.blocked")}</p>}<div className="mt-3 flex flex-wrap gap-2"><Button variant="outline" disabled={pending} onClick={() => onReview?.("changes_requested", note.trim() || null)}>{t("itv.review.changes")}</Button><Button variant="primary" disabled={pending || blocked} onClick={() => onReview?.("approved", note.trim() || null)}>{t("itv.review.approve")}</Button></div></div>
  </section>;
}
