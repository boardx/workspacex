"use client";
import { recordingSpeakerDisplay, recordingVoiceprintNotice } from "./recording-project-display";
import { useI18n } from "@/lib/i18n/provider";
import * as React from "react";
import { UserPlus, Undo2, Play, AlertTriangle, ShieldCheck, Trash2, Split } from "lucide-react";
import { StateShell } from "@/components/state/state-shell";
import type { UiState } from "@/lib/ui-state";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  ANON_CHANNELS, ASSIGN_CANDIDATES, SPEAKERS, VOICEPRINT, TRANSCRIPT, reviewCount,
  speakerById, isReadOnlyRec, canWriteRec,
  type RecView, type TranscriptSegment,
} from "@/lib/mock/rec";

/**
 * UC-5.2 指派说话人 / 逐字稿校对屏（F74–F75）。
 * 左：匿名声道卡（时长占比 / 首现时间码 / 代表片段试听）→ 把在场名单里的人指派给整条声道。
 * 右：两态待处理段（低置信·待校对 / 两人同时说话·待人工指派），各有出口。
 * 指派 = 一次覆盖整声道全部段落，确认后引述出处/洞察/报告/图谱一处更新处处更新，可撤销。
 */
export function SpeakerAssign({ state, view }: { state: UiState; view: RecView }) {
  const { t: recT } = useI18n();
  const readOnly = isReadOnlyRec(view);
  const canWrite = canWriteRec(view) && !readOnly;

  // 本地指派状态：channel → speakerId | null（不真回填，演示可撤销）
  const [assign, setAssign] = React.useState<Record<string, string | null>>(
    () => Object.fromEntries(ANON_CHANNELS.map((c) => [c.channel, c.assignedTo])),
  );
  const [filter, setFilter] = React.useState<"all" | "low-confidence" | "pending-manual">("all");

  const assignedCount = Object.values(assign).filter(Boolean).length;
  const pending = TRANSCRIPT.filter((s) => s.status === "low-confidence" || s.status === "pending-manual");
  const shownPending = pending.filter((s) => filter === "all" || s.status === filter);

  return (
    <div className="flex flex-col gap-3 p-4">
      {/* 顶部进度口径（与「记录」标签计数一致）*/}
      <header className="flex flex-col gap-2" data-testid="rec-assign-header">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div className="flex flex-col gap-0.5">
            <h1 className="text-18 font-semibold tracking-tight">{recT("rec.project.transcript.review.assign.speakers")}</h1>
            <p className="text-11 text-muted-foreground">{recT("rec.project.group.3.interview.energy.storage.procurement.candidates")}</p>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge tone="primary" data-testid="rec-assign-progress">{recT("rec.project.assigned")} {assignedCount}/{ANON_CHANNELS.length}  {recT("rec.project.channels")}</Badge>
            <Badge tone="warning">{recT("rec.project.review.required")} {reviewCount()}</Badge>
          </div>
        </div>

        {/* 声纹 embedding 销毁提示（O-14）*/}
        <div className="flex items-start gap-2 rounded-md border border-border-subtle bg-panel p-2.5" data-testid="rec-voiceprint-note">
          <Trash2 aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
          <p className="text-10 text-muted-foreground">
            {recordingVoiceprintNotice(recT)}  {recT("rec.project.current.session")} {" "}
            <strong className="font-medium text-background-foreground">{VOICEPRINT.allAssigned ? recT("rec.project.all.assigned.embeddings.destroyed") : recT("rec.project.voiceprintFallback", { day: VOICEPRINT.fallbackDay })}</strong>。
          </p>
        </div>
      </header>

      <StateShell
        state={state}
        skeletonRows={5}
        emptyHint={recT("rec.project.no.anonymous.channels.need.assignment.all.segments")}
        errors={{
          concurrency: recT("rec.project.another.researcher.changed.this.sessions.assignments.refresh"),
          dispute: recT("rec.project.both.p10.and.p11.claimed.seg07.3230"),
        }}
        depFailure={{ what: recT("rec.project.candidate.ranking.through.the.context.api.is") }}
        denial={{ layer: "project", reason: recT("rec.project.only.facilitators.and.researchers.can.assign.speakers") }}
        successMessage={recT("rec.project.channel.c.was.assigned.to.p10.quote")}
      >
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
          {/* 左：匿名声道卡 */}
          <section className="flex flex-col gap-2" data-testid="rec-anon-channels">
            <h2 className="text-12 font-semibold text-muted-foreground">{recT("rec.project.anonymous.channels.speakers.a.b.c")}</h2>
            {ANON_CHANNELS.map((ch) => {
              const cur = assign[ch.channel];
              return (
                <div key={ch.channel} data-testid={`rec-channel-${ch.channel}`} className="flex flex-col gap-2 rounded-md border border-border-subtle bg-card p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Avatar initials={ch.channel} tone="muted" size="sm" />
                      <div className="flex flex-col">
                        <span className="text-12 font-medium">{recT("rec.project.speaker")} {ch.channel}</span>
                        <span className="text-9 text-muted-foreground">{recT("rec.project.speaking.time")} {ch.durationPct}{recT("rec.project.first.heard")} {ch.firstTc}</span>
                      </div>
                    </div>
                    {cur ? (
                      <Badge tone="primary" data-testid={`rec-channel-assigned-${ch.channel}`}>→ {recordingSpeakerDisplay(recT, cur, view)}</Badge>
                    ) : (
                      <Badge tone="outline">{recT("rec.project.source.needed")}</Badge>
                    )}
                  </div>

                  {/* 代表片段试听 */}
                  <div className="flex flex-wrap items-center gap-1">
                    <span className="text-9 text-muted-foreground">{recT("rec.project.representative.segment")}</span>
                    {ch.sampleClips.map((tc) => (
                      <Button key={tc} size="xs" variant="ghost" data-testid={`rec-clip-${ch.channel}-${tc}`}>
                        <Play aria-hidden className="h-2.5 w-2.5" /> {tc}
                      </Button>
                    ))}
                  </div>

                  {/* 指派候选（只来自本场在场名单；授权未完成者显式排除）*/}
                  <div className="flex flex-wrap items-center gap-1.5">
                    {ASSIGN_CANDIDATES.map((sp) => (
                      <Button
                        key={sp.id}
                        size="xs"
                        variant={cur === sp.id ? "primary" : "outline"}
                        disabled={!canWrite || !sp.authComplete}
                        onClick={() => setAssign((m) => ({ ...m, [ch.channel]: sp.id }))}
                        data-testid={`rec-assign-${ch.channel}-${sp.id}`}
                        title={sp.authComplete ? recT("rec.project.assign.entire.channel") : recT("rec.project.consent.is.incomplete.this.person.is.excluded")}
                      >
                        <UserPlus aria-hidden className="h-3 w-3" /> {sp.alias ?? sp.realName}
                        {!sp.authComplete && recT("rec.project.no.consent")}
                      </Button>
                    ))}
                    {cur && (
                      <Button size="xs" variant="ghost" disabled={!canWrite} onClick={() => setAssign((m) => ({ ...m, [ch.channel]: null }))} data-testid={`rec-unassign-${ch.channel}`}>
                        <Undo2 aria-hidden className="h-3 w-3" />  {recT("rec.project.undo.assignment")}
                      </Button>
                    )}
                  </div>
                  {cur && (
                    <p className="inline-flex items-center gap-1 text-9 text-muted-foreground" data-testid={`rec-backfill-${ch.channel}`}>
                      <ShieldCheck aria-hidden className="h-3 w-3 text-success" />

                      {recT("rec.project.the.whole.channel.is.assigned.quotes.insights")}
                    </p>
                  )}
                </div>
              );
            })}
            <p className="text-9 text-muted-foreground">

              {recT("rec.project.candidates.come.only.from.this.sessions.attendance")}{SPEAKERS.filter((s) => s.onsite && s.authComplete).length}  {recT("rec.project.people.present.with.consent")}
              {" "}<strong className="font-medium text-background-foreground">{recT("rec.project.no.voiceprint.matching.across.sessions.is.performed")}</strong>{" "}{recT("rec.project.a.person.always.makes.the.assignment")}
            </p>
          </section>

          {/* 右：两态待处理段落 */}
          <section className="flex flex-col gap-2" data-testid="rec-pending-segments">
            <div className="flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:justify-between">
              <h2 className="text-12 font-semibold text-muted-foreground">{recT("rec.project.segments.requiring.action.cannot.be.quoted.until")}</h2>
              <div className="flex max-w-full flex-wrap rounded-md border border-border" data-testid="rec-pending-filter">
                {([["all", recT("rec.project.all")], ["pending-manual", recT("rec.project.assignment.required")], ["low-confidence", recT("rec.project.review.required")]] as const).map(([k, label]) => (
                  <Button key={k} size="xs" className="shrink-0" variant={filter === k ? "primary" : "ghost"} onClick={() => setFilter(k)} data-testid={`rec-filter-${k}`}>{label}</Button>
                ))}
              </div>
            </div>
            {shownPending.length === 0 ? (
              <p className="rounded-md border border-dashed border-border py-8 text-center text-11 text-muted-foreground" data-testid="rec-pending-empty">{recT("rec.project.no.segments.need.action.for.this.filter")}</p>
            ) : (
              shownPending.map((seg) => <PendingRow key={seg.id} seg={seg} view={view} canWrite={canWrite} />)
            )}
          </section>
        </div>
      </StateShell>
    </div>
  );
}

