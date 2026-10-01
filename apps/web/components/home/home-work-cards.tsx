"use client";
import * as React from "react";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { ResourceCard, ResourceCardTags } from "@/components/ui/resource-card";
import { formatRelativeTime, initialsOf } from "@/lib/home-format";
import { guidedResearchRoute } from "@/lib/guided-research-routes";
import { surveyPath } from "@/lib/survey/paths";
import type { HomeInterview, HomeProject, HomeResearch, HomeSurvey, HomeThread } from "./use-home-work";

/**
 * 「继续你的工作」的卡片。卡片只展示真实字段：没有的字段（如协作者没取到）整块省略，
 * 不填占位。所有卡片是一个整体可点的链接（键盘可达、有焦点环）。
 */
type Tone = "neutral" | "primary" | "success" | "warning";

/** 卡片元信息行左侧内容 + 右侧「多久以前」。 */
function metaOf(left: React.ReactNode, iso: string | null): React.ReactNode {
  const rel = formatRelativeTime(iso);
  return (
    <>
      <span className="flex min-w-0 items-center gap-1.5">{left}</span>
      {rel !== null ? <span className="shrink-0">{rel}</span> : null}
    </>
  );
}

const THREAD_STATUS: Record<string, { label: string; tone: Tone } | undefined> = {
  running: { label: "进行中", tone: "primary" },
  "awaiting-approval": { label: "待确认", tone: "warning" },
  done: { label: "已完成", tone: "success" },
  failed: { label: "失败", tone: "warning" },
  paused: { label: "已暂停", tone: "neutral" },
};

export function ChatCard({ thread }: { thread: HomeThread }) {
  const st = THREAD_STATUS[thread.status];
  return (
    <ResourceCard
      href={`/chat?thread=${encodeURIComponent(thread.id)}`}
      testId={`home-recent-thread-${thread.id}`}
      title={thread.title}
      subtitle="对话"
      badges={st !== undefined ? <Badge tone={st.tone}>{st.label}</Badge> : undefined}
      description={thread.subtitle || undefined}
      meta={metaOf(thread.artifactCount > 0 ? <span>{String(thread.artifactCount)} 个产出物</span> : null, thread.lastActivityAt)}
    />
  );
}

const MAX_AVATARS = 4;

export function ProjectCard({ project }: { project: HomeProject }) {
  const people = project.collaborators;
  return (
    <ResourceCard
      href={`/projects/${encodeURIComponent(project.id)}`}
      testId={`home-recent-project-${project.id}`}
      title={project.name}
      subtitle={project.kind === "workshop" ? "工作坊" : "项目"}
      tags={<ResourceCardTags tags={project.tags} max={3} />}
    >
      {people !== null && people.length > 0 ? (
        <div className="flex items-center gap-2" data-testid={`home-project-collaborators-${project.id}`}>
          <span className="flex -space-x-1">
            {people.slice(0, MAX_AVATARS).map((p) => (
              <Avatar key={p.userId} initials={initialsOf(p.displayName, 1)} size="sm" className="ring-2 ring-card" title={p.displayName} />
            ))}
          </span>
          <span className="truncate text-11 text-muted-foreground">
            {people.slice(0, 2).map((p) => p.displayName).join("、")}
            {people.length > 2 ? ` 等 ${String(people.length)} 人` : ""}
          </span>
        </div>
      ) : null}
    </ResourceCard>
  );
}

const RESEARCH_STATUS = { active: "进行中", completed: "已完成", failed: "失败" } as const;

export function ResearchCard({ item }: { item: HomeResearch }) {
  const label = RESEARCH_STATUS[item.status as keyof typeof RESEARCH_STATUS] ?? "进行中";
  return (
    <ResourceCard
      href={guidedResearchRoute(item.sessionId, item.stage)}
      testId={`home-recent-research-${item.sessionId}`}
      title={item.title}
      subtitle="深度研究"
      badges={<Badge tone={item.status === "completed" ? "success" : item.status === "failed" ? "warning" : "primary"}>{label}</Badge>}
      meta={metaOf(<span>进度 {String(item.progress)}%</span>, item.updatedAt)}
    >
      <div className="h-1 overflow-hidden rounded-pill bg-muted" role="progressbar" aria-valuenow={item.progress} aria-valuemin={0} aria-valuemax={100}>
        <div className="h-full rounded-pill bg-primary" style={{ width: `${String(item.progress)}%` }} />
      </div>
    </ResourceCard>
  );
}

const INTERVIEW_STATUS: Record<string, string | undefined> = {
  draft: "草稿", topic_pending: "待确认主题", experts_pending: "待确认专家", questions_pending: "待确认问题",
  running: "访谈中", report_pending: "待生成报告", completed: "已完成", failed: "失败",
};

export function InterviewCard({ item }: { item: HomeInterview }) {
  return (
    <ResourceCard
      href={item.href}
      testId={`home-recent-interview-${item.interviewId}`}
      title={item.name}
      subtitle={item.kind === "quick" ? "快捷访谈" : "用户访谈"}
      badges={
        <Badge tone={item.status === "completed" ? "success" : item.status === "failed" ? "warning" : "primary"}>
          {INTERVIEW_STATUS[item.status] ?? "进行中"}
        </Badge>
      }
      meta={metaOf(
        item.kind === "batch" && item.expertCount > 0
          ? <span>专家 {String(item.completedExpertCount)}/{String(item.expertCount)}</span>
          : null,
        item.updatedAt,
      )}
    />
  );
}

export function SurveyCard({ item }: { item: HomeSurvey }) {
  const label = item.collecting ? "收集中" : item.status === "draft" ? "草稿" : "已发布";
  return (
    <ResourceCard
      href={surveyPath(item.id, "design")}
      testId={`home-recent-survey-${item.id}`}
      title={item.title}
      subtitle="问卷"
      badges={<Badge tone={item.collecting ? "primary" : "neutral"}>{label}</Badge>}
      meta={metaOf(null, item.updatedAt)}
    />
  );
}
