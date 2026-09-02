"use client";
import * as React from "react";
import {
  ThumbsUp, Bug, Lightbulb, Loader2, Bot, Puzzle, AppWindow, ExternalLink, GitPullRequest, RefreshCw,
} from "lucide-react";
import { AdminScreen } from "./admin-screen";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ViewModeToggle, type EntityViewMode } from "./view-mode-toggle";
import { ApiError } from "@/lib/api-client";
import {
  commentOnFeedbackGithubIssue,
  getFeedbackCounts,
  getFeedbackGithubIssue,
  listFeedback,
  triageFeedback,
  voteFeedback,
  type FeedbackCounts,
  type FeedbackGithubIssueStatus,
  type FeedbackIssueDraft,
  type FeedbackItem,
  type FeedbackKind,
  type FeedbackStatus,
} from "@/lib/live-feedback";
import { listSystemErrorLogs, type SystemErrorLogItem } from "@/lib/live-system-errors";
import type { UiState } from "@/lib/ui-state";

/**
 * FB-3 —— 后台「反馈与迭代」的**真栈**屏。**一块看板,按状态分列**。
 *
 * ## 这块屏经历过的两次改法
 *
 * ① 178 行全 mock,三个静态常量,每个按钮点了什么都不会发生。
 * ② FB-3 真栈化:接上 `GET /feedback`,但仍按「产品 / Agent·Skill」分两列——
 *    这与「一条反馈的状态该往哪走」是两件不相关的事,分列方式选错了维度。
 *
 * ## 2026-09-02(人类看真实后台截图后直接裁决)三件事一起改
 *
 *   · **合并成一个列表**,产品 / Agent / Skill 不再是分列依据,改成筛选条件——
 *     「这条反馈是关于什么的」是一个可以叠加/清除的过滤器,不该决定它出现在哪一列。
 *   · **改成按状态分列的看板**:待处理 / 已进入迭代 / 已修复 / 不做,四列。
 *     ⚠ 人类原话给的是 backlog/todo/doing/done/archive 五态,这里**收敛成四态**
 *       ——不是打折扣,是不新增一个游离于 `domain/feedback/product-feedback.ts`
 *       状态机之外的"todo"。这个反馈流程里从没有"排了优先级但还没人认领"与
 *       "还没排"的区分需求(待处理就是待处理),新增一个只装样子的状态比没有更糟
 *       (同本文件「删掉的两个按钮」那条纪律)。四态与既有状态机、DB 约束、
 *       GitHub issue 开关同步(`triage-feedback.ts` ③)完全对齐,不触碰契约/DB/
 *       状态机——那些改动的代价与这次 UI 重排不成比例。
 *     ⚠ **没有拖拽**:卡片从一列挪到另一列,仍然是点"转「X」"按钮(状态机的边),
 *       不是拖拽改状态。看板≠拖拽——四列本身已经是"看板"最核心的表达(按状态
 *       分泳道),拖拽只是一种交互手法,这次没有把它当成必需项。
 *   · **不是「组织」的东西**:见 `admin-header.tsx` 的 `hideOrgIdentity`——本屏
 *     处理的是运营动作,不该在页头挂一张「组织:boardx」的身份卡,导航入口也
 *     挪出了「组织」分组(`lib/mock/admin.ts` 的「运营」组)。
 *
 * ## GitHub issue 状态/评论(见 `apps/api/.../triage-feedback.ts` 头注①②③)
 *
 * 卡片上出现的 GitHub 区块只在这条反馈已经建过 issue(`githubIssueUrl !== null`)
 * 时渲染。开关状态与关联 PR **现查、不落库**(见契约 `getFeedbackGithubIssue`
 * 头注),因此默认折叠、管理员点「查看 GitHub 状态」才发请求——不随看板一起
 * 批量拉,避免刷新一次页面就对 GitHub API 发 N 个请求。
 */

const STATUS_TONE: Record<FeedbackStatus, "warning" | "ai" | "primary" | "neutral"> = {
  待处理: "warning",
  已进入迭代: "ai",
  已修复: "primary",
  不做: "neutral",
};

