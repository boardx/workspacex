/**
 * `getHomeConfig`（ad-hoc feature，Refs #4634）—— 任意组织成员可读，
 * 授权判定在 controller 层（同 `listOrgMembers` 先例：`requireAdminRole` 只确认成员资格）。
 *
 * 未建过行的组织拿到的是**这份固定默认值**，不是编出来的组织专属文案——
 * 2026-09-24 人类指令「取消所有 mockup 数据」同一条纪律：默认态诚实地说
 * 「这是默认首页」，不假装是这个组织自己写的话。
 */
import type { OrgId } from "../../domain/org-id";
import type { HomeConfig, HomeConfigRepository, QuickAction } from "./home-config-ports";

export const DEFAULT_HOME_CONFIG_TITLE = "WorkspaceX";
export const DEFAULT_HOME_CONFIG_TAGLINE = null;
export const DEFAULT_HOME_CONFIG_BANNER_HEADLINE = "让创造更有人性，让协作更有效率";
export const DEFAULT_HOME_CONFIG_BANNER_TAGLINE = "在同一个工作面上，和 AI 一起完成一件事。";
export const DEFAULT_HOME_CONFIG_BANNER_PRESET = "ocean" as const;
/** 默认入口：聊天、项目、研究、访谈、问卷、录音、设计、大脑（Board/任务默认关，任务另有独立栏）。 */
export const DEFAULT_HOME_CONFIG_QUICK_ACTIONS: QuickAction[] = [
  { key: "chat", enabled: true, order: 0 },
  { key: "projects", enabled: true, order: 1 },
  { key: "research", enabled: true, order: 2 },
  { key: "interview", enabled: true, order: 3 },
  { key: "survey", enabled: true, order: 4 },
  { key: "recording", enabled: true, order: 5 },
  { key: "design", enabled: true, order: 6 },
  { key: "brain", enabled: true, order: 7 },
  { key: "board", enabled: false, order: 8 },
  { key: "tasks", enabled: false, order: 9 },
];

export interface GetHomeConfigDeps {
  readonly repo: HomeConfigRepository;
}

export async function getHomeConfig(deps: GetHomeConfigDeps, orgId: OrgId): Promise<HomeConfig> {
  const existing = await deps.repo.get(orgId);
  if (existing !== null) return existing;
  return {
    orgId,
    title: DEFAULT_HOME_CONFIG_TITLE,
    tagline: DEFAULT_HOME_CONFIG_TAGLINE,
    bannerHeadline: DEFAULT_HOME_CONFIG_BANNER_HEADLINE,
    bannerTagline: DEFAULT_HOME_CONFIG_BANNER_TAGLINE,
    bannerPreset: DEFAULT_HOME_CONFIG_BANNER_PRESET,
    bannerColor: null,
    bannerImageUrl: null,
    quickActions: DEFAULT_HOME_CONFIG_QUICK_ACTIONS,
    recommendedCapabilities: [],
    recommendedAgents: [],
    sections: { recentWork: true, currentTasks: true },
    updatedAt: new Date(0).toISOString(),
    updatedBy: null,
  };
}
