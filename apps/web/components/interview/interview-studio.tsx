"use client";
import * as React from "react";
import Link from "next/link";
import {
  Plus, Search, ChevronsUpDown, Link2, Check, Sparkles, PlayCircle,
  FileText, RefreshCw, Bot, Info, Pencil, Wand2, GitBranch,
} from "lucide-react";
import { StateShell, StatePreviewSwitcher } from "@/components/state/state-shell";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Avatar } from "@/components/ui/avatar";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import type { UiState } from "@/lib/ui-state";
import { cn } from "@/lib/utils";
import {
  INTERVIEW_SCOPES, SCOPE_OPEN_QUESTIONS, INTERVIEW_FILTERS, INTERVIEW_ROWS,
  INTERVIEW_STATUS_LABEL, interviewCounts, ATTACH_STAGES,
  INTERVIEW_TEMPLATES, DETAIL_HEADER,
  type InterviewFilterKey, type InterviewRowView, type InterviewStatus, type InterviewTemplate,
} from "@/lib/mock/interview-studio";

const STATUS_TONE: Record<InterviewStatus, "warning" | "primary" | "neutral" | "outline"> = {
  running: "warning", done: "primary", prepping: "neutral", draft: "outline",
};

/** UC-6.0 访谈 Studio 列表 + 范围切换器 + 两标签（访谈 / 访谈模板）+ 筛选 */
export function InterviewStudio({
  state, scopeId, tab = "interviews",
}: {
  state: UiState;
  scopeId: string;
  tab?: "interviews" | "templates";
}) {
  const [filter, setFilter] = React.useState<InterviewFilterKey>("all");
  const scope = INTERVIEW_SCOPES.find((s) => s.id === scopeId) ?? INTERVIEW_SCOPES[0]!;
  const counts = interviewCounts(scope.id);

  const rows = INTERVIEW_ROWS.filter(
    (r) => r.scopeId === scope.id && (filter === "all" || r.tags.includes(filter)),
  );

  return (
    <div className="relative flex h-full flex-col">
      <div className="mx-auto flex w-full max-w-[900px] flex-1 flex-col gap-4 p-6 pb-16">
        {/* 页头 + 范围切换器（常驻页头，URL 可分享）*/}
        <header className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h1 className="text-20 font-semibold tracking-tight">访谈 Studio</h1>
            <ScopeSwitcher current={scope.id} tab={tab} state={state} />
          </div>
          <p className="text-13 text-muted-foreground">
            访谈 Studio · <strong className="text-background-foreground">独立发起，不依赖项目</strong>。
            访谈 · {scope.count} 场——跨项目的全部访谈。打开任意一场进入全屏管理：时间、提纲、要收集的数据、洞察。
          </p>
          <div
            className="flex items-start gap-2 rounded-md border border-border-subtle bg-panel px-3 py-2"
            data-testid="itv-scope-open-question"
          >
            <Info aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <p className="text-11 text-muted-foreground">
              <strong className="text-background-foreground">待 sign-off 裁决：</strong>{SCOPE_OPEN_QUESTIONS}
            </p>
          </div>
        </header>

        <StatePreviewSwitcher current={state} />

        <Tabs value={tab}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <TabsList data-testid="itv-studio-tabs">
              <TabsTrigger value="interviews" asChild data-testid="itv-tab-interviews">
                <Link href={`?scope=${scope.id}&state=${state}&tab=interviews`}>访谈</Link>
              </TabsTrigger>
              <TabsTrigger value="templates" asChild data-testid="itv-tab-templates">
                <Link href={`?scope=${scope.id}&state=${state}&tab=templates`}>访谈模板（来自 3 场项目）</Link>
              </TabsTrigger>
            </TabsList>
            <div className="flex gap-2">
              {tab === "templates" ? (
                <Button size="sm" variant="primary" asChild data-testid="itv-new-template">
                  <Link href={`/studio/interview/i-wang?tab=design&state=${state}`}>
                    <Plus aria-hidden className="h-3.5 w-3.5" /> 新建模板
                  </Link>
                </Button>
              ) : (
                <Button size="sm" variant="primary" asChild data-testid="itv-new-interview">
                  <Link href={`/studio/interview/new?scope=${scope.id}&state=${state}`}>
                    <Plus aria-hidden className="h-3.5 w-3.5" /> 新建访谈
                  </Link>
                </Button>
              )}
            </div>
          </div>

          {/* 工具条：搜索 + 筛选 */}
          <div className="mt-3 flex flex-col gap-2">
            <div className="relative">
              <Search aria-hidden className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input placeholder={tab === "templates" ? "搜索模板…" : "搜索访谈对象、项目、负责人…"} className="pl-8" data-testid="itv-search" />
            </div>
            <div className="flex flex-wrap gap-1" data-testid="itv-filters">
              {INTERVIEW_FILTERS.map((f) => (
                <Button
                  key={f.key}
                  size="sm"
                  variant={filter === f.key ? "primary" : "ghost"}
                  onClick={() => setFilter(f.key)}
                  data-testid={`itv-filter-${f.key}`}
                >
                  {f.label}
                </Button>
              ))}
            </div>
          </div>

          <TabsContent value="interviews">
            <StateShell
              state={state}
              emptyHint={
                scope.kind === "none"
                  ? "本范围（不属于任何项目）下你还没有访谈——新建一场，或先去某个研究项目里看历史访谈作参考"
                  : "本范围下还没有访谈"
              }
              onCreate={() => {}}
              errors={{ filter: "筛选条件解析失败：标签取值超出「全部/客户/内部/高优先级/已归档」范围" }}
              depFailure={{ what: "访谈列表依赖范围过滤服务（服务端强制隔离）；服务不可用，已保留你当前的范围与筛选，可重试。", retry: () => {} }}
              denial={{ layer: "project", reason: "你无权查看本范围——它可能属于其他项目，或是他人「不属于任何项目」的访谈。此处不透露该范围是否存在。" }}
              successMessage="已把「某物流园区运营总监」挂到『欧洲市场进入 · 环节 4「一线访谈」』（绑定固定快照）"
              skeletonRows={4}
            >
              <div className="flex flex-col gap-3" data-testid="itv-list">
                {/* 真人/虚拟分列计数 */}
                <div className="flex flex-wrap items-center gap-2 text-11 text-muted-foreground" data-testid="itv-count-split">
                  <Badge tone="primary">真人 {counts.real} 场</Badge>
                  <Badge tone="outline"><Bot aria-hidden className="h-3 w-3" /> 虚拟 {counts.virtual} 条 · 单独计数</Badge>
                  <span>· 虚拟/数字人条目与真人混排但强标记，计数分列（D-25）</span>
                </div>
                {rows.length === 0 ? (
                  <p className="rounded-md border border-dashed border-border px-3 py-8 text-center text-12 text-muted-foreground">
                    当前筛选「{INTERVIEW_FILTERS.find((f) => f.key === filter)?.label}」下没有访谈
                  </p>
                ) : (
                  rows.map((r) => <InterviewRowItem key={r.id} r={r} state={state} />)
                )}
              </div>
            </StateShell>
          </TabsContent>

          <TabsContent value="templates">
            <StateShell
              state={state}
              emptyHint="模板库还是空的"
              onCreate={() => {}}
              errors={{ prompt: "保存失败：模板缺少「要收集的数据字段」——三样（提纲结构 / 每段时长 / 数据字段）缺一不可" }}
              depFailure={{ what: "模板推演分段依赖访谈 AI Skill；服务不可用，你仍可手工建模板。", retry: () => {} }}
              denial={{ layer: "organization", reason: "模板库是组织级资产；你所在组织未开通访谈能力，或你不是研究员角色。" }}
              successMessage="模板『合规红线摸底』草案已确认入库，来源 3 场访谈可溯源"
              skeletonRows={3}
            >
              {INTERVIEW_TEMPLATES.length === 0 ? (
                <EmptyTemplateLibrary />
              ) : (
                <TemplateLibrary state={state} />
              )}
            </StateShell>
          </TabsContent>
        </Tabs>
      </div>

      {/* 底部常驻：自动保存 · 后台运行中 */}
      <div
        data-testid="itv-studio-autosave"
        className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center justify-center gap-2 border-t border-border bg-panel/95 px-4 py-2 text-11 text-muted-foreground backdrop-blur"
      >
        <span className="inline-flex items-center gap-1">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary" />
          自动保存 {DETAIL_HEADER.autosave} · 后台运行中
        </span>
      </div>
    </div>
  );
}

