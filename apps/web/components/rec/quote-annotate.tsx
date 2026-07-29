"use client";
import * as React from "react";
import { Sparkles, Quote, Check, Pencil, X, Eye, Play, Link2, AlertTriangle } from "lucide-react";
import { StateShell } from "@/components/state/state-shell";
import type { UiState } from "@/lib/ui-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  AI_MOMENTS, RESEARCH_QUESTIONS, TRANSCRIPT, EVIDENCE_NATURE_LABEL, isQuotable,
  speakerDisplay, isReadOnlyRec, canWriteRec,
  type RecView, type AiMomentCandidate, type EvidenceNature,
} from "@/lib/mock/rec";

/**
 * UC-5.3 引述与打点屏（F76–F77）。
 * 上：人工标引述 → 绑定 RQ + 记录证据性质（个人经历/二手转述/观点）；不稳定态段落拒绝引述。
 * 下：AI 自动打点候选队列（集中一处批量处理）—— origin:ai 带 agent 角标、落候选态、
 *     [看洞察] 依据出口、三出口（确认/编辑后确认/忽略）、依据被撤回则自动失效。
 */
export function QuoteAnnotate({ state, view }: { state: UiState; view: RecView }) {
  const readOnly = isReadOnlyRec(view);
  const canWrite = canWriteRec(view) && !readOnly;

  return (
    <div className="flex flex-col gap-3 p-4">
      <header className="flex flex-col gap-0.5" data-testid="rec-annotate-header">
        <h1 className="text-18 font-semibold tracking-tight">引述与打点</h1>
        <p className="text-11 text-muted-foreground">
          引述是指向 transcript.jsonl 某个 anchor 的引用，不复制正文；AI 打点默认候选态，人工确认前不进证据库。
        </p>
      </header>

      <StateShell
        state={state}
        skeletonRows={5}
        emptyHint="还没有引述或 AI 打点候选——在实时转录选中文字标为引述，或等 AI 识别关键时刻落候选。"
        errors={{
          "quote-unstable": "seg-06（32:05·待校对）与 seg-07（32:30·待人工指派）不可被标为引述，请先到「指派说话人」处理，不得先入库再说。",
          "quote-partial": "seg-08（33:10）正在识别中，定稿前不可被标为引述、不进检索与 AI 归纳。",
        }}
        depFailure={{ what: "AI 打点候选生成（经 Context API 取 Context Pack）暂不可用；已确认的引述与打点不受影响，可安全重试。" }}
        denial={{ layer: "project", reason: "只有引导师/研究员可标引述与确认 AI 打点；你可查看已发布的引述，但不能新增或确认。" }}
        successMessage="已确认 Ava 的「决策点」打点：补齐时间码 30:36 + 来源 + RQ1 绑定后入证据库，origin:ai 与人工打点分开计数。"
      >
        <div className="flex flex-col gap-4">
          {/* 已标引述 + RQ 绑定 + 证据性质 */}
          <section className="flex flex-col gap-2" data-testid="rec-quotes">
            <h2 className="text-12 font-semibold text-muted-foreground">已标引述（绑定 RQ · 记录证据性质）</h2>
            {TRANSCRIPT.filter((s) => s.quote).map((s) => (
              <div key={s.id} data-testid={`rec-quote-row-${s.id}`} className="flex flex-col gap-1.5 rounded-md border border-border-subtle bg-card p-2.5">
                <div className="flex flex-wrap items-center gap-1.5">
                  <Badge tone="primary"><Quote aria-hidden className="h-2.5 w-2.5" /> 引述</Badge>
                  <span className="font-mono text-10 text-primary"><Play aria-hidden className="inline h-2.5 w-2.5" /> {s.anchor.tc}</span>
                  <span className="text-10 text-muted-foreground">· {speakerDisplay(s.assignedTo, view)}</span>
                  {s.quote?.rq && <Badge tone="ai" data-testid={`rec-quote-rq-${s.id}`}><Link2 aria-hidden className="h-2.5 w-2.5" /> 支持 {s.quote.rq}</Badge>}
                  <Badge tone="outline" data-testid={`rec-quote-nature-${s.id}`}>{EVIDENCE_NATURE_LABEL[s.quote!.nature]}</Badge>
                </div>
                <p className="text-12">{s.maskedText}</p>
                {/* RQ 绑定编辑器（示意）*/}
                <div className="flex flex-wrap items-center gap-1">
                  <span className="text-9 text-muted-foreground">改绑 RQ：</span>
                  {RESEARCH_QUESTIONS.map((rq) => (
                    <Button key={rq.id} size="xs" variant={s.quote?.rq === rq.id ? "primary" : "outline"} disabled={!canWrite} data-testid={`rec-bind-${s.id}-${rq.id}`} title={rq.label}>{rq.id}</Button>
                  ))}
                </div>
              </div>
            ))}
            <p className="text-9 text-muted-foreground">该绑定被 UC-6.4 目标覆盖度与 UC-6.5 证据矩阵直接消费。</p>
          </section>

          {/* 不稳定态段落：显式拒绝引述并给去校对出口 */}
          <section className="flex flex-col gap-1.5" data-testid="rec-unquotable">
            <h2 className="text-12 font-semibold text-muted-foreground">不可引述的段落（正在识别 / 待校对 / 待人工指派）</h2>
            {TRANSCRIPT.filter((s) => !isQuotable(s)).map((s) => (
              <div key={s.id} data-testid={`rec-unquotable-${s.id}`} className="flex flex-wrap items-center gap-1.5 rounded-md border border-warning/30 bg-warning/5 p-2">
                <AlertTriangle aria-hidden className="h-3 w-3 text-warning" />
                <span className="font-mono text-10 text-muted-foreground">{s.anchor.tc}</span>
                <Badge tone="warning">{s.status === "partial" ? "正在识别" : s.status === "low-confidence" ? "待校对" : "待人工指派"}</Badge>
                <span className="text-10 text-warning">标记时被拒绝：不确定的文本不可成为证据。</span>
                <Button asChild size="xs" variant="outline"><a href="?screen=assign">去校对 →</a></Button>
              </div>
            ))}
          </section>

          {/* AI 打点候选队列 */}
          <section className="flex flex-col gap-2" data-testid="rec-ai-moments">
            <div className="flex items-center gap-1.5">
              <Sparkles aria-hidden className="h-4 w-4 text-ai" />
              <h2 className="text-12 font-semibold">AI 自动打点候选（未确认前不进证据库/报告/决策链）</h2>
            </div>
            {AI_MOMENTS.map((m) => <AiMomentCard key={m.id} m={m} canWrite={canWrite} />)}
          </section>
        </div>
      </StateShell>
    </div>
  );
}

