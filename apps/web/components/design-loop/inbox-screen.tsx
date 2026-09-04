"use client";
import * as React from "react";
import {
  LayoutList, Columns3, Search, X, Sparkles, Play, Check, Undo2, Ban, ShieldAlert, PlugZap, Loader2, Lock,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { UiState } from "@/lib/ui-state";
import { ApiError } from "@/lib/api-client";
import { useDesignLoop } from "@/lib/design-loop-store";
import {
  getInboxCounts,
  listInbox,
  INBOX_KIND_LABEL,
  INBOX_KIND_OPTIONS,
  INBOX_STAGE_LABEL,
  INBOX_STAGE_ORDER,
  type GetInboxCountsOut,
  type InboxItem,
  type InboxKind,
  type InboxStage,
} from "@/lib/live-inbox";
import {
  triageFeedback,
  listFeedbackStatusEvents,
  type FeedbackStatus,
  type FeedbackStatusEvent,
} from "@/lib/live-feedback";
import { updateSystemErrorLifecycle, type SystemErrorStatus } from "@/lib/live-system-errors";
import { FeedbackStructuredView } from "@/components/feedback/feedback-structured";
import { StatusBadge, GithubBadge, LinkBadge, SevereBadge } from "./badges";

/**
 * UC-17.8 B3.4 —— 运营收件箱，**真栈**（契约 `inbox`：`listInbox` / `getInboxCounts`）。
 *
 * ## 这一屏刻意的几个设计取舍
 *
 *   · **`kind` + `q` 是服务端参数，`stage` 是客户端派生**：看板要四列同时看见，把 `stage`
 *     也发去服务端会把结果收窄成一列，反而没法一次请求撑起整块看板；列表视图切状态子筛选
 *     也因此是纯本地过滤、不重新请求。分页（`cursor`/`nextCursor`）覆盖的是「`kind`+`q` 命中
 *     的全集」，不是某一列——一次「加载更多」四列都可能各多几条。
 *   · **看板拖拽换列 ⇒ 按 `kind` 选真实状态迁移**：反馈走 `triageFeedback`，系统异常走
 *     `updateSystemErrorLifecycle`；系统异常没有「已完成」这条边（契约头注），拖过去
 *     前端直接拒绝、不发请求。拖进「不做」列不直接乐观迁移——不做必须有理由，落点是
 *     drawer 里的理由表单（同「点开详情 → 不做…」一致的入口，不重造第二套「不做」流程）。
 *     其余迁移乐观更新 + 失败回滚。
 *   · **进「已进入迭代」不弹 issue 草稿编辑器**：后台「反馈与迭代」屏那条"转开发建 issue"
 *     的完整编辑流程本轮不搬进收件箱看板——拖拽是"分诊台快速挪列"的心智，issue 文案编辑
 *     是另一个更重的动作；这里传 `issueDraft: null`，服务端按契约用默认文案建 issue。
 *     TODO(B3.5+)：若产品要收件箱也能编辑 issue 草稿，再照 `admin/feedback-screen.tsx`
 *     的 `defaultIssueDraft` 搬一份。
 *   · **drawer 时间线只有反馈类有**：`listFeedbackStatusEvents` 是反馈专属操作；
 *     系统异常源（`live-system-errors.ts`）今天没有等价接口，不发明一个，直接不渲染。
 *   · **GitHub 徽标用列表给的推断值，不现查升级**：契约头注允许 drawer 展开后现查
 *     `getFeedbackGithubIssue` 把徽标升级成 PR，本轮先用 `listInbox` 已经算好的
 *     `item.github` 直接渲染——TODO(B3.5)：接现查升级。
 */

type KindFilter = "all" | InboxKind;
type StageFilter = "all" | InboxStage;

const KIND_FILTERS: readonly KindFilter[] = ["all", ...INBOX_KIND_OPTIONS];
const SEARCH_DEBOUNCE_MS = 300;
const PAGE_LIMIT = 50;

function describeFailure(err: unknown): string {
  if (err instanceof ApiError) return err.reasonCode ?? `http_${err.status}`;
  if (err instanceof TypeError) return "无法连接服务器，请稍后重试";
  return String(err);
}

/** 拖拽落点换算成源状态机的目标状态；`null` = 这条边不存在（前端不发请求）。 */
function feedbackStatusForStage(stage: InboxStage): FeedbackStatus | null {
  switch (stage) {
    case "backlog": return "待处理";
    case "doing": return "已进入迭代";
    case "done": return "已修复";
    case "archived": return "不做";
  }
}
function exceptionStatusForStage(stage: InboxStage): SystemErrorStatus | null {
  switch (stage) {
    case "backlog": return "待处理";
    case "doing": return "已转入开发";
    case "archived": return "不做";
    case "done": return null; // 系统异常没有「已完成」列，见文件头
  }
}

type Load =
  | { kind: "loading" }
  | { kind: "ready"; items: InboxItem[]; nextCursor: string | null; sources: GetInboxCountsOut["sources"] }
  | { kind: "failed"; reason: string };

export function DesignLoopInboxScreen({
  state = "default",
  onDeepen,
  onOpenWorkbench,
  openId: initialOpenId = null,
}: {
  state?: UiState;
  onDeepen?: (projectId: string) => void;
  onOpenWorkbench?: (inboxCode: string) => void;
  /** 进屏就打开这一条的详情（`?open=<id>`）。 */
  openId?: string | null;
}) {
  const store = useDesignLoop();
  const [view, setView] = React.useState<"board" | "list">("board");
  const [kindFilter, setKindFilter] = React.useState<KindFilter>("all");
  const [stageFilter, setStageFilter] = React.useState<StageFilter>("all");
  const [queryInput, setQueryInput] = React.useState("");
  const [query, setQuery] = React.useState("");
  const [load, setLoad] = React.useState<Load>({ kind: "loading" });
  const [loadingMore, setLoadingMore] = React.useState(false);
  const [counts, setCounts] = React.useState<GetInboxCountsOut | null>(null);
  const [openId, setOpenId] = React.useState<string | null>(initialOpenId);
  const [openDeclineOnOpen, setOpenDeclineOnOpen] = React.useState(false);
  const [dragOver, setDragOver] = React.useState<InboxStage | null>(null);
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [saved, setSaved] = React.useState<string | null>(null);
  const [dragError, setDragError] = React.useState<string | null>(null);

  // 搜索防抖：输入停 300ms 才真正触发请求。
  React.useEffect(() => {
    const t = window.setTimeout(() => setQuery(queryInput.trim()), SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(t);
  }, [queryInput]);

  const reload = React.useCallback(async () => {
    setLoad({ kind: "loading" });
    try {
      const out = await listInbox({
        kind: kindFilter === "all" ? undefined : kindFilter,
        q: query === "" ? undefined : query,
        limit: PAGE_LIMIT,
      });
      setLoad({ kind: "ready", items: [...out.items], nextCursor: out.nextCursor, sources: out.sources });
    } catch (err) {
      setLoad({ kind: "failed", reason: describeFailure(err) });
    }
  }, [kindFilter, query]);

  const reloadCounts = React.useCallback(async () => {
    try {
      setCounts(await getInboxCounts());
    } catch {
      /* 列头/Chip 徽标是锦上添花，拉不到就不显示数字，不让整屏因此失败 */
    }
  }, []);

  React.useEffect(() => {
    if (state !== "default") return;
    void reload();
  }, [reload, state]);

  React.useEffect(() => {
    if (state !== "default") return;
    void reloadCounts();
  }, [reloadCounts, state]);

  const loadMore = async () => {
    if (load.kind !== "ready" || load.nextCursor === null || loadingMore) return;
    setLoadingMore(true);
    try {
      const out = await listInbox({
        kind: kindFilter === "all" ? undefined : kindFilter,
        q: query === "" ? undefined : query,
        limit: PAGE_LIMIT,
        cursor: load.nextCursor,
      });
      setLoad((prev) =>
        prev.kind === "ready"
          ? { kind: "ready", items: [...prev.items, ...out.items], nextCursor: out.nextCursor, sources: out.sources }
          : prev,
      );
    } catch (err) {
      setDragError(describeFailure(err));
    } finally {
      setLoadingMore(false);
    }
  };

  const items = load.kind === "ready" ? load.items : [];
  const sources = load.kind === "ready" ? load.sources : null;
  const exceptionWithheld = sources?.exception === "withheld" || counts?.sources.exception === "withheld";

  const filtered = items.filter(
    (i) => stageFilter === "all" || i.stage === stageFilter,
  );
  const open = items.find((i) => i.id === openId) ?? null;

  const flashSaved = (msg: string) => {
    setSaved(msg);
    window.setTimeout(() => setSaved(null), 2400);
  };

  const replaceItem = (id: string, patch: Partial<InboxItem>) =>
    setLoad((prev) => (prev.kind === "ready" ? { ...prev, items: prev.items.map((i) => (i.id === id ? { ...i, ...patch } : i)) } : prev));

  /** 列头数字乐观跟随：拿到 `getInboxCounts` 之后，挪列/不做时本地同步 -1/+1，不用等下一次轮询。 */
  const bumpStageCount = (from: InboxStage, to: InboxStage) =>
    setCounts((prev) =>
      prev === null
        ? prev
        : { ...prev, byStage: { ...prev.byStage, [from]: Math.max(0, prev.byStage[from] - 1), [to]: prev.byStage[to] + 1 } },
    );

  /** 乐观迁移（backlog/doing/done 之间，不含「不做」）：先挪列，失败原样回滚。 */
  const applyTransition = async (item: InboxItem, targetStage: InboxStage) => {
    if (item.kind === "design") return; // 本轮无数据，也没有对应源操作
    const prevStage = item.stage;
    if (item.kind === "exception" && targetStage === "done") {
      setDragError("系统异常没有「已完成」这一列");
      window.setTimeout(() => setDragError(null), 3000);
      return;
    }
    if (targetStage === "archived") {
      // 「不做」必须有理由——不在这里乐观迁移，改开 drawer 的理由表单。
      setOpenId(item.id);
      setOpenDeclineOnOpen(true);
      return;
    }
    const status = item.kind === "feedback" ? feedbackStatusForStage(targetStage) : exceptionStatusForStage(targetStage);
    if (status === null) return;
    replaceItem(item.id, { stage: targetStage });
    bumpStageCount(prevStage, targetStage);
    setBusyId(item.id);
    try {
      if (item.kind === "feedback") {
        await triageFeedback(item.id, status as FeedbackStatus, null, null);
      } else {
        await updateSystemErrorLifecycle(item.id, { status: status as SystemErrorStatus });
      }
      flashSaved(`已移动到「${INBOX_STAGE_LABEL[targetStage]}」`);
    } catch (err) {
      replaceItem(item.id, { stage: prevStage });
      bumpStageCount(targetStage, prevStage);
      setDragError(`没能移动这条（${describeFailure(err)}），已恢复原状态`);
      window.setTimeout(() => setDragError(null), 3000);
    } finally {
      setBusyId(null);
    }
  };

  const archiveWithReason = async (item: InboxItem, reason: string) => {
    const prevStage = item.stage;
    setBusyId(item.id);
    try {
      if (item.kind === "feedback") {
        await triageFeedback(item.id, "不做", reason, null);
      } else if (item.kind === "exception") {
        await updateSystemErrorLifecycle(item.id, { status: "不做", statusReason: reason });
      } else {
        return;
      }
      replaceItem(item.id, { stage: "archived", statusReason: reason });
      bumpStageCount(prevStage, "archived");
      flashSaved("已转为不做，理由已记入时间线");
    } catch (err) {
      setDragError(`没能转为不做（${describeFailure(err)}）`);
      window.setTimeout(() => setDragError(null), 3000);
    } finally {
      setBusyId(null);
    }
  };

  // ── 七态：loading / denied / dep-failed 走保留态面板；empty 数据驱动 ──────────
  if (state === "loading" || (state === "default" && load.kind === "loading")) {
    return (
      <div className="p-6" data-testid="loading">
        <div className="grid grid-cols-4 gap-3">
          {INBOX_STAGE_ORDER.map((s) => (
            <div key={s} className="flex flex-col gap-2 rounded-card bg-panel p-3">
              <div className="h-4 w-16 animate-pulse rounded-control bg-muted" />
              {[0, 1].map((n) => (
                <div key={n} className="h-16 animate-pulse rounded-card bg-muted" />
              ))}
            </div>
          ))}
        </div>
      </div>
    );
  }
  if (state === "denied") {
    return (
      <div className="flex flex-col items-center gap-2 p-16 text-center" data-testid="denied">
        <ShieldAlert aria-hidden className="h-8 w-8 text-muted-foreground" />
        <p className="text-14 font-medium">运营收件箱仅平台运营可见</p>
        <p className="max-w-sm text-12 text-muted-foreground">
          你的账号没有平台运营权限。如果需要处理反馈与排期，联系平台管理员把你加入运营组。
        </p>
      </div>
    );
  }
  if (state === "dep-failed" || (state === "default" && load.kind === "failed")) {
    const reason = state === "default" && load.kind === "failed" ? load.reason : null;
    return (
      <div className="flex flex-col items-center gap-2 p-16 text-center" data-testid="dep-failed">
        <PlugZap aria-hidden className="h-8 w-8 text-muted-foreground" />
        <p className="text-14 font-medium">收件箱数据暂时读不到</p>
        <p className="max-w-sm text-12 text-muted-foreground">
          反馈、系统异常与设计方案的合并数据源这次没取到{reason !== null ? `（${reason}）` : ""}，条目没有丢。稍后重试，或检查后台服务状态。
        </p>
        <Button size="sm" variant="outline" className="mt-1" onClick={() => void reload()} data-testid="inbox-retry">重试</Button>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col" data-testid="design-loop-inbox">
      {saved !== null && (
        <div
          className="mx-4 mt-3 rounded-card bg-success px-3 py-1.5 text-12 text-success-foreground"
          data-testid="saved"
          role="status"
        >
          {saved}
        </div>
      )}
      {dragError !== null && (
        <div className="mx-4 mt-3 rounded-card bg-destructive px-3 py-1.5 text-12 text-destructive-foreground" data-testid="inbox-drag-error" role="alert">
          {dragError}
        </div>
      )}
      {/* 工具条：视图切换 + 类型 chip + 搜索 */}
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
        <div className="flex items-center gap-0.5 rounded-control border border-border p-0.5">
          <ViewToggle active={view === "board"} onClick={() => setView("board")} testid="inbox-view-board" icon={Columns3} label="看板" />
          <ViewToggle active={view === "list"} onClick={() => setView("list")} testid="inbox-view-list" icon={LayoutList} label="列表" />
        </div>
        <div className="flex flex-wrap items-center gap-1" role="group" aria-label="类型筛选">
          {KIND_FILTERS.map((f) => {
            const disabled = f === "exception" && exceptionWithheld === true;
            const count = counts === null ? null : f === "all" ? counts.total : counts.byKind[f];
            return (
              <span key={f} className="relative inline-flex" title={disabled ? "仅平台运维可见" : undefined}>
                <button
                  type="button"
                  aria-pressed={kindFilter === f}
                  disabled={disabled}
                  onClick={() => !disabled && setKindFilter(f)}
                  data-testid={`inbox-kind-${f}`}
                  className={cn(
                    "inline-flex items-center gap-1 rounded-control border px-2.5 py-1 text-12 transition-colors duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    disabled
                      ? "cursor-not-allowed border-border-subtle bg-panel text-muted-foreground/60"
                      : kindFilter === f
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border bg-card text-card-foreground hover:bg-muted",
                  )}
                >
                  {disabled && <Lock aria-hidden className="h-3 w-3" />}
                  {f === "all" ? "全部" : INBOX_KIND_LABEL[f]}
                  {count !== null && <span className="text-10 opacity-70">{count}</span>}
                </button>
              </span>
            );
          })}
          {exceptionWithheld === true && (
            <span className="text-10 text-muted-foreground" data-testid="inbox-exception-withheld-hint">
              系统异常仅平台运维可见
            </span>
          )}
        </div>
        <div className="relative ml-auto">
          <Search aria-hidden className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={queryInput}
            onChange={(e) => setQueryInput(e.target.value)}
            placeholder="搜索标题或编号"
            data-testid="inbox-search"
            className="h-8 w-56 pl-7 text-12"
          />
        </div>
      </div>

      {items.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-1 p-16 text-center" data-testid="empty">
          <p className="text-14 font-medium">收件箱是空的</p>
          <p className="text-12 text-muted-foreground">
            {kindFilter !== "all" || query !== "" ? "没有符合当前筛选的条目。" : "用户提交反馈、系统告警或推送设计方案后，都会汇总到这里。"}
          </p>
        </div>
      ) : view === "board" ? (
        <div className="flex flex-1 flex-col overflow-hidden">
          <div className="grid flex-1 grid-cols-4 gap-3 overflow-y-auto p-4" data-testid="inbox-board">
            {INBOX_STAGE_ORDER.map((col) => {
              const colItems = filtered.filter((i) => i.stage === col);
              const colCount = counts === null ? colItems.length : counts.byStage[col];
              return (
                <div
                  key={col}
                  data-testid={`inbox-column-${col}`}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDragOver(col);
                  }}
                  onDragLeave={() => setDragOver((d) => (d === col ? null : d))}
                  onDrop={(e) => {
                    e.preventDefault();
                    const id = e.dataTransfer.getData("text/plain");
                    setDragOver(null);
                    const item = items.find((i) => i.id === id);
                    if (item) void applyTransition(item, col);
                  }}
                  className={cn(
                    "flex min-h-32 flex-col gap-2 rounded-card border border-transparent bg-panel p-2 transition-colors duration-fast",
                    dragOver === col && "border-primary bg-ai-tint/30",
                  )}
                >
                  <div className="flex items-center justify-between px-1 pt-0.5">
                    <span className="text-11 font-medium text-muted-foreground">{INBOX_STAGE_LABEL[col]}</span>
                    <span className="text-11 text-muted-foreground" data-testid={`inbox-column-count-${col}`}>{colCount}</span>
                  </div>
                  {colItems.map((item) => (
                    <BoardCard key={item.id} item={item} busy={busyId === item.id} onOpen={() => setOpenId(item.id)} />
                  ))}
                </div>
              );
            })}
          </div>
          <LoadMoreBar nextCursor={load.kind === "ready" ? load.nextCursor : null} loading={loadingMore} onLoadMore={() => void loadMore()} />
        </div>
      ) : (
        <ListView
          items={filtered}
          stageFilter={stageFilter}
          onStageFilter={setStageFilter}
          onOpen={setOpenId}
          nextCursor={load.kind === "ready" ? load.nextCursor : null}
          loadingMore={loadingMore}
          onLoadMore={() => void loadMore()}
        />
      )}

      {open !== null && (
        <InboxDrawer
          item={open}
          busy={busyId === open.id}
          openDecline={openDeclineOnOpen}
          onClose={() => { setOpenId(null); setOpenDeclineOnOpen(false); }}
          onStatus={(s) => void applyTransition(open, s)}
          onArchive={(reason) => void archiveWithReason(open, reason)}
          onDeepen={() => {
            const projId = store.deepenFeedback({ code: open.code, title: open.title, body: open.body });
            setOpenId(null);
            onDeepen?.(projId);
          }}
          onOpenWorkbench={() => onOpenWorkbench?.(open.code)}
        />
      )}
    </div>
  );
}

