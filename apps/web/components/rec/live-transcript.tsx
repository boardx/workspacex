"use client";
import { recordingSpeakerDisplay, recordingSync, recordingTrackLabel, recordingTrackNote } from "./recording-project-display";
import { useI18n } from "@/lib/i18n/provider";
import * as React from "react";
import {
  Radio, Wifi, RefreshCw, Search, Quote, MapPin, AlertTriangle, MicOff, Mic,
  Languages, Eye, Play, FileAudio, ShieldAlert,
} from "lucide-react";
import { StateShell } from "@/components/state/state-shell";
import type { UiState } from "@/lib/ui-state";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Toggle } from "@/components/ui/toggle";
import { cn } from "@/lib/utils";
import { useRecScreenHref } from "./use-rec-screen-href";
import {
  SESSION, TRACKS, TRANSCRIPT, reviewCount, isQuotable,
  isReadOnlyRec, canWriteRec,
  type Carrier, type RecView, type TranscriptSegment,
} from "@/lib/mock/rec";

/**
 * UC-5.1 实时转录屏（F69–F73）——三载体共享。
 * 覆盖：多路录音状态 + 麦克风随时关闭 + 四常驻控件 + diarization 匿名声道 +
 *       重叠语音待人工指派 + 低置信待校对 + 正在识别中间态 + PII 五类遮盖 + file-first 物化。
 */
