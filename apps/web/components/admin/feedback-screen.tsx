"use client";
import * as React from "react";
import { ExternalLink, GitPullRequest, Loader2, RefreshCw, Search } from "lucide-react";
import { AdminScreen } from "./admin-screen";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ApiError } from "@/lib/api-client";
import { useOptionalSession } from "@/components/session/session-provider";
import { listAgents } from "@/lib/agent-definition";
import { listSkills } from "@/lib/live-skill";
import {
  commentOnFeedbackGithubIssue,
  fetchFeedbackAttachmentObjectUrl,
  getFeedbackGithubIssue,
  listFeedback,
  listFeedbackStatusEvents,
  triageFeedback,
  voteFeedback,
  type FeedbackGithubIssueStatus,
  type FeedbackIssueDraft,
  type FeedbackItem,
  type FeedbackKind,
  type FeedbackStatus,
  type FeedbackStatusEvent,
} from "@/lib/live-feedback";
import { listSystemErrorLogs, sendTestEmail, type SendTestEmailOut, type SystemErrorLogItem } from "@/lib/live-system-errors";
import type { UiState } from "@/lib/ui-state";
import { cn } from "@/lib/utils";

/**
 * FB-3 —— 后台「反馈与迭代」的**真栈**屏。**三个标签页 + 左列表右详情。**
 *
 * ## 这块屏经历过的三次改法
 *
 * ① 178 行全 mock。② FB-3 真栈化，按「产品 / Agent·Skill」分两列。③ 2026-09-02 上午
 * 改成按状态分四列的看板 + 点卡片开 detail 弹层。
 *
 * ## 2026-09-02 下午（人类给了三张设计稿，要求像素级实施）
 *
 *   · **三个标签页**：缺陷反馈 / 需求建议 / 系统异常——三类东西各有各的处理节奏，
 *     混在一块看板里的结果是"待处理"这一列里缺陷和需求互相淹没。
 *   · **左列表右详情**，不再是弹层：分诊是"一条接一条"的工作，弹层每次开关都在
 *     打断这个节奏；右侧常驻的详情面板让"看一眼、点排期、下一条"不换上下文。
 *   · **状态词按类型换**（`STATUS_LABEL`）：需求那页显示 待评估 / 已排期 / 已上线，
 *     缺陷那页显示 待处理 / 已进入迭代 / 已修复。⚠ 这**只是显示名**——状态机、契约、
 *     DB 约束仍然只有 `FeedbackStatus` 那一套四态；同一条边在两页上叫不同的名字，
 *     不是两套状态。理由同上一版头注：不新增一个只装样子的状态。
 *   · **列表编号**（R-1 / B-5）按类型内的提交顺序现算（`displayIdsOf`），只是让人
 *     嘴上能指认"R-3 那条"，不是标识——标识仍是服务端的 `id`。
 *   · 来源名字（Agent · 客服助手）在**客户端**用 `listAgents` / `listSkills` 解析：
 *     `targetLabel` 服务端今天仍然留空（见 `feedback.controller.ts` 头注），两份目录
 *     本来就对全组织成员可见，这里只是把 id 换成人读的名字，解析不到就退回 id。
 *
 * ## 设计稿里两处**没有**照搬的东西（如实登记，不是漏了）
 *
 *   · 「标题为自动摘要」小标签：需要一个"标题是不是 AI 整理出来的"字段，契约里
 *     没有这条事实，不编。
 *   · 「N 条异常未处理」里的"未处理"：`error_logs` 没有处理状态，这里写的是
 *     「N 条系统异常」——多一个词就是多一份不存在的事实。
 *
 * ## GitHub issue / 更新记录（邮件通知历史）
 *
 * 两块都在右侧详情里，各自打开那条反馈时才拉（`GET /feedback/:id/events`、
 * `GET /feedback/:id/github-issue`），不随列表批量拉——理由同上一版：一个是外部限流
 * API，一个虽是本仓的库但没有必要为没打开的行付这个成本。
 */

const STATUS_TONE: Record<FeedbackStatus, "warning" | "ai" | "primary" | "neutral"> = {
  待处理: "warning",
  已进入迭代: "ai",
  已修复: "primary",
  不做: "neutral",
};

const STATUS_ORDER: readonly FeedbackStatus[] = ["待处理", "已进入迭代", "已修复", "不做"];

/**
 * 状态的**显示名**按类型换——纯展示，不是第二份状态枚举（见文件头）。
 */
const STATUS_LABEL: Record<FeedbackKind, Record<FeedbackStatus, string>> = {
  缺陷: { 待处理: "待处理", 已进入迭代: "已进入迭代", 已修复: "已修复", 不做: "不做" },
  需求: { 待处理: "待评估", 已进入迭代: "已排期", 已修复: "已上线", 不做: "不做" },
};

/** 详情面板的主按钮：当前状态"向前"的那条边与它在这一页上的叫法。 */
const FORWARD_ACTION: Record<FeedbackKind, Partial<Record<FeedbackStatus, { next: FeedbackStatus; label: string }>>> = {
  缺陷: { 待处理: { next: "已进入迭代", label: "进入迭代" }, 已进入迭代: { next: "已修复", label: "标记已修复" } },
  需求: { 待处理: { next: "已进入迭代", label: "排期" }, 已进入迭代: { next: "已修复", label: "已上线" } },
};

const ID_PREFIX: Record<FeedbackKind, string> = { 缺陷: "B", 需求: "R" };

/**
 * 分诊按钮 = **状态机的边**（`domain/feedback/product-feedback.ts` 的 `ALLOWED_TRANSITIONS`）。
 *
 * ⚠ 这里是那张表的**第二份副本**，而这是本仓明令禁止的形状——所以它必须有一条
 *   机械对账：`tests/ui/admin-feedback-transitions-match-domain.test.ts` 把这张表与
 *   domain 那张逐条比对，对不上就红。
 *
 *   为什么不能直接 import domain：`apps/web` 不依赖 `apps/api`（洋葱边界，
 *   `lint-arch-deps` 会拦）。把状态机搬进 `@repo/contracts` 是更好的解法，
 *   但那要动一份已签核契约的形状——留给 FB-4，登记在这里。
 */
export const NEXT_STATUSES: Record<FeedbackStatus, readonly FeedbackStatus[]> = {
  待处理: ["已进入迭代", "不做"],
  已进入迭代: ["已修复", "待处理", "不做"],
  已修复: ["待处理"],
  不做: ["待处理"],
};

