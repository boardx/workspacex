"use client";
import * as React from "react";
import { MoreHorizontal, Pencil, Pin, Plus, Trash2 } from "lucide-react";
import { WorkspaceXWordmark } from "@/components/shell/workspacex-logo";
import { Button } from "@/components/ui/button";
import { Menu, MenuContent, MenuItem, MenuTrigger } from "@/components/ui/menu";
import type { ThreadCard } from "@/lib/live-chat";

/**
 * 对话左栏的**共用外观**——`/chat` 两条路径（项目对话 `ChatReadScreen` /
 * 个人对话 `PersonalChatScreen`）都用这一份。
 *
 * ## 为什么必须共用（人类 2026-08-08 裁决）
 * `/chat` 一个路由下有两个屏：带 `projectId` 走项目对话，不带走个人对话（#594），
 * 而**不带 projectId 才是 devapp 上的默认落地屏**。此前两边各画了一套左栏：
 * 项目那侧按 #728 改成了「对话 + ⌘K + 全宽 primary + 负责 agent · 时间 · 徽标」，
 * 个人那侧还停在「我的对话 + 裸输入框」，副行印的是 `visibilityScope` 的**原始枚举值**
 * （`private` / `plenary`）——正是 #728 D3 在项目侧刚修掉的那件事。
 *
 * 人类的裁决是「个人对话不单列判据，**复用项目对话的壳**」。所以这里放的是**外观**，
 * 不是行为：两屏的取数、写权判定、路由跳转各自不同，那些留在各自的组件里。
 * ⚠ 不要把状态搬进来。搬进来就会变成一个既管项目又管个人的巨型组件，
 *   那是另一种「同一件事两做」的反面——一个组件做两件事。
 */

/** 左栏栏头。照原型：标题 +「⌘K」提示。 */
export function ThreadListHeader({ title = "对话" }: { title?: string }) {
  return (
    <div className="flex items-center justify-between gap-2 px-3 pt-3">
      <h2 className="text-14 font-semibold">{title}</h2>
      <kbd className="rounded-sm border border-border px-1 py-0.5 text-9 text-muted-foreground">⌘K</kbd>
    </div>
  );
}

/**
 * 宽栏顶部品牌行（2026-09-03 人类直接指令，对照设计参照图）—— 取代
 * `copilotkit-v2-shell.tsx` 原来放在这个位置的 `<ThreadListHeader title="工作" />`。
 *
 * ⚠ **纯展示，不接任何交互**（人类明确要求）：品牌 wordmark 不可点击、不带下拉箭头
 *   （2026-09-03 第二轮人类反馈：此前的装饰性 `▾` 被误读成"这里能切换什么"，而这一行
 *   压根不做任何切换——组织切换已经有唯一入口——图标栏最上方的 `OrgMenu`
 *   （`triggerVariant="grid"`）——这里不做第二个，删掉这颗容易误导的箭头）。
 *   `⌘K` 也只是视觉提示，不是真实快捷键（真实搜索快捷键入口仍是下面的搜索框本身，
 *   这一行不重复造一个）。
 * ⚠ 品牌图形改用真实 WorkspaceX logo（`WorkspaceXWordmark`，人类提供的官方图供描摹），
 *   取代此前占位的 2×2 语义色方块——那是"品牌 logo 还没画"时期的临时替身，不是最终
 *   视觉。
 */
export function SidebarBrandHeader(): JSX.Element {
  return (
    <div className="flex items-center justify-between gap-2 px-3 pt-3" data-testid="chat-sidebar-brand-header">
      <WorkspaceXWordmark className="h-4 w-auto" />
      <kbd className="rounded-sm border border-border px-1 py-0.5 text-9 text-muted-foreground">⌘K</kbd>
    </div>
  );
}

/**
 * 会话卡副行事实 —— 2026-08-29 Claude Design 重设计稿：会话卡收成**一行**，
 * 只留标题，状态/产物数/更新时间/徽标不再占用户看得见的那一行（人类原话「chat
 * sesson必须是一行，把状态，产物和时间去掉」）。
 *
 * ⚠ 这不是把这些事实删掉——只是不再印成可见文字：
 *   · 机器判据 `chat-task-workbench-thread-status`（TW-P1-1 读它的 `data-status`
 *     属性判定"是否已开始"）与 `chat-task-workbench-thread-artifact-count` 两个
 *     锚点原样保留，只是包进 `sr-only`；
 *   · 屏幕阅读器仍会朗读完整的"状态 · 产物数 · 时间 · 徽标"，一个字都没有丢；
 *   · "进行中"这一档改用 `ThreadRunningDot` 的呼吸点在标题行内可见表达
 *     （见下方），不是这条状态从界面上彻底消失。
 * ⚠ 徽标是封闭枚举（契约 `MessageBadge` 恰两值），所以用穷举 Record 而不是直接印英文原值
 *   —— 枚举加一档时 tsc 会红，而不是静默把英文吐给用户。
 */
