"use client";
import * as React from "react";
import { Plus, Search, MessageSquarePlus, Link2, Save, GitBranch, AlertOctagon, CheckCircle2 } from "lucide-react";
import { StateShell, StatePreviewSwitcher } from "@/components/state/state-shell";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  PROJECT_PROTOTYPES, UNLINKED_PROTOTYPES, PROTOTYPE_FILTERS, PROTOTYPE_STEPS,
  STUDIO_AUTOSAVE, type PrototypeCard, type PrototypeStatus, type PrototypeFilterKey,
} from "@/lib/mock/studio";
import type { UiState } from "@/lib/ui-state";
import { cn } from "@/lib/utils";

const STATUS_TONE: Record<PrototypeStatus, "danger" | "neutral" | "warning" | "primary"> = {
  blocked: "danger",
  draft: "neutral",
  "in-progress": "warning",
  delivered: "primary",
};
const STATUS_LABEL: Record<PrototypeStatus, string> = {
  blocked: "有阻断",
  draft: "草稿",
  "in-progress": "进行中",
  delivered: "已交付",
};

export function PrototypeScreen({ state }: { state: UiState }) {
  const [filter, setFilter] = React.useState<PrototypeFilterKey>("all");
  const match = (c: PrototypeCard) => filter === "all" || c.status === filter;
  const projectCards = PROJECT_PROTOTYPES.filter(match);
  const unlinkedCards = UNLINKED_PROTOTYPES.filter(match);

  return (
    <div className="relative flex h-full flex-col">
      <div className="mx-auto flex w-full max-w-[825px] flex-1 flex-col gap-5 p-6 pb-16">
        <header className="flex flex-col gap-1">
          <h1 className="text-20 font-semibold tracking-tight">Studio · 原型</h1>
          <p className="text-13 text-muted-foreground">
            从一段设计对话生成可点的原型，再挂到项目环节里给组员用。
          </p>
        </header>

        {/* 硬规则：只保留最新版本 */}
        <div className="flex items-start gap-2 rounded-md border border-border-subtle bg-panel px-3 py-2.5" data-testid="studio-prototype-versioning-rule">
          <GitBranch aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
          <p className="text-11 text-muted-foreground">
            <strong className="text-background-foreground">只保留最新版本</strong>：改动直接落在最新版上，
            <strong className="text-background-foreground">不做版本并排比较</strong>。上一步可以撤回，但不维护并行分支。
          </p>
        </div>

        <StatePreviewSwitcher current={state} />

        {/* 工具条：新建 + 搜索 + 筛选 */}
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="primary" data-testid="studio-prototype-new">
              <Plus aria-hidden className="h-3.5 w-3.5" />
              新建原型
            </Button>
            <div className="relative flex-1">
              <Search aria-hidden className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input placeholder="搜索原型…" className="pl-8" data-testid="studio-prototype-search" />
            </div>
          </div>
          <div className="flex flex-wrap gap-1" data-testid="studio-prototype-filters">
            {PROTOTYPE_FILTERS.map((f) => (
              <Button
                key={f.key}
                size="sm"
                variant={filter === f.key ? "primary" : "ghost"}
                onClick={() => setFilter(f.key)}
                data-testid={`studio-prototype-filter-${f.key}`}
              >
                {f.label} {f.count}
              </Button>
            ))}
          </div>
        </div>

        {/* 新建入口：从一段设计对话开始 */}
        <Card data-testid="studio-prototype-start">
          <CardContent className="flex flex-wrap items-center justify-between gap-3 pt-4">
            <div className="flex items-start gap-2">
              <MessageSquarePlus aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              <div className="flex flex-col">
                <span className="text-13 font-medium">从一段设计对话开始</span>
                <span className="text-11 text-muted-foreground">描述你想要的界面，AI 生成可点原型；随时可挂到某个项目环节。</span>
              </div>
            </div>
            <div className="flex gap-2">
              <Button size="sm" variant="ai" data-testid="studio-prototype-start-chat">开始设计对话</Button>
              <Button size="sm" variant="outline" data-testid="studio-prototype-attach">
                <Link2 aria-hidden className="h-3.5 w-3.5" />
                挂到项目环节…
              </Button>
            </div>
          </CardContent>
        </Card>

        <StateShell
          state={state}
          emptyHint="还没有原型，先从一段设计对话开始"
          onCreate={() => {}}
          errors={{ prompt: "生成失败：设计对话为空或未描述任何界面，请先说清你想要的原型" }}
          depFailure={{ what: "原型生成依赖设计对话服务（后台运行）；服务不可用，无法生成或续跑原型。", retry: () => {} }}
          denial={{ layer: "project", reason: "你在本项目中是观察者，只能查看已交付的原型，不能新建或编辑。" }}
          successMessage="原型『现场大屏 · 主持台 v2』已保存到最新版"
          skeletonRows={4}
        >
          <div className="flex flex-col gap-5">
            <PrototypeGroup
              title="本项目"
              subtitle="欧洲市场进入 · 挂在具体环节上"
              cards={projectCards}
              testid="studio-prototype-group-project"
            />
            <PrototypeGroup
              title="不属于任何项目"
              subtitle="草图与探索，随时可挂到项目环节"
              cards={unlinkedCards}
              testid="studio-prototype-group-unlinked"
            />
          </div>
        </StateShell>
      </div>

      {/* 底部常驻：自动保存 · 后台运行中 */}
      <div
        data-testid="studio-prototype-autosave"
        className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center justify-center gap-2 border-t border-border bg-panel/95 px-4 py-2 text-11 text-muted-foreground backdrop-blur"
      >
        <Save aria-hidden className="h-3 w-3" />
        自动保存 {STUDIO_AUTOSAVE.elapsed}
        {STUDIO_AUTOSAVE.runningInBackground && (
          <>
            <span className="text-border">·</span>
            <span className="inline-flex items-center gap-1">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary" />
              后台运行中
            </span>
          </>
        )}
      </div>
    </div>
  );
}

