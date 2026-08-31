"use client";
import * as React from "react";
import { ThumbsUp, Bug, Lightbulb, Loader2, Bot, Puzzle, AppWindow } from "lucide-react";
import { AdminScreen } from "./admin-screen";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ViewModeToggle, type EntityViewMode } from "./view-mode-toggle";
import { ApiError } from "@/lib/api-client";
import {
  getFeedbackCounts,
  listFeedback,
  triageFeedback,
  voteFeedback,
  type FeedbackCounts,
  type FeedbackIssueDraft,
  type FeedbackItem,
  type FeedbackKind,
  type FeedbackStatus,
} from "@/lib/live-feedback";
import type { UiState } from "@/lib/ui-state";

/**
 * FB-3 —— 后台「反馈与迭代」的**真栈**屏。两列：左软件、右 Agent/Skill。
 *
 * ## 这块屏之前是什么样
 *
 * 178 行全 mock（`SW_FEEDBACK` / `AGENT_FEEDBACK` / `ITERATION_LOOP` 三个静态常量）
 * 外加一条 `<NoBackendNotice />`，每个按钮都在、点了什么都不会发生。
 * 本次改动把它接到 `GET /feedback` / `PUT /feedback/:id/status` / `GET /feedback/counts`。
 *
 * ## 两列吃的是**同一条接口的两个 scope**，不是两套数据
 *
 * 左列 = `target.kind === "product"`（导航栏弹层提的），
 * 右列 = `target.kind === "agent" | "skill"`（chat 里对着某个 agent/skill 提的）。
 * 一次 `listFeedback({kind:"org"})` 取回来后在本地按 target 分列——**不是两次请求**：
 * 两次请求之间有写入窗口，于是「本周 12 条」与两列相加对不上，而界面会把那个
 * 不等式直接显示给人看。
 *
 * ## ⚠ 右列**不是**「从消息级评价聚合出来的改进建议」
 *
 * 那是 `skills.listSuggestions`（F68 已签核契约），它今天**没有任何实现**——
 * 没有表、没有路由（`docs/proposals/PROP-FEEDBACK-LOOP-E2E-001.md` §1.1 逐条实测）。
 * 本屏因此**不渲染那一块**，也不用 mock 顶替它；屏内有一句话说明它还没接地。
 * 用 mock 顶替会让「聚合建议已经在工作」这件不成立的事看起来成立。
 *
 * ## 删掉的两个按钮
 *
 * `[打开迭代看板]` / `[导出]` 已移除。UC-17.6 的 A1/A2 逐字写着「按钮存在，
 * 但点击后无目标屏（原型待补）」——留一个点了会出现「实现者自己设计的看板」的按钮，
 * 比没有按钮更糟：它会被当成已确认的设计继续长。
 */

const STATUS_TONE: Record<FeedbackStatus, "warning" | "ai" | "primary" | "neutral"> = {
  待处理: "warning",
  已进入迭代: "ai",
  已修复: "primary",
  不做: "neutral",
};

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
 * 尽力发一封状态变更邮件——那是纯后端副作用,前端不需要为它多做任何事。
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

type Load =
  | { kind: "loading" }
  | { kind: "ready"; items: readonly FeedbackItem[]; counts: FeedbackCounts | null }
  | { kind: "failed"; reason: string };