function LoadMoreBar({ nextCursor, loading, onLoadMore }: { nextCursor: string | null; loading: boolean; onLoadMore: () => void }) {
  if (nextCursor === null) return null;
  return (
    <div className="flex justify-center border-t border-border p-3">
      <Button size="sm" variant="outline" disabled={loading} onClick={onLoadMore} data-testid="inbox-load-more">
        {loading && <Loader2 aria-hidden className="h-3.5 w-3.5 animate-spin" />}
        加载更多
      </Button>
    </div>
  );
}

function ViewToggle({ active, onClick, testid, icon: Icon, label }: { active: boolean; onClick: () => void; testid: string; icon: typeof Columns3; label: string }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      data-testid={testid}
      className={cn(
        "inline-flex items-center gap-1 rounded-control px-2 py-1 text-12 transition-colors duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted",
      )}
    >
      <Icon aria-hidden className="h-3.5 w-3.5" />
      {label}
    </button>
  );
}

function KindLabel({ item }: { item: InboxItem }) {
  const text = item.kind === "feedback" && item.feedbackKind !== null ? item.feedbackKind : INBOX_KIND_LABEL[item.kind];
  return <span className="rounded-control border border-border px-1.5 py-0.5 text-10 text-muted-foreground">{text}</span>;
}