function PrototypeGroup({
  title, subtitle, cards, testid,
}: { title: string; subtitle: string; cards: PrototypeCard[]; testid: string }) {
  return (
    <section className="flex flex-col gap-2" data-testid={testid}>
      <div className="flex items-baseline gap-2">
        <h2 className="text-14 font-semibold">{title}</h2>
        <span className="text-11 text-muted-foreground">{subtitle}</span>
        <span className="ml-auto text-11 text-muted-foreground">{cards.length} 个</span>
      </div>
      {cards.length === 0 ? (
        <p className="rounded-md border border-dashed border-border px-3 py-6 text-center text-12 text-muted-foreground">
          这一组当前筛选下没有原型
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {cards.map((c) => (
            <PrototypeCardView key={c.id} c={c} />
          ))}
        </div>
      )}
    </section>
  );
}

function PrototypeCardView({ c }: { c: PrototypeCard }) {
  return (
    <Card data-testid={`studio-prototype-card-${c.id}`}>
      <CardContent className="flex flex-col gap-2.5 pt-4">
        <div className="flex items-start justify-between gap-2">
          <span className="text-13 font-medium">{c.title}</span>
          <Badge tone={STATUS_TONE[c.status]} data-testid={`studio-prototype-status-${c.id}`}>
            {c.status === "blocked" && <AlertOctagon aria-hidden className="h-3 w-3" />}
            {c.status === "delivered" && <CheckCircle2 aria-hidden className="h-3 w-3" />}
            {STATUS_LABEL[c.status]}
          </Badge>
        </div>

        <p className="text-11 text-muted-foreground">{c.statusLine}</p>

        {/* 五步进度 */}
        <div className="flex items-center gap-1" data-testid={`studio-prototype-steps-${c.id}`}>
          {PROTOTYPE_STEPS.map((label, i) => {
            const done = i < c.step;
            const current = i === c.step - 1 && c.status !== "delivered";
            return (
              <span
                key={label}
                title={label}
                className={cn(
                  "h-1.5 flex-1 rounded-full transition-colors duration-200",
                  done ? "bg-primary" : "bg-muted",
                  current && "bg-warning",
                )}
              />
            );
          })}
        </div>

        <div className="flex flex-wrap items-center gap-2 text-11 text-muted-foreground">
          <Badge tone="outline" className="font-mono">{c.version}</Badge>
          {c.projectStage ? (
            <span className="truncate">{c.projectStage}</span>
          ) : (
            <span>未挂到任何项目</span>
          )}
          <span className="ml-auto">{c.updatedAt}</span>
        </div>

        <div className="flex gap-1.5">
          {c.status === "delivered" ? (
            <Button size="xs" variant="outline" data-testid={`studio-prototype-open-${c.id}`}>看交付版</Button>
          ) : (
            <Button size="xs" variant="primary" data-testid={`studio-prototype-open-${c.id}`}>继续设计</Button>
          )}
          <Button size="xs" variant="ghost" data-testid={`studio-prototype-undo-${c.id}`}>撤回上一步</Button>
          {c.status === "blocked" && (
            <Button size="xs" variant="outline" data-testid={`studio-prototype-audit-${c.id}`}>
              看 {c.blockers} 项阻断
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
