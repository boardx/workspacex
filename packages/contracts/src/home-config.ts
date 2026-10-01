/**
 * 组织首页配置（ad-hoc feature，Refs #4634；设计原型见
 * `docs/design/org-home-page/README.md`）。
 *
 * 两条操作：
 *   - `getHomeConfig`：任意组织成员可读（首页登录即看，不是管理员专属）。
 *   - `updateHomeConfig`：仅组织 admin（`FORBIDDEN`），非成员 `NO_ORG_MEMBERSHIP`。
 *
 * `recommendedCapabilities` 引用真实 Agent（`agentRuntime.listAgents`，
 * `agent-runtime.ts` AR13：admin-only）/ Skill（`skills.listSkills`）——但保存时
 * 把 `name` 快照进这张配置，首页读取不反查那两个接口（AR13 的 admin-only 授权面
 * 不因此对普通成员开一个后门）。`refId` 失效（对应 agent/skill 被删）时前端按
 * 「这条推荐已失效」处理，不是本契约的职责。
 */
import { z } from "zod";

/** `custom` = 用 `bannerColor`（`#RRGGBB`）。其余是设计 token 渐变预设。 */
export const BannerPreset = z.enum([
  "ocean", "forest", "sunset", "midnight", "rose", "slate", "amber", "violet", "custom",
]);

