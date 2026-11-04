"use client";
import { recordingFixedDisplay } from "./recording-project-display";
import { useRecordingNotice } from "./use-recording-notice";
import { useI18n } from "@/lib/i18n/provider";
import { Play, Volume2, ShieldCheck } from "lucide-react";
import { Toast } from "@/components/admin/panel";
import { StateShell } from "@/components/state/state-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { UiState } from "@/lib/ui-state";
import { isReadOnlyRec, canWriteRec, type RecView } from "@/lib/mock/rec";
import {
  VERIFY_NAV_SPEAKERS, VERIFY_CHAPTERS, VERIFY_MARKS, VERIFY_ITEMS,
  VERIFY_THEMES, VERIFY_META,
} from "@/lib/mock/rec-v2";

/**
 * 逐字稿校对 · 播放器 + 章节 + 低置信改词 + 「确认后才进正式证据库」（原型 16125909）。
 *
 * v1 缺失点：只有只读逐字稿结果，没有校对交互。此屏还原原型的三栏校对台：
 *   左（导航：发言人占比 / 章节 / 标记）· 中（播放器 + 低置信改词 + 发言人不确定的行内决策）·
 *   右（AI 识别的主题与证据 + 「待你判断」附和处理 + 确认才进证据库）。
 */
export function RecVerify({ state, view }: { state: UiState; view: RecView }) {
  const { t: recT } = useI18n();
  const readOnly = isReadOnlyRec(view);
  const canWrite = canWriteRec(view) && !readOnly;
  const fixedCaptionKeys = {
    speakers: { uncertain: "rec.project.verify.uncertainSpeaker" },
    markers: { quote: "rec.project.quote.130", pain: "rec.project.verify.painMarker" },
    hints: { "speaker-uncertain": "rec.project.verify.overlapHint" },
    themes: { judge: "rec.project.verify.reviewNeeded" },
  } as const;
  const correctionKeys = { listen: "rec.project.correction.listen", replace: "rec.project.correction.replace", keep: "rec.project.correction.keep", weber: "rec.project.correction.weber", kraus: "rec.project.correction.kraus", split: "rec.project.correction.split", confirm: "rec.project.correction.confirm", rename: "rec.project.correction.rename" } as const;
  const [toast, setToast] = useRecordingNotice();

  return (
    <div className="flex flex-col gap-3 p-4" data-testid="rec-verify">
      <header className="flex flex-wrap items-center gap-2">
        <h1 className="text-18 font-semibold tracking-tight">{recT("rec.project.verify.title")}</h1>
        <Badge tone="warning" data-testid="rec-verify-pending-badge">{recT("rec.project.verify.pending")}</Badge>
        <div className="flex-1" />
        <Button size="sm" variant="primary" disabled={!canWrite} onClick={() => setToast({ key: "rec.project.14.items.confirmed.the.transcript.is.added" })} data-testid="rec-verify-commit">
          {recT("rec.project.verify.commit")}
        </Button>
      </header>

      <StateShell
        state={state}
        skeletonRows={6}
        emptyHint={recT("rec.project.no.segments.need.review.all.transcript.segments")}
        errors={{
          confidence: recT("rec.project.a.correction.at.003205.conflicts.with.another"),
        }}
        depFailure={{ what: recT("rec.project.audio.playback.is.temporarily.unavailable.transcript.text") }}
        denial={{ layer: "project", reason: recT("rec.project.only.facilitators.and.researchers.can.review.and") }}
        successMessage={recT("rec.project.14.items.confirmed.the.transcript.is.added.27")}
      >
        <div className="grid gap-3 lg:grid-cols-[184px_minmax(260px,1fr)_280px]">
          {/* 左：导航 */}
          <nav className="flex flex-col gap-3" data-testid="rec-verify-nav">
            <div className="flex flex-col gap-1.5">
              <span className="text-10 font-medium text-muted-foreground">{recT("rec.project.speakers")}</span>
              {VERIFY_NAV_SPEAKERS.map((s) => (
                <div
                  key={s.id}
                  data-testid={`rec-verify-navspeaker-${s.id}`}
                  className={cn(
                    "flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-10",
                    s.tone === "uncertain" ? "border-destructive/40 bg-destructive/5" : "border-border-subtle",
                  )}
                >
                  <span className="h-2.5 w-2.5 shrink-0 rounded-sm bg-muted" />
                  <span className={cn("flex-1", s.tone === "uncertain" && "text-destructive")}>{recordingFixedDisplay(recT, fixedCaptionKeys.speakers, s.id, s.name)}</span>
                  <span className={cn("font-mono text-9", s.tone === "uncertain" ? "text-destructive" : "text-muted-foreground")}>
                    {s.count != null ? s.count : `${s.pct}%`}
                  </span>
                </div>
              ))}
            </div>
            <div className="flex flex-col gap-1.5">
              <span className="text-10 font-medium text-muted-foreground">{recT("rec.project.chapters")}</span>
              {VERIFY_CHAPTERS.map((c) => (
                <div
                  key={c.id}
                  data-testid={`rec-verify-chapter-${c.id}`}
                  className={cn(
                    "rounded-md border px-2.5 py-1.5 text-10",
                    c.active ? "border-inverse bg-panel font-medium" : "border-border-subtle",
                  )}
                >
                  {c.name}
                </div>
              ))}
            </div>
            <div className="flex flex-col gap-1.5">
              <span className="text-10 font-medium text-muted-foreground">{recT("rec.project.markers")}</span>
              {VERIFY_MARKS.map((m) => (
                <div key={m.id} className="flex items-center rounded-md border border-border-subtle px-2.5 py-1.5 text-10">
                  <span className="flex-1">{recordingFixedDisplay(recT, fixedCaptionKeys.markers, m.id, m.label)}</span>
                  <span className="font-mono text-9 text-muted-foreground">{m.count}</span>
                </div>
              ))}
            </div>
          </nav>

          {/* 中：播放器 + 逐字稿改词 */}
          <section className="flex flex-col gap-2.5" data-testid="rec-verify-transcript">
            {/* 播放器 */}
            <div className="flex items-center gap-3 rounded-lg border border-border-subtle bg-card p-3" data-testid="rec-verify-player">
              <Button size="icon" variant="outline" aria-label={recT("rec.project.play")} onClick={() => setToast({ key: "rec.project.play.3104.6812.preview.no.audio.playback" })} data-testid="rec-verify-play">
                <Play aria-hidden className="h-3 w-3" />
              </Button>
              <div className="relative h-1 flex-1 overflow-hidden rounded-full bg-muted">
                <div className="h-full bg-inverse" style={{ width: `${VERIFY_META.progressPct}%` }} />
              </div>
              <span className="shrink-0 font-mono text-9 text-muted-foreground">{VERIFY_META.duration}</span>
            </div>

            {/* 逐字稿段 */}
            {VERIFY_ITEMS.map((it) => (
              <div key={it.id} className="flex gap-2.5" data-testid={`rec-verify-item-${it.id}`}>
                <span className="w-12 shrink-0 pt-0.5 font-mono text-9 text-muted-foreground">{it.tc}</span>
                {it.kind === "plain" && (
                  <div className="min-w-0 flex-1">
                    {it.speaker && <p className="mb-1 text-10 font-medium">{it.speaker}</p>}
                    <p className="text-11 leading-relaxed text-background-foreground">{it.text}</p>
                  </div>
                )}
                {it.kind === "low-confidence" && it.lowConf && (
                  <div className="min-w-0 flex-1 rounded-lg border border-warning/40 bg-warning/5 p-2.5">
                    <div className="mb-1.5 flex items-center gap-2">
                      <span className="font-mono text-9 text-warning">{recT("rec.project.low.confidence.proper.noun")}</span>
                      <span className="flex-1" />
                      <span className="font-mono text-9 text-muted-foreground">{it.lowConf.score}</span>
                    </div>
                    <p className="mb-2 text-11 leading-relaxed">
                      我们法务只认 <span className="border-b-[1.5px] border-dashed border-warning">{it.lowConf.term}</span>。
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {it.lowConf.actions.map((a, i) => (
                        <Button
                          key={a}
                          size="xs"
                          variant={i === 0 ? "primary" : "outline"}
                          disabled={i !== 0 && !canWrite}
                          onClick={() => setToast({ key: "rec.project.correctionNotice", params: { term: it.lowConf!.term }, translatedParams: { action: ([correctionKeys.listen, correctionKeys.replace, correctionKeys.keep] as const)[i] ?? correctionKeys.keep } })}
                          data-testid={`rec-verify-lowconf-${it.id}-${i}`}
                        >
                          {i === 0 && <Volume2 aria-hidden className="h-2.5 w-2.5" />} {recT(([correctionKeys.listen, correctionKeys.replace, correctionKeys.keep] as const)[i] ?? correctionKeys.keep)}
                        </Button>
                      ))}
                    </div>
                  </div>
                )}
                {it.kind === "speaker-uncertain" && it.speakerUncertain && (
                  <div className="min-w-0 flex-1 rounded-lg border border-border-subtle bg-card p-2.5">
                    <p className="mb-1.5 font-mono text-9 text-muted-foreground">{recordingFixedDisplay(recT, fixedCaptionKeys.hints, it.kind, it.speakerUncertain.note)}</p>
                    <p className="mb-2 text-11 leading-relaxed">{it.text}</p>
                    <div className="flex flex-wrap gap-1.5">
                      {it.speakerUncertain.actions.map((a, i) => (
                        <Button
                          key={a}
                          size="xs"
                          variant="outline"
                          disabled={!canWrite}
                          onClick={() => setToast({ key: "rec.project.actionNotice", translatedParams: { action: ([correctionKeys.weber, correctionKeys.kraus, correctionKeys.split] as const)[i] ?? correctionKeys.split } })}
                          data-testid={`rec-verify-speaker-${it.id}-${i}`}
                        >
                          {recT(([correctionKeys.weber, correctionKeys.kraus, correctionKeys.split] as const)[i] ?? correctionKeys.split)}
                        </Button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </section>

          {/* 右：AI 识别的主题与证据 + 确认进证据库 */}
          <aside className="flex flex-col gap-2" data-testid="rec-verify-themes">
            <span className="text-11 font-medium">{recT("rec.project.aiidentified.themes.and.evidence")}</span>
            {VERIFY_THEMES.map((t) => (
              <div
                key={t.id}
                data-testid={`rec-verify-theme-${t.id}`}
                className={cn(
                  "rounded-lg border p-2.5",
                  t.kind === "judge" ? "border-warning/40 bg-warning/5" : "border-border-subtle bg-card",
                )}
              >
                <p className="mb-1 text-11 font-medium">{recordingFixedDisplay(recT, fixedCaptionKeys.themes, t.kind, t.name)}</p>
                {t.meta && <p className="text-10 leading-relaxed text-muted-foreground">{t.meta}</p>}
                {t.note && <p className="text-10 leading-relaxed text-muted-foreground">{t.note}</p>}
                {t.actions && (
                  <div className="mt-2 flex gap-1.5">
                    {t.actions.map((a, i) => (
                      <Button key={a} size="xs" variant={i === 0 ? "primary" : "outline"} disabled={!canWrite} onClick={() => setToast({ key: "rec.project.themeNotice", params: { name: t.name }, translatedParams: { action: i === 0 ? correctionKeys.confirm : correctionKeys.rename } })} data-testid={`rec-verify-theme-action-${t.id}-${i}`}>
                        {recT(i === 0 ? correctionKeys.confirm : correctionKeys.rename)}
                      </Button>
                    ))}
                  </div>
                )}
              </div>
            ))}
            <div className="mt-1 flex items-start gap-2 rounded-lg border border-dashed border-border-subtle bg-panel p-2.5" data-testid="rec-verify-evidence-note">
              <ShieldCheck aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" />
              <p className="text-9 leading-relaxed text-muted-foreground">{recT("rec.project.verify.evidence")}</p>
            </div>
          </aside>
        </div>
      </StateShell>
      <Toast message={toast} testid="rec-verify-toast" onDismiss={() => setToast(null)} />
    </div>
  );
}
