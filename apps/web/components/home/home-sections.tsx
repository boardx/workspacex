"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, Bot, MessageSquarePlus, Sparkles } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { useOptionalFeedback } from "@/components/feedback/feedback-provider";
import { QUICK_ACTION_CATALOG } from "@/lib/home-config-catalog";
import { initialsOf } from "@/lib/home-format";
import type { HomeConfig } from "@/lib/live-home-config";
import { startChatWithSkill } from "@/lib/start-chat-with-skill";
import type { RenderedTaskCard } from "@/lib/live-tasks";
import { cn } from "@/lib/utils";
import { ChatCard, InterviewCard, ProjectCard, ResearchCard, SurveyCard } from "./home-work-cards";
import type { HomeProject, HomeTasks, Load, useHomeWork } from "./use-home-work";

const TILE =
  "group flex flex-col gap-2 rounded-card border border-border-subtle bg-card p-4 shadow-sm transition-shadow duration-fast hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

function SectionTitle({ children, href, hrefLabel }: { children: React.ReactNode; href?: string; hrefLabel?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <h2 className="text-16 font-semibold text-card-foreground">{children}</h2>
      {href !== undefined ? (
        <Link href={href} className="text-12 text-brand-ink transition-colors duration-fast hover:text-card-foreground">
          {hrefLabel ?? "查看全部"}
        </Link>
      ) : null}
    </div>
  );
}

export function QuickActionsGrid({ actions }: { actions: HomeConfig["quickActions"] }) {
  const items = actions
    .filter((a) => a.enabled)
    .sort((a, b) => a.order - b.order)
    .map((a) => ({ key: a.key, ...QUICK_ACTION_CATALOG[a.key] }));
  if (items.length === 0) return null;
  return (
    <section aria-label="快捷入口" className="grid grid-cols-2 gap-3 sm:grid-cols-4" data-testid="home-quick-actions">
      {items.map(({ key, href, icon: Icon, label, desc }, index) => (
        <Link key={key} href={href} data-testid={`home-quick-action-${key}`} style={{ backgroundColor: `color-mix(in srgb, hsl(var(--${["secondary", "primary", "accent", "secondary"][index % 4]})) 10%, hsl(var(--card)))` }} className={cn(TILE, "min-h-36 border-transparent p-5")}>
          <span className="flex h-8 w-8 items-center justify-center rounded-control bg-accent text-accent-foreground">
            <Icon aria-hidden className="h-4 w-4" />
          </span>
          <span className="flex items-center gap-1 text-13 font-medium text-card-foreground">
            {label}
            <ArrowRight aria-hidden className="h-3 w-3 text-muted-foreground transition-transform duration-fast group-hover:translate-x-0.5" />
          </span>
          <span className="text-11 text-muted-foreground">{desc}</span>
        </Link>
      ))}
    </section>
  );
}

