/**
 * `CanvasTemplateRepository` 的 PostgreSQL 实现（#463）。
 *
 * ## 每一条查询都在 `withTenant` 里
 *
 * 隔离由 PG 的 RLS 强制（`canvas_templates_tenant` / `canvas_template_bindings_tenant`），
 * SQL 里那句 `WHERE org_id = $1` 是第二道，不是第一道。本文件**不使用** `withoutTenant`：
 * 那条路径是给健康探针的，策略 fail-closed，业务查询走它会读到零行并看起来像「没有数据」
 * 而不是「出错了」。
 *
 * ## 出门必须是 `Guarded<T>`
 *
 * `list()` 返回 `Guarded<CanvasTemplateListing>` + 一份**不披露**的 facts。可见性判定在
 * `application/canvas/list-templates.ts` 用 `decideCapabilityVisibility` 做——同
 * capability listing 的通道，因为契约声明 `TemplateVisibility` 与 `identity.VisibilityScope`
 * 是同一套语义。`guard()` 的 ref 用 `kind: "capability"` 不是将就：`capability_listings.kind`
 * 的闭集里逐字有 `'canvas-template'`，模板库就是组织配置的一部分。
 *
 * ## `usageCount` 是 `COUNT(*)`，库里没有可写的计数列
 *
 * 契约逐字要求它真实统计、不得估算。见迁移文件头那段「为什么不是一列 + 触发器同步」。
 */
import type { DatabasePort } from "../../application/ports/database.port";
import { guard } from "../../application/security/permission-filter";
import type {
  CanvasTemplateListing,
  CanvasTemplateRepository,
  CanvasTemplateVersionFacts,
  GuardedCanvasTemplate,
  ListCanvasTemplatesQuery,
  PublishOutcome,
} from "../../application/canvas/template-ports";
import type { TemplateStatus, TemplateVersionState } from "../../domain/canvas/template-lifecycle";
import type { VisibilityScope } from "../../domain/identity/roles";
import type { OrgId } from "../../domain/org-id";

interface TemplateSqlRow {
  key: string;
  version: number;
  display_name: string;
  status: TemplateStatus;
  archived_from: "draft" | "trial" | "published" | null;
  builtin: boolean;
  visibility: VisibilityScope;
  owner_team_id: string | null;
  underlying_type: string;
  sections: unknown;
  usage_count: string;
}

export class PgCanvasTemplateRepository implements CanvasTemplateRepository {
  constructor(private readonly db: DatabasePort) {}

  async list(query: ListCanvasTemplatesQuery): Promise<readonly GuardedCanvasTemplate[]> {
    // 空状态集合直接短路。`= ANY('{}')` 也会返回零行，但那要多打一次全表扫描，
    // 而「forBinding=true 且 filter=archived」这种必然为空的组合是正常调用（见
    // `statusesFor` 的注释），不是异常。
    if (query.statuses.length === 0) return [];

    return this.db.withTenant(query.orgId, async (s) => {
      const r = await s.query<TemplateSqlRow>(
        `SELECT t.key, t.version, t.display_name, t.status, t.archived_from, t.builtin,
                t.visibility, t.owner_team_id, t.underlying_type, t.sections,
                (SELECT count(*) FROM canvas_template_bindings b
                  WHERE b.org_id = t.org_id
                    AND b.template_key = t.key
                    AND b.template_version = t.version)::text AS usage_count
           FROM canvas_templates t
          WHERE t.org_id = $1 AND t.status = ANY($2::text[])
          ORDER BY t.key, t.version`,
        [query.orgId, [...query.statuses]],
      );
      return r.rows.map((row) => this.toGuarded(row));
    });
  }

  private toGuarded(row: TemplateSqlRow): GuardedCanvasTemplate {
    return {
      facts: {
        key: row.key,
        version: row.version,
        scope: row.visibility,
        ownerTeamId: row.owner_team_id,
      },
      listing: guard(
        // `key@version` 而不是裸 key：同一个 key 的两个版本是两行、可以有不同的可见性，
        // 用裸 key 做 ref 会让两条判定共用一个身份。
        { kind: "capability", id: `canvas-template:${row.key}@${row.version}` },
        {
          key: row.key,
          displayName: row.display_name,
          version: row.version,
          status: row.status,
          builtin: row.builtin,
          visibility: row.visibility,
          underlyingType: row.underlying_type,
          // jsonb 回来的是已解析的 JS 值。形状由 `canvas_templates.sections` 的写入方保证，
          // 并由控制器出门时的 `listTemplates.out.parse` 二次校验 —— 契约里 `SectionDef`
          // 是 `.strict()` 的，所以库里混进一个多余字段会在响应边界当场红，
          // 而不是被前端在联调时发现。
          sections: row.sections as CanvasTemplateListing["sections"],
          usageCount: Number(row.usage_count),
        },
      ),
    };
  }

