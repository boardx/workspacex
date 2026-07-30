"use client";
import * as React from "react";
import {
  LayoutGrid, List, Plus, Archive, RotateCcw, Rocket, FlaskConical, Pencil, AlertTriangle, Info,
} from "lucide-react";
import { StateShell } from "@/components/state/state-shell";
import type { UiState } from "@/lib/ui-state";
import type { ProjectRole } from "@/lib/identity";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  A0_TEMPLATES, ORG_TEMPLATES, MERMAID_WHITELIST, IGNORED_SYNTAX_COUNT, PUBLISH_FLOW_NOTE,
  type CanvasTemplateRow, type PublishStatus, type WhitelistType,
} from "@/lib/mock/canvas";

const ALL_TEMPLATES = [...A0_TEMPLATES, ...ORG_TEMPLATES];

const STATUS_TONE: Record<PublishStatus, "primary" | "neutral" | "warning" | "outline"> = {
  已发布: "primary",
  草稿: "warning",
  试跑: "outline",
  已归档: "neutral",
};

type Filter = "全部" | "已发布" | "草稿" | "已归档";
const FILTERS: Filter[] = ["全部", "已发布", "草稿", "已归档"];

/**
 * UC-7.1 后台画布模板库 + 发布状态机 + mermaid 白名单（F101）
 * [原型] 后台管理 → 画布模板：列表/卡片视图、按状态筛选、三段发布流程、白名单 12 类 4 组。
 * 危险动作（归档）显式二次确认 + 影响面「有 N 个议程环节仍绑定此模板」（O-10 ③）。
 */