/**
 * 看板列的顺序与英文注脚——**纯展示**,不是第二份状态枚举。顺序/文案变了不影响
 * 任何逻辑;真正的状态集合仍然只在契约 `FeedbackStatus` 里声明一遍。
 */
const BOARD_COLUMNS: readonly { readonly status: FeedbackStatus; readonly caption: string }[] = [
  { status: "待处理", caption: "Backlog" },
  { status: "已进入迭代", caption: "Doing" },
  { status: "已修复", caption: "Done" },
  { status: "不做", caption: "Archived" },
];

/**
 * 分诊按钮 = **状态机的边**（`domain/feedback/product-feedback.ts` 的 `ALLOWED_TRANSITIONS`）。
 *
 * ⚠ 这里是那张表的**第二份副本**，而这是本仓明令禁止的形状——所以它必须有一条
 *   机械对账：`tests/ui/admin-feedback-transitions-match-domain.test.ts` 把这张表与
 *   domain 那张逐条比对，对不上就红。没有那条测试的话，某天 domain 加一条边而界面
 *   不出按钮，表现是「这个操作做不了」，没有任何东西会报。
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
 * 其余转移(→已修复/待处理,以及已有的→不做)维持原样,只是现在服务端会额外
 * 尽力发一封状态变更邮件、并在这条反馈已经有 issue 时尽力同步它的开关——
 * 那都是纯后端副作用,前端不需要为它多做任何事。
 */
const ISSUE_DRAFT_STATUS: FeedbackStatus = "已进入迭代";

/**
 * GitHub issue 标签的**默认值**,不是权威映射——管理员在弹层里可以随意增删。
 * ⚠ `user-feedback` 恒带,标记这条 issue 的来源;类型标签按 `FeedbackKind` 给一个
 *   常见的开源仓库习惯(缺陷→bug,需求→enhancement)。这条映射只影响预填内容,
 *   不是契约的一部分——契约只搬运管理员编辑之后的最终数组。
 */
const KIND_ISSUE_LABEL: Record<FeedbackKind, string> = { 缺陷: "bug", 需求: "enhancement" };

function defaultIssueDraft(item: FeedbackItem): FeedbackIssueDraft {
  const detail = item.detail ?? "(正文仅组织管理员与提交人可见,分诊时请补充必要的复现上下文。)";
  return {
    title: item.title,
    body: `${detail}\n\n---\n来源:后台「反馈与迭代」· 反馈 ID ${item.id}`,
    labels: ["user-feedback", KIND_ISSUE_LABEL[item.kind]],
  };
}

/** 来源筛选——"这条反馈是关于什么的"，不再是分列依据，见文件头。 */
type SourceFilter = "all" | "product" | "agent" | "skill";
type KindFilter = "all" | FeedbackKind;

function matchesSource(item: FeedbackItem, filter: SourceFilter): boolean {
  return filter === "all" || item.target.kind === filter;
}

type Load =
  | { kind: "loading" }
  | { kind: "ready"; items: readonly FeedbackItem[]; counts: FeedbackCounts | null }
  | { kind: "failed"; reason: string };

