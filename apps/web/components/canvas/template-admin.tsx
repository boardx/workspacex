"use client";
import * as React from "react";
import {
  LayoutGrid, List, Archive, RotateCcw, Rocket, Pencil, AlertTriangle, RefreshCw, Plus, X,
} from "lucide-react";
import { useSession } from "@/components/session/session-provider";
import type { ProjectRole } from "@/lib/identity";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api-client";
import {
  archiveCanvasTemplate,
  createCanvasTemplate,
  listCanvasTemplates,
  publishCanvasTemplate,
  restoreCanvasTemplate,
  TEMPLATE_FILTERS,
  TEMPLATE_STATUS_LABEL,
  TEMPLATE_VISIBILITY_LABEL,
  TEMPLATE_VISIBILITY_OPTIONS,
  type CanvasTemplate,
  type ListTemplatesFilter,
  type TemplateSection,
  type TemplateStatus,
  type TemplateVisibility,
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
 * · **mermaid 白名单开关** 同上，缺口已报。
 * · **试跑按钮**：`trialTemplate` 要一个 `projectId`，这一屏没有真实来源
 *   （项目选择器属 F102，后端也没有该路由）。接一半会得到一个「点了报 400」的按钮。
 *
 * ## 🟡 #496 补回来的两个入口
 *
 * · **「新建模板」**：#464 时这里逐字写着「契约里没有任何创建操作，留一个只弹 toast 的
 *   按钮就是在假装闭环成立」。#496 把 `createTemplate` 作为 design-delta 加进契约
 *   （**待人类补签**，见 `lib/live-canvas.ts` 与契约的文件头），于是这个按钮打的是真实端点。
 *   ⚠ 建出来的是**草稿**，界面上必须显示成草稿——把「建完」画成「能用了」，
 *     就是在前端把已签核的三段发布流程抹掉一段。
 * · **「发布」**：`publishTemplate.in` 要的 `visibility` 现在有真实来源了——
 *   **就是那一行自己的 `visibility`**（`listTemplates.out` 里逐字有这一栏）。
 *   #464 说它「没有真实来源」，那时属实：屏上一行草稿都不可能存在，因为没人建得出来。
 *   ⚠ 仍然**不做**「新建即发布」的复合按钮：服务端是两步，界面就是两步。
 *
 * ## 仍然没有「编辑」
 *
 * 契约里没有 update，也没有「开新版」，所以 `createTemplate.out.version` 是 `z.literal(1)`。
 * 分区结构只能在**新建时**定，之后改不了。这是缺口（C_CANVAS_8 ②）的后果，如实写在界面上，
 * 不用一个「保存」按钮假装它能改。
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
  const [creating, setCreating] = React.useState(false);
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
    setCreating(false);
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

  /**
   * 🟡 #496。建完**不**自动发布，也不自动跳到别的屏——只重新读一次列表，
   * 让那一行以「草稿」的样子出现在它真实的位置上。
   *
   * ⚠ 成功之后必须 `await load()` 而不是把新行插进本地 state：插进去的那一行
   *   看起来与真的一模一样，而「它到底进没进库」正是这条闭环唯一要证明的事。
   */
  async function create(draft: NewTemplateDraft) {
    setActionError(null);
    setNotice(null);
    const out = await createCanvasTemplate({
      key: draft.key.trim(),
      displayName: draft.displayName.trim(),
      underlyingType: draft.underlyingType.trim(),
      sections: draft.sections,
      visibility: draft.visibility,
    });
    setCreating(false);
    setNotice(`已新建草稿 ${out.displayName} v${out.version} —— 还需发布才能被环节使用`);
    await load();
  }

  /**
   * 🟡 #496。`visibility` 取**那一行自己的**，不是界面上另挑一个：
   * 让用户在发布时二选一，等于给同一个事实开了第二个入口，而那一栏本来就在行上。
   */
  async function publish(row: CanvasTemplate) {
    setActionError(null);
    setNotice(null);
    try {
      const out = await publishCanvasTemplate({
        key: row.key,
        version: row.version,
        visibility: row.visibility,
      });
      const archived = out.archivedVersions.length;
      setNotice(
        `已发布 ${row.displayName} v${row.version}` +
        (archived > 0 ? ` · 同 key 的 ${archived} 个旧版已自动归档` : ""),
      );
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
        <div className="flex items-center gap-2">
          {!readOnly && (
            <Button size="sm" variant="primary" onClick={() => { setCreating(true); setActionError(null); }} data-testid="tpladmin-create">
              <Plus aria-hidden className="h-3.5 w-3.5" /> 新建模板
            </Button>
          )}
          <Button
            size="sm"
            variant="outline"
            onClick={() => void load()}
            disabled={visibleState.status === "loading"}
            data-testid="tpladmin-refresh"
          >
            <RefreshCw aria-hidden className="h-3.5 w-3.5" /> 刷新
          </Button>
        </div>
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
              这是本组织在服务端的真实结果 —— 这里不会出现任何示例模板。
              用右上角的「新建模板」建一个草稿，再发布它。
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
                        <RowActions row={t} readOnly={readOnly} onArchive={() => void openArchive(t)} onRestore={() => void restore(t)} onPublish={() => void publish(t)} />
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
                  <RowActions row={t} readOnly={readOnly} onArchive={() => void openArchive(t)} onRestore={() => void restore(t)} onPublish={() => void publish(t)} />
                </div>
              ))}
            </div>
          )
        )}
      </div>

      {creating && (
        <CreateDialog onClose={() => setCreating(false)} onSubmit={create} />
      )}

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
 * 状态机的行操作。**只挂后端真接得上的三个**（发布 / 归档 / 恢复）——试跑仍缺
 * `projectId` 的真实来源，见文件头。
 */
