"use client";
import * as React from "react";
import Link from "next/link";
import {
  FolderKanban, MessagesSquare, Shapes, Brain, ArrowRight, Bot, Sparkles,
} from "lucide-react";
import { useSession } from "@/components/session/session-provider";
import { getHomeConfig, type HomeConfig, type QuickActionKey } from "@/lib/live-home-config";
import { listProjects, type ListProjectsOut } from "@/lib/live-projects";
import { listPersonalThreads } from "@/lib/live-chat";
import { describeHomeConfigFailure } from "@/lib/home-config-failure";

/**
 * 组织首页 —— 登录后的第一落点（束: home，导航项见 `lib/navigation.ts` 的 `key: "home"`）。
 *
 * 2026-09-29 人类裁决「先做完整的后台配置，把这部分一起做完，走 adhoc」——
 * 在 2026-09-29 早些时候落地的「导航项 + 静态框架」基础上（组织名/显示名读
 * `useSession()`，见旧版头注）接上真实后端 `getHomeConfig`（束: home-config，Refs #4634）：
 *   - Banner / 快捷入口 / 组织推荐 = 组织后台配置出来的（`/admin/home-config`）；
 *   - 「继续你的工作」= 每个用户自己的真实数据（最近对话 `listPersonalThreads`、
 *     真实项目 `listProjects`），不是组织级配置，也不是编出来的样例。
 *
 * 三个真实请求并发拉，各自独立降级：配置拉不到就用契约默认态兜底（服务端
 * `getHomeConfig` 未建行时已经返回固定默认值），项目/对话拉不到就那个板块空着，
 * 不因为其中一个失败拖垮整页。
 */

const QUICK_ACTION_CATALOG: Record<QuickActionKey, { href: string; icon: typeof MessagesSquare; label: string; desc: string }> = {
  chat: { href: "/chat", icon: MessagesSquare, label: "对话", desc: "开始一次新的对话" },
  projects: { href: "/projects", icon: FolderKanban, label: "项目", desc: "按项目组织的工作台" },
  board: { href: "/studio/board", icon: Shapes, label: "Board", desc: "白板与协作" },
  brain: { href: "/brain", icon: Brain, label: "大脑", desc: "你的组织记忆" },
};

const BANNER_PRESET_CLASS: Record<HomeConfig["bannerPreset"], string> = {
  ocean: "bg-inverse",
  forest: "bg-gradient-to-br from-success to-ai",
  sunset: "bg-gradient-to-br from-warning to-destructive",
  midnight: "bg-inverse",
};

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; config: HomeConfig };

