"use client";
import * as React from "react";
import Link from "next/link";
import { ArrowLeft, Save, Link2, Check, Construction } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { StatePreviewSwitcher } from "@/components/state/state-shell";
import { UI_STATE_LABEL, type UiState } from "@/lib/ui-state";
import {
  INTERVIEW_VIEWS, type InterviewView,
} from "@/lib/mock/interview";
import {
  DETAIL_TABS, DETAIL_HEADER, ATTACH_STAGES, type DetailTabId,
} from "@/lib/mock/interview-studio";
import { cn } from "@/lib/utils";
import { InterviewStage } from "@/components/interview/interview-stage";
import { ResearchDesign } from "@/components/interview/research-design";
import { RespondentRoster } from "@/components/interview/respondent-roster";
import { InsightsReport } from "@/components/interview/insights-report";

/**
 * 访谈详情 · 六标签外壳（UC-6.0 R8 信息架构）。
 * 记录标签的三栏（左提纲 / 中转录 / 右副驾驶）由 AppShell 承载，本组件只放中栏内容；
 * 其余标签是单栏。tab 用 `?tab=` 承载，切换即整页导航（SSR 可锚定 testid）。
 */
export function InterviewDetail({
  id, tab, state, view,
}: {
  id: string;
  tab: DetailTabId;
  state: UiState;
  view: InterviewView;
}) {
  const isRecord = tab === "record";
  const hrefFor = (t: DetailTabId) => `/studio/interview/${id}?tab=${t}&state=${state}&view=${view}`;

  return (
    <div className="relative flex h-full flex-col">
      <div className={cn("flex flex-1 flex-col gap-3 overflow-y-auto p-4 pb-16", !isRecord && "mx-auto w-full max-w-[900px]")}>
        {/* 返回 + 页头 */}
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Button size="xs" variant="ghost" asChild data-testid="itv-detail-back">
              <Link href={`/studio/interview?state=${state}`}>
                <ArrowLeft aria-hidden className="h-3 w-3" /> 返回访谈列表
              </Link>
            </Button>
            <span className="text-10 text-muted-foreground">
              当前状态：<strong className="text-background-foreground">{UI_STATE_LABEL[state]}</strong>
            </span>
          </div>
          <div className="flex flex-col gap-0.5">
            <h1 className="text-18 font-semibold tracking-tight">{DETAIL_HEADER.title}</h1>
            <p className="text-11 text-muted-foreground">{DETAIL_HEADER.belongsTo}</p>
          </div>
        </div>

        {/* 预览开关：七态 + 角色视角（预览手段，非权限实现）*/}
        <div className="flex flex-col gap-1.5">
          <StatePreviewSwitcher current={state} />
          <div className="flex flex-col gap-1 rounded-md border border-border-subtle bg-panel p-1.5" data-testid="itv-detail-view-switcher">
            <div className="flex flex-wrap items-center gap-1">
              <span className="px-1 text-10 uppercase tracking-wide text-muted-foreground">视角</span>
              {INTERVIEW_VIEWS.map((v) => (
                <Button key={v.id} asChild size="xs" variant={v.id === view ? "primary" : "ghost"} data-testid={`itv-detail-view-${v.id}`}>
                  <Link href={`/studio/interview/${id}?tab=${tab}&state=${state}&view=${v.id}`}>{v.label}</Link>
                </Button>
              ))}
            </div>
            <p className="px-1 text-10 text-muted-foreground">
              视角切换是预览手段，不是权限实现——真实权限在服务端（NestJS Guard + RLS）。
            </p>
          </div>
        </div>

        {/* 六标签 */}
        <nav className="flex flex-wrap gap-0.5 border-b border-border" data-testid="itv-detail-tabs">
          {DETAIL_TABS.map((t) => (
            <Link
              key={t.id}
              href={hrefFor(t.id)}
              data-testid={`itv-detail-tab-${t.id}`}
              aria-current={t.id === tab ? "page" : undefined}
              className={cn(
                "-mb-px inline-flex items-center gap-1 border-b-2 px-2.5 py-1.5 text-12 font-medium transition-all duration-200",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                t.id === tab
                  ? "border-primary text-background-foreground"
                  : "border-transparent text-muted-foreground hover:text-background-foreground",
              )}
            >
              {t.label}
            </Link>
          ))}
        </nav>

        {/* 标签内容 */}
        <div className="flex-1">
          {tab === "design" && <ResearchDesign state={state} view={view} />}
          {tab === "respondents" && <RespondentRoster state={state} view={view} />}
          {tab === "record" && <InterviewStage state={state} view={view} />}
          {tab === "insight" && <InsightsReport state={state} view={view} />}
          {(tab === "virtual" || tab === "expert") && <Phase3Placeholder tab={tab} />}
        </div>
      </div>

      {/* 底部统一条：自动保存 + 挂到项目环节 */}
      <DetailFooter />
    </div>
  );
}

