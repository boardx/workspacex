"use client";
import * as React from "react";
import { Sparkles, X, Quote, Undo2, AlertOctagon, ArrowRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  FOLLOWUPS, INSIGHT_CANDIDATES, INSIGHT_STRENGTH_LABEL, TRANSCRIPT,
  WITHDRAWAL_IMPACT, speakerDisplay, canWriteInterview,
  type InterviewView,
} from "@/lib/mock/interview";

/**
 * 访谈现场页 · 右栏（UC-6.4 追问建议 · UC-6.5 洞察候选 · D-13 撤回影响）。
 * 追问建议只对研究员开放（R5）。洞察候选每条挂原始引述并可点回时间码（AC1）。
 */
export function InterviewCopilot({ view }: { view: InterviewView }) {
  const researcher = canWriteInterview(view);
  const [dismissed, setDismissed] = React.useState<Set<string>>(new Set());
  const [confirmed, setConfirmed] = React.useState<Set<string>>(
    () => new Set(INSIGHT_CANDIDATES.filter((i) => i.confirmed).map((i) => i.id)),
  );

  return (
    <div className="flex flex-col gap-4 p-3" data-testid="itv-copilot">
      {/* ── 追问建议（研究员专属）───────────────────────────── */}
      <section className="flex flex-col gap-2" data-testid="itv-followups">
        <div className="flex items-center gap-1.5">
          <Sparkles aria-hidden className="h-3.5 w-3.5 text-ai" />
          <h2 className="text-13 font-semibold">AI 追问建议</h2>
          <Badge tone="ai">机器产出</Badge>
        </div>
        {!researcher ? (
          <p className="text-10 text-muted-foreground" data-testid="itv-followups-denied">
            追问建议只对研究员显示。你的角色可参与流程，但看不到只给研究员的私密追问区。
          </p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {FOLLOWUPS.filter((f) => !dismissed.has(f.id)).map((f) => (
              <li
                key={f.id}
                data-testid={`itv-followup-${f.id}`}
                className="flex flex-col gap-1 rounded-md border border-ai/20 bg-ai-tint p-2"
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="text-11 leading-snug text-ai-tint-foreground">{f.text}</span>
                  <button
                    type="button"
                    onClick={() => setDismissed((p) => new Set(p).add(f.id))}
                    data-testid={`itv-followup-dismiss-${f.id}`}
                    aria-label="忽略这条建议"
                    className="shrink-0 rounded-sm p-0.5 text-muted-foreground transition-colors duration-200 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <X aria-hidden className="h-3 w-3" />
                  </button>
                </div>
                <span className="text-9 text-muted-foreground">来源：{f.source}</span>
              </li>
            ))}
            {FOLLOWUPS.every((f) => dismissed.has(f.id)) && (
              <li className="text-10 text-muted-foreground">建议已全部处理。AI 不会替你勾完成，需你确认。</li>
            )}
          </ul>
        )}
      </section>

      <Separator />

      {/* ── 洞察候选（每条挂原始引述，可点回时间码）─────────── */}
      <section className="flex flex-col gap-2" data-testid="itv-insights">
        <div className="flex items-center justify-between">
          <h2 className="text-13 font-semibold">洞察候选</h2>
          <span className="text-10 text-muted-foreground">
            强 {INSIGHT_CANDIDATES.filter((i) => i.strength === "strong").length} · 虚拟 {INSIGHT_CANDIDATES.filter((i) => i.strength === "virtual").length}
          </span>
        </div>
        <p className="text-10 text-muted-foreground">
          只有真人来源能标为强洞察，虚拟来源单独计数。每条必须挂原始引述与出处。
        </p>
        <ul className="flex flex-col gap-2">
          {INSIGHT_CANDIDATES.map((ins) => {
            const isConfirmed = confirmed.has(ins.id);
            return (
              <li
                key={ins.id}
                data-testid={`itv-insight-${ins.id}`}
                className="flex flex-col gap-1.5 rounded-md border border-border-subtle bg-card p-2"
              >
                <div className="flex flex-wrap items-center gap-1">
                  <Badge tone={ins.strength === "strong" ? "primary" : ins.strength === "virtual" ? "outline" : "warning"}>
                    {INSIGHT_STRENGTH_LABEL[ins.strength]}
                  </Badge>
                  {ins.machineGenerated && <Badge tone="ai">AI 候选</Badge>}
                  {isConfirmed && <Badge tone="primary">已入库</Badge>}
                </div>
                <p className="text-11 leading-snug">{ins.text}</p>

                {/* 挂的原始引述（点回时间码）—— 无锚点的引用视为不合格 */}
                <div className="flex flex-col gap-1 rounded-sm bg-muted p-1.5" data-testid={`itv-insight-anchors-${ins.id}`}>
                  <span className="text-9 font-medium text-muted-foreground">原始引述</span>
                  {ins.quoteSegmentIds.map((sid) => {
                    const seg = TRANSCRIPT.find((s) => s.id === sid);
                    if (!seg) return null;
                    return (
                      <a
                        key={sid}
                        href={`#itv-seg-${sid}`}
                        data-testid={`itv-insight-anchor-${ins.id}-${sid}`}
                        className="flex items-start gap-1 rounded-sm p-0.5 transition-colors duration-200 hover:bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <Quote aria-hidden className="mt-0.5 h-2.5 w-2.5 shrink-0 text-muted-foreground" />
                        <span className="min-w-0 flex-1 truncate text-10">
                          「{seg.text}」
                        </span>
                        <span className="shrink-0 font-mono text-9 text-primary">{seg.tc}</span>
                      </a>
                    );
                  })}
                </div>

                {researcher && !isConfirmed && (
                  <Button
                    size="xs"
                    variant="ai"
                    onClick={() => setConfirmed((p) => new Set(p).add(ins.id))}
                    data-testid={`itv-insight-confirm-${ins.id}`}
                  >
                    确认入洞察库
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      <Separator />

      {/* ── 撤回的下游影响（D-13：不静默删除）───────────────── */}
      <section className="flex flex-col gap-2" data-testid="itv-withdrawal-impact">
        <div className="flex items-center gap-1.5">
          <AlertOctagon aria-hidden className="h-3.5 w-3.5 text-destructive" />
          <h2 className="text-13 font-semibold">撤回的下游影响</h2>
        </div>
        <p className="text-10 text-muted-foreground">
          {WITHDRAWAL_IMPACT.interviewee} 已撤回授权。以下是自动发生的连锁反应，不静默删除任何一环。
        </p>
        <div className="flex flex-col gap-1.5 rounded-md border border-destructive/30 bg-destructive/5 p-2">
          <div className="flex items-center gap-1.5 text-11" data-testid="itv-withdrawal-quotes">
            <Undo2 aria-hidden className="h-3 w-3 text-destructive" />
            <span><strong>{WITHDRAWAL_IMPACT.quotesRemoved}</strong> 条引述已退出检索，主题矩阵已重算强度</span>
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-10 font-medium text-muted-foreground">引用过它的报告段落（标「证据已撤回」，不删）</span>
            {WITHDRAWAL_IMPACT.affectedReportSegments.map((r) => (
              <div key={r.id} className="flex items-center justify-between rounded-sm bg-card px-1.5 py-1" data-testid={`itv-withdrawal-report-${r.id}`}>
                <span className="text-10">{r.title}</span>
                <Badge tone="danger">证据已撤回</Badge>
              </div>
            ))}
          </div>
          {WITHDRAWAL_IMPACT.decisionToReview && (
            <div className="flex items-start gap-1.5 rounded-sm border border-warning/30 bg-warning/5 p-1.5" data-testid="itv-withdrawal-decision">
              <ArrowRight aria-hidden className="mt-0.5 h-3 w-3 shrink-0 text-warning" />
              <span className="text-10">
                已支撑过签字决策「{WITHDRAWAL_IMPACT.decisionToReview.title}」，已通知拍板人
                <strong> {WITHDRAWAL_IMPACT.decisionToReview.owner}</strong> 复核，而不是自动改结论。
              </span>
            </div>
          )}
          <span className="text-9 text-muted-foreground">物理删除并回执受访者 · 于 {WITHDRAWAL_IMPACT.retentionDeleteBy} 前完成</span>
        </div>
      </section>
    </div>
  );
}
