"use client";
import { useI18n } from "@/lib/i18n/provider";
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
function WorkMeta({ left, iso }: { left: React.ReactNode; iso: string | null }): React.ReactNode {
  const { locale } = useI18n();
  const rel = formatRelativeTime(iso, Date.now(), locale);
  return (
    <>
      <span className="flex min-w-0 items-center gap-1.5">{left}</span>
      {rel !== null ? <span className="shrink-0">{rel}</span> : null}
    </>
  );
}

export function ChatCard({ thread }: { thread: HomeThread }) {
  const { t } = useI18n();
  const THREAD_STATUS: Record<string, { label: string; tone: Tone } | undefined> = {
    running: { label: t("ui.inProgress"), tone: "primary" },
    "awaiting-approval": { label: t("ui.awaitingApproval"), tone: "warning" },
    done: { label: t("ui.completed"), tone: "success" },
    failed: { label: t("ui.failed"), tone: "warning" },
    paused: { label: t("ui.paused"), tone: "neutral" },
  };
  const st = THREAD_STATUS[thread.status];
  return (
    <ResourceCard
      href={`/chat?thread=${encodeURIComponent(thread.id)}`}
      testId={`home-recent-thread-${thread.id}`}
      title={thread.title}
      subtitle={t("ui.chats")}
      badges={st !== undefined ? <Badge tone={st.tone}>{st.label}</Badge> : undefined}
      description={thread.subtitle || undefined}
      meta={<WorkMeta left={thread.artifactCount > 0 ? <span>{t("home.artifacts", { count: thread.artifactCount })}</span> : null} iso={thread.lastActivityAt} />}
    />
  );
}

const MAX_AVATARS = 4;

export function ProjectCard({ project }: { project: HomeProject }) {
  const { t } = useI18n();
  const people = project.collaborators;
  return (
    <ResourceCard
      href={`/projects/${encodeURIComponent(project.id)}`}
      testId={`home-recent-project-${project.id}`}
      title={project.name}
      subtitle={project.kind === "workshop" ? t("ui.workshop") : t("ui.projects")}
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
            {people.length > 2 ? t("home.people", { count: people.length }) : ""}
          </span>
        </div>
      ) : null}
    </ResourceCard>
  );
}

export function ResearchCard({ item }: { item: HomeResearch }) {
  const { t } = useI18n();
  const RESEARCH_STATUS = { active: t("ui.inProgress"), completed: t("ui.completed"), failed: t("ui.failed") } as const;
  const label = RESEARCH_STATUS[item.status as keyof typeof RESEARCH_STATUS] ?? t("ui.inProgress");
  return (
    <ResourceCard
      href={guidedResearchRoute(item.sessionId, item.stage)}
      testId={`home-recent-research-${item.sessionId}`}
      title={item.title}
      subtitle={t("ui.deepResearch")}
      badges={<Badge tone={item.status === "completed" ? "success" : item.status === "failed" ? "warning" : "primary"}>{label}</Badge>}
      meta={<WorkMeta left={<span>{t("home.progress", { progress: item.progress })}</span>} iso={item.updatedAt} />}
    >
      <div className="h-1 overflow-hidden rounded-pill bg-muted" role="progressbar" aria-valuenow={item.progress} aria-valuemin={0} aria-valuemax={100}>
        <div className="h-full rounded-pill bg-primary" style={{ width: `${String(item.progress)}%` }} />
      </div>
    </ResourceCard>
  );
}

export function InterviewCard({ item }: { item: HomeInterview }) {
  const { t } = useI18n();
  const INTERVIEW_STATUS: Record<string, string | undefined> = {
    draft: t("ui.draft"), topic_pending: t("ui.awaitingTopicApproval"), experts_pending: t("ui.awaitingExpertApproval"), questions_pending: t("ui.awaitingQuestionApproval"),
    running: t("ui.interviewInProgress"), report_pending: t("ui.awaitingReport"), completed: t("ui.completed"), failed: t("ui.failed"),
  };
  return (
    <ResourceCard
      href={item.href}
      testId={`home-recent-interview-${item.interviewId}`}
      title={item.name}
      subtitle={item.kind === "quick" ? t("ui.quickInterview") : t("ui.userInterviews")}
      badges={
        <Badge tone={item.status === "completed" ? "success" : item.status === "failed" ? "warning" : "primary"}>
          {INTERVIEW_STATUS[item.status] ?? t("ui.inProgress")}
        </Badge>
      }
      meta={<WorkMeta left={item.kind === "batch" && item.expertCount > 0 ? <span>{t("home.experts", { completed: item.completedExpertCount, total: item.expertCount })}</span> : null} iso={item.updatedAt} />}
    />
  );
}

export function SurveyCard({ item }: { item: HomeSurvey }) {
  const { t } = useI18n();
  const label = item.collecting ? t("ui.collectingResponses") : item.status === "draft" ? t("ui.draft") : t("ui.published");
  return (
    <ResourceCard
      href={surveyPath(item.id, "design")}
      testId={`home-recent-survey-${item.id}`}
      title={item.title}
      subtitle={t("ui.surveys")}
      badges={<Badge tone={item.collecting ? "primary" : "neutral"}>{label}</Badge>}
      meta={<WorkMeta left={null} iso={item.updatedAt} />}
    />
  );
}