/**
 * "转开发" ⇒ 转到「已进入迭代」这条边**唯一**要求先弹一个可编辑框的转移
 * （2026-08-30）：确认时会真的往 `boardx/workspacex` 建一个 GitHub issue
 * （见 `apps/api/src/application/feedback/triage-feedback.ts` 头注①,fail closed）。
 */
const ISSUE_DRAFT_STATUS: FeedbackStatus = "已进入迭代";

const KIND_ISSUE_LABEL: Record<FeedbackKind, string> = { 缺陷: "bug", 需求: "enhancement" };

function defaultIssueDraft(item: FeedbackItem): FeedbackIssueDraft {
  const detail = item.detail ?? "(正文仅组织管理员与提交人可见,分诊时请补充必要的复现上下文。)";
  return {
    title: item.title,
    body: `${detail}\n\n---\n来源:后台「反馈与迭代」· 反馈 ID ${item.id}`,
    labels: ["user-feedback", KIND_ISSUE_LABEL[item.kind]],
  };
}

type SourceFilter = "all" | "product" | "agent" | "skill";
type StatusFilter = "all" | FeedbackStatus;
type Tab = FeedbackKind | "system";

function matchesSource(item: FeedbackItem, filter: SourceFilter): boolean {
  return filter === "all" || item.target.kind === filter;
}