export function ThreadMeta({ card }: { card: ThreadCard }) {
  return (
    <span className="sr-only">
      <span data-testid="chat-task-workbench-thread-status" data-status={card.status}>
        {THREAD_STATUS_LABEL[card.status]}
      </span>
      {card.artifactCount > 0 ? (
        <span data-testid="chat-task-workbench-thread-artifact-count">
          · {card.artifactCount} 份产物
        </span>
      ) : null}
      <span> · {shortTime(card.lastActivityAt)}</span>
      {card.badges.map((badge) => (
        <span key={badge}> · {THREAD_BADGE_TEXT[badge]}</span>
      ))}
    </span>
  );
}

/**
 * 呼吸点 —— 会话「进行中」在标题行内唯一的可见状态提示（Claude Code CLI 同款
 * 语汇，人类原话「需要有一个呼吸的点点」）。
 *
 * 只在 `status === "running"` 时渲染：「还没开始」「已完成」「未能完成」都是
 * 稳定态，不需要用户盯着一个动画看；只有"现在正在跑"才值得用动效抢注意力。
 * `aria-hidden`——朗读态已经由 `ThreadMeta` 的 sr-only 文案覆盖，这个点是纯视觉
 * 强调，读屏软件重复念一遍"进行中"反而是噪音。
 */
function ThreadRunningDot() {
  return (
    <span
      aria-hidden
      data-testid="chat-task-workbench-thread-running-dot"
      className="inline-block h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-primary"
    />
  );
}

/**
 * 🔴 issue #2094（人类裁决落地，回指 #2068）：卡片副行 = **状态 · 产物数 · 更新时间**。
 *
 * 这里此前是 `{card.agentSummary}`，一个来自服务端的自由字符串，实际取值是
 * `` `${agentCount} 个 agent` ``。人类 2026-08-26 审计原话：
 *
 * > 对话列表不可辨认——大量「新对话」，只显示 `0 个 agent`，无法寻找历史任务。
 * > 改进方向：自动生成任务标题、状态、产物数量和更新时间。
 *
 * ## 为什么文案映射在这里，而不在服务端
 *
 * 服务端返回的是领域枚举（契约 `ThreadCardStatus`），**不是**中文串。分工是刻意的：
 *   · 「这条线程处于什么状态」是**领域判定**，唯一一处在
 *     `apps/api/src/domain/chat/thread-badges.ts` 的 `threadCardStatus`；
 *   · 「那个状态叫什么」是**界面文案**，唯一一处就是下面这张表。
 *
 * 反过来（服务端直接返中文串）正是 `0 个 agent` 当年的形状：文案漂在一个
 * `z.string()` 里，契约管不着、验收卡的文案黑名单也扫不到它的来源，
 * 于是它在屏幕上活了很久都没有任何门控发现。
 *
 * ⚠ **穷举 `Record` 而不是 `switch` + default**：枚举加一档时 tsc 当场红，而不是
 *   静默把 `not-started` 这种裸枚举词吐给用户——验收卡 `TW-COPY-1` 的黑名单里
 *   逐字列着裸状态枚举，本仓 #728 已经因此被抓过一次。
 * ⚠ `not-started` 是**「还没开始」，不是「已完成」**：devapp 实测 58 条线程里 36 条
 *   一条消息都没有。把它们显示成已完成是撒谎，显示成空白则与「字段没取到」无法区分。
 * ⚠ 文案全部是**用户语言**，没有一个开发者词：`failed` → 「未能完成」而不是「失败」，
 *   `awaiting-approval` → 「等待你确认」而不是「等待审批」——后者说的是系统在等，
 *   前者说的是**该用户动手了**，而这一条正是审计要的「用户语言 + 明确动作」。
 */
const THREAD_STATUS_LABEL: Record<ThreadCard["status"], string> = {
  "not-started": "还没开始",
  running: "进行中",
  "awaiting-approval": "等待你确认",
  failed: "未能完成",
  done: "已完成",
};

