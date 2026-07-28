"use client";
import * as React from "react";
import {
  Radio, Wifi, RefreshCw, Search, Quote, MapPin, AlertTriangle, UserPlus,
  Languages, ShieldAlert, Play,
} from "lucide-react";
import { StateShell } from "@/components/state/state-shell";
import type { UiState } from "@/lib/ui-state";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  TRANSCRIPT, RECORDING_TRACKS, SPEAKERS, INTERVIEW_SESSION, AUTHORIZATION,
  authGrantedCount, speakerDisplay, speakerInitials, isReadOnlyView,
  canWriteInterview, WITHDRAWAL_IMPACT, RETENTION,
  type TranscriptSegment, type InterviewView,
} from "@/lib/mock/interview";

/** 观察者脱敏：只给角色，不给真名也不给代称 */
function displayForView(id: string | null, view: InterviewView): string {
  if (view === "observer") {
    if (!id) return "说话人";
    const role = SPEAKERS.find((s) => s.id === id)?.role;
    return role === "researcher" ? "研究员" : role === "facilitator" ? "引导师" : "受访者";
  }
  return speakerDisplay(id);
}

export function InterviewStage({ state, view }: { state: UiState; view: InterviewView }) {
  const readOnly = isReadOnlyView(view);
  const canWrite = canWriteInterview(view);
  const [query, setQuery] = React.useState("");
  const [currentTc, setCurrentTc] = React.useState<string | null>(null);
  const [quoted, setQuoted] = React.useState<Set<string>>(
    () => new Set(TRANSCRIPT.filter((s) => s.quote).map((s) => s.id)),
  );
  const [assigned, setAssigned] = React.useState<Record<string, string>>({});

  // 受访者视角：只看自己的授权与撤回，看不到项目内部材料
  if (view === "interviewee") return <IntervieweeSelfPanel />;

  const filtered = TRANSCRIPT.filter((s) => !query || s.text.includes(query) || (s.original ?? "").includes(query));
  const { granted, total } = authGrantedCount();

  const feed = (
    <div className="flex flex-col gap-3" data-testid="itv-transcript">
      {readOnly && (
        <div
          className="flex items-start gap-2 rounded-md border border-border bg-muted p-2.5"
          data-testid="itv-readonly-banner"
        >
          <ShieldAlert aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
          <p className="text-11 text-muted-foreground">
            观察者视角：现场为<strong className="font-medium">未发布</strong>内容，此处仅作脱敏只读预览，说话人一律以角色显示、写操作全部隐藏。
          </p>
        </div>
      )}

      {/* 搜索逐字稿 */}
      <div className="relative">
        <Search aria-hidden className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜索逐字稿…"
          className="pl-8"
          data-testid="itv-transcript-search"
        />
      </div>

      <ul className="flex flex-col gap-2.5">
        {filtered.map((seg) => (
          <SegmentRow
            key={seg.id}
            seg={seg}
            view={view}
            canWrite={!readOnly}
            researcher={canWrite}
            selected={currentTc === seg.tc}
            quoted={quoted.has(seg.id)}
            assignedTo={assigned[seg.id]}
            onSeek={() => setCurrentTc(seg.tc)}
            onToggleQuote={() =>
              setQuoted((prev) => {
                const next = new Set(prev);
                next.has(seg.id) ? next.delete(seg.id) : next.add(seg.id);
                return next;
              })
            }
            onAssign={(spId) => setAssigned((prev) => ({ ...prev, [seg.id]: spId }))}
          />
        ))}
      </ul>

      {/* 音频定位条（AC2：每句都能点时间码跳回音频）*/}
      <AudioScrubber currentTc={currentTc} onReset={() => setCurrentTc(null)} />
    </div>
  );

  return (
    <div className="flex flex-col gap-3 p-4">
      {/* ── 会话头部 + 实时状态条 ─────────────────────────────── */}
      <header className="flex flex-col gap-2" data-testid="itv-session-header">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div className="flex flex-col gap-0.5">
            <h1 className="text-18 font-semibold tracking-tight">{INTERVIEW_SESSION.title}</h1>
            <p className="text-11 text-muted-foreground">
              {INTERVIEW_SESSION.project} · {INTERVIEW_SESSION.segment}
            </p>
          </div>
          <div className="flex items-center gap-1.5">
            <Badge tone="primary" data-testid="itv-auth-badge">授权 {granted}/{total}</Badge>
            {!AUTHORIZATION.realnameGranted && <Badge tone="warning">实名已拒 · 用代称</Badge>}
          </div>
        </div>

        {/* 实时状态：连接 / 录制 / 倒计时 / 同步 / 最后更新 */}
        <div
          className="flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-md border border-border-subtle bg-panel px-3 py-2"
          data-testid="itv-realtime-bar"
        >
          <span className="inline-flex items-center gap-1.5 text-11">
            <span className="h-1.5 w-1.5 rounded-full bg-success" aria-hidden />
            <Wifi aria-hidden className="h-3.5 w-3.5 text-muted-foreground" /> {INTERVIEW_SESSION.connection}
          </span>
          <span className="inline-flex items-center gap-1.5 text-11">
            <Radio aria-hidden className="h-3.5 w-3.5 text-destructive" /> {INTERVIEW_SESSION.recording}
          </span>
          <span className="text-11 tabular-nums">
            {INTERVIEW_SESSION.elapsed} <span className="text-muted-foreground">/ {INTERVIEW_SESSION.planned}</span>
          </span>
          <span className="inline-flex items-center gap-1 text-11 text-muted-foreground">
            <RefreshCw aria-hidden className="h-3 w-3" /> 同步 · 最后更新 {INTERVIEW_SESSION.lastSync}
          </span>
        </div>

        {/* 4 路录音轨（AC1：4 路同时录不串台；E2：断网本地缓存）*/}
        <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4" data-testid="itv-tracks">
          {RECORDING_TRACKS.map((t) => (
            <div
              key={t.id}
              data-testid={`itv-track-${t.id}`}
              className="flex flex-col gap-0.5 rounded-md border border-border-subtle bg-card p-2"
            >
              <div className="flex items-center gap-1.5">
                <span
                  className={"h-1.5 w-1.5 rounded-full " + (t.status === "live" ? "bg-success" : t.status === "buffering" ? "bg-warning" : "bg-muted")}
                  aria-hidden
                />
                <span className="text-10 font-medium">{t.label}</span>
              </div>
              {t.status === "buffering" && t.note && (
                <span className="text-9 text-warning">{t.note}</span>
              )}
              {t.status === "live" && <span className="text-9 text-muted-foreground">实时 · 不串台</span>}
            </div>
          ))}
        </div>
      </header>

      {/* ── 七态主体 ──────────────────────────────────────────── */}
      <StateShell
        state={state}
        skeletonRows={6}
        emptyHint="这场访谈还没有转录内容——点「开始录音」后逐字稿会实时滚动出现"
        errors={{
          "assign-conflict": "seg-17（08:05）被两人同时认领，已保留争议标记，需人工裁定后才回填出处。",
          concurrency: "另一名研究员刚修改了本场说话人指派，你的版本已过期，请刷新后再提交。",
        }}
        depFailure={{
          what: "实时转录服务（ASR）暂时不可用。已降级为「非实时」轮询，最后一次成功的逐字稿仍在，可安全重试。",
        }}
        denial={{
          layer: "project",
          reason: "你在本项目中的角色不能查看现场逐字稿；已发布的脱敏洞察可在「洞察与报告」查看。",
        }}
        successMessage="说话人指派已回填到所有引用了该段的引述与报告段落"
      >
        {feed}
      </StateShell>
    </div>
  );
}