/** 组织推荐的数字人（带头像）。点击 = 与该数字人开始一次新对话（`/chat?agent=`，已有深链）。 */
export function AgentsStrip({ agents }: { agents: HomeConfig["recommendedAgents"] }) {
  if (agents.length === 0) return null;
  return (
    <section aria-label="推荐数字人" className="flex flex-col gap-2" data-testid="home-agents">
      <SectionTitle href="/agent" hrefLabel="全部数字人">数字人</SectionTitle>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {agents.map((a) => (
          <Link
            key={a.agentId}
            href={`/chat?agent=${encodeURIComponent(a.agentId)}`}
            data-testid={`home-agent-${a.agentId}`}
            className={cn(TILE, "flex-row items-center gap-3 p-3")}
          >
            <Avatar initials={initialsOf(a.name)} avatarKey={a.avatarKey} tone="ai" size="lg" />
            <span className="min-w-0">
              <span className="block truncate text-12 font-medium text-card-foreground">{a.name}</span>
              {a.roleLabel ? <span className="block truncate text-11 text-muted-foreground">{a.roleLabel}</span> : null}
              {a.note ? <span className="mt-0.5 block line-clamp-2 text-11 text-muted-foreground">{a.note}</span> : null}
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}

/**
 * 组织推荐的能力。Skill 点击 → 新建对话并**自动挂载该 Skill**（不再跳后台 Skill 目录）；
 * 挂载失败时不假装成功：留在首页显示原因并给出已建好的空对话入口。
 */
export function CapabilityRecommendations({ items }: { items: HomeConfig["recommendedCapabilities"] }) {
  const router = useRouter();
  const [pending, setPending] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<{ name: string; threadId: string } | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  if (items.length === 0) return null;

  async function openSkill(refId: string, name: string) {
    if (pending !== null) return;
    setPending(refId);
    setError(null);
    setNotice(null);
    try {
      const r = await startChatWithSkill({ skillId: refId, name });
      if (r.mounted) router.push(`/chat?thread=${encodeURIComponent(r.threadId)}`);
      else setNotice({ name, threadId: r.threadId });
    } catch {
      setError(`没能为「${name}」新建对话，稍后再试一次`);
    } finally {
      setPending(null);
    }
  }

  return (
    <section aria-label="组织推荐" className="flex flex-col gap-2" data-testid="home-recommendations">
      <SectionTitle href="/skill?screen=work-catalog" hrefLabel="Skill 库">组织推荐</SectionTitle>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {items.map((c) => {
          const body = (
            <>
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-control bg-ai-tint text-ai">
                {c.kind === "agent" ? <Bot aria-hidden className="h-3.5 w-3.5" /> : <Sparkles aria-hidden className="h-3.5 w-3.5" />}
              </span>
              <span className="min-w-0">
                <span className="block text-12 font-medium text-card-foreground">{c.name}</span>
                {c.note !== null ? <span className="block text-11 text-muted-foreground">{c.note}</span> : null}
              </span>
            </>
          );
          const cls = cn(TILE, "flex-row items-start gap-3 p-3 text-left");
          return c.kind === "agent" ? (
            <Link key={`${c.kind}-${c.refId}`} href={`/chat?agent=${encodeURIComponent(c.refId)}`} data-testid={`home-recommended-agent-${c.refId}`} className={cls}>
              {body}
            </Link>
          ) : (
            <button
              key={`${c.kind}-${c.refId}`}
              type="button"
              disabled={pending !== null}
              onClick={() => void openSkill(c.refId, c.name)}
              data-testid={`home-recommended-skill-${c.refId}`}
              className={cn(cls, "disabled:cursor-wait")}
            >
              {body}
              {pending === c.refId ? <span className="ml-auto shrink-0 text-10 text-muted-foreground">正在新建对话…</span> : null}
            </button>
          );
        })}
      </div>
      {error !== null ? <p role="alert" className="text-11 text-destructive">{error}</p> : null}
      {notice !== null ? (
        <p role="alert" className="text-11 text-muted-foreground" data-testid="home-skill-mount-failed">
          没能自动加载「{notice.name}」（可能这个 Skill 现在不可用或你没有挂载权限）。
          <Link href={`/chat?thread=${encodeURIComponent(notice.threadId)}`} className="ml-1 text-primary underline">打开已新建的空对话</Link>
        </p>
      ) : null}
    </section>
  );
}

function TaskRow({ t }: { t: RenderedTaskCard }) {
  return (
    <li className="flex items-center justify-between gap-2 rounded-control px-2 py-1.5 text-12 text-card-foreground">
      <span className="truncate">{t.title}</span>
      {t.dueAt ? <span className="shrink-0 text-10 text-muted-foreground">{t.dueAt.slice(0, 10)}</span> : null}
    </li>
  );
}

/** 「当前任务」栏：我的任务 + 进行中的项目。都是真实数据；没有就如实说没有。 */
export function CurrentTasksSection({ tasks, projects }: { tasks: Load<HomeTasks | null>; projects: Load<HomeProject[]> }) {
  const projectItems = projects.status === "ready" ? projects.items : [];
  return (
    <section aria-label="当前任务" className="flex flex-col gap-2" data-testid="home-current-tasks">
      <SectionTitle href="/tasks">当前任务</SectionTitle>
      <div className="grid grid-cols-1 gap-4 rounded-card border border-border-subtle bg-card p-3 shadow-sm sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          <h3 className="text-11 font-medium text-muted-foreground">我的任务</h3>
          {tasks.status === "loading" ? <p className="text-11 text-muted-foreground">加载中…</p> : null}
          {tasks.status === "error" ? <p className="text-11 text-muted-foreground">任务暂时加载不出来</p> : null}
          {tasks.status === "ready" && (tasks.items === null || tasks.items.mine.length === 0) ? (
            <p className="text-11 text-muted-foreground">目前没有需要你处理的任务</p>
          ) : null}
          {tasks.status === "ready" && tasks.items !== null && tasks.items.mine.length > 0 ? (
            <ul>{tasks.items.mine.map((t) => <TaskRow key={t.id} t={t} />)}</ul>
          ) : null}
        </div>
        <div className="flex flex-col gap-1">
          <h3 className="text-11 font-medium text-muted-foreground">进行中的项目</h3>
          {projects.status === "ready" && projectItems.length === 0 ? <p className="text-11 text-muted-foreground">还没有进行中的项目</p> : null}
          {projects.status === "error" ? <p className="text-11 text-muted-foreground">项目暂时加载不出来</p> : null}
          <ul>
            {projectItems.map((p) => (
              <li key={p.id}>
                <Link href={`/projects/${encodeURIComponent(p.id)}`} className="block truncate rounded-control px-2 py-1.5 text-12 text-card-foreground transition-colors duration-fast hover:bg-muted">
                  {p.name}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

function Group<T>({
  title, href, load, render,
}: {
  title: string;
  href: string;
  load: Load<T[]>;
  render: (item: T) => React.ReactNode;
}) {
  // 拉不到 / 为空：整组不显示（不编占位）；整体空态由父级统一说。
  if (load.status !== "ready" || load.items.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      <SectionTitle href={href}>{title}</SectionTitle>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">{load.items.map(render)}</div>
    </div>
  );
}

export function RecentWorkSection({ work }: { work: ReturnType<typeof useHomeWork> }) {
  const loads = [work.threads, work.projects, work.research, work.interviews, work.surveys];
  const allDone = loads.every((l) => l.status !== "loading");
  const anyContent = loads.some((l) => l.status === "ready" && l.items.length > 0);
  return (
    <section aria-label="继续你的工作" className="flex flex-col gap-4" data-testid="home-recent-work">
      <h2 className="text-16 font-semibold text-card-foreground">继续你的工作</h2>
      <Group title="对话" href="/chat" load={work.threads} render={(t) => <ChatCard key={t.id} thread={t} />} />
      <Group title="项目" href="/projects" load={work.projects} render={(p) => <ProjectCard key={p.id} project={p} />} />
      <Group title="深度研究" href="/research" load={work.research} render={(r) => <ResearchCard key={r.sessionId} item={r} />} />
      <Group title="用户访谈" href="/itv" load={work.interviews} render={(i) => <InterviewCard key={i.interviewId} item={i} />} />
      <Group title="问卷" href="/studio/survey" load={work.surveys} render={(s) => <SurveyCard key={s.id} item={s} />} />
      {allDone && !anyContent ? (
        <p className="text-12 text-muted-foreground" data-testid="home-recent-empty">还没有可以继续的工作，从上面的入口开始一个吧。</p>
      ) : null}
    </section>
  );
}

/** 每个首页都有的「提交反馈」（不受组织配置影响，也不因配置加载失败而消失）。 */
export function FeedbackRow() {
  const feedback = useOptionalFeedback();
  if (feedback === null) return null;
  return (
    <div className="flex items-center justify-center gap-2 border-t border-border-subtle pt-4 text-11 text-muted-foreground" data-testid="home-feedback">
      <span>有想法，或者遇到问题？</span>
      <button
        type="button"
        onClick={() => feedback.openFeedback({ target: { kind: "product" }, targetLabel: null })}
        data-testid="home-feedback-button"
        className="inline-flex items-center gap-1 rounded-control px-2 py-1 font-medium text-primary transition-colors duration-fast hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <MessageSquarePlus aria-hidden className="h-3.5 w-3.5" />
        提交反馈
      </button>
    </div>
  );
}
