"use client";
import * as React from "react";
import { Github, ArrowUpRight, AlertTriangle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { INBOX_STAGE_LABEL, type InboxGithubRef, type InboxStage } from "@/lib/live-inbox";

/** 四态 → 语义 tone。四态是现有 feedback-loop 状态机换显示名，颜色沿用其语义分档。 */
const STAGE_TONE: Record<InboxStage, React.ComponentProps<typeof Badge>["tone"]> = {
  backlog: "warning",
  doing: "ai",
  done: "primary",
  archived: "neutral",
};

export function StatusBadge({ stage }: { stage: InboxStage }) {
  return (
    <Badge tone={STAGE_TONE[stage]} data-testid={`status-badge-${stage}`}>
      {INBOX_STAGE_LABEL[stage]}
    </Badge>
  );
}

/**
 * GitHub 徽标：四种状态四种语义色（need: open 绿 / draft 灰 / merged 紫 / closed 红）。
 * 用 token 家族承载语义色，不硬编码：open→success，draft→muted，merged→ai(紫调强调)，
 * closed→destructive。文案统一 `{Issue|PR} #{num} · {State}`。
 */
const GITHUB_TONE: Record<InboxGithubRef["state"], string> = {
  open: "bg-success text-success-foreground",
  draft: "bg-muted text-muted-foreground",
  merged: "bg-ai text-ai-foreground",
  closed: "bg-destructive text-destructive-foreground",
};

const GITHUB_STATE_LABEL: Record<InboxGithubRef["state"], string> = {
  open: "Open",
  draft: "Draft",
  merged: "Merged",
  closed: "Closed",
};

/**
 * 2026-09-05（人类要求「issue / PR 都必须有链接可以点击打开」）：徽标本身就是一个新开标签页的
 * 外链（`href = url`，`rel="noopener noreferrer"`）。它总是嵌在「整张卡片 / 整行本身就是打开
 * 按钮」里，所以 click / keydown 都 `stopPropagation`——同 `LinkBadge` 的理由，不拦的话点一下
 * 会先打开 drawer 再跳 GitHub。`url` 为空字符串（理论上契约不允许，防御性）时退回只读文本。
 */
export function GithubBadge({ number, state, kind, url }: InboxGithubRef) {
  const label = kind === "pr" ? "PR" : "Issue";
  const className = cn("inline-flex items-center gap-1 rounded-control px-1.5 py-0.5 text-10 font-medium", GITHUB_TONE[state]);
  const content = (
    <>
      <Github aria-hidden className="h-3 w-3" />
      {label} #{number} · {GITHUB_STATE_LABEL[state]}
    </>
  );
  if (url === "") {
    return (
      <span className={className} data-testid={`github-badge-${state}`}>
        {content}
      </span>
    );
  }
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      title={`在 GitHub 打开 ${label} #${number}`}
      className={cn(className, "underline-offset-2 transition-colors duration-fast hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring")}
      data-testid={`github-badge-${state}`}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      {content}
      <ArrowUpRight aria-hidden className="h-3 w-3" />
    </a>
  );
}

const LINK_BADGE_CLASS = "inline-flex items-center gap-0.5 rounded-control bg-ai-tint px-1.5 py-0.5 text-10 font-medium text-ai-tint-foreground";

/**
 * 反馈 ↔ 设计方案关联标（源自 / 已生成）。
 *
 * UC-17.8 B3.7：给了 `onClick` 就渲染成真按钮（可键盘触达、有焦点环），点击跳到关联条目；
 * 没给则退回只读文本标记（取材页/无导航上下文）。按钮内部把 click / keydown 都
 * `stopPropagation`——它总是嵌在「整张卡片 / 整行本身就是打开按钮」里，不拦的话一次点击
 * 会先打开自己再被关联导航覆盖，多一次 drawer 闪动。
 */
export function LinkBadge({ text, testid, onClick }: { text: string; testid: string; onClick?: () => void }) {
  if (onClick === undefined) {
    return (
      <span className={LINK_BADGE_CLASS} data-testid={testid}>
        <ArrowUpRight aria-hidden className="h-3 w-3" />
        {text}
      </span>
    );
  }
  return (
    <button
      type="button"
      className={cn(
        LINK_BADGE_CLASS,
        "transition-colors duration-fast hover:bg-ai hover:text-ai-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
      )}
      title="跳到关联条目并高亮"
      data-testid={testid}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <ArrowUpRight aria-hidden className="h-3 w-3" />
      {text}
    </button>
  );
}

export function SevereBadge() {
  return (
    <span
      className="inline-flex items-center gap-0.5 rounded-control bg-destructive px-1.5 py-0.5 text-10 font-medium text-destructive-foreground"
      data-testid="severe-badge"
    >
      <AlertTriangle aria-hidden className="h-3 w-3" />
      严重
    </span>
  );
}
