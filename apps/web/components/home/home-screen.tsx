"use client";
import * as React from "react";
import { useSession } from "@/components/session/session-provider";
import { getHomeConfig, type HomeConfig } from "@/lib/live-home-config";
import { describeHomeConfigFailure } from "@/lib/home-config-failure";
import { HomeBanner } from "./home-banner";
import { useHomeTasks, useHomeWork } from "./use-home-work";
import {
  AgentsStrip, CapabilityRecommendations, CurrentTasksSection, FeedbackRow, QuickActionsGrid, RecentWorkSection,
} from "./home-sections";

/**
 * 组织首页 —— 登录后的第一落点（束: home，导航项见 `lib/navigation.ts` 的 `key: "home"`）。
 *
 * 配置（横幅/入口/推荐数字人与 Skill/板块开关）来自组织后台 `/org-admin/home-config`；
 * 「继续你的工作」「当前任务」是**每个用户自己的真实数据**，不是组织级配置，也不编样例。
 * 各类数据各自独立请求、独立降级（见 `use-home-work.ts`）。设计与取舍：
 * `docs/design/org-home-page/README.md`。
 */
type ConfigState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; config: HomeConfig };

export function HomeScreen(): JSX.Element {
  const session = useSession();
  const orgId = session.identity?.org.id ?? null;
  const displayName = session.identity?.displayName ?? null;

  const [state, setState] = React.useState<ConfigState>({ status: "loading" });
  React.useEffect(() => {
    if (orgId === null) return;
    let cancelled = false;
    getHomeConfig(orgId)
      .then((config) => { if (!cancelled) setState({ status: "ready", config }); })
      .catch((err: unknown) => { if (!cancelled) setState({ status: "error", message: describeHomeConfigFailure(err) }); });
    return () => { cancelled = true; };
  }, [orgId]);

  const config = state.status === "ready" ? state.config : null;
  const showRecent = config?.sections.recentWork ?? false;
  const showTasks = config?.sections.currentTasks ?? false;
  // 项目列表同时喂「继续你的工作」与「当前任务」，任一栏开着就要拉。
  const work = useHomeWork(orgId, showRecent || showTasks);
  const tasks = useHomeTasks(work.projects, showTasks);

  if (state.status === "loading") {
    return <div className="p-8 text-13 text-muted-foreground" data-testid="loading">正在加载首页…</div>;
  }
  if (state.status === "error") {
    return (
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-6 py-8">
        <div className="text-13 text-destructive" data-testid="home-screen-error">{state.message}</div>
        <FeedbackRow />
      </div>
    );
  }

  const { config: c } = state;
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-6 py-8" data-testid="home-screen">
      <HomeBanner
        title={c.title}
        greeting={displayName ? `你好，${displayName}` : "欢迎回来"}
        headline={c.bannerHeadline}
        tagline={c.bannerTagline}
        preset={c.bannerPreset}
        color={c.bannerColor}
        imageUrl={c.bannerImageUrl}
      />
      <QuickActionsGrid actions={c.quickActions} />
      <AgentsStrip agents={c.recommendedAgents} />
      <CapabilityRecommendations items={c.recommendedCapabilities} />
      {showTasks ? <CurrentTasksSection tasks={tasks} projects={work.projects} /> : null}
      {showRecent ? <RecentWorkSection work={work} /> : null}
      <FeedbackRow />
    </div>
  );
}
