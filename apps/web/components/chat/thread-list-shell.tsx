"use client";
import * as React from "react";
import { Plus } from "lucide-react";
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

/** 一张会话卡。选中态是左边框 + 底色，两屏一致。 */
export function ThreadCardButton({
  card, selected, onSelect,
}: {
  card: ThreadCard;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      data-testid={`chat-thread-${card.id}`}
      aria-current={selected ? "page" : undefined}
      onClick={onSelect}
      className={[
        "flex flex-col gap-1 rounded-md border-l-2 px-2 py-2 text-left transition-colors hover:bg-muted",
        selected ? "border-primary bg-muted" : "border-transparent",
      ].join(" ")}
    >
      <span className="line-clamp-2 text-12 font-medium">{card.title}</span>
      <ThreadMeta card={card} />
    </button>
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