/* ── 单条转录段 ──────────────────────────────────────────────── */

function SegmentRow({
  seg, view, canWrite, researcher, selected, quoted, assignedTo, onSeek, onToggleQuote, onAssign,
}: {
  seg: TranscriptSegment;
  view: InterviewView;
  canWrite: boolean;
  researcher: boolean;
  selected: boolean;
  quoted: boolean;
  assignedTo?: string;
  onSeek: () => void;
  onToggleQuote: () => void;
  onAssign: (speakerId: string) => void;
}) {
  const isOverlap = seg.status === "pending-manual";
  const isDispute = seg.status === "disputed";
  const isUnassigned = seg.speakerId === null && !isOverlap;
  const effectiveSpeaker = assignedTo ?? seg.speakerId;

  return (
    <li
      id={`itv-seg-${seg.id}`}
      data-testid={`itv-seg-${seg.id}`}
      className={
        "scroll-mt-4 rounded-md border p-2.5 transition-colors duration-200 " +
        (selected ? "border-primary bg-accent" : "border-border-subtle bg-card")
      }
    >
      <div className="flex items-start gap-2.5">
        {/* 说话人头像 */}
        <Avatar
          initials={view === "observer" ? "·" : (effectiveSpeaker ? speakerInitials(effectiveSpeaker) : "?")}
          tone={effectiveSpeaker ? "human" : "muted"}
          size="sm"
        />

        <div className="flex min-w-0 flex-1 flex-col gap-1">
          {/* 头行：说话人 · 时间码 · 徽章 */}
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-11 font-medium">
              {isOverlap ? "重叠语音" : displayForView(effectiveSpeaker, view)}
            </span>
            <button
              type="button"
              onClick={onSeek}
              data-testid={`itv-tc-${seg.id}`}
              className="inline-flex items-center gap-0.5 rounded-sm px-1 font-mono text-10 text-primary transition-colors duration-200 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              title="点时间码跳回音频位置"
            >
              <Play aria-hidden className="h-2.5 w-2.5" /> {seg.tc}
            </button>
            {isOverlap && <Badge tone="warning" data-testid={`itv-overlap-${seg.id}`}>待人工指派</Badge>}
            {isDispute && <Badge tone="danger" data-testid={`itv-dispute-${seg.id}`}>争议 · 多人认领</Badge>}
            {isUnassigned && <Badge tone="outline">未指派 · 临时名</Badge>}
            {seg.decisionPoint && <Badge tone="ai" data-testid={`itv-decision-${seg.id}`}>AI 标记 · 决策点（待确认）</Badge>}
            {seg.original && <Badge tone="neutral"><Languages aria-hidden className="h-2.5 w-2.5" /> 外语 · 原文/译文</Badge>}
            {quoted && <Badge tone="primary" data-testid={`itv-quote-${seg.id}`}><Quote aria-hidden className="h-2.5 w-2.5" /> 引述</Badge>}
            {seg.lowConfidence && <Badge tone="outline">低置信</Badge>}
            {seg.status === "partial" && <Badge tone="neutral">正在识别…</Badge>}
          </div>

          {/* 正文（外语两行）*/}
          {seg.original && (
            <p className="text-11 italic text-muted-foreground">{seg.original}</p>
          )}
          <p className="text-13 leading-relaxed">{seg.text}</p>

          {/* 重叠语音的显式指派（O-13：不得静默归给单一说话人）*/}
          {isOverlap && (
            <div
              className="mt-1 flex flex-col gap-1.5 rounded-md border border-warning/30 bg-warning/5 p-2"
              data-testid={`itv-overlap-assign-${seg.id}`}
            >
              <p className="inline-flex items-center gap-1 text-10 font-medium text-warning">
                <AlertTriangle aria-hidden className="h-3 w-3" />
                两位受访者同时开口，系统<strong className="font-medium text-background-foreground">不自动归属</strong>，请人工把每一句指派给对应说话人。
              </p>
              <div className="flex flex-wrap items-center gap-1.5">
                {(seg.overlapCandidates ?? []).map((cid) => (
                  <Button
                    key={cid}
                    size="xs"
                    variant={assignedTo === cid ? "primary" : "outline"}
                    disabled={!canWrite}
                    onClick={() => onAssign(cid)}
                    data-testid={`itv-overlap-pick-${seg.id}-${cid}`}
                  >
                    指派给 {speakerDisplay(cid)}
                  </Button>
                ))}
                <Button
                  size="xs"
                  variant="ghost"
                  disabled={!canWrite}
                  onClick={() => onAssign("pending")}
                  data-testid={`itv-overlap-keep-${seg.id}`}
                >
                  保持待指派
                </Button>
              </div>
              {assignedTo && assignedTo !== "pending" && (
                <p className="text-10 text-muted-foreground">
                  已人工指派给 {speakerDisplay(assignedTo)}；该操作已记入审计，可撤销。
                </p>
              )}
            </div>
          )}

          {/* 争议段（UC-5.2 E1）*/}
          {isDispute && (
            <p className="text-10 text-destructive" data-testid={`itv-dispute-note-${seg.id}`}>
              {seg.disputeClaims?.map((c) => speakerDisplay(c)).join(" 与 ")} 都认领了这一段，保留争议标记，需人工裁定，不静默归属。
            </p>
          )}

          {/* 未指派匿名段的指派入口（不阻塞使用）*/}
          {isUnassigned && (
            <div className="flex flex-wrap items-center gap-1.5" data-testid={`itv-assign-${seg.id}`}>
              {SPEAKERS.filter((s) => s.role === "interviewee").map((s) => (
                <Button
                  key={s.id}
                  size="xs"
                  variant={assignedTo === s.id ? "primary" : "outline"}
                  disabled={!canWrite}
                  onClick={() => onAssign(s.id)}
                  data-testid={`itv-assign-pick-${seg.id}-${s.id}`}
                >
                  <UserPlus aria-hidden className="h-3 w-3" /> {speakerDisplay(s.id)}
                </Button>
              ))}
              <span className="text-10 text-muted-foreground">未确认前保持匿名，不阻塞使用</span>
            </div>
          )}

          {/* 引述 / 打点 动作 */}
          {!isOverlap && (
            <div className="flex items-center gap-1.5 pt-0.5">
              <Button
                size="xs"
                variant={quoted ? "primary" : "ghost"}
                disabled={!canWrite}
                onClick={onToggleQuote}
                data-testid={`itv-mark-quote-${seg.id}`}
              >
                <Quote aria-hidden className="h-3 w-3" /> {quoted ? "已标为引述" : "标为引述"}
              </Button>
              {researcher && (
                <Button size="xs" variant="ghost" data-testid={`itv-mark-moment-${seg.id}`}>
                  <MapPin aria-hidden className="h-3 w-3" /> 标记此刻
                </Button>
              )}
            </div>
          )}
        </div>
      </div>
    </li>
  );
}