export function FeedbackScreen({ state }: { state: UiState }) {
  const [load, setLoad] = React.useState<Load>({ kind: "loading" });
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [actionError, setActionError] = React.useState<string | null>(null);
  const [kindFilter, setKindFilter] = React.useState<KindFilter>("all");
  const [sourceFilter, setSourceFilter] = React.useState<SourceFilter>("all");
  /**
   * 卡片 / 列表切换（人类 2026-08-15 原话：「卡片也可以切换为列表，需要有这个切换的功能」）。
   *
   * ⚠ **一个开关管全部四列**，不是每列一个——理由与合并前"一个开关管两列"相同：
   *   四列是同一种 entity 的四个状态分组，各自有视图态会出现某几列卡片、某几列
   *   列表这种没人想要、也没人会去对齐的状态。
   */
  const [viewMode, setViewMode] = React.useState<EntityViewMode>("card");

  const reload = React.useCallback(async () => {
    setLoad({ kind: "loading" });
    try {
      const items = await listFeedback({ kind: "org" });
      // ⚠ 计数单独取一次，失败**不连坐**整块屏：数不出来是一个可以只影响那一行的问题，
      //   而列表读不到才是这块屏不能用。所以它是 `null` 而不是让整块屏进失败态。
      const counts = await getFeedbackCounts().catch(() => null);
      setLoad({ kind: "ready", items, counts });
    } catch (err) {
      setLoad({
        kind: "failed",
        reason: err instanceof ApiError ? (err.reasonCode ?? `http_${err.status}`) : String(err),
      });
    }
  }, []);

  React.useEffect(() => {
    void reload();
  }, [reload]);

  const act = async (fn: () => Promise<unknown>, id: string) => {
    setBusyId(id);
    setActionError(null);
    try {
      await fn();
      await reload();
    } catch (err) {
      setActionError(err instanceof ApiError ? (err.reasonCode ?? `http_${err.status}`) : String(err));
    } finally {
      setBusyId(null);
    }
  };

  const items = load.kind === "ready" ? load.items : [];
  const filtered = items.filter(
    (f) => (kindFilter === "all" || f.kind === kindFilter) && matchesSource(f, sourceFilter),
  );

  return (
    <AdminScreen
      state={state}
      moduleLabel="反馈"
      title="反馈与迭代"
      liveBacked
      hideOrgIdentity
      intro="一块看板，按状态分四列：待处理 / 已进入迭代 / 已修复 / 不做。左上角可按类型、来源筛选；转「不做」必须写理由。"
      emptyHint="还没有收到反馈"
      errors={{ triage: "分诊失败：状态未变更，反馈已保留可重试" }}
      depFailure="反馈接口不可用，无法读取或分诊。"
      denialReason="分诊仅组织管理员可操作；任意成员都能提反馈、并看到标题与票数。"
      successMessage="状态已更新，并已写入这条反馈的状态流水"
    >
      <div className="flex flex-col gap-5">
        {load.kind === "loading" && (
          <p className="text-12 text-muted-foreground" data-testid="admin-feedback-loading">正在读取反馈…</p>
        )}

        {load.kind === "failed" && (
          <div className="flex flex-col items-start gap-2" data-testid="admin-feedback-failed">
            <p className="text-12 text-muted-foreground">
              没能读到反馈（{load.reason}）。这不是「没有反馈」——数据没有丢，只是这次没取到。
            </p>
            <Button size="sm" variant="outline" onClick={() => void reload()}>重试</Button>
          </div>
        )}

        {load.kind === "ready" && (
          <>
            {/* 状态分布。⚠ 四个数来自一次查询（契约 getFeedbackCounts），不是前端 filter 出来的 */}
            <section className="flex flex-col gap-2" data-testid="admin-feedback-counts">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-14 font-semibold">状态分布</h2>
                <ViewModeToggle module="feedback" mode={viewMode} onChange={setViewMode} />
              </div>
              <Card>
                <CardContent className="flex flex-wrap items-center gap-4 pt-4 text-13">
                  {load.counts === null ? (
                    <span className="text-muted-foreground" data-testid="admin-feedback-counts-unavailable">
                      计数取不到（列表仍然是真实的）。
                    </span>
                  ) : (
                    <>
                      <span><strong className="text-16 font-semibold">{load.counts.total}</strong> 条</span>
                      <span className="text-muted-foreground">待处理 {load.counts.待处理}</span>
                      <span className="text-muted-foreground">已进入迭代 {load.counts.已进入迭代}</span>
                      <span className="text-muted-foreground">已修复 {load.counts.已修复}</span>
                      <span className="text-muted-foreground">不做 {load.counts.不做}</span>
                    </>
                  )}
                </CardContent>
              </Card>
            </section>

            <FeedbackFilters
              kindFilter={kindFilter}
              onKindFilterChange={setKindFilter}
              sourceFilter={sourceFilter}
              onSourceFilterChange={setSourceFilter}
              total={items.length}
              visible={filtered.length}
            />

            {actionError !== null && (
              <p className="text-12 text-destructive" data-testid="admin-feedback-action-error">
                操作没有生效（{actionError}）。状态未变更。
              </p>
            )}

            <div
              className="grid gap-4 lg:grid-cols-4"
              data-testid="admin-feedback-kanban"
            >
              {BOARD_COLUMNS.map(({ status, caption }) => (
                <FeedbackColumn
                  key={status}
                  status={status}
                  caption={caption}
                  viewMode={viewMode}
                  items={filtered.filter((f) => f.status === status)}
                  busyId={busyId}
                  onVote={(f) => void act(() => voteFeedback(f.id, !f.votedByMe), f.id)}
                  onTriage={(f, next, reason, issueDraft) =>
                    void act(() => triageFeedback(f.id, next, reason, issueDraft ?? null), f.id)
                  }
                />
              ))}
            </div>

            {/*
              诚实登记缺口，不用 mock 顶替。见文件头「右列不是聚合建议」（合并前的说法，
              现在是"看板不是聚合建议"，缺口本身没变）。
            */}
            <p className="text-11 text-muted-foreground" data-testid="admin-feedback-aggregation-gap">
              还没有的一块：把 chat 里的 👍/👎（已落库）按结构性判据聚合成「含具体改动的改进建议」，
              以及「建议 → 改进 PR → 人工复核 → 灰度」这条链路。它需要
              <code className="mx-1 font-mono">skills.listSuggestions</code>
              的落库面，今天全仓没有实现，所以这里不展示任何聚合数字——不是数字为零，是这件事还没接地。
            </p>

            <SystemExceptionsSection />
          </>
        )}
      </div>
    </AdminScreen>
  );
}

