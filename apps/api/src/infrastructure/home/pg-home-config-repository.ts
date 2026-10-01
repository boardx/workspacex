/**
 * `HomeConfigRepository` on PostgreSQL（ad-hoc feature，Refs #4634）。
 * 落到 `org_home_configs`（迁移 `20260929120000_home_org_home_config.sql`）。
 *
 * 单表、单行主键 `org_id`：`upsert` 用 `INSERT ... ON CONFLICT (org_id) DO UPDATE`，
 * 不先 SELECT 再判断 INSERT/UPDATE——同 `pg-org-profile-repository.ts` 的
 * `updateOrganization` 一样只需要一次 `withTenant`。
 */
import { randomBytes } from "node:crypto";
import type { DatabasePort } from "../../application/ports/database.port";
import type { ObjectStore } from "../../application/artifact/ports";
import type { OrgId } from "../../domain/org-id";
import {
  BannerArtifactNotOwnedError,
  type BannerContentType,
  type HomeConfig,
  type HomeConfigRepository,
  type RecommendedAgent,
  type RecommendedCapability,
  type StoredHomeBanner,
  type UpsertHomeConfigInput,
} from "../../application/home/home-config-ports";

function newBannerArtifactId(): string {
  return `home-banner-${randomBytes(12).toString("hex")}`;
}

/** 横幅图片下载 URL 的**唯一**拼装处（同 `avatarUrlFor` 的纪律）。 */
export function bannerUrlFor(orgId: string, bannerArtifactId: string | null): string | null {
  return bannerArtifactId === null ? null : `/organizations/${orgId}/home-banner-file/${bannerArtifactId}`;
}

interface HomeConfigDbRow {
  readonly org_id: string;
  readonly title: string;
  readonly tagline: string | null;
  readonly banner_headline: string;
  readonly banner_tagline: string;
  readonly banner_preset: string;
  readonly banner_color: string | null;
  readonly banner_image_id: string | null;
  readonly quick_actions: unknown;
  readonly recommended_capabilities: unknown;
  readonly recommended_agents: unknown;
  readonly sections: unknown;
  readonly updated_by: string;
  readonly updated_at: Date | string;
}

function toHomeConfig(row: HomeConfigDbRow): HomeConfig {
  return {
    orgId: row.org_id,
    title: row.title,
    tagline: row.tagline,
    bannerHeadline: row.banner_headline,
    bannerTagline: row.banner_tagline,
    // .strict() 契约会在 controller 出门前再校验一次形状；这里按写入时的形状原样读回。
    bannerPreset: row.banner_preset as HomeConfig["bannerPreset"],
    bannerColor: row.banner_color,
    bannerImageUrl: bannerUrlFor(row.org_id, row.banner_image_id),
    quickActions: row.quick_actions as HomeConfig["quickActions"],
    recommendedCapabilities: row.recommended_capabilities as RecommendedCapability[],
    recommendedAgents: row.recommended_agents as RecommendedAgent[],
    sections: row.sections as HomeConfig["sections"],
    updatedBy: row.updated_by,
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

export class PgHomeConfigRepository implements HomeConfigRepository {
  constructor(
    private readonly db: DatabasePort,
    private readonly store: ObjectStore,
  ) {}

  async get(orgId: OrgId): Promise<HomeConfig | null> {
    return this.db.withTenant(orgId, async (s) => {
      const res = await s.query<HomeConfigDbRow>(`SELECT * FROM org_home_configs WHERE org_id = $1`, [orgId]);
      const row = res.rows[0];
      return row === undefined ? null : toHomeConfig(row);
    });
  }

  async upsert(orgId: OrgId, input: UpsertHomeConfigInput): Promise<HomeConfig> {
    return this.db.withTenant(orgId, async (s) => {
      // 引用的横幅图必须已登记在本组织下（RLS 已限定 org；这里只判「存在」）。
      if (input.bannerImageArtifactId !== null) {
        const owned = await s.query(`SELECT 1 FROM org_home_banner_artifacts WHERE id = $1`, [
          input.bannerImageArtifactId,
        ]);
        if (owned.rows.length === 0) throw new BannerArtifactNotOwnedError();
      }
      const res = await s.query<HomeConfigDbRow>(
        `INSERT INTO org_home_configs
           (org_id, title, tagline, banner_headline, banner_tagline, banner_preset,
            banner_color, banner_image_id, quick_actions, recommended_capabilities,
            recommended_agents, sections, updated_by, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb, $11::jsonb, $12::jsonb, $13, now())
         ON CONFLICT (org_id) DO UPDATE SET
           title = EXCLUDED.title,
           tagline = EXCLUDED.tagline,
           banner_headline = EXCLUDED.banner_headline,
           banner_tagline = EXCLUDED.banner_tagline,
           banner_preset = EXCLUDED.banner_preset,
           banner_color = EXCLUDED.banner_color,
           banner_image_id = EXCLUDED.banner_image_id,
           quick_actions = EXCLUDED.quick_actions,
           recommended_capabilities = EXCLUDED.recommended_capabilities,
           recommended_agents = EXCLUDED.recommended_agents,
           sections = EXCLUDED.sections,
           updated_by = EXCLUDED.updated_by,
           updated_at = now()
         RETURNING *`,
        [
          orgId,
          input.title,
          input.tagline,
          input.bannerHeadline,
          input.bannerTagline,
          input.bannerPreset,
          input.bannerColor,
          input.bannerImageArtifactId,
          JSON.stringify(input.quickActions),
          JSON.stringify(input.recommendedCapabilities),
          JSON.stringify(input.recommendedAgents),
          JSON.stringify(input.sections),
          input.updatedBy,
        ],
      );
      // INSERT ... RETURNING 恒返回一行，non-null 断言不需要——但 `rows[0]` 的类型是
      // `HomeConfigDbRow | undefined`，用显式检查而不是 `!`（同仓其余仓储的风格）。
      const row = res.rows[0];
      if (row === undefined) throw new Error("org_home_configs upsert returned no row");
      return toHomeConfig(row);
    });
  }

  async storeBanner(
    orgId: OrgId,
    actorId: string,
    bytes: Uint8Array,
    contentType: BannerContentType,
    sha256: string,
  ): Promise<StoredHomeBanner> {
    const id = newBannerArtifactId();
    const objectKey = `org-home-banners/${orgId}/${id}`;
    // 对象存储先写（write-once），PG 归属登记后写——同 `storeAvatar` 的顺序理由。
    await this.store.putOnce(objectKey, bytes, contentType);
    await this.db.withTenant(orgId, (s) =>
      s.query(
        `INSERT INTO org_home_banner_artifacts (id, org_id, object_key, content_type, size_bytes, sha256, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [id, orgId, objectKey, contentType, bytes.byteLength, sha256, actorId],
      ),
    );
    return { bannerImageArtifactId: id, bannerImageUrl: bannerUrlFor(orgId, id) as string };
  }

  async readBannerBytes(
    orgId: OrgId,
    bannerArtifactId: string,
  ): Promise<{ bytes: Uint8Array; contentType: string } | null> {
    const row = await this.db.withTenant(orgId, async (s) => {
      const res = await s.query<{ object_key: string; content_type: string }>(
        `SELECT object_key, content_type FROM org_home_banner_artifacts WHERE id = $1`,
        [bannerArtifactId],
      );
      return res.rows[0] ?? null;
    });
    if (row === null) return null;
    const bytes = await this.store.get(row.object_key);
    if (bytes === null) return null;
    return { bytes, contentType: row.content_type };
  }
}