/* ── 音频定位条 ──────────────────────────────────────────────── */

function AudioScrubber({ currentTc, onReset }: { currentTc: string | null; onReset: () => void }) {
  const toSec = (tc: string) => {
    const [m, s] = tc.split(":").map(Number);
    return (m ?? 0) * 60 + (s ?? 0);
  };
  const total = toSec(INTERVIEW_SESSION.planned);
  const pos = currentTc ? toSec(currentTc) : toSec(INTERVIEW_SESSION.elapsed);
  const pct = Math.min(100, (pos / total) * 100);
  return (
    <div
      className="sticky bottom-0 flex items-center gap-3 rounded-md border border-border bg-panel-alt p-2.5"
      data-testid="itv-audio-scrubber"
    >
      <Radio aria-hidden className="h-4 w-4 shrink-0 text-muted-foreground" />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-center justify-between">
          <span className="text-10 text-muted-foreground">
            {currentTc ? <>已跳至 <strong className="font-mono text-background-foreground">{currentTc}</strong> · 原始音频位置</> : "跟随最新 · 点任意时间码可跳回音频"}
          </span>
          <span className="font-mono text-10 tabular-nums text-muted-foreground">{INTERVIEW_SESSION.elapsed} / {INTERVIEW_SESSION.planned}</span>
        </div>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted" role="presentation">
          <div className="h-full rounded-full bg-primary transition-all duration-200" style={{ width: `${pct}%` }} />
        </div>
      </div>
      {currentTc && (
        <Button size="xs" variant="ghost" onClick={onReset} data-testid="itv-audio-reset">回到最新</Button>
      )}
    </div>
  );
}

