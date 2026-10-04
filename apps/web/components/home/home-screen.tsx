"use client";
import * as React from "react";
import { useSession } from "@/components/session/session-provider";
import { getHomeConfig, type HomeConfig } from "@/lib/live-home-config";
import { homeThemeStyle } from "@/lib/home-theme";
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

/**
 * 首页的整页视图：给定一份配置就渲染成员看到的样子。首页（`HomeScreen`）与后台配置屏的
 * 「预览」标签共用它——预览喂的是表单里**未保存**的配置，所以预览即所见，不存在第二份布局。
 * `orgId` 为空时不拉个人数据（只画配置部分）。
 */
export function HomeView({
  config: c, orgId, displayName,
}: { config: HomeConfig; orgId: string | null; displayName: string | null }): JSX.Element {
  const showRecent = c.sections.recentWork;
  const showTasks = c.sections.currentTasks;
  // 项目列表同时喂「继续你的工作」与「当前任务」，任一栏开着就要拉。
  const work = useHomeWork(orgId, showRecent || showTasks);
  const tasks = useHomeTasks(work.projects, showTasks);
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-4 py-8 sm:px-8 lg:px-12 lg:py-10" style={homeThemeStyle(c.themeColors)} data-testid="home-screen">
      <HomeBanner
        orgId={orgId}
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
      {showRecent ? <RecentWorkSection work={work} /> : null}
      {showTasks ? <CurrentTasksSection tasks={tasks} projects={work.projects} /> : null}
      <FeedbackRow />
    </div>
  );
}

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
  return <HomeView config={state.config} orgId={orgId} displayName={displayName} />;
}
