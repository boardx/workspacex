"use client";
import * as React from "react";
import { LayoutList, Columns3, Search, ShieldAlert, PlugZap, Lock, Eye, ChevronUp, ChevronDown, Archive, Tag, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { UiState } from "@/lib/ui-state";
import {
  getInboxCounts,
  listInbox,
  reorderInboxItem,
  setInboxItemTags,
  INBOX_KIND_LABEL,
  INBOX_KIND_OPTIONS,
  INBOX_STAGE_LABEL,
  INBOX_STAGE_ORDER,
  isArchivedInboxItem,
  type GetInboxCountsOut,
  type InboxItem,
  type InboxKind,
  type InboxStage,
  type InboxView,
} from "@/lib/live-inbox";
import { canArchiveInboxItem, moveAdjacent, reorderIds, sortByBoardOrder } from "./board-reorder";
import { triageFeedback, getFeedbackGithubIssue, deepenFeedback, type FeedbackStatus, type FeedbackIssueDraft } from "@/lib/live-feedback";
import { createDesignGithubIssue } from "@/lib/live-design-workbench";
import { updateSystemErrorLifecycle, type SystemErrorStatus } from "@/lib/live-system-errors";
import { GithubBadge, SevereBadge } from "./badges";
import { CardMeta, ExceptionRecurrence, HIGHLIGHT_CLASS, KindLabel, LoadMoreBar, QuickActionMenu, describeFailure, type NavigateLink } from "./inbox-shared";
import { InboxDrawer } from "./inbox-drawer";
import { InboxListView, type StageFilter } from "./inbox-list-view";
import { TagEditor } from "./inbox-tags";

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
 *   · **2026-09-08 五条人类指令（截图复盘）**：
 *       ① 同一系统异常只显示一条——服务端按 `msg` 折叠（契约 `InboxExceptionMeta` 头注），卡片上
 *          显示「×N · 最近 <时间>」，drawer 里有「发生记录」；前端不再为重复行各画一张卡。
 *       ② 列高与卡片一致——看板容器 `min-h-0` 吃满剩余高度，**每一列自己滚动**（列头固定），
 *          卡片永远在列的底色之内，不会堆出列的范围；四列等高。
 *       ③ 归档有处可看——`已归档` 的反馈离开看板（服务端默认视图不含它，见契约
 *          `isArchivedInboxItem`），工具条的「归档箱」按钮切到 `view: "archived"` 的列表视图，
 *          「重新打开」把它送回待处理。
 *       ④ 列表视图重做——见 `inbox-list-view.tsx` 头注。
 *       ⑤ 标签——卡片 / 行 / drawer 三处同一份 `TagEditor` 增删（写路径按 `kind` 选：异常走
 *          `updateSystemErrorLifecycle`，反馈 / 设计方案走 `setInboxItemTags`），工具条下方按
 *          `counts.byTag` 渲染标签筛选 Chip，点卡片上的标签也能筛（服务端 `tag` 参数，分页之前）。
 *     文件按 2000 行纪律拆成 `inbox-shared.tsx` / `inbox-drawer.tsx` / `inbox-list-view.tsx` / `inbox-tags.tsx`。
 */

type KindFilter = "all" | InboxKind;

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

/** 工具条下方标签筛选 Chip 最多展示这么多个（其余在「更多」里），避免标签多了把工具条挤成两屏。 */
const TAG_CHIP_LIMIT = 12;

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
  /** 2026-09-08 ③——`archived` = 归档箱（服务端 `view`），只有列表视图。 */
  const [inboxView, setInboxView] = React.useState<InboxView>("active");
  const archivedView = inboxView === "archived";
  /** 2026-09-08 ⑤——标签筛选（服务端 `tag`），`null` = 不筛。 */
  const [tagFilter, setTagFilter] = React.useState<string | null>(null);
  const [showAllTags, setShowAllTags] = React.useState(false);
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
        tag: tagFilter ?? undefined,
        view: inboxView,
        limit: PAGE_LIMIT,
      });
      setLoad({ kind: "ready", items: [...out.items], nextCursor: out.nextCursor, sources: out.sources });
    } catch (err) {
      setLoad({ kind: "failed", reason: describeFailure(err) });
    }
  }, [kindFilter, hidingExceptions, query, tagFilter, inboxView]);

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
        listInbox({
          kind: kindFilter === "all" ? undefined : kindFilter,
          excludeKind: hidingExceptions ? "exception" : undefined,
          q: query === "" ? undefined : query,
          tag: tagFilter ?? undefined,
          view: inboxView,
          limit: PAGE_LIMIT,
        }),
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
  }, [kindFilter, hidingExceptions, query, tagFilter, inboxView]);

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
        tag: tagFilter ?? undefined,
        view: inboxView,
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
    (i) => archivedView || stageFilter === "all" || i.stage === stageFilter,
  );
  /** 标签 Chip 的来源是 `counts.byTag`（活跃条目全集，服务端算），当前筛选中的标签即使不在前 N 也要显示。 */
  const tagChips = React.useMemo(() => {
    const all = counts?.byTag ?? [];
    const shown = showAllTags ? all : all.slice(0, TAG_CHIP_LIMIT);
    if (tagFilter !== null && !shown.some((t) => t.tag === tagFilter)) {
      const found = all.find((t) => t.tag === tagFilter);
      return [...shown, found ?? { tag: tagFilter, count: 0 }];
    }
    return shown;
  }, [counts, showAllTags, tagFilter]);
  const hiddenTagCount = Math.max(0, (counts?.byTag.length ?? 0) - TAG_CHIP_LIMIT);
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

  /** 条目离开当前视图（归档 / 从归档箱重新打开）：本地直接移除，不等下一次轮询。 */
  const removeItem = (id: string) =>
    setLoad((prev) => (prev.kind === "ready" ? { ...prev, items: prev.items.filter((i) => i.id !== id) } : prev));

  /** 归档箱条数乐观跟随（`counts.archived` 与 `byStage`/`total` 互斥，见契约 `getInboxCounts` 头注）。 */
  const bumpArchived = (delta: number, activeStage: InboxStage) =>
    setCounts((prev) =>
      prev === null
        ? prev
        : {
            ...prev,
            archived: Math.max(0, prev.archived + delta),
            total: Math.max(0, prev.total - delta),
            byKind: { ...prev.byKind, feedback: Math.max(0, prev.byKind.feedback - delta) },
            byStage: { ...prev.byStage, [activeStage]: Math.max(0, prev.byStage[activeStage] - delta) },
          },
    );

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
    // 2026-09-08 ③——归档箱里「重新打开」：这条会离开归档箱回到看板，本地直接移除 + 计数跟随；
    // 失败时把它放回列表（`items` 是按 id 合并的，放回原对象即可）。
    const leavingArchive = isArchivedInboxItem(item);
    if (leavingArchive) {
      removeItem(item.id);
      bumpArchived(-1, targetStage);
    } else {
      replaceItem(item.id, { stage: targetStage });
      bumpStageCount(prevStage, targetStage);
    }
    setBusyId(item.id);
    try {
      if (item.kind === "feedback") {
        await triageFeedback(item.id, status as FeedbackStatus, null, null);
      } else {
        await updateSystemErrorLifecycle(item.id, { status: status as SystemErrorStatus });
      }
      flashSaved(leavingArchive ? `已重新打开，回到「${INBOX_STAGE_LABEL[targetStage]}」` : `已移动到「${INBOX_STAGE_LABEL[targetStage]}」`);
      if (leavingArchive) setOpenId(null);
    } catch (err) {
      if (leavingArchive) {
        setLoad((prev) => (prev.kind === "ready" ? { ...prev, items: [item, ...prev.items] } : prev));
        bumpArchived(1, targetStage);
      } else {
        replaceItem(item.id, { stage: prevStage });
        bumpStageCount(targetStage, prevStage);
      }
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
    // 2026-09-05「转开发」——设计方案走自己的那条操作（`POST /pm-designs/:id/github-issue`）。
    // 它与反馈那条**不是同一件事**：反馈是"转状态顺便建 issue"（issue 是 `triageFeedback`
    // 的副作用），方案是"建 issue 本身就是这次操作"（方案没有状态机，stage 由有没有 issue
    // 派生，见契约 `designStageOf`）。共用同一个编辑器 UI，落到两条不同的后端操作上。
    if (item.kind === "design") return await createDesignIssue(item, issueDraft);
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

  /**
   * 2026-09-05「转开发」——设计方案建 issue。
   *
   * 与反馈那条的差别（除了调用的操作不同）：
   *   · stage 不是"我们决定转成 doing"，而是**服务端返回的项目已经有了 issue** 这一事实的
   *     派生结果（`designStageOf`）。所以乐观更新直接把 `github` 和 `stage` 一起落，
   *     不需要像反馈那样先转状态、再单独现查一次徽标——这条操作的返回值里就带着项目。
   *   · 失败不需要回滚 stage：这次操作根本没改过状态，失败前后 stage 都是 `backlog`。
   */
  const createDesignIssue = async (item: InboxItem, issueDraft: FeedbackIssueDraft) => {
    const prevStage = item.stage;
    setBusyId(item.id);
    try {
      const out = await createDesignGithubIssue(item.id, issueDraft);
      const number = out.project.githubIssueNumber;
      const url = out.project.githubIssueUrl;
      if (number !== null && url !== null) {
        replaceItem(item.id, { stage: "doing", github: { kind: "issue", number, url, state: "open" } });
        bumpStageCount(prevStage, "doing");
      }
      setOpenIssueFormOnOpen(false);
      flashSaved("已创建 GitHub Issue，方案已转入开发");
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
   * 2026-09-06——显式「归档」动作（不是「不做」的同义词）：沿用 `不做` 列，触发已有的
   * `已归档` 状态（`triageFeedback(id, "已归档")`）。`已归档` 不需要理由——见契约
   * `feedback-loop.ts` 的 `TRIAGE_REASON_REQUIRED` 只在转 `不做` 时触发，`已归档` 不在
   * 那条规则里，所以不像「不做」那样落到 drawer 的理由表单,直接乐观迁移。
   * 显示条件（`canArchiveInboxItem`）已经在按钮/菜单项那一层判过，这里只再判一次
   * 兜底——被绕过判定条件调用时不发一个注定会被状态机拒绝的请求。
   */
  const archiveItem = async (item: InboxItem) => {
    if (!canArchiveInboxItem(item)) return;
    const prevStage = item.stage;
    // 2026-09-08 ③——归档 = 离开看板进「归档箱」（服务端默认视图不含已归档，见契约
    // `isArchivedInboxItem`），不再挪到「不做」列；本地直接移除 + 归档箱计数 +1。
    removeItem(item.id);
    bumpArchived(1, prevStage);
    if (openId === item.id) setOpenId(null);
    setBusyId(item.id);
    try {
      await triageFeedback(item.id, "已归档", null, null);
      flashSaved("已归档，可在「归档箱」里查看");
    } catch (err) {
      setLoad((prev) => (prev.kind === "ready" ? { ...prev, items: [item, ...prev.items] } : prev));
      bumpArchived(-1, prevStage);
      setDragError(`没能归档（${describeFailure(err)}），已恢复`);
      window.setTimeout(() => setDragError(null), 3000);
    } finally {
      setBusyId(null);
    }
  };

  /**
   * 2026-09-06——列内排序（拖拽排序 / ↑↓ 按钮共用）落库。`newOrderIds` 是这一列
   * 排序后的**完整**新顺序（`board-reorder.ts` 算好），本地先乐观按下标重赋
   * `boardOrder`，失败回滚成调用前各条目原有的值——同其余卡片操作的乐观更新节奏。
   * ⚠ 与跨列拖拽（`applyTransition`）是两条不同的路径：这条**不改 `stage`**，
   *   服务端那条操作（`reorderInboxItem`）本来就不接受任何状态相关的字段。
   */
  const applyReorder = (stage: InboxStage, prevIds: readonly string[], newOrderIds: readonly string[]) => {
    if (newOrderIds.length === 0 || newOrderIds.every((id, i) => id === prevIds[i])) return;
    const prevOrders = new Map(items.filter((i) => newOrderIds.includes(i.id)).map((i) => [i.id, i.boardOrder] as const));
    const nextOrders = new Map(newOrderIds.map((id, idx) => [id, idx] as const));
    setLoad((prev) =>
      prev.kind === "ready"
        ? { ...prev, items: prev.items.map((i) => (nextOrders.has(i.id) ? { ...i, boardOrder: nextOrders.get(i.id)! } : i)) }
        : prev,
    );
    const payload = newOrderIds.map((id) => {
      const found = items.find((i) => i.id === id);
      return { kind: (found?.kind ?? "feedback") as InboxKind, id };
    });
    void reorderInboxItem(stage, payload).catch((err) => {
      setLoad((prev) =>
        prev.kind === "ready"
          ? { ...prev, items: prev.items.map((i) => (prevOrders.has(i.id) ? { ...i, boardOrder: prevOrders.get(i.id)! } : i)) }
          : prev,
      );
      setDragError(`没能保存排序（${describeFailure(err)}），已恢复原顺序`);
      window.setTimeout(() => setDragError(null), 3000);
    });
  };

  /**
   * 2026-09-05——系统异常的「开发备注」保存。
   *
   * 写路径**复用**已经存在的 `updateSystemErrorLifecycle`（`PUT /system/error-logs/:id`），
   * 不新增操作：契约头注写明「`status` 省略 = 不改状态，只改 `devNote`/`tags`」。⚠ 一定不能
   * 顺手带上 `statusReason`——契约的 `REASON_REQUIRES_STATUS` 会拒。
   * 乐观更新同 `applyTransition`：先落本地，失败回滚成调用前的值。
   */
  const saveExceptionDev = async (item: InboxItem, patch: { devNote?: string | null }) => {
    if (item.kind !== "exception" || item.exception === null) return;
    const before = item.exception;
    setBusyId(item.id);
    try {
      await updateSystemErrorLifecycle(item.id, patch);
      replaceItem(item.id, { exception: { ...before, devNote: patch.devNote !== undefined ? patch.devNote : before.devNote } });
      flashSaved("开发备注已保存");
    } catch (err) {
      replaceItem(item.id, { exception: before });
      setDragError(`没能保存（${describeFailure(err)}）`);
      window.setTimeout(() => setDragError(null), 3000);
    } finally {
      setBusyId(null);
    }
  };

  /**
   * 2026-09-08 ⑤——标签保存，三类共用一个入口、**按 `kind` 选写路径**（契约 `InboxItem` 头注「`tags`」）：
   * 系统异常 → `updateSystemErrorLifecycle(id, { tags })`（`error_logs.tags`）；
   * 反馈 / 设计方案 → `setInboxItemTags(kind, id, tags)`（侧表 `inbox_item_tags`）。
   * 乐观更新 + 失败回滚；成功后重拉一次计数，让工具条的标签 Chip 立刻出现新标签。
   */
  const saveTags = async (item: InboxItem, tags: readonly string[]) => {
    const before = item.tags;
    replaceItem(item.id, { tags: [...tags] });
    setBusyId(item.id);
    try {
      if (item.kind === "exception") {
        await updateSystemErrorLifecycle(item.id, { tags });
      } else {
        const out = await setInboxItemTags(item.kind, item.id, tags);
        replaceItem(item.id, { tags: [...out.tags] });
      }
      flashSaved("标签已保存");
      void reloadCounts();
    } catch (err) {
      replaceItem(item.id, { tags: before });
      setDragError(`没能保存标签（${describeFailure(err)}）`);
      window.setTimeout(() => setDragError(null), 3000);
    } finally {
      setBusyId(null);
    }
  };

  /** 点卡片 / 行 / drawer / Chip 上的标签 ⇒ 按它筛选（再点一次同一个 = 取消）。 */
  const filterByTag = (tag: string | null) => {
    setTagFilter((prev) => (prev === tag ? null : tag));
    setOpenId(null);
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
      {/* 工具条：视图切换 + 类型 chip + 归档箱 + 搜索 */}
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
        <div className="flex items-center gap-0.5 rounded-control border border-border p-0.5">
          <ViewToggle active={view === "board" && !archivedView} disabled={archivedView} onClick={() => setView("board")} testid="inbox-view-board" icon={Columns3} label="看板" />
          <ViewToggle active={view === "list" || archivedView} onClick={() => setView("list")} testid="inbox-view-list" icon={LayoutList} label="列表" />
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
                  {count !== null && !archivedView && <span className="text-10 opacity-70">{count}</span>}
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
          {kindFilter === "all" && exceptionWithheld !== true && !archivedView && (
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
        {/* 2026-09-08 ③——归档箱入口：切到 `view: "archived"`（只有列表视图），徽标是 `counts.archived`。 */}
        <button
          type="button"
          aria-pressed={archivedView}
          onClick={() => { setInboxView((v) => (v === "archived" ? "active" : "archived")); setOpenId(null); }}
          data-testid="inbox-toggle-archived"
          className={cn(
            "inline-flex items-center gap-1 rounded-control border px-2.5 py-1 text-12 transition-colors duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            archivedView ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-card-foreground hover:bg-muted",
          )}
        >
          <Archive aria-hidden className="h-3 w-3" />
          归档箱
          {counts !== null && <span className="text-10 opacity-70" data-testid="inbox-archived-count">{counts.archived}</span>}
        </button>
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
      {/* 2026-09-08 ⑤——标签筛选：来源是 `counts.byTag`（活跃条目全集）。没有任何标签时整行不渲染。 */}
      {(tagChips.length > 0 || tagFilter !== null) && (
        <div className="flex flex-wrap items-center gap-1 border-b border-border px-4 py-2" role="group" aria-label="标签筛选" data-testid="inbox-tag-filter">
          <Tag aria-hidden className="mr-0.5 h-3.5 w-3.5 text-muted-foreground" />
          {tagChips.map(({ tag, count }) => (
            <button
              key={tag}
              type="button"
              aria-pressed={tagFilter === tag}
              onClick={() => filterByTag(tag)}
              data-testid={`inbox-tag-filter-${tag}`}
              className={cn(
                "inline-flex items-center gap-1 rounded-control border px-2 py-0.5 text-11 transition-colors duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                tagFilter === tag ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-card-foreground hover:bg-muted",
              )}
            >
              {tag}
              <span className="text-10 opacity-70">{count}</span>
            </button>
          ))}
          {hiddenTagCount > 0 && (
            <button
              type="button"
              onClick={() => setShowAllTags((v) => !v)}
              data-testid="inbox-tag-filter-more"
              className="rounded-control px-1.5 py-0.5 text-11 text-muted-foreground transition-colors duration-fast hover:bg-muted hover:text-card-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {showAllTags ? "收起" : `还有 ${hiddenTagCount} 个…`}
            </button>
          )}
          {tagFilter !== null && (
            <button
              type="button"
              onClick={() => filterByTag(null)}
              data-testid="inbox-tag-filter-clear"
              className="ml-1 inline-flex items-center gap-0.5 rounded-control px-1.5 py-0.5 text-11 text-muted-foreground transition-colors duration-fast hover:bg-muted hover:text-card-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <X aria-hidden className="h-3 w-3" /> 清除标签筛选
            </button>
          )}
        </div>
      )}

      {items.length === 0 && !onlyExceptionsHidden && !archivedView ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-1 p-16 text-center" data-testid="empty">
          <p className="text-14 font-medium">收件箱是空的</p>
          <p className="text-12 text-muted-foreground">
            {kindFilter !== "all" || query !== "" || tagFilter !== null ? "没有符合当前筛选的条目。" : "用户提交需求 / 缺陷反馈或推送设计方案后，都会汇总到这里；系统异常单独查看。"}
          </p>
        </div>
      ) : visibleItems.length === 0 && !archivedView ? (
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
      ) : view === "board" && !archivedView ? (
        <div className="flex min-h-0 flex-1 flex-col">
          {/* B6.5 无障碍：拖拽的键盘替代说明（视觉隐藏）。每张卡片 aria-describedby 指到它——
              拖拽本身没有键盘等价操作，等价操作是「打开详情 → 操作按钮」，得告诉读屏用户去哪。 */}
          <p id="inbox-drag-hint" className="sr-only">
            拖动卡片到另一列可以改变状态。键盘用户：按 Enter 或空格打开详情，详情里的操作按钮提供同样的状态迁移。
          </p>
          {/* 2026-09-08 ②——看板容器 `min-h-0 flex-1` 吃满屏幕剩余高度，四列等高；**每一列自己滚动**
              （列头固定在列顶），卡片再多也只在列的底色范围内滚，不会堆出列外。
              B6.5 响应式（U8）：md 以下四列横向可滚（列容器自己 overflow-x-auto，页面不横向溢出），
              md 及以上四列并排——这里的横向滚动是写出来的设计（data-allow-x-scroll），不是从 computed style 猜的放行。 */}
          <div
            className="flex min-h-0 flex-1 gap-3 overflow-x-auto p-4 md:grid md:grid-cols-4"
            data-testid="inbox-board"
            data-allow-x-scroll="看板四列在 md 以下横向滚动是设计，不是内容被裁"
          >
            {INBOX_STAGE_ORDER.map((col) => {
              // 列内展示顺序：`boardOrder` 升序（`board-reorder.ts`）——跨列拖拽只改 `stage`，
              // 不动这个值,所以刚被拖进来的卡片仍按它旧的 `boardOrder` 落座,不是恒在列尾/列首。
              const colItems = sortByBoardOrder(filtered.filter((i) => i.stage === col));
              const colIds = colItems.map((i) => i.id);
              const colCount = counts === null || hidingExceptions || tagFilter !== null ? colItems.length : counts.byStage[col];
              /** 同列内拖拽 = 排序；跨列拖拽 = 状态迁移。`beforeId===null` 表示拖到列尾（空白处）。 */
              const dropInColumn = (draggedId: string, beforeId: string | null) => {
                const dragged = items.find((i) => i.id === draggedId);
                if (dragged === undefined) return;
                if (dragged.stage === col) {
                  applyReorder(col, colIds, reorderIds(colIds, draggedId, beforeId));
                } else {
                  void applyTransition(dragged, col);
                }
              };
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
                    // 落在列的空白处（没有命中任何一张卡片）：跨列迁移或挪到列尾。
                    dropInColumn(id, null);
                  }}
                  className={cn(
                    "flex min-h-0 w-64 shrink-0 flex-col rounded-card border border-transparent bg-panel transition-colors duration-fast md:w-auto",
                    dragOver === col && "border-primary bg-ai-tint/30",
                  )}
                >
                  <div className="flex shrink-0 items-center justify-between px-3 pb-1.5 pt-2.5">
                    <span className="text-11 font-medium text-muted-foreground">{INBOX_STAGE_LABEL[col]}</span>
                    <span className="rounded-control bg-card px-1.5 py-0.5 text-10 text-muted-foreground" data-testid={`inbox-column-count-${col}`}>{colCount}</span>
                  </div>
                  <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-2 pb-2" data-testid={`inbox-column-body-${col}`}>
                    {colItems.length === 0 && (
                      <p className="rounded-card border border-dashed border-border-subtle px-2 py-4 text-center text-11 text-muted-foreground">
                        {dragOver === col ? "松开放到这里" : "暂无条目"}
                      </p>
                    )}
                    {colItems.map((item, idx) => (
                      <BoardCard
                        key={item.id}
                        item={item}
                        busy={busyId === item.id}
                        highlighted={highlightId === item.id}
                        onOpen={() => setOpenId(item.id)}
                        onNavigateLink={navigateToLinked}
                        onQuickAction={(target) => void applyTransition(item, target)}
                        onArchive={() => void archiveItem(item)}
                        onSaveTags={(tags) => void saveTags(item, tags)}
                        onFilterTag={(tag) => filterByTag(tag)}
                        // B6.5：拖拽的非拖拽等价操作——列首/列尾对应方向禁用。
                        canMoveUp={idx > 0}
                        canMoveDown={idx < colItems.length - 1}
                        onMoveUp={() => applyReorder(col, colIds, moveAdjacent(colIds, item.id, "up"))}
                        onMoveDown={() => applyReorder(col, colIds, moveAdjacent(colIds, item.id, "down"))}
                        // 落到这张卡片上 ⇒ 插到它前面（同列）或触发跨列迁移（不同列）。
                        onDropOnCard={(draggedId) => dropInColumn(draggedId, item.id)}
                      />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
          <LoadMoreBar nextCursor={load.kind === "ready" ? load.nextCursor : null} loading={loadingMore} onLoadMore={() => void loadMore()} />
        </div>
      ) : (
        <InboxListView
          items={filtered}
          stageFilter={stageFilter}
          onStageFilter={setStageFilter}
          onOpen={setOpenId}
          highlightId={highlightId}
          onNavigateLink={navigateToLinked}
          busyId={busyId}
          onQuickAction={(item, target) => void applyTransition(item, target)}
          onArchive={(item) => void archiveItem(item)}
          onSaveTags={(item, tags) => void saveTags(item, tags)}
          onFilterTag={(tag) => filterByTag(tag)}
          archivedView={archivedView}
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
          onSaveExceptionDev={(patch) => void saveExceptionDev(open, patch)}
          onSaveTags={(tags) => void saveTags(open, tags)}
          onFilterTag={(tag) => filterByTag(tag)}
        />
      )}
    </div>
  );
}

function ViewToggle({ active, disabled, onClick, testid, icon: Icon, label }: { active: boolean; disabled?: boolean; onClick: () => void; testid: string; icon: typeof Columns3; label: string }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      data-testid={testid}
      title={disabled ? "归档箱只有列表视图" : undefined}
      className={cn(
        "inline-flex items-center gap-1 rounded-control px-2 py-1 text-12 transition-colors duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:bg-disabled disabled:text-disabled-foreground",
        active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted",
      )}
    >
      <Icon aria-hidden className="h-3.5 w-3.5" />
      {label}
    </button>
  );
}

function BoardCard({
  item, busy, highlighted, onOpen, onNavigateLink, onQuickAction, onArchive, onSaveTags, onFilterTag,
  canMoveUp, canMoveDown, onMoveUp, onMoveDown, onDropOnCard,
}: {
  item: InboxItem;
  busy: boolean;
  highlighted: boolean;
  onOpen: () => void;
  onNavigateLink: NavigateLink;
  onQuickAction: (target: InboxStage) => void;
  onArchive: () => void;
  /** 2026-09-08 ⑤——卡片上的标签增删 / 点标签筛选（同一份 `TagEditor`，见 `inbox-tags.tsx`）。 */
  onSaveTags: (tags: readonly string[]) => void;
  onFilterTag: (tag: string) => void;
  /** B6.5：拖拽（列内排序）的非拖拽等价操作——见 `board-reorder.ts` 的 `moveAdjacent`。 */
  canMoveUp: boolean;
  canMoveDown: boolean;
  onMoveUp: () => void;
  onMoveDown: () => void;
  /** 另一张卡片被拖到这张卡片上：同列 = 插到它前面（排序），跨列 = 触发状态迁移。 */
  onDropOnCard: (draggedId: string) => void;
}) {
  /** B6.5：拖拽进行中的可访问状态（`aria-grabbed`，ARIA 1.1 起标记 deprecated 但仍是允许的全局属性，
   *  今天没有替代品能表达"正被抓起"；读屏用户看的是 `aria-describedby` 那句键盘替代说明）。 */
  const [grabbed, setGrabbed] = React.useState(false);
  // 标签输入框打开时关掉拖拽——否则在输入框里拖选文字会变成拖动整张卡片。
  const [editingTags, setEditingTags] = React.useState(false);
  return (
    <div
      draggable={!busy && !editingTags}
      onDragStart={(e) => {
        e.dataTransfer.setData("text/plain", item.id);
        setGrabbed(true);
      }}
      onDragEnd={() => setGrabbed(false)}
      onDragOver={(e) => {
        e.preventDefault();
        e.stopPropagation(); // 不让列容器自己的 onDragOver 把"落在某张卡片上"误判成"落在列尾"
      }}
      onDrop={(e) => {
        e.preventDefault();
        e.stopPropagation(); // 同上，交给这张卡片自己的 onDrop 处理，列容器的 onDrop 不再触发
        const draggedId = e.dataTransfer.getData("text/plain");
        if (draggedId !== "" && draggedId !== item.id) onDropOnCard(draggedId);
      }}
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
      <div className="absolute right-1.5 top-1.5 flex items-center gap-0.5 invisible transition-opacity duration-fast group-hover:visible group-focus-within:visible">
        <button
          type="button"
          aria-label="上移"
          disabled={busy || !canMoveUp}
          data-testid={`inbox-card-move-up-${item.code}`}
          onClick={(e) => { e.stopPropagation(); onMoveUp(); }}
          className="flex h-5 w-5 items-center justify-center rounded-control text-muted-foreground transition-colors duration-fast hover:bg-muted hover:text-card-foreground disabled:cursor-not-allowed disabled:bg-disabled disabled:text-disabled-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ChevronUp aria-hidden className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          aria-label="下移"
          disabled={busy || !canMoveDown}
          data-testid={`inbox-card-move-down-${item.code}`}
          onClick={(e) => { e.stopPropagation(); onMoveDown(); }}
          className="flex h-5 w-5 items-center justify-center rounded-control text-muted-foreground transition-colors duration-fast hover:bg-muted hover:text-card-foreground disabled:cursor-not-allowed disabled:bg-disabled disabled:text-disabled-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ChevronDown aria-hidden className="h-3.5 w-3.5" />
        </button>
        <QuickActionMenu item={item} busy={busy} onQuickAction={onQuickAction} onArchive={onArchive} testidPrefix="inbox-card" />
      </div>
      <div className="flex items-center gap-1.5 pr-16">
        <span className="font-mono text-10 text-muted-foreground">{item.code}</span>
        <KindLabel item={item} />
        {item.severe && <SevereBadge />}
      </div>
      <p className="line-clamp-2 text-12 font-medium">{item.title}</p>
      {(item.resolvedByDesignId !== null || item.linkedFeedbackId !== null || item.github !== null || (item.exception !== null && item.exception.count > 1)) && (
        <div className="flex flex-wrap items-center gap-1">
          <CardMeta item={item} onNavigateLink={onNavigateLink} />
          {item.github !== null && <GithubBadge {...item.github} />}
          <ExceptionRecurrence item={item} testid={`inbox-card-recurrence-${item.code}`} />
        </div>
      )}
      <TagEditor
        tags={item.tags}
        onChange={onSaveTags}
        onFilter={onFilterTag}
        busy={busy}
        testidPrefix={`inbox-card-${item.code}`}
        compact
        onEditingChange={setEditingTags}
      />
    </div>
  );
}
