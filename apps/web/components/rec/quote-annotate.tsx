"use client";
import { recordingSpeakerDisplay } from "./recording-project-display";
import { useI18n } from "@/lib/i18n/provider";
import * as React from "react";
import { Sparkles, Quote, Check, Pencil, X, Eye, Play, Link2, AlertTriangle } from "lucide-react";
import { StateShell } from "@/components/state/state-shell";
import type { UiState } from "@/lib/ui-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useRecScreenHref } from "./use-rec-screen-href";
import {
  AI_MOMENTS, RESEARCH_QUESTIONS, TRANSCRIPT, isQuotable,
  isReadOnlyRec, canWriteRec,
  type RecView, type AiMomentCandidate, type EvidenceNatureView,
} from "@/lib/mock/rec";

/**
 * UC-5.3 引述与打点屏（F76–F77）。
 * 上：人工标引述 → 绑定 RQ + 记录证据性质（个人经历/二手转述/观点）；不稳定态段落拒绝引述。
 * 下：AI 自动打点候选队列（集中一处批量处理）—— origin:ai 带 agent 角标、落候选态、
 *     [看洞察] 依据出口、三出口（确认/编辑后确认/忽略）、依据被撤回则自动失效。
 */
export function QuoteAnnotate({ state, view }: { state: UiState; view: RecView }) {
  const { t: recT } = useI18n();
  const reviewHref = useRecScreenHref("assign");
  const readOnly = isReadOnlyRec(view);
  const canWrite = canWriteRec(view) && !readOnly;

  return (
    <div className="flex flex-col gap-3 p-4">
      <header className="flex flex-col gap-0.5" data-testid="rec-annotate-header">
        <h1 className="text-18 font-semibold tracking-tight">{recT("rec.project.quotes.and.markers")}</h1>
        <p className="text-11 text-muted-foreground">

          {recT("rec.project.quotes.reference.an.anchor.in.transcriptjsonl.without")}
        </p>
      </header>

      <StateShell
        state={state}
        skeletonRows={5}
        emptyHint={recT("rec.project.no.quotes.or.ai.marker.candidates.yet")}
        errors={{
          "quote-unstable": recT("rec.project.seg06.3205.review.required.and.seg07.3230"),
          "quote-partial": recT("rec.project.seg08.3310.is.interim.recognition.it.cannot"),
        }}
        depFailure={{ what: recT("rec.project.ai.marker.generation.through.the.context.api") }}
        denial={{ layer: "project", reason: recT("rec.project.only.facilitators.and.researchers.can.quote.text") }}
        successMessage={recT("rec.project.avas.decisionpoint.marker.was.confirmed.with.timecode")}
      >
        <div className="flex flex-col gap-4">
          {/* 已标引述 + RQ 绑定 + 证据性质 */}
          <section className="flex flex-col gap-2" data-testid="rec-quotes">
            <h2 className="text-12 font-semibold text-muted-foreground">{recT("rec.project.quotes.linked.to.rqs.evidence.type.recorded")}</h2>
            {TRANSCRIPT.filter((s) => s.quote).map((s) => (
              <div key={s.id} data-testid={`rec-quote-row-${s.id}`} className="flex flex-col gap-1.5 rounded-md border border-border-subtle bg-card p-2.5">
                <div className="flex flex-wrap items-center gap-1.5">
                  <Badge tone="primary"><Quote aria-hidden className="h-2.5 w-2.5" />  {recT("rec.project.quote.130")}</Badge>
                  <span className="font-mono text-10 text-primary"><Play aria-hidden className="inline h-2.5 w-2.5" /> {s.anchor.tc}</span>
                  <span className="text-10 text-muted-foreground">· {recordingSpeakerDisplay(recT, s.assignedTo, view)}</span>
                  {s.quote?.rq && <Badge tone="ai" data-testid={`rec-quote-rq-${s.id}`}><Link2 aria-hidden className="h-2.5 w-2.5" />  {recT("rec.project.supports")} {s.quote.rq}</Badge>}
                  <Badge tone="outline" data-testid={`rec-quote-nature-${s.id}`}>{recT(({ personal: "rec.project.evidenceNature.personal", secondhand: "rec.project.evidenceNature.secondhand", opinion: "rec.project.evidenceNature.opinion" } as const)[s.quote!.nature])}</Badge>
                </div>
                <p className="text-12">{s.maskedText}</p>
                {/* RQ 绑定编辑器（示意）*/}
                <div className="flex flex-wrap items-center gap-1">
                  <span className="text-9 text-muted-foreground">{recT("rec.project.change.rq.link")}</span>
                  {RESEARCH_QUESTIONS.map((rq) => (
                    <Button key={rq.id} size="xs" variant={s.quote?.rq === rq.id ? "primary" : "outline"} disabled={!canWrite} data-testid={`rec-bind-${s.id}-${rq.id}`} title={rq.label}>{rq.id}</Button>
                  ))}
                </div>
              </div>
            ))}
            <p className="text-9 text-muted-foreground">{recT("rec.project.this.link.is.used.directly.by.uc64")}</p>
          </section>

          {/* 不稳定态段落：显式拒绝引述并给去校对出口 */}
          <section className="flex flex-col gap-1.5" data-testid="rec-unquotable">
            <h2 className="text-12 font-semibold text-muted-foreground">{recT("rec.project.segments.unavailable.for.quoting.interim.review.assignment")}</h2>
            {TRANSCRIPT.filter((s) => !isQuotable(s)).map((s) => (
              <div key={s.id} data-testid={`rec-unquotable-${s.id}`} className="flex flex-wrap items-center gap-1.5 rounded-md border border-warning/30 bg-warning/5 p-2">
                <AlertTriangle aria-hidden className="h-3 w-3 text-warning" />
                <span className="font-mono text-10 text-muted-foreground">{s.anchor.tc}</span>
                <Badge tone="warning">{s.status === "partial" ? recT("rec.project.recognizing.135") : s.status === "low-confidence" ? recT("rec.project.review.required") : recT("rec.project.assignment.required")}</Badge>
                <span className="text-10 text-warning">{recT("rec.project.quoting.rejected.uncertain.text.cannot.become.evidence")}</span>
                <Button asChild size="xs" variant="outline"><a href={reviewHref}>{recT("rec.project.review.")}</a></Button>
              </div>
            ))}
          </section>

          {/* AI 打点候选队列 */}
          <section className="flex flex-col gap-2" data-testid="rec-ai-moments">
            <div className="flex items-center gap-1.5">
              <Sparkles aria-hidden className="h-4 w-4 text-ai" />
              <h2 className="text-12 font-semibold">{recT("rec.project.ai.marker.candidates.excluded.from.evidence.reports")}</h2>
            </div>
            {AI_MOMENTS.map((m) => <AiMomentCard key={m.id} m={m} canWrite={canWrite} />)}
          </section>
        </div>
      </StateShell>
    </div>
  );
}

