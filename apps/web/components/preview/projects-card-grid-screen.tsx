"use client";
import * as React from "react";
import { Plus, LayoutGrid, FolderOpen, MoreHorizontal, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { StateShell, StatePreviewSwitcher } from "@/components/state/state-shell";
import type { UiState } from "@/lib/ui-state";
import { cn } from "@/lib/utils";
import {
  PROJECT_CARDS, EXPLORATORY_TAGS, KINDS, STATUSES,
  PROJECT_KIND_LABEL, PROJECT_STATUS_LABEL, readOnlyLabel,
  type ProjectCardRow,
} from "@/lib/mock/projects-cardgrid";

/**
 * 「项目」首页 **卡片网格 + 标签过滤** 改版原型 —— 纯 mock 签核材料（ADR-003 第 ① 件）。
 *
 * ⚠ **不接后端、不改生产屏**。生产实现仍是 `components/projects/projects-screen.tsx`
 *   （纯列表、接真实 `GET /projects`）。这一屏只给人类看新呈现形态，供束级
 *   `contracts/project/design-signoff.md` 第 ① 件裁决要不要接线。
 *
 * ## 三档筛选维度（对应 mock 数据源的字段出处表）
 *  ① 项目类型 kind   —— 契约 `ProjectKind`，**有出处**，可直接接真
 *  ② 状态 status     —— 契约 `ProjectStatus`，**有出处**，可直接接真
 *  ③ 标签 tags       —— **探索性 mock，无契约出处**，UI 上显式打「探索性」标记，
 *                        采纳需人类 + API 契约一起裁决（是否新增 tags 面 → 走 delta 重签）
 *
 * 三组筛选取**交集**（都满足才显示）；同组内多选取**并集**。空选 = 不过滤。
 *
 * 七态经 `StateShell` 统一渲染（已有原型零异常态，新屏不延续那个缺陷）。
 */
export function ProjectsCardGridScreen({ uiState }: { uiState: UiState }) {
  const [kinds, setKinds] = React.useState<Set<string>>(new Set());
  const [statuses, setStatuses] = React.useState<Set<string>>(new Set());
  const [tags, setTags] = React.useState<Set<string>>(new Set());

  const toggle = (set: React.Dispatch<React.SetStateAction<Set<string>>>) => (v: string) =>
    set((prev) => {
      const next = new Set(prev);
      if (next.has(v)) next.delete(v);
      else next.add(v);
      return next;
    });

  const clearAll = () => { setKinds(new Set()); setStatuses(new Set()); setTags(new Set()); };
  const anyFilter = kinds.size + statuses.size + tags.size > 0;

  // 原型级动作反馈：真实动作在生产屏接后端，这里只回一句提示，证明按钮是活的（非 happy-path 死控件）。
  const [note, setNote] = React.useState<string | null>(null);

  const visible = PROJECT_CARDS.filter(
    (p) =>
      (kinds.size === 0 || kinds.has(p.kind)) &&
      (statuses.size === 0 || statuses.has(p.status)) &&
      (tags.size === 0 || p.exploratoryTags.some((t) => tags.has(t))),
  );

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 p-6" data-testid="projects-cardgrid-screen">
      {/* 原型材料横幅：签核时最该被看见的一句，不用低对比色 */}
      <p
        className="self-start rounded border border-warning/40 bg-warning/10 px-2 py-1 text-11 font-medium text-foreground"
        data-testid="projects-cardgrid-prototype-note"
      >
        原型材料 · 纯 mock 不接后端 · 未改动生产屏 projects-screen.tsx · tags 为探索性字段（无契约出处，待裁决）
      </p>

      <div className="flex justify-end">
        <StatePreviewSwitcher current={uiState} />
      </div>

      <header className="flex flex-wrap items-end justify-between gap-2">
        <div className="flex flex-col gap-1">
          <h1 className="text-24 font-semibold tracking-tight">项目</h1>
          <p className="text-13 text-muted-foreground">
            一个项目就是一场协作：议程、分组、画布、录音、产出与决策都挂在它下面。
          </p>
        </div>
        <Button
          variant="primary"
          size="sm"
          data-testid="projects-cardgrid-new"
          onClick={() => setNote("原型：新建项目走已有 /project/new 向导（本屏不跳转）")}
        >
          <Plus aria-hidden className="h-3.5 w-3.5" />
          新建项目
        </Button>
      </header>

      {note ? (
        <p
          role="status"
          data-testid="projects-cardgrid-action-note"
          className="self-start rounded border border-border bg-panel px-2 py-1 text-11 text-muted-foreground"
        >
          {note}
        </p>
      ) : null}

      {/* ── 筛选区：三组维度分行，标签组带探索性标记 ───────────────────────── */}
      <div className="flex flex-col gap-2 rounded-lg border border-border-subtle bg-panel p-3" data-testid="projects-cardgrid-filters">
        <FilterRow
          icon={<FolderOpen aria-hidden className="h-3.5 w-3.5 text-muted-foreground" />}
          label="项目类型"
          hint="契约字段 · 可直接接真"
        >
          {KINDS.map((k) => (
            <Chip key={k} active={kinds.has(k)} onClick={() => toggle(setKinds)(k)} testId={`projects-cardgrid-kind-${k}`}>
              {PROJECT_KIND_LABEL[k]}
            </Chip>
          ))}
        </FilterRow>

        <FilterRow
          icon={<LayoutGrid aria-hidden className="h-3.5 w-3.5 text-muted-foreground" />}
          label="状态"
          hint="契约字段 · 可直接接真"
        >
          {STATUSES.map((s) => (
            <Chip key={s} active={statuses.has(s)} onClick={() => toggle(setStatuses)(s)} testId={`projects-cardgrid-status-${s}`}>
              {PROJECT_STATUS_LABEL[s]}
            </Chip>
          ))}
        </FilterRow>

        <FilterRow
          icon={<span aria-hidden className="text-11 text-warning-foreground">◆</span>}
          label="标签"
          hint="探索性 · 无契约出处 · 待人类 + API 契约裁决"
          hintTone="warning"
        >
          {EXPLORATORY_TAGS.map((t) => (
            <Chip key={t} active={tags.has(t)} onClick={() => toggle(setTags)(t)} testId={`projects-cardgrid-tag-${t}`}>
              {t}
            </Chip>
          ))}
        </FilterRow>

        {anyFilter ? (
          <div className="flex items-center gap-2">
            <Button size="xs" variant="outline" onClick={clearAll} data-testid="projects-cardgrid-filter-clear">
              清除全部筛选
            </Button>
            <span className="text-11 text-muted-foreground" data-testid="projects-cardgrid-count">
              命中 {visible.length} / {PROJECT_CARDS.length}
            </span>
          </div>
        ) : null}
      </div>

      <StateShell
        state={uiState}
        skeletonRows={6}
        emptyHint="当前组织还没有项目。新建一个，把一场协作跑起来。"
        onCreate={() => undefined}
        errors={{ name: "项目名不能为空，且同组织内不可重名。" }}
        depFailure={{ what: "项目服务（后台）暂不可用：列表来自缓存仍可看，进入/归档等写操作已置灰。" }}
        denial={{ layer: "organization", reason: "当前组织已停用，仅保留只读访问；新建与写操作对所有角色关闭。" }}
        successMessage="已归档「旧渠道合作复盘工作坊」——转为只读，内容不删除，可一键恢复。"
      >
        {visible.length === 0 ? (
          <p
            className="rounded-lg border border-dashed border-border p-8 text-center text-12 text-muted-foreground"
            data-testid="projects-cardgrid-filter-empty"
          >
            没有匹配所选筛选条件的项目。放宽标签或状态再试。
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3" data-testid="projects-cardgrid-grid">
            {visible.map((p) => (
              <ProjectCard key={p.id} row={p} onNote={setNote} />
            ))}
          </div>
        )}
      </StateShell>
    </div>
  );
}

