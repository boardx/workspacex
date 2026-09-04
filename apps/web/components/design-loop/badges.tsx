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

export function GithubBadge({ number, state, kind }: InboxGithubRef) {
  const label = kind === "pr" ? "PR" : "Issue";
  return (
    <span
      className={cn("inline-flex items-center gap-1 rounded-control px-1.5 py-0.5 text-10 font-medium", GITHUB_TONE[state])}
      data-testid={`github-badge-${state}`}
    >
      <Github aria-hidden className="h-3 w-3" />
      {label} #{number} · {GITHUB_STATE_LABEL[state]}
    </span>
  );
}

/** 反馈 ↔ 设计方案关联标（源自 / 已生成）。只读文本标记。 */
export function LinkBadge({ text, testid }: { text: string; testid: string }) {
  return (
    <span
      className="inline-flex items-center gap-0.5 rounded-control bg-ai-tint px-1.5 py-0.5 text-10 font-medium text-ai-tint-foreground"
      data-testid={testid}
    >
      <ArrowUpRight aria-hidden className="h-3 w-3" />
      {text}
    </span>
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