/** 自定义横幅色：只收 `#RRGGBB`（大小写均可），不收简写/带 alpha——一个格式一份校验。 */
export const BannerColor = z.string().regex(/^#[0-9a-fA-F]{6}$/);

/** 首页品牌色，旧客户端省略此字段时保留已保存配色。 */
export const ThemeColors = z.object({
  primary: BannerColor, secondary: BannerColor, accent: BannerColor,
  success: BannerColor, warning: BannerColor, error: BannerColor,
}).strict();
export const DEFAULT_HOME_THEME = {
  primary: "#2F6FED", secondary: "#089FA8", accent: "#C3EEEA",
  success: "#158567", warning: "#A65B12", error: "#CC334B",
} as const;

/** 与 `apps/web/lib/navigation.ts` 里真实存在的顶层路由一一对应，不是自由字符串——
 *  首页快捷入口只能链到产品里真的走得到的地方（同 UC-0.4 R4 的精神）。 */
export const QuickActionKey = z.enum([
  "chat", "projects", "board", "brain", "research", "interview", "survey", "recording", "design", "tasks",
]);

export const QuickAction = z
  .object({
    key: QuickActionKey,
    enabled: z.boolean(),
    order: z.number().int().min(0),
  })
  .strict();

export const RecommendedCapabilityKind = z.enum(["agent", "skill"]);

export const RecommendedCapability = z
  .object({
    kind: RecommendedCapabilityKind,
    refId: z.string().min(1),
    /** 选中那一刻的展示名快照，见文件头注。 */
    name: z.string().min(1).max(60),
    note: z.string().max(80).nullable(),
  })
  .strict();

/**
 * 推荐的数字人（Agent）。选中时把展示信息快照进配置（同 `RecommendedCapability` 的理由：
 * 首页读取不反查 admin-only 的 `listAgents`）。`avatarKey` 是 `agent-role.AvatarKey`
 * 的插画键（本仓 Agent 头像只有插画键，没有图片文件）；未知键前端回落到首字母。
 */
export const RecommendedAgent = z
  .object({
    agentId: z.string().min(1),
    name: z.string().min(1).max(60),
    roleLabel: z.string().max(60).nullable(),
    avatarKey: z.string().max(60).nullable(),
    note: z.string().max(80).nullable(),
  })
  .strict();

/** 首页可开关的整块内容。 */
export const HomeSections = z
  .object({
    /** 「继续你的工作」（对话/项目/研究/访谈/问卷卡片）。 */
    recentWork: z.boolean(),
    /** 「当前任务」栏（进行中的项目与我的任务）。 */
    currentTasks: z.boolean(),
  })
  .strict();

export const HomeConfig = z
  .object({
    orgId: z.string(),
    title: z.string().min(1).max(24),
    tagline: z.string().max(80).nullable(),
    bannerHeadline: z.string().min(1).max(60),
    bannerTagline: z.string().max(120),
    themeColors: ThemeColors.nullable().optional(),
    bannerPreset: BannerPreset,
    /** 仅 `bannerPreset === "custom"` 时生效；其余为 null。 */
    bannerColor: BannerColor.nullable(),
    /** 横幅背景图（组织 admin 上传）；`null` = 用配色。读取走 `GET` 该 URL（需鉴权）。 */
    bannerImageUrl: z.string().nullable(),
    quickActions: z.array(QuickAction).max(10),
    recommendedCapabilities: z.array(RecommendedCapability).max(6),
    recommendedAgents: z.array(RecommendedAgent).max(6),
    sections: HomeSections,
    updatedAt: z.string(),
    updatedBy: z.string().nullable(),
  })
  .strict();

export const HomeConfigError = z.enum([
  "NO_ORG_MEMBERSHIP", "FORBIDDEN", "BANNER_ARTIFACT_NOT_OWNED", "BANNER_COLOR_REQUIRED",
  "FILE_TOO_LARGE", "UNSUPPORTED_CONTENT_TYPE",
]);

export const operations = {
  getHomeConfig: {
    method: "GET",
    path: "/organizations/:orgId/home-config",
    in: z.object({ orgId: z.string() }).strict(),
    out: HomeConfig,
    err: ["NO_ORG_MEMBERSHIP"] as const,
  },

  updateHomeConfig: {
    method: "PUT",
    path: "/organizations/:orgId/home-config",
    in: z
      .object({
        orgId: z.string(),
        title: z.string().min(1).max(24),
        tagline: z.string().max(80).nullable(),
        bannerHeadline: z.string().min(1).max(60),
        bannerTagline: z.string().max(120),
        themeColors: ThemeColors.nullable().optional(),
        bannerPreset: BannerPreset,
        bannerColor: BannerColor.nullable(),
        /** 上传得到的 `bannerImageArtifactId`；`null` = 不用图片。必须属于本组织。 */
        bannerImageArtifactId: z.string().nullable(),
        quickActions: z.array(QuickAction).max(10),
        recommendedCapabilities: z.array(RecommendedCapability).max(6),
        recommendedAgents: z.array(RecommendedAgent).max(6),
        sections: HomeSections,
      })
      .strict(),
    out: HomeConfig,
    err: ["NO_ORG_MEMBERSHIP", "FORBIDDEN", "BANNER_ARTIFACT_NOT_OWNED", "BANNER_COLOR_REQUIRED"] as const,
  },

  /**
   * 横幅图片上传（第一步，仅组织 admin）。与 `org-admin.uploadOrgAvatar` 同形：`in` 只有
   * 元数据（经查询串传入），图片字节是请求体本身；真正生效要靠 `updateHomeConfig`
   * 带着这里返回的 `bannerImageArtifactId`。上限 5MB，png/jpeg/webp。
   */
  uploadHomeBanner: {
    method: "POST",
    path: "/organizations/:orgId/home-banner",
    in: z
      .object({
        orgId: z.string(),
        filename: z.string().min(1),
        sizeBytes: z.number().int().positive().max(5 * 1024 * 1024),
        sha256: z.string(),
        contentType: z.enum(["image/png", "image/jpeg", "image/webp"]),
      })
      .strict(),
    out: z.object({ bannerImageArtifactId: z.string(), bannerImageUrl: z.string() }).strict(),
    err: ["NO_ORG_MEMBERSHIP", "FORBIDDEN", "FILE_TOO_LARGE", "UNSUPPORTED_CONTENT_TYPE"] as const,
  },
} as const;