function CardMeta({ item }: { item: InboxItem }) {
  return (
    <>
      {item.resolvedByDesignId !== null && <LinkBadge text="已生成方案" testid={`link-generated-${item.code}`} />}
      {item.linkedFeedbackId !== null && <LinkBadge text="源自反馈" testid={`link-from-${item.code}`} />}
    </>
  );
}

function BoardCard({ item, busy, onOpen }: { item: InboxItem; busy: boolean; onOpen: () => void }) {
  return (
    <div
      draggable={!busy}
      onDragStart={(e) => e.dataTransfer.setData("text/plain", item.id)}
      onClick={onOpen}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
      data-testid={`inbox-card-${item.code}`}
      className={cn(
        "flex flex-col gap-1.5 rounded-card border border-border-subtle bg-card p-2.5 transition-colors duration-fast hover:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        busy ? "cursor-wait opacity-60" : "cursor-grab active:cursor-grabbing",
      )}
    >
      <div className="flex items-center gap-1.5">
        <span className="font-mono text-10 text-muted-foreground">{item.code}</span>
        <KindLabel item={item} />
        {item.severe && <SevereBadge />}
      </div>
      <p className="line-clamp-2 text-12 font-medium">{item.title}</p>
      <div className="flex flex-wrap items-center gap-1">
        <CardMeta item={item} />
        {item.github !== null && <GithubBadge {...item.github} />}
      </div>
    </div>
  );
}

