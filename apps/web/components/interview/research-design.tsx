"use client";
import * as React from "react";
import {
  Sparkles, RefreshCw, Plus, Minus, X, AlertTriangle, Check, Lightbulb,
  Clock, ShieldOff, Users, CalendarClock,
} from "lucide-react";
import { StateShell } from "@/components/state/state-shell";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import type { UiState } from "@/lib/ui-state";
import { canWriteInterview, type InterviewView } from "@/lib/mock/interview";
import {
  RESEARCH_CONTEXT, METHODOLOGY_STATEMENTS, OUTLINE_SEGMENTS, outlineTotalMinutes,
  outlineReworkCount, RESEARCH_PLAN, OUTLINE_STATE_LABEL,
  type OutlineSegment,
} from "@/lib/mock/interview-studio";

/**
 * UC-6.2 研究设计标签：三步向导头 + 上下文三要素 + 大纲编辑器 + 研究计划参数。
 * AI 生成大纲状态为「待你确认」，未确认不得进现场（AC5，此处前端投影）。
 */
export function ResearchDesign({ state, view }: { state: UiState; view: InterviewView }) {
  const canWrite = canWriteInterview(view);
  const [confirmed, setConfirmed] = React.useState(false);
  const total = outlineTotalMinutes();
  const rework = outlineReworkCount();
  const overBudget = total > 55; // 研究计划参数示例值 60；示例大纲合计 55，调段会越界

  return (
    <div className="flex flex-col gap-4" data-testid="itv-research-design">
      {/* 页头：AI 生成 · 待你确认 */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-ai/20 bg-ai-tint px-3 py-2.5" data-testid="itv-design-header">
        <div className="flex items-center gap-2">
          <Sparkles aria-hidden className="h-4 w-4 text-ai" />
          <div className="flex flex-col">
            <span className="text-12 font-medium text-ai-tint-foreground">研究设计</span>
            <span className="text-10 text-muted-foreground" data-testid="itv-design-state">
              {confirmed ? OUTLINE_STATE_LABEL.confirmed : OUTLINE_STATE_LABEL["ai-generated-pending"]}
            </span>
          </div>
        </div>
        {canWrite && (
          <div className="flex gap-1.5">
            <Button size="xs" variant="outline" onClick={() => setConfirmed(false)} data-testid="itv-design-regenerate">
              <RefreshCw aria-hidden className="h-3 w-3" /> 重新生成大纲
            </Button>
            <Button
              size="xs"
              variant={confirmed ? "secondary" : "primary"}
              onClick={() => setConfirmed(true)}
              data-testid="itv-design-confirm"
            >
              <Check aria-hidden className="h-3 w-3" /> {confirmed ? "已确认" : "确认大纲"}
            </Button>
          </div>
        )}
      </div>

      {/* 三步向导指示（进入详情=向导已完成，这里回显路径）*/}
      <WizardTrail />

      {!confirmed && (
        <div className="flex items-start gap-2 rounded-md border border-warning/30 bg-warning/5 px-3 py-2" data-testid="itv-design-gate-note">
          <AlertTriangle aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
          <p className="text-11 text-muted-foreground">
            大纲尚<strong className="text-background-foreground">未确认</strong>。未经研究员确认的草案不得被现场使用——
            「进入现场」在服务端会被拒绝（AC5，此处仅前端投影）。
          </p>
        </div>
      )}

      <StateShell
        state={state}
        emptyHint="还没有大纲——从模板或空白开始，AI 会按目标生成草案"
        onCreate={() => {}}
        errors={{
          openings: `第 3、4 段的开场问法不足两条或照抄了研究问题——${rework} 段还需你改问法`,
        }}
        depFailure={{ what: "AI 生成大纲的 Skill 不可用；已保留上一版大纲，你可手工编辑，稍后重试生成。", retry: () => {} }}
        denial={{ layer: "project", reason: "你在本访谈中不是研究员，只能查看研究设计，不能编辑大纲或改研究计划参数。" }}
        successMessage="研究设计已保存（自动生成新的不可变版本，不覆盖旧版）"
        skeletonRows={5}
      >
        <div className="flex flex-col gap-4">
          {/* 上下文三要素 */}
          <ContextTriad canWrite={canWrite} />

          {/* 方法论声明（两条常驻）*/}
          <section className="flex flex-col gap-2" data-testid="itv-methodology">
            {METHODOLOGY_STATEMENTS.map((m) => (
              <div key={m.id} className="flex items-start gap-2 rounded-md border border-border-subtle bg-panel px-3 py-2" data-testid={`itv-methodology-${m.id}`}>
                <Lightbulb aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
                <p className="text-11 text-muted-foreground">
                  <strong className="text-background-foreground">{m.title}</strong>：{m.body}
                </p>
              </div>
            ))}
          </section>

          {/* 访谈大纲 */}
          <section className="flex flex-col gap-2" data-testid="itv-outline">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-14 font-semibold">访谈大纲</h2>
              <div className="flex items-center gap-2">
                <Badge tone={overBudget ? "warning" : "neutral"} data-testid="itv-outline-total">
                  <Clock aria-hidden className="h-3 w-3" /> 合计 {total} 分钟
                </Badge>
                {rework > 0 && (
                  <Badge tone="warning" data-testid="itv-outline-rework">{rework} 段还需你改问法</Badge>
                )}
              </div>
            </div>
            <p className="text-10 text-muted-foreground">每段先写「要问出什么」，再给开场问法（≥2 条）；顺序不可颠倒。</p>
            <div className="flex flex-col gap-2">
              {OUTLINE_SEGMENTS.map((seg) => (
                <OutlineSegmentView key={seg.no} seg={seg} canWrite={canWrite} />
              ))}
            </div>
            {canWrite && (
              <Button size="sm" variant="outline" onClick={() => {}} data-testid="itv-outline-add" className="self-start">
                <Plus aria-hidden className="h-3.5 w-3.5" /> 加一段
              </Button>
            )}
            <p className="text-10 text-muted-foreground">
              大纲是提示不是台本；现场按对方的话走，AI 会盯覆盖度。
            </p>
          </section>

          {/* 研究计划参数（四行）*/}
          <ResearchPlanPanel canWrite={canWrite} overBudget={overBudget} total={total} />
        </div>
      </StateShell>
    </div>
  );
}

function WizardTrail() {
  const steps = ["选模板", "选对象", "生成提纲"];
  return (
    <div className="flex flex-wrap items-center gap-2 text-11 text-muted-foreground" data-testid="itv-wizard-trail">
      <span>新建向导：</span>
      {steps.map((s, i) => (
        <React.Fragment key={s}>
          <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5">
            <Check aria-hidden className="h-3 w-3 text-success" /> {s}
          </span>
          {i < steps.length - 1 && <span className="text-border">→</span>}
        </React.Fragment>
      ))}
      <span className="text-10">· 三步已走完，当前在生成的大纲里逐段确认</span>
    </div>
  );
}

function ContextTriad({ canWrite }: { canWrite: boolean }) {
  const rows = [
    { id: "who", label: "谁", value: RESEARCH_CONTEXT.who },
    { id: "situation", label: "在什么处境", value: RESEARCH_CONTEXT.situation },
    { id: "decision", label: "要做什么决定", value: RESEARCH_CONTEXT.decision },
  ];
  return (
    <section className="flex flex-col gap-2" data-testid="itv-context-triad">
      <h2 className="text-14 font-semibold">上下文 · 为什么做这轮访谈</h2>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        {rows.map((r) => (
          <div key={r.id} className="flex flex-col gap-1" data-testid={`itv-context-${r.id}`}>
            <Label htmlFor={`ctx-${r.id}`} className="text-10 text-muted-foreground">{r.label}</Label>
            <Textarea
              id={`ctx-${r.id}`}
              defaultValue={r.value}
              readOnly={!canWrite}
              rows={3}
              className="text-11"
            />
          </div>
        ))}
      </div>
    </section>
  );
}

function OutlineSegmentView({ seg, canWrite }: { seg: OutlineSegment; canWrite: boolean }) {
  const [showRewrite, setShowRewrite] = React.useState(false);
  return (
    <Card data-testid={`itv-segment-${seg.no}`} className={seg.needsRework ? "border-warning/40" : undefined}>
      <CardContent className="flex flex-col gap-2 pt-4">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="text-11 font-mono text-muted-foreground">{String(seg.no).padStart(2, "0")}</span>
            {canWrite ? (
              <span className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-1.5 py-0.5 text-10">
                <button type="button" onClick={() => {}} aria-label="减少时长" data-testid={`itv-segment-minus-${seg.no}`}
                  className="rounded-sm p-0.5 transition-colors duration-200 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  <Minus aria-hidden className="h-2.5 w-2.5" />
                </button>
                <span className="font-mono">{seg.minutes} 分</span>
                <button type="button" onClick={() => {}} aria-label="增加时长" data-testid={`itv-segment-plus-${seg.no}`}
                  className="rounded-sm p-0.5 transition-colors duration-200 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  <Plus aria-hidden className="h-2.5 w-2.5" />
                </button>
              </span>
            ) : (
              <Badge tone="outline">{seg.minutes} 分</Badge>
            )}
            {seg.needsRework && <Badge tone="warning">需改问法</Badge>}
          </div>
          {canWrite && (
            <button type="button" onClick={() => {}} aria-label="删除本段" data-testid={`itv-segment-remove-${seg.no}`}
              className="rounded-sm p-1 text-muted-foreground transition-colors duration-200 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <X aria-hidden className="h-3 w-3" />
            </button>
          )}
        </div>

        <div className="flex flex-col gap-1">
          <span className="text-10 font-medium text-muted-foreground">要问出什么</span>
          <p className="text-12 leading-snug">{seg.goal}</p>
        </div>

        <div className="flex flex-col gap-1">
          <span className="text-10 font-medium text-muted-foreground">开场问法（{seg.openings.length}）</span>
          <ul className="flex flex-col gap-1">
            {seg.openings.map((o, i) => (
              <li key={i} className="rounded-sm bg-muted px-2 py-1 text-11" data-testid={`itv-segment-opening-${seg.no}-${i}`}>
                「{o}」
              </li>
            ))}
          </ul>
        </div>

        {seg.leadingRewrite && (
          <div className="flex flex-col gap-1">
            <Button size="xs" variant="ghost" onClick={() => setShowRewrite((v) => !v)} aria-expanded={showRewrite} data-testid={`itv-segment-rewrite-toggle-${seg.no}`}>
              <AlertTriangle aria-hidden className="h-3 w-3 text-warning" /> 检测到照抄研究问题 · 看经历型改写
            </Button>
            {showRewrite && (
              <div className="flex flex-col gap-1 rounded-md border border-warning/30 bg-warning/5 p-2" data-testid={`itv-segment-rewrite-${seg.no}`}>
                <span className="text-10 text-muted-foreground">照抄的研究问题：「{seg.leadingRewrite.from}」</span>
                <span className="text-11">建议改成经历型提问：「{seg.leadingRewrite.to}」</span>
                <span className="text-9 text-muted-foreground">这是提示不是阻断——你可以采纳，也可以坚持原问法。</span>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ResearchPlanPanel({ canWrite, overBudget, total }: { canWrite: boolean; overBudget: boolean; total: number }) {
  const rows = [
    { id: "sessions", icon: CalendarClock, label: "建议场次", value: RESEARCH_PLAN.suggestedSessions },
    { id: "people", icon: Users, label: "每场人数", value: RESEARCH_PLAN.perSessionPeople },
    { id: "duration", icon: Clock, label: "时长", value: RESEARCH_PLAN.duration },
  ];
  return (
    <section className="flex flex-col gap-2" data-testid="itv-research-plan">
      <h2 className="text-14 font-semibold">研究计划参数</h2>
      <div className="flex flex-col gap-1.5 rounded-md border border-border-subtle bg-panel p-3">
        {rows.map((r) => (
          <div key={r.id} className="flex items-center gap-2 text-11" data-testid={`itv-plan-${r.id}`}>
            <r.icon aria-hidden className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <span className="w-16 shrink-0 text-muted-foreground">{r.label}</span>
            <span>{r.value}</span>
          </div>
        ))}
        {/* 数据保留一行两语义：保留期（读项目参数）+ 禁止用于训练 */}
        <div className="flex flex-wrap items-center gap-2 border-t border-border-subtle pt-1.5 text-11" data-testid="itv-plan-retention">
          <Clock aria-hidden className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <span className="w-16 shrink-0 text-muted-foreground">数据保留</span>
          <span>{RESEARCH_PLAN.retentionParam.days} 天</span>
          <Badge tone="outline">{RESEARCH_PLAN.retentionParam.source}</Badge>
          <span className="text-border">·</span>
          <span className="inline-flex items-center gap-1" data-testid="itv-plan-no-training">
            <ShieldOff aria-hidden className="h-3.5 w-3.5 text-warning" />
            <strong className="text-background-foreground">禁止用于训练</strong>
            <Badge tone={RESEARCH_PLAN.noTraining ? "primary" : "outline"}>{RESEARCH_PLAN.noTraining ? "已开" : "关"}</Badge>
          </span>
        </div>
      </div>
      {overBudget && (
        <p className="flex items-center gap-1 text-10 text-warning" data-testid="itv-plan-overbudget">
          <AlertTriangle aria-hidden className="h-3 w-3" />
          合计 {total} 分钟已接近研究计划参数「时长 60 分」的上限，建议压缩（取参数值，不写死 60）。
        </p>
      )}
      <p className="text-9 text-muted-foreground">
        保留天数从项目「材料保留期」参数渲染，代码中不写死；「禁止用于训练」是独立开关，下游转写与 AI 管线都读它。
      </p>
    </section>
  );
}