/* ── 范围切换器（页头常驻，切换即整页导航携带 scope）──────────────── */
function ScopeSwitcher({ current, tab, state }: { current: string; tab: string; state: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-md border border-border-subtle bg-panel p-1.5" data-testid="itv-scope-switcher">
      <div className="flex flex-wrap items-center gap-1">
        <ChevronsUpDown aria-hidden className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="px-1 text-10 uppercase tracking-wide text-muted-foreground">范围</span>
        {INTERVIEW_SCOPES.map((s) => (
          <Button
            key={s.id}
            asChild
            size="xs"
            variant={s.id === current ? "primary" : "ghost"}
            data-testid={`itv-scope-${s.id}`}
          >
            <Link href={`?scope=${s.id}&state=${state}&tab=${tab}`}>{s.label} · {s.count}</Link>
          </Button>
        ))}
      </div>
    </div>
  );
}

/* ── 列表行（七列信息 + 虚拟强标记 + 挂到项目环节）──────────────── */
function InterviewRowItem({ r, state }: { r: InterviewRowView; state: string }) {
  const [attaching, setAttaching] = React.useState(false);
  const [attachedTo, setAttachedTo] = React.useState<string | null>(null);

  return (
    <Card data-testid={`itv-row-${r.id}`} className={cn(r.virtual && "border-ai/40")}>
      <CardContent className="flex flex-col gap-2 pt-4">
        <div className="flex items-start gap-3">
          <Avatar initials={r.objectInitials} className={cn("mt-0.5 shrink-0", r.virtual && "bg-ai-tint text-ai-tint-foreground")} />
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-13 font-medium">{r.object}</span>
              {r.virtual && (
                <Badge tone="ai" data-testid={`itv-row-virtual-${r.id}`}>
                  <Bot aria-hidden className="h-3 w-3" /> 数字人 · 探索性
                </Badge>
              )}
              {r.projectId === null && (
                <Badge tone="outline" data-testid={`itv-row-unassigned-${r.id}`}>不属于任何项目</Badge>
              )}
              <Badge tone={STATUS_TONE[r.status]}>{INTERVIEW_STATUS_LABEL[r.status]}</Badge>
            </div>
            <span className="text-11 text-muted-foreground">{r.belongsTo}</span>
            <p className="text-11 leading-snug">{r.progress}</p>
            <span className="text-10 text-muted-foreground">{r.metric}</span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5 pl-11">
          {r.actions.includes("open") && (
            <Button size="xs" variant="primary" asChild data-testid={`itv-row-open-${r.id}`}>
              <Link href={`/studio/interview/${r.id}?tab=design&state=${state}`}>
                <FileText aria-hidden className="h-3 w-3" /> 打开访谈
              </Link>
            </Button>
          )}
          {r.actions.includes("live") && (
            <Button size="xs" variant="outline" asChild data-testid={`itv-row-live-${r.id}`}>
              <Link href={`/studio/interview/${r.id}?tab=record&state=${state}`}>
                <PlayCircle aria-hidden className="h-3 w-3" /> 进入现场
              </Link>
            </Button>
          )}
          {r.actions.includes("insight") && (
            <Button size="xs" variant="outline" asChild data-testid={`itv-row-insight-${r.id}`}>
              <Link href={`/studio/interview/${r.id}?tab=insight&state=${state}`}>
                <Sparkles aria-hidden className="h-3 w-3" /> 看洞察
              </Link>
            </Button>
          )}
          {r.actions.includes("rerun") && (
            <Button size="xs" variant="ai" onClick={() => {}} data-testid={`itv-row-rerun-${r.id}`}>
              <RefreshCw aria-hidden className="h-3 w-3" /> 再跑一轮
            </Button>
          )}
          <Button
            size="xs"
            variant={attaching ? "secondary" : "ghost"}
            onClick={() => setAttaching((v) => !v)}
            aria-expanded={attaching}
            data-testid={`itv-row-attach-${r.id}`}
          >
            <Link2 aria-hidden className="h-3 w-3" /> 挂到项目环节…
          </Button>
        </div>

        {attaching && (
          <div className="ml-11 flex flex-col gap-2 rounded-md border border-border-subtle bg-panel p-3" data-testid={`itv-row-attach-panel-${r.id}`}>
            <span className="text-11 font-medium text-muted-foreground">
              选一个项目环节挂上去——绑定的是<strong className="text-background-foreground">固定快照</strong>，可解除，全程留痕（D-38 / D-30）。
            </span>
            <ul className="flex flex-col gap-1">
              {ATTACH_STAGES.map((s) => (
                <li key={s.id}>
                  <button
                    type="button"
                    onClick={() => setAttachedTo(s.id)}
                    data-testid={`itv-row-attach-pick-${r.id}-${s.id}`}
                    className={cn(
                      "flex w-full items-center justify-between gap-2 rounded-md border px-2.5 py-2 text-left transition-colors duration-200 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      attachedTo === s.id ? "border-primary bg-accent" : "border-border-subtle bg-card",
                    )}
                  >
                    <span className="min-w-0 truncate text-12">{s.label}</span>
                    {attachedTo === s.id && <Check aria-hidden className="h-3.5 w-3.5 shrink-0 text-primary" />}
                  </button>
                </li>
              ))}
            </ul>
            {attachedTo && (
              <p className="text-11 text-muted-foreground" data-testid={`itv-row-attach-done-${r.id}`}>
                已选中此环节。正式产出绑定固定快照 ID；挂载可解除，产出不因解除而丢失。
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/* ── UC-6.1 模板库 ─────────────────────────────────────────────── */
function TemplateLibrary({ state }: { state: string }) {
  const total = INTERVIEW_TEMPLATES.length;
  return (
    <div className="flex flex-col gap-3" data-testid="itv-template-library">
      <div className="flex flex-col gap-1">
        <div className="flex items-baseline gap-2">
          <h2 className="text-14 font-semibold">访谈模板 · {total}</h2>
        </div>
        <p className="text-11 text-muted-foreground">
          模板决定<strong className="text-background-foreground">提纲结构、每段时长和要收集的数据字段</strong>；新建访谈时套用。套用后与模板脱钩。
        </p>
      </div>
      {INTERVIEW_TEMPLATES.map((t) => (
        <TemplateRow key={t.id} t={t} state={state} />
      ))}
    </div>
  );
}

function TemplateRow({ t, state }: { t: InterviewTemplate; state: string }) {
  const [showSource, setShowSource] = React.useState(false);
  const duration = t.durationMin === t.durationMax ? `${t.durationMin} 分` : `${t.durationMin}–${t.durationMax} 分`;
  return (
    <Card data-testid={`itv-template-${t.id}`}>
      <CardContent className="flex flex-col gap-2 pt-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="flex min-w-0 flex-col gap-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-13 font-medium">{t.name}</span>
              <Badge tone="outline" data-testid={`itv-template-usedcount-${t.id}`}>用过 {t.usedCount} 次</Badge>
              {t.source === "extracted" && (
                <Badge tone="ai"><Wand2 aria-hidden className="h-3 w-3" /> 从访谈抽取</Badge>
              )}
              {t.draft && <Badge tone="warning">草案 · 待确认入库</Badge>}
            </div>
            <p className="text-11 text-muted-foreground">
              {t.desc} · {t.questionCount} 题 · {duration}
            </p>
          </div>
          <div className="flex shrink-0 gap-1.5">
            <Button size="xs" variant="outline" asChild data-testid={`itv-template-edit-${t.id}`}>
              <Link href={`/studio/interview/i-wang?tab=design&state=${state}`}>
                <Pencil aria-hidden className="h-3 w-3" /> 编辑
              </Link>
            </Button>
            <Button size="xs" variant="primary" asChild data-testid={`itv-template-use-${t.id}`}>
              <Link href={`/studio/interview/new?tpl=${t.id}&state=${state}`}>用它新建</Link>
            </Button>
          </div>
        </div>

        {t.source === "extracted" && t.extractedFrom && (
          <div className="flex flex-col gap-1">
            <Button
              size="xs"
              variant="ghost"
              onClick={() => setShowSource((v) => !v)}
              aria-expanded={showSource}
              data-testid={`itv-template-source-toggle-${t.id}`}
            >
              <GitBranch aria-hidden className="h-3 w-3" /> 从哪几场抽取（{t.extractedFrom.length}）
            </Button>
            {showSource && (
              <ul className="flex flex-col gap-1 rounded-md border border-ai/20 bg-ai-tint p-2" data-testid={`itv-template-source-${t.id}`}>
                {t.extractedFrom.map((s, i) => (
                  <li key={i} className="flex items-center gap-1.5 text-10 text-ai-tint-foreground">
                    <FileText aria-hidden className="h-3 w-3 shrink-0" /> {s}
                  </li>
                ))}
                <li className="pt-1 text-10 text-muted-foreground">
                  抽取结果是草案，经研究员确认后才入模板库；拒绝「交给 AI 分析」的片段不进抽取输入（O-05）。
                </li>
              </ul>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function EmptyTemplateLibrary() {
  return (
    <div
      data-testid="itv-template-empty"
      className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border py-12 text-center"
    >
      <p className="text-13 text-muted-foreground">模板库是空的——不预置示例模板，两个出口自己选</p>
      <div className="flex gap-2">
        <Button size="sm" variant="primary" onClick={() => {}} data-testid="itv-template-empty-new">
          <Plus aria-hidden className="h-3.5 w-3.5" /> 新建模板
        </Button>
        <Button size="sm" variant="ai" onClick={() => {}} data-testid="itv-template-empty-extract">
          <Wand2 aria-hidden className="h-3.5 w-3.5" /> 从已有访谈抽取
        </Button>
      </div>
    </div>
  );
}