function ListView({
  items, stageFilter, onStageFilter, onOpen, nextCursor, loadingMore, onLoadMore,
}: {
  items: InboxItem[];
  stageFilter: StageFilter;
  onStageFilter: (s: StageFilter) => void;
  onOpen: (id: string) => void;
  nextCursor: string | null;
  loadingMore: boolean;
  onLoadMore: () => void;
}) {
  const subFilters: { value: StageFilter; label: string }[] = [
    { value: "all", label: "全部" },
    ...INBOX_STAGE_ORDER.map((s) => ({ value: s as StageFilter, label: INBOX_STAGE_LABEL[s] })),
  ];
  return (
    <div className="flex flex-1 flex-col overflow-hidden" data-testid="inbox-list">
      <div className="flex items-center gap-1 border-b border-border px-4 py-2">
        {subFilters.map((f) => (
          <button
            key={f.value}
            type="button"
            aria-pressed={stageFilter === f.value}
            onClick={() => onStageFilter(f.value)}
            data-testid={`inbox-status-${f.value}`}
            className={cn(
              "rounded-control px-2 py-1 text-11 transition-colors duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              stageFilter === f.value ? "bg-secondary text-secondary-foreground" : "text-muted-foreground hover:bg-muted",
            )}
          >
            {f.label}
          </button>
        ))}
      </div>
      <div className="flex-1 overflow-y-auto">
        <table className="w-full text-12">
          <thead className="sticky top-0 bg-card">
            <tr className="border-b border-border text-left text-11 text-muted-foreground">
              <th className="px-4 py-2 font-medium">状态</th>
              <th className="px-4 py-2 font-medium">标题</th>
              <th className="px-4 py-2 font-medium">类型</th>
              <th className="px-4 py-2 font-medium">GitHub</th>
              <th className="px-4 py-2 font-medium">数量 / 时间</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr
                key={item.id}
                onClick={() => onOpen(item.id)}
                data-testid={`inbox-row-${item.code}`}
                className="cursor-pointer border-b border-border-subtle transition-colors duration-fast hover:bg-muted"
              >
                <td className="px-4 py-2"><StatusBadge stage={item.stage} /></td>
                <td className="px-4 py-2">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="font-mono text-10 text-muted-foreground">{item.code}</span>
                    <span className="font-medium">{item.title}</span>
                    {item.severe && <SevereBadge />}
                    <CardMeta item={item} />
                  </div>
                </td>
                <td className="px-4 py-2"><KindLabel item={item} /></td>
                <td className="px-4 py-2">{item.github !== null ? <GithubBadge {...item.github} /> : <span className="text-muted-foreground">—</span>}</td>
                <td className="px-4 py-2 text-11 text-muted-foreground">
                  {item.kind === "exception" && item.exception !== null
                    ? `${item.exception.count} 次${item.exception.affectedUsers !== null ? ` · ${item.exception.affectedUsers} 人` : ""}`
                    : new Date(item.createdAt).toLocaleDateString("zh-CN")}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {items.length === 0 && (
          <p className="p-8 text-center text-12 text-muted-foreground" data-testid="inbox-list-empty">没有符合当前筛选的条目。</p>
        )}
        <LoadMoreBar nextCursor={nextCursor} loading={loadingMore} onLoadMore={onLoadMore} />
      </div>
    </div>
  );
}

