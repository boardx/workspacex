"use client";
import * as React from "react";
import Link from "next/link";
import { Pencil, Copy, Trash2, Archive, Sparkles, LayoutGrid } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { StateShell } from "@/components/state/state-shell";
import type { UiState } from "@/lib/ui-state";
import type { ProjectRole } from "@/lib/identity";
import {
  BLUEPRINTS, BLUEPRINT_STATS, ALL_BLUEPRINT_TAGS, configTotal, hasEnoughSatisfactionSamples,
  type BlueprintRow,
} from "@/lib/mock/tpl";
import { ConfirmDialog } from "./parts";

const NEW_ENTRIES = [
  { key: "blank", label: "从空白开始" },
  { key: "clone", label: "套用已有蓝本" },
  { key: "reverse", label: "从已办过的项目反向生成", note: "把你实际用过的问卷、画布、素材直接抓成蓝本" },
];

/**
 * 2026-08-14 卡片网格改版（人类直接给三张截图裁决，聊天记录可查）：
 * 原单列行清单（`ui-preview/tpl-v2/uc-2-4-list-default.png`，2026-07-30 已签）换成
 * 卡片网格 + 标签过滤。保留原有全部动作与状态语义（草稿门槛提示、归档 vs 删除的引用计数
 * 门控、三入口新建），只换布局与筛选方式 —— 不是新用例，是同一组 UC 的界面重排。
 *
 * ⚠ 签核材料未同步：`design-signoff.md` ① UI 一节仍指向旧截图，本次改动尚未回填新截图
 * 或人类重新确认——这是本次改动遗留的已知缺口，不是我能自己动 `status`/`confirmed_at`
 * 补上的（ADR-023 只允许人改）。已如实向人类报告，等其决定要不要重签。
 */
export function BlueprintListScreen({
  uiState, previewRole, onToast,
}: { uiState: UiState; previewRole: ProjectRole | null; onToast: (m: string) => void }) {
  const [pending, setPending] = React.useState<{ row: BlueprintRow; action: "delete" | "archive" } | null>(null);
  const [activeTags, setActiveTags] = React.useState<Set<string>>(new Set());
  const total = configTotal();

  const toggleTag = (tag: string) => {
    setActiveTags((prev) => {
      const next = new Set(prev);
      if (next.has(tag)) next.delete(tag); else next.add(tag);
      return next;
    });
  };

  const visible = BLUEPRINTS.filter((b) => activeTags.size === 0 || b.tags.some((t) => activeTags.has(t)));

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 p-4">
      <header className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-20 font-bold tracking-tight">项目模板</h1>
          <p className="text-12 text-muted-foreground" data-testid="tpl-list-stats">
            {BLUEPRINT_STATS.total} 个 · {BLUEPRINT_STATS.published} 已发布 · {BLUEPRINT_STATS.draft} 草稿
          </p>
        </div>
        <Button size="sm" variant="primary" onClick={() => onToast("新建蓝本三选一：从空白 / 套用已有 / 从历史项目反向生成")} data-testid="tpl-new-blueprint">
          <Sparkles aria-hidden className="h-3.5 w-3.5" /> 新建模板
        </Button>
      </header>

      {/* 标签过滤器 —— 多选，取交集为空集合时不过滤（全部可见） */}
      <div className="flex flex-wrap items-center gap-1.5" data-testid="tpl-tag-filters">
        <LayoutGrid aria-hidden className="h-3.5 w-3.5 text-muted-foreground" />
        {ALL_BLUEPRINT_TAGS.map((tag) => (
          <Button
            key={tag}
            size="sm"
            variant={activeTags.has(tag) ? "primary" : "ghost"}
            onClick={() => toggleTag(tag)}
            data-testid={`tpl-tag-filter-${tag}`}
          >
            {tag}
          </Button>
        ))}
        {activeTags.size > 0 && (
          <Button size="sm" variant="outline" onClick={() => setActiveTags(new Set())} data-testid="tpl-tag-filter-clear">
            清除筛选
          </Button>
        )}
      </div>

      <StateShell
        state={uiState}
        skeletonRows={7}
        emptyHint="还没有任何蓝本。从空白开始，或从一场已办过的项目反向生成。"
        onCreate={() => onToast("新建蓝本")}
        errors={{ "list": "复制失败：目标组织的蓝本命名冲突，请改名后重试。" }}
        depFailure={{ what: "蓝本库（后台）暂不可用：列表元数据来自缓存仍可看，行操作已置灰。" }}
        denial={{ layer: "organization", reason: "观察者/组员无权进入后台项目蓝本库；蓝本的编辑与发布属方法负责人。" }}
        successMessage="已复制为独立新蓝本（草稿态 · 无版本号 · 用过 0 次 · 不继承满意度）"
      >
        {visible.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border p-6 text-center text-12 text-muted-foreground" data-testid="tpl-tag-filter-empty">
            没有匹配所选标签的模板
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3" data-testid="tpl-blueprint-grid">
            {visible.map((b) => (
              <BlueprintCard key={b.id} row={b} total={total} onToast={onToast} onDanger={(action) => setPending({ row: b, action })} />
            ))}
          </div>
        )}

        <footer className="mt-2 flex flex-col gap-1.5 rounded-lg border border-dashed border-border p-3" data-testid="tpl-new-entries">
          <span className="text-11 font-medium text-muted-foreground">新建模板三入口</span>
          <div className="flex flex-wrap gap-2">
            {NEW_ENTRIES.map((e) => (
              <Button key={e.key} size="sm" variant="outline" onClick={() => onToast(`新建：${e.label}${e.note ? `（${e.note}）` : ""}`)} data-testid="tpl-new-entry">
                {e.label}
              </Button>
            ))}
          </div>
        </footer>
      </StateShell>

      <ConfirmDialog
        open={!!pending}
        tone="destructive"
        title={pending?.action === "delete" ? `删除蓝本「${pending?.row.name}」？` : `归档蓝本「${pending?.row.name}」？`}
        confirmLabel={pending?.action === "delete" ? "确认删除" : "确认归档"}
        requireReason
        onConfirm={() => { onToast(`${pending?.action === "delete" ? "已删除" : "已归档"}：${pending?.row.name}`); setPending(null); }}
        onClose={() => setPending(null)}
        impact={
          pending?.action === "delete" ? (
            <div className="flex flex-col gap-1">
              <p>该蓝本<b>从未被任何项目套用</b>，可物理删除。</p>
              <p className="text-muted-foreground">删除后不可恢复；动作写审计。</p>
            </div>
          ) : (
            <div className="flex flex-col gap-1">
              <p>该蓝本<b>已被项目套用过，不可删除、只可归档</b>（快照必须保持可达，O-18①）。</p>
              <p className="text-muted-foreground">归档只影响「还能不能新建」：不再出现在新建项目的可选列表；已套用的项目照常打开、编辑、运行，切到某环节仍可新建画布/产出实例。</p>
            </div>
          )
        }
      />
    </div>
  );
}

