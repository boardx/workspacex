"use client";
import * as React from "react";
import {
  LayoutGrid, List, Archive, RotateCcw, Rocket, Pencil, AlertTriangle, RefreshCw,
} from "lucide-react";
import { useSession } from "@/components/session/session-provider";
import type { ProjectRole } from "@/lib/identity";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api-client";
import {
  archiveCanvasTemplate,
  listCanvasTemplates,
  restoreCanvasTemplate,
  TEMPLATE_FILTERS,
  TEMPLATE_STATUS_LABEL,
  TEMPLATE_VISIBILITY_LABEL,
  type CanvasTemplate,
  type ListTemplatesFilter,
  type TemplateStatus,
} from "@/lib/live-canvas";

/**
 * UC-7.1 画布模板库（`/canvas?screen=template-admin`）。
 *
 * #464 起这一屏只投影 `GET /canvas/templates` 的真实响应：browser → controller →
 * `application/canvas/list-templates` → `PgCanvasTemplateRepository` → PostgreSQL。
 *
 * ## 这一屏**去掉**了什么，以及为什么不是「功能倒退」
 *
 * · **七态预览壳（StateShell）**：加载中 / 空 / 失败三态现在由真实请求决定。
 *   一个能用 `?state=` 切出来的「失败态」和真实失败并存，会让人分不清屏上这句
 *   报错是后端说的还是 URL 说的。
 * · **mermaid 白名单开关**：契约有 `setMermaidWhitelist`，但 #463 的 controller
 *   没有挂这条路由。一块点了不落库的开关比没有它更糟——它看起来生效了。缺口已报。
 * · **「新建画布模板」按钮**：签核过的契约里**没有任何创建操作**
 *   （`publishTemplate.in` 是 `{key,version,visibility}`，读一行已存在的，不造一行）。
 *   留一个只弹 toast 的按钮，就是在假装闭环成立。缺口已报，见 `lib/live-canvas.ts` 文件头。
 * · **发布 / 试跑按钮**：`publish` 要 `visibility`、`trial` 要一个 `projectId`，
 *   这一屏两者都没有真实来源（项目选择器属 F102，后端也没有该路由）。
 *   接一半会得到一个「点了报 400」的按钮。归档 / 恢复不需要额外输入，因此真接。
 *
 * ⚠ `previewRole === "observer"` 时不挂写入口，那是**降噪不是权限**：
 *   真正的拒绝在服务端（`ROLE_INSUFFICIENT` → 403），失败信封原样回显。
 */

const STATUS_TONE: Record<TemplateStatus, "primary" | "neutral" | "warning" | "outline"> = {
  published: "primary",
  draft: "warning",
  trial: "outline",
  archived: "neutral",
};

const FILTER_LABEL: Record<ListTemplatesFilter, string> = {
  all: "全部",
  published: "已发布",
  draft: "草稿",
  archived: "已归档",
};

type LoadState =
  | { readonly sourceKey: string; readonly status: "loading" }
  | { readonly sourceKey: string; readonly status: "error"; readonly message: string }
  | { readonly sourceKey: string; readonly status: "ready"; readonly rows: readonly CanvasTemplate[] };

/** 归档确认框的内容**全部**来自 `confirmed:false` 的真实预检，没有前端缺省值。 */
interface ArchivePreflight {
  readonly row: CanvasTemplate;
  readonly stillBoundSegmentCount: number;
}