const THREAD_BADGE_TEXT: Record<ThreadCard["badges"][number], string> = {
  degraded: "已降级",
  "review-pending": "待复核",
};

/**
 * 一张会话卡。选中态是左边框 + 底色，两屏一致。
 *
 * ## 改名/删除 UX（2026-08-14 人类要求重做）——hover 「…」菜单 + 双击改名
 *
 * 此前是「选中会话 → 列表下方常驻显示改名/删除按钮」，人类实测反馈"看不到"、
 * 要求换成更符合直觉的形态：鼠标悬停某张卡片时右上角浮出一个「…」按钮，点开是
 * 改名/删除的小菜单；双击卡片标题直接进入行内改名。
 *
 * ## 2026-08-30 人类裁决：不再要求「先选中才能操作」
 *
 * 此前 `canMutate` 还要求 `selected`——理由是改名/删除走乐观并发，需要线程**详情**
 * 接口才有的版本号，而列表卡（`ThreadCard`）本身不带版本号，只有被选中、详情已加载
 * 的那一条才安全。人类实测反馈这不直观："hover 没有选中的 item，3 点的 menu 还是
 * 没有出来"——用户不会先猜"要改名得先点一下选中"这条隐藏规则。
 *
 * 裁决改成：任何一张卡 hover 都能看到「…」入口，点开菜单/提交改名删除时才**按需**
 * 去取那条线程的最新版本号（各调用方的 `onRename`/`onDelete` 现在各自负责，见
 * `personal-chat-screen.tsx`/`copilotkit-v2-shell.tsx`/`chat-read-screen.tsx` 里
 * 同名回调的头注）——真正需要版本号的时刻从"卡片渲染时"推迟到"提交那一刻"，不再要求
 * 调用方提前把它塞进某个只属于"选中线程"的 state。
 *
 * `onRename`/`onDelete`/`pending`/`failure` 全部可选：不传即渲染成纯选择按钮
 * （调用方不支持写操作——例如未来只读场景——安全降级成没有菜单入口）。
 *
 * F09：「…」菜单改走 `components/ui/menu.tsx`（Radix DropdownMenu 别名）——此前是
 * `mode === "menu"` + `document.mousedown` 手动监听外点关闭（F09 盘点发现的 5 处重复
 * 实现之一）。菜单只是这个组件四态状态机（view/menu/editing/deleting）里的一态，
 * 选中「改名」「删除」后 `mode` 立刻切到 editing/deleting，菜单随之自然关闭
 * （`open={mode === "menu"}` 跟随状态机，不需要额外收口逻辑）。
 */