function RowActions({
  row, readOnly, onArchive, onRestore, onPublish,
}: {
  row: CanvasTemplate;
  readOnly: boolean;
  onArchive: () => void;
  onRestore: () => void;
  onPublish: () => void;
}) {
  if (readOnly) return <span className="text-10 text-muted-foreground">只读</span>;
  return (
    <div className="flex flex-wrap items-center gap-1">
      {(row.status === "draft" || row.status === "trial") && (
        // 🟡 #496：`visibility` 取这一行自己的那一栏，不在这里让用户再挑一次。
        <Button size="xs" variant="primary" data-testid={`tpladmin-publish-${row.key}-${row.version}`} onClick={onPublish}>
          <Rocket aria-hidden className="h-3 w-3" /> 发布（{TEMPLATE_VISIBILITY_LABEL[row.visibility]}）
        </Button>
      )}
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
      {row.status === "draft" && (
        <span className="flex items-center gap-1 text-10 text-muted-foreground" data-testid={`tpladmin-notrial-${row.key}-${row.version}`}>
          试跑入口待补（缺试跑项目的真实来源）
        </span>
      )}
      <span className="flex items-center gap-1 text-10 text-muted-foreground">
        <Pencil aria-hidden className="h-3 w-3" /> 编辑入口待补（契约无更新操作，分区只能在新建时定）
      </span>
    </div>
  );
}

/** 新建表单的本地草稿。契约 `createTemplate.in` 的五栏，一一对应。 */
interface NewTemplateDraft {
  readonly key: string;
  readonly displayName: string;
  readonly underlyingType: string;
  readonly visibility: TemplateVisibility;
  /** 契约 `createTemplate.in.sections` 是可变数组，端到端保持同一个类型，不在这里收紧。 */
  readonly sections: TemplateSection[];
}

