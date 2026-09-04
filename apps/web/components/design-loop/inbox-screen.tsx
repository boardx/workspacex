"use client";
import * as React from "react";
import {
  LayoutList, Columns3, Search, X, Github, Sparkles, Play, Check, Undo2, Ban, ShieldAlert, PlugZap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { UiState } from "@/lib/ui-state";
import {
  useDesignLoop, KIND_LABEL, TYPE_LABEL, STATUS_LABEL, STATUS_ORDER,
  type InboxItem, type InboxKind, type InboxStatus,
} from "@/lib/design-loop-store";
import { FeedbackStructuredView } from "@/components/feedback/feedback-structured";
import { StatusBadge, GithubBadge, LinkBadge, SevereBadge } from "./badges";

type KindFilter = "all" | InboxKind;
type StatusFilter = "all" | InboxStatus;

const KIND_FILTERS: { value: KindFilter; label: string }[] = [
  { value: "all", label: "全部" },
  { value: "feedback", label: "反馈" },
  { value: "exception", label: "系统异常" },
  { value: "design", label: "设计方案" },
];

/** 反馈子分类（缺陷/需求）也进 chip，需求原文的类型筛选是「全部/缺陷/需求/系统异常/设计方案」。 */
function matchKind(item: InboxItem, f: KindFilter): boolean {
  if (f === "all") return true;
  return item.kind === f;
}

export function DesignLoopInboxScreen({
  state = "default",
  onDeepen,
  onOpenWorkbench,
  openId: initialOpenId = null,
}: {
  state?: UiState;
  onDeepen?: (projectId: string) => void;
  onOpenWorkbench?: (inboxCode: string) => void;
  /** 进屏就打开这一条的详情（`?open=<id>`）。收件箱本身还是 mock（B3），找不到就不开。 */
  openId?: string | null;
}) {
  const store = useDesignLoop();
  const [view, setView] = React.useState<"board" | "list">("board");
  const [kindFilter, setKindFilter] = React.useState<KindFilter>("all");
  const [statusFilter, setStatusFilter] = React.useState<StatusFilter>("all");
  const [query, setQuery] = React.useState("");
  const [openId, setOpenId] = React.useState<string | null>(initialOpenId);
  const [dragOver, setDragOver] = React.useState<InboxStatus | null>(null);
  const [saved, setSaved] = React.useState<string | null>(null);

  const filtered = store.inbox.filter(
    (i) =>
      matchKind(i, kindFilter) &&
      (statusFilter === "all" || i.status === statusFilter) &&
      (query.trim() === "" || `${i.title}${i.body}${i.code}`.toLowerCase().includes(query.trim().toLowerCase())),
  );
  const open = store.inbox.find((i) => i.id === openId) ?? null;

  const flashSaved = (msg: string) => {
    setSaved(msg);
    window.setTimeout(() => setSaved(null), 2400);
  };

  // ── 七态：loading / denied / dep-failed 走保留态面板；empty 数据驱动 ──────────
  if (state === "loading") {
    return (
      <div className="p-6" data-testid="loading">
        <div className="grid grid-cols-4 gap-3">
          {STATUS_ORDER.map((s) => (
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
  if (state === "dep-failed") {
    return (
      <div className="flex flex-col items-center gap-2 p-16 text-center" data-testid="dep-failed">
        <PlugZap aria-hidden className="h-8 w-8 text-muted-foreground" />
        <p className="text-14 font-medium">收件箱数据暂时读不到</p>
        <p className="max-w-sm text-12 text-muted-foreground">
          反馈、系统异常与设计方案的合并数据源这次没取到，条目没有丢。稍后重试，或检查后台服务状态。
        </p>
        <Button size="sm" variant="outline" className="mt-1">重试</Button>
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
      {/* 工具条：视图切换 + 类型 chip + 搜索 */}
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
        <div className="flex items-center gap-0.5 rounded-control border border-border p-0.5">
          <ViewToggle active={view === "board"} onClick={() => setView("board")} testid="inbox-view-board" icon={Columns3} label="看板" />
          <ViewToggle active={view === "list"} onClick={() => setView("list")} testid="inbox-view-list" icon={LayoutList} label="列表" />
        </div>
        <div className="flex flex-wrap items-center gap-1" role="group" aria-label="类型筛选">
          {KIND_FILTERS.map((f) => (
            <button
              key={f.value}
              type="button"
              aria-pressed={kindFilter === f.value}
              onClick={() => setKindFilter(f.value)}
              data-testid={`inbox-kind-${f.value}`}
              className={cn(
                "rounded-control border px-2.5 py-1 text-12 transition-colors duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                kindFilter === f.value
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-card text-card-foreground hover:bg-muted",
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="relative ml-auto">
          <Search aria-hidden className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索标题或编号"
            data-testid="inbox-search"
            className="h-8 w-56 pl-7 text-12"
          />
        </div>
      </div>

      {store.inbox.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-1 p-16 text-center" data-testid="empty">
          <p className="text-14 font-medium">收件箱是空的</p>
          <p className="text-12 text-muted-foreground">用户提交反馈、系统告警或推送设计方案后，都会汇总到这里。</p>
        </div>
      ) : view === "board" ? (
        <div className="grid flex-1 grid-cols-4 gap-3 overflow-y-auto p-4" data-testid="inbox-board">
          {STATUS_ORDER.map((col) => {
            const items = filtered.filter((i) => i.status === col);
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
                  if (id) {
                    store.setStatus(id, col);
                    flashSaved(`已移动到「${STATUS_LABEL[col]}」`);
                  }
                }}
                className={cn(
                  "flex min-h-32 flex-col gap-2 rounded-card border border-transparent bg-panel p-2 transition-colors duration-fast",
                  dragOver === col && "border-primary bg-ai-tint/30",
                )}
              >
                <div className="flex items-center justify-between px-1 pt-0.5">
                  <span className="text-11 font-medium text-muted-foreground">{STATUS_LABEL[col]}</span>
                  <span className="text-11 text-muted-foreground" data-testid={`inbox-column-count-${col}`}>{items.length}</span>
                </div>
                {items.map((item) => (
                  <BoardCard key={item.id} item={item} onOpen={() => setOpenId(item.id)} />
                ))}
              </div>
            );
          })}
        </div>
      ) : (
        <ListView items={filtered} statusFilter={statusFilter} onStatusFilter={setStatusFilter} onOpen={setOpenId} />
      )}

      {open !== null && (
        <InboxDrawer
          item={open}
          onClose={() => setOpenId(null)}
          onStatus={(s) => {
            store.setStatus(open.id, s);
            flashSaved(`状态改为「${STATUS_LABEL[s]}」`);
          }}
          onArchive={(reason) => {
            store.archiveWithReason(open.id, reason);
            flashSaved("已转为不做，理由已记入时间线");
          }}
          onDeepen={() => {
            const projId = store.deepenFeedback(open.id);
            setOpenId(null);
            onDeepen?.(projId);
          }}
          onOpenWorkbench={() => onOpenWorkbench?.(open.code)}
        />
      )}
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
  const text = item.kind === "feedback" ? TYPE_LABEL[item.type ?? "bug"] : KIND_LABEL[item.kind];
  return <span className="rounded-control border border-border px-1.5 py-0.5 text-10 text-muted-foreground">{text}</span>;
}

function CardMeta({ item }: { item: InboxItem }) {
  return (
    <>
      {item.resolvedByDesign && <LinkBadge text={`已生成 ${item.resolvedByDesign}`} testid={`link-generated-${item.code}`} />}
      {item.linkedFeedback && <LinkBadge text={`源自 ${item.linkedFeedback}`} testid={`link-from-${item.code}`} />}
    </>
  );
}

function BoardCard({ item, onOpen }: { item: InboxItem; onOpen: () => void }) {
  return (
    <div
      draggable
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
      className="flex cursor-grab flex-col gap-1.5 rounded-card border border-border-subtle bg-card p-2.5 transition-colors duration-fast hover:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing"
    >
      <div className="flex items-center gap-1.5">
        <span className="font-mono text-10 text-muted-foreground">{item.code}</span>
        <KindLabel item={item} />
        {item.severe && <SevereBadge />}
      </div>
      <p className="line-clamp-2 text-12 font-medium">{item.title}</p>
      <div className="flex flex-wrap items-center gap-1">
        <CardMeta item={item} />
        {item.github && <GithubBadge {...item.github} />}
      </div>
    </div>
  );
}

function ListView({
  items, statusFilter, onStatusFilter, onOpen,
}: {
  items: InboxItem[];
  statusFilter: StatusFilter;
  onStatusFilter: (s: StatusFilter) => void;
  onOpen: (id: string) => void;
}) {
  const subFilters: { value: StatusFilter; label: string }[] = [
    { value: "all", label: "全部" },
    ...STATUS_ORDER.map((s) => ({ value: s as StatusFilter, label: STATUS_LABEL[s] })),
  ];
  return (
    <div className="flex flex-1 flex-col overflow-hidden" data-testid="inbox-list">
      <div className="flex items-center gap-1 border-b border-border px-4 py-2">
        {subFilters.map((f) => (
          <button
            key={f.value}
            type="button"
            aria-pressed={statusFilter === f.value}
            onClick={() => onStatusFilter(f.value)}
            data-testid={`inbox-status-${f.value}`}
            className={cn(
              "rounded-control px-2 py-1 text-11 transition-colors duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              statusFilter === f.value ? "bg-secondary text-secondary-foreground" : "text-muted-foreground hover:bg-muted",
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
                <td className="px-4 py-2"><StatusBadge status={item.status} /></td>
                <td className="px-4 py-2">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="font-mono text-10 text-muted-foreground">{item.code}</span>
                    <span className="font-medium">{item.title}</span>
                    {item.severe && <SevereBadge />}
                    <CardMeta item={item} />
                  </div>
                </td>
                <td className="px-4 py-2"><KindLabel item={item} /></td>
                <td className="px-4 py-2">{item.github ? <GithubBadge {...item.github} /> : <span className="text-muted-foreground">—</span>}</td>
                <td className="px-4 py-2 text-11 text-muted-foreground">
                  {item.kind === "exception" ? `${item.count ?? 0} 次 · ${item.users ?? 0} 人` : new Date(item.time).toLocaleDateString("zh-CN")}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {items.length === 0 && (
          <p className="p-8 text-center text-12 text-muted-foreground" data-testid="inbox-list-empty">没有符合当前筛选的条目。</p>
        )}
      </div>
    </div>
  );
}

/** 贴边详情 drawer：top:54px 贴导航栏下方，right:0 到视口底部，左侧遮罩关闭。 */
function InboxDrawer({
  item, onClose, onStatus, onArchive, onDeepen, onOpenWorkbench,
}: {
  item: InboxItem;
  onClose: () => void;
  onStatus: (s: InboxStatus) => void;
  onArchive: (reason: string) => void;
  onDeepen: () => void;
  onOpenWorkbench: () => void;
}) {
  const [declining, setDeclining] = React.useState(false);
  const [reason, setReason] = React.useState("");
  const canConfirm = reason.trim() !== "";
  const canDeepen = item.kind === "feedback" && (item.status === "backlog" || item.status === "doing") && !item.resolvedByDesign;

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
              <StatusBadge status={item.status} />
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
          <p className="whitespace-pre-wrap text-13 text-card-foreground">{item.body}</p>
          {/* UC-17.8 D1：反馈类条目的结构化字段；mock 条目多半没有（undefined/null ⇒ 不渲染）。 */}
          {item.kind === "feedback" && item.structured != null && (
            <FeedbackStructuredView
              kind={item.type === "req" ? "需求" : "缺陷"}
              structured={item.structured}
              testid={`inbox-drawer-structured-${item.id}`}
            />
          )}

          <dl className="grid grid-cols-2 gap-2 text-11">
            {item.kind === "exception" ? (
              <>
                <Meta label="发生位置" value={item.location ?? "—"} />
                <Meta label="发生次数" value={`${item.count ?? 0} 次`} />
                <Meta label="影响用户" value={`${item.users ?? 0} 人`} />
              </>
            ) : (
              <>
                <Meta label="提交人" value={item.reporter ?? "—"} />
                <Meta label="提交时间" value={new Date(item.time).toLocaleString("zh-CN")} />
                <Meta label="票数" value={String(item.votes)} />
              </>
            )}
          </dl>

          <div className="flex flex-wrap items-center gap-1.5">
            <CardMeta item={item} />
            {item.github && <GithubBadge {...item.github} />}
          </div>

          {item.reason && (
            <div className="rounded-card border border-border-subtle bg-panel p-2.5" data-testid="inbox-drawer-reason">
              <p className="text-10 font-medium text-muted-foreground">不做的理由</p>
              <p className="mt-0.5 text-12">{item.reason}</p>
            </div>
          )}

          <div>
            <p className="mb-1.5 text-10 font-medium text-muted-foreground">时间线</p>
            <ol className="flex flex-col gap-2 border-l border-border pl-3">
              {item.timeline.map((t, i) => (
                <li key={i} className="text-11">
                  <span className="text-card-foreground">{t.text}</span>
                  <span className="ml-1.5 text-muted-foreground">{new Date(t.at).toLocaleDateString("zh-CN")}</span>
                </li>
              ))}
            </ol>
          </div>
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
                  disabled={!canConfirm}
                  onClick={() => onArchive(reason.trim())}
                  data-testid="inbox-decline-confirm"
                >
                  确认不做
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {item.status === "backlog" && (
                <Button variant="primary" size="sm" onClick={() => onStatus("doing")} data-testid="inbox-action-start">
                  <Play aria-hidden className="h-3.5 w-3.5" /> 开始处理
                </Button>
              )}
              {item.status === "doing" && (
                <>
                  <Button variant="primary" size="sm" onClick={() => onStatus("done")} data-testid="inbox-action-done">
                    <Check aria-hidden className="h-3.5 w-3.5" /> 标记已修复
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => onStatus("backlog")} data-testid="inbox-action-back">
                    <Undo2 aria-hidden className="h-3.5 w-3.5" /> 退回待处理
                  </Button>
                </>
              )}
              {(item.status === "done" || item.status === "archived") && (
                <Button variant="outline" size="sm" onClick={() => onStatus("backlog")} data-testid="inbox-action-reopen">
                  <Undo2 aria-hidden className="h-3.5 w-3.5" /> 重新打开
                </Button>
              )}
              {item.status === "backlog" && !item.github && item.kind !== "design" && (
                <Button variant="outline" size="sm" data-testid="inbox-action-github">
                  <Github aria-hidden className="h-3.5 w-3.5" /> 创建 GitHub Issue
                </Button>
              )}
              {canDeepen && (
                <Button variant="ai" size="sm" onClick={onDeepen} data-testid="inbox-action-deepen">
                  <Sparkles aria-hidden className="h-3.5 w-3.5" /> 用 PM 设计工作台深化
                </Button>
              )}
              {item.resolvedByDesign && (
                <Button variant="outline" size="sm" onClick={onOpenWorkbench} data-testid="inbox-action-open-design">
                  查看方案 {item.resolvedByDesign}
                </Button>
              )}
              {(item.status === "backlog" || item.status === "doing") && (
                <Button variant="ghost" size="sm" className="text-destructive" onClick={() => setDeclining(true)} data-testid="inbox-action-decline">
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
