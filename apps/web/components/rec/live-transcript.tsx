"use client";
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
import {
  SESSION, TRACKS, TRACK_STATUS_LABEL, TRANSCRIPT, reviewCount, isQuotable,
  speakerDisplay, PII_LABEL, isReadOnlyRec, canWriteRec,
  type Carrier, type RecView, type TranscriptSegment,
} from "@/lib/mock/rec";

/**
 * UC-5.1 实时转录屏（F69–F73）——三载体共享。
 * 覆盖：多路录音状态 + 麦克风随时关闭 + 四常驻控件 + diarization 匿名声道 +
 *       重叠语音待人工指派 + 低置信待校对 + 正在识别中间态 + PII 五类遮盖 + file-first 物化。
 */
export function LiveTranscript({ state, carrier, view }: { state: UiState; carrier: Carrier; view: RecView }) {
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
            <Badge tone="primary" data-testid="rec-auth-badge">授权 3/4</Badge>
            <Badge tone="warning">Weber 不参与 AI 分析</Badge>
          </div>
        </div>

        {/* 实时状态：连接 / 录制 / 延迟具体秒数 / 语言方向 / 倒计时 / 同步 */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-md border border-border-subtle bg-panel px-3 py-2" data-testid="rec-realtime-bar">
          <span className="inline-flex items-center gap-1.5 text-11">
            <span className="h-1.5 w-1.5 rounded-full bg-success" aria-hidden />
            <Wifi aria-hidden className="h-3.5 w-3.5 text-muted-foreground" /> {s.connection}
          </span>
          <span className="inline-flex items-center gap-1.5 text-11">
            <Radio aria-hidden className="h-3.5 w-3.5 text-destructive" /> {s.recording}
          </span>
          <span className="inline-flex items-center gap-1 text-11" data-testid="rec-latency">
            延迟 <strong className="font-mono tabular-nums">{s.latencySec}</strong>
          </span>
          {s.langDir && (
            <span className="inline-flex items-center gap-1 text-11" data-testid="rec-langdir">
              <Languages aria-hidden className="h-3.5 w-3.5 text-muted-foreground" /> {s.langDir} · 原文/译文两行
            </span>
          )}
          <span className="text-11 tabular-nums">
            {s.elapsed} <span className="text-muted-foreground">/ {s.planned}</span>
          </span>
          <span className="inline-flex items-center gap-1 text-11 text-muted-foreground">
            <RefreshCw aria-hidden className="h-3 w-3" /> 同步 · 最后更新 {s.lastSync}
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
                  <span className="text-10 font-medium">{t.label}</span>
                </div>
                <span className="text-9 font-medium text-muted-foreground">{TRACK_STATUS_LABEL[t.status]}</span>
                {t.note && <span className={cn("text-9", t.status === "declined" ? "text-destructive" : t.status === "buffering" ? "text-warning" : "text-muted-foreground")}>{t.note}</span>}
              </div>
            );
          })}
        </div>

        {/* 麦克风权限：进场申请 + 随时关闭（关闭入口常驻可达，不藏二级设置）*/}
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border-subtle bg-card p-2.5" data-testid="rec-mic-control">
          <p className="inline-flex items-center gap-1.5 text-11 text-muted-foreground">
            <ShieldAlert aria-hidden className="h-3.5 w-3.5" />
            进入本组时已申请麦克风权限，用于本组讨论的实时转录。<strong className="font-medium text-background-foreground">可以随时关掉。</strong>
          </p>
          <Button
            size="sm"
            variant={micOn ? "outline" : "destructive"}
            disabled={readOnly}
            onClick={() => setMicOn((v) => !v)}
            data-testid="group-mic-toggle"
          >
            {micOn ? <><Mic aria-hidden className="h-3.5 w-3.5" /> 麦克风开启中</> : <><MicOff aria-hidden className="h-3.5 w-3.5" /> 本路已关麦 · 未录制</>}
          </Button>
        </div>
        {!micOn && (
          <p className="rounded-md border border-warning/30 bg-warning/5 p-2 text-11 text-warning" role="status" data-testid="rec-mic-paused">
            本路已停止采集并在转写流留「录制已暂停」标记；已产生的转写段不回收，重开后时间轴留缺口不拼接成连续假象。
          </p>
        )}
      </header>

      {/* ── 转录标签内四常驻控件：搜索 / 自动跟随（正在识别、常驻时间码在逐字稿内）── */}
      <div className="flex flex-wrap items-center gap-2" data-testid="rec-persistent-controls">
        <div className="relative min-w-40 flex-1">
          <Search aria-hidden className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索逐字稿（本场全文，命中高亮）" className="pl-8" data-testid="rec-transcript-search" />
        </div>
        <div className="flex items-center gap-1.5 rounded-md border border-border-subtle bg-card px-2.5 py-1.5">
          <Eye aria-hidden className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-11">自动跟随</span>
          <Toggle checked={autoFollow} onCheckedChange={setAutoFollow} label="自动跟随最新一句" data-testid="rec-auto-follow" />
          {!autoFollow && (
            <Button size="xs" variant="ghost" onClick={() => setAutoFollow(true)} data-testid="rec-back-to-latest">回到最新</Button>
          )}
        </div>
        <Badge tone="warning" data-testid="rec-review-badge">逐字稿校对 {reviewCount()}</Badge>
      </div>

      {/* ── 七态主体 ──────────────────────────────────────────── */}
      <StateShell
        state={state}
        skeletonRows={6}
        emptyHint="这场还没有转录内容——点「开始录音」后逐字稿会带时间码实时滚动出现，不生成示例数据。"
        errors={{
          "mic-permission": "第 4 组有 1 人拒绝麦克风权限，本路显式标「未录制」且不产生转写段；未授权的人不被录也不进转写。",
          overlap: "seg-07（32:30）两人同时说话，未拆分前不能指派给单一说话人、不能抽为引述，请到「指派说话人」处理。",
        }}
        depFailure={{ what: "实时转录服务（ASR · whisper-large-v3-zh）暂时不可用。已降级为「非实时」轮询，最后一次成功的逐字稿仍在，可安全重试。" }}
        denial={{
          layer: "project",
          reason: view === "member"
            ? "组员只能看本组转录，跨组现场逐字稿不进入你的结果集；已发布的脱敏洞察可在「洞察与报告」查看。"
            : "你在本项目中的角色不能查看现场未发布逐字稿；已发布的脱敏结果可在「洞察与报告」查看。",
        }}
        successMessage="本场录制已结束：音频 + transcript.jsonl 已物化并登记到 22-files，可在项目文件浏览器查看下载。"
      >
        <div className="flex flex-col gap-2.5">
          {readOnly && (
            <div className="flex items-start gap-2 rounded-md border border-border bg-muted p-2.5" data-testid="rec-readonly-banner">
              <ShieldAlert aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              <p className="text-11 text-muted-foreground">
                {view === "interviewee"
                  ? "受访者视角：你只能看到自己的授权与撤回，看不到项目内部逐字稿；转到「回流与保留期」看你的授权告知。"
                  : "观察者视角：现场为未发布内容，此处仅脱敏只读预览，说话人一律以角色显示、写操作全部隐藏。"}
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
              file-first：本场结束后 <strong className="font-medium text-background-foreground">音频.wav + transcript.jsonl</strong>
              {carrier === "interview" && <>（访谈另有 <strong className="font-medium text-background-foreground">notes.md</strong>）</>}
              在 22-files 可见可下载；转写稿带 <code className="font-mono">derived_from</code> 指回原音频 artifact_version，原音频 SHA-256 不变。
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
  const isOverlap = seg.status === "pending-manual";
  const isLowConf = seg.status === "low-confidence";
  const isPartial = seg.status === "partial";
  const quotable = isQuotable(seg);
  const speakerName = isOverlap ? "重叠语音" : seg.anonChannel && !seg.assignedTo ? `说话人 ${seg.anonChannel}` : speakerDisplay(seg.assignedTo, view);

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
              title="点时间码跳回音频位置（AC2）"
            >
              <Play aria-hidden className="h-2.5 w-2.5" /> {seg.anchor.tc}
            </button>
            {seg.anonChannel && !seg.assignedTo && !isOverlap && <Badge tone="outline">未指派 · 匿名声道</Badge>}
            {isOverlap && <Badge tone="warning" data-testid={`rec-overlap-${seg.id}`}>两人同时说话 · 待人工指派</Badge>}
            {isLowConf && <Badge tone="warning" data-testid={`rec-lowconf-${seg.id}`}>识别置信度低 · 待校对</Badge>}
            {isPartial && <Badge tone="neutral" data-testid={`rec-partial-${seg.id}`}>正在识别…</Badge>}
            {seg.original && <Badge tone="neutral"><Languages aria-hidden className="h-2.5 w-2.5" /> 外语</Badge>}
            {seg.quote && <Badge tone="primary" data-testid={`rec-quote-${seg.id}`}><Quote aria-hidden className="h-2.5 w-2.5" /> 已标为引述{seg.quote.rq ? ` · 支持 ${seg.quote.rq}` : ""}</Badge>}
            {seg.aiMoment && <Badge tone="ai" data-testid={`rec-aimoment-${seg.id}`}><MapPin aria-hidden className="h-2.5 w-2.5" /> {seg.aiMoment.agent} 标记 · {seg.aiMoment.label}（待确认）</Badge>}
          </div>

          {/* 外语两行 */}
          {seg.original && <p className="text-11 italic text-muted-foreground">{seg.original}</p>}
          <p className={cn("text-13 leading-relaxed", (isPartial || isLowConf || isOverlap) && "text-muted-foreground")}>{seg.maskedText}</p>

          {/* PII 遮盖就地说明（F72：查看原文需权限）*/}
          {seg.pii && seg.pii.length > 0 && (
            <p className="inline-flex flex-wrap items-center gap-1 rounded-md border border-border-subtle bg-muted px-2 py-1 text-10 text-muted-foreground" data-testid={`rec-pii-${seg.id}`}>
              <ShieldAlert aria-hidden className="h-3 w-3" />
              已自动遮盖：{seg.pii.map((p) => PII_LABEL[p]).join(" 与 ")} · 查看原文需权限（独立授权 + 写审计）
              <Button size="xs" variant="ghost" disabled={!canWrite} data-testid={`rec-pii-reveal-${seg.id}`}>查看原文…</Button>
            </p>
          )}

          {/* 引述 / 打点 动作；不稳定态显式禁用并给「去校对」出口 */}
          {isOverlap || isLowConf ? (
            <div className="flex flex-wrap items-center gap-1.5 rounded-md border border-warning/30 bg-warning/5 p-2" data-testid={`rec-blocked-quote-${seg.id}`}>
              <AlertTriangle aria-hidden className="h-3 w-3 text-warning" />
              <span className="text-10 text-warning">
                {isOverlap ? "系统不自动归属，未拆分前不可指派给单一说话人、不可抽为引述。" : "文字可能识别错，校对前不可抽为引述。"}
              </span>
              <Button asChild size="xs" variant="outline" data-testid={`rec-goto-review-${seg.id}`}>
                <a href="?screen=assign">去校对 →</a>
              </Button>
            </div>
          ) : (
            <div className="flex items-center gap-1.5 pt-0.5">
              <Button size="xs" variant={seg.quote ? "primary" : "ghost"} disabled={!canWrite || !quotable} data-testid={`rec-mark-quote-${seg.id}`}>
                <Quote aria-hidden className="h-3 w-3" /> {seg.quote ? "已标为引述" : "标为引述"}
              </Button>
              <Button size="xs" variant="ghost" disabled={!canWrite || isPartial} data-testid={`rec-mark-moment-${seg.id}`}>
                <MapPin aria-hidden className="h-3 w-3" /> 标记此刻
              </Button>
              {isPartial && <span className="text-9 text-muted-foreground">（正在识别的句子定稿前不可引述、不进检索）</span>}
            </div>
          )}
        </div>
      </div>
    </li>
  );
}
