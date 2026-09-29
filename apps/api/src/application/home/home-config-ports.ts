/**
 * `HomeConfigRepository` —— 组织首页配置的唯一持久化端口（ad-hoc feature，Refs #4634）。
 * 落到 `org_home_configs`（迁移 `20260929120000_home_org_home_config.sql`）。
 */
import type { homeConfig } from "@repo/contracts";
import type { z } from "zod";
import type { OrgId } from "../../domain/org-id";

export type BannerPreset = z.infer<typeof homeConfig.BannerPreset>;
export type QuickAction = z.infer<typeof homeConfig.QuickAction>;
export type RecommendedCapability = z.infer<typeof homeConfig.RecommendedCapability>;
export type HomeConfig = z.infer<typeof homeConfig.HomeConfig>;

export interface UpsertHomeConfigInput {
  readonly title: string;
  readonly tagline: string | null;
  readonly bannerHeadline: string;
  readonly bannerTagline: string;
  readonly bannerPreset: BannerPreset;
  readonly quickActions: readonly QuickAction[];
  readonly recommendedCapabilities: readonly RecommendedCapability[];
  readonly updatedBy: string;
}

export const HOME_CONFIG_REPOSITORY = Symbol("HomeConfigRepository");

export interface HomeConfigRepository {
  /** 未建过行时返回 `null`——默认值由 usecase 兜底，不在仓储层编一份。 */
  get(orgId: OrgId): Promise<HomeConfig | null>;
  upsert(orgId: OrgId, input: UpsertHomeConfigInput): Promise<HomeConfig>;
}