/** 贴边详情 drawer：top:54px 贴导航栏下方，right:0 到视口底部，左侧遮罩关闭。 */
function InboxDrawer({
  item, busy, openDecline, onClose, onStatus, onArchive, onDeepen, onOpenWorkbench,
}: {
  item: InboxItem;
  busy: boolean;
  /** 从看板拖到「不做」列打开：直接展开理由表单，不用再点一次「不做…」。 */
  openDecline: boolean;
  onClose: () => void;
  onStatus: (s: InboxStage) => void;
  onArchive: (reason: string) => void;
  onDeepen: () => void;
  onOpenWorkbench: () => void;
}) {
  const [declining, setDeclining] = React.useState(openDecline);
  const [reason, setReason] = React.useState("");
  const canConfirm = reason.trim() !== "";
  const canDeepen = item.kind === "feedback" && (item.stage === "backlog" || item.stage === "doing") && item.resolvedByDesignId === null;

  const [events, setEvents] = React.useState<
    { kind: "loading" } | { kind: "ready"; items: readonly FeedbackStatusEvent[] } | { kind: "failed" } | { kind: "n/a" }
  >(item.kind === "feedback" ? { kind: "loading" } : { kind: "n/a" });

  React.useEffect(() => {
    if (item.kind !== "feedback") return;
    let cancelled = false;
    setEvents({ kind: "loading" });
    void listFeedbackStatusEvents(item.id)
      .then((rows) => { if (!cancelled) setEvents({ kind: "ready", items: rows }); })
      .catch(() => { if (!cancelled) setEvents({ kind: "failed" }); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id, item.kind]);

  return (
    <>
      <div className="fixed inset-x-0 bottom-0 top-[54px] z-40 bg-inverse/30" onClick={onClose} aria-hidden data-testid="inbox-drawer-scrim" />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={`${item.code} ${item.title}`}
        data-testid="inbox-drawer"
        className="fixed bottom-0 right-0 top-[54px] z-40 flex w-[28rem] max-w-full flex-col overflow-hidden border-l border-border bg-card shadow-lg"
      >
        <header className="flex items-start justify-between gap-2 border-b border-border p-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="font-mono text-11 text-muted-foreground">{item.code}</span>
              <StatusBadge stage={item.stage} />
              <KindLabel item={item} />
              {item.severe && <SevereBadge />}
            </div>
            <h3 className="mt-1.5 text-16 font-semibold leading-snug">{item.title}</h3>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="关闭详情" data-testid="inbox-drawer-close">
            <X aria-hidden className="h-4 w-4" />
          </Button>
        </header>

        <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-4">
          {item.body === null ? (
            <p className="whitespace-pre-wrap text-13 italic text-muted-foreground" data-testid="inbox-drawer-body-withheld">
              正文仅组织管理员与提交人可见。
            </p>
          ) : (
            <p className="whitespace-pre-wrap text-13 text-card-foreground">{item.body}</p>
          )}
          {/* UC-17.8 D1：反馈类条目的结构化字段。 */}
          {item.kind === "feedback" && item.structured != null && item.feedbackKind !== null && (
            <FeedbackStructuredView
              kind={item.feedbackKind}
              structured={item.structured}
              testid={`inbox-drawer-structured-${item.id}`}
            />
          )}

          <dl className="grid grid-cols-2 gap-2 text-11">
            {item.kind === "exception" ? (
              <>
                <Meta label="发生位置" value={item.exception?.location ?? "—"} />
                <Meta label="发生次数" value={`${item.exception?.count ?? 0} 次`} />
                <Meta label="影响用户" value={item.exception?.affectedUsers !== null && item.exception?.affectedUsers !== undefined ? `${item.exception.affectedUsers} 人` : "—"} />
              </>
            ) : (
              <>
                <Meta label="提交人" value={item.reporter ?? "—"} />
                <Meta label="提交时间" value={new Date(item.createdAt).toLocaleString("zh-CN")} />
                <Meta label="票数" value={String(item.votes)} />
              </>
            )}
          </dl>

          <div className="flex flex-wrap items-center gap-1.5">
            <CardMeta item={item} />
            {item.github !== null && <GithubBadge {...item.github} />}
          </div>

          {item.statusReason !== null && (
            <div className="rounded-card border border-border-subtle bg-panel p-2.5" data-testid="inbox-drawer-reason">
              <p className="text-10 font-medium text-muted-foreground">不做的理由</p>
              <p className="mt-0.5 text-12">{item.statusReason}</p>
            </div>
          )}

          {/* 时间线：仅反馈有对应源操作（见文件头），系统异常今天没有等价接口。 */}
          {item.kind === "feedback" && (
            <div>
              <p className="mb-1.5 text-10 font-medium text-muted-foreground">时间线</p>
              {events.kind === "loading" && <p className="text-11 text-muted-foreground">读取中…</p>}
              {events.kind === "failed" && <p className="text-11 text-muted-foreground" data-testid="inbox-drawer-timeline-failed">时间线没读到，稍后重试。</p>}
              {events.kind === "ready" && (
                <ol className="flex flex-col gap-2 border-l border-border pl-3" data-testid="inbox-drawer-timeline">
                  {events.items.length === 0 && <li className="text-11 text-muted-foreground">还没有状态变更记录。</li>}
                  {events.items.map((e, i) => (
                    <li key={i} className="text-11">
                      <span className="text-card-foreground">{e.toStatus}</span>
                      <span className="ml-1.5 text-muted-foreground">{new Date(e.createdAt).toLocaleDateString("zh-CN")}</span>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          )}
        </div>

        {/* 操作区：随状态显示可用动作 */}
        <footer className="flex flex-col gap-2 border-t border-border p-4">
          {declining ? (
            <div className="flex flex-col gap-2" data-testid="inbox-decline-form">
              <label htmlFor="inbox-decline-reason" className="text-11 font-medium text-muted-foreground">
                为什么不做？理由会记入时间线，团队以后能查到。
              </label>
              <Textarea
                id="inbox-decline-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={3}
                placeholder="例如：与即将上线的能力重叠，本轮不单独做。"
                data-testid="inbox-decline-reason"
              />
              {!canConfirm && (
                <p className="text-10 text-muted-foreground" data-testid="err-reason">不做必须写清理由，否则无法确认。</p>
              )}
              <div className="flex justify-end gap-2">
                <Button variant="ghost" size="sm" onClick={() => { setDeclining(false); setReason(""); }}>取消</Button>
                <Button
                  variant="destructive"
                  size="sm"
                  disabled={!canConfirm || busy}
                  onClick={() => onArchive(reason.trim())}
                  data-testid="inbox-decline-confirm"
                >
                  {busy && <Loader2 aria-hidden className="h-3.5 w-3.5 animate-spin" />}
                  确认不做
                </Button>
              </div>
            </div>
          ) : item.kind === "design" ? null : (
            <div className="flex flex-wrap gap-2">
              {item.stage === "backlog" && (
                <Button variant="primary" size="sm" disabled={busy} onClick={() => onStatus("doing")} data-testid="inbox-action-start">
                  <Play aria-hidden className="h-3.5 w-3.5" /> 开始处理
                </Button>
              )}
              {item.stage === "doing" && (
                <>
                  {item.kind === "feedback" && (
                    <Button variant="primary" size="sm" disabled={busy} onClick={() => onStatus("done")} data-testid="inbox-action-done">
                      <Check aria-hidden className="h-3.5 w-3.5" /> 标记已修复
                    </Button>
                  )}
                  <Button variant="outline" size="sm" disabled={busy} onClick={() => onStatus("backlog")} data-testid="inbox-action-back">
                    <Undo2 aria-hidden className="h-3.5 w-3.5" /> 退回待处理
                  </Button>
                </>
              )}
              {(item.stage === "done" || item.stage === "archived") && (
                <Button variant="outline" size="sm" disabled={busy} onClick={() => onStatus("backlog")} data-testid="inbox-action-reopen">
                  <Undo2 aria-hidden className="h-3.5 w-3.5" /> 重新打开
                </Button>
              )}
              {canDeepen && (
                <Button variant="ai" size="sm" onClick={onDeepen} data-testid="inbox-action-deepen">
                  <Sparkles aria-hidden className="h-3.5 w-3.5" /> 用 PM 设计工作台深化
                </Button>
              )}
              {item.resolvedByDesignId !== null && (
                <Button variant="outline" size="sm" onClick={onOpenWorkbench} data-testid="inbox-action-open-design">
                  查看方案
                </Button>
              )}
              {(item.stage === "backlog" || item.stage === "doing") && (
                <Button variant="ghost" size="sm" className="text-destructive" disabled={busy} onClick={() => setDeclining(true)} data-testid="inbox-action-decline">
                  <Ban aria-hidden className="h-3.5 w-3.5" /> 不做…
                </Button>
              )}
            </div>
          )}
        </footer>
      </aside>
    </>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-card-foreground">{value}</dd>
    </div>
  );
}
