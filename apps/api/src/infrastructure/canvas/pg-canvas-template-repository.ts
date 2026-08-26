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
  CreateTemplateOutcome,
  CreatedCanvasTemplate,
  GuardedCanvasTemplate,
  ListCanvasTemplatesQuery,
  MintTemplateVersionOutcome,
  PublishOutcome,
  SegmentBindingRow,
  UpdateDraftOutcome,
  UpdateMetadataOutcome,
} from "../../application/canvas/template-ports";
import type { TemplateStatus, TemplateVersionState } from "../../domain/canvas/template-lifecycle";
import type { VisibilityScope } from "../../domain/identity/roles";
import type { OrgId } from "../../domain/org-id";
import { PLATFORM_ORG_ID, isPlatformOwned } from "../../domain/canvas/platform-org";

interface TemplateSqlRow {
  org_id: string;
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
  tags: readonly string[];
  title: string;
  footer: string;
}

/**
 * `INSERT` 里写死的字面量回来时必须还是它自己。契约那三个 `z.literal(...)` 是承诺，
 * 这里是承诺的产地 —— 在产地校验，出问题时错误指向这一行 SQL 而不是响应边界。
 */
function assertLiteral<T extends string | number | boolean>(
  actual: unknown,
  expected: T,
  column: string,
): T {
  if (actual !== expected) {
    throw new Error(
      `canvas_templates.${column} 应为 ${JSON.stringify(expected)}，实为 ${JSON.stringify(actual)}`,
    );
  }
  return expected;
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
        `SELECT t.org_id, t.key, t.version, t.display_name, t.status, t.archived_from, t.builtin,
                t.visibility, t.owner_team_id, t.underlying_type, t.sections, t.tags,
                t.title, t.footer,
                (SELECT count(*) FROM canvas_template_bindings b
                  WHERE b.org_id = t.org_id
                    AND b.template_key = t.key
                    AND b.template_version = t.version)::text AS usage_count
           FROM canvas_templates t
          WHERE (t.org_id = $1 OR t.org_id = $3) AND t.status = ANY($2::text[])
          ORDER BY t.key, t.version`,
        [query.orgId, [...query.statuses], PLATFORM_ORG_ID],
      );
      return r.rows.map((row) => this.toGuarded(row));
    });
  }

  /**
   * 铸一行新的 `draft` v1（#496）。
   *
   * ## 占用判定与写入是**同一条语句**
   *
   * `INSERT ... SELECT ... WHERE NOT EXISTS (同 key 的任何版本)`，再叠一层
   * `ON CONFLICT (org_id, key, version) DO NOTHING`。两层各挡一种失效：
   *
   * · `NOT EXISTS` 挡的是「这个 key 已经有别的版本」——主键管不到它（主键含 version，
   *   已有 v2 时插 v1 完全合法），而那会让同一个 key 长出两条互不相干的谱系。
   * · `ON CONFLICT` 挡的是**并发**：READ COMMITTED 下两个事务的 `NOT EXISTS` 可以同时
   *   为真，此时先提交的那个让后者撞主键。没有这一层，后者会抛 23505 一路冒到 500，
   *   而调用方得到的是「服务器错误」而不是「key 被占了」。
   *
   * 两条路径都收敛成**零行返回** ⇒ `{created: false, reason: "key-taken"}`。
   * 用例因此不需要分辨是哪一种，也不该分辨：对调用方而言那是同一件事。
   *
   * ## `RETURNING` 回的是**库里那一行**
   *
   * 不是把入参原样组装成响应。`status` / `version` / `builtin` 是这条 SQL 写死的字面量，
   * 让它们从 RETURNING 回来，「服务端说了算」这件事就由库来兑现而不是由一段拼装代码兑现。
   */
  async create(cmd: {
    readonly orgId: OrgId;
    readonly key: string;
    readonly displayName: string;
    readonly underlyingType: string;
    readonly sections: CreatedCanvasTemplate["sections"];
    readonly visibility: VisibilityScope;
    readonly ownerTeamId: string | null;
    readonly tags: readonly string[];
  }): Promise<CreateTemplateOutcome> {
    return this.db.withTenant(cmd.orgId, async (s) => {
      const r = await s.query<{
        key: string;
        version: number;
        display_name: string;
        status: string;
        builtin: boolean;
        visibility: VisibilityScope;
        underlying_type: string;
        sections: unknown;
        tags: readonly string[];
      }>(
        `INSERT INTO canvas_templates
           (org_id, key, version, display_name, status, archived_from, builtin,
            visibility, owner_team_id, underlying_type, sections, tags)
         SELECT $1, $2, 1, $3, 'draft', NULL, false, $4, $5, $6, $7::jsonb, $8::text[]
          WHERE NOT EXISTS (
            SELECT 1 FROM canvas_templates WHERE org_id = $1 AND key = $2
          )
         ON CONFLICT (org_id, key, version) DO NOTHING
         RETURNING key, version, display_name, status, builtin, visibility,
                   underlying_type, sections, tags`,
        [
          cmd.orgId,
          cmd.key,
          cmd.displayName,
          cmd.visibility,
          cmd.ownerTeamId,
          cmd.underlyingType,
          JSON.stringify(cmd.sections),
          [...cmd.tags],
        ],
      );
      const row = r.rows[0];
      if (row === undefined) return { created: false, reason: "key-taken" };
      return {
        created: true,
        template: {
          key: row.key,
          displayName: row.display_name,
          // ⚠ 断言而不是转型：这三栏是上面 SQL 写死的字面量，回来的值与契约的
          //   `z.literal(...)` 对不上时，是 SQL 被人改过 —— 那要在这里当场炸，
          //   而不是靠控制器出门时的 `out.parse` 去发现（那时已经查不到是哪一行 SQL）。
          version: assertLiteral(row.version, 1, "version"),
          status: assertLiteral(row.status, "draft", "status"),
          builtin: assertLiteral(row.builtin, false, "builtin"),
          visibility: row.visibility,
          underlyingType: row.underlying_type,
          // jsonb 回来的是已解析的 JS 值；形状由契约在控制器出门时二次校验（`.strict()`）。
          sections: row.sections as CreatedCanvasTemplate["sections"],
          tags: [...row.tags],
        },
      };
    });
  }

  /**
   * 铸「基于既有模板开新版」的下一版本（#988）。
   *
   * `INSERT ... SELECT ... , coalesce(max(version), 0) + 1, ... WHERE EXISTS(同 key
   * 至少一个版本)`：版本号的计算与「这个 key 存在吗」的判定、以及写入，收在**同一条
   * 语句**里——同 `create()` 的「占用判定必须与写入同一条语句」纪律，理由对称：
   * 这里怕的不是「重复」而是「用同一个 max+1 撞号」，同一形状的并发窗口问题。
   * `ON CONFLICT (org_id, key, version) DO NOTHING` 是并发下真的算出同一个 `max+1`
   * 时的第二道防线（先提交的那个让后者撞主键，回退到零行）。
   */
  async mintVersion(cmd: {
    readonly orgId: OrgId;
    readonly key: string;
    readonly displayName: string;
    readonly underlyingType: string;
    readonly sections: CreatedCanvasTemplate["sections"];
    readonly visibility: VisibilityScope;
    readonly ownerTeamId: string | null;
    readonly tags: readonly string[];
  }): Promise<MintTemplateVersionOutcome> {
    return this.db.withTenant(cmd.orgId, async (s) => {
      const r = await s.query<{
        key: string;
        version: number;
        display_name: string;
        status: string;
        builtin: boolean;
        visibility: VisibilityScope;
        underlying_type: string;
        sections: unknown;
        tags: readonly string[];
      }>(
        `INSERT INTO canvas_templates
           (org_id, key, version, display_name, status, archived_from, builtin,
            visibility, owner_team_id, underlying_type, sections, tags)
         SELECT $1, $2,
                (SELECT coalesce(max(version), 0) + 1
                   FROM canvas_templates WHERE org_id = $1 AND key = $2),
                $3, 'draft', NULL, false, $4, $5, $6, $7::jsonb, $8::text[]
          WHERE EXISTS (
            SELECT 1 FROM canvas_templates WHERE org_id = $1 AND key = $2
          )
         ON CONFLICT (org_id, key, version) DO NOTHING
         RETURNING key, version, display_name, status, builtin, visibility,
                   underlying_type, sections, tags`,
        [
          cmd.orgId,
          cmd.key,
          cmd.displayName,
          cmd.visibility,
          cmd.ownerTeamId,
          cmd.underlyingType,
          JSON.stringify(cmd.sections),
          [...cmd.tags],
        ],
      );
      const row = r.rows[0];
      // ⚠ 零行有两种成因：① key 真的不存在（`WHERE EXISTS` 为假）；② 并发下两个请求
      //   算出了同一个 `max+1`，`ON CONFLICT DO NOTHING` 吞掉了后到的那个。两者都归为
      //   `key-not-found` 是一处已知的粗粒度——签核材料未要求区分并发冲突与真不存在
      //   （`mintTemplateVersion.err` 闭集里没有专属的重试码），且触发②需要同一 key
      //   在同一毫秒级窗口内被两次「开新版」，管理台单人操作下概率可忽略。
      //   真出现时用户看到 `TEMPLATE_NOT_FOUND` 重试一次即可自愈（第二次请求会看到
      //   已提交的版本，`max+1` 算出新号）。
      if (row === undefined) return { minted: false, reason: "key-not-found" };
      return {
        minted: true,
        template: {
          key: row.key,
          displayName: row.display_name,
          // ⚠ 断言而不是转型，同 `create()`：`status`/`builtin` 是这条 SQL 写死的字面量。
          version: row.version,
          status: assertLiteral(row.status, "draft", "status"),
          builtin: assertLiteral(row.builtin, false, "builtin"),
          visibility: row.visibility,
          underlyingType: row.underlying_type,
          sections: row.sections as CreatedCanvasTemplate["sections"],
          tags: [...row.tags],
        },
      };
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
          tags: [...row.tags],
          title: row.title,
          footer: row.footer,
          // ⚠ 判据是**这一行落在哪个 org**，不是 `builtin`：组织 fork 走一份之后它仍然
          //   是 builtin key，却已经是自己的行了。两者合成一个字段，「已加入我的组织的
          //   用户画像」与「还没加入的平台用户画像」在响应体上就完全同形。
          platform: isPlatformOwned(row.org_id),
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
   * 2026-08-23，**待人类补签**——`WHERE status = 'draft'` 与写入在同一条语句里，
   * 理由同 `create()`/`mintVersion()`：状态判定不能与写入隔一个窗口。
   *
   * 零行有两种成因，`RETURNING` 之外单独一次查询才能分清是哪一种——见 `updateDraft()`
   * 接口文档。这条 disambiguation 查询只在失败路径上跑，不影响成功路径的单语句写入。
   */
  async updateDraft(cmd: {
    readonly orgId: OrgId;
    readonly key: string;
    readonly version: number;
    readonly displayName: string;
    readonly sections: CreatedCanvasTemplate["sections"];
    readonly visibility: VisibilityScope;
    readonly tags: readonly string[];
  }): Promise<UpdateDraftOutcome> {
    return this.db.withTenant(cmd.orgId, async (s) => {
      const r = await s.query<{
        key: string;
        version: number;
        display_name: string;
        status: string;
        builtin: boolean;
        visibility: VisibilityScope;
        underlying_type: string;
        sections: unknown;
        tags: readonly string[];
      }>(
        `UPDATE canvas_templates
            SET display_name = $4, sections = $5::jsonb, visibility = $6, tags = $7::text[], updated_at = now()
          WHERE org_id = $1 AND key = $2 AND version = $3 AND status = 'draft'
         RETURNING key, version, display_name, status, builtin, visibility,
                   underlying_type, sections, tags`,
        [
          cmd.orgId, cmd.key, cmd.version, cmd.displayName,
          JSON.stringify(cmd.sections), cmd.visibility, [...cmd.tags],
        ],
      );
      const row = r.rows[0];
      if (row === undefined) {
        const exists = await s.query(
          `SELECT 1 FROM canvas_templates WHERE org_id = $1 AND key = $2 AND version = $3`,
          [cmd.orgId, cmd.key, cmd.version],
        );
        return { updated: false, reason: exists.rows[0] === undefined ? "not-found" : "not-draft" };
      }
      return {
        updated: true,
        template: {
          key: row.key,
          version: row.version,
          status: assertLiteral(row.status, "draft", "status"),
          displayName: row.display_name,
          builtin: assertLiteral(row.builtin, false, "builtin"),
          visibility: row.visibility,
          underlyingType: row.underlying_type,
          sections: row.sections as CreatedCanvasTemplate["sections"],
          tags: [...row.tags],
        },
      };
    });
  }

  /**
   * 2026-08-25，**待人类补签**（R2）——`displayName`/`tags` 原地改写，**没有状态
   * 限定**（不像 `updateDraft` 要求 `status='draft'`）：`WHERE` 只认 `org_id/key/
   * version`，`sections` 完全不在 `SET` 子句里，物理上不可能被这条 SQL 改动。
   */
  async updateMetadata(cmd: {
    readonly orgId: OrgId;
    readonly key: string;
    readonly version: number;
    readonly displayName: string;
    readonly tags: readonly string[];
    /** 版面装帧。空串 = 不画那一带，与 NULL 同义（见迁移文件头）。 */
    readonly title: string;
    readonly footer: string;
  }): Promise<UpdateMetadataOutcome> {
    return this.db.withTenant(cmd.orgId, async (s) => {
      const r = await s.query<{
        key: string;
        version: number;
        display_name: string;
        status: string;
        builtin: boolean;
        visibility: VisibilityScope;
        underlying_type: string;
        tags: readonly string[];
        title: string;
        footer: string;
      }>(
        // ⚠ `sections` 仍然不在 SET 里——本操作对任何状态生效，靠的就是它物理上碰不到
        //   内容。加进来会让「改装帧」变成一条能绕过不可变快照的路径。
        `UPDATE canvas_templates
            SET display_name = $4, tags = $5::text[], title = $6, footer = $7, updated_at = now()
          WHERE org_id = $1 AND key = $2 AND version = $3
         RETURNING key, version, display_name, status, builtin, visibility,
                   underlying_type, tags, title, footer`,
        [cmd.orgId, cmd.key, cmd.version, cmd.displayName, [...cmd.tags], cmd.title, cmd.footer],
      );
      const row = r.rows[0];
      if (row === undefined) return { updated: false };
      return {
        updated: true,
        template: {
          key: row.key,
          version: row.version,
          status: row.status as TemplateStatus,
          displayName: row.display_name,
          builtin: row.builtin,
          visibility: row.visibility,
          underlyingType: row.underlying_type,
          tags: [...row.tags],
          title: row.title,
          footer: row.footer,
        },
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
   * ⚠ `DISTINCT`，不是裸 SELECT：契约问的是「有 N 个**议程环节**仍绑定此模板」。
   *   一个环节最多绑两个模板（I-6），所以去不去重今天恰好同值；不去重的那天，
   *   一个环节的两条绑定会被数成两个环节。
   */
  async listBoundSegmentIds(
    orgId: OrgId,
    key: string,
    version: number,
  ): Promise<readonly string[]> {
    return this.db.withTenant(orgId, async (s) => {
      const r = await s.query<{ agenda_segment_id: string }>(
        `SELECT DISTINCT agenda_segment_id
           FROM canvas_template_bindings
          WHERE org_id = $1 AND template_key = $2 AND template_version = $3
          ORDER BY agenda_segment_id`,
        [orgId, key, version],
      );
      return r.rows.map((row) => row.agenda_segment_id);
    });
  }

  /* ─────────────────── #493：`bindTemplateToSegment` 的写入面 ─────────────────── */

  async findSegmentWorkshopId(orgId: OrgId, agendaSegmentId: string): Promise<string | null> {
    return this.db.withTenant(orgId, async (s) => {
      const r = await s.query<{ workshop_id: string }>(
        `SELECT workshop_id FROM agenda_segments WHERE org_id = $1 AND id = $2`,
        [orgId, agendaSegmentId],
      );
      return r.rows[0]?.workshop_id ?? null;
    });
  }

  async listSegmentBindings(
    orgId: OrgId,
    agendaSegmentId: string,
  ): Promise<readonly SegmentBindingRow[]> {
    return this.db.withTenant(orgId, async (s) => {
      const r = await s.query<{ id: string; template_key: string; template_version: number }>(
        `SELECT id, template_key, template_version
           FROM canvas_template_bindings
          WHERE org_id = $1 AND agenda_segment_id = $2
          ORDER BY template_key`,
        [orgId, agendaSegmentId],
      );
      return r.rows.map((row) => ({
        bindingId: row.id,
        agendaSegmentId,
        templateKey: row.template_key,
        boundTemplateVersion: row.template_version,
      }));
    });
  }

  /**
   * ⚠ `ON CONFLICT ... DO NOTHING` + `RETURNING`，**不是**先 `SELECT` 再决定要不要插。
   *   先查后写在并发下两条都会进去，而唯一约束
   *   `canvas_template_bindings_segment_key_uniq` 本来就会挡住第二条——让数据库判，
   *   应用层只翻译结果（同 `advance-agenda-segment.ts` 对 `SEGMENT_ALREADY_ACTIVE` 的纪律）。
   *
   * ⚠ 冲突目标写成约束名而不是列清单：列清单写错一列，`ON CONFLICT` 就落到另一个
   *   （或没有）索引上，插入会在并发下开始真的抛 23505 而不是安静返回零行——
   *   两种行为在单线程测试里完全同形。
   */
  async insertSegmentBinding(cmd: {
    readonly orgId: OrgId;
    readonly bindingId: string;
    readonly agendaSegmentId: string;
    readonly workshopId: string;
    readonly templateKey: string;
    readonly templateVersion: number;
  }): Promise<"inserted" | "conflict"> {
    return this.db.withTenant(cmd.orgId, async (s) => {
      const r = await s.query<{ id: string }>(
        `INSERT INTO canvas_template_bindings
           (id, org_id, agenda_segment_id, workshop_id, template_key, template_version)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT ON CONSTRAINT canvas_template_bindings_segment_key_uniq DO NOTHING
         RETURNING id`,
        [
          cmd.bindingId, cmd.orgId, cmd.agendaSegmentId, cmd.workshopId,
          cmd.templateKey, cmd.templateVersion,
        ],
      );
      return r.rows.length === 1 ? "inserted" : "conflict";
    });
  }
}
