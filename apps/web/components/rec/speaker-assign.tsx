"use client";
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
  speakerById, speakerDisplay, isReadOnlyRec, canWriteRec,
  type RecView, type TranscriptSegment,
} from "@/lib/mock/rec";

/**
 * UC-5.2 指派说话人 / 逐字稿校对屏（F74–F75）。
 * 左：匿名声道卡（时长占比 / 首现时间码 / 代表片段试听）→ 把在场名单里的人指派给整条声道。
 * 右：两态待处理段（低置信·待校对 / 两人同时说话·待人工指派），各有出口。
 * 指派 = 一次覆盖整声道全部段落，确认后引述出处/洞察/报告/图谱一处更新处处更新，可撤销。
 */
export function SpeakerAssign({ state, view }: { state: UiState; view: RecView }) {
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
            <h1 className="text-18 font-semibold tracking-tight">逐字稿校对 · 指派说话人</h1>
            <p className="text-11 text-muted-foreground">第 3 组访谈 · 储能采购决策 · 候选人只来自本场在场名单</p>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge tone="primary" data-testid="rec-assign-progress">已指派 {assignedCount}/{ANON_CHANNELS.length} 声道</Badge>
            <Badge tone="warning">待校对 {reviewCount()}</Badge>
          </div>
        </div>

        {/* 声纹 embedding 销毁提示（O-14）*/}
        <div className="flex items-start gap-2 rounded-md border border-border-subtle bg-panel p-2.5" data-testid="rec-voiceprint-note">
          <Trash2 aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
          <p className="text-10 text-muted-foreground">
            {VOICEPRINT.note} 当前本场
            <strong className="font-medium text-background-foreground">{VOICEPRINT.allAssigned ? "已全部指派 → embedding 已销毁" : `尚未全部指派 → 兜底任务将于本场结束第 ${VOICEPRINT.fallbackDay} 天无条件销毁`}</strong>。
          </p>
        </div>
      </header>

      <StateShell
        state={state}
        skeletonRows={5}
        emptyHint="本场没有需要指派的匿名声道——所有段落已带真人出处，或本场未产生 diarization 结果。"
        errors={{
          concurrency: "另一名研究员刚修改了本场声道指派，你的版本已过期（乐观并发），请刷新后再提交，系统不静默覆盖。",
          dispute: "seg-07（32:30）被 P-10 与 P-11 同时认领，保留争议标记，需人工裁定后才回填，不静默归属。",
        }}
        depFailure={{ what: "指派候选排序服务（经 Context API 取本场在场名单）暂不可用；已保留你已做的指派，可安全重试。手动指派不依赖它。" }}
        denial={{ layer: "project", reason: "只有引导师/研究员可执行说话人指派；你可查看结果但不能修改本场映射。" }}
        successMessage="声道 C → 已指派给 陈涛（P-10）：引述出处 / 洞察来源 / 报告 / 图谱一处更新处处更新，此操作已记入审计、可撤销。"
      >
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
          {/* 左：匿名声道卡 */}
          <section className="flex flex-col gap-2" data-testid="rec-anon-channels">
            <h2 className="text-12 font-semibold text-muted-foreground">匿名声道（说话人 A / B / C）</h2>
            {ANON_CHANNELS.map((ch) => {
              const cur = assign[ch.channel];
              return (
                <div key={ch.channel} data-testid={`rec-channel-${ch.channel}`} className="flex flex-col gap-2 rounded-md border border-border-subtle bg-card p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Avatar initials={ch.channel} tone="muted" size="sm" />
                      <div className="flex flex-col">
                        <span className="text-12 font-medium">说话人 {ch.channel}</span>
                        <span className="text-9 text-muted-foreground">发言时长 {ch.durationPct}% · 首现 {ch.firstTc}</span>
                      </div>
                    </div>
                    {cur ? (
                      <Badge tone="primary" data-testid={`rec-channel-assigned-${ch.channel}`}>→ {speakerDisplay(cur, view)}</Badge>
                    ) : (
                      <Badge tone="outline">出处待补</Badge>
                    )}
                  </div>

                  {/* 代表片段试听 */}
                  <div className="flex flex-wrap items-center gap-1">
                    <span className="text-9 text-muted-foreground">代表片段：</span>
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
                        title={sp.authComplete ? "指派整条声道" : "授权未完成，不会被录音或转写，不能作为候选"}
                      >
                        <UserPlus aria-hidden className="h-3 w-3" /> {sp.alias ?? sp.realName}
                        {!sp.authComplete && " · 未授权"}
                      </Button>
                    ))}
                    {cur && (
                      <Button size="xs" variant="ghost" disabled={!canWrite} onClick={() => setAssign((m) => ({ ...m, [ch.channel]: null }))} data-testid={`rec-unassign-${ch.channel}`}>
                        <Undo2 aria-hidden className="h-3 w-3" /> 撤销指派
                      </Button>
                    )}
                  </div>
                  {cur && (
                    <p className="inline-flex items-center gap-1 text-9 text-muted-foreground" data-testid={`rec-backfill-${ch.channel}`}>
                      <ShieldCheck aria-hidden className="h-3 w-3 text-success" />
                      整条声道已指派：全量回填到引述/洞察/报告/图谱（指向同一条映射记录，非复制副本）；撤销后同步退回「出处待补」，不留脏数据。
                    </p>
                  )}
                </div>
              );
            })}
            <p className="text-9 text-muted-foreground">
              候选只来自本场在场名单（{SPEAKERS.filter((s) => s.onsite && s.authComplete).length} 人在场且已授权），
              <strong className="font-medium text-background-foreground">无任何跨场次声纹比对</strong>；绑定动作永远由人做，系统没有「自动指派」开关。
            </p>
          </section>

          {/* 右：两态待处理段落 */}
          <section className="flex flex-col gap-2" data-testid="rec-pending-segments">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-12 font-semibold text-muted-foreground">待处理段落（各有出口，处理前不可引述）</h2>
              <div className="flex overflow-hidden rounded-md border border-border" data-testid="rec-pending-filter">
                {([["all", "全部"], ["pending-manual", "待人工指派"], ["low-confidence", "待校对"]] as const).map(([k, label]) => (
                  <Button key={k} size="xs" variant={filter === k ? "primary" : "ghost"} onClick={() => setFilter(k)} data-testid={`rec-filter-${k}`}>{label}</Button>
                ))}
              </div>
            </div>
            {shownPending.length === 0 ? (
              <p className="rounded-md border border-dashed border-border py-8 text-center text-11 text-muted-foreground" data-testid="rec-pending-empty">此筛选下没有待处理段落。</p>
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
  const isOverlap = seg.status === "pending-manual";
  const [picked, setPicked] = React.useState<string | null>(null);
  return (
    <div data-testid={`rec-pending-${seg.id}`} className={cn("flex flex-col gap-2 rounded-md border p-2.5", isOverlap ? "border-warning/40 bg-warning/5" : "border-warning/30 bg-warning/5")}>
      <div className="flex items-center gap-1.5">
        <Badge tone="warning">{isOverlap ? "两人同时说话 · 待人工指派" : "识别置信度低 · 待校对"}</Badge>
        <span className="font-mono text-10 text-muted-foreground">{seg.anchor.tc}</span>
      </div>
      <p className="text-12 text-muted-foreground">{seg.maskedText}</p>
      {seg.original && <p className="text-11 italic text-muted-foreground">{seg.original}</p>}

      {isOverlap ? (
        <div className="flex flex-col gap-1.5">
          <p className="inline-flex items-center gap-1 text-10 font-medium text-warning">
            <AlertTriangle aria-hidden className="h-3 w-3" /> 系统不自动归属，请把每一句指派给对应说话人，或先拆分。
          </p>
          <div className="flex flex-wrap items-center gap-1.5">
            {(seg.overlapCandidates ?? []).map((cid) => (
              <Button key={cid} size="xs" variant={picked === cid ? "primary" : "outline"} disabled={!canWrite} onClick={() => setPicked(cid)} data-testid={`rec-overlap-pick-${seg.id}-${cid}`}>
                指派给 {speakerById(cid)?.alias ?? speakerDisplay(cid, view)}
              </Button>
            ))}
            <Button size="xs" variant="ghost" disabled={!canWrite} data-testid={`rec-overlap-split-${seg.id}`}>
              <Split aria-hidden className="h-3 w-3" /> 拆分为两段
            </Button>
            <Button size="xs" variant="ghost" disabled={!canWrite} onClick={() => setPicked("pending")} data-testid={`rec-overlap-keep-${seg.id}`}>保持待指派</Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-1.5">
          <Button size="xs" variant="outline" disabled={!canWrite} data-testid={`rec-fix-text-${seg.id}`}>人工修正文本…</Button>
          <span className="text-9 text-muted-foreground">（原型行内操作条无「编辑文本」，此出口为 [设计] 补齐；校对前不可抽为引述）</span>
        </div>
      )}
    </div>
  );
}