export function ThreadCardButton({
  card, selected, onSelect, onRename, onDelete, pending, failure, pinned, onTogglePin,
}: {
  card: ThreadCard;
  selected: boolean;
  onSelect: () => void;
  onRename?: (title: string) => void;
  onDelete?: (reason: string) => void;
  pending?: "rename" | "delete" | null;
  failure?: string | null;
  /**
   * issue #2075（TW-P2-6「置顶」）—— 两者都可选：不传即完全不渲染置顶入口，
   * 旧轨道两屏（`ChatReadScreen` / `PersonalChatScreen`）行为逐字不变。
   * 置顶已改为服务端持久化（2026-09-03，F109 续，ad-hoc）：`pinned` 直接来自
   * 契约 `ThreadCard.pinned`，`onTogglePin` 的调用方经 `mutateThread` 的
   * `pin`/`unpin` 落库，取代此前 `lib/chat-pinned-threads.ts` 的 localStorage 方案。
   */
  pinned?: boolean;
  onTogglePin?: () => void;
}) {
  const canMutate = onRename !== undefined && onDelete !== undefined;
  const [mode, setMode] = React.useState<"view" | "menu" | "editing" | "deleting">("view");
  const [titleDraft, setTitleDraft] = React.useState(card.title);
  const [deleteReason, setDeleteReason] = React.useState("");
  const busy = pending !== undefined && pending !== null;

  // 卡片不再被选中（切到别的会话）时退回浏览态——不留一个挂在已经不对的会话上的编辑框。
  React.useEffect(() => {
    if (!canMutate) setMode("view");
  }, [canMutate]);
  React.useEffect(() => {
    setTitleDraft(card.title);
  }, [card.title]);

  /**
   * 提交后**不**立刻收起表单——那样一旦服务端拒绝（`failure` 变化），表单和它携带的
   * 错误提示会一起消失，用户只看到"点了没反应"。改成跟踪 `pending` 的**下降沿**
   * （从 "rename"/"delete" 变回 null）：那一刻若 `failure` 仍是 null，说明这次提交
   * 成功了，才收起表单；`failure` 非空则原地停留，把错误亮出来、留给用户重试或取消。
   */
  const prevPendingRef = React.useRef(pending);
  React.useEffect(() => {
    const prevPending = prevPendingRef.current;
    prevPendingRef.current = pending;
    const justSettled = prevPending !== undefined && prevPending !== null && (pending === null || pending === undefined);
    if (justSettled && !failure) setMode("view");
  }, [pending, failure]);

  function startEdit(): void {
    setTitleDraft(card.title);
    setMode("editing");
  }
  function startDelete(): void {
    setDeleteReason("");
    setMode("deleting");
  }
  function submitRename(event: React.FormEvent): void {
    event.preventDefault();
    const title = titleDraft.trim();
    if (!title || onRename === undefined) return;
    onRename(title); // 表单何时收起交给上面的 pending/failure 下降沿 effect 判断
  }
  function submitDelete(event: React.FormEvent): void {
    event.preventDefault();
    const reason = deleteReason.trim();
    if (!reason || onDelete === undefined) return;
    onDelete(reason);
  }

  if (mode === "editing") {
    return (
      <form
        data-testid="chat-thread-rename-form"
        onSubmit={submitRename}
        className="flex flex-col gap-1 rounded-md border-l-2 border-primary bg-muted px-2 py-2"
      >
        <input
          autoFocus
          aria-label="新的会话标题"
          data-testid="chat-thread-title-input"
          className="rounded-md border border-border-subtle px-2 py-1 text-12 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          value={titleDraft}
          onChange={(event) => setTitleDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") setMode("view");
          }}
        />
        <div className="flex gap-1">
          <Button size="xs" variant="primary" type="submit" data-testid="chat-thread-title-submit" disabled={busy || titleDraft.trim() === ""}>
            确认
          </Button>
          <Button size="xs" variant="outline" type="button" onClick={() => setMode("view")}>取消</Button>
        </div>
        {busy ? <p className="text-10 text-muted-foreground" data-testid="chat-thread-mutate-pending">正在提交…</p> : null}
        {failure ? <p className="text-11 text-destructive" data-testid="chat-thread-mutate-error">{failure}</p> : null}
      </form>
    );
  }

  if (mode === "deleting") {
    return (
      <form
        data-testid="chat-thread-delete-confirm"
        onSubmit={submitDelete}
        className="flex flex-col gap-1 rounded-md border-l-2 border-destructive/60 bg-muted px-2 py-2"
      >
        <p className="text-11 text-muted-foreground">删除后不可撤销，请填写原因（会写入审计）。</p>
        <input
          autoFocus
          aria-label="删除原因"
          data-testid="chat-thread-delete-reason"
          className="rounded-md border border-border-subtle px-2 py-1 text-12 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          value={deleteReason}
          onChange={(event) => setDeleteReason(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") setMode("view");
          }}
        />
        <div className="flex gap-1">
          <Button size="xs" variant="destructive" type="submit" data-testid="chat-thread-delete-submit" disabled={busy || deleteReason.trim() === ""}>
            确认删除
          </Button>
          <Button size="xs" variant="outline" type="button" onClick={() => setMode("view")}>取消</Button>
        </div>
        {busy ? <p className="text-10 text-muted-foreground" data-testid="chat-thread-mutate-pending">正在提交…</p> : null}
        {failure ? <p className="text-11 text-destructive" data-testid="chat-thread-mutate-error">{failure}</p> : null}
      </form>
    );
  }

  return (
    <div className="group relative" data-testid={canMutate ? "chat-thread-selection-actions" : undefined}>
      <button
        type="button"
        data-testid={`chat-thread-${card.id}`}
        aria-current={selected ? "page" : undefined}
        /* issue #2075（TW-P2-6「选中态」）—— `aria-current="page"` 是给辅助技术的，
           但它的值是 `"page"`，机械判定"哪一条被选中"时不能拿它当布尔量。
           这里补一个显式的布尔投影，供门控与样式共用同一个事实（不是第二份状态：
           两者都从同一个 `selected` prop 渲染出来）。 */
        data-selected={selected ? "true" : "false"}
        onClick={onSelect}
        onDoubleClick={canMutate ? startEdit : undefined}
        className={[
          "flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 pr-14 text-left transition-colors duration-base hover:bg-muted active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          // issue #2476：原来是 `border-primary bg-muted`——跟下面"改标题"表单的
          // `border-primary bg-muted` 逐字同款，选中态和"正在编辑"这个完全不同的
          // 动作在视觉上没有区分度，且 `--primary` 近黑 + `--muted` 浅灰在小字号
          // 下辨识度低，用户反馈"感觉颜色没变"。换成 `--accent`（已经在计划卡头
          // 用过的同一个浅青绿 token），选中态从此有自己的颜色，不跟其它状态共用。
          //
          // 2026-09-03 人类反馈（真栈截图）「选中的 chat session，不需要左边的 solid
          // border，简化」—— 上一轮改的是颜色，这一轮去掉「左边框」这个形态本身：
          // `border-l-2` 一直是这一条的选中/未选中都占位的固定几何（未选中态只是把
          // 颜色改成 transparent），删掉整条 `border-l-*`，选中态单靠 `bg-accent`
          // 这块底色本身就足够辨识，不需要再用一条竖线重复标一次。
          selected ? "bg-accent text-accent-foreground" : "",
        ].join(" ")}
      >
        {/* 2026-08-29 Claude Design 重设计稿——会话卡收成**一行**（人类原话「chat
            sesson必须是一行」）：这里不再是 `flex-col` 两行,只剩标题一行,可选前置
            呼吸点。「进行中」的可见提示从副行文字换成这颗点,见 `ThreadRunningDot`。 */}
        {card.status === "running" ? <ThreadRunningDot /> : null}
        {/* 🔴 #2094：`chat-task-workbench-thread-title` 是验收卡 TW-P1-1 的锚点
            （自动命名：线程列表不得一屏全是「新对话」）。锚在标题这一个 span 上，
            不是整张卡：断言读的是标题文本,不会被副行的状态/时间冲淡——副行现在
            整段是 `sr-only`,连视觉上都不会再出现,这条注释的前提更稳固了。 */}
        <span data-testid="chat-task-workbench-thread-title" className="min-w-0 flex-1 truncate text-12 font-medium">
          {card.title}
        </span>
        <ThreadMeta card={card} />
      </button>
      {onTogglePin !== undefined ? (
        /* 2026-08-29 人类明确要求收回（原话「只有 hover 某个 session item 的时候才
           出现图钉以及三点菜单」）：改成 hover/focus 才浮出，覆盖 issue #2075 当时
           「常驻可见」的取舍。
           ⚠ 用「文字颜色透明」（`text-transparent` → `group-hover:` 恢复颜色），
           不是 `lint-design.sh` U1.2 禁止的 `opacity-*`，也不是 issue #2075 当时
           排除掉的 `visibility:hidden`：
             ① 按钮本身、`aria-label`、`aria-pressed` 全程留在无障碍树里——读屏软件
                照样能找到、照样会念，不会像 `visibility:hidden` 那样被跳过；
             ② `group-focus-within:` 让键盘 Tab 到这张卡时同样能看见，不是只对
                鼠标悬停生效；
             ③ 颜色本身仍是语义 token（`text-muted-foreground`/`text-primary`），
                不是任意值，可静态核对对比度——U1.2 真正要防的"对比度不可验证"
                这条没有被绕开。
           代价如实登记：纯触屏、且从不先聚焦这张卡的用户，第一次不会"看见"这个
           按钮——这正是人类这次要的视觉效果（已置顶用「置顶」分组标出，不再需要
           每张卡常驻一个图钉来重复同一件事）。 */
        <button
          type="button"
          aria-label={pinned ? `取消置顶「${card.title}」` : `置顶「${card.title}」`}
          title={pinned ? "取消置顶（仅本浏览器）" : "置顶（仅本浏览器）"}
          aria-pressed={pinned === true}
          data-testid="chat-task-workbench-thread-pin"
          data-thread-id={card.id}
          onClick={(event) => { event.stopPropagation(); onTogglePin(); }}
          className={[
            // `p-1.5` 而不是 `p-1`：14px 图标 + 12px 内边距 = 26px，过 TW-A11Y-2 的
            // 24×24 点击区下限（`p-1` 只有 22px，是真会被屏幕阅读器/粗手指用户踩到的缺陷）。
            "absolute right-7 top-1 rounded-md p-1.5 text-transparent transition-colors duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            pinned ? "group-hover:text-primary group-focus-within:text-primary" : "group-hover:text-muted-foreground group-focus-within:text-muted-foreground",
            "hover:bg-panel-alt hover:text-card-foreground",
          ].join(" ")}
        >
          <Pin aria-hidden className="h-3.5 w-3.5" />
        </button>
      ) : null}
      {canMutate ? (
        <Menu open={mode === "menu"} onOpenChange={(o) => setMode(o ? "menu" : "view")}>
          <MenuTrigger asChild>
            <button
              type="button"
              aria-label="更多操作"
              data-testid="chat-thread-card-menu-trigger"
              onClick={(event) => event.stopPropagation()}
              /* issue #2075（TW-A11Y-2）—— `p-1` 时整个按钮只有 14+8=22px，低于 24×24
                 的点击区下限；`p-1.5` 给到 26px。这不是为了让门控变绿：22px 的悬浮小按钮
                 在触屏与手部精细动作受限的用户那里就是点不中。
                 2026-08-29 同置顶按钮一起收回常驻：`text-transparent` → hover/focus
                 才恢复颜色，理由与豁免见上面置顶按钮的头注。菜单已经打开
                 （`mode === "menu"`，此时鼠标可能已经移到 portal 出去的菜单项上）
                 时强制维持可见色，不能让触发它的按钮在自己的菜单还开着时视觉消失。 */
              className={[
                "absolute right-1 top-1 rounded-md p-1.5 transition-colors duration-fast hover:bg-panel-alt hover:text-card-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                mode === "menu" ? "text-muted-foreground" : "text-transparent group-hover:text-muted-foreground group-focus-within:text-muted-foreground",
              ].join(" ")}
            >
              <MoreHorizontal aria-hidden className="h-3.5 w-3.5" />
            </button>
          </MenuTrigger>
          <MenuContent align="end" sideOffset={4} data-testid="chat-thread-card-menu" className="min-w-28 py-1">
            {/* onSelect preventDefault：`open` 由 `mode` 状态机控制，选中项要切到
                editing/deleting 而不是让 Radix 自己的「选中即关闭」把 mode 抢回 "view"。 */}
            <MenuItem
              data-testid="chat-thread-rename"
              onSelect={(event) => { event.preventDefault(); startEdit(); }}
              className="gap-1.5"
            >
              <Pencil aria-hidden className="h-3 w-3" />改名
            </MenuItem>
            <MenuItem
              data-testid="chat-thread-delete"
              onSelect={(event) => { event.preventDefault(); startDelete(); }}
              className="gap-1.5 text-destructive data-[highlighted]:text-destructive"
            >
              <Trash2 aria-hidden className="h-3 w-3" />删除
            </MenuItem>
          </MenuContent>
        </Menu>
      ) : null}
    </div>
  );
}

