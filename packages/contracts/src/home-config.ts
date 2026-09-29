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

export const BannerPreset = z.enum(["ocean", "forest", "sunset", "midnight"]);

/** 与 `apps/web/lib/navigation.ts` 里真实存在的顶层路由一一对应，不是自由字符串——
 *  首页快捷入口只能链到产品里真的走得到的地方（同 UC-0.4 R4 的精神）。 */
export const QuickActionKey = z.enum(["chat", "projects", "board", "brain"]);

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

export const HomeConfig = z
  .object({
    orgId: z.string(),
    title: z.string().min(1).max(24),
    tagline: z.string().max(80).nullable(),
    bannerHeadline: z.string().min(1).max(60),
    bannerTagline: z.string().max(120),
    bannerPreset: BannerPreset,
    quickActions: z.array(QuickAction).max(4),
    recommendedCapabilities: z.array(RecommendedCapability).max(6),
    updatedAt: z.string(),
    updatedBy: z.string().nullable(),
  })
  .strict();

export const HomeConfigError = z.enum(["NO_ORG_MEMBERSHIP", "FORBIDDEN"]);

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
        bannerPreset: BannerPreset,
        quickActions: z.array(QuickAction).max(4),
        recommendedCapabilities: z.array(RecommendedCapability).max(6),
      })
      .strict(),
    out: HomeConfig,
    err: ["NO_ORG_MEMBERSHIP", "FORBIDDEN"] as const,
  },
} as const;