export function TemplateAdmin({ state, previewRole }: { state: UiState; previewRole: ProjectRole | null }) {
  const [filter, setFilter] = React.useState<Filter>("全部");
  const [view, setView] = React.useState<"list" | "card">("list");
  const [archiving, setArchiving] = React.useState<CanvasTemplateRow | null>(null);
  const [toast, setToast] = React.useState<string | null>(null);
  // 观察者只读：写操作（新建/发布/归档/白名单开关）不渲染
  const readOnly = previewRole === "observer";

  const rows = ALL_TEMPLATES.filter((t) => filter === "全部" || t.status === filter);
  const counts = {
    total: ALL_TEMPLATES.length,
    published: ALL_TEMPLATES.filter((t) => t.status === "已发布").length,
    draft: ALL_TEMPLATES.filter((t) => t.status === "草稿" || t.status === "试跑").length,
    archived: ALL_TEMPLATES.filter((t) => t.status === "已归档").length,
  };

  return (
    <div className="flex h-full flex-col" data-testid="tpladmin-root">
      {/* 标题区 */}
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-card px-4 py-3">
        <div className="flex flex-col gap-0.5">
          <h1 className="text-14 font-semibold tracking-tight">画布模板库</h1>
          <p className="text-11 text-muted-foreground">
            {counts.total} 个 · {counts.published} 已发布 · {counts.draft} 草稿/试跑 · {counts.archived} 已归档
          </p>
        </div>
        {!readOnly && (
          <Button size="sm" variant="primary" data-testid="tpladmin-new" onClick={() => setToast("新建：和 AI 聊出分区结构（原型待补 · 对话面板未渲染）")}>
            <Plus aria-hidden className="h-3.5 w-3.5" /> 新建画布模板
          </Button>
        )}
      </header>

      {toast && (
        <p className="border-b border-border bg-muted px-4 py-1.5 text-11 text-muted-foreground" data-testid="tpladmin-toast">
          {toast}
        </p>
      )}

      {/* 筛选 + 视图切换 */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border-subtle bg-panel px-4 py-2">
        <div className="flex items-center gap-1" role="tablist" aria-label="按状态筛选">
          {FILTERS.map((f) => (
            <Button key={f} size="xs" variant={filter === f ? "primary" : "ghost"} role="tab" aria-selected={filter === f} onClick={() => setFilter(f)} data-testid={`tpladmin-filter-${f}`}>
              {f}
            </Button>
          ))}
        </div>
        <div className="flex items-center gap-0.5">
          <Button size="icon" variant={view === "list" ? "secondary" : "ghost"} aria-label="列表视图" onClick={() => setView("list")} data-testid="tpladmin-view-list">
            <List aria-hidden className="h-3.5 w-3.5" />
          </Button>
          <Button size="icon" variant={view === "card" ? "secondary" : "ghost"} aria-label="卡片视图" onClick={() => setView("card")} data-testid="tpladmin-view-card">
            <LayoutGrid aria-hidden className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-4">
        <StateShell
          state={state}
          skeletonRows={6}
          emptyHint="模板库为空——从「＋ 新建画布模板」和 AI 聊出第一张分区结构，或复制现成模板改。"
          errors={{ publish: "未指定试跑项目，无法进入「试跑」态（请先选一个项目）" }}
          depFailure={{ what: "模板注册表服务不可用，已显示最近一次成功加载的清单；发布/归档暂不可用", retry: () => location.reload() }}
          denial={{ layer: "organization", reason: "后台模板库仅组织管理员可管理，你的角色只能在画布里使用已发布模板" }}
          successMessage="已发布 persona v4，旧版 v3 自动归档；已建实例仍记着各自的版本，未被改动"
        >
          <div className="flex flex-col gap-4">
            {/* 三段发布流程说明（把「无阻断」这条产品判断显式画出来）*/}
            <p className="flex items-start gap-1.5 rounded-md border border-border-subtle bg-muted px-3 py-2 text-11 text-muted-foreground" data-testid="tpladmin-flow-note">
              <Info aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              {PUBLISH_FLOW_NOTE}
            </p>

            {view === "list" ? (
              <div className="overflow-hidden rounded-lg border border-border" data-testid="tpladmin-table">
                <table className="w-full text-left text-12">
                  <thead className="bg-panel text-11 text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 font-medium">模板</th>
                      <th className="px-3 py-2 font-medium">状态</th>
                      <th className="hidden px-3 py-2 font-medium lg:table-cell">结构摘要</th>
                      <th className="px-3 py-2 font-medium">key vN</th>
                      <th className="hidden px-3 py-2 font-medium md:table-cell">类型 · 可见性</th>
                      <th className="px-3 py-2 font-medium">被 N 场</th>
                      <th className="px-3 py-2 font-medium">操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((t, i) => (
                      <tr key={`${t.key}-${t.version}-${i}`} className="border-t border-border-subtle transition-colors duration-200 hover:bg-muted" data-testid={`tpladmin-row-${t.key}-${t.version}`}>
                        <td className="px-3 py-2">
                          <div className="flex flex-col">
                            <span className="font-medium">{t.cnName}</span>
                            {t.builtin && <span className="text-9 text-muted-foreground">内置 · 不可删</span>}
                          </div>
                        </td>
                        <td className="px-3 py-2"><Badge tone={STATUS_TONE[t.status]}>{t.status}</Badge></td>
                        <td className="hidden px-3 py-2 text-11 text-muted-foreground lg:table-cell">{t.structure}</td>
                        <td className="px-3 py-2">
                          <span className="font-mono text-11">{t.key} {t.version}</span>
                          {t.displayName !== t.key && (
                            <span className="ml-1 text-9 text-muted-foreground" title="展示名与程序 key 不同（O-09）">显示: {t.displayName}</span>
                          )}
                        </td>
                        <td className="hidden px-3 py-2 text-11 text-muted-foreground md:table-cell">{t.kind} · {t.visibility}</td>
                        <td className="px-3 py-2 text-11 tabular-nums">{t.usedBy}</td>
                        <td className="px-3 py-2">
                          <RowActions row={t} readOnly={readOnly} onArchive={() => setArchiving(t)} onToast={setToast} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3" data-testid="tpladmin-cards">
                {rows.map((t, i) => (
                  <div key={`${t.key}-${t.version}-${i}`} className="flex flex-col gap-2 rounded-lg border border-border bg-card p-3 shadow-sm transition-shadow duration-200 hover:shadow-md" data-testid={`tpladmin-card-${t.key}-${t.version}`}>
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-13 font-medium">{t.cnName}</span>
                      <Badge tone={STATUS_TONE[t.status]}>{t.status}</Badge>
                    </div>
                    <span className="text-11 text-muted-foreground">{t.structure}</span>
                    <span className="font-mono text-10 text-muted-foreground">{t.key} {t.version} · {t.kind} · 被 {t.usedBy} 场</span>
                    <RowActions row={t} readOnly={readOnly} onArchive={() => setArchiving(t)} onToast={setToast} />
                  </div>
                ))}
              </div>
            )}

            {/* mermaid 白名单 12 类 · 4 组 × 3 */}
            <WhitelistPanel readOnly={readOnly} />
          </div>
        </StateShell>
      </div>

      {archiving && <ArchiveDialog row={archiving} onClose={() => setArchiving(null)} onConfirm={() => { setToast(`已归档 ${archiving.cnName}——从绑定选择器消失，但已绑定环节现场仍能实例化（O-10）`); setArchiving(null); }} />}
    </div>
  );
}

/** 发布状态机的行操作：不同状态给不同动作，危险动作（归档）与主操作分离 */
function RowActions({ row, readOnly, onArchive, onToast }: { row: CanvasTemplateRow; readOnly: boolean; onArchive: () => void; onToast: (s: string) => void }) {
  if (readOnly) return <span className="text-10 text-muted-foreground">只读</span>;
  return (
    <div className="flex flex-wrap items-center gap-1">
      {row.status === "草稿" && (
        <>
          <Button size="xs" variant="primary" data-testid={`tpladmin-publish-${row.key}`} onClick={() => onToast("发布：草稿行 [发布][试跑] 并列，无阻断（未试跑不得发布属原型确认缺失）")}>
            <Rocket aria-hidden className="h-3 w-3" /> 发布
          </Button>
          <Button size="xs" variant="outline" data-testid={`tpladmin-trial-${row.key}`} onClick={() => onToast("试跑：需选定唯一一个项目（选择器原型待补）")}>
            <FlaskConical aria-hidden className="h-3 w-3" /> 试跑
          </Button>
        </>
      )}
      {row.status === "试跑" && (
        <Button size="xs" variant="primary" data-testid={`tpladmin-publish-${row.key}`} onClick={() => onToast("发布 → 全员可绑定；发布新版本时旧版自动归档")}>
          <Rocket aria-hidden className="h-3 w-3" /> 发布
        </Button>
      )}
      {row.status === "已发布" && (
        <>
          <Button size="xs" variant="ghost" data-testid={`tpladmin-edit-${row.key}`} onClick={() => onToast("编辑：打开 TemplateSpec 检查器（原型待补）")}>
            <Pencil aria-hidden className="h-3 w-3" /> 编辑
          </Button>
          <Button size="xs" variant="ghost" className="text-destructive" data-testid={`tpladmin-archive-${row.key}`} onClick={onArchive}>
            <Archive aria-hidden className="h-3 w-3" /> 归档
          </Button>
        </>
      )}
      {row.status === "已归档" && (
        <Button size="xs" variant="outline" data-testid={`tpladmin-restore-${row.key}`} onClick={() => onToast(`已恢复 ${row.cnName}——重新出现在绑定选择器中`)}>
          <RotateCcw aria-hidden className="h-3 w-3" /> 恢复
        </Button>
      )}
    </div>
  );
}

/** 归档二次确认 + 影响面（O-10 ③：有 N 个议程环节仍绑定此模板）*/
function ArchiveDialog({ row, onClose, onConfirm }: { row: CanvasTemplateRow; onClose: () => void; onConfirm: () => void }) {
  const bound = row.boundSegments ?? 0;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/60 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="archive-title" data-testid="tpladmin-archive-dialog">
      <div className="flex w-full max-w-md flex-col gap-3 rounded-lg border border-border bg-card p-5 shadow-lg">
        <div className="flex items-start gap-2">
          <AlertTriangle aria-hidden className="mt-0.5 h-5 w-5 shrink-0 text-warning" />
          <div className="flex flex-col gap-1">
            <h2 id="archive-title" className="text-14 font-semibold">归档「{row.cnName}」？</h2>
            <p className="text-12 text-muted-foreground">
              归档后它<strong className="text-background-foreground">从绑定选择器消失、不能再新增绑定</strong>；
              但<strong className="text-background-foreground">已建实例不被改动</strong>，
              已绑定该模板的议程环节现场触发时仍能成功实例化（固化归档时版本，O-10）。
            </p>
          </div>
        </div>
        <div className="rounded-md border border-warning/40 bg-warning/5 p-2.5" data-testid="tpladmin-archive-impact">
          <p className="text-12 font-medium">影响范围</p>
          <p className="text-11 text-muted-foreground">
            有 <strong className="text-background-foreground tabular-nums">{bound}</strong> 个议程环节仍绑定此模板 · 被 {row.usedBy} 场使用
          </p>
        </div>
        <div className="flex items-center justify-end gap-2">
          <Button size="sm" variant="ghost" onClick={onClose} data-testid="tpladmin-archive-cancel">取消</Button>
          <Button size="sm" variant="destructive" onClick={onConfirm} data-testid="tpladmin-archive-confirm">确认归档</Button>
        </div>
      </div>
    </div>
  );
}

/** mermaid 白名单开关区（[原型] 12 类分 4 组、每组 3 个；只关渲染不关书写）*/
function WhitelistPanel({ readOnly }: { readOnly: boolean }) {
  const [groups, setGroups] = React.useState(MERMAID_WHITELIST);
  const toggle = (gi: number, ki: number) => {
    if (readOnly) return;
    setGroups((prev) => prev.map((g, i) => (i === gi ? g.map((t, j) => (j === ki ? { ...t, on: !t.on } : t)) : g)));
  };
  const offCount = groups.flat().filter((t) => !t.on).length;

  return (
    <section className="flex flex-col gap-2" data-testid="tpladmin-whitelist">
      <div className="flex items-center justify-between">
        <h2 className="text-13 font-semibold">mermaid 图表类型白名单</h2>
        {offCount > 0 && <Badge tone="warning" data-testid="tpladmin-ignored-count">有 {IGNORED_SYNTAX_COUNT} 条语法被忽略</Badge>}
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {groups.map((g, gi) => (
          <div key={gi} className="flex flex-col gap-1.5 rounded-md border border-border bg-card p-2.5">
            {g.map((t, ki) => (
              <button
                key={t.key}
                type="button"
                disabled={readOnly}
                onClick={() => toggle(gi, ki)}
                aria-pressed={t.on}
                data-testid={`tpladmin-whitelist-${t.key}`}
                className={cn(
                  "flex items-center justify-between rounded-md border px-2 py-1.5 font-mono text-11 transition-colors duration-200",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
                  "disabled:bg-disabled disabled:text-disabled-foreground",
                  t.on ? "border-primary/40 bg-accent text-accent-foreground" : "border-border-subtle bg-muted text-muted-foreground",
                )}
              >
                {t.label}
                <span className="text-9">{t.on ? "开" : "关"}</span>
              </button>
            ))}
          </div>
        ))}
      </div>
      <p className="text-10 text-muted-foreground">
        关掉的类型顾问仍可在文档里写，只是不会渲染成画布对象——画布顶部会提示「有 N 条语法被忽略」，源码原样保留。
      </p>
    </section>
  );
}