type SystemLoad =
  | { kind: "loading" }
  | { kind: "ready"; items: readonly SystemErrorLogItem[]; hasMore: boolean }
  | { kind: "forbidden" }
  | { kind: "failed"; reason: string };

/**
 * 系统异常自动捕获的展示区——前后端未处理异常写入 `error_logs`
 * （`apps/api/src/application/ports/error-log.port.ts`），这里读的是
 * `GET /system/error-logs`（契约 `systemErrorLogs.listSystemErrorLogs`）。
 *
 * ⚠ 这条接口只对**平台超管**放行（见契约文件头：`error_logs` 没有 `org_id`，
 *   按组织 admin 权限开放会让任意一个组织的管理员看到全平台所有组织的异常
 *   详情，是一次跨租户数据泄露）。所以 403 `NOT_PLATFORM_SUPERUSER` **不是**
 *   失败态——它是"你不是这个身份"的正常结果，渲染成一句说明而不是重试按钮。
 */
function SystemExceptionsSection() {
  const [load, setLoad] = React.useState<SystemLoad>({ kind: "loading" });

  const reload = React.useCallback(async () => {
    setLoad({ kind: "loading" });
    try {
      const out = await listSystemErrorLogs({ limit: 50 });
      setLoad({ kind: "ready", items: out.items ?? [], hasMore: out.hasMore ?? false });
    } catch (err) {
      if (err instanceof ApiError && err.reasonCode === "NOT_PLATFORM_SUPERUSER") {
        setLoad({ kind: "forbidden" });
        return;
      }
      setLoad({
        kind: "failed",
        reason: err instanceof ApiError ? (err.reasonCode ?? `http_${err.status}`) : String(err),
      });
    }
  }, []);

  React.useEffect(() => {
    void reload();
  }, [reload]);

  return (
    <section className="flex flex-col gap-2" data-testid="admin-feedback-system-errors">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-14 font-semibold">
          系统异常 <span className="text-11 font-normal text-muted-foreground">· 前后端自动捕获的未处理异常</span>
        </h2>
        {load.kind === "ready" && (
          <Button size="sm" variant="outline" onClick={() => void reload()}>刷新</Button>
        )}
      </div>

      {load.kind === "loading" && (
        <p className="text-12 text-muted-foreground" data-testid="admin-feedback-system-errors-loading">
          正在读取系统异常…
        </p>
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
          <Button size="sm" variant="outline" onClick={() => void reload()}>重试</Button>
        </div>
      )}

      {load.kind === "ready" && (
        load.items.length === 0 ? (
          <p className="text-12 text-muted-foreground" data-testid="admin-feedback-system-errors-empty">
            还没有捕获到系统异常。
          </p>
        ) : (
          <div className="flex flex-col gap-1.5" data-testid="admin-feedback-system-errors-list">
            {load.items.map((item) => (
              <SystemErrorRow key={item.id} item={item} />
            ))}
            {load.hasMore && (
              <p className="text-11 text-muted-foreground">
                还有更早的记录（本页只显示最新 {load.items.length} 条）。
              </p>
            )}
          </div>
        )
      )}
    </section>
  );
}

