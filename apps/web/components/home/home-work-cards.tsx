"use client";
import * as React from "react";
import Link from "next/link";
import { Avatar } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import { formatRelativeTime, initialsOf } from "@/lib/home-format";
import { guidedResearchRoute } from "@/lib/guided-research-routes";
import { surveyPath } from "@/lib/survey/paths";
import type { HomeInterview, HomeProject, HomeResearch, HomeSurvey, HomeThread } from "./use-home-work";

/**
 * 「继续你的工作」的卡片。卡片只展示真实字段：没有的字段（如协作者没取到）整块省略，
 * 不填占位。所有卡片是一个整体可点的链接（键盘可达、有焦点环）。
 */
const CARD_BASE =
  "group flex min-h-24 flex-col gap-2 rounded-card border border-border-subtle bg-card p-3 shadow-sm transition-shadow duration-fast hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

function Pill({ children, tone = "muted" }: { children: React.ReactNode; tone?: "muted" | "ai" | "success" | "warning" }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-pill px-1.5 py-0.5 text-10 font-medium",
        tone === "muted" && "bg-muted text-muted-foreground",
        tone === "ai" && "bg-ai-tint text-ai-tint-foreground",
        tone === "success" && "bg-success/10 text-success",
        tone === "warning" && "bg-warning-tint text-warning-tint-foreground",
      )}
    >
      {children}
    </span>
  );
}

function CardFooter({ left, iso }: { left?: React.ReactNode; iso: string | null }) {
  const rel = formatRelativeTime(iso);
  return (
    <div className="mt-auto flex items-center justify-between gap-2 text-10 text-muted-foreground">
      <span className="flex min-w-0 items-center gap-1.5">{left}</span>
      {rel !== null ? <span className="shrink-0">{rel}</span> : null}
    </div>
  );
}

const THREAD_STATUS: Record<string, { label: string; tone: "muted" | "ai" | "success" | "warning" } | undefined> = {
  running: { label: "进行中", tone: "ai" },
  "awaiting-approval": { label: "待确认", tone: "warning" },
  done: { label: "已完成", tone: "success" },
  failed: { label: "失败", tone: "warning" },
  paused: { label: "已暂停", tone: "muted" },
};

export function ChatCard({ thread }: { thread: HomeThread }) {
  const st = THREAD_STATUS[thread.status];
  return (
    <Link href={`/chat?thread=${encodeURIComponent(thread.id)}`} data-testid={`home-recent-thread-${thread.id}`} className={CARD_BASE}>
      <div className="flex items-start justify-between gap-2">
        <h3 className="line-clamp-1 text-12 font-medium text-card-foreground">{thread.title}</h3>
        {st !== undefined ? <Pill tone={st.tone}>{st.label}</Pill> : null}
      </div>
      {thread.subtitle ? <p className="line-clamp-2 text-11 text-muted-foreground">{thread.subtitle}</p> : null}
      <CardFooter
        iso={thread.lastActivityAt}
        left={thread.artifactCount > 0 ? <span>{String(thread.artifactCount)} 个产出物</span> : null}
      />
    </Link>
  );
}

const MAX_AVATARS = 4;

export function ProjectCard({ project }: { project: HomeProject }) {
  const people = project.collaborators;
  return (
    <Link href={`/projects/${encodeURIComponent(project.id)}`} data-testid={`home-recent-project-${project.id}`} className={CARD_BASE}>
      <div className="flex items-start justify-between gap-2">
        <h3 className="line-clamp-1 text-12 font-medium text-card-foreground">{project.name}</h3>
        <Pill>{project.kind === "workshop" ? "工作坊" : "项目"}</Pill>
      </div>
      {project.tags.length > 0 ? (
        <div className="flex flex-wrap gap-1">
          {project.tags.slice(0, 3).map((t) => <Pill key={t}>{t}</Pill>)}
        </div>
      ) : null}
      {people !== null && people.length > 0 ? (
        <div className="mt-auto flex items-center gap-2" data-testid={`home-project-collaborators-${project.id}`}>
          <span className="flex -space-x-1">
            {people.slice(0, MAX_AVATARS).map((p) => (
              <Avatar key={p.userId} initials={initialsOf(p.displayName, 1)} size="sm" className="ring-2 ring-card" title={p.displayName} />
            ))}
          </span>
          <span className="truncate text-10 text-muted-foreground">
            {people.slice(0, 2).map((p) => p.displayName).join("、")}
            {people.length > 2 ? ` 等 ${String(people.length)} 人` : ""}
          </span>
        </div>
      ) : null}
    </Link>
  );
}

const RESEARCH_STATUS = { active: "进行中", completed: "已完成", failed: "失败" } as const;

export function ResearchCard({ item }: { item: HomeResearch }) {
  const label = RESEARCH_STATUS[item.status as keyof typeof RESEARCH_STATUS] ?? "进行中";
  return (
    <Link
      href={guidedResearchRoute(item.sessionId, item.stage)}
      data-testid={`home-recent-research-${item.sessionId}`}
      className={CARD_BASE}
    >
      <div className="flex items-start justify-between gap-2">
        <h3 className="line-clamp-1 text-12 font-medium text-card-foreground">{item.title}</h3>
        <Pill tone={item.status === "completed" ? "success" : item.status === "failed" ? "warning" : "ai"}>{label}</Pill>
      </div>
      <div className="h-1 overflow-hidden rounded-pill bg-muted" role="progressbar" aria-valuenow={item.progress} aria-valuemin={0} aria-valuemax={100}>
        <div className="h-full rounded-pill bg-primary" style={{ width: `${String(item.progress)}%` }} />
      </div>
      <CardFooter iso={item.updatedAt} left={<span>进度 {String(item.progress)}%</span>} />
    </Link>
  );
}

const INTERVIEW_STATUS: Record<string, string | undefined> = {
  draft: "草稿", topic_pending: "待确认主题", experts_pending: "待确认专家", questions_pending: "待确认问题",
  running: "访谈中", report_pending: "待生成报告", completed: "已完成", failed: "失败",
};

export function InterviewCard({ item }: { item: HomeInterview }) {
  return (
    <Link href={item.href} data-testid={`home-recent-interview-${item.interviewId}`} className={CARD_BASE}>
      <div className="flex items-start justify-between gap-2">
        <h3 className="line-clamp-1 text-12 font-medium text-card-foreground">{item.name}</h3>
        <Pill tone={item.status === "completed" ? "success" : item.status === "failed" ? "warning" : "ai"}>
          {INTERVIEW_STATUS[item.status] ?? "进行中"}
        </Pill>
      </div>
      <CardFooter
        iso={item.updatedAt}
        left={
          item.kind === "batch" && item.expertCount > 0
            ? <span>专家 {String(item.completedExpertCount)}/{String(item.expertCount)}</span>
            : <span>{item.kind === "quick" ? "快捷访谈" : "访谈"}</span>
        }
      />
    </Link>
  );
}

export function SurveyCard({ item }: { item: HomeSurvey }) {
  const label = item.collecting ? "收集中" : item.status === "draft" ? "草稿" : "已发布";
  return (
    <Link href={surveyPath(item.id, "design")} data-testid={`home-recent-survey-${item.id}`} className={CARD_BASE}>
      <div className="flex items-start justify-between gap-2">
        <h3 className="line-clamp-1 text-12 font-medium text-card-foreground">{item.title}</h3>
        <Pill tone={item.collecting ? "ai" : "muted"}>{label}</Pill>
      </div>
      <CardFooter iso={item.updatedAt} />
    </Link>
  );
}