function PendingRow({ seg, view, canWrite }: { seg: TranscriptSegment; view: RecView; canWrite: boolean }) {
  const { t: recT } = useI18n();
  const isOverlap = seg.status === "pending-manual";
  const [picked, setPicked] = React.useState<string | null>(null);
  return (
    <div data-testid={`rec-pending-${seg.id}`} className={cn("flex flex-col gap-2 rounded-md border p-2.5", isOverlap ? "border-warning/40 bg-warning/5" : "border-warning/30 bg-warning/5")}>
      <div className="flex items-center gap-1.5">
        <Badge tone="warning">{isOverlap ? recT("rec.project.overlapping.speakers.awaiting.assignment") : recT("rec.project.low.recognition.confidence.review.required")}</Badge>
        <span className="font-mono text-10 text-muted-foreground">{seg.anchor.tc}</span>
      </div>
      <p className="text-12 text-muted-foreground">{seg.maskedText}</p>
      {seg.original && <p className="text-11 italic text-muted-foreground">{seg.original}</p>}

      {isOverlap ? (
        <div className="flex flex-col gap-1.5">
          <p className="inline-flex items-center gap-1 text-10 font-medium text-warning">
            <AlertTriangle aria-hidden className="h-3 w-3" />  {recT("rec.project.assign.each.sentence.to.its.speaker.or")}
          </p>
          <div className="flex flex-wrap items-center gap-1.5">
            {(seg.overlapCandidates ?? []).map((cid) => (
              <Button key={cid} size="xs" variant={picked === cid ? "primary" : "outline"} disabled={!canWrite} onClick={() => setPicked(cid)} data-testid={`rec-overlap-pick-${seg.id}-${cid}`}>

                {recT("rec.project.assign.to")} {speakerById(cid)?.alias ?? recordingSpeakerDisplay(recT, cid, view)}
              </Button>
            ))}
            <Button size="xs" variant="ghost" disabled={!canWrite} data-testid={`rec-overlap-split-${seg.id}`}>
              <Split aria-hidden className="h-3 w-3" />  {recT("rec.project.split.into.two.segments")}
            </Button>
            <Button size="xs" variant="ghost" disabled={!canWrite} onClick={() => setPicked("pending")} data-testid={`rec-overlap-keep-${seg.id}`}>{recT("rec.project.leave.unassigned")}</Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-1.5">
          <Button size="xs" variant="outline" disabled={!canWrite} data-testid={`rec-fix-text-${seg.id}`}>{recT("rec.project.correct.text.manually")}</Button>
          <span className="text-9 text-muted-foreground">{recT("rec.project.the.preview.adds.a.textcorrection.control.review")}</span>
        </div>
      )}
    </div>
  );
}