function AiMomentCard({ m, canWrite }: { m: AiMomentCandidate; canWrite: boolean }) {
  const { t: recT } = useI18n();
  const [showBasis, setShowBasis] = React.useState(false);
  const [decision, setDecision] = React.useState<"none" | "confirmed" | "ignored">("none");

  if (m.invalidated) {
    return (
      <div data-testid={`rec-aimoment-${m.id}`} className="flex flex-col gap-1 rounded-md border border-border-subtle bg-muted p-2.5 opacity-100">
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge tone="ai">{m.agent} · {m.label}</Badge>
          <span className="font-mono text-10 text-muted-foreground">{m.tc}</span>
          <Badge tone="danger" data-testid={`rec-aimoment-invalid-${m.id}`}>{recT("rec.project.candidate.invalidated")}</Badge>
        </div>
        <p className="text-11 text-muted-foreground line-through">{m.snippet}</p>
        <p className="text-9 text-muted-foreground">{recT("rec.project.the.source.segment.was.withdrawn.or.rewritten")}</p>
      </div>
    );
  }

  return (
    <div data-testid={`rec-aimoment-${m.id}`} className={cn("flex flex-col gap-2 rounded-md border p-2.5", decision === "confirmed" ? "border-success/40 bg-success/5" : decision === "ignored" ? "border-border-subtle bg-muted" : "border-ai/30 bg-ai-tint/40")}>
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge tone="ai" data-testid={`rec-aimoment-badge-${m.id}`}><Sparkles aria-hidden className="h-2.5 w-2.5" /> {m.agent}  {recT("rec.project.marked.as")} {m.label}</Badge>
        <span className="font-mono text-10 text-muted-foreground">{m.tc}</span>
        {decision === "none" && <Badge tone="warning">{recT("rec.project.candidate.unconfirmed")}</Badge>}
        {decision === "confirmed" && <Badge tone="primary" data-testid={`rec-aimoment-confirmed-${m.id}`}>{recT("rec.project.confirmed.in.evidence.library")}</Badge>}
        {decision === "ignored" && <Badge tone="neutral" data-testid={`rec-aimoment-ignored-${m.id}`}>{recT("rec.project.ignored.retained.for.improvement")}</Badge>}
      </div>
      <p className="text-12">{m.snippet}</p>

      <div className="flex flex-wrap items-center gap-1.5">
        <Button size="xs" variant="ghost" onClick={() => setShowBasis((v) => !v)} data-testid={`rec-aimoment-basis-${m.id}`}>
          <Eye aria-hidden className="h-3 w-3" />  {recT("rec.project.view.supporting.insight")}
        </Button>
        {decision === "none" && (
          <>
            <Button size="xs" variant="primary" disabled={!canWrite} onClick={() => setDecision("confirmed")} data-testid={`rec-aimoment-confirm-${m.id}`}><Check aria-hidden className="h-3 w-3" />  {recT("rec.project.confirm")}</Button>
            <Button size="xs" variant="outline" disabled={!canWrite} data-testid={`rec-aimoment-edit-${m.id}`}><Pencil aria-hidden className="h-3 w-3" />  {recT("rec.project.edit.and.confirm")}</Button>
            <Button size="xs" variant="ghost" disabled={!canWrite} onClick={() => setDecision("ignored")} data-testid={`rec-aimoment-ignore-${m.id}`}><X aria-hidden className="h-3 w-3" />  {recT("rec.project.ignore")}</Button>
          </>
        )}
        {decision !== "none" && (
          <Button size="xs" variant="ghost" onClick={() => setDecision("none")} data-testid={`rec-aimoment-undo-${m.id}`}>{recT("rec.project.undo.this.decision")}</Button>
        )}
      </div>

      {showBasis && (
        <p className="rounded-md border border-border-subtle bg-card p-2 text-10 text-muted-foreground" data-testid={`rec-aimoment-basis-panel-${m.id}`}>

          {recT("rec.project.basis.traceable.to.source.segment")} {m.tc} · segmentId {m.segId}）：{m.basis}
        </p>
      )}
    </div>
  );
}