/**
 * 🟡 #496 新建模板对话框。
 *
 * ## 分区**只能在这里定**
 *
 * 契约里没有 update，也没有「开新版」（C_CANVAS_8 ②），所以一个模板的分区结构此后改不了。
 * 这句话直接写在表单上，而不是等用户建完去找那个不存在的编辑按钮。
 *
 * ## 失败原样回显
 *
 * key 被占用是 409 + `TEMPLATE_KEY_CONFLICT`，界面把它显示成「这个 key 已被占用」——
 * 一件用户改一下就能解决的事，不是「保存失败」。⚠ 不在前端预先查一遍 key 是否可用：
 * 那是第二份判据，且它与真实写入之间永远有一个窗口。
 */
function CreateDialog({
  onClose, onSubmit,
}: { onClose: () => void; onSubmit: (draft: NewTemplateDraft) => Promise<void> }) {
  const [key, setKey] = React.useState("");
  const [displayName, setDisplayName] = React.useState("");
  const [underlyingType, setUnderlyingType] = React.useState("canvas");
  const [visibility, setVisibility] = React.useState<TemplateVisibility>("org-wide");
  const [sectionNames, setSectionNames] = React.useState<readonly string[]>([""]);
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // 提交所需的最小集，与契约的 `.min(1)` 对齐 —— 但**不**在这里重述一份校验规则：
  // 真正的裁决在服务端，这里只是不让一个必然 400 的请求白跑一趟。
  const canSubmit = key.trim().length > 0 && displayName.trim().length > 0
    && underlyingType.trim().length > 0 && !submitting;

  async function submit() {
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit({
        key,
        displayName,
        underlyingType,
        visibility,
        // 空名字的分区不提交：它不是一个分区，是一行没填的输入框。
        sections: sectionNames
          .map((name, i) => ({ name: name.trim(), order: i }))
          .filter((s) => s.name.length > 0)
          .map((s, i) => ({
            sectionId: `s${i + 1}`,
            name: s.name,
            order: i,
            required: false,
            // 契约的 `capacity` 可空，且「留白规则对 null 容量断言不出来」是已登记的
            // 待定项（D-a）。这里如实传 null，而不是替它挑一个上限。
            capacity: null,
          })),
      });
    } catch (e) {
      setError(describeCreateError(e));
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/60 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="create-title"
      data-testid="tpladmin-create-dialog"
    >
      <div className="flex w-full max-w-lg flex-col gap-3 rounded-lg border border-border bg-card p-5 shadow-lg">
        <div className="flex items-start justify-between gap-2">
          <h2 id="create-title" className="text-14 font-semibold">新建画布模板</h2>
          <Button size="icon" variant="ghost" aria-label="关闭" onClick={onClose} data-testid="tpladmin-create-close">
            <X aria-hidden className="h-3.5 w-3.5" />
          </Button>
        </div>

        <p className="rounded-md border border-warning/40 bg-warning/5 px-2.5 py-1.5 text-11 text-muted-foreground" data-testid="tpladmin-create-draft-note">
          建出来的是 <strong className="text-background-foreground">草稿</strong>，要被议程环节使用还得再点一次「发布」。
          分区结构<strong className="text-background-foreground">只能在这里定</strong> —— 契约里还没有修改模板的操作。
        </p>

        <label className="flex flex-col gap-1 text-11">
          <span className="text-muted-foreground">模板 key（组织内唯一，之后不可改）</span>
          <input
            className="rounded-md border border-border bg-background px-2 py-1.5 font-mono text-12"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            data-testid="tpladmin-create-key"
          />
        </label>

        <label className="flex flex-col gap-1 text-11">
          <span className="text-muted-foreground">显示名</span>
          <input
            className="rounded-md border border-border bg-background px-2 py-1.5 text-12"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            data-testid="tpladmin-create-name"
          />
        </label>

        <label className="flex flex-col gap-1 text-11">
          <span className="text-muted-foreground">底层类型（契约未约束取值，如实开放）</span>
          <input
            className="rounded-md border border-border bg-background px-2 py-1.5 font-mono text-12"
            value={underlyingType}
            onChange={(e) => setUnderlyingType(e.target.value)}
            data-testid="tpladmin-create-underlying-type"
          />
        </label>

        <label className="flex flex-col gap-1 text-11">
          <span className="text-muted-foreground">可见范围</span>
          <select
            className="rounded-md border border-border bg-background px-2 py-1.5 text-12"
            value={visibility}
            onChange={(e) => setVisibility(e.target.value as TemplateVisibility)}
            data-testid="tpladmin-create-visibility"
          >
            {TEMPLATE_VISIBILITY_OPTIONS.map((v) => (
              <option key={v} value={v}>{TEMPLATE_VISIBILITY_LABEL[v]}</option>
            ))}
          </select>
          {visibility === "team-only" && (
            // C_CANVAS_8 ①：契约没有 `ownerTeamId`，服务端取创建者自己的团队。
            // 后果如实说，不在这里挑一个团队替用户决定。
            <span className="text-10 text-warning" data-testid="tpladmin-create-teamonly-note">
              归属团队取你自己的团队（契约里没有这一栏）。你若不属于任何团队，这个模板将对所有人不可见。
            </span>
          )}
        </label>

        <div className="flex flex-col gap-1" data-testid="tpladmin-create-sections">
          <span className="text-11 text-muted-foreground">分区（导出为 ## 段落；留空即零分区）</span>
          {sectionNames.map((name, i) => (
            <input
              key={i}
              className="rounded-md border border-border bg-background px-2 py-1.5 text-12"
              placeholder={`分区 ${i + 1}`}
              value={name}
              onChange={(e) => setSectionNames(sectionNames.map((n, j) => (j === i ? e.target.value : n)))}
              data-testid={`tpladmin-create-section-${i}`}
            />
          ))}
          <Button
            size="xs"
            variant="outline"
            className="self-start"
            onClick={() => setSectionNames([...sectionNames, ""])}
            data-testid="tpladmin-create-add-section"
          >
            <Plus aria-hidden className="h-3 w-3" /> 加一个分区
          </Button>
        </div>

        {error && (
          <p className="rounded-md border border-destructive/40 bg-destructive/5 px-2.5 py-1.5 text-11 text-destructive" role="alert" data-testid="tpladmin-create-error">
            {error}
          </p>
        )}

        <div className="flex items-center justify-end gap-2">
          <Button size="sm" variant="ghost" onClick={onClose} data-testid="tpladmin-create-cancel">取消</Button>
          <Button size="sm" variant="primary" disabled={!canSubmit} onClick={() => void submit()} data-testid="tpladmin-create-submit">
            {submitting ? "正在新建…" : "新建草稿"}
          </Button>
        </div>
      </div>
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

/**
 * 新建失败的两种意思差别很大，所以只把**契约里 `createTemplate.err` 有的那个码**
 * 翻成一句人话，其余仍旧原样回显。
 *
 * ⚠ 这里**只认** `TEMPLATE_KEY_CONFLICT`：给别的码也各编一句友好文案，等于在前端造了一份
 *   错误语义的副本，而它与契约之间没有任何东西会红。回显 `reasonCode` 至少永远是真的。
 */
function describeCreateError(error: unknown): string {
  if (error instanceof ApiError && error.reasonCode === "TEMPLATE_KEY_CONFLICT") {
    return "这个 key 在本组织已被占用，换一个（服务端 TEMPLATE_KEY_CONFLICT · HTTP 409）";
  }
  return describeError(error);
}

/** 后端真实信封原样回显：`reasonCode` + HTTP 状态，不糊成一句「加载失败」。 */
function describeError(error: unknown): string {
  if (error instanceof ApiError) return `${error.reasonCode ?? "无 reasonCode"}（HTTP ${error.status}）`;
  if (error instanceof Error) return error.message;
  return "未知错误";
}