export function TemplateAdmin({ previewRole }: { previewRole: ProjectRole | null }) {
  const { session } = useSession();
  if (!session) throw new Error("TemplateAdmin requires an authenticated session");
  const orgId = session.currentOrgId;

  const [filter, setFilter] = React.useState<ListTemplatesFilter>("all");
  const [view, setView] = React.useState<"list" | "card">("list");
  const sourceKey = `${orgId}:${filter}`;
  const generation = React.useRef(0);
  const currentSourceKey = React.useRef(sourceKey);
  currentSourceKey.current = sourceKey;

  const [state, setState] = React.useState<LoadState>({ sourceKey, status: "loading" });
  const [archiving, setArchiving] = React.useState<ArchivePreflight | null>(null);
  const [actionError, setActionError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    if (currentSourceKey.current !== sourceKey) return;
    const request = ++generation.current;
    setState({ sourceKey, status: "loading" });
    try {
      const out = await listCanvasTemplates({ orgId, filter });
      if (request !== generation.current || currentSourceKey.current !== sourceKey) return;
      setState({ sourceKey, status: "ready", rows: out.templates });
    } catch (error) {
      if (request !== generation.current || currentSourceKey.current !== sourceKey) return;
      // 失败**不得**退化成空列表：那会把「读不到」画成「一个模板都没有」。
      setState({ sourceKey, status: "error", message: describeError(error) });
    }
  }, [filter, orgId, sourceKey]);

  React.useEffect(() => {
    setArchiving(null);
    setActionError(null);
    setNotice(null);
    void load();
    return () => {
      generation.current += 1;
    };
  }, [load]);

  // 换组织/换筛选时，渲染期就失效上一批行：effect 在 paint 之后跑，
  // 只靠它会让新条件下短暂显示旧条件的结果。
  const visibleState: LoadState = state.sourceKey === sourceKey ? state : { sourceKey, status: "loading" };
  const rows = visibleState.status === "ready" ? visibleState.rows : [];
  const readOnly = previewRole === "observer";

  async function openArchive(row: CanvasTemplate) {
    setActionError(null);
    setNotice(null);
    try {
      const out = await archiveCanvasTemplate({ key: row.key, version: row.version, confirmed: false });
      setArchiving({ row, stillBoundSegmentCount: out.stillBoundSegmentCount });
    } catch (error) {
      // 预检失败就**不开**确认框：一个数字来路不明的确认框比没有确认框更危险。
      setArchiving(null);
      setActionError(describeError(error));
    }
  }

  async function confirmArchive(preflight: ArchivePreflight) {
    setActionError(null);
    try {
      await archiveCanvasTemplate({ key: preflight.row.key, version: preflight.row.version, confirmed: true });
      setArchiving(null);
      setNotice(`已归档 ${preflight.row.displayName} v${preflight.row.version}`);
      await load();
    } catch (error) {
      setActionError(describeError(error));
    }
  }

  async function restore(row: CanvasTemplate) {
    setActionError(null);
    setNotice(null);
    try {
      const out = await restoreCanvasTemplate({ key: row.key, version: row.version });
      setNotice(`已恢复 ${row.displayName} v${row.version} → ${TEMPLATE_STATUS_LABEL[out.status]}`);
      await load();
    } catch (error) {
      setActionError(describeError(error));
    }
  }

  return (
    <div className="flex h-full flex-col" data-testid="tpladmin-root">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-card px-4 py-3">
        <div className="flex flex-col gap-0.5">
          <h1 className="text-14 font-semibold tracking-tight">画布模板库</h1>
          <p className="text-11 text-muted-foreground">
            组织 {orgId}
            {visibleState.status === "ready" && ` · 当前筛选下 ${rows.length} 个`}
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={() => void load()}
          disabled={visibleState.status === "loading"}
          data-testid="tpladmin-refresh"
        >
          <RefreshCw aria-hidden className="h-3.5 w-3.5" /> 刷新
        </Button>
      </header>

      {notice && (
        <p className="border-b border-border bg-muted px-4 py-1.5 text-11 text-muted-foreground" data-testid="tpladmin-notice">
          {notice}
        </p>
      )}
      {actionError && (
        <p
          className="border-b border-destructive/40 bg-destructive/5 px-4 py-1.5 text-11 text-destructive"
          data-testid="tpladmin-action-error"
          role="alert"
        >
          操作被服务端拒绝：{actionError}
        </p>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border-subtle bg-panel px-4 py-2">
        <div className="flex items-center gap-1" role="tablist" aria-label="按状态筛选">
          {TEMPLATE_FILTERS.map((f) => (
            <Button
              key={f}
              size="xs"
              variant={filter === f ? "primary" : "ghost"}
              role="tab"
              aria-selected={filter === f}
              onClick={() => setFilter(f)}
              data-testid={`tpladmin-filter-${f}`}
            >
              {FILTER_LABEL[f]}
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
        {visibleState.status === "loading" && (
          <p className="text-12 text-muted-foreground" data-testid="tpladmin-loading">正在读取模板注册表…</p>
        )}

        {visibleState.status === "error" && (
          <div
            className="flex flex-col items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-4"
            data-testid="tpladmin-error"
            role="alert"
          >
            <p className="text-13 font-medium text-destructive">读取模板注册表失败</p>
            <p className="font-mono text-11 text-destructive">{visibleState.message}</p>
            <Button size="xs" variant="outline" onClick={() => void load()} data-testid="tpladmin-retry">重试</Button>
          </div>
        )}

        {visibleState.status === "ready" && rows.length === 0 && (
          <div className="flex flex-col gap-1 rounded-lg border border-dashed border-border p-6" data-testid="tpladmin-empty">
            <p className="text-13 font-medium">当前筛选下没有画布模板</p>
            <p className="text-11 text-muted-foreground">
              这是本组织在服务端的真实结果。模板的创建入口尚未在已签契约里存在（见 issue #464），
              因此这里不会出现任何示例模板。
            </p>
          </div>
        )}

        {visibleState.status === "ready" && rows.length > 0 && (
          view === "list" ? (
            <div className="overflow-hidden rounded-lg border border-border" data-testid="tpladmin-table">
              <table className="w-full text-left text-12">
                <thead className="bg-panel text-11 text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 font-medium">模板</th>
                    <th className="px-3 py-2 font-medium">状态</th>
                    <th className="hidden px-3 py-2 font-medium lg:table-cell">分区</th>
                    <th className="px-3 py-2 font-medium">key vN</th>
                    <th className="hidden px-3 py-2 font-medium md:table-cell">类型 · 可见性</th>
                    <th className="px-3 py-2 font-medium">被 N 场</th>
                    <th className="px-3 py-2 font-medium">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((t) => (
                    <tr
                      key={`${t.key}-${t.version}`}
                      className="border-t border-border-subtle transition-colors duration-200 hover:bg-muted"
                      data-testid={`tpladmin-row-${t.key}-${t.version}`}
                    >
                      <td className="px-3 py-2">
                        <div className="flex flex-col">
                          <span className="font-medium">{t.displayName}</span>
                          {t.builtin && <span className="text-9 text-muted-foreground">内置 · 不可删</span>}
                        </div>
                      </td>
                      <td className="px-3 py-2"><Badge tone={STATUS_TONE[t.status]}>{TEMPLATE_STATUS_LABEL[t.status]}</Badge></td>
                      <td className="hidden px-3 py-2 text-11 text-muted-foreground lg:table-cell">{describeSections(t)}</td>
                      <td className="px-3 py-2"><span className="font-mono text-11">{t.key} v{t.version}</span></td>
                      <td className="hidden px-3 py-2 text-11 text-muted-foreground md:table-cell">
                        {t.underlyingType} · {TEMPLATE_VISIBILITY_LABEL[t.visibility]}
                      </td>
                      <td className="px-3 py-2 text-11 tabular-nums">{t.usageCount}</td>
                      <td className="px-3 py-2">
                        <RowActions row={t} readOnly={readOnly} onArchive={() => void openArchive(t)} onRestore={() => void restore(t)} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3" data-testid="tpladmin-cards">
              {rows.map((t) => (
                <div
                  key={`${t.key}-${t.version}`}
                  className="flex flex-col gap-2 rounded-lg border border-border bg-card p-3 shadow-sm transition-shadow duration-200 hover:shadow-md"
                  data-testid={`tpladmin-card-${t.key}-${t.version}`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-13 font-medium">{t.displayName}</span>
                    <Badge tone={STATUS_TONE[t.status]}>{TEMPLATE_STATUS_LABEL[t.status]}</Badge>
                  </div>
                  <span className="text-11 text-muted-foreground">{describeSections(t)}</span>
                  <span className="font-mono text-10 text-muted-foreground">
                    {t.key} v{t.version} · {t.underlyingType} · 被 {t.usageCount} 场
                  </span>
                  <RowActions row={t} readOnly={readOnly} onArchive={() => void openArchive(t)} onRestore={() => void restore(t)} />
                </div>
              ))}
            </div>
          )
        )}
      </div>

      {archiving && (
        <ArchiveDialog
          preflight={archiving}
          onClose={() => setArchiving(null)}
          onConfirm={() => void confirmArchive(archiving)}
        />
      )}
    </div>
  );
}

/**
 * 状态机的行操作。**只挂后端真接得上的两个**（归档 / 恢复）——
 * 发布与试跑缺真实输入源，见文件头。
 */
function RowActions({
  row, readOnly, onArchive, onRestore,
}: { row: CanvasTemplate; readOnly: boolean; onArchive: () => void; onRestore: () => void }) {
  if (readOnly) return <span className="text-10 text-muted-foreground">只读</span>;
  return (
    <div className="flex flex-wrap items-center gap-1">
      {row.status === "published" && (
        <Button size="xs" variant="ghost" className="text-destructive" data-testid={`tpladmin-archive-${row.key}-${row.version}`} onClick={onArchive}>
          <Archive aria-hidden className="h-3 w-3" /> 归档
        </Button>
      )}
      {row.status === "archived" && (
        <Button size="xs" variant="outline" data-testid={`tpladmin-restore-${row.key}-${row.version}`} onClick={onRestore}>
          <RotateCcw aria-hidden className="h-3 w-3" /> 恢复
        </Button>
      )}
      {(row.status === "draft" || row.status === "trial") && (
        <span className="flex items-center gap-1 text-10 text-muted-foreground" data-testid={`tpladmin-nopublish-${row.key}-${row.version}`}>
          <Rocket aria-hidden className="h-3 w-3" /> 发布 / 试跑入口待补（缺可见范围与试跑项目的真实来源）
        </span>
      )}
      {row.status === "published" && (
        <span className="flex items-center gap-1 text-10 text-muted-foreground">
          <Pencil aria-hidden className="h-3 w-3" /> 编辑入口待补（契约无更新操作）
        </span>
      )}
    </div>
  );
}

/** 归档二次确认。影响面那个数来自本次预检，**不是**一个前端缺省值（O-10 ③）。 */
function ArchiveDialog({
  preflight, onClose, onConfirm,
}: { preflight: ArchivePreflight; onClose: () => void; onConfirm: () => void }) {
  const { row, stillBoundSegmentCount } = preflight;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/60 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="archive-title"
      data-testid="tpladmin-archive-dialog"
    >
      <div className="flex w-full max-w-md flex-col gap-3 rounded-lg border border-border bg-card p-5 shadow-lg">
        <div className="flex items-start gap-2">
          <AlertTriangle aria-hidden className="mt-0.5 h-5 w-5 shrink-0 text-warning" />
          <div className="flex flex-col gap-1">
            <h2 id="archive-title" className="text-14 font-semibold">归档「{row.displayName} v{row.version}」？</h2>
            <p className="text-12 text-muted-foreground">
              归档后它<strong className="text-background-foreground">从绑定选择器消失、不能再新增绑定</strong>；
              但<strong className="text-background-foreground">已建实例不被改动</strong>，
              已绑定该模板的议程环节现场触发时仍能成功实例化（O-10）。
            </p>
          </div>
        </div>
        <div className="rounded-md border border-warning/40 bg-warning/5 p-2.5" data-testid="tpladmin-archive-impact">
          <p className="text-12 font-medium">影响范围（服务端预检结果）</p>
          <p className="text-11 text-muted-foreground">
            有 <strong className="text-background-foreground tabular-nums">{stillBoundSegmentCount}</strong> 个议程环节仍绑定此模板 · 被 {row.usageCount} 场使用
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

function describeSections(t: CanvasTemplate): string {
  if (t.sections.length === 0) return "无分区";
  return `${t.sections.length} 分区 · ${t.sections.map((s) => s.name).join(" / ")}`;
}

/** 后端真实信封原样回显：`reasonCode` + HTTP 状态，不糊成一句「加载失败」。 */
function describeError(error: unknown): string {
  if (error instanceof ApiError) return `${error.reasonCode ?? "无 reasonCode"}（HTTP ${error.status}）`;
  if (error instanceof Error) return error.message;
  return "未知错误";
}