function SystemErrorRow({ item }: { item: SystemErrorLogItem }) {
  const [expanded, setExpanded] = React.useState(false);
  return (
    <Card data-testid={`admin-feedback-system-error-${item.id}`}>
      <CardContent className="flex flex-col gap-1.5 py-2.5">
        <button
          type="button"
          className="flex flex-wrap items-center gap-x-2 gap-y-1 text-left"
          onClick={() => setExpanded((v) => !v)}
          data-testid={`admin-feedback-system-error-toggle-${item.id}`}
        >
          <span className="min-w-0 flex-1 truncate text-12 font-medium">{item.msg}</span>
          <code className="font-mono text-10 text-muted-foreground">{item.traceId}</code>
          <span className="text-10 text-muted-foreground">{new Date(item.createdAt).toLocaleString("zh-CN")}</span>
        </button>
        {expanded && (
          <pre
            className="max-h-64 overflow-auto whitespace-pre-wrap rounded-md border border-border-subtle bg-panel p-2 text-11 text-muted-foreground"
            data-testid={`admin-feedback-system-error-detail-${item.id}`}
          >
            {JSON.stringify(item.detail, null, 2)}
          </pre>
        )}
      </CardContent>
    </Card>
  );
}

const SOURCE_FILTER_OPTIONS: readonly { readonly value: SourceFilter; readonly label: string }[] = [
  { value: "all", label: "全部来源" },
  { value: "product", label: "产品" },
  { value: "agent", label: "Agent" },
  { value: "skill", label: "Skill" },
];

