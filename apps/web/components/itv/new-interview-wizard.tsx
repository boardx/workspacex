import { Check, ChevronRight, FileText, Users, Sparkles, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { StateShell, type UiState } from "@/components/state/state-shell";
import {
  WIZARD_STEPS,
  WIZARD_OBJECTS,
  WIZARD_OUTLINE_STATUS,
  INTERVIEW_TEMPLATES,
  RESEARCH_DESIGN,
  reportTemplateById,
  type ItvView,
} from "@/lib/mock/itv";
import { navHref } from "./nav-href";

/**
 * ② 套用模板新建访谈 · 三步向导（UC-6.0 AC3 / UC-6.2）—— v1 完全没做这条。
 *   选模板 → 选对象 → 生成提纲。用 `?step=` 走三步（1/2/3），默认停在第 3 步演示密度。
 *   第一步显示每个模板「用过 N 次 · 题数 · 时长区间 + 配套报告模板」帮助判断；
 *   第二步从访谈对象表选人，上下级关系默认拆场提示；
 *   第三步生成的大纲是**草案**（页头「AI 已按目标生成 · 待你确认」），未确认不得进现场。
 */
export function NewInterviewWizard({
  state,
  view,
  step,
}: {
  state: UiState;
  view: ItvView;
  step: 1 | 2 | 3;
}) {
  return (
    <section className="flex flex-col gap-4 p-5" data-testid="itv-new-wizard">
      <header className="flex flex-col gap-1">
        <h1 className="text-20 font-semibold text-background-foreground">新建访谈 · 选模板 → 选对象 → 生成提纲</h1>
        <p className="text-12 text-muted-foreground">范围默认继承当前切换器取值，向导内可改为「不属于任何项目」。</p>
      </header>

      {/* 步骤条 */}
      <div className="flex flex-wrap items-center gap-2" data-testid="itv-wizard-trail">
        {WIZARD_STEPS.map((s, i) => (
          <div key={s.key} className="flex items-center gap-2">
            <a
              href={`?screen=new&view=${view}&state=${state}&step=${s.no}`}
              data-testid={`itv-wizard-step-${s.no}`}
              className={cn(
                "flex items-center gap-2 rounded-md border px-3 py-1.5 text-12 transition-colors duration-200",
                s.no === step
                  ? "border-primary bg-primary text-primary-foreground"
                  : s.no < step
                    ? "border-border bg-card text-background-foreground hover:bg-muted"
                    : "border-border-subtle bg-panel text-muted-foreground hover:bg-muted",
              )}
            >
              <span className="flex h-4 w-4 items-center justify-center rounded-full text-10">
                {s.no < step ? <Check aria-hidden className="h-3 w-3" /> : s.no}
              </span>
              {s.label}
            </a>
            {i < WIZARD_STEPS.length - 1 && <ChevronRight aria-hidden className="h-4 w-4 text-muted-foreground" />}
          </div>
        ))}
      </div>

      <StateShell
        state={state}
        skeletonRows={4}
        emptyHint="没有可用模板，也没有访谈对象 —— 先去模板库建一个，或选「从空白开始」"
        errors={{ template: "请选择一个模板，或选「不用模板，从空白开始」", objects: "至少选一位受访者" }}
        depFailure={{ what: "生成提纲的 AI 服务不可用；可先选模板与对象，稍后再生成" }}
        denial={{ layer: "project", reason: "你在该范围内没有创建访谈的权限" }}
        successMessage="访谈已创建（大纲为草案，待你确认）"
      >
        {step === 1 && <StepTemplate view={view} state={state} />}
        {step === 2 && <StepObjects />}
        {step === 3 && <StepOutline />}
      </StateShell>
    </section>
  );
}

function StepTemplate({ view, state }: { view: ItvView; state: UiState }) {
  return (
    <div className="flex flex-col gap-3" data-testid="itv-wizard-panel-template">
      <p className="text-12 text-muted-foreground">
        <Sparkles aria-hidden className="mr-1 inline h-3.5 w-3.5" />
        助手按场景推荐了第一个；模板自带要收集的数据字段与配套报告模板。
      </p>
      {INTERVIEW_TEMPLATES.slice(0, 3).map((t, i) => {
        const rt = reportTemplateById(t.reportTemplateId);
        return (
          <Card key={t.id} data-testid={`itv-wizard-tpl-${t.id}`} className={cn("p-4", i === 0 && "border-primary/40")}>
            <div className="flex items-start justify-between gap-3">
              <div className="flex flex-col gap-1">
                <div className="flex flex-wrap items-center gap-2">
                  <FileText aria-hidden className="h-4 w-4 text-muted-foreground" />
                  <span className="text-13 font-medium text-background-foreground">{t.name}</span>
                  {i === 0 && <Badge tone="primary">推荐</Badge>}
                </div>
                <p className="text-11 text-muted-foreground">
                  {t.blurb} · {t.questionCount} 题 · {t.durationRange} · {t.dataFields.length} 个数据字段
                </p>
                <p className="text-10 text-muted-foreground">
                  报告模板：{rt ? rt.name : "未定义（结束后无法一键出洞察报告）"}
                </p>
              </div>
              <Button asChild size="sm" variant={i === 0 ? "primary" : "outline"} data-testid={`itv-wizard-pick-${t.id}`}>
                <a href={`?screen=new&view=${view}&state=${state}&step=2`}>选它</a>
              </Button>
            </div>
          </Card>
        );
      })}
      <Card className="border-dashed p-4" data-testid="itv-wizard-blank">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-13 font-medium text-background-foreground">空白提纲</p>
            <p className="text-11 text-muted-foreground">不用模板，让助手按这场场景直接生成</p>
          </div>
          <Button asChild size="sm" variant="ghost">
            <a href={`?screen=new&view=${view}&state=${state}&step=2`}>从空白开始</a>
          </Button>
        </div>
      </Card>
    </div>
  );
}

function StepObjects() {
  return (
    <div className="flex flex-col gap-3" data-testid="itv-wizard-panel-objects">
      <p className="text-12 text-muted-foreground">从访谈对象表选人；带入部门角色、语言、背景与「要问什么」作为大纲上下文。</p>
      {WIZARD_OBJECTS.map((o) => (
        <Card key={o.id} data-testid={`itv-wizard-obj-${o.id}`} className="p-3">
          <div className="flex items-start justify-between gap-3">
            <div className="flex flex-col gap-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-12 font-medium text-background-foreground">
                  {o.id} {o.name}
                </span>
                <Badge tone="outline">{o.role}</Badge>
                <Badge tone="neutral">{o.language}</Badge>
              </div>
              <p className="text-11 text-muted-foreground">{o.background}</p>
              {o.relation && (
                <p
                  className={cn(
                    "text-10",
                    o.relation.includes("拆场") ? "text-warning" : "text-muted-foreground",
                  )}
                  data-testid={`itv-wizard-relation-${o.id}`}
                >
                  {o.relation.includes("拆场") && <AlertTriangle aria-hidden className="mr-1 inline h-3 w-3" />}
                  关系：{o.relation}
                </p>
              )}
            </div>
            <Button size="sm" variant="outline" data-testid={`itv-wizard-add-obj-${o.id}`}>
              加入本场
            </Button>
          </div>
        </Card>
      ))}
      <p className="rounded-md border border-warning/30 bg-warning/5 px-3 py-2 text-11 text-background-foreground">
        <AlertTriangle aria-hidden className="mr-1 inline h-3.5 w-3.5 text-warning" />
        P-10 与 P-11 是上下级（同公司）——默认<strong>拆成两场</strong>，避免下属附和污染证据（同组织不超过 2 人）。
      </p>
    </div>
  );
}

function StepOutline() {
  const rt = reportTemplateById(INTERVIEW_TEMPLATES[0]!.reportTemplateId);
  return (
    <div className="flex flex-col gap-3" data-testid="itv-wizard-panel-outline">
      <div className="flex flex-wrap items-center gap-2 rounded-md border border-ai/20 bg-ai-tint px-3 py-2">
        <Sparkles aria-hidden className="h-4 w-4 text-ai-tint-foreground" />
        <span className="text-12 text-ai-tint-foreground" data-testid="itv-wizard-outline-status">
          研究设计 —— {WIZARD_OUTLINE_STATUS}
        </span>
        <Button size="xs" variant="outline" data-testid="itv-wizard-regen">重新生成大纲</Button>
      </div>
      <Card className="p-4">
        <p className="mb-2 text-12 font-medium text-background-foreground">生成的大纲草案（含模板分段 + 对象背景，均可改）</p>
        <div className="flex flex-col gap-2">
          {RESEARCH_DESIGN.segments.map((sg) => (
            <div key={sg.no} className="rounded-md border border-border-subtle bg-panel p-2.5">
              <div className="flex items-center gap-2">
                <span className="text-11 font-semibold text-background-foreground">{sg.no}</span>
                <Badge tone="neutral">{sg.minutes} 分</Badge>
                {sg.needsRewrite && <Badge tone="warning">需改问法</Badge>}
              </div>
              <p className="mt-1 text-12 text-background-foreground">要问出什么：{sg.goal}</p>
            </div>
          ))}
        </div>
        <p className="mt-3 text-10 text-muted-foreground">
          该模板配套报告模板：{rt ? rt.name : "未定义"} —— 访谈结束后可一键按它出洞察报告。
        </p>
      </Card>
      <div className="flex items-center justify-end gap-2">
        <Button asChild size="sm" variant="outline">
          <a href={navHref({ screen: "design", view: "researcher", state: "default" })}>去研究设计逐段确认</a>
        </Button>
        <Button size="sm" variant="primary" data-testid="itv-wizard-create">创建并排期</Button>
      </div>
    </div>
  );
}
