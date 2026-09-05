"use client";
import * as React from "react";
import {
  LayoutList, Columns3, Search, X, Sparkles, Play, Check, Undo2, Ban, ShieldAlert, PlugZap, Loader2, Lock, Github,
  MoreHorizontal, Eye, Paperclip, MessageSquare, Mail,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Menu, MenuTrigger, MenuContent, MenuItem, MenuSeparator } from "@/components/ui/menu";
import { cn } from "@/lib/utils";
import type { UiState } from "@/lib/ui-state";
import { ApiError } from "@/lib/api-client";
import {
  getInboxCounts,
  listInbox,
  INBOX_KIND_LABEL,
  INBOX_KIND_OPTIONS,
  INBOX_STAGE_LABEL,
  INBOX_STAGE_ORDER,
  type GetInboxCountsOut,
  type InboxGithubRef,
  type InboxItem,
  type InboxKind,
  type InboxStage,
} from "@/lib/live-inbox";
import {
  triageFeedback,
  listFeedbackStatusEvents,
  getFeedbackGithubIssue,
  listFeedbackGithubIssueComments,
  commentOnFeedbackGithubIssue,
  deepenFeedback,
  type FeedbackStatus,
  type FeedbackStatusEvent,
  type FeedbackGithubIssueStatus,
  type FeedbackIssueDraft,
  type GithubIssueComment,
} from "@/lib/live-feedback";
import { STRUCTURED_FIELDS } from "@/components/feedback/feedback-structured";
import { updateSystemErrorLifecycle, type SystemErrorStatus } from "@/lib/live-system-errors";
import { FeedbackStructuredView } from "@/components/feedback/feedback-structured";
import { StatusBadge, GithubBadge, LinkBadge, SevereBadge } from "./badges";
import { useDialogFocus } from "./use-dialog-focus";

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
 *   · **看板拖拽换列仍不弹 issue 草稿编辑器**：拖拽是"分诊台快速挪列"的心智，issue
 *     文案编辑是另一个更重的动作；拖拽这条边继续传 `issueDraft: null`，服务端按契约
 *     用默认文案建 issue。drawer 里显式的「创建 GitHub Issue」按钮（B3.5，见下）才带
 *     编辑过的草稿。
 *   · **drawer 时间线只有反馈类有**：`listFeedbackStatusEvents` 是反馈专属操作；
 *     系统异常源（`live-system-errors.ts`）今天没有等价接口，不发明一个，直接不渲染。
 *   · **GitHub 徽标：drawer 展开才现查升级，卡片/列表恒用列表推断值**（B3.5）：
 *     drawer 打开且 `kind === "feedback"` 且 `item.github !== null` 时调
 *     `getFeedbackGithubIssue` 现查——若 `linkedPullRequestsAvailable` 且
 *     `linkedPullRequests` 非空，取 `merged` > `open` > `closed` 优先级的第一条，
 *     徽标升级成 PR；否则用现查回来的 issue 真实开关覆盖列表推断值。现查失败不阻塞
 *     drawer 其余内容，退回列表推断值 + 一条不显眼的失败提示（同 `events` 时间线的
 *     失败态处理风格）。看板/列表卡片**不现查**（`CardMeta`/`BoardCard`/`ListView`
 *     仍直接渲染 `item.github`）——同 feedback-loop 纪律，只有单条展开才值得为它
 *     多打一次外部 API。
 *   · **「转入开发」与建 GitHub Issue 绑定（2026-09-05 人类指令，取代 B3.5 的独立「创建 GitHub
 *     Issue」按钮）**：反馈类条目只要还没有 issue（`github === null`），任何一条 `backlog → doing`
 *     的入口——drawer「开始处理」、卡片/行快捷菜单「开始处理」、看板拖进「进行中」列——都**不直接
 *     发请求**，而是落到 drawer 的 issue 确认表单（同「不做」必须先落到理由表单的做法）；管理员
 *     确认后一次调用 `triageFeedback(id, "已进入迭代", null, issueDraft)` 同时改状态 + 建 issue。
 *     已经挂着 issue 的反馈、以及系统异常（没有建 issue 的源操作）仍是直接迁移。契约层没有
 *     第二条允许携带 `issueDraft` 的边（`doing → doing` 是幂等重放不建 issue），所以表单只在
 *     `backlog` 态出现——这条约束没变，只是入口从"另一个按钮"收敛成"转入开发本身"。
 *   · **issue 草稿整合反馈全部字段**（`buildInboxIssueDraft`）：编号 / 类型 / 正文 / 结构化字段
 *     （复用 `STRUCTURED_FIELDS` 这张唯一字段表）/ 提交人 / 提交时间 / 票数 / 附件清单 / 回到收件箱
 *     的链接；表单里同时列出**会随 issue 上传**的附件（`item.attachments`），服务端
 *     `triageFeedback` 把它们推到 GitHub（图片内嵌、其它文件链接），推不上去的会以
 *     `imageUploadWarnings` 回来——这里**不吞**，展示成一条持续的警告，管理员据此知道 issue 建了
 *     但哪份文件没跟过去。
 *   · **GitHub 徽标可点击**（`badges.tsx` `GithubBadge` 是 `<a target="_blank">`）：卡片 / 列表 /
 *     drawer 里的 Issue / PR 徽标都直接打开 GitHub；drawer 现查回来的每一条关联 PR 也各渲染一枚
 *     可点的 PR 徽标，不只显示优先级最高的那一条。
 *   · **issue 评论区**（drawer，仅挂着 issue 的反馈）：`listFeedbackGithubIssueComments` 现查 +
 *     `commentOnFeedbackGithubIssue` 提交，提交成功后重新拉一次列表。
 *   · **每 2 分钟静默刷新**（`INBOX_REFRESH_MS`，与服务端 `FeedbackGithubIssuePollWorker` 的轮询
 *     周期同一个数）：服务端轮询发现 issue 关闭后把反馈转「已修复」/「不做」并发邮件，这里定时
 *     重拉列表 + 计数，条目自动挪到「已完成」，不用手动刷新。**静默** = 不把 `load` 打回
 *     `loading`（那会让已打开的 drawer 闪关），按 id 原地合并首页结果、新条目插到前面。
 *   · **拖拽的每一条合法迁移都有键盘可达的等价操作（B6.5 无障碍复核）**：拖拽只是
 *     "分诊台快速挪列"，不是唯一入口。drawer 操作区按 `item.stage` × `item.kind` 展开的按钮
 *     集合，恰好覆盖两个源状态机（`product-feedback.ts` 的 `ALLOWED_TRANSITIONS`、
 *     `system-error-logs.ts` 头注）里每一条从当前列出去的边：
 *       backlog → doing（开始处理）/ archived（不做…）；doing → done（标记已修复，仅反馈）
 *       / backlog（退回待处理）/ archived（不做…）；done|archived → backlog（重新打开）。
 *     拖拽能做而按钮没有的边（如 done → doing）在服务端本来就是 `ILLEGAL_TRANSITION`，
 *     拖过去只会回滚——所以按钮集**不是**拖拽的子集，是合法边的全集。
 *     `tests/ui/design-loop.test.tsx` ⑪ 逐格断言这张表，改状态机请同步。
 */