function FilterRow({
  icon, label, hint, hintTone = "muted", children,
}: {
  icon: React.ReactNode;
  label: string;
  hint: string;
  hintTone?: "muted" | "warning";
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="inline-flex items-center gap-1.5 text-11 font-medium">
        {icon}
        {label}
      </span>
      <span
        className={cn(
          "rounded px-1.5 py-0.5 text-10",
          hintTone === "warning" ? "bg-warning/15 text-warning-foreground" : "text-muted-foreground",
        )}
      >
        {hint}
      </span>
      <span className="mx-1 h-4 w-px bg-border" aria-hidden />
      {children}
    </div>
  );
}

function Chip({
  active, onClick, testId, children,
}: {
  active: boolean;
  onClick: () => void;
  testId: string;
  children: React.ReactNode;
}) {
  return (
    <Button
      size="xs"
      variant={active ? "primary" : "ghost"}
      onClick={onClick}
      aria-pressed={active}
      data-testid={testId}
    >
      {children}
    </Button>
  );
}

/**
 * 项目卡 —— 只画契约五字段 + 探索性标签（标签用虚线边框与其它徽标区分，暗示「未定」）。
 * 危险动作（归档）走 `⋯` 菜单里的二次确认 + 影响范围说明，不做孤零零红按钮
 * （与生产屏 `ProjectRealCard` 的归档语义一致，不另起一套）。
 */
