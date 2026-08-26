import { Sparkles, Minus, Plus, X, Info } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { StaticSwitch } from "./static-switch";
import { StateShell, type UiState } from "@/components/state/state-shell";
import { RESEARCH_DESIGN, outlineTotalMinutes, type ItvView } from "@/lib/mock/itv";

/**
 * ③ 研究设计（UC-6.2）—— 质性访谈的设计正文。
 *   上下文三要素（谁 / 处境 / 决定）+ 常驻方法论声明 + 大纲（目标先、问法后 ≥2）
 *   + 研究计划参数四行（保留期读项目参数，禁止写死天数；「禁止用于训练」是独立开关）。
 *   AI 生成的大纲是草案：页头「待你确认」，未确认不得进现场。
 */
export function ResearchDesign({ state, view }: { state: UiState; view: ItvView }) {
  const d = RESEARCH_DESIGN;
  const canWrite = view === "researcher";
  const total = outlineTotalMinutes();
  return (
    <section className="flex flex-col gap-4 p-5" data-testid="itv-research-design">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-20 font-semibold text-background-foreground">研究设计</h1>
          <span
            className="flex w-fit items-center gap-1.5 rounded-md border border-ai/20 bg-ai-tint px-2 py-1 text-11 text-ai-tint-foreground"
            data-testid="itv-design-status"
          >
            <Sparkles aria-hidden className="h-3.5 w-3.5" />
            {d.status}
          </span>
        </div>
        <Button size="sm" variant="outline" disabled={!canWrite} data-testid="itv-design-regen">
          重新生成大纲
        </Button>
      </header>

      <StateShell
        state={state}
        skeletonRows={6}
        emptyHint="还没有大纲 —— 走一遍新建向导，或点「重新生成大纲」"
        errors={{ opener: "第 03、04 段照抄了研究问题，需改成经历型提问", total: "合计时长超过研究计划参数（60 分），建议压缩" }}
        depFailure={{ what: "AI 生成服务不可用；保留上一版大纲，可手工编辑" }}
        denial={{ layer: "project", reason: "你在本访谈中是只读角色，不能改大纲" }}
        successMessage="大纲已确认（可进入现场）"
      >
        <div className="flex flex-col gap-4">
          {/* 上下文三要素 */}
          <Card className="p-4" data-testid="itv-design-context">
            <span className="text-13 font-medium text-background-foreground">上下文 · 为什么做这轮访谈</span>
            <div className="mt-2 grid gap-2 md:grid-cols-3">
              {[
                { k: "谁", v: d.context.who },
                { k: "在什么处境", v: d.context.situation },
                { k: "要做什么决定", v: d.context.decision },
              ].map((f) => (
                <div key={f.k} className="rounded-md border border-border-subtle bg-panel p-2">
                  <p className="text-10 text-muted-foreground">{f.k}</p>
                  <p className="text-12 text-background-foreground">{f.v}</p>
                </div>
              ))}
            </div>
            {d.methodologyNotes.map((n, i) => (
              <p
                key={i}
                data-testid={`itv-design-methodology-${i}`}
                className="mt-2 flex gap-1.5 rounded-md border border-border-subtle bg-card px-2 py-1.5 text-11 text-muted-foreground"
              >
                <Info aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                {n}
              </p>
            ))}
          </Card>

          {/* 访谈大纲 */}
          <Card className="p-4" data-testid="itv-design-outline">
            <div className="flex items-center justify-between">
              <span className="text-13 font-medium text-background-foreground">访谈大纲 · 合计 {total} 分钟</span>
              <Badge tone="warning" data-testid="itv-design-quality-hint">{d.qualityHint}</Badge>
            </div>
            <p className="mb-2 text-10 text-muted-foreground">每段先说要问出什么，再给开场问法（≥2 条）</p>
            <div className="flex flex-col gap-2">
              {d.segments.map((sg) => (
                <div
                  key={sg.no}
                  data-testid={`itv-design-segment-${sg.no}`}
                  className="rounded-md border border-border-subtle bg-panel p-2.5"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-11 font-semibold text-background-foreground">{sg.no}</span>
                    <div className="flex items-center gap-1">
                      <Button size="icon" variant="ghost" disabled={!canWrite} aria-label="减时长">
                        <Minus aria-hidden className="h-3 w-3" />
                      </Button>
                      <span className="text-11 text-background-foreground">{sg.minutes} 分</span>
                      <Button size="icon" variant="ghost" disabled={!canWrite} aria-label="加时长">
                        <Plus aria-hidden className="h-3 w-3" />
                      </Button>
                    </div>
                    {sg.needsRewrite && <Badge tone="warning">需改问法</Badge>}
                    <Button size="icon" variant="ghost" disabled={!canWrite} aria-label="删除段落" className="ml-auto">
                      <X aria-hidden className="h-3 w-3 text-destructive" />
                    </Button>
                  </div>
                  <p className="mt-1 text-12 text-background-foreground">要问出什么：{sg.goal}</p>
                  <ul className="mt-1 flex flex-col gap-0.5">
                    {sg.openers.map((q, i) => (
                      <li key={i} className="text-11 text-muted-foreground">「{q}」</li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
            <p className="mt-2 text-10 text-muted-foreground">大纲是提示不是台本；现场按对方的话走，AI 会盯覆盖度。</p>
          </Card>

          {/* 研究计划参数（四行） */}
          <Card className="p-4" data-testid="itv-design-plan">
            <span className="text-13 font-medium text-background-foreground">研究计划参数</span>
            <div className="mt-2 grid gap-2 md:grid-cols-2">
              {[
                { label: "建议场次", value: d.plan.sessions },
                { label: "每场人数", value: d.plan.perSession },
                { label: "时长", value: d.plan.duration },
              ].map((r) => (
                <div key={r.label} className="rounded-md border border-border-subtle bg-panel p-2">
                  <p className="text-10 text-muted-foreground">{r.label}</p>
                  <p className="text-12 text-background-foreground">{r.value}</p>
                </div>
              ))}
              <div className="rounded-md border border-border-subtle bg-panel p-2" data-testid="itv-plan-retention">
                <p className="text-10 text-muted-foreground">数据保留 · {d.plan.retentionParamLabel}</p>
                <p className="text-12 text-background-foreground">{d.plan.retentionValueSource}</p>
                <span className="mt-1.5 flex items-center gap-1.5 text-11 text-background-foreground">
                  <StaticSwitch on={d.plan.noTraining} label="禁止用于训练" testId="itv-plan-no-training" />
                  禁止用于训练（独立开关）
                </span>
              </div>
            </div>
          </Card>
        </div>
      </StateShell>
    </section>
  );
}
