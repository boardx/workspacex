"use client";

import * as React from "react";
import { Check, Clock3, Gauge, RotateCcw, Search, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { StateShell } from "@/components/state/state-shell";
import { UI_STATES, UI_STATE_LABEL, type UiState } from "@/lib/ui-state";
import { cn } from "@/lib/utils";

type EffortTier = "fast" | "std" | "deep";

interface EffortOption {
  readonly id: EffortTier;
  readonly label: string;
  readonly duration: string;
  readonly description: string;
  readonly sources: string;
  readonly modelCalls: string;
  readonly durationLimit: string;
  readonly searchAttemptLimit: number;
  readonly modelCallLimit: number;
  readonly recommended?: boolean;
}

const EFFORT_OPTIONS: readonly EffortOption[] = [
  { id: "fast", label: "快速", duration: "约 10 分钟", description: "先确认方向与关键事实", sources: "最多 24 个来源", modelCalls: "12 次模型调用", durationLimit: "10:00", searchAttemptLimit: 16, modelCallLimit: 12 },
  { id: "std", label: "标准", duration: "约 30 分钟", description: "覆盖主要观点并交叉验证", sources: "最多 80 个来源", modelCalls: "40 次模型调用", durationLimit: "30:00", searchAttemptLimit: 60, modelCallLimit: 40, recommended: true },
  { id: "deep", label: "深入", duration: "最长约 2 小时", description: "扩大检索范围与反证强度", sources: "最多 300 个来源", modelCalls: "120 次模型调用", durationLimit: "2:00:00", searchAttemptLimit: 180, modelCallLimit: 120 },
];

function StatePreviewNav({ current }: { current: UiState }) {
  return (
    <nav className="flex flex-wrap items-center gap-1 rounded-md border border-border-subtle bg-panel p-1" data-testid="research-budget-state-switcher" aria-label="预算原型状态">
      <span className="px-1 text-10 text-muted-foreground">预览状态</span>
      {UI_STATES.map((state) => (
        <Button key={state} asChild size="xs" variant={state === current ? "primary" : "ghost"} data-testid={`research-budget-state-${state}`}>
          <a href={`?preview=effort-budget&state=${state}`}>{UI_STATE_LABEL[state]}</a>
        </Button>
      ))}
    </nav>
  );
}

export function GuidedResearchEffortBudgetPreview({ state }: { state: UiState }) {
  const [selected, setSelected] = React.useState<EffortTier>("std");
  const [configured, setConfigured] = React.useState(false);
  const selectedOption = EFFORT_OPTIONS.find((option) => option.id === selected) ?? EFFORT_OPTIONS[0]!;

  const content = (
    <div className="space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-2xl space-y-1">
          <div className="flex items-center gap-2">
            <h1 className="text-24 font-semibold tracking-tight">选择这次研究的投入</h1>
            <Badge tone="ai">检索前确认</Badge>
          </div>
          <p className="text-12 leading-relaxed text-muted-foreground">投入档位决定研究可使用的时间、检索次数和来源上限。开始后不会自动升级；刷新或稍后继续时保留同一档位和已用额度。</p>
        </div>
        <Badge tone={configured ? "primary" : "outline"}>{configured ? "预算已锁定" : "尚未开始"}</Badge>
      </header>

      <section className="grid gap-3 lg:grid-cols-3" data-testid="research-effort-budget" aria-label="研究投入档位">
        {EFFORT_OPTIONS.map((option) => {
          const active = option.id === selected;
          return (
            <button
              key={option.id}
              type="button"
              aria-pressed={active}
              disabled={configured}
              data-testid={`research-effort-${option.id}`}
              onClick={() => setSelected(option.id)}
              className={cn(
                "flex min-h-44 flex-col gap-3 rounded-lg border p-4 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:bg-disabled disabled:text-disabled-foreground",
                active ? "border-primary bg-accent text-accent-foreground shadow-sm" : "border-border bg-card hover:bg-muted",
              )}
            >
              <span className="flex w-full items-start justify-between gap-3">
                <span>
                  <span className="block text-16 font-semibold">{option.label}</span>
                  <span className="mt-1 block text-11 text-muted-foreground">{option.duration}</span>
                </span>
                {active ? <Check className="h-5 w-5 text-primary" aria-hidden /> : option.recommended ? <Badge tone="outline">推荐</Badge> : null}
              </span>
              <span className="text-12 leading-relaxed">{option.description}</span>
              <span className="mt-auto space-y-1 text-11 text-muted-foreground">
                <span className="block">{option.sources}</span>
                <span className="block">{option.modelCalls}</span>
              </span>
            </button>
          );
        })}
      </section>

      <section className="rounded-lg border border-border bg-card p-5" data-testid="research-budget-summary">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1">
            <p className="text-14 font-semibold">{configured ? `${selectedOption.label}投入 · 已恢复` : `${selectedOption.label}投入预览`}</p>
            <p className="text-11 text-muted-foreground">{configured ? "服务端预算快照创建于 09:42，刷新页面不会重置用量。" : "开始后服务端会锁定预算快照，并按真实调用累计用量。"}</p>
          </div>
          {configured && <Button variant="outline" size="sm" data-testid="research-budget-refresh"><RotateCcw className="h-4 w-4" aria-hidden />读取最新用量</Button>}
        </div>
        <div className="mt-5 grid gap-4 md:grid-cols-3">
          <div className="space-y-2">
            <span className="flex items-center gap-2 text-11 text-muted-foreground"><Clock3 className="h-4 w-4" aria-hidden />活跃执行时间</span>
            <p className="text-18 font-semibold tabular-nums">{configured ? `08:16 / ${selectedOption.durationLimit}` : `0 / ${selectedOption.durationLimit}`}</p>
            <Progress value={configured ? 28 : 0} />
          </div>
          <div className="space-y-2">
            <span className="flex items-center gap-2 text-11 text-muted-foreground"><Search className="h-4 w-4" aria-hidden />检索尝试</span>
            <p className="text-18 font-semibold tabular-nums">{configured ? `7 / ${selectedOption.searchAttemptLimit}` : `0 / ${selectedOption.searchAttemptLimit}`}</p>
            <Progress value={configured ? 12 : 0} />
          </div>
          <div className="space-y-2">
            <span className="flex items-center gap-2 text-11 text-muted-foreground"><Gauge className="h-4 w-4" aria-hidden />模型调用</span>
            <p className="text-18 font-semibold tabular-nums">{configured ? `3 / ${selectedOption.modelCallLimit}` : `0 / ${selectedOption.modelCallLimit}`}</p>
            <Progress value={configured ? 8 : 0} />
          </div>
        </div>
        <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
          <p className="flex max-w-xl items-start gap-2 text-11 leading-relaxed text-muted-foreground"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />到达硬上限时，系统会在下一次外部调用前停止，并保留已完成任务、来源与报告草稿；不会静默超支。</p>
          <Button variant="primary" disabled={configured} data-testid="research-budget-save" onClick={() => setConfigured(true)}>{configured ? "已按此投入开始" : "确认投入并开始检索"}</Button>
        </div>
      </section>
    </div>
  );

  return (
    <main className="mx-auto flex w-full max-w-screen-xl flex-col gap-4 p-5 md:p-8" data-testid="research-budget-preview">
      <StatePreviewNav current={state} />
      <StateShell
        state={state}
        emptyHint="还没有可配置的研究计划，请先确认报告大纲。"
        errors={{ effort: "请选择一个投入档位后再开始检索。" }}
        depFailure={{ what: "暂时无法读取服务端预算策略。研究尚未开始，也不会产生用量。", retry: () => undefined }}
        denial={{ layer: "project", reason: "你可以查看研究，但只有研究负责人能锁定投入档位。" }}
        successMessage="投入档位已锁定；恢复时会继续显示同一预算和累计用量。"
        skeletonRows={4}
      >
        {content}
      </StateShell>
    </main>
  );
}
