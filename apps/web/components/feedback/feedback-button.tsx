"use client";
import * as React from "react";
import { MessageSquarePlus } from "lucide-react";
import { useOptionalFeedback } from "./feedback-provider";
import type { FeedbackTarget } from "@/lib/live-feedback";
import { cn } from "@/lib/utils";

/**
 * FB-2 —— 反馈入口按钮。**全仓只有这一个**（导航图标栏 / 顶栏 / chat 内 agent·skill 共用）。
 *
 * ## 为什么 chat 里每个 agent 和 skill 都要有一个
 *
 * 消息级的 👍/👎（F176）回答的是「**这一条回答**好不好」。它答不了
 * 「这个 agent 老是漏掉附件」「这个 skill 的输出格式该换个样子」——那是关于
 * **这个能力本身**的话，跨很多条消息，而且需要正文。两者都要有，是因为
 * 一个无正文的信号和一段具体的意见在下游走的是两条不同的路
 * （前者聚合成满意度与建议，后者直接进分诊队列）。
 *
 * ## 没有 Provider 时它**不渲染**，而不是渲染一个点了没反应的按钮
 *
 * 原型页/独立预览屏可能在壳层之外渲染 chat 组件。那里没有 `FeedbackProvider`，
 * 按钮点了不会有任何事发生——那正是本束第一条纪律禁止的东西。
 * 所以这里返回 `null`：**入口消失比入口失灵诚实**。
 */
export function FeedbackButton({
  target,
  targetLabel,
  variant = "icon",
  className,
  testid,
}: {
  target: FeedbackTarget;
  targetLabel: string | null;
  /** `icon` = 只有图标（消息头/紧凑列表里）；`rail` = 图标+文字（导航图标栏那一列） */
  variant?: "icon" | "rail";
  className?: string;
  testid?: string;
}) {
  const feedback = useOptionalFeedback();
  if (feedback === null) return null;

  const label =
    target.kind === "product"
      ? "提交反馈"
      : `对${target.kind === "agent" ? " Agent " : " Skill "}${targetLabel ?? ""}提反馈`;

  if (variant === "rail") {
    return (
      <button
        type="button"
        onClick={() => feedback.openFeedback({ target, targetLabel })}
        data-testid={testid ?? "rail-feedback"}
        aria-label={label}
        title={label}
        className={cn(
          "mt-1.5 flex w-14 flex-col items-center gap-1 rounded-md py-1.5 text-muted-foreground transition-all duration-200",
          "hover:bg-muted hover:text-background-foreground",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          className,
        )}
      >
        <MessageSquarePlus aria-hidden className="h-4 w-4" />
        <span className="text-10">反馈</span>
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={() => feedback.openFeedback({ target, targetLabel })}
      data-testid={testid}
      aria-label={label}
      title={label}
      className={cn(
        "inline-grid h-5 w-5 place-items-center rounded text-muted-foreground transition-colors",
        "hover:bg-muted hover:text-card-foreground",
        "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
        className,
      )}
    >
      <MessageSquarePlus aria-hidden className="h-3 w-3" />
    </button>
  );
}