export function FeedbackScreen({ state }: { state: UiState }) {
  const [load, setLoad] = React.useState<Load>({ kind: "loading" });
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [actionError, setActionError] = React.useState<string | null>(null);
  /**
   * 卡片 / 列表切换（人类 2026-08-15 原话：「卡片也可以切换为列表，需要有这个切换的功能」）。
   *
   * ⚠ **一个开关管两列**，不是每列一个。两列是同一种 entity（一条反馈）的两个分组，
   *   让它们各自有视图态，会出现「左列卡片、右列列表」这种没人想要、也没人会去对齐的状态。
   *   testid 因此是 `admin-feedback-view-toggle-*`（模块级），不是列级。
   *
   * ⚠ 这段在 FB-3 真栈化时**一度被我整块丢掉**——重写屏幕时只想着换数据源，
   *   把一条已经裁过的交互规则连带删了，`admin-feedback-view-toggle.test.tsx` 当场变红。
   *   记在这里：接后端不是重写界面的许可证。
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
  const software = items.filter((f) => f.target.kind === "product");
  const capability = items.filter((f) => f.target.kind !== "product");

  return (
    <AdminScreen
      state={state}
      moduleLabel="反馈"
      title="反馈与迭代"
      liveBacked
      intro="两列反馈：左列是对产品本身提的（导航栏「反馈」入口），右列是在对话里对着某个 Agent / Skill 提的。每条都有状态与去向；转「不做」必须写理由。"
      emptyHint="本组织还没有收到反馈"
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
            {/* 状态分布。⚠ 五个数来自一次查询（契约 getFeedbackCounts），不是前端 filter 出来的 */}
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

            {actionError !== null && (
              <p className="text-12 text-destructive" data-testid="admin-feedback-action-error">
                操作没有生效（{actionError}）。状态未变更。
              </p>
            )}

            <div className="grid gap-5 lg:grid-cols-2">
              <FeedbackColumn
                testid="admin-feedback-software"
                containerPrefix="admin-feedback-sw"
                viewMode={viewMode}
                heading="软件反馈"
                subheading="对产品本身提的"
                emptyText="还没有人对产品本身提过反馈。"
                items={software}
                busyId={busyId}
                onVote={(f) => void act(() => voteFeedback(f.id, !f.votedByMe), f.id)}
                onTriage={(f, next, reason, issueDraft) =>
                  void act(() => triageFeedback(f.id, next, reason, issueDraft ?? null), f.id)
                }
              />
              <FeedbackColumn
                testid="admin-feedback-capability"
                containerPrefix="admin-feedback-agent"
                viewMode={viewMode}
                heading="Agent / Skill 反馈"
                subheading="在对话里对着某个 Agent / Skill 提的"
                emptyText="还没有人在对话里对某个 Agent 或 Skill 提过反馈。"
                items={capability}
                busyId={busyId}
                onVote={(f) => void act(() => voteFeedback(f.id, !f.votedByMe), f.id)}
                onTriage={(f, next, reason, issueDraft) =>
                  void act(() => triageFeedback(f.id, next, reason, issueDraft ?? null), f.id)
                }
              />
            </div>

            {/*
              诚实登记缺口，不用 mock 顶替。见文件头「右列不是聚合建议」。
            */}
            <p className="text-11 text-muted-foreground" data-testid="admin-feedback-aggregation-gap">
              还没有的一块：把 chat 里的 👍/👎（已落库）按结构性判据聚合成「含具体改动的改进建议」，
              以及「建议 → 改进 PR → 人工复核 → 灰度」这条链路。它需要
              <code className="mx-1 font-mono">skills.listSuggestions</code>
              的落库面，今天全仓没有实现，所以这里不展示任何聚合数字——不是数字为零，是这件事还没接地。
            </p>
          </>
        )}
      </div>
    </AdminScreen>
  );
}

function FeedbackColumn({
  testid, containerPrefix, viewMode, heading, subheading, emptyText, items, busyId, onVote, onTriage,
}: {
  testid: string;
  /**
   * 内容容器 testid 的前缀（`admin-feedback-sw` / `admin-feedback-agent`）。
   * ⚠ 与 `testid`（section 级）**不同名**，且这两个前缀是**既有测试锚定的旧名**——
   *   FB-3 换数据源不是给 testid 改名的机会，改名会让一批与本次改动无关的断言变红，
   *   而那批红看起来像是功能坏了。
   */
  containerPrefix: string;
  viewMode: EntityViewMode;
  heading: string;
  subheading: string;
  emptyText: string;
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
  return (
    <section className="flex flex-col gap-2" data-testid={testid}>
      <h2 className="text-14 font-semibold">
        {heading} <span className="text-11 font-normal text-muted-foreground">· {subheading} · {items.length} 条</span>
      </h2>
      {items.length === 0 ? (
        <p className="text-12 text-muted-foreground" data-testid={`${testid}-empty`}>{emptyText}</p>
      ) : (
        <div
          className={
            viewMode === "card"
              ? "grid grid-cols-1 items-start gap-3 xl:grid-cols-2"
              : "flex flex-col gap-1.5"
          }
          data-testid={viewMode === "card" ? `${containerPrefix}-cards` : `${containerPrefix}-list`}
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