function ProjectCard({ row, onNote }: { row: ProjectCardRow; onNote: (m: string) => void }) {
  const [open, setOpen] = React.useState(false);
  const [confirming, setConfirming] = React.useState(false);
  const archived = row.status === "archived";
  const ro = readOnlyLabel(row.readOnlyReason);

  return (
    <Card
      className="flex flex-col transition-all duration-200 hover:shadow-md"
      data-testid={`projects-cardgrid-card-${row.id}`}
    >
      <CardContent className="flex flex-1 flex-col gap-3 p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="flex min-w-0 flex-col gap-1">
            <h3 className="truncate text-14 font-semibold tracking-tight" data-testid={`projects-cardgrid-card-${row.id}-name`}>
              {row.name}
            </h3>
            <p className="text-11 text-muted-foreground">{PROJECT_KIND_LABEL[row.kind]}</p>
          </div>
          <div className="relative shrink-0">
            <Button
              variant="ghost"
              size="icon"
              aria-label="更多操作"
              aria-expanded={open}
              data-testid={`projects-cardgrid-card-${row.id}-more`}
              onClick={() => { setOpen((v) => !v); setConfirming(false); }}
            >
              <MoreHorizontal aria-hidden className="h-4 w-4" />
            </Button>
            {open ? (
              <div
                role="menu"
                data-testid={`projects-cardgrid-menu-${row.id}`}
                className="absolute right-0 top-9 z-10 w-64 rounded-lg border border-border bg-popover p-1 shadow-md"
              >
                {confirming ? (
                  <div className="flex flex-col gap-2 p-2" data-testid={`projects-cardgrid-archive-confirm-${row.id}`}>
                    <p className="text-12 font-medium">{archived ? "确认恢复这个项目？" : "确认归档这个项目？"}</p>
                    <div className="rounded-md border border-warning/30 bg-warning/5 p-2">
                      {archived ? (
                        <p className="text-11 text-muted-foreground">恢复后项目重新可写，内容与引用关系不变。</p>
                      ) : (
                        <>
                          <p className="text-11 font-medium text-warning-foreground">归档会影响：</p>
                          <ul className="mt-1 flex list-disc flex-col gap-0.5 pl-4 text-11 text-muted-foreground">
                            <li>项目转为只读：写入被拒绝，读仍然可用</li>
                            <li>不删除任何内容，误归档可一键恢复</li>
                            <li>已定版的快照仍可被下游引用</li>
                          </ul>
                        </>
                      )}
                    </div>
                    <div className="flex justify-end gap-1.5">
                      <Button variant="ghost" size="sm" onClick={() => setConfirming(false)} data-testid={`projects-cardgrid-archive-cancel-${row.id}`}>取消</Button>
                      <Button
                        variant={archived ? "primary" : "destructive"}
                        size="sm"
                        data-testid={`projects-cardgrid-archive-submit-${row.id}`}
                        onClick={() => { setOpen(false); setConfirming(false); onNote(`原型：${archived ? "恢复" : "归档"}「${row.name}」（生产屏接真实 archive/unarchive，本屏不改数据）`); }}
                      >
                        {archived ? "确认恢复" : "确认归档"}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    role="menuitem"
                    data-testid={`projects-cardgrid-menu-${row.id}-archive`}
                    onClick={() => setConfirming(true)}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-12",
                      "transition-colors duration-200 hover:bg-muted",
                      archived ? "text-card-foreground" : "text-destructive",
                    )}
                  >
                    <AlertTriangle aria-hidden className="h-3.5 w-3.5" />
                    {archived ? "恢复项目" : "归档项目"}
                  </button>
                )}
              </div>
            ) : null}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <Badge tone={row.status === "active" ? "primary" : "outline"} data-testid={`projects-cardgrid-card-${row.id}-status`}>
            {PROJECT_STATUS_LABEL[row.status]}
          </Badge>
          {ro ? (
            <Badge tone="outline" data-testid={`projects-cardgrid-card-${row.id}-readonly`}>{ro}</Badge>
          ) : null}
        </div>

        {/* 探索性标签：虚线边框，区别于上面有出处的实心/描边徽标，暗示「形态待定」 */}
        {row.exploratoryTags.length > 0 ? (
          <div className="flex flex-wrap gap-1" data-testid={`projects-cardgrid-card-${row.id}-tags`}>
            {row.exploratoryTags.map((t) => (
              <span
                key={t}
                className="rounded-full border border-dashed border-border px-2 py-0.5 text-10 text-muted-foreground"
              >
                {t}
              </span>
            ))}
          </div>
        ) : (
          <p className="text-10 text-muted-foreground" data-testid={`projects-cardgrid-card-${row.id}-tags-empty`}>无标签</p>
        )}

        <div className="mt-auto pt-1">
          <Button
            variant="primary"
            size="sm"
            data-testid={`projects-cardgrid-card-${row.id}-enter`}
            onClick={() => onNote(`原型：进入「${row.name}」（生产屏跳 /projects/${row.id}，本屏不跳转）`)}
          >
            进入项目
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