/**
 * 只取「时:分」。原型左栏印的是 `14:02` 这种量级，不是完整 ISO 串。
 * ⚠ 刻意不做「几分钟前」：那会让同一条卡在两次渲染间文字不同，截图比对与快照测试
 *   都会因此抖动，而它换来的信息量为零。解析失败时原样返回，不静默显示成空。
 */
export function shortTime(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return iso;
  return `${String(at.getHours()).padStart(2, "0")}:${String(at.getMinutes()).padStart(2, "0")}`;
}

/**
 * 新建入口——**两屏共用**（人类 2026-08-08 裁决）。原型是一条全宽 primary
 * 「＋ 新建对话」，点击才展开标题表单，不是常驻的裸输入框。
 *
 * ⚠ 此前个人对话是第二套实现：常驻输入框 + 灰色「新建会话」按钮，且按钮在标题为空时
 *   **禁用**——空态引导文案明明写着「点上面「新建会话」开始第一次对话」，指向的却是一个
 *   点不动的按钮（rev-uiux 第 3/4 轮各抓到一次）。两个问题根子相同：没有共用这个组件。
 */
export function NewThreadButton({
  onClick, disabled, label = "新建对话",
}: {
  onClick: () => void;
  disabled: boolean;
  /**
   * 2026-08-29 Claude Design 重设计稿（copilotkit-v2 左栏）——该屏的语境是"把一件事
   * 交给 AI"，不只是"开一条新对话"，文案跟着换成「交一件事给 AI」。默认值不变：
   * `chat-read-screen.tsx`/`personal-chat-screen.tsx` 两条旧轨道逐字节不变，
   * 只有传了这个 prop 的调用方才看得到新文案——不是全仓统一改名。
   */
  label?: string;
}) {
  return (
    <Button className="w-full" size="sm" variant="primary" data-testid="chat-thread-create" disabled={disabled} onClick={onClick}>
      <Plus aria-hidden className="h-3.5 w-3.5" />{label}
    </Button>
  );
}