function BlueprintCard({
  row, total, onToast, onDanger,
}: { row: BlueprintRow; total: number; onToast: (m: string) => void; onDanger: (a: "delete" | "archive") => void }) {
  const isDraft = row.state === "draft";
  return (
    <Card
      className="flex flex-col gap-2 transition-colors duration-200 hover:border-primary/30"
      data-testid="tpl-blueprint-card"
    >
      <CardContent className="flex flex-1 flex-col gap-2 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-14 font-semibold">{row.name}</span>
          {isDraft
            ? <Badge tone="neutral" data-testid="tpl-row-state">草稿</Badge>
            : <Badge tone="primary" data-testid="tpl-row-state">已发布 v{row.version}</Badge>}
          {row.visibility === "team-only" && <Badge tone="outline" data-testid="tpl-row-visibility">仅 {row.team}</Badge>}
        </div>

        <div className="flex flex-wrap gap-1" data-testid="tpl-row-tags">
          {row.tags.map((tag) => (
            <Badge key={tag} tone="outline" className="text-10">{tag}</Badge>
          ))}
        </div>

        <div className="flex flex-col gap-1 text-11 text-muted-foreground">
          {/* 议程环节数·时长 与 完成度 n/N 是两个独立字段，互不串位 */}
          <span data-testid="tpl-row-agenda">{row.agendaSegments} 环节 · {row.duration}</span>
          <span data-testid="tpl-row-used">用过 {row.usedCount} 次</span>
          <span data-testid="tpl-row-satisfaction">
            {row.satisfaction == null
              ? "满意度 —"
              : hasEnoughSatisfactionSamples(row.satisfaction)
                ? `满意度 ${row.satisfaction.mean.toFixed(1)}（${row.satisfaction.sampleSize} 场）`
                : `满意度 样本不足（${row.satisfaction.sampleSize} 场）`}
          </span>
          <span data-testid="tpl-row-completion">{row.doneCount}/{total} 已配</span>
        </div>

        {isDraft && row.draftHint && (
          <p className="text-11 text-warning-foreground" data-testid="tpl-row-draft-hint">{row.draftHint}</p>
        )}

        <div className="mt-auto flex flex-wrap items-center gap-1.5 pt-1">
          {/* 真实挂载点 /tpl/designer（F18），不是本原型内的 ?screen=designer 屏（F318：全仓零引用曾是漂移根因）。
              F18 当前未按蓝本 id 参数化（design-facet-catalog 只接了一套目录），故先全量指向同一入口，
              忠实反映现状；等真实每蓝本路由落地再补 id。*/}
          <Button size="xs" variant="outline" asChild data-testid="tpl-row-edit">
            <Link href="/tpl/designer"><Pencil aria-hidden className="h-3 w-3" /> 编辑设计</Link>
          </Button>
          <Button size="xs" variant="outline" onClick={() => onToast(`已复制「${row.name}」为独立新蓝本草稿`)} data-testid="tpl-row-copy"><Copy aria-hidden className="h-3 w-3" /> 复制</Button>
          {/* 引用计数门控：被套用过 → [归档]；从未套用 → [删除]（O-18①）*/}
          {row.appliedByProject
            ? <Button size="xs" variant="outline" onClick={() => onDanger("archive")} data-testid="tpl-row-archive"><Archive aria-hidden className="h-3 w-3" /> 归档</Button>
            : <Button size="xs" variant="ghost" className="text-destructive transition-colors duration-200 hover:bg-destructive/10" onClick={() => onDanger("delete")} data-testid="tpl-row-delete"><Trash2 aria-hidden className="h-3 w-3" /> 删除</Button>}
        </div>
      </CardContent>
    </Card>
  );
}