function Phase3Placeholder({ tab }: { tab: "virtual" | "expert" }) {
  const label = tab === "virtual" ? "虚拟" : "专家推演";
  return (
    <div
      data-testid={`itv-detail-placeholder-${tab}`}
      className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border py-12 text-center"
    >
      <Construction aria-hidden className="h-6 w-6 text-muted-foreground" />
      <div className="flex flex-col gap-1">
        <p className="text-13 font-medium">「{label}」标签属 phase-3 · 16-persona</p>
        <p className="text-11 text-muted-foreground">
          phase-1 只做列表展示 + 探索性隔离标记；虚拟人的构造能力（专家设定 / 提问推演 / 采纳标注）不在本阶段范围内（UC-6.0 R6）。
        </p>
      </div>
      <Badge tone="outline">本阶段占位 · 不实现</Badge>
    </div>
  );
}

function DetailFooter() {
  const [attaching, setAttaching] = React.useState(false);
  const [attachedTo, setAttachedTo] = React.useState<string | null>(null);
  return (
    <div className="absolute inset-x-0 bottom-0 flex flex-col border-t border-border bg-panel/95 backdrop-blur" data-testid="itv-detail-footer">
      {attaching && (
        <div className="flex flex-col gap-1.5 border-b border-border-subtle p-3" data-testid="itv-detail-attach-panel">
          <span className="text-11 font-medium text-muted-foreground">
            挂到项目环节——绑定固定快照，可解除，全程留痕；解除后回到「不属于任何项目」，产出仍在。
          </span>
          <div className="flex flex-wrap gap-1">
            {ATTACH_STAGES.map((s) => (
              <Button
                key={s.id}
                size="xs"
                variant={attachedTo === s.id ? "primary" : "outline"}
                onClick={() => setAttachedTo(s.id)}
                data-testid={`itv-detail-attach-${s.id}`}
              >
                {attachedTo === s.id && <Check aria-hidden className="h-3 w-3" />} {s.label}
              </Button>
            ))}
          </div>
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2">
        <span className="inline-flex items-center gap-1 text-11 text-muted-foreground">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary" />
          自动保存 {DETAIL_HEADER.autosave} · 后台运行中
        </span>
        <span className="min-w-0 flex-1 truncate text-center text-10 text-muted-foreground">{DETAIL_HEADER.attachHint}</span>
        <div className="flex gap-1.5">
          <Button
            size="xs"
            variant={attaching ? "secondary" : "outline"}
            onClick={() => setAttaching((v) => !v)}
            aria-expanded={attaching}
            data-testid="itv-detail-attach-toggle"
          >
            <Link2 aria-hidden className="h-3 w-3" /> 挂到项目环节…
          </Button>
          <Button size="xs" variant="primary" onClick={() => {}} data-testid="itv-detail-save">
            <Save aria-hidden className="h-3 w-3" /> 保存
          </Button>
        </div>
      </div>
    </div>
  );
}
