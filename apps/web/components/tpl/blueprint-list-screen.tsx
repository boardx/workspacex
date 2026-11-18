"use client";
import { canonicalBlueprintCopy, localizeBlueprintCopy } from "@/lib/i18n/blueprint-copy";

import { useI18n } from "@/lib/i18n/provider";

import { ResourceCard, ResourceCardTags } from "@/components/ui/resource-card";
import { TagFilterBar } from "@/components/ui/tag-filter-bar";
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
  { key: "blank", label: canonicalBlueprintCopy("blueprintFlow.startFromBlank2") },
  { key: "clone", label: canonicalBlueprintCopy("blueprintFlow.applyAnExistingBlueprint") },
  { key: "reverse", label: canonicalBlueprintCopy("blueprintFlow.generateFromACompletedProject"), note: "把你实际用过的问卷、画布、素材直接抓成蓝本" },
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
 const { t: blueprintI18n } = useI18n();

  const [pending, setPending] = React.useState<{ row: BlueprintRow; action: "delete" | "archive" } | null>(null);
  const [activeTags, setActiveTags] = React.useState<Set<string>>(new Set());
  const total = configTotal();

  const visible = BLUEPRINTS.filter((b) => activeTags.size === 0 || b.tags.some((t) => activeTags.has(t)));

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 p-4">
      <header className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-20 font-bold tracking-tight">{blueprintI18n("adminNavigation.item.blueprint")}</h1>
          <p className="text-12 text-muted-foreground" data-testid="tpl-list-stats">
            {BLUEPRINT_STATS.total}{blueprintI18n("blueprintFlow.items5")}{BLUEPRINT_STATS.published}{blueprintI18n("blueprintFlow.published")}{BLUEPRINT_STATS.draft}{blueprintI18n("canvas.draft2")}</p>
        </div>
        <Button size="sm" variant="primary" onClick={() => onToast(canonicalBlueprintCopy("blueprintFlow.threeWaysToCreateABlueprintBlankExistingBlueprintOr"))} data-testid="tpl-new-blueprint">
          <Sparkles aria-hidden className="h-3.5 w-3.5" />{blueprintI18n("blueprintFlow.newTemplate")}</Button>
      </header>

      <div data-testid="tpl-tag-filters">
        <TagFilterBar
          prefix="tpl"
          business={blueprintI18n("navigation.templates")}
          tags={ALL_BLUEPRINT_TAGS.map((tag) => ({ tag }))}
          selected={[...activeTags]}
          onChange={(next) => setActiveTags(new Set(next))}
        />
      </div>

      <StateShell
        state={uiState}
        skeletonRows={7}
        emptyHint={blueprintI18n("blueprintFlow.noBlueprintsYetStartFromBlankOrGenerateOneFrom")}
        onCreate={() => onToast(canonicalBlueprintCopy("blueprintFlow.newBlueprint"))}
        errors={{ "list": blueprintI18n("blueprintFlow.copyFailedABlueprintWithThisNameExistsInThe") }}
        depFailure={{ what: blueprintI18n("blueprintFlow.blueprintLibraryAdminIsUnavailableCachedListMetadataRemainsVisible") }}
        denial={{ layer: "organization", reason: blueprintI18n("blueprintFlow.observersAndMembersCannotAccessTheAdminBlueprintLibraryMethod") }}
        successMessage={blueprintI18n("blueprintFlow.copiedAsAnIndependentDraftBlueprintWithNoVersionNumber")}
      >
        {visible.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border p-6 text-center text-12 text-muted-foreground" data-testid="tpl-tag-filter-empty">{blueprintI18n("blueprintFlow.noTemplatesMatchTheSelectedTags")}</p>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3" data-testid="tpl-blueprint-grid">
            {visible.map((b) => (
              <BlueprintCard key={b.id} row={b} total={total} onToast={onToast} onDanger={(action) => setPending({ row: b, action })} />
            ))}
          </div>
        )}

        <footer className="mt-2 flex flex-col gap-1.5 rounded-lg border border-dashed border-border p-3" data-testid="tpl-new-entries">
          <span className="text-11 font-medium text-muted-foreground">{blueprintI18n("blueprintFlow.threeWaysToCreateATemplate")}</span>
          <div className="flex flex-wrap gap-2">
            {NEW_ENTRIES.map((e) => (
              <Button key={e.key} size="sm" variant="outline" onClick={() => onToast(canonicalBlueprintCopy("blueprintFlow.createValue1Value2", { value1: String(e.label), value2: String(e.note ? `（${e.note}）` : "") }))} data-testid="tpl-new-entry">
                {localizeBlueprintCopy(blueprintI18n, e.label)}
              </Button>
            ))}
          </div>
        </footer>
      </StateShell>

      <ConfirmDialog
        open={!!pending}
        tone="destructive"
        title={pending?.action === "delete" ? blueprintI18n("blueprintFlow.deleteBlueprintValue1", { value1: String(pending?.row.name) }) : blueprintI18n("blueprintFlow.archiveBlueprintValue1", { value1: String(pending?.row.name) })}
        confirmLabel={pending?.action === "delete" ? blueprintI18n("chatEntry.confirmDelete") : blueprintI18n("canvas.confirmArchive")}
        requireReason
        onConfirm={() => { onToast(`${pending?.action === "delete" ? "已删除" : "已归档"}：${pending?.row.name}`); setPending(null); }}
        onClose={() => setPending(null)}
        impact={
          pending?.action === "delete" ? (
            <div className="flex flex-col gap-1">
              <p>{blueprintI18n("blueprintFlow.thisBlueprint")}<b>{blueprintI18n("blueprintFlow.hasNeverBeenAppliedToAProject")}</b>{blueprintI18n("blueprintFlow.andCanBePermanentlyDeleted")}</p>
              <p className="text-muted-foreground">{blueprintI18n("blueprintFlow.deletionIsIrreversibleAndRecordedInTheAuditLog")}</p>
            </div>
          ) : (
            <div className="flex flex-col gap-1">
              <p>{blueprintI18n("blueprintFlow.thisBlueprint")}<b>{blueprintI18n("blueprintFlow.hasBeenAppliedToProjectsAndCanOnlyBeArchived")}</b>{blueprintI18n("blueprintFlow.snapshotsMustRemainReachableO18")}</p>
              <p className="text-muted-foreground">{blueprintI18n("blueprintFlow.archivingPreventsNewProjectsFromChoosingThisBlueprintExistingProjects")}</p>
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
 const { t: blueprintI18n } = useI18n();

  const isDraft = row.state === "draft";
  return (
    <ResourceCard
      testId="tpl-blueprint-card"
      title={row.name}
      badges={
        <>
          {isDraft
            ? <Badge tone="neutral" data-testid="tpl-row-state">{blueprintI18n("canvas.draft2")}</Badge>
            : <Badge tone="primary" data-testid="tpl-row-state">{blueprintI18n("blueprintFlow.publishedV")}{row.version}</Badge>}
          {row.visibility === "team-only" && <Badge tone="outline" data-testid="tpl-row-visibility">{blueprintI18n("blueprintFlow.only")}{row.team}</Badge>}
        </>
      }
      tags={<ResourceCardTags tags={row.tags} testId="tpl-row-tags" />}
      meta={
        <>
          {/* 议程环节数·时长 与 完成度 n/N 是两个独立字段，互不串位 */}
          <span data-testid="tpl-row-agenda">{row.agendaSegments}{blueprintI18n("blueprintFlow.segments")}{row.duration}</span>
          <span data-testid="tpl-row-used">{blueprintI18n("blueprintFlow.usageCount", { count: row.usedCount })}</span>
          <span data-testid="tpl-row-satisfaction">
            {row.satisfaction == null
              ? blueprintI18n("blueprintFlow.satisfaction")
              : hasEnoughSatisfactionSamples(row.satisfaction)
                ? blueprintI18n("blueprintFlow.satisfactionValue1Value2Sessions", { value1: String(row.satisfaction.mean.toFixed(1)), value2: String(row.satisfaction.sampleSize) })
                : blueprintI18n("blueprintFlow.satisfactionInsufficientSampleValue1Sessions", { value1: String(row.satisfaction.sampleSize) })}
          </span>
          <span data-testid="tpl-row-completion">{blueprintI18n("blueprintFlow.completionCount", { done: row.doneCount, total: total })}</span>
        </>
      }
      actions={
        <>
          {/* 真实挂载点 /tpl/designer（F18），不是本原型内的 ?screen=designer 屏（F318：全仓零引用曾是漂移根因）。
              F18 当前未按蓝本 id 参数化（design-facet-catalog 只接了一套目录），故先全量指向同一入口，
              忠实反映现状；等真实每蓝本路由落地再补 id。*/}
          <Button size="sm" variant="outline" asChild data-testid="tpl-row-edit">
            <Link href="/tpl/designer"><Pencil aria-hidden className="h-3 w-3" />{blueprintI18n("blueprintFlow.editDesign")}</Link>
          </Button>
          <Button size="sm" variant="outline" onClick={() => onToast(canonicalBlueprintCopy("blueprintFlow.copiedValue1IntoAnIndependentBlueprintDraft", { value1: String(row.name) }))} data-testid="tpl-row-copy"><Copy aria-hidden className="h-3 w-3" />{blueprintI18n("codeFence.copy")}</Button>
          {/* 引用计数门控：被套用过 → [归档]；从未套用 → [删除]（O-18①）*/}
          {row.appliedByProject
            ? <Button size="sm" variant="outline" onClick={() => onDanger("archive")} data-testid="tpl-row-archive"><Archive aria-hidden className="h-3 w-3" />{blueprintI18n("canvas.archive")}</Button>
            : <Button size="sm" variant="ghost" className="text-destructive transition-colors duration-fast hover:bg-destructive/10" onClick={() => onDanger("delete")} data-testid="tpl-row-delete"><Trash2 aria-hidden className="h-3 w-3" />{blueprintI18n("adminLimitPolicy.delete")}</Button>}
        </>
      }
    >
      {/*
        2026-09-22 实测（`scripts/audit-text-contrast.mjs` 打在装好的 0.2.0 上）：下面这行原本是
        `text-warning-foreground`，而该 token 在浅色主题里是 `0 0% 100%` 纯白，打在行的白底上
        对比度只有 1.0——用户根本看不见「为什么还不能发布」这句话。改用成对的 tint 档
        （浅底上 6.45:1，由 `scripts/check-token-contrast.mjs` 看住）。
      */}
      {isDraft && row.draftHint && (
        <p className="text-11 text-warning-tint-foreground" data-testid="tpl-row-draft-hint">{row.draftHint}</p>
      )}
    </ResourceCard>
  );
}