/** 设计稿的时间格式：`2026/9/2 11:20`。 */
function formatTime(iso: string): string {
  const d = new Date(iso);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${hh}:${mm}`;
}

/** R-1 / B-5：按类型内提交顺序现算的编号——见文件头，不是标识。 */
function displayIdsOf(items: readonly FeedbackItem[]): ReadonlyMap<string, string> {
  const out = new Map<string, string>();
  for (const kind of ["缺陷", "需求"] as const) {
    const ofKind = items
      .filter((f) => f.kind === kind)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
    ofKind.forEach((f, i) => out.set(f.id, `${ID_PREFIX[kind]}-${i + 1}`));
  }
  return out;
}

interface TargetNames {
  readonly agents: ReadonlyMap<string, string>;
  readonly skills: ReadonlyMap<string, string>;
}

function sourceOf(item: FeedbackItem, names: TargetNames): { readonly kindLabel: string; readonly name: string | null; readonly id: string | null } {
  if (item.target.kind === "product") return { kindLabel: "产品", name: null, id: null };
  if (item.target.kind === "agent") {
    const id = item.target.agentId;
    return { kindLabel: "Agent", name: item.targetLabel ?? names.agents.get(id) ?? null, id };
  }
  const id = item.target.skillId;
  return { kindLabel: "Skill", name: item.targetLabel ?? names.skills.get(id) ?? null, id };
}

function describeFailure(err: unknown): string {
  if (err instanceof ApiError) return err.reasonCode ?? `http_${err.status}`;
  if (err instanceof TypeError) return "无法连接服务器，请稍后重试";
  return String(err);
}

type Load =
  | { kind: "loading" }
  | { kind: "ready"; items: readonly FeedbackItem[] }
  | { kind: "failed"; reason: string };

type SystemLoad =
  | { kind: "loading" }
  | { kind: "ready"; items: readonly SystemErrorLogItem[]; hasMore: boolean }
  | { kind: "forbidden" }
  | { kind: "failed"; reason: string };

export function FeedbackScreen({ state }: { state: UiState }) {
  const session = useOptionalSession();
  const [load, setLoad] = React.useState<Load>({ kind: "loading" });
  const [systemLoad, setSystemLoad] = React.useState<SystemLoad>({ kind: "loading" });
  const [tab, setTab] = React.useState<Tab>("缺陷");
  const [statusFilter, setStatusFilter] = React.useState<StatusFilter>("all");
  const [sourceFilter, setSourceFilter] = React.useState<SourceFilter>("all");
  const [query, setQuery] = React.useState("");
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [actionError, setActionError] = React.useState<string | null>(null);
  const [names, setNames] = React.useState<TargetNames>({ agents: new Map(), skills: new Map() });

  const reload = React.useCallback(async () => {
    setLoad({ kind: "loading" });
    try {
      const items = await listFeedback({ kind: "org" });
      setLoad({ kind: "ready", items });
    } catch (err) {
      setLoad({ kind: "failed", reason: describeFailure(err) });
    }
  }, []);

  const reloadSystem = React.useCallback(async () => {
    setSystemLoad({ kind: "loading" });
    try {
      const out = await listSystemErrorLogs({ limit: 50 });
      setSystemLoad({ kind: "ready", items: out.items ?? [], hasMore: out.hasMore ?? false });
    } catch (err) {
      if (err instanceof ApiError && err.reasonCode === "NOT_PLATFORM_SUPERUSER") {
        setSystemLoad({ kind: "forbidden" });
        return;
      }
      setSystemLoad({ kind: "failed", reason: describeFailure(err) });
    }
  }, []);

  React.useEffect(() => {
    void reload();
    void reloadSystem();
  }, [reload, reloadSystem]);

  // 来源名字：两份目录各拉一次，失败就留 id（best-effort，见文件头）。
  const orgId = session?.session?.currentOrgId ?? null;
  React.useEffect(() => {
    let cancelled = false;
    void Promise.all([
      listAgents().then((rows) => new Map(rows.map((r) => [r.agentId, r.name] as const))).catch(() => new Map<string, string>()),
      orgId === null
        ? Promise.resolve(new Map<string, string>())
        : listSkills(orgId).then((rows) => new Map(rows.map((r) => [r.skillId, r.name] as const))).catch(() => new Map<string, string>()),
    ]).then(([agents, skills]) => {
      if (!cancelled) setNames({ agents, skills });
    });
    return () => { cancelled = true; };
  }, [orgId]);

  const act = async (fn: () => Promise<unknown>, id: string) => {
    setBusyId(id);
    setActionError(null);
    try {
      await fn();
      await reload();
    } catch (err) {
      setActionError(describeFailure(err));
    } finally {
      setBusyId(null);
    }
  };

  const items = React.useMemo(() => (load.kind === "ready" ? load.items : []), [load]);
  const displayIds = React.useMemo(() => displayIdsOf(items), [items]);
  const ofTab = tab === "system" ? [] : items.filter((f) => f.kind === tab);
  const q = query.trim().toLowerCase();
  const visible = ofTab.filter((f) => {
    if (statusFilter !== "all" && f.status !== statusFilter) return false;
    if (!matchesSource(f, sourceFilter)) return false;
    if (q === "") return true;
    const src = sourceOf(f, names);
    const hay = [f.title, f.detail ?? "", src.kindLabel, src.name ?? "", src.id ?? "", f.submitterName ?? ""].join(" ").toLowerCase();
    return hay.includes(q);
  });
  const counts = (kind: FeedbackKind) => items.filter((f) => f.kind === kind).length;
  const countByStatus = (status: FeedbackStatus) => ofTab.filter((f) => f.status === status).length;

  // 选中项：默认选当前页第一条；切页/筛选后选中项不在可见集合里就换成第一条。
  const selected = visible.find((f) => f.id === selectedId) ?? visible[0] ?? null;
  const systemCount = systemLoad.kind === "ready" ? systemLoad.items.length : null;

  return (
    <AdminScreen
      state={state}
      moduleLabel="反馈"
      title="反馈与迭代"
      liveBacked
      hideOrgIdentity
      intro="缺陷、需求、系统异常统一收件箱。左侧列表按状态与来源筛选，右侧处理；转「不做」必须写理由。"
      titleAside={
        systemCount !== null && systemCount > 0 ? (
          <span
            className="inline-flex items-center gap-2 rounded-md border border-border bg-panel px-3 py-1.5 text-12 text-card-foreground"
            data-testid="admin-feedback-system-errors-pill"
          >
            <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-destructive" />
            {systemCount} 条系统异常
          </span>
        ) : undefined
      }
      emptyHint="还没有收到反馈"
      errors={{ triage: "分诊失败：状态未变更，反馈已保留可重试" }}
      depFailure="反馈接口不可用，无法读取或分诊。"
      denialReason="分诊仅组织管理员可操作；任意成员都能提反馈、并看到标题与票数。"
      successMessage="状态已更新，并已写入这条反馈的状态流水"
    >
      <div className="-mx-6 flex flex-col">
        {/* 标签页 */}
        <div className="flex items-end gap-6 border-b border-border px-6" role="tablist" aria-label="反馈类型">
          <TabButton active={tab === "缺陷"} onClick={() => { setTab("缺陷"); setStatusFilter("all"); }} count={counts("缺陷")} testid="admin-feedback-tab-缺陷">缺陷反馈</TabButton>
          <TabButton active={tab === "需求"} onClick={() => { setTab("需求"); setStatusFilter("all"); }} count={counts("需求")} testid="admin-feedback-tab-需求">需求建议</TabButton>
          <TabButton active={tab === "system"} onClick={() => setTab("system")} count={systemCount} testid="admin-feedback-tab-system">系统异常</TabButton>
        </div>

        {tab === "system" ? (
          <SystemExceptionsSection load={systemLoad} onReload={() => void reloadSystem()} />
        ) : (
          <>
            {/* 筛选条 */}
            <div className="flex flex-wrap items-center gap-3 px-6 py-3" data-testid="admin-feedback-filters">
              <div className="inline-flex items-center gap-0.5 rounded-md bg-muted p-0.5" role="group" aria-label="按状态筛选">
                <StatusChip active={statusFilter === "all"} onClick={() => setStatusFilter("all")} count={ofTab.length} testid="admin-feedback-filter-status-all">全部</StatusChip>
                {STATUS_ORDER.map((s) => (
                  <StatusChip key={s} active={statusFilter === s} onClick={() => setStatusFilter(s)} count={countByStatus(s)} testid={`admin-feedback-filter-status-${s}`}>
                    {STATUS_LABEL[tab][s]}
                  </StatusChip>
                ))}
              </div>
              <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="按来源筛选">
                {SOURCE_FILTER_OPTIONS.map(({ value, label }) => (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={sourceFilter === value}
                    onClick={() => setSourceFilter(value)}
                    data-testid={`admin-feedback-filter-source-${value}`}
                    className={cn(
                      "rounded-pill border px-3 py-1.5 text-12 transition-colors duration-fast",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      sourceFilter === value
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border bg-card text-card-foreground hover:bg-muted",
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <label className="ml-auto flex h-8 w-72 max-w-full items-center gap-2 rounded-md border border-border-subtle bg-panel px-2.5 text-12 text-muted-foreground focus-within:ring-2 focus-within:ring-ring">
                <Search aria-hidden className="h-3.5 w-3.5 shrink-0" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="搜索标题、内容、来源…"
                  aria-label="搜索反馈"
                  data-testid="admin-feedback-search"
                  className="min-w-0 flex-1 bg-transparent text-12 text-card-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-0"
                />
              </label>
            </div>

            {actionError !== null && (
              <p className="px-6 pb-2 text-12 text-destructive" data-testid="admin-feedback-action-error">
                操作没有生效（{actionError}）。状态未变更。
              </p>
            )}

            {load.kind === "loading" && (
              <p className="px-6 py-4 text-12 text-muted-foreground" data-testid="admin-feedback-loading">正在读取反馈…</p>
            )}

            {load.kind === "failed" && (
              <div className="flex flex-col items-start gap-2 px-6 py-4" data-testid="admin-feedback-failed">
                <p className="text-12 text-muted-foreground">
                  没能读到反馈（{load.reason}）。这不是「没有反馈」——数据没有丢，只是这次没取到。
                </p>
                <Button size="sm" variant="outline" onClick={() => void reload()}>重试</Button>
              </div>
            )}

            {load.kind === "ready" && (
              <div className="grid min-h-[560px] grid-cols-1 border-t border-border lg:grid-cols-[minmax(0,1fr)_460px]" data-testid={`admin-feedback-pane-${tab}`}>
                {/* 左：列表 */}
                <FeedbackTable
                  kind={tab}
                  items={visible}
                  displayIds={displayIds}
                  names={names}
                  selectedId={selected?.id ?? null}
                  busyId={busyId}
                  onSelect={setSelectedId}
                  onVote={(f) => void act(() => voteFeedback(f.id, !f.votedByMe), f.id)}
                />
                {/* 右：详情 */}
                <aside className="border-t border-border lg:border-l lg:border-t-0" data-testid="admin-feedback-detail-pane">
                  {selected === null ? (
                    <p className="p-6 text-12 text-muted-foreground" data-testid="admin-feedback-detail-empty">
                      {ofTab.length === 0 ? "这一类还没有反馈。" : "从左侧选一条反馈查看详情。"}
                    </p>
                  ) : (
                    <FeedbackDetailPanel
                      key={selected.id}
                      item={selected}
                      displayId={displayIds.get(selected.id) ?? selected.id}
                      names={names}
                      busy={busyId === selected.id}
                      onTriage={(next, reason, issueDraft) =>
                        void act(() => triageFeedback(selected.id, next, reason, issueDraft ?? null), selected.id)
                      }
                    />
                  )}
                </aside>
              </div>
            )}
          </>
        )}
      </div>
    </AdminScreen>
  );
}

const SOURCE_FILTER_OPTIONS: readonly { readonly value: SourceFilter; readonly label: string }[] = [
  { value: "all", label: "全部来源" },
  { value: "product", label: "产品" },
  { value: "agent", label: "Agent" },
  { value: "skill", label: "Skill" },
];

function TabButton({
  active, onClick, count, testid, children,
}: {
  active: boolean;
  onClick: () => void;
  count: number | null;
  testid: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      data-testid={testid}
      className={cn(
        "-mb-px inline-flex items-center gap-2 border-b-2 px-1 pb-2.5 pt-1 text-14 transition-colors duration-fast",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        active ? "border-primary font-semibold text-card-foreground" : "border-transparent text-muted-foreground hover:text-card-foreground",
      )}
    >
      {children}
      {count !== null && (
        <span className={cn("rounded-full px-1.5 py-0.5 text-10 font-medium", active ? "bg-muted text-card-foreground" : "bg-muted text-muted-foreground")}>
          {count}
        </span>
      )}
    </button>
  );
}

function StatusChip({
  active, onClick, count, testid, children,
}: {
  active: boolean;
  onClick: () => void;
  count: number;
  testid: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      data-testid={testid}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-12 transition-colors duration-fast",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        active ? "bg-card font-medium text-card-foreground shadow-sm" : "text-muted-foreground hover:text-card-foreground",
      )}
    >
      {children}
      <span className={cn("text-10", active ? "text-muted-foreground" : "text-muted-foreground/70")}>{count}</span>
    </button>
  );
}

function FeedbackTable({
  kind, items, displayIds, names, selectedId, busyId, onSelect, onVote,
}: {
  kind: FeedbackKind;
  items: readonly FeedbackItem[];
  displayIds: ReadonlyMap<string, string>;
  names: TargetNames;
  selectedId: string | null;
  busyId: string | null;
  onSelect: (id: string) => void;
  onVote: (item: FeedbackItem) => void;
}) {
  return (
    <div className="min-w-0" data-testid={`admin-feedback-list-${kind}`}>
      <table className="w-full table-fixed border-collapse text-12">
        <thead>
          <tr className="text-11 text-muted-foreground">
            <th className="w-24 px-4 py-2.5 text-left font-normal">状态</th>
            <th className="px-3 py-2.5 text-left font-normal">标题</th>
            <th className="w-32 px-3 py-2.5 text-left font-normal">来源</th>
            <th className="w-14 px-3 py-2.5 text-right font-normal">赞同</th>
            <th className="w-28 px-4 py-2.5 text-right font-normal">提交时间</th>
          </tr>
        </thead>
        <tbody>
          {items.length === 0 ? (
            <tr>
              <td colSpan={5} className="px-6 py-8 text-center text-12 text-muted-foreground" data-testid={`admin-feedback-list-${kind}-empty`}>
                这个筛选下没有反馈。
              </td>
            </tr>
          ) : (
            items.map((item) => {
              const src = sourceOf(item, names);
              const selected = item.id === selectedId;
              return (
                <tr
                  key={item.id}
                  role="button"
                  tabIndex={0}
                  aria-current={selected ? "true" : undefined}
                  data-selected={selected}
                  onClick={() => onSelect(item.id)}
                  onKeyDown={(e) => {
                    if (e.key !== "Enter" && e.key !== " ") return;
                    e.preventDefault();
                    onSelect(item.id);
                  }}
                  data-testid={`admin-feedback-item-${item.id}`}
                  className={cn(
                    "cursor-pointer border-t border-border-subtle align-top transition-colors duration-fast",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                    selected ? "bg-accent/40" : "hover:bg-muted/50",
                  )}
                >
                  <td className="px-4 py-3.5">
                    <Badge tone={STATUS_TONE[item.status]} className="whitespace-nowrap" data-testid={`admin-feedback-status-${item.id}`}>
                      {STATUS_LABEL[kind][item.status]}
                    </Badge>
                  </td>
                  <td className="min-w-0 max-w-0 px-3 py-3">
                    <div className="flex min-w-0 items-baseline gap-2">
                      <span className="shrink-0 font-mono text-11 text-muted-foreground">{displayIds.get(item.id) ?? item.id}</span>
                      <span className="min-w-0 truncate text-13 font-semibold text-card-foreground">{item.title}</span>
                    </div>
                    <p className="mt-0.5 truncate text-11 text-muted-foreground">
                      {item.submitterName ?? "匿名用户"} · {item.detail ?? item.title}
                    </p>
                  </td>
                  <td className="max-w-0 px-3 py-3">
                    <div className="truncate text-12 text-card-foreground">
                      {src.kindLabel}{src.name !== null ? ` · ${src.name}` : src.id !== null ? ` · ${src.id}` : ""}
                    </div>
                    {src.id !== null && src.name !== null && (
                      <div className="mt-0.5 truncate font-mono text-10 text-muted-foreground">{src.id}</div>
                    )}
                  </td>
                  <td className="px-3 py-3 text-right">
                    <button
                      type="button"
                      aria-pressed={item.votedByMe}
                      aria-label={item.votedByMe ? "取消赞同" : "赞同"}
                      disabled={busyId === item.id}
                      onClick={(e) => { e.stopPropagation(); onVote(item); }}
                      data-testid={`admin-feedback-vote-${item.id}`}
                      className={cn(
                        "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-12 tabular-nums transition-colors duration-fast hover:bg-muted",
                        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        item.votedByMe ? "text-primary" : "text-card-foreground",
                      )}
                    >
                      {item.votes === 0 ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        <>
                          <span aria-hidden className={cn("text-10", item.votes >= 10 ? "text-destructive" : "text-muted-foreground")}>▲</span>
                          <span className={cn(item.votes >= 10 && "font-semibold")}>{item.votes}</span>
                        </>
                      )}
                    </button>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3.5 text-right text-12 text-muted-foreground tabular-nums">
                    {formatTime(item.createdAt)}
                  </td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}

/**
 * 右侧详情：元信息 / 正文 / 附件 / 分诊动作 / GitHub 区块 / 动态（状态流水 + 邮件通知历史）。
 * 以 `key={item.id}` 挂载，换一条反馈就是一次干净的重挂载——输入中的「不做」理由、
 * 展开的 issue 草稿不会串到另一条上。
 */
function FeedbackDetailPanel({
  item, displayId, names, busy, onTriage,
}: {
  item: FeedbackItem;
  displayId: string;
  names: TargetNames;
  busy: boolean;
  onTriage: (next: FeedbackStatus, reason: string | null, issueDraft?: FeedbackIssueDraft | null) => void;
}) {
  const [decliningReason, setDecliningReason] = React.useState<string | null>(null);
  const [issueDraft, setIssueDraft] = React.useState<FeedbackIssueDraft | null>(null);
  const [labelsText, setLabelsText] = React.useState("");
  const src = sourceOf(item, names);
  const forward = FORWARD_ACTION[item.kind][item.status] ?? null;
  const canDecline = NEXT_STATUSES[item.status].includes("不做");
  const canReopen = item.status !== "待处理" && NEXT_STATUSES[item.status].includes("待处理");

  return (
    <div className="flex flex-col gap-5 p-6" role="region" aria-label="反馈详情" data-testid={`admin-feedback-detail-${item.id}`}>
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-12 text-muted-foreground">{displayId}</span>
          <Badge tone={STATUS_TONE[item.status]}>{STATUS_LABEL[item.kind][item.status]}</Badge>
        </div>
        <h2 className="text-18 font-semibold leading-snug text-card-foreground">{item.title}</h2>
      </div>

      <dl className="grid grid-cols-[4.5rem_minmax(0,1fr)] gap-x-4 gap-y-2 text-13">
        <dt className="text-muted-foreground">来源</dt>
        <dd className="text-card-foreground">{src.kindLabel}{src.name !== null ? ` · ${src.name}` : src.id !== null && src.name === null ? ` · ${src.id}` : ""}</dd>
        {src.id !== null && src.name !== null && (
          <>
            <dt className="text-muted-foreground">ID</dt>
            <dd className="truncate font-mono text-12 text-card-foreground">{src.id}</dd>
          </>
        )}
        <dt className="text-muted-foreground">提交人</dt>
        <dd className="text-card-foreground">{item.submitterName ?? "匿名用户"}{item.submittedByMe ? "（我）" : ""}</dd>
        <dt className="text-muted-foreground">时间</dt>
        <dd className="text-card-foreground tabular-nums">{formatTime(item.createdAt)}</dd>
        <dt className="text-muted-foreground">赞同</dt>
        <dd className="text-card-foreground tabular-nums">{item.votes}</dd>
        {item.occurredRoute !== null && (
          <>
            <dt className="text-muted-foreground">页面</dt>
            <dd className="truncate font-mono text-12 text-card-foreground">{item.occurredRoute}</dd>
          </>
        )}
        {item.appVersion !== null && (
          <>
            <dt className="text-muted-foreground">版本</dt>
            <dd className="text-card-foreground">{item.appVersion}</dd>
          </>
        )}
      </dl>

      {/* D3：正文只有管理员与提交人看得到。`detail === null` 恒等于「无权」，不等于「正文为空」。 */}
      <div className="rounded-lg border border-border bg-card p-4 text-13 leading-relaxed text-card-foreground">
        {item.detail === null ? (
          <p className="italic text-muted-foreground" data-testid={`admin-feedback-detail-withheld-${item.id}`}>
            正文仅组织管理员与提交人可见。
          </p>
        ) : (
          <p className="whitespace-pre-wrap">{item.detail}</p>
        )}
        {item.attachments.length > 0 && (
          <ul className="mt-3 flex flex-wrap gap-2" data-testid={`admin-feedback-attachments-${item.id}`}>
            {item.attachments.map((a) => (
              <li key={a.id}><AttachmentThumbnail url={a.url} /></li>
            ))}
          </ul>
        )}
      </div>

      {item.statusReason !== null && (
        <p className="text-12 text-card-foreground" data-testid={`admin-feedback-reason-${item.id}`}>
          处理说明：{item.statusReason}
        </p>
      )}

      {issueDraft !== null ? (
        <div className="flex flex-col gap-1.5 rounded-md border border-border-subtle bg-panel p-3" data-testid={`admin-feedback-issue-${item.id}`}>
          <p className="text-11 font-medium text-muted-foreground">
            {forward?.label ?? "进入迭代"}会在 boardx/workspacex 建一个 GitHub issue,提交前可以编辑:
          </p>
          <label className="flex flex-col gap-1">
            <span className="text-10 text-muted-foreground">标题</span>
            <input
              value={issueDraft.title}
              onChange={(e) => setIssueDraft({ ...issueDraft, title: e.target.value })}
              data-testid={`admin-feedback-issue-title-${item.id}`}
              className="h-7 rounded border border-border-subtle bg-card px-2 text-12"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-10 text-muted-foreground">正文</span>
            <textarea
              value={issueDraft.body}
              onChange={(e) => setIssueDraft({ ...issueDraft, body: e.target.value })}
              rows={5}
              data-testid={`admin-feedback-issue-body-${item.id}`}
              className="resize-y rounded border border-border-subtle bg-card p-2 text-12"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-10 text-muted-foreground">标签(逗号分隔)</span>
            <input
              value={labelsText}
              onChange={(e) => {
                setLabelsText(e.target.value);
                setIssueDraft({
                  ...issueDraft,
                  labels: e.target.value.split(",").map((l) => l.trim()).filter((l) => l !== ""),
                });
              }}
              data-testid={`admin-feedback-issue-labels-${item.id}`}
              className="h-7 rounded border border-border-subtle bg-card px-2 font-mono text-12"
            />
          </label>
          <div className="flex justify-end gap-1.5">
            <Button size="sm" variant="ghost" onClick={() => { setIssueDraft(null); setLabelsText(""); }}>取消</Button>
            <Button
              size="sm"
              variant="primary"
              disabled={busy || issueDraft.title.trim() === ""}
              onClick={() => onTriage(ISSUE_DRAFT_STATUS, null, issueDraft)}
              data-testid={`admin-feedback-issue-submit-${item.id}`}
            >
              {busy && <Loader2 aria-hidden className="h-3 w-3 animate-spin" />}
              确认{forward?.label ?? "进入迭代"},创建 issue
            </Button>
          </div>
        </div>
      ) : decliningReason !== null ? (
        <div className="flex flex-col gap-2 rounded-md border border-border-subtle bg-panel p-3" data-testid={`admin-feedback-decline-${item.id}`}>
          <input
            value={decliningReason}
            onChange={(e) => setDecliningReason(e.target.value)}
            placeholder="为什么不做？（必填，提交人会看到这句话）"
            aria-label="不做的理由"
            data-testid={`admin-feedback-decline-reason-${item.id}`}
            className="h-8 min-w-0 rounded border border-border-subtle bg-card px-2 text-12"
          />
          <div className="flex justify-end gap-1.5">
            <Button size="sm" variant="ghost" onClick={() => setDecliningReason(null)}>取消</Button>
            <Button
              size="sm"
              variant="primary"
              disabled={busy || decliningReason.trim() === ""}
              onClick={() => onTriage("不做", decliningReason.trim())}
              data-testid={`admin-feedback-decline-submit-${item.id}`}
            >
              确认不做
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {forward !== null && (
            <Button
              variant="primary"
              disabled={busy}
              onClick={() => {
                if (forward.next === ISSUE_DRAFT_STATUS) {
                  const draft = defaultIssueDraft(item);
                  setIssueDraft(draft);
                  setLabelsText(draft.labels.join(", "));
                  return;
                }
                onTriage(forward.next, null);
              }}
              data-testid={`admin-feedback-to-${forward.next}-${item.id}`}
            >
              {busy && <Loader2 aria-hidden className="h-3 w-3 animate-spin" />}
              {forward.label}
            </Button>
          )}
          {canDecline && (
            <Button variant="outline" disabled={busy} onClick={() => setDecliningReason("")} data-testid={`admin-feedback-to-不做-${item.id}`}>
              不做…
            </Button>
          )}
          {canReopen && (
            <Button variant="ghost" disabled={busy} onClick={() => onTriage("待处理", null)} data-testid={`admin-feedback-to-待处理-${item.id}`}>
              退回{STATUS_LABEL[item.kind].待处理}
            </Button>
          )}
        </div>
      )}

      {item.githubIssueUrl !== null && (
        <GithubIssuePanel feedbackId={item.id} url={item.githubIssueUrl} number={item.githubIssueNumber} />
      )}

      <FeedbackTimeline item={item} />
    </div>
  );
}

/** 「我提过的」/后台详情共用的做法：下载路由要 `Authorization` 头，`<img src>` 带不了，先 fetch 再转 Blob URL。 */
function AttachmentThumbnail({ url }: { url: string }) {
  const [objectUrl, setObjectUrl] = React.useState<string | null>(null);
  const [failed, setFailed] = React.useState(false);
  React.useEffect(() => {
    let cancelled = false;
    let created: string | null = null;
    fetchFeedbackAttachmentObjectUrl(url)
      .then((u) => {
        if (cancelled) { URL.revokeObjectURL(u); return; }
        created = u;
        setObjectUrl(u);
      })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => {
      cancelled = true;
      if (created !== null) URL.revokeObjectURL(created);
    };
  }, [url]);
  if (failed) return <div className="flex h-16 w-16 items-center justify-center rounded-md border border-border-subtle text-10 text-muted-foreground">?</div>;
  if (objectUrl === null) return <div className="h-16 w-16 animate-pulse rounded-md bg-muted" aria-hidden />;
  // eslint-disable-next-line @next/next/no-img-element -- blob URL，不是可优化的远程图
  return <img src={objectUrl} alt="" className="h-16 w-16 rounded-md border border-border-subtle object-cover" />;
}

type FeedbackEventsLoad =
  | { kind: "loading" }
  | { kind: "ready"; events: readonly FeedbackStatusEvent[] }
  | { kind: "failed"; reason: string };

/**
 * 「动态」——一条反馈完整的状态流水,含每一步有没有真的发邮件通知提交人、发的是什么
 * (见契约 `listFeedbackStatusEvents` 头注)。选中这条反馈时才拉。
 *
 * ⚠ `notified: false` 时不渲染邮件文案区块——不是「没发」还配一句「本来想发的文案」。
 */
function FeedbackTimeline({ item }: { item: FeedbackItem }) {
  const [load, setLoad] = React.useState<FeedbackEventsLoad>({ kind: "loading" });

  React.useEffect(() => {
    let cancelled = false;
    setLoad({ kind: "loading" });
    listFeedbackStatusEvents(item.id)
      .then((events) => { if (!cancelled) setLoad({ kind: "ready", events }); })
      .catch((err) => { if (!cancelled) setLoad({ kind: "failed", reason: describeFailure(err) }); });
    return () => { cancelled = true; };
    // 状态一变（分诊成功后 reload），流水要跟着重拉。
  }, [item.id, item.status]);

  const eventText = (e: FeedbackStatusEvent): string => {
    if (e.fromStatus === null) return item.kind === "需求" ? "用户提交需求" : "用户提交反馈";
    return `状态改为「${STATUS_LABEL[item.kind][e.toStatus]}」`;
  };

  return (
    <section className="flex flex-col gap-2" data-testid={`admin-feedback-events-${item.id}`}>
      <h3 className="text-12 text-muted-foreground">动态</h3>

      {load.kind === "loading" && (
        <p className="text-11 text-muted-foreground" data-testid={`admin-feedback-events-loading-${item.id}`}>正在读取…</p>
      )}
      {load.kind === "failed" && (
        <p className="text-11 text-destructive" data-testid={`admin-feedback-events-failed-${item.id}`}>动态取不到（{load.reason}）。</p>
      )}
      {load.kind === "ready" && (
        load.events.length === 0 ? (
          <p className="text-11 text-muted-foreground" data-testid={`admin-feedback-events-empty-${item.id}`}>还没有状态变更记录。</p>
        ) : (
          <ol className="flex flex-col gap-3" data-testid={`admin-feedback-events-list-${item.id}`}>
            {[...load.events].sort((a, b) => a.createdAt.localeCompare(b.createdAt)).map((e) => (
              <li key={e.id} className="flex gap-2.5" data-testid={`admin-feedback-event-${e.id}`}>
                <span aria-hidden className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-muted-foreground/50" />
                <div className="flex min-w-0 flex-col gap-0.5">
                  <span className="text-13 text-card-foreground">{eventText(e)}</span>
                  {e.reason !== null && <span className="text-12 text-muted-foreground">理由：{e.reason}</span>}
                  <span className="text-11 text-muted-foreground tabular-nums">{formatTime(e.createdAt)}</span>
                  {e.notified ? (
                    <div className="mt-1 flex flex-col gap-0.5 rounded border border-border-subtle bg-panel p-2" data-testid={`admin-feedback-event-email-${e.id}`}>
                      <span className="text-10 font-medium text-muted-foreground">已邮件通知提交人</span>
                      {e.emailSubject !== null && <p className="text-11 font-medium">{e.emailSubject}</p>}
                      {e.emailText !== null && <p className="whitespace-pre-wrap text-11 text-muted-foreground">{e.emailText}</p>}
                    </div>
                  ) : e.fromStatus !== null ? (
                    <span className="text-10 text-muted-foreground" data-testid={`admin-feedback-event-not-notified-${e.id}`}>未发送邮件通知</span>
                  ) : null}
                </div>
              </li>
            ))}
          </ol>
        )
      )}
    </section>
  );
}

/**
 * 系统异常标签页——前后端未处理异常写入 `error_logs`，这里读 `GET /system/error-logs`。
 *
 * ⚠ 这条接口只对**平台超管**放行（见契约文件头：`error_logs` 没有 `org_id`）。
 *   403 `NOT_PLATFORM_SUPERUSER` **不是**失败态——它是"你不是这个身份"的正常结果，
 *   渲染成一句说明而不是重试按钮。
 */
function SystemExceptionsSection({ load, onReload }: { load: SystemLoad; onReload: () => void }) {
  return (
    <section className="flex flex-col gap-2 px-6 py-4" data-testid="admin-feedback-system-errors">
      {/* 只对拿得到异常列表的人（平台超管）出这块——发信路由也是同一道超管门。 */}
      {load.kind !== "forbidden" && <TestMailPanel />}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-12 text-muted-foreground">前后端自动捕获的未处理异常。</p>
        {load.kind === "ready" && (
          <Button size="sm" variant="outline" onClick={onReload}>刷新</Button>
        )}
      </div>

      {load.kind === "loading" && (
        <p className="text-12 text-muted-foreground" data-testid="admin-feedback-system-errors-loading">正在读取系统异常…</p>
      )}
      {load.kind === "forbidden" && (
        <p className="text-12 text-muted-foreground" data-testid="admin-feedback-system-errors-forbidden">
          这块区域仅平台运维（平台超管白名单）可见——你当前的账号看不到系统异常的详情，这不是数据缺失。
        </p>
      )}
      {load.kind === "failed" && (
        <div className="flex flex-col items-start gap-2" data-testid="admin-feedback-system-errors-failed">
          <p className="text-12 text-muted-foreground">
            没能读到系统异常（{load.reason}）。这不是「没有异常」——数据没有丢，只是这次没取到。
          </p>
          <Button size="sm" variant="outline" onClick={onReload}>重试</Button>
        </div>
      )}
      {load.kind === "ready" && (
        load.items.length === 0 ? (
          <p className="text-12 text-muted-foreground" data-testid="admin-feedback-system-errors-empty">还没有捕获到系统异常。</p>
        ) : (
          <div className="flex flex-col divide-y divide-border-subtle rounded-lg border border-border" data-testid="admin-feedback-system-errors-list">
            {load.items.map((item) => (
              <SystemErrorRow key={item.id} item={item} />
            ))}
            {load.hasMore && (
              <p className="px-4 py-2 text-11 text-muted-foreground">还有更早的记录（本页只显示最新 {load.items.length} 条）。</p>
            )}
          </div>
        )
      )}
    </section>
  );
}

type TestMailState =
  | { kind: "idle" }
  | { kind: "sending" }
  | { kind: "sent"; out: SendTestEmailOut }
  | { kind: "failed"; reasonCode: string; category: string | null };

/**
 * 「测试邮件」——人类 2026-09-02 要求：后台要能验证邮件发不发得出。走的是生产同一条
 * 事务邮件通路（`POST /system/mail/test`，见契约头注），不是另一套测试通路；失败
 * 如实报契约码 + 适配器归好类的 `category`，成功报收件人与供应商回执 id。
 */
function TestMailPanel() {
  const [to, setTo] = React.useState("");
  const [state, setState] = React.useState<TestMailState>({ kind: "idle" });

  const send = async () => {
    setState({ kind: "sending" });
    try {
      const out = await sendTestEmail(to);
      setState({ kind: "sent", out });
    } catch (err) {
      const body = err instanceof ApiError ? (err.raw as { category?: unknown } | null | undefined) : null;
      setState({
        kind: "failed",
        reasonCode: describeFailure(err),
        category: typeof body?.category === "string" ? body.category : null,
      });
    }
  };

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border bg-panel p-4" data-testid="admin-feedback-test-mail">
      <div className="flex flex-col gap-0.5">
        <h3 className="text-13 font-semibold">测试邮件</h3>
        <p className="text-11 text-muted-foreground">
          用生产同一条事务邮件通路发一封测试邮件——反馈确认 / 状态变更邮件都是 best-effort、失败只记日志，这里把结果直接摆出来。
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={to}
          onChange={(e) => { setTo(e.target.value); if (state.kind !== "sending") setState({ kind: "idle" }); }}
          placeholder="收件人邮箱（留空 = 发给当前账号）"
          aria-label="测试邮件收件人"
          type="email"
          data-testid="admin-feedback-test-mail-to"
          className="h-8 w-80 max-w-full rounded-md border border-border-subtle bg-card px-2.5 text-12 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <Button size="sm" variant="primary" disabled={state.kind === "sending"} onClick={() => void send()} data-testid="admin-feedback-test-mail-send">
          {state.kind === "sending" && <Loader2 aria-hidden className="h-3 w-3 animate-spin" />}
          发送测试邮件
        </Button>
      </div>
      {state.kind === "sent" && (
        <p className="text-12 text-card-foreground" data-testid="admin-feedback-test-mail-sent">
          已发送到 <span className="font-medium">{state.out.sentTo}</span>（{formatTime(state.out.sentAt)}）
          {state.out.providerMessageId !== null && (
            <span className="text-muted-foreground"> · 供应商回执 <code className="font-mono text-11">{state.out.providerMessageId}</code></span>
          )}
          。请到收件箱确认——主题「{state.out.subject}」。
        </p>
      )}
      {state.kind === "failed" && (
        <p className="text-12 text-destructive" data-testid="admin-feedback-test-mail-failed">
          {state.reasonCode === "MAIL_NOT_CONFIGURED"
            ? "这个部署没有配置事务邮件（缺 CLOUDFLARE_ACCOUNT_ID / CLOUDFLARE_TXN_EMAIL_API_TOKEN / MAIL_FROM 之一）。"
            : state.reasonCode === "NO_RECIPIENT"
              ? "没有收件人：当前账号查不到邮箱，请填一个收件人。"
              : `没发出去（${state.reasonCode}${state.category !== null ? ` · ${state.category}` : ""}）。`}
        </p>
      )}
    </div>
  );
}

function SystemErrorRow({ item }: { item: SystemErrorLogItem }) {
  const [expanded, setExpanded] = React.useState(false);
  return (
    <div className="flex flex-col gap-1.5 px-4 py-2.5" data-testid={`admin-feedback-system-error-${item.id}`}>
      <button
        type="button"
        className="flex flex-wrap items-center gap-x-3 gap-y-1 text-left"
        onClick={() => setExpanded((v) => !v)}
        data-testid={`admin-feedback-system-error-toggle-${item.id}`}
      >
        <span className="min-w-0 flex-1 truncate text-12 font-medium">{item.msg}</span>
        <code className="font-mono text-10 text-muted-foreground">{item.traceId}</code>
        <span className="text-11 text-muted-foreground tabular-nums">{formatTime(item.createdAt)}</span>
      </button>
      {expanded && (
        <pre
          className="max-h-64 overflow-auto whitespace-pre-wrap rounded-md border border-border-subtle bg-panel p-2 text-11 text-muted-foreground"
          data-testid={`admin-feedback-system-error-detail-${item.id}`}
        >
          {JSON.stringify(item.detail, null, 2)}
        </pre>
      )}
    </div>
  );
}

type GithubPanel =
  | { kind: "collapsed" }
  | { kind: "loading" }
  | { kind: "ready"; status: FeedbackGithubIssueStatus }
  | { kind: "failed"; reason: string };

/**
 * 这条反馈挂着的 GitHub issue——链接恒展示（不用现查也能给），开关状态/关联 PR
 * 折叠、点开才现查（见文件头「不落库」）。评论框独立于查状态，随时可提交。
 */
function GithubIssuePanel({
  feedbackId, url, number,
}: {
  feedbackId: string;
  url: string;
  number: number | null;
}) {
  const [panel, setPanel] = React.useState<GithubPanel>({ kind: "collapsed" });
  const [commentText, setCommentText] = React.useState("");
  const [commentState, setCommentState] = React.useState<
    { kind: "idle" } | { kind: "sending" } | { kind: "sent" } | { kind: "failed"; reason: string }
  >({ kind: "idle" });

  const load = async () => {
    setPanel({ kind: "loading" });
    try {
      const status = await getFeedbackGithubIssue(feedbackId);
      setPanel({ kind: "ready", status });
    } catch (err) {
      setPanel({ kind: "failed", reason: describeFailure(err) });
    }
  };

  const submitComment = async () => {
    if (commentText.trim() === "") return;
    setCommentState({ kind: "sending" });
    try {
      await commentOnFeedbackGithubIssue(feedbackId, commentText);
      setCommentText("");
      setCommentState({ kind: "sent" });
    } catch (err) {
      setCommentState({ kind: "failed", reason: describeFailure(err) });
    }
  };

  return (
    <div className="flex flex-col gap-1.5 rounded-md border border-border-subtle bg-panel p-3" data-testid={`admin-feedback-github-${feedbackId}`}>
      <div className="flex flex-wrap items-center gap-2 text-12">
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 font-medium text-primary transition-colors duration-fast hover:underline"
          data-testid={`admin-feedback-github-link-${feedbackId}`}
        >
          <ExternalLink aria-hidden className="h-3 w-3" />
          GitHub Issue{number !== null ? ` #${number}` : ""}
        </a>
        {panel.kind === "ready" && (
          <Badge tone={panel.status.state === "open" ? "primary" : "neutral"}>
            {panel.status.state === "open" ? "open" : panel.status.stateReason ?? "closed"}
          </Badge>
        )}
        <Button size="xs" variant="ghost" onClick={() => void load()} disabled={panel.kind === "loading"} data-testid={`admin-feedback-github-refresh-${feedbackId}`}>
          {panel.kind === "loading" ? <Loader2 aria-hidden className="h-3 w-3 animate-spin" /> : <RefreshCw aria-hidden className="h-3 w-3" />}
          查看 GitHub 状态
        </Button>
      </div>

      {panel.kind === "failed" && (
        <p className="text-10 text-destructive" data-testid={`admin-feedback-github-error-${feedbackId}`}>GitHub 状态取不到（{panel.reason}）。</p>
      )}

      {panel.kind === "ready" && (
        <div className="flex flex-col gap-1" data-testid={`admin-feedback-github-status-${feedbackId}`}>
          {/* ⚠ `linkedPullRequestsAvailable === false` 不等于「没有 PR」——取不到就说取不到。 */}
          {!panel.status.linkedPullRequestsAvailable ? (
            <p className="text-10 text-muted-foreground" data-testid={`admin-feedback-github-prs-unavailable-${feedbackId}`}>
              关联 PR 暂时取不到（GitHub 侧限流或超时）——不代表没有 PR，稍后再点「查看 GitHub 状态」重试。
            </p>
          ) : panel.status.linkedPullRequests.length === 0 ? (
            <p className="text-10 text-muted-foreground">还没有 PR 引用这个 issue。</p>
          ) : (
            <ul className="flex flex-col gap-0.5">
              {panel.status.linkedPullRequests.map((pr) => (
                <li key={pr.number} className="flex items-center gap-1.5 text-10">
                  <GitPullRequest aria-hidden className="h-3 w-3 shrink-0" />
                  <a href={pr.url} target="_blank" rel="noreferrer" className="text-primary transition-colors duration-fast hover:underline">
                    #{pr.number} {pr.title}
                  </a>
                  <Badge tone={pr.state === "merged" ? "ai" : pr.state === "open" ? "primary" : "neutral"}>{pr.state}</Badge>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-1.5">
        <input
          value={commentText}
          onChange={(e) => { setCommentText(e.target.value); setCommentState({ kind: "idle" }); }}
          placeholder="给这个 issue 补充一条评论…"
          aria-label="GitHub 评论正文"
          data-testid={`admin-feedback-github-comment-input-${feedbackId}`}
          className="h-7 min-w-0 flex-1 rounded border border-border-subtle bg-card px-2 text-12"
        />
        <Button size="xs" variant="outline" disabled={commentState.kind === "sending" || commentText.trim() === ""} onClick={() => void submitComment()} data-testid={`admin-feedback-github-comment-submit-${feedbackId}`}>
          {commentState.kind === "sending" && <Loader2 aria-hidden className="h-3 w-3 animate-spin" />}
          发评论
        </Button>
        {commentState.kind === "sent" && (
          <span className="text-10 text-muted-foreground" data-testid={`admin-feedback-github-comment-sent-${feedbackId}`}>已发送</span>
        )}
        {commentState.kind === "failed" && (
          <span className="text-10 text-destructive" data-testid={`admin-feedback-github-comment-error-${feedbackId}`}>没发出去（{commentState.reason}）</span>
        )}
      </div>
    </div>
  );
}