export function LiveTranscript({ state, carrier, view }: { state: UiState; carrier: Carrier; view: RecView }) {
  const { t: recT } = useI18n();
  const s = SESSION[carrier];
  const tracks = TRACKS[carrier];
  const readOnly = isReadOnlyRec(view);
  const canWrite = canWriteRec(view);

  const [query, setQuery] = React.useState("");
  const [autoFollow, setAutoFollow] = React.useState(true);
  const [micOn, setMicOn] = React.useState(true);
  const [currentTc, setCurrentTc] = React.useState<string | null>(null);

  const filtered = TRANSCRIPT.filter((seg) => !query || seg.maskedText.includes(query) || (seg.original ?? "").includes(query));

  return (
    <div className="flex flex-col gap-3 p-4">
      {/* ── 会话头部 + 实时状态条 ─────────────────────────────── */}
      <header className="flex flex-col gap-2" data-testid="rec-session-header">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div className="flex flex-col gap-0.5">
            <h1 className="text-18 font-semibold tracking-tight">{s.title}</h1>
            <p className="text-11 text-muted-foreground">{s.project} · {s.segment}</p>
          </div>
          <div className="flex items-center gap-1.5">
            <Badge tone="primary" data-testid="rec-auth-badge">{recT("rec.project.consent.34")}</Badge>
            <Badge tone="warning">{recT("rec.project.weber.opted.out.of.ai.analysis")}</Badge>
          </div>
        </div>

        {/* 实时状态：连接 / 录制 / 延迟具体秒数 / 语言方向 / 倒计时 / 同步 */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-md border border-border-subtle bg-panel px-3 py-2" data-testid="rec-realtime-bar">
          <span className="inline-flex items-center gap-1.5 text-11">
            <span className="h-1.5 w-1.5 rounded-full bg-success" aria-hidden />
            <Wifi aria-hidden className="h-3.5 w-3.5 text-muted-foreground" /> {s.connection === SESSION.interview.connection ? recT("rec.project.sessionConnected") : s.connection}
          </span>
          <span className="inline-flex items-center gap-1.5 text-11">
            <Radio aria-hidden className="h-3.5 w-3.5 text-destructive" /> {recT(({ workshop: "rec.project.sessionRecording.workshop", interview: "rec.project.sessionRecording.interview", thread: "rec.project.sessionRecording.thread" } as const)[carrier])}
          </span>
          <span className="inline-flex items-center gap-1 text-11" data-testid="rec-latency">

            {recT("rec.project.latency")} <strong className="font-mono tabular-nums">{s.latencySec}</strong>
          </span>
          {s.langDir && (
            <span className="inline-flex items-center gap-1 text-11" data-testid="rec-langdir">
              <Languages aria-hidden className="h-3.5 w-3.5 text-muted-foreground" /> {s.langDir === SESSION.interview.langDir ? recT("rec.project.sessionLang") : s.langDir}  {recT("rec.project.source.and.translation.on.separate.lines")}
            </span>
          )}
          <span className="text-11 tabular-nums">
            {s.elapsed} <span className="text-muted-foreground">/ {s.planned}</span>
          </span>
          <span className="inline-flex items-center gap-1 text-11 text-muted-foreground">
            <RefreshCw aria-hidden className="h-3 w-3" />  {recT("rec.project.sync.last.updated")} {recordingSync(recT, s.lastSync)}
          </span>
        </div>

        {/* 多路录音轨（AC1：4 路不串台；含 未录制/断网缓存/已关麦）*/}
        <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4" data-testid="rec-tracks">
          {tracks.map((t) => {
            const dot =
              t.status === "live" ? "bg-success"
              : t.status === "buffering" ? "bg-warning"
              : t.status === "declined" ? "bg-destructive"
              : "bg-muted";
            return (
              <div key={t.id} data-testid={`rec-track-${t.id}`} className="flex flex-col gap-0.5 rounded-md border border-border-subtle bg-card p-2">
                <div className="flex items-center gap-1.5">
                  <span className={cn("h-1.5 w-1.5 rounded-full", dot)} aria-hidden />
                  <span className="text-10 font-medium">{recordingTrackLabel(recT, carrier, t)}</span>
                </div>
                <span className="text-9 font-medium text-muted-foreground">{recT(({ live: "rec.project.track.live", buffering: "rec.project.track.buffering", paused: "rec.project.track.paused", declined: "rec.project.track.declined", muted: "rec.project.track.muted" } as const)[t.status])}</span>
                {t.note && <span className={cn("text-9", t.status === "declined" ? "text-destructive" : t.status === "buffering" ? "text-warning" : "text-muted-foreground")}>{recordingTrackNote(recT, t)}</span>}
              </div>
            );
          })}
        </div>

        {/* 麦克风权限：进场申请 + 随时关闭（关闭入口常驻可达，不藏二级设置）*/}
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border-subtle bg-card p-2.5" data-testid="rec-mic-control">
          <p className="inline-flex items-center gap-1.5 text-11 text-muted-foreground">
            <ShieldAlert aria-hidden className="h-3.5 w-3.5" />

            {recT("rec.project.microphone.access.was.requested.on.entry.for")} {" "}<strong className="font-medium text-background-foreground">{recT("rec.project.you.can.turn.it.off.at.any")}</strong>
          </p>
          <Button
            size="sm"
            variant={micOn ? "outline" : "destructive"}
            disabled={readOnly}
            onClick={() => setMicOn((v) => !v)}
            data-testid="group-mic-toggle"
          >
            {micOn ? <><Mic aria-hidden className="h-3.5 w-3.5" />  {recT("rec.project.microphone.on")}</> : <><MicOff aria-hidden className="h-3.5 w-3.5" />  {recT("rec.project.microphone.off.not.recording")}</>}
          </Button>
        </div>
        {!micOn && (
          <p className="rounded-md border border-warning/30 bg-warning/5 p-2 text-11 text-warning" role="status" data-testid="rec-mic-paused">

            {recT("rec.project.capture.for.this.track.has.stopped.with")}
          </p>
        )}
      </header>

      {/* ── 转录标签内四常驻控件：搜索 / 自动跟随（正在识别、常驻时间码在逐字稿内）── */}
      <div className="flex flex-wrap items-center gap-2" data-testid="rec-persistent-controls">
        <div className="relative min-w-40 flex-1">
          <Search aria-hidden className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={recT("rec.project.search.this.sessions.transcript.matches.highlighted")} className="pl-8" data-testid="rec-transcript-search" />
        </div>
        <div className="flex items-center gap-1.5 rounded-md border border-border-subtle bg-card px-2.5 py-1.5">
          <Eye aria-hidden className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-11">{recT("rec.project.autofollow")}</span>
          <Toggle checked={autoFollow} onCheckedChange={setAutoFollow} label={recT("rec.project.follow.the.latest.sentence")} data-testid="rec-auto-follow" />
          {!autoFollow && (
            <Button size="xs" variant="ghost" onClick={() => setAutoFollow(true)} data-testid="rec-back-to-latest">{recT("rec.project.back.to.latest")}</Button>
          )}
        </div>
        <Badge tone="warning" data-testid="rec-review-badge">{recT("rec.project.transcript.review")} {reviewCount()}</Badge>
      </div>

      {/* ── 七态主体 ──────────────────────────────────────────── */}
      <StateShell
        state={state}
        skeletonRows={6}
        emptyHint={recT("rec.project.this.session.has.no.transcript.yet.start")}
        errors={{
          "mic-permission": recT("rec.project.one.person.in.group.4.denied.microphone"),
          overlap: recT("rec.project.two.people.speak.at.seg07.3230.split"),
        }}
        depFailure={{ what: recT("rec.project.live.transcription.asr.whisperlargev3zh.is.temporarily.unavailable") }}
        denial={{
          layer: "project",
          reason: view === "member"
            ? recT("rec.project.group.members.can.view.only.their.groups")
            : recT("rec.project.your.project.role.cannot.view.unpublished.live"),
        }}
        successMessage={recT("rec.project.recording.ended.audio.and.transcriptjsonl.are.registered")}
      >
        <div className="flex flex-col gap-2.5">
          {readOnly && (
            <div className="flex items-start gap-2 rounded-md border border-border bg-muted p-2.5" data-testid="rec-readonly-banner">
              <ShieldAlert aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              <p className="text-11 text-muted-foreground">
                {view === "interviewee"
                  ? recT("rec.project.interviewee.view.only.your.consent.and.withdrawal")
                  : recT("rec.project.observer.view.unpublished.content.is.shown.as")}
              </p>
            </div>
          )}

          <ul className="flex flex-col gap-2.5" data-testid="itv-transcript">
            {filtered.map((seg) => (
              <SegmentRow key={seg.id} seg={seg} view={view} canWrite={canWrite && !readOnly} selected={currentTc === seg.anchor.tc} onSeek={() => setCurrentTc(seg.anchor.tc)} />
            ))}
          </ul>

          {/* file-first 物化提示（F73）：录制产物一律物化为文件，登记 22-files */}
          <div className="flex items-start gap-2 rounded-md border border-border-subtle bg-panel p-2.5" data-testid="rec-file-first">
            <FileAudio aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
            <p className="text-10 text-muted-foreground">

              {recT("rec.project.after.this.session.ends")} <strong className="font-medium text-background-foreground">音频.wav + transcript.jsonl</strong>
              {carrier === "interview" && <> {recT("rec.project.interviews.also.include")} <strong className="font-medium text-background-foreground">notes.md</strong>）</>}

              {recT("rec.project.are.available.in.22files.the.transcript.includes")} <code className="font-mono">derived_from</code>  {recT("rec.project.to.reference.the.original.audio.artifactversion.the")}
            </p>
          </div>
        </div>
      </StateShell>
    </div>
  );
}

/* ── 单条转录段 ──────────────────────────────────────────────── */

function SegmentRow({
  seg, view, canWrite, selected, onSeek,
}: {
  seg: TranscriptSegment;
  view: RecView;
  canWrite: boolean;
  selected: boolean;
  onSeek: () => void;
}) {
  const { t: recT } = useI18n();
  const reviewHref = useRecScreenHref("assign");
  const isOverlap = seg.status === "pending-manual";
  const isLowConf = seg.status === "low-confidence";
  const isPartial = seg.status === "partial";
  const quotable = isQuotable(seg);
  const speakerName = isOverlap ? recT("rec.project.overlapping.speech") : seg.anonChannel && !seg.assignedTo ? recT("rec.project.anonymousSpeaker", { channel: seg.anonChannel }) : recordingSpeakerDisplay(recT, seg.assignedTo, view);

  return (
    <li
      id={`rec-seg-${seg.id}`}
      data-testid={`itv-transcript-seg-${seg.id}`}
      className={cn(
        "scroll-mt-4 rounded-md border p-2.5 transition-colors duration-200",
        selected ? "border-primary bg-accent" : "border-border-subtle bg-card",
        isOverlap && "border-warning/40",
        isLowConf && "border-warning/30",
      )}
    >
      <div className="flex items-start gap-2.5">
        <Avatar
          initials={view === "observer" ? "·" : seg.assignedTo ? speakerName.slice(0, 1) : seg.anonChannel ?? "?"}
          tone={seg.assignedTo ? "human" : "muted"}
          size="sm"
        />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          {/* 头行：说话人 · 常驻时间码 · 徽章 */}
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-11 font-medium">{speakerName}</span>
            <button
              type="button"
              onClick={onSeek}
              data-testid={`rec-tc-${seg.id}`}
              className="inline-flex items-center gap-0.5 rounded-sm px-1 font-mono text-10 text-primary transition-colors duration-200 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              title={recT("rec.project.jump.to.this.position.in.the.audio")}
            >
              <Play aria-hidden className="h-2.5 w-2.5" /> {seg.anchor.tc}
            </button>
            {seg.anonChannel && !seg.assignedTo && !isOverlap && <Badge tone="outline">{recT("rec.project.unassigned.anonymous.channel")}</Badge>}
            {isOverlap && <Badge tone="warning" data-testid={`rec-overlap-${seg.id}`}>{recT("rec.project.overlapping.speakers.awaiting.assignment")}</Badge>}
            {isLowConf && <Badge tone="warning" data-testid={`rec-lowconf-${seg.id}`}>{recT("rec.project.low.recognition.confidence.review.required")}</Badge>}
            {isPartial && <Badge tone="neutral" data-testid={`rec-partial-${seg.id}`}>{recT("rec.project.recognizing")}</Badge>}
            {seg.original && <Badge tone="neutral"><Languages aria-hidden className="h-2.5 w-2.5" />  {recT("rec.project.foreign.language")}</Badge>}
            {seg.quote && <Badge tone="primary" data-testid={`rec-quote-${seg.id}`}><Quote aria-hidden className="h-2.5 w-2.5" />  {recT("rec.project.quoted")}{seg.quote.rq ? recT("rec.project.quoteSupport", { rq: seg.quote.rq }) : ""}</Badge>}
            {seg.aiMoment && <Badge tone="ai" data-testid={`rec-aimoment-${seg.id}`}><MapPin aria-hidden className="h-2.5 w-2.5" /> {seg.aiMoment.agent}  {recT("rec.project.marked.")} {seg.aiMoment.label} {recT("rec.project.pending.confirmation")}</Badge>}
          </div>

          {/* 外语两行 */}
          {seg.original && <p className="text-11 italic text-muted-foreground">{seg.original}</p>}
          <p className={cn("text-13 leading-relaxed", (isPartial || isLowConf || isOverlap) && "text-muted-foreground")}>{seg.maskedText}</p>

          {/* PII 遮盖就地说明（F72：查看原文需权限）*/}
          {seg.pii && seg.pii.length > 0 && (
            <p className="inline-flex flex-wrap items-center gap-1 rounded-md border border-border-subtle bg-muted px-2 py-1 text-10 text-muted-foreground" data-testid={`rec-pii-${seg.id}`}>
              <ShieldAlert aria-hidden className="h-3 w-3" />

              {recT("rec.project.automatically.masked")} {seg.pii.map((p) => recT(({ email: "rec.project.pii.email", phone: "rec.project.pii.phone", "id-card": "rec.project.pii.id-card", "bank-card": "rec.project.pii.bank-card", address: "rec.project.pii.address" } as const)[p])).join(recT("rec.project.and"))}  {recT("rec.project.viewing.originals.requires.separate.permission.and")}
              <Button size="xs" variant="ghost" disabled={!canWrite} data-testid={`rec-pii-reveal-${seg.id}`}>{recT("rec.project.view.original")}</Button>
            </p>
          )}

          {/* 引述 / 打点 动作；不稳定态显式禁用并给「去校对」出口 */}
          {isOverlap || isLowConf ? (
            <div className="flex flex-wrap items-center gap-1.5 rounded-md border border-warning/30 bg-warning/5 p-2" data-testid={`rec-blocked-quote-${seg.id}`}>
              <AlertTriangle aria-hidden className="h-3 w-3 text-warning" />
              <span className="text-10 text-warning">
                {isOverlap ? recT("rec.project.no.automatic.attribution.is.applied.split.this") : recT("rec.project.recognition.may.be.incorrect.review.the.text")}
              </span>
              <Button asChild size="xs" variant="outline" data-testid={`rec-goto-review-${seg.id}`}>
                <a href={reviewHref}>{recT("rec.project.review.")}</a>
              </Button>
            </div>
          ) : (
            <div className="flex items-center gap-1.5 pt-0.5">
              <Button size="xs" variant={seg.quote ? "primary" : "ghost"} disabled={!canWrite || !quotable} data-testid={`rec-mark-quote-${seg.id}`}>
                <Quote aria-hidden className="h-3 w-3" /> {seg.quote ? recT("rec.project.quoted") : recT("rec.project.quote")}
              </Button>
              <Button size="xs" variant="ghost" disabled={!canWrite || isPartial} data-testid={`rec-mark-moment-${seg.id}`}>
                <MapPin aria-hidden className="h-3 w-3" />  {recT("rec.project.mark.this.moment")}
              </Button>
              {isPartial && <span className="text-9 text-muted-foreground">{recT("rec.project.interim.text.cannot.be.quoted.or.searched")}</span>}
            </div>
          )}
        </div>
      </div>
    </li>
  );
}