function AiMomentCard({ m, canWrite }: { m: AiMomentCandidate; canWrite: boolean }) {
  const [showBasis, setShowBasis] = React.useState(false);
  const [decision, setDecision] = React.useState<"none" | "confirmed" | "ignored">("none");

  if (m.invalidated) {
    return (
      <div data-testid={`rec-aimoment-${m.id}`} className="flex flex-col gap-1 rounded-md border border-border-subtle bg-muted p-2.5 opacity-100">
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge tone="ai">{m.agent} · {m.label}</Badge>
          <span className="font-mono text-10 text-muted-foreground">{m.tc}</span>
          <Badge tone="danger" data-testid={`rec-aimoment-invalid-${m.id}`}>候选已失效</Badge>
        </div>
        <p className="text-11 text-muted-foreground line-through">{m.snippet}</p>
        <p className="text-9 text-muted-foreground">依据片段被撤回/改写，此候选自动失效并从队列移除（已确认的会按撤回流程标「证据已撤回」，不静默删除）。</p>
      </div>
    );
  }

  return (
    <div data-testid={`rec-aimoment-${m.id}`} className={cn("flex flex-col gap-2 rounded-md border p-2.5", decision === "confirmed" ? "border-success/40 bg-success/5" : decision === "ignored" ? "border-border-subtle bg-muted" : "border-ai/30 bg-ai-tint/40")}>
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge tone="ai" data-testid={`rec-aimoment-badge-${m.id}`}><Sparkles aria-hidden className="h-2.5 w-2.5" /> {m.agent} 标记为{m.label}</Badge>
        <span className="font-mono text-10 text-muted-foreground">{m.tc}</span>
        {decision === "none" && <Badge tone="warning">候选 · 未确认</Badge>}
        {decision === "confirmed" && <Badge tone="primary" data-testid={`rec-aimoment-confirmed-${m.id}`}>已确认 · 入证据库</Badge>}
        {decision === "ignored" && <Badge tone="neutral" data-testid={`rec-aimoment-ignored-${m.id}`}>已忽略 · 留痕供改进</Badge>}
      </div>
      <p className="text-12">{m.snippet}</p>

      <div className="flex flex-wrap items-center gap-1.5">
        <Button size="xs" variant="ghost" onClick={() => setShowBasis((v) => !v)} data-testid={`rec-aimoment-basis-${m.id}`}>
          <Eye aria-hidden className="h-3 w-3" /> 看洞察（依据）
        </Button>
        {decision === "none" && (
          <>
            <Button size="xs" variant="primary" disabled={!canWrite} onClick={() => setDecision("confirmed")} data-testid={`rec-aimoment-confirm-${m.id}`}><Check aria-hidden className="h-3 w-3" /> 确认</Button>
            <Button size="xs" variant="outline" disabled={!canWrite} data-testid={`rec-aimoment-edit-${m.id}`}><Pencil aria-hidden className="h-3 w-3" /> 编辑后确认</Button>
            <Button size="xs" variant="ghost" disabled={!canWrite} onClick={() => setDecision("ignored")} data-testid={`rec-aimoment-ignore-${m.id}`}><X aria-hidden className="h-3 w-3" /> 忽略</Button>
          </>
        )}
        {decision !== "none" && (
          <Button size="xs" variant="ghost" onClick={() => setDecision("none")} data-testid={`rec-aimoment-undo-${m.id}`}>撤销此决定</Button>
        )}
      </div>

      {showBasis && (
        <p className="rounded-md border border-border-subtle bg-card p-2 text-10 text-muted-foreground" data-testid={`rec-aimoment-basis-panel-${m.id}`}>
          依据（可追溯至原文片段 {m.tc} · segmentId {m.segId}）：{m.basis}
        </p>
      )}
    </div>
  );
}
