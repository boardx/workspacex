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
export type RecommendedAgent = z.infer<typeof homeConfig.RecommendedAgent>;
export type HomeSections = z.infer<typeof homeConfig.HomeSections>;
export type HomeConfig = z.infer<typeof homeConfig.HomeConfig>;

export type BannerContentType = "image/png" | "image/jpeg" | "image/webp";
export interface StoredHomeBanner {
  readonly bannerImageArtifactId: string;
  readonly bannerImageUrl: string;
}

export interface UpsertHomeConfigInput {
  readonly themeColors?: HomeConfig["themeColors"];
  readonly title: string;
  readonly tagline: string | null;
  readonly bannerHeadline: string;
  readonly bannerTagline: string;
  readonly bannerPreset: BannerPreset;
  readonly bannerColor: string | null;
  /** 必须已经由 `storeBanner` 登记在本组织下，否则仓储抛 `BannerArtifactNotOwnedError`。 */
  readonly bannerImageArtifactId: string | null;
  readonly quickActions: readonly QuickAction[];
  readonly recommendedCapabilities: readonly RecommendedCapability[];
  readonly recommendedAgents: readonly RecommendedAgent[];
  readonly sections: HomeSections;
  readonly updatedBy: string;
}

export class BannerArtifactNotOwnedError extends Error {
  constructor() {
    super("BANNER_ARTIFACT_NOT_OWNED");
    this.name = "BannerArtifactNotOwnedError";
  }
}

export const HOME_CONFIG_REPOSITORY = Symbol("HomeConfigRepository");

export interface HomeConfigRepository {
  /** 未建过行时返回 `null`——默认值由 usecase 兜底，不在仓储层编一份。 */
  get(orgId: OrgId): Promise<HomeConfig | null>;
  upsert(orgId: OrgId, input: UpsertHomeConfigInput): Promise<HomeConfig>;
  /** 字节先写对象存储、归属后登记 PG（同 `storeAvatar` 的顺序理由）。 */
  storeBanner(
    orgId: OrgId,
    actorId: string,
    bytes: Uint8Array,
    contentType: BannerContentType,
    sha256: string,
  ): Promise<StoredHomeBanner>;
  readBannerBytes(orgId: OrgId, bannerArtifactId: string): Promise<{ bytes: Uint8Array; contentType: string } | null>;
}
