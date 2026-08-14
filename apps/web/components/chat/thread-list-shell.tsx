"use client";
import * as React from "react";
import { MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
 * 会话卡副行 —— 照原型：**负责的 agent · 时间 · 状态徽标**。
 *
 * ⚠ 副行**不印可见范围**。原型副行里根本没有它（原型是「Scout · 14:02 · 3 条待复核」），
 *   而 `visibilityScope` 是一个治理概念，塞进时间线列表既占位又不可读；
 *   个人对话那侧此前逐字印的就是 `private` 这个枚举原值。
 * ⚠ 徽标是封闭枚举（契约 `MessageBadge` 恰两值），所以用穷举 Record 而不是直接印英文原值
 *   —— 枚举加一档时 tsc 会红，而不是静默把英文吐给用户。
 */
export function ThreadMeta({ card }: { card: ThreadCard }) {
  return (
    <span className="flex flex-wrap items-center gap-1 text-10 text-muted-foreground">
      {card.agentSummary ? <span className="truncate">{card.agentSummary}</span> : null}
      <span>· {shortTime(card.lastActivityAt)}</span>
      {card.badges.map((badge) => (
        <Badge key={badge} tone={badge === "review-pending" ? "warning" : "outline"}>
          {THREAD_BADGE_TEXT[badge]}
        </Badge>
      ))}
    </span>
  );
}

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
 * ## 为什么只在 `selected` 时启用（不是每张卡都能改名/删除）
 * 后端改名/删除走乐观并发（`selectedVersion`，来自线程**详情**接口），而列表卡
 * （`ThreadCard`）本身不带版本号——只有被选中、详情已加载的那一条才有可用的版本号
 * 可以安全提交写请求。给未选中的卡片也画一个"…"菜单，点开改名会因为拿不到版本号
 * 而卡死或误发一个没有并发保护的请求，两者都不诚实。「先选中再操作」不是本次限制，
 * 是继承自既有后端写路径的真实约束——只是**入口**从"下方常驻按钮"换成了"卡片本身
 * 的 hover 菜单/双击"，选中态才有意义没有变。
 *
 * `onRename`/`onDelete`/`pending`/`failure` 全部可选：不传即渲染成纯选择按钮
 * （非 `selected` 的卡片走这条路径，`selected` 但调用方不支持写操作——例如未来只读
 * 场景——也一样安全降级）。
 */
export function ThreadCardButton({
  card, selected, onSelect, onRename, onDelete, pending, failure,
}: {
  card: ThreadCard;
  selected: boolean;
  onSelect: () => void;
  onRename?: (title: string) => void;
  onDelete?: (reason: string) => void;
  pending?: "rename" | "delete" | null;
  failure?: string | null;
}) {
  const canMutate = selected && onRename !== undefined && onDelete !== undefined;
  const [mode, setMode] = React.useState<"view" | "menu" | "editing" | "deleting">("view");
  const [titleDraft, setTitleDraft] = React.useState(card.title);
  const [deleteReason, setDeleteReason] = React.useState("");
  const menuRef = React.useRef<HTMLDivElement>(null);
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

  // 菜单展开时点击外部关闭——同「先判后挂」的克制：只在 menu 打开时挂监听，
  // 用完立刻摘掉，不常驻一个全局点击监听器。
  React.useEffect(() => {
    if (mode !== "menu") return;
    function onDocPointerDown(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) setMode("view");
    }
    document.addEventListener("mousedown", onDocPointerDown);
    return () => document.removeEventListener("mousedown", onDocPointerDown);
  }, [mode]);

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
        onClick={onSelect}
        onDoubleClick={canMutate ? startEdit : undefined}
        className={[
          "flex w-full flex-col gap-1 rounded-md border-l-2 px-2 py-2 pr-7 text-left transition-colors hover:bg-muted",
          selected ? "border-primary bg-muted" : "border-transparent",
        ].join(" ")}
      >
        <span className="line-clamp-2 text-12 font-medium">{card.title}</span>
        <ThreadMeta card={card} />
      </button>
      {canMutate ? (
        <div ref={menuRef} className="absolute right-1 top-1">
          <button
            type="button"
            aria-label="更多操作"
            aria-haspopup="menu"
            aria-expanded={mode === "menu"}
            data-testid="chat-thread-card-menu-trigger"
            onClick={(event) => {
              event.stopPropagation();
              setMode((current) => (current === "menu" ? "view" : "menu"));
            }}
            className="rounded-md p-1 text-muted-foreground transition-colors invisible hover:bg-panel-alt hover:text-card-foreground focus-visible:visible focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring group-hover:visible"
          >
            <MoreHorizontal aria-hidden className="h-3.5 w-3.5" />
          </button>
          {mode === "menu" ? (
            <div
              role="menu"
              data-testid="chat-thread-card-menu"
              className="absolute right-0 top-full z-10 mt-1 min-w-28 rounded-md border border-border bg-card py-1 shadow-md"
            >
              <button
                type="button"
                role="menuitem"
                data-testid="chat-thread-rename"
                onClick={(event) => { event.stopPropagation(); startEdit(); }}
                className="flex w-full items-center gap-1.5 px-2.5 py-1.5 text-left text-12 transition-colors hover:bg-muted"
              >
                <Pencil aria-hidden className="h-3 w-3" />改名
              </button>
              <button
                type="button"
                role="menuitem"
                data-testid="chat-thread-delete"
                onClick={(event) => { event.stopPropagation(); startDelete(); }}
                className="flex w-full items-center gap-1.5 px-2.5 py-1.5 text-left text-12 text-destructive transition-colors hover:bg-muted"
              >
                <Trash2 aria-hidden className="h-3 w-3" />删除
              </button>
            </div>
          ) : null}
        </div>
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
export function NewThreadButton({ onClick, disabled }: { onClick: () => void; disabled: boolean }) {
  return (
    <Button className="w-full" size="sm" variant="primary" data-testid="chat-thread-create" disabled={disabled} onClick={onClick}>
      <Plus aria-hidden className="h-3.5 w-3.5" />新建对话
    </Button>
  );
}