export function HomeScreen(): JSX.Element {
  const session = useSession();
  const orgId = session.identity?.org.id ?? null;
  const displayName = session.identity?.displayName ?? null;

  const [state, setState] = React.useState<LoadState>({ status: "loading" });
  const [projects, setProjects] = React.useState<ListProjectsOut | null>(null);
  const [recentThreads, setRecentThreads] = React.useState<readonly { id: string; title: string }[] | null>(null);

  React.useEffect(() => {
    if (orgId === null) return;
    let cancelled = false;
    getHomeConfig(orgId)
      .then((config) => { if (!cancelled) setState({ status: "ready", config }); })
      .catch((err: unknown) => {
        if (cancelled) return;
        setState({ status: "error", message: describeHomeConfigFailure(err) });
      });
    listProjects(orgId)
      .then((out) => { if (!cancelled) setProjects(out); })
      .catch(() => { if (!cancelled) setProjects([]); });
    void listPersonalThreads({ limit: 3 })
      .then((out) => {
        if (cancelled) return;
        const cards = out.groups.flatMap((g) => g.cards).slice(0, 3).map((c) => ({ id: c.id, title: c.title }));
        setRecentThreads(cards);
      })
      .catch(() => { if (!cancelled) setRecentThreads([]); });
    return () => { cancelled = true; };
  }, [orgId]);

  if (state.status === "loading") {
    return <div className="p-8 text-13 text-muted-foreground" data-testid="loading">正在加载首页…</div>;
  }
  if (state.status === "error") {
    return <div className="p-8 text-13 text-destructive" data-testid="home-screen-error">{state.message}</div>;
  }

  const { config } = state;
  const quickActions = config.quickActions
    .filter((a) => a.enabled)
    .sort((a, b) => a.order - b.order)
    .map((a) => ({ ...a, ...QUICK_ACTION_CATALOG[a.key] }));
  const recentProjects = (projects ?? []).filter((p) => p.readOnlyReason !== "archived").slice(0, 4);

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-6 py-8" data-testid="home-screen">
      <section
        className={`relative overflow-hidden rounded-container px-8 py-10 text-inverse-foreground shadow-lg ${BANNER_PRESET_CLASS[config.bannerPreset]}`}
        aria-label="组织首页横幅"
      >
        <p className="text-11 font-medium uppercase tracking-wide text-inverse-foreground/70">{config.title}</p>
        <h1 className="mt-2 max-w-lg text-24 font-semibold leading-tight" data-testid="home-greeting">
          {displayName ? `你好，${displayName}` : "欢迎回来"}
        </h1>
        <p className="mt-2 max-w-md text-13 text-inverse-foreground/80">{config.bannerHeadline}</p>
        {config.bannerTagline ? <p className="mt-1 max-w-md text-11 text-inverse-foreground/60">{config.bannerTagline}</p> : null}
      </section>

      {quickActions.length > 0 ? (
        <section aria-label="快捷入口" className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {quickActions.map((a) => <HomeQuickAction key={a.key} href={a.href} icon={a.icon} label={a.label} desc={a.desc} />)}
        </section>
      ) : null}

      {config.recommendedCapabilities.length > 0 ? (
        <section aria-label="组织推荐" className="flex flex-col gap-2">
          <h2 className="text-13 font-semibold text-card-foreground">组织推荐</h2>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {config.recommendedCapabilities.map((c) => (
              <Link
                key={`${c.kind}-${c.refId}`}
                href={c.kind === "agent" ? "/preview/agent-runtime" : "/skill"}
                data-testid={`home-recommended-${c.kind}-${c.refId}`}
                className="flex items-start gap-3 rounded-card border border-border-subtle bg-card p-3 shadow-sm transition-shadow duration-fast hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-control bg-ai-tint text-ai">
                  {c.kind === "agent" ? <Bot aria-hidden className="h-3.5 w-3.5" /> : <Sparkles aria-hidden className="h-3.5 w-3.5" />}
                </span>
                <span className="min-w-0">
                  <span className="block text-12 font-medium text-card-foreground">{c.name}</span>
                  {c.note !== null ? <span className="block text-11 text-muted-foreground">{c.note}</span> : null}
                </span>
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      {(recentProjects.length > 0 || (recentThreads !== null && recentThreads.length > 0)) ? (
        <section aria-label="继续你的工作" className="flex flex-col gap-2">
          <h2 className="text-13 font-semibold text-card-foreground">继续你的工作</h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {recentThreads !== null && recentThreads.length > 0 ? (
              <div className="flex flex-col gap-1">
                <h3 className="text-11 font-medium text-muted-foreground">最近对话</h3>
                {recentThreads.map((t) => (
                  <Link key={t.id} href={`/chat?thread=${t.id}`} data-testid={`home-recent-thread-${t.id}`}
                    className="truncate rounded-control px-2 py-1.5 text-12 text-card-foreground transition-colors duration-fast hover:bg-muted">
                    {t.title}
                  </Link>
                ))}
              </div>
            ) : null}
            {recentProjects.length > 0 ? (
              <div className="flex flex-col gap-1">
                <h3 className="text-11 font-medium text-muted-foreground">我的项目</h3>
                {recentProjects.map((p) => (
                  <Link key={p.id} href={`/projects/${p.id}`} data-testid={`home-recent-project-${p.id}`}
                    className="truncate rounded-control px-2 py-1.5 text-12 text-card-foreground transition-colors duration-fast hover:bg-muted">
                    {p.name}
                  </Link>
                ))}
              </div>
            ) : null}
          </div>
        </section>
      ) : null}
    </div>
  );
}

function HomeQuickAction({
  href, icon: Icon, label, desc,
}: {
  href: string; icon: typeof MessagesSquare; label: string; desc: string;
}): JSX.Element {
  return (
    <Link
      href={href}
      data-testid={`home-quick-action-${label}`}
      className="group flex flex-col gap-2 rounded-card border border-border-subtle bg-card p-4 shadow-sm transition-shadow duration-fast hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span className="flex h-8 w-8 items-center justify-center rounded-control bg-accent text-accent-foreground">
        <Icon aria-hidden className="h-4 w-4" />
      </span>
      <span className="flex items-center gap-1 text-13 font-medium text-card-foreground">
        {label}
        <ArrowRight aria-hidden className="h-3 w-3 text-muted-foreground transition-transform duration-fast group-hover:translate-x-0.5" />
      </span>
      <span className="text-11 text-muted-foreground">{desc}</span>
    </Link>
  );
}
