/**
 * `HomeConfigRepository` on PostgreSQL（ad-hoc feature，Refs #4634）。
 * 落到 `org_home_configs`（迁移 `20260929120000_home_org_home_config.sql`）。
 *
 * 单表、单行主键 `org_id`：`upsert` 用 `INSERT ... ON CONFLICT (org_id) DO UPDATE`，
 * 不先 SELECT 再判断 INSERT/UPDATE——同 `pg-org-profile-repository.ts` 的
 * `updateOrganization` 一样只需要一次 `withTenant`。
 */
import type { DatabasePort } from "../../application/ports/database.port";
import type { OrgId } from "../../domain/org-id";
import type {
  HomeConfig,
  HomeConfigRepository,
  RecommendedCapability,
  UpsertHomeConfigInput,
} from "../../application/home/home-config-ports";

interface HomeConfigDbRow {
  readonly org_id: string;
  readonly title: string;
  readonly tagline: string | null;
  readonly banner_headline: string;
  readonly banner_tagline: string;
  readonly banner_preset: string;
  readonly quick_actions: unknown;
  readonly recommended_capabilities: unknown;
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
    quickActions: row.quick_actions as HomeConfig["quickActions"],
    recommendedCapabilities: row.recommended_capabilities as RecommendedCapability[],
    updatedBy: row.updated_by,
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

export class PgHomeConfigRepository implements HomeConfigRepository {
  constructor(private readonly db: DatabasePort) {}

  async get(orgId: OrgId): Promise<HomeConfig | null> {
    return this.db.withTenant(orgId, async (s) => {
      const res = await s.query<HomeConfigDbRow>(`SELECT * FROM org_home_configs WHERE org_id = $1`, [orgId]);
      const row = res.rows[0];
      return row === undefined ? null : toHomeConfig(row);
    });
  }

  async upsert(orgId: OrgId, input: UpsertHomeConfigInput): Promise<HomeConfig> {
    return this.db.withTenant(orgId, async (s) => {
      const res = await s.query<HomeConfigDbRow>(
        `INSERT INTO org_home_configs
           (org_id, title, tagline, banner_headline, banner_tagline, banner_preset,
            quick_actions, recommended_capabilities, updated_by, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9, now())
         ON CONFLICT (org_id) DO UPDATE SET
           title = EXCLUDED.title,
           tagline = EXCLUDED.tagline,
           banner_headline = EXCLUDED.banner_headline,
           banner_tagline = EXCLUDED.banner_tagline,
           banner_preset = EXCLUDED.banner_preset,
           quick_actions = EXCLUDED.quick_actions,
           recommended_capabilities = EXCLUDED.recommended_capabilities,
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
          JSON.stringify(input.quickActions),
          JSON.stringify(input.recommendedCapabilities),
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
}