type KindFilter = "all" | InboxKind;
type StageFilter = "all" | InboxStage;

const KIND_FILTERS: readonly KindFilter[] = ["all", ...INBOX_KIND_OPTIONS];
const SEARCH_DEBOUNCE_MS = 300;
const PAGE_LIMIT = 50;
/** B3.7——关联跳转后目标卡片/行的高亮持续时长。 */
const HIGHLIGHT_MS = 1800;
const LINK_NOTICE_MS = 4000;
/** 与服务端 `FEEDBACK_GITHUB_ISSUE_POLL_INTERVAL_MS` 同一个周期（2 分钟）：issue 关闭 → 服务端转状态 → 这里下一轮刷到。 */
export const INBOX_REFRESH_MS = 2 * 60 * 1000;
/** 附件上传警告是"issue 建了但文件没带过去"这种要人处理的事，比一般提示停留更久。 */
const WARNING_NOTICE_MS = 12000;

/** B3.7——关联跳转回调：`targetId` 是契约 `InboxItem.id`，`label` 只用于提示文案。 */
type NavigateLink = (targetId: string, label: string) => void;

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
  onOpenLinked,
}: {
  state?: UiState;
  onDeepen?: (projectId: string) => void;
  onOpenWorkbench?: (inboxCode: string) => void;
  /** 进屏就打开这一条的详情（`?open=<id>`）。 */
  openId?: string | null;
  /**
   * B3.7——点关联标在屏内跳到目标条目**之后**回调（目标 = 契约 `InboxItem.id`）。
   * 屏本身不碰路由；生产落点用它把 `?open=<id>` 同步进 URL，取材页不传。
   */
  onOpenLinked?: (targetId: string) => void;
}) {
  const [view, setView] = React.useState<"board" | "list">("board");
  const [kindFilter, setKindFilter] = React.useState<KindFilter>("all");
  /**
   * issue #2752 ① + 2026-09-05 人类指令——三类的关系：**反馈 = 需求 + 缺陷**（用户提交），
   * **系统异常**是系统自动提交的，**「全部」= 反馈 + 设计方案，不含系统异常**。
   * 默认视图要把所有需求 / 缺陷都显示出来，所以「全部」时把 `excludeKind: "exception"`
   * 传给**服务端**（契约 `listInbox.in.excludeKind`），不是拿一页回来再本地滤——分页后
   * 本地滤只会把 50 条里的 49 条异常丢掉、只剩 1 条反馈（截图实证）。入口不消失——点
   * 「系统异常」chip 单独筛选，或打开这个开关把异常并进「全部」。`kindFilter !== "all"`
   * （含显式选中「系统异常」）不受这个开关影响,用户已经明确要看某一类。
   */
  const [showExceptionsInAll, setShowExceptionsInAll] = React.useState(false);
  const hidingExceptions = kindFilter === "all" && !showExceptionsInAll;
  const [stageFilter, setStageFilter] = React.useState<StageFilter>("all");
  const [queryInput, setQueryInput] = React.useState("");
  const [query, setQuery] = React.useState("");
  const [load, setLoad] = React.useState<Load>({ kind: "loading" });
  const [loadingMore, setLoadingMore] = React.useState(false);
  const [counts, setCounts] = React.useState<GetInboxCountsOut | null>(null);
  const [openId, setOpenId] = React.useState<string | null>(initialOpenId);
  const [openDeclineOnOpen, setOpenDeclineOnOpen] = React.useState(false);
  /** 2026-09-05——从「开始处理」/拖进「进行中」进来的反馈（尚无 issue）：直接展开 issue 确认表单。 */
  const [openIssueFormOnOpen, setOpenIssueFormOnOpen] = React.useState(false);
  /** 建 issue 后服务端回来的附件上传警告（`imageUploadWarnings`），持续展示，不吞。 */
  const [warning, setWarning] = React.useState<string | null>(null);
  const [dragOver, setDragOver] = React.useState<InboxStage | null>(null);
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [saved, setSaved] = React.useState<string | null>(null);
  const [dragError, setDragError] = React.useState<string | null>(null);
  /** B3.7——刚被关联标跳到的条目 id，短暂高亮后自清（看板卡片/列表行都认它）。 */
  const [highlightId, setHighlightId] = React.useState<string | null>(null);
  /** B3.7——关联目标不在已加载列表里时的提示（不静默失败）。 */
  const [linkNotice, setLinkNotice] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (highlightId === null) return;
    // jsdom 没有 scrollIntoView；真实浏览器里把目标滚进视口，高亮才看得见。
    const el = document.querySelector<HTMLElement>(`[data-highlighted="true"]`);
    if (typeof el?.scrollIntoView === "function") el.scrollIntoView({ block: "nearest" });
    const t = window.setTimeout(() => setHighlightId(null), HIGHLIGHT_MS);
    return () => window.clearTimeout(t);
  }, [highlightId]);

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
        excludeKind: hidingExceptions ? "exception" : undefined,
        q: query === "" ? undefined : query,
        limit: PAGE_LIMIT,
      });
      setLoad({ kind: "ready", items: [...out.items], nextCursor: out.nextCursor, sources: out.sources });
    } catch (err) {
      setLoad({ kind: "failed", reason: describeFailure(err) });
    }
  }, [kindFilter, hidingExceptions, query]);

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

  /**
   * 静默刷新（见文件头）：按 id 原地合并首页结果——已加载的条目更新字段（状态/徽标），首页里
   * 新出现的条目插到最前面；不清空 `items`、不动 `nextCursor`（已经翻过的页留在原地）。
   */
  const refreshSilently = React.useCallback(async () => {
    try {
      const [out, nextCounts] = await Promise.all([
        listInbox({ kind: kindFilter === "all" ? undefined : kindFilter, q: query === "" ? undefined : query, limit: PAGE_LIMIT }),
        getInboxCounts().catch(() => null),
      ]);
      setLoad((prev) => {
        if (prev.kind !== "ready") return prev;
        const fresh = new Map(out.items.map((i) => [i.id, i] as const));
        const merged = prev.items.map((i) => fresh.get(i.id) ?? i);
        const known = new Set(prev.items.map((i) => i.id));
        const added = out.items.filter((i) => !known.has(i.id));
        return { ...prev, items: [...added, ...merged], sources: out.sources };
      });
      if (nextCounts !== null) setCounts(nextCounts);
    } catch {
      /* 定时刷新是锦上添花：这一轮失败就等下一轮，不打断用户正在做的事 */
    }
  }, [kindFilter, query]);

  React.useEffect(() => {
    if (state !== "default") return;
    const t = window.setInterval(() => void refreshSilently(), INBOX_REFRESH_MS);
    return () => window.clearInterval(t);
  }, [refreshSilently, state]);

  const loadMore = async () => {
    if (load.kind !== "ready" || load.nextCursor === null || loadingMore) return;
    setLoadingMore(true);
    try {
      const out = await listInbox({
        kind: kindFilter === "all" ? undefined : kindFilter,
        excludeKind: hidingExceptions ? "exception" : undefined,
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
  // 服务端已按 `excludeKind` 排除，这里再滤一次只是兜底（旧后端 / mock 不认该参数时不漏）。
  const visibleItems = hidingExceptions ? items.filter((i) => i.kind !== "exception") : items;
  /** 「全部」= 反馈 + 设计方案；隐藏系统异常时徽标数也不含异常，否则 167 vs 1 张卡对不上。 */
  const allCount = counts === null ? null : hidingExceptions ? counts.total - counts.byKind.exception : counts.total;
  /** 列表为空但后端有系统异常 ⇒ 是「被默认隐藏」，不是「收件箱是空的」。 */
  const onlyExceptionsHidden = hidingExceptions && query === "" && (counts?.byKind.exception ?? 0) > 0;

  const filtered = visibleItems.filter(
    (i) => stageFilter === "all" || i.stage === stageFilter,
  );
  // drawer 按 id 查找仍然在完整 `items` 里找——已经打开的一条不该因为开关状态变化而消失。
  const open = items.find((i) => i.id === openId) ?? null;

  const flashSaved = (msg: string) => {
    setSaved(msg);
    window.setTimeout(() => setSaved(null), 2400);
  };

  /**
   * B3.7——点关联标（「已生成方案」/「源自反馈」）跳到目标条目并高亮。两端都在这一屏
   * （`resolvedByDesignId` = 设计条目的 `id`，`linkedFeedbackId` = 反馈条目的 `id`），
   * 所以是屏内换 drawer + 高亮，不换路由；URL 的 `?open=` 由 `onOpenLinked` 在外面同步。
   * 目标被客户端 `stage` 子筛选挡住时把子筛选放宽到「全部」（它是纯本地过滤，放宽不发请求）；
   * 目标不在已加载的 `items` 里（被服务端 `kind`/`q` 筛掉或还在下一页）时**老实提示**，
   * 不静默、也不偷偷改服务端筛选去重新请求。
   */
  const navigateToLinked: NavigateLink = (targetId, label) => {
    const target = items.find((i) => i.id === targetId);
    if (target === undefined) {
      setLinkNotice(`关联的${label}不在当前列表里——可能被类型筛选、搜索挡住或还没加载到；清掉筛选或「加载更多」后再试。`);
      window.setTimeout(() => setLinkNotice(null), LINK_NOTICE_MS);
      return;
    }
    if (stageFilter !== "all" && target.stage !== stageFilter) setStageFilter("all");
    setOpenDeclineOnOpen(false);
    setOpenIssueFormOnOpen(false);
    setOpenId(targetId);
    setHighlightId(targetId);
    onOpenLinked?.(targetId);
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
      setOpenIssueFormOnOpen(false);
      setOpenDeclineOnOpen(true);
      return;
    }
    if (item.kind === "feedback" && targetStage === "doing" && item.stage === "backlog" && item.github === null) {
      // 2026-09-05——「转入开发」与建 GitHub issue 绑定（见文件头）：不直接发请求，
      // 落到 drawer 的 issue 确认表单，管理员确认后一次完成"改状态 + 建 issue"。
      setOpenId(item.id);
      setOpenDeclineOnOpen(false);
      setOpenIssueFormOnOpen(true);
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

  /**
   * B3.5——drawer 里的「创建 GitHub Issue」编辑器确认后调用。**只对 `backlog` 态的反馈
   * 开放**（见文件头：`doing → doing` 是幂等重放，不会触发 issue 创建这个副作用，
   * 契约也没有另一条允许携带 `issueDraft` 的边）。
   */
  const createGithubIssue = async (item: InboxItem, issueDraft: FeedbackIssueDraft) => {
    if (item.kind !== "feedback") return;
    const prevStage = item.stage;
    setBusyId(item.id);
    try {
      const out = await triageFeedback(item.id, "已进入迭代", null, issueDraft);
      replaceItem(item.id, { stage: "doing" });
      bumpStageCount(prevStage, "doing");
      setOpenIssueFormOnOpen(false);
      flashSaved("已创建 GitHub Issue 并进入迭代");
      // 2026-09-05——附件没带过去不能只留在服务端日志里（见文件头）：持续展示，管理员据此补救。
      const uploadWarnings = out.imageUploadWarnings ?? [];
      if (uploadWarnings.length > 0) {
        setWarning(`issue 已创建，但以下附件未能上传到 GitHub：${uploadWarnings.join("；")}`);
        window.setTimeout(() => setWarning(null), WARNING_NOTICE_MS);
      }
      // github 字段（issue 号/链接）由服务端生成，本地乐观更新算不出来——单独现查这一条
      // 补上（不是整屏 `reload()`：那会把 drawer 依赖的 `items` 短暂清空，闪一下把
      // 刚打开的详情关掉）。这次现查失败不影响状态已经转移的事实，只是badge 暂时留白，
      // drawer 展开时的现查 effect 之后还会再试一次。
      try {
        const status = await getFeedbackGithubIssue(item.id);
        replaceItem(item.id, { github: { kind: "issue", number: status.number, url: status.url, state: status.state } });
      } catch {
        /* best-effort：徽标补不上就留白，drawer 展开时的现查还会再试 */
      }
    } catch (err) {
      setDragError(`没能创建 GitHub Issue（${describeFailure(err)}）`);
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

  /**
   * UC-17.8 B4.4——「用 PM 设计工作台深化」：`POST /feedback/:id/deepen` 真栈调用（不再是
   * 原型 mock store 的本地 mock）。`deepenFeedback` 幂等（幂等键是 `feedbackId`），
   * 所以这里不需要先判断「是不是已经深化过」——重复点击也只会命中同一个项目，服务端说了算。
   * 成功后关掉 drawer、把返回的**真实** `project.id` 交给 `onDeepen`（页面级 `router.push`
   * 跳详情页，见 `components/admin/design-loop-screens.tsx`）。详情页本身仍读
   * 原型 mock store 的 mock 数据（B4.5，不在本任务范围）——这次调用只保证跳转带的
   * `id` 是真的，落地页暂时还看不到这条项目的真实内容,是已知的、有意的过渡态。
   */
  const deepen = async (item: InboxItem) => {
    if (item.kind !== "feedback") return;
    setBusyId(item.id);
    try {
      const { project } = await deepenFeedback(item.id);
      setOpenId(null);
      onDeepen?.(project.id);
    } catch (err) {
      setDragError(`没能深化到 PM 设计工作台（${describeFailure(err)}）`);
      window.setTimeout(() => setDragError(null), 3000);
    } finally {
      setBusyId(null);
    }
  };

  // ── 七态：loading / denied / dep-failed 走保留态面板；empty 数据驱动 ──────────
  if (state === "loading" || (state === "default" && load.kind === "loading")) {
    return (
      <div className="p-6" data-testid="loading">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
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
      {linkNotice !== null && (
        <div className="mx-4 mt-3 rounded-card bg-warning px-3 py-1.5 text-12 text-warning-foreground" data-testid="inbox-link-target-missing" role="status">
          {linkNotice}
        </div>
      )}
      {warning !== null && (
        <div className="mx-4 mt-3 rounded-card bg-warning px-3 py-1.5 text-12 text-warning-foreground" data-testid="inbox-attachment-upload-warning" role="alert">
          {warning}
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
            const count = f === "all" ? allCount : counts === null ? null : counts.byKind[f];
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
          {/* issue #2752 ①——「全部」视图默认滤掉系统异常，这个开关是唯一的显式切回入口。
              只在 kindFilter === "all" 时有意义：单独选中「系统异常」chip 已经是另一种「切换查看」。 */}
          {kindFilter === "all" && exceptionWithheld !== true && (
            <button
              type="button"
              aria-pressed={showExceptionsInAll}
              onClick={() => setShowExceptionsInAll((v) => !v)}
              data-testid="inbox-toggle-show-exceptions"
              className={cn(
                "inline-flex items-center gap-1 rounded-control border px-2.5 py-1 text-12 transition-colors duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                showExceptionsInAll
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-card text-card-foreground hover:bg-muted",
              )}
            >
              <Eye aria-hidden className="h-3 w-3" />
              {showExceptionsInAll ? "「全部」已包含系统异常" : "在「全部」中显示系统异常"}
            </button>
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

      {items.length === 0 && !onlyExceptionsHidden ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-1 p-16 text-center" data-testid="empty">
          <p className="text-14 font-medium">收件箱是空的</p>
          <p className="text-12 text-muted-foreground">
            {kindFilter !== "all" || query !== "" ? "没有符合当前筛选的条目。" : "用户提交需求 / 缺陷反馈或推送设计方案后，都会汇总到这里；系统异常单独查看。"}
          </p>
        </div>
      ) : visibleItems.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-1 p-16 text-center" data-testid="empty-hidden-exceptions">
          <p className="text-14 font-medium">当前只有系统异常，已默认隐藏</p>
          <button
            type="button"
            className="text-12 text-primary underline underline-offset-2"
            onClick={() => setShowExceptionsInAll(true)}
            data-testid="inbox-empty-show-exceptions"
          >
            显示系统异常
          </button>
        </div>
      ) : view === "board" ? (
        <div className="flex flex-1 flex-col overflow-hidden">
          {/* B6.5 无障碍：拖拽的键盘替代说明（视觉隐藏）。每张卡片 aria-describedby 指到它——
              拖拽本身没有键盘等价操作，等价操作是「打开详情 → 操作按钮」，得告诉读屏用户去哪。 */}
          <p id="inbox-drag-hint" className="sr-only">
            拖动卡片到另一列可以改变状态。键盘用户：按 Enter 或空格打开详情，详情里的操作按钮提供同样的状态迁移。
          </p>
          {/* B6.5 响应式（U8）：md 以下四列横向可滚（列容器自己 overflow-x-auto，页面不横向溢出），
              md 及以上四列并排——375 下四列并排每列只剩 ~75px，编号/类型/徽标全挤成竖条，不算"能看"。
              这里的横向滚动是写出来的设计（data-allow-x-scroll），不是从 computed style 猜的放行。 */}
          <div
            className="flex flex-1 gap-3 overflow-x-auto overflow-y-auto p-4 md:grid md:grid-cols-4"
            data-testid="inbox-board"
            data-allow-x-scroll="看板四列在 md 以下横向滚动是设计，不是内容被裁"
          >
            {INBOX_STAGE_ORDER.map((col) => {
              const colItems = filtered.filter((i) => i.stage === col);
              const colCount = counts === null || hidingExceptions ? colItems.length : counts.byStage[col];
              return (
                <div
                  key={col}
                  role="group"
                  aria-label={`${INBOX_STAGE_LABEL[col]}，${colCount} 条`}
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
                    "flex min-h-32 w-64 shrink-0 flex-col gap-2 rounded-card border border-transparent bg-panel p-2 transition-colors duration-fast md:w-auto",
                    dragOver === col && "border-primary bg-ai-tint/30",
                  )}
                >
                  <div className="flex items-center justify-between px-1 pt-0.5">
                    <span className="text-11 font-medium text-muted-foreground">{INBOX_STAGE_LABEL[col]}</span>
                    <span className="text-11 text-muted-foreground" data-testid={`inbox-column-count-${col}`}>{colCount}</span>
                  </div>
                  {colItems.map((item) => (
                    <BoardCard
                      key={item.id}
                      item={item}
                      busy={busyId === item.id}
                      highlighted={highlightId === item.id}
                      onOpen={() => setOpenId(item.id)}
                      onNavigateLink={navigateToLinked}
                      onQuickAction={(target) => void applyTransition(item, target)}
                    />
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
          highlightId={highlightId}
          onNavigateLink={navigateToLinked}
          busyId={busyId}
          onQuickAction={(item, target) => void applyTransition(item, target)}
          nextCursor={load.kind === "ready" ? load.nextCursor : null}
          loadingMore={loadingMore}
          onLoadMore={() => void loadMore()}
        />
      )}

      {open !== null && (
        <InboxDrawer
          key={open.id} // B3.7：关联跳转换条目时整体重挂，不把上一条的理由/草稿状态带过去
          item={open}
          onNavigateLink={navigateToLinked}
          busy={busyId === open.id}
          openDecline={openDeclineOnOpen}
          openIssueForm={openIssueFormOnOpen}
          onClose={() => { setOpenId(null); setOpenDeclineOnOpen(false); setOpenIssueFormOnOpen(false); }}
          onStatus={(s) => void applyTransition(open, s)}
          onArchive={(reason) => void archiveWithReason(open, reason)}
          onCreateIssue={(issueDraft) => void createGithubIssue(open, issueDraft)}
          onDeepen={() => void deepen(open)}
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

/** 关联标：反馈 → 「已生成方案」（目标 = 设计条目 id），设计 → 「源自反馈」（目标 = 反馈 id）。 */
function CardMeta({ item, onNavigateLink }: { item: InboxItem; onNavigateLink: NavigateLink }) {
  return (
    <>
      {item.resolvedByDesignId !== null && (
        <LinkBadge text="已生成方案" testid={`link-generated-${item.code}`} onClick={() => onNavigateLink(item.resolvedByDesignId!, "设计方案")} />
      )}
      {item.linkedFeedbackId !== null && (
        <LinkBadge text="源自反馈" testid={`link-from-${item.code}`} onClick={() => onNavigateLink(item.linkedFeedbackId!, "反馈")} />
      )}
    </>
  );
}

/** B3.7 高亮态：卡片/行共用，用 `ring-primary` token，不硬编码颜色。 */
const HIGHLIGHT_CLASS = "ring-2 ring-primary ring-offset-1 ring-offset-background";

/**
 * issue #2752 ③——hover 卡片/行时缺一个不用先点开详情就能做的操作动作（比如关闭）。
 * 复用 `applyTransition`（footer 按钮同一套逻辑，含「不做」落点到 drawer 理由表单、
 * 系统异常没有「已完成」这条边会被拒绝的规则），这里只挑"当前状态能一键做"的几条
 * 摆进菜单，不重造第二套状态机判断。`item.kind === "design"` 没有对应源操作，不渲染。
 */
function QuickActionMenu({
  item, busy, onQuickAction, testidPrefix,
}: {
  item: InboxItem;
  busy: boolean;
  onQuickAction: (target: InboxStage) => void;
  testidPrefix: string;
}) {
  if (item.kind === "design") return null;
  return (
    <Menu>
      <MenuTrigger asChild>
        <button
          type="button"
          aria-label="更多操作"
          disabled={busy}
          data-testid={`${testidPrefix}-menu-${item.code}`}
          onClick={(e) => e.stopPropagation()}
          className="flex h-5 w-5 items-center justify-center rounded-control text-muted-foreground transition-colors duration-fast hover:bg-muted hover:text-card-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <MoreHorizontal aria-hidden className="h-3.5 w-3.5" />
        </button>
      </MenuTrigger>
      <MenuContent align="end" onClick={(e) => e.stopPropagation()} data-testid={`${testidPrefix}-menu-content-${item.code}`}>
        {item.stage === "backlog" && (
          <MenuItem onSelect={() => onQuickAction("doing")} data-testid={`${testidPrefix}-menu-start-${item.code}`}>
            开始处理
          </MenuItem>
        )}
        {item.stage === "doing" && item.kind === "feedback" && (
          <MenuItem onSelect={() => onQuickAction("done")} data-testid={`${testidPrefix}-menu-done-${item.code}`}>
            标记已修复
          </MenuItem>
        )}
        {item.stage === "doing" && (
          <MenuItem onSelect={() => onQuickAction("backlog")} data-testid={`${testidPrefix}-menu-back-${item.code}`}>
            退回待处理
          </MenuItem>
        )}
        {(item.stage === "done" || item.stage === "archived") && (
          <MenuItem onSelect={() => onQuickAction("backlog")} data-testid={`${testidPrefix}-menu-reopen-${item.code}`}>
            重新打开
          </MenuItem>
        )}
        {(item.stage === "backlog" || item.stage === "doing") && (
          <>
            <MenuSeparator />
            <MenuItem
              onSelect={() => onQuickAction("archived")}
              data-testid={`${testidPrefix}-menu-close-${item.code}`}
              className="text-destructive focus:text-destructive"
            >
              关闭（不做）…
            </MenuItem>
          </>
        )}
      </MenuContent>
    </Menu>
  );
}

function BoardCard({
  item, busy, highlighted, onOpen, onNavigateLink, onQuickAction,
}: {
  item: InboxItem;
  busy: boolean;
  highlighted: boolean;
  onOpen: () => void;
  onNavigateLink: NavigateLink;
  onQuickAction: (target: InboxStage) => void;
}) {
  /** B6.5：拖拽进行中的可访问状态（`aria-grabbed`，ARIA 1.1 起标记 deprecated 但仍是允许的全局属性，
   *  今天没有替代品能表达"正被抓起"；读屏用户看的是 `aria-describedby` 那句键盘替代说明）。 */
  const [grabbed, setGrabbed] = React.useState(false);
  return (
    <div
      draggable={!busy}
      onDragStart={(e) => {
        e.dataTransfer.setData("text/plain", item.id);
        setGrabbed(true);
      }}
      onDragEnd={() => setGrabbed(false)}
      onClick={onOpen}
      role="button"
      tabIndex={0}
      aria-label={`${item.code} ${item.title}`}
      aria-describedby="inbox-drag-hint"
      aria-grabbed={busy ? undefined : grabbed}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
      data-testid={`inbox-card-${item.code}`}
      data-highlighted={highlighted ? "true" : undefined}
      className={cn(
        "group relative flex flex-col gap-1.5 rounded-card border border-border-subtle bg-card p-2.5 transition-colors duration-fast hover:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        busy ? "cursor-wait opacity-60" : "cursor-grab active:cursor-grabbing",
        highlighted && HIGHLIGHT_CLASS,
      )}
    >
      <div className="absolute right-1.5 top-1.5 invisible transition-opacity duration-fast group-hover:visible group-focus-within:visible">
        <QuickActionMenu item={item} busy={busy} onQuickAction={onQuickAction} testidPrefix="inbox-card" />
      </div>
      <div className="flex items-center gap-1.5 pr-5">
        <span className="font-mono text-10 text-muted-foreground">{item.code}</span>
        <KindLabel item={item} />
        {item.severe && <SevereBadge />}
      </div>
      <p className="line-clamp-2 text-12 font-medium">{item.title}</p>
      <div className="flex flex-wrap items-center gap-1">
        <CardMeta item={item} onNavigateLink={onNavigateLink} />
        {item.github !== null && <GithubBadge {...item.github} />}
      </div>
    </div>
  );
}

function ListView({
  items, stageFilter, onStageFilter, onOpen, highlightId, onNavigateLink, busyId, onQuickAction, nextCursor, loadingMore, onLoadMore,
}: {
  items: InboxItem[];
  stageFilter: StageFilter;
  onStageFilter: (s: StageFilter) => void;
  onOpen: (id: string) => void;
  highlightId: string | null;
  onNavigateLink: NavigateLink;
  busyId: string | null;
  onQuickAction: (item: InboxItem, target: InboxStage) => void;
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
      {/* B6.5（U8）：五列表格在 375 下横向可滚是设计（宽表格），不让单元格挤成一字一行。 */}
      <div className="flex-1 overflow-y-auto overflow-x-auto" data-allow-x-scroll="列表视图的五列宽表格在窄视口横向滚动是设计">
        <table className="w-full min-w-[36rem] text-12">
          <thead className="sticky top-0 bg-card">
            <tr className="border-b border-border text-left text-11 text-muted-foreground">
              <th className="px-4 py-2 font-medium">状态</th>
              <th className="px-4 py-2 font-medium">标题</th>
              <th className="px-4 py-2 font-medium">类型</th>
              <th className="px-4 py-2 font-medium">GitHub</th>
              <th className="px-4 py-2 font-medium">数量 / 时间</th>
              <th className="px-4 py-2 font-medium" aria-label="操作" />
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr
                key={item.id}
                onClick={() => onOpen(item.id)}
                data-testid={`inbox-row-${item.code}`}
                data-highlighted={highlightId === item.id ? "true" : undefined}
                className={cn(
                  "group cursor-pointer border-b border-border-subtle transition-colors duration-fast hover:bg-muted",
                  highlightId === item.id && cn(HIGHLIGHT_CLASS, "ring-inset bg-ai-tint/30"),
                )}
              >
                <td className="px-4 py-2"><StatusBadge stage={item.stage} /></td>
                <td className="px-4 py-2">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="font-mono text-10 text-muted-foreground">{item.code}</span>
                    <span className="font-medium">{item.title}</span>
                    {item.severe && <SevereBadge />}
                    <CardMeta item={item} onNavigateLink={onNavigateLink} />
                  </div>
                </td>
                <td className="px-4 py-2"><KindLabel item={item} /></td>
                <td className="px-4 py-2">{item.github !== null ? <GithubBadge {...item.github} /> : <span className="text-muted-foreground">—</span>}</td>
                <td className="px-4 py-2 text-11 text-muted-foreground">
                  {item.kind === "exception" && item.exception !== null
                    ? `${item.exception.count} 次${item.exception.affectedUsers !== null ? ` · ${item.exception.affectedUsers} 人` : ""}`
                    : new Date(item.createdAt).toLocaleDateString("zh-CN")}
                </td>
                <td className="px-2 py-2 text-right">
                  <div className="inline-flex invisible transition-opacity duration-fast group-hover:visible group-focus-within:visible">
                    <QuickActionMenu
                      item={item}
                      busy={busyId === item.id}
                      onQuickAction={(target) => onQuickAction(item, target)}
                      testidPrefix="inbox-row"
                    />
                  </div>
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

/** 缺陷/需求 → issue 标签，同旧 `admin/feedback-screen.tsx`（B3.6 已删除）的 `KIND_ISSUE_LABEL`，不重造第二份映射就手写一遍值。 */
const INBOX_KIND_ISSUE_LABEL: Record<"缺陷" | "需求", string> = { 缺陷: "bug", 需求: "enhancement" };

/** 附件 MIME → 人能看的类型名（表单附件清单 + issue 正文附件清单共用）。 */
const ATTACHMENT_MIME_LABEL: Record<string, string> = {
  "image/png": "PNG 图片",
  "image/jpeg": "JPEG 图片",
  "image/webp": "WebP 图片",
  "application/pdf": "PDF",
  "text/plain": "文本",
  "text/markdown": "Markdown",
};
function attachmentLabel(mime: string): string {
  return ATTACHMENT_MIME_LABEL[mime] ?? mime;
}

/**
 * 2026-09-05——issue 草稿**整合反馈的全部字段**（人类指令「提交的内容要整合 issues 的所有字段」）：
 * 编号 / 类型 / 正文 / 结构化字段 / 提交人 / 提交时间 / 票数 / 附件清单 / 回到收件箱的链接。
 * 结构化字段的「哪几项、叫什么」复用 `STRUCTURED_FIELDS`（唯一字段表），不在这里再抄一份。
 * 附件在这里只列**清单**（数量 / 类型 / 附件 id）——真正的文件由服务端 `triageFeedback` 推到
 * GitHub 并把图片 `![]()` / 文件链接追加到正文末尾，这里不编造一个前端拿不到的公开 URL。
 * `inboxUrl`：当前页面 `?open=<id>`，让 issue 里的人能一键回到这条反馈；SSR/测试没有 `window` 时省略。
 */
export function buildInboxIssueDraft(item: InboxItem): FeedbackIssueDraft {
  // GitHub 正文是 Markdown，这里的加粗是给 GitHub 渲染的，不是 JSX 文案（lint-design 的 MD 规则只盯 JSX）。
  const B = "**";
  const bold = (t: string) => `${B}${t}${B}`;
  const lines: string[] = [];
  const detail = item.body ?? "(正文仅组织管理员与提交人可见，分诊时请补充必要的复现上下文。)";
  lines.push(detail.trim(), "");
  if (item.feedbackKind !== null && item.structured != null) {
    const rows = STRUCTURED_FIELDS[item.feedbackKind]
      .map((f) => ({ f, v: (item.structured as Record<string, string | undefined>)[f.key] }))
      .filter((x): x is { f: (typeof STRUCTURED_FIELDS)[typeof item.feedbackKind][number]; v: string } => typeof x.v === "string" && x.v.trim() !== "");
    if (rows.length > 0) {
      lines.push("### 结构化信息");
      for (const { f, v } of rows) lines.push(f.multiline ? `${bold(f.label)}\n${v.trim()}\n` : `- ${bold(f.label)}：${v.trim()}`);
      lines.push("");
    }
  }
  lines.push("### 反馈信息");
  lines.push(`- ${bold("编号")}：${item.code}`);
  lines.push(`- ${bold("类型")}：${item.feedbackKind ?? INBOX_KIND_LABEL[item.kind]}`);
  lines.push(`- ${bold("提交人")}：${item.reporter ?? "（不可见）"}`);
  lines.push(`- ${bold("提交时间")}：${new Date(item.createdAt).toLocaleString("zh-CN")}`);
  lines.push(`- ${bold("票数")}：${item.votes}`);
  lines.push(`- ${bold("当前状态")}：${item.sourceStatus}`);
  if (item.attachments.length > 0) {
    lines.push("", `### 附件（${item.attachments.length} 个，随 issue 上传）`);
    for (const a of item.attachments) lines.push(`- ${attachmentLabel(a.mime)} · ${a.id}`);
  }
  const inboxUrl =
    typeof window !== "undefined" && window.location !== undefined
      ? `${window.location.origin}${window.location.pathname}?open=${encodeURIComponent(item.id)}`
      : null;
  lines.push("", "---", `来源：运营收件箱 · 反馈 ID ${item.id}${inboxUrl !== null ? ` · ${inboxUrl}` : ""}`);
  return {
    title: item.title,
    body: lines.join("\n"),
    labels: ["user-feedback", ...(item.feedbackKind !== null ? [INBOX_KIND_ISSUE_LABEL[item.feedbackKind]] : [])],
  };
}

/**
 * issue #2752 ②——系统异常转「不做」每次都要手填理由，量一大就是重复劳动。反馈类
 * 保持空白（每条反馈的「不做」理由都该是具体的、针对这条反馈的），只给系统异常
 * 一个可编辑的默认模板，省下"每次现想怎么写"这一步，不是不让改。
 */
const DEFAULT_EXCEPTION_DECLINE_REASON = "系统自动生成的异常，评估后判定为已知噪音或不影响用户的低优先级问题，本轮不做单独处理。";

/**
 * drawer 现查回来的 GitHub 状态换算成要展示的徽标——契约头注的派生规则（`inbox.ts`
 * `InboxGithubRef` 头注）：`linkedPullRequestsAvailable` 且非空 ⇒ 取
 * `merged` > `open` > `closed` 优先级的第一条，升级成 PR；否则用现查回来的 issue
 * 真实开关覆盖列表推断值。`check` 为 `null`（还没查/查失败）时调用方自己决定退回
 * 列表推断值，这个函数不处理那一半。
 */
function upgradeGithubBadge(status: FeedbackGithubIssueStatus): InboxGithubRef {
  if (status.linkedPullRequestsAvailable && status.linkedPullRequests.length > 0) {
    const priority = ["merged", "open", "closed"] as const;
    for (const state of priority) {
      const pr = status.linkedPullRequests.find((p) => p.state === state);
      if (pr) return { kind: "pr", number: pr.number, url: pr.url, state: pr.state };
    }
  }
  return { kind: "issue", number: status.number, url: status.url, state: status.state };
}

type GithubCheck =
  | { kind: "n/a" }
  | { kind: "loading" }
  | { kind: "ready"; status: FeedbackGithubIssueStatus }
  | { kind: "failed" };

/** 贴边详情 drawer：top:54px 贴导航栏下方，right:0 到视口底部，左侧遮罩关闭。 */
function InboxDrawer({
  item, busy, openDecline, openIssueForm, onClose, onStatus, onArchive, onCreateIssue, onDeepen, onOpenWorkbench, onNavigateLink,
}: {
  item: InboxItem;
  busy: boolean;
  /** B3.7——drawer 里的关联标点击后换成目标条目的 drawer。 */
  onNavigateLink: NavigateLink;
  /** 从看板拖到「不做」列打开：直接展开理由表单，不用再点一次「不做…」。 */
  openDecline: boolean;
  /** 2026-09-05——从「开始处理」/拖进「进行中」进来的、尚无 issue 的反馈：直接展开 issue 确认表单。 */
  openIssueForm: boolean;
  onClose: () => void;
  onStatus: (s: InboxStage) => void;
  onArchive: (reason: string) => void;
  /** B3.5——建 issue 编辑器确认后调用，走 `triageFeedback(id, "已进入迭代", null, issueDraft)`。 */
  onCreateIssue: (issueDraft: FeedbackIssueDraft) => void;
  onDeepen: () => void;
  onOpenWorkbench: () => void;
}) {
  const [declining, setDeclining] = React.useState(openDecline);
  const [reason, setReason] = React.useState(item.kind === "exception" ? DEFAULT_EXCEPTION_DECLINE_REASON : "");
  const canConfirm = reason.trim() !== "";
  const canDeepen = item.kind === "feedback" && (item.stage === "backlog" || item.stage === "doing") && item.resolvedByDesignId === null;
  /** 见文件头：转入开发要先建 issue，只对 `backlog` 且尚无 issue 的反馈成立（`doing → doing` 不会建 issue）。 */
  const needsIssueBeforeDoing = item.kind === "feedback" && item.stage === "backlog" && item.github === null;

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

  /** B3.5——drawer 展开且这条反馈挂着 github 时现查升级，见文件头。看板/列表卡片不现查。 */
  const githubPresent = item.kind === "feedback" && item.github !== null;
  const [githubCheck, setGithubCheck] = React.useState<GithubCheck>(githubPresent ? { kind: "loading" } : { kind: "n/a" });

  React.useEffect(() => {
    if (item.kind !== "feedback" || item.github === null) {
      setGithubCheck({ kind: "n/a" });
      return;
    }
    let cancelled = false;
    setGithubCheck({ kind: "loading" });
    void getFeedbackGithubIssue(item.id)
      .then((status) => { if (!cancelled) setGithubCheck({ kind: "ready", status }); })
      .catch(() => { if (!cancelled) setGithubCheck({ kind: "failed" }); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id, item.kind, githubPresent]);

  const displayedGithub: InboxGithubRef | null =
    item.github === null ? null : githubCheck.kind === "ready" ? upgradeGithubBadge(githubCheck.status) : item.github;

  const [issueDraft, setIssueDraft] = React.useState<FeedbackIssueDraft | null>(() =>
    openIssueForm && needsIssueBeforeDoing ? buildInboxIssueDraft(item) : null,
  );
  const [labelsText, setLabelsText] = React.useState(() => (issueDraft === null ? "" : issueDraft.labels.join(", ")));
  const openIssueDraftForm = () => {
    const draft = buildInboxIssueDraft(item);
    setIssueDraft(draft);
    setLabelsText(draft.labels.join(", "));
  };

  /** 评论区（见文件头）：仅挂着 issue 的反馈；`n/a` 时整块不渲染。 */
  const [comments, setComments] = React.useState<
    { kind: "n/a" } | { kind: "loading" } | { kind: "ready"; items: readonly GithubIssueComment[] } | { kind: "failed" }
  >(githubPresent ? { kind: "loading" } : { kind: "n/a" });
  const [commentBody, setCommentBody] = React.useState("");
  const [commentBusy, setCommentBusy] = React.useState(false);
  const [commentError, setCommentError] = React.useState<string | null>(null);
  const loadComments = React.useCallback(async () => {
    setComments({ kind: "loading" });
    try {
      const rows = await listFeedbackGithubIssueComments(item.id);
      setComments({ kind: "ready", items: rows });
    } catch {
      setComments({ kind: "failed" });
    }
  }, [item.id]);
  React.useEffect(() => {
    if (!githubPresent) {
      setComments({ kind: "n/a" });
      return;
    }
    let cancelled = false;
    setComments({ kind: "loading" });
    void listFeedbackGithubIssueComments(item.id)
      .then((rows) => { if (!cancelled) setComments({ kind: "ready", items: rows }); })
      .catch(() => { if (!cancelled) setComments({ kind: "failed" }); });
    return () => { cancelled = true; };
  }, [item.id, githubPresent]);
  const submitComment = async () => {
    const body = commentBody.trim();
    if (body === "") return;
    setCommentBusy(true);
    setCommentError(null);
    try {
      await commentOnFeedbackGithubIssue(item.id, body);
      setCommentBody("");
      await loadComments();
    } catch (err) {
      setCommentError(`评论没发出去（${describeFailure(err)}）`);
    } finally {
      setCommentBusy(false);
    }
  };

  /** B6.5：打开时焦点进 drawer、Esc 关闭、关闭后焦点回到触发卡片（见 `use-dialog-focus.ts`）。 */
  const panelRef = React.useRef<HTMLElement>(null);
  useDialogFocus(panelRef, onClose);

  return (
    <>
      <div className="fixed inset-x-0 bottom-0 top-[54px] z-40 bg-inverse/30" onClick={onClose} aria-hidden data-testid="inbox-drawer-scrim" />
      {/* 宽度：28rem 上限 + max-w-full ⇒ 375 下自然全宽（U8，不另写断点）。 */}
      <aside
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={`${item.code} ${item.title}`}
        data-testid="inbox-drawer"
        className="fixed bottom-0 right-0 top-[54px] z-40 flex w-[28rem] max-w-full flex-col overflow-hidden border-l border-border bg-card shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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

          <div className="flex flex-wrap items-center gap-1.5" data-testid="inbox-drawer-github">
            <CardMeta item={item} onNavigateLink={onNavigateLink} />
            {item.github !== null && (
              githubCheck.kind === "loading" ? (
                <span className="h-4 w-24 animate-pulse rounded-control bg-muted" data-testid="inbox-drawer-github-loading" />
              ) : (
                <>
                  {displayedGithub !== null && <GithubBadge {...displayedGithub} />}
                  {/* 徽标升级成 PR 后 issue 本体也要能点开；每条关联 PR 各一枚可点的徽标（见文件头）。 */}
                  {githubCheck.kind === "ready" && displayedGithub?.kind === "pr" && (
                    <GithubBadge kind="issue" number={githubCheck.status.number} url={githubCheck.status.url} state={githubCheck.status.state} />
                  )}
                  {githubCheck.kind === "ready" &&
                    githubCheck.status.linkedPullRequests
                      .filter((pr) => !(displayedGithub?.kind === "pr" && displayedGithub.number === pr.number))
                      .map((pr) => <GithubBadge key={pr.number} kind="pr" number={pr.number} url={pr.url} state={pr.state} />)}
                </>
              )
            )}
            {githubCheck.kind === "failed" && (
              <span className="text-10 text-muted-foreground" data-testid="inbox-drawer-github-check-failed">
                GitHub 状态现查失败，显示为列表推断值
              </span>
            )}
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
                      {e.notified && (
                        <span className="ml-1.5 inline-flex items-center gap-0.5 text-muted-foreground" title={e.emailSubject ?? undefined} data-testid="inbox-drawer-timeline-notified">
                          <Mail aria-hidden className="h-3 w-3" /> 已邮件通知提交人
                        </span>
                      )}
                    </li>
                  ))}
                </ol>
              )}
            </div>
          )}

          {/* issue 评论区（见文件头）：看得到开发那边在 issue 上写了什么，也能直接回。 */}
          {comments.kind !== "n/a" && (
            <div data-testid="inbox-github-comments">
              <p className="mb-1.5 flex items-center gap-1 text-10 font-medium text-muted-foreground">
                <MessageSquare aria-hidden className="h-3 w-3" /> GitHub Issue 评论
              </p>
              {comments.kind === "loading" && <p className="text-11 text-muted-foreground">读取中…</p>}
              {comments.kind === "failed" && (
                <p className="text-11 text-muted-foreground" data-testid="inbox-github-comments-failed">
                  评论没读到。<button type="button" className="underline underline-offset-2" onClick={() => void loadComments()}>重试</button>
                </p>
              )}
              {comments.kind === "ready" && (
                <ol className="flex flex-col gap-2" data-testid="inbox-github-comments-list">
                  {comments.items.length === 0 && <li className="text-11 text-muted-foreground">issue 下还没有评论。</li>}
                  {comments.items.map((c) => (
                    <li key={c.id} className="rounded-card border border-border-subtle bg-panel p-2" data-testid={`inbox-github-comment-${c.id}`}>
                      <div className="flex items-center justify-between gap-2 text-10 text-muted-foreground">
                        <span>{c.author ?? "（未知账号）"}</span>
                        <a href={c.url} target="_blank" rel="noopener noreferrer" className="underline-offset-2 transition-colors duration-fast hover:text-card-foreground hover:underline">
                          {new Date(c.createdAt).toLocaleString("zh-CN")}
                        </a>
                      </div>
                      <p className="mt-1 whitespace-pre-wrap break-words text-12 text-card-foreground">{c.body}</p>
                    </li>
                  ))}
                </ol>
              )}
              <div className="mt-2 flex flex-col gap-1.5">
                <Textarea
                  value={commentBody}
                  onChange={(e) => setCommentBody(e.target.value)}
                  rows={2}
                  maxLength={4000}
                  placeholder="在 GitHub issue 下发一条评论…"
                  aria-label="GitHub issue 评论"
                  data-testid="inbox-github-comment-input"
                />
                {commentError !== null && <p className="text-10 text-destructive" data-testid="inbox-github-comment-error">{commentError}</p>}
                <div className="flex justify-end">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={commentBusy || commentBody.trim() === ""}
                    onClick={() => void submitComment()}
                    data-testid="inbox-github-comment-submit"
                  >
                    {commentBusy && <Loader2 aria-hidden className="h-3.5 w-3.5 animate-spin" />}
                    发评论
                  </Button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* 操作区：随状态显示可用动作 */}
        <footer className="flex flex-col gap-2 border-t border-border p-4">
          {issueDraft !== null ? (
            <div className="flex flex-col gap-1.5" data-testid="inbox-issue-form">
              <p className="text-11 font-medium text-muted-foreground">
                转入开发会同时在 boardx/workspacex 建一个 GitHub issue，请确认内容后提交（可编辑）：
              </p>
              <div className="rounded-card border border-border-subtle bg-panel p-2 text-11" data-testid="inbox-issue-attachments">
                <p className="flex items-center gap-1 font-medium text-muted-foreground">
                  <Paperclip aria-hidden className="h-3 w-3" />
                  {item.attachments.length === 0
                    ? "这条反馈没有附件。"
                    : `${item.attachments.length} 个附件将随 issue 上传到 GitHub：`}
                </p>
                {item.attachments.length > 0 && (
                  <ul className="mt-1 flex flex-col gap-0.5 text-muted-foreground">
                    {item.attachments.map((a) => (
                      <li key={a.id} className="font-mono text-10" data-testid={`inbox-issue-attachment-${a.id}`}>
                        {attachmentLabel(a.mime)} · {a.id}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <label className="flex flex-col gap-1">
                <span className="text-10 text-muted-foreground">标题</span>
                <input
                  value={issueDraft.title}
                  onChange={(e) => setIssueDraft({ ...issueDraft, title: e.target.value })}
                  data-testid="inbox-issue-title"
                  className="h-8 rounded-control border border-border-subtle bg-card px-2 text-12"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-10 text-muted-foreground">正文</span>
                <Textarea
                  value={issueDraft.body}
                  onChange={(e) => setIssueDraft({ ...issueDraft, body: e.target.value })}
                  rows={5}
                  data-testid="inbox-issue-body"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-10 text-muted-foreground">标签（逗号分隔）</span>
                <input
                  value={labelsText}
                  onChange={(e) => {
                    setLabelsText(e.target.value);
                    setIssueDraft({
                      ...issueDraft,
                      labels: e.target.value.split(",").map((l) => l.trim()).filter((l) => l !== ""),
                    });
                  }}
                  data-testid="inbox-issue-labels"
                  className="h-8 rounded-control border border-border-subtle bg-card px-2 font-mono text-12"
                />
              </label>
              <div className="flex justify-end gap-2">
                <Button variant="ghost" size="sm" onClick={() => { setIssueDraft(null); setLabelsText(""); }}>取消</Button>
                <Button
                  variant="primary"
                  size="sm"
                  disabled={busy || issueDraft.title.trim() === ""}
                  onClick={() => onCreateIssue(issueDraft)}
                  data-testid="inbox-issue-submit"
                >
                  {busy && <Loader2 aria-hidden className="h-3.5 w-3.5 animate-spin" />}
                  确认转入开发，创建 issue
                </Button>
              </div>
            </div>
          ) : declining ? (
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
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setDeclining(false);
                    setReason(item.kind === "exception" ? DEFAULT_EXCEPTION_DECLINE_REASON : "");
                  }}
                >
                  取消
                </Button>
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
                <Button
                  variant="primary"
                  size="sm"
                  disabled={busy}
                  onClick={() => (needsIssueBeforeDoing ? openIssueDraftForm() : onStatus("doing"))}
                  data-testid="inbox-action-start"
                >
                  {needsIssueBeforeDoing ? <Github aria-hidden className="h-3.5 w-3.5" /> : <Play aria-hidden className="h-3.5 w-3.5" />}
                  {needsIssueBeforeDoing ? "转入开发（建 GitHub Issue）" : "开始处理"}
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
