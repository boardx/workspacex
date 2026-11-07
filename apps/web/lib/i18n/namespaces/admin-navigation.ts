import type { AdminModuleKey } from "@/lib/admin-nav-metadata";

type ItemMessages = { [K in AdminModuleKey as `adminNavigation.item.${K}`]: string };

const itemsZhCN = {
  "adminNavigation.item.agent": "Agent 目录",
  "adminNavigation.item.skill": "Skill 目录",
  "adminNavigation.item.model": "模型",
  "adminNavigation.item.mcp": "MCP",
  "adminNavigation.item.canvasadmin": "画布模板",
  "adminNavigation.item.blueprint": "项目模板",
  "adminNavigation.item.overview": "总览",
  "adminNavigation.item.org-members": "成员",
  "adminNavigation.item.org-invites": "邀请",
  "adminNavigation.item.org-profile": "组织资料",
  "adminNavigation.item.home-config": "首页配置",
  "adminNavigation.item.workflow-grants": "工作流权限",
  "adminNavigation.item.members": "成员配额",
  "adminNavigation.item.local": "我的本地",
  "adminNavigation.item.ops-status": "运营状态",
  "adminNavigation.item.telemetry": "上报设置",
  "adminNavigation.item.feedback-drafts": "反馈草稿",
  "adminNavigation.item.inbox": "运营收件箱",
  "adminNavigation.item.design-workbench": "PM 设计工作台",
  "adminNavigation.item.model-tests": "模型能力测试",
  "adminNavigation.item.organizations": "组织与套餐",
  "adminNavigation.item.platform": "平台成员",
} as const satisfies ItemMessages;

export const adminNavigationZhCN = {
  ...itemsZhCN,
  "navigation.admin": "组织后台",
  "navigation.platform-admin": "平台后台",
  "adminNavigation.scope.org.intro": "当前组织的总览、成员配额与本地组织",
  "adminNavigation.scope.platform.intro": "全平台的 AI 能力、账号与运营管理面",
  "adminNavigation.modules": "{title}模块",
  "adminNavigation.group.ai": "AI 能力",
  "adminNavigation.group.org": "组织",
  "adminNavigation.group.operations": "运营",
  "adminNavigation.group.platform": "平台",
  "adminNavigation.count.available": "{label} 共 {count} 项",
  "adminNavigation.count.unavailable": "{label} 计数暂不可用",
  "adminNavigation.count.description": "{label}：尚未接入真实数据源，因此不显示数字（不是 0）",
  "adminNavigation.secondary.title": "能力域 · 全生命周期",
  "adminNavigation.secondary.preview": "预览 · 未接后端",
  "adminNavigation.secondary.previewDescription": "{label}：预览，尚未接入真实后端",
} as const;

export const adminNavigationEn: Record<keyof typeof adminNavigationZhCN, string> = {
  "adminNavigation.item.agent": "Agent directory",
  "adminNavigation.item.skill": "Skill directory",
  "adminNavigation.item.model": "Models",
  "adminNavigation.item.mcp": "MCP",
  "adminNavigation.item.canvasadmin": "Canvas templates",
  "adminNavigation.item.blueprint": "Project templates",
  "adminNavigation.item.overview": "Overview",
  "adminNavigation.item.org-members": "Members",
  "adminNavigation.item.org-invites": "Invitations",
  "adminNavigation.item.org-profile": "Organization profile",
  "adminNavigation.item.home-config": "Home configuration",
  "adminNavigation.item.workflow-grants": "Workflow permissions",
  "adminNavigation.item.members": "Member quotas",
  "adminNavigation.item.local": "My local",
  "adminNavigation.item.ops-status": "Operations status",
  "adminNavigation.item.telemetry": "Telemetry settings",
  "adminNavigation.item.feedback-drafts": "Feedback drafts",
  "adminNavigation.item.inbox": "Operations inbox",
  "adminNavigation.item.design-workbench": "PM design workbench",
  "adminNavigation.item.model-tests": "Model capability tests",
  "adminNavigation.item.organizations": "Organizations and plans",
  "adminNavigation.item.platform": "Platform members",
  "navigation.admin": "Organization admin",
  "navigation.platform-admin": "Platform admin",
  "adminNavigation.scope.org.intro": "Overview, member quotas and local organizations for the current organization",
  "adminNavigation.scope.platform.intro": "Platform-wide AI capabilities, accounts and operations",
  "adminNavigation.modules": "{title} modules",
  "adminNavigation.group.ai": "AI capabilities",
  "adminNavigation.group.org": "Organization",
  "adminNavigation.group.operations": "Operations",
  "adminNavigation.group.platform": "Platform",
  "adminNavigation.count.available": "Count for {label}: {count}",
  "adminNavigation.count.unavailable": "{label} count unavailable",
  "adminNavigation.count.description": "{label}: no live data source is connected, so no number is shown (not zero)",
  "adminNavigation.secondary.title": "Capability domains · Full lifecycle",
  "adminNavigation.secondary.preview": "Preview · Backend not connected",
  "adminNavigation.secondary.previewDescription": "{label}: preview, not connected to a live backend",
};

type GroupMessageKey = Extract<keyof typeof adminNavigationZhCN, `adminNavigation.group.${string}`>;
/** Derive lookup from canonical defaults rather than keeping a second group table. */
export const adminNavigationGroupKeys = Object.fromEntries(
  (Object.keys(adminNavigationZhCN) as (keyof typeof adminNavigationZhCN)[])
    .filter((key): key is GroupMessageKey => key.startsWith("adminNavigation.group."))
    .map((key) => [adminNavigationZhCN[key], key]),
) as Record<string, GroupMessageKey | undefined>;