/* ── 受访者视角：只看自己的授权与撤回 ─────────────────────────── */

function IntervieweeSelfPanel() {
  return (
    <div className="flex flex-col gap-4 p-4" data-testid="itv-interviewee-self">
      <header className="flex flex-col gap-1">
        <h1 className="text-18 font-semibold tracking-tight">你的授权</h1>
        <p className="text-11 text-muted-foreground">
          你只能看到自己的授权与撤回，看不到项目内部材料或其他受访者的数据。拒绝任何一项都不影响访谈进行。
        </p>
      </header>

      <ul className="flex flex-col gap-1.5">
        {AUTHORIZATION.items.map((it) => (
          <li key={it.id} className="flex items-center justify-between rounded-md border border-border-subtle bg-card p-2.5">
            <span className="text-12">{it.label}</span>
            <Badge tone={it.granted ? "primary" : "outline"}>{it.granted ? "你已同意" : "你已拒绝"}</Badge>
          </li>
        ))}
        <li className="flex items-center justify-between rounded-md border border-warning/30 bg-warning/5 p-2.5">
          <span className="text-12">实名引用</span>
          <Badge tone="warning">你已拒绝 · 报告用代称</Badge>
        </li>
      </ul>

      <div className="flex flex-col gap-1 rounded-md border border-border bg-muted p-3">
        <p className="text-12 font-medium">转写保留期</p>
        <p className="text-11 text-muted-foreground">
          你的逐字稿与音频保留 {RETENTION.retentionDays} 天，{RETENTION.deleteBy} 自动删除，禁止用于训练。
        </p>
      </div>

      <div className="flex flex-col gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3" data-testid="itv-withdraw-self">
        <p className="text-12 font-medium">撤回授权</p>
        <p className="text-11 text-muted-foreground">
          撤回后：本场引述退出检索、引用过它的报告段落会标「证据已撤回」（不静默删除），
          物理删除会在 30 天内完成并给你回执。
        </p>
        <Button size="sm" variant="destructive" className="self-start" data-testid="itv-withdraw-submit">
          我要撤回我的授权…
        </Button>
      </div>

      <p className="text-10 text-muted-foreground">
        数据控制方：远洋咨询 · 联系人 林可 · 合规邮箱 compliance@yuanyang-consulting.cn
      </p>

      {/* 撤回后的下游影响（研究员侧回执，也让受访者看到确有发生）*/}
      <div className="flex flex-col gap-1 rounded-md border border-border-subtle bg-card p-3">
        <p className="text-11 font-medium">上一位受访者撤回后发生了什么（示例回执）</p>
        <p className="text-10 text-muted-foreground">
          {WITHDRAWAL_IMPACT.quotesRemoved} 条引述已退出检索 · {WITHDRAWAL_IMPACT.affectedReportSegments.length} 段报告标「证据已撤回」 ·
          将于 {WITHDRAWAL_IMPACT.retentionDeleteBy} 物理删除。
        </p>
      </div>
    </div>
  );
}