function FeedbackFilters({
  kindFilter, onKindFilterChange, sourceFilter, onSourceFilterChange, total, visible,
}: {
  kindFilter: KindFilter;
  onKindFilterChange: (v: KindFilter) => void;
  sourceFilter: SourceFilter;
  onSourceFilterChange: (v: SourceFilter) => void;
  total: number;
  visible: number;
}) {
  return (
    <section className="flex flex-wrap items-center gap-3" data-testid="admin-feedback-filters">
      <div className="flex flex-wrap items-center gap-1" role="group" aria-label="按类型筛选">
        {(["all", "缺陷", "需求"] as const).map((v) => (
          <Button
            key={v}
            size="xs"
            variant={kindFilter === v ? "primary" : "outline"}
            aria-pressed={kindFilter === v}
            onClick={() => onKindFilterChange(v)}
            data-testid={`admin-feedback-filter-kind-${v}`}
          >
            {v === "all" ? "全部类型" : v}
          </Button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-1" role="group" aria-label="按来源筛选">
        {SOURCE_FILTER_OPTIONS.map(({ value, label }) => (
          <Button
            key={value}
            size="xs"
            variant={sourceFilter === value ? "primary" : "outline"}
            aria-pressed={sourceFilter === value}
            onClick={() => onSourceFilterChange(value)}
            data-testid={`admin-feedback-filter-source-${value}`}
          >
            {label}
          </Button>
        ))}
      </div>
      {(kindFilter !== "all" || sourceFilter !== "all") && (
        <span className="text-11 text-muted-foreground" data-testid="admin-feedback-filter-summary">
          显示 {visible} / {total} 条
        </span>
      )}
    </section>
  );
}

function FeedbackColumn({
  status, caption, viewMode, items, busyId, onVote, onTriage,
}: {
  status: FeedbackStatus;
  caption: string;
  viewMode: EntityViewMode;
  items: readonly FeedbackItem[];
  busyId: string | null;
  onVote: (item: FeedbackItem) => void;
  onTriage: (
    item: FeedbackItem,
    next: FeedbackStatus,
    reason: string | null,
    issueDraft?: FeedbackIssueDraft | null,
  ) => void;
}) {
  const testid = `admin-feedback-column-${status}`;
  return (
    <section className="flex flex-col gap-2" data-testid={testid}>
      <h2 className="flex items-baseline gap-1.5 text-13 font-semibold">
        <Badge tone={STATUS_TONE[status]}>{status}</Badge>
        <span className="text-10 font-normal uppercase tracking-wide text-muted-foreground">{caption}</span>
        <span className="text-11 font-normal text-muted-foreground">· {items.length}</span>
      </h2>
      {items.length === 0 ? (
        <p className="text-12 text-muted-foreground" data-testid={`${testid}-empty`}>这一列还没有反馈。</p>
      ) : (
        <div
          className={viewMode === "card" ? "flex flex-col gap-3" : "flex flex-col gap-1.5"}
          data-testid={viewMode === "card" ? `${testid}-cards` : `${testid}-list`}
        >
          {items.map((item) => (
            <FeedbackCard
              key={item.id}
              item={item}
              busy={busyId === item.id}
              onVote={() => onVote(item)}
              onTriage={(next, reason, issueDraft) => onTriage(item, next, reason, issueDraft)}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function targetChip(item: FeedbackItem) {
  if (item.target.kind === "product") return { Icon: AppWindow, text: "产品" };
  if (item.target.kind === "agent") {
    return { Icon: Bot, text: `Agent ${item.targetLabel ?? item.target.agentId}` };
  }
  return { Icon: Puzzle, text: `Skill ${item.targetLabel ?? item.target.skillId}` };
}

function FeedbackCard({
  item, busy, onVote, onTriage,
}: {
  item: FeedbackItem;
  busy: boolean;
  onVote: () => void;
  onTriage: (next: FeedbackStatus, reason: string | null, issueDraft?: FeedbackIssueDraft | null) => void;
}) {
  const [decliningReason, setDecliningReason] = React.useState<string | null>(null);
  // ⚠ `null` = 弹层未打开。**打开时才计算默认值**（不是在组件挂载时算一次），
  //   因为 item.title / item.detail 可能在弹层打开之前就已经变了（例如切换视图后
  //   重新拉取到了新的正文可见性）——打开那一刻的 item 才是管理员实际看到的那份。
  const [issueDraft, setIssueDraft] = React.useState<FeedbackIssueDraft | null>(null);
  const [labelsText, setLabelsText] = React.useState("");
  const chip = targetChip(item);
  const KindIcon = item.kind === "缺陷" ? Bug : Lightbulb;

  return (
    <Card data-testid={`admin-feedback-item-${item.id}`}>
      <CardContent className="flex flex-col gap-2 py-3">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
          <Badge tone={STATUS_TONE[item.status]} data-testid={`admin-feedback-status-${item.id}`}>
            {item.status}
          </Badge>
          <Badge tone="outline">
            <KindIcon aria-hidden className="mr-1 inline h-3 w-3" />
            {item.kind}
          </Badge>
          <span className="min-w-0 flex-1 text-12 font-medium">{item.title}</span>
          <Button
            size="xs"
            variant={item.votedByMe ? "primary" : "ghost"}
            disabled={busy}
            aria-pressed={item.votedByMe}
            onClick={onVote}
            data-testid={`admin-feedback-vote-${item.id}`}
          >
            <ThumbsUp aria-hidden className="h-3 w-3" />
            {item.votes}
          </Button>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-11 text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <chip.Icon aria-hidden className="h-3 w-3" />
            {chip.text}
          </span>
          {/* I-F1：复现上下文分列存、分列显示。取不到就不显示那一项，不写「未知」占位 */}
          {item.occurredRoute !== null && <code className="font-mono">{item.occurredRoute}</code>}
          {item.appVersion !== null && <span>版本 {item.appVersion}</span>}
          <span>{new Date(item.createdAt).toLocaleString("zh-CN")}</span>
          {item.submittedByMe && <span>· 我提的</span>}
        </div>

        {/*
          D3：正文只有管理员与提交人看得到。`detail === null` 恒等于「无权」，
          不等于「正文为空」（落库的正文非空）——所以这句话可以直说。
        */}
        {item.detail === null ? (
          <p className="text-11 italic text-muted-foreground" data-testid={`admin-feedback-detail-withheld-${item.id}`}>
            正文仅组织管理员与提交人可见。
          </p>
        ) : (
          <p className="whitespace-pre-wrap text-11 text-muted-foreground">{item.detail}</p>
        )}

        {item.statusReason !== null && (
          <p className="text-11 text-card-foreground" data-testid={`admin-feedback-reason-${item.id}`}>
            处理说明：{item.statusReason}
          </p>
        )}

        {item.githubIssueUrl !== null && (
          <GithubIssuePanel feedbackId={item.id} url={item.githubIssueUrl} number={item.githubIssueNumber} />
        )}

        {issueDraft !== null ? (
          // "转开发"弹层——见 `ISSUE_DRAFT_STATUS` 头注:确认时会真的建一个 GitHub issue,
          // 提交前必须能编辑,pre-fill 只是起点,不是终点。
          <div
            className="flex flex-col gap-1.5 rounded-md border border-border-subtle bg-panel p-2"
            data-testid={`admin-feedback-issue-${item.id}`}
          >
            <p className="text-11 font-medium text-muted-foreground">
              转开发会在 boardx/workspacex 建一个 GitHub issue,提交前可以编辑:
            </p>
            <label className="flex flex-col gap-1">
              <span className="text-10 text-muted-foreground">标题</span>
              <input
                value={issueDraft.title}
                onChange={(e) => setIssueDraft({ ...issueDraft, title: e.target.value })}
                data-testid={`admin-feedback-issue-title-${item.id}`}
                className="h-6 rounded border border-border-subtle bg-card px-1.5 text-11"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-10 text-muted-foreground">正文</span>
              <textarea
                value={issueDraft.body}
                onChange={(e) => setIssueDraft({ ...issueDraft, body: e.target.value })}
                rows={4}
                data-testid={`admin-feedback-issue-body-${item.id}`}
                className="resize-y rounded border border-border-subtle bg-card p-1.5 text-11"
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
                className="h-6 rounded border border-border-subtle bg-card px-1.5 text-11 font-mono"
              />
            </label>
            <div className="flex justify-end gap-1.5">
              <Button
                size="xs"
                variant="ghost"
                onClick={() => { setIssueDraft(null); setLabelsText(""); }}
              >
                取消
              </Button>
              <Button
                size="xs"
                variant="primary"
                disabled={busy || issueDraft.title.trim() === ""}
                onClick={() => onTriage(ISSUE_DRAFT_STATUS, null, issueDraft)}
                data-testid={`admin-feedback-issue-submit-${item.id}`}
              >
                确认转开发,创建 issue
              </Button>
            </div>
          </div>
        ) : decliningReason !== null ? (
          <div className="flex flex-wrap items-center gap-1.5" data-testid={`admin-feedback-decline-${item.id}`}>
            <input
              value={decliningReason}
              onChange={(e) => setDecliningReason(e.target.value)}
              placeholder="为什么不做？（必填，提交人会看到这句话）"
              aria-label="不做的理由"
              data-testid={`admin-feedback-decline-reason-${item.id}`}
              className="h-6 min-w-0 flex-1 rounded border border-border-subtle bg-panel px-1.5 text-11"
            />
            <Button
              size="xs"
              variant="primary"
              disabled={busy || decliningReason.trim() === ""}
              onClick={() => onTriage("不做", decliningReason.trim())}
              data-testid={`admin-feedback-decline-submit-${item.id}`}
            >
              确认不做
            </Button>
            <Button size="xs" variant="ghost" onClick={() => setDecliningReason(null)}>取消</Button>
          </div>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {NEXT_STATUSES[item.status].map((next) => (
              <Button
                key={next}
                size="xs"
                variant="outline"
                disabled={busy}
                // 「不做」先要理由——契约 `TRIAGE_REASON_REQUIRED` 在服务端也判一次，
                // 这里展开输入框是为了不让人先撞一次 422 才知道要写理由。
                // 「已进入迭代」("转开发")先展开可编辑的 issue 草稿——见 `ISSUE_DRAFT_STATUS`。
                onClick={() => {
                  if (next === "不做") { setDecliningReason(""); return; }
                  if (next === ISSUE_DRAFT_STATUS) {
                    const draft = defaultIssueDraft(item);
                    setIssueDraft(draft);
                    setLabelsText(draft.labels.join(", "));
                    return;
                  }
                  onTriage(next, null);
                }}
                data-testid={`admin-feedback-to-${next}-${item.id}`}
              >
                {busy && <Loader2 aria-hidden className="h-3 w-3 animate-spin" />}
                转「{next}」
              </Button>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
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
      setPanel({
        kind: "failed",
        reason: err instanceof ApiError ? (err.reasonCode ?? `http_${err.status}`) : String(err),
      });
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
      setCommentState({
        kind: "failed",
        reason: err instanceof ApiError ? (err.reasonCode ?? `http_${err.status}`) : String(err),
      });
    }
  };

  return (
    <div
      className="flex flex-col gap-1.5 rounded-md border border-border-subtle bg-panel p-2"
      data-testid={`admin-feedback-github-${feedbackId}`}
    >
      <div className="flex flex-wrap items-center gap-2 text-11">
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
        <Button
          size="xs"
          variant="ghost"
          onClick={() => void load()}
          disabled={panel.kind === "loading"}
          data-testid={`admin-feedback-github-refresh-${feedbackId}`}
        >
          {panel.kind === "loading" ? (
            <Loader2 aria-hidden className="h-3 w-3 animate-spin" />
          ) : (
            <RefreshCw aria-hidden className="h-3 w-3" />
          )}
          查看 GitHub 状态
        </Button>
      </div>

      {panel.kind === "failed" && (
        <p className="text-10 text-destructive" data-testid={`admin-feedback-github-error-${feedbackId}`}>
          GitHub 状态取不到（{panel.reason}）。
        </p>
      )}

      {panel.kind === "ready" && (
        <div className="flex flex-col gap-1" data-testid={`admin-feedback-github-status-${feedbackId}`}>
          {/*
            ⚠ `linkedPullRequestsAvailable === false` 不等于「没有 PR」——issue
            详情与关联 PR 列表是两次独立的 GitHub 请求，后者单独失败（限流/超时）
            时前者仍然成功，这里必须说「取不到」而不是「没有」，否则把一次依赖失败
            读成了一个假的产品事实（2026-09-02 独立审查 P1）。
          */}
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
                  <Badge tone={pr.state === "merged" ? "ai" : pr.state === "open" ? "primary" : "neutral"}>
                    {pr.state}
                  </Badge>
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
          className="h-6 min-w-0 flex-1 rounded border border-border-subtle bg-card px-1.5 text-11"
        />
        <Button
          size="xs"
          variant="outline"
          disabled={commentState.kind === "sending" || commentText.trim() === ""}
          onClick={() => void submitComment()}
          data-testid={`admin-feedback-github-comment-submit-${feedbackId}`}
        >
          {commentState.kind === "sending" && <Loader2 aria-hidden className="h-3 w-3 animate-spin" />}
          发评论
        </Button>
        {commentState.kind === "sent" && (
          <span className="text-10 text-muted-foreground" data-testid={`admin-feedback-github-comment-sent-${feedbackId}`}>
            已发送
          </span>
        )}
        {commentState.kind === "failed" && (
          <span className="text-10 text-destructive" data-testid={`admin-feedback-github-comment-error-${feedbackId}`}>
            没发出去（{commentState.reason}）
          </span>
        )}
      </div>
    </div>
  );
}