  async findVersion(
    orgId: OrgId,
    key: string,
    version: number,
  ): Promise<CanvasTemplateVersionFacts | null> {
    return this.db.withTenant(orgId, async (s) => {
      const r = await s.query<{
        key: string;
        version: number;
        status: TemplateStatus;
        archived_from: "draft" | "trial" | "published" | null;
        builtin: boolean;
      }>(
        `SELECT key, version, status, archived_from, builtin
           FROM canvas_templates
          WHERE org_id = $1 AND key = $2 AND version = $3`,
        [orgId, key, version],
      );
      const row = r.rows[0];
      if (row === undefined) return null;
      return {
        key: row.key,
        version: row.version,
        builtin: row.builtin,
        state:
          row.archived_from === null
            ? { status: row.status }
            : { status: row.status, archivedFrom: row.archived_from },
      };
    });
  }

  /**
   * 归档同 key 的其它 published 版本 + 把本版本置为 published，**一个事务**
   * （`withTenant` 一次调用就是一个事务，见 `pg-database.ts`）。
   *
   * ⚠ 顺序不能反：先归档旧版再置新版。反过来会在事务中途出现两个 published，
   *   而 `canvas_templates_one_published_per_key` 是**立即**生效的唯一索引（不是
   *   DEFERRABLE），那一刻就会失败。索引挡住了这个顺序错误，这条注释只是说明为什么。
   */
  async publish(cmd: {
    readonly orgId: OrgId;
    readonly key: string;
    readonly version: number;
    readonly visibility: VisibilityScope;
  }): Promise<PublishOutcome> {
    return this.db.withTenant(cmd.orgId, async (s) => {
      const archived = await s.query<{ key: string; version: number }>(
        `UPDATE canvas_templates
            SET status = 'archived', archived_from = 'published', updated_at = now()
          WHERE org_id = $1 AND key = $2 AND version <> $3 AND status = 'published'
          RETURNING key, version`,
        [cmd.orgId, cmd.key, cmd.version],
      );
      await s.query(
        `UPDATE canvas_templates
            SET status = 'published', archived_from = NULL, visibility = $4, updated_at = now()
          WHERE org_id = $1 AND key = $2 AND version = $3`,
        [cmd.orgId, cmd.key, cmd.version, cmd.visibility],
      );
      return {
        archivedVersions: archived.rows.map((r) => ({ key: r.key, version: r.version })),
      };
    });
  }

  async setState(
    orgId: OrgId,
    key: string,
    version: number,
    next: TemplateVersionState,
  ): Promise<void> {
    await this.db.withTenant(orgId, async (s) => {
      await s.query(
        `UPDATE canvas_templates
            SET status = $4, archived_from = $5, updated_at = now()
          WHERE org_id = $1 AND key = $2 AND version = $3`,
        [orgId, key, version, next.status, next.archivedFrom ?? null],
      );
    });
  }

  /**
   * ⚠ `count(DISTINCT agenda_segment_id)`，不是 `count(*)`：契约问的是「有 N 个**议程环节**
   *   仍绑定此模板」。一个环节最多绑两个模板（I-6），所以两者今天恰好相等；
   *   写成 `count(*)` 的那天，一个环节的两条绑定会被数成两个环节。
   */
  async countBoundSegments(orgId: OrgId, key: string, version: number): Promise<number> {
    return this.db.withTenant(orgId, async (s) => {
      const r = await s.query<{ n: string }>(
        `SELECT count(DISTINCT agenda_segment_id)::text AS n
           FROM canvas_template_bindings
          WHERE org_id = $1 AND template_key = $2 AND template_version = $3`,
        [orgId, key, version],
      );
      return Number(r.rows[0]?.n ?? 0);
    });
  }
}
