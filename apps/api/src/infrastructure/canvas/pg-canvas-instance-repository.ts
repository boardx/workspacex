/**
 * `CanvasInstanceRepository` 的 PostgreSQL 实现（#1493）。
 *
 * ## 每一条查询都在 `withTenant` 里
 *
 * 同 `pg-canvas-template-repository.ts` 文件头：隔离由 RLS 强制
 * （`canvas_instances_tenant` / `canvas_instance_versions_tenant`），SQL 里的
 * `WHERE org_id = $1` 是第二道。本文件不使用 `withoutTenant`。
 *
 * ## 幂等与乐观并发都由**数据库判**
 *
 * · `createInstances`：`ON CONFLICT ON CONSTRAINT canvas_instances_idempotency_uniq
 *   DO NOTHING`——并发重试的第二个请求安静退回零行，翻译成 `"conflict"`，
 *   调用方回读既有那一批。不先查后写（`insertSegmentBinding` 的同型纪律）。
 * · `appendVersion`：`WITH bump AS (UPDATE ... WHERE head_version = $expected) INSERT ...
 *   SELECT ... FROM bump`——判定（expectedHeadVersion 还是不是 head）与两处写入
 *   （推进指针、追加版本行）在同一条语句里，READ COMMITTED 下两个并发提交者只有
 *   先到的那个 UPDATE 得到行，后到的整条语句零行 ⇒ `VERSION_CHANGED`。
 */
import type { DatabasePort } from "../../application/ports/database.port";
import type {
  AppendVersionCmd,
  ApplyStickyRevisionCmd,
  CanvasInstanceFacts,
  CanvasInstanceRepository,
  CanvasInstanceRow,
  CanvasInstanceVersionRow,
  CreateInstanceCmd,
  StickyPatchFacts,
  StickyRevisionRow,
  TemplateContentFacts,
} from "../../application/canvas/instance-ports";
import type { OrgId } from "../../domain/org-id";

export class PgCanvasInstanceRepository implements CanvasInstanceRepository {
  constructor(private readonly db: DatabasePort) {}

  async findTemplateContent(
    orgId: OrgId,
    key: string,
    version: number,
  ): Promise<TemplateContentFacts | null> {
    return this.db.withTenant(orgId, async (s) => {
      const r = await s.query<{ display_name: string; sections: unknown }>(
        `SELECT display_name, sections FROM canvas_templates
          WHERE org_id = $1 AND key = $2 AND version = $3`,
        [orgId, key, version],
      );
      const row = r.rows[0];
      if (row === undefined) return null;
      // jsonb 回来的是已解析的 JS 值；写入方（createTemplate/mintVersion）保证形状
      // 就是契约 `SectionDef`——这里完整透传，不丢字段（renderCanvas 需要全形状）。
      const sections = row.sections as ReadonlyArray<{
        sectionId: string; name: string; order: number; required: boolean; capacity: number | null;
      }>;
      return {
        displayName: row.display_name,
        sections: sections.map((sec) => ({
          sectionId: sec.sectionId,
          name: sec.name,
          order: sec.order,
          required: sec.required,
          capacity: sec.capacity,
        })),
      };
    });
  }

  async listByIdempotencyKey(
    orgId: OrgId,
    agendaSegmentId: string,
    idempotencyKey: string,
  ): Promise<readonly CanvasInstanceRow[]> {
    return this.db.withTenant(orgId, async (s) => {
      const r = await s.query<{
        id: string;
        group_id: string;
        template_key: string;
        template_version: number;
        source_version_id: string;
      }>(
        // `sourceArtifactId` = v1 版本行的 id（命名遗留，见 instance-ports.ts）。
        // 稳定排序：重放的每一次响应逐字节同序。
        `SELECT i.id, i.group_id, i.template_key, i.template_version,
                (SELECT v.id FROM canvas_instance_versions v
                  WHERE v.instance_id = i.id AND v.version = 1) AS source_version_id
           FROM canvas_instances i
          WHERE i.org_id = $1 AND i.agenda_segment_id = $2 AND i.idempotency_key = $3
          ORDER BY i.group_id, i.template_key`,
        [orgId, agendaSegmentId, idempotencyKey],
      );
      return r.rows.map((row) => ({
        instanceId: row.id,
        groupId: row.group_id,
        templateKey: row.template_key,
        templateVersion: row.template_version,
        sourceArtifactId: row.source_version_id,
      }));
    });
  }

  async createInstances(cmd: {
    readonly orgId: OrgId;
    readonly agendaSegmentId: string;
    readonly workshopId: string;
    readonly idempotencyKey: string;
    readonly createdBy: string;
    readonly instances: readonly CreateInstanceCmd[];
  }): Promise<"created" | "conflict"> {
    // `withTenant` 一次调用就是一个事务（见 pg-database.ts）：任何一行撞幂等唯一约束，
    // 整批按 conflict 处理并回滚——不留下「半批实例」这种无法追溯的半成品。
    return this.db.withTenant(cmd.orgId, async (s) => {
      for (const inst of cmd.instances) {
        const head = await s.query<{ id: string }>(
          `INSERT INTO canvas_instances
             (id, org_id, agenda_segment_id, workshop_id, group_id,
              template_key, template_version, idempotency_key, head_version, created_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,1,$9)
           ON CONFLICT ON CONSTRAINT canvas_instances_idempotency_uniq DO NOTHING
           RETURNING id`,
          [
            inst.instanceId, cmd.orgId, cmd.agendaSegmentId, cmd.workshopId, inst.groupId,
            inst.templateKey, inst.templateVersion, cmd.idempotencyKey, cmd.createdBy,
          ],
        );
        if (head.rows.length === 0) {
          // 撞约束 ⇒ 同 (环节, 幂等键, 组, 模板) 已有实例——整批走重放路径。
          // 抛错回滚而不是 return：`withTenant` 的事务要把已插入的兄弟行一并撤掉。
          throw new IdempotencyConflict();
        }
        await s.query(
          `INSERT INTO canvas_instance_versions
             (id, org_id, instance_id, version, markdown, content_hash, created_by)
           VALUES ($1,$2,$3,1,$4,$5,$6)`,
          [
            inst.initialVersionId, cmd.orgId, inst.instanceId,
            inst.initialMarkdown, inst.contentHash, cmd.createdBy,
          ],
        );
      }
      return "created" as const;
    }).catch((e) => {
      if (e instanceof IdempotencyConflict) return "conflict" as const;
      throw e;
    });
  }

  async findInstance(orgId: OrgId, instanceId: string): Promise<CanvasInstanceFacts | null> {
    return this.db.withTenant(orgId, async (s) => {
      const r = await s.query<{
        id: string;
        workshop_id: string;
        group_id: string;
        head_version: number;
        template_key: string;
        template_version: number;
      }>(
        // template_key/template_version 是冻结的模板身份（路由事实，不是内容）——
        // render/export 用它取分区定义与几何；本 SELECT 仍然不含 markdown（豁免前提 c）。
        `SELECT id, workshop_id, group_id, head_version, template_key, template_version
           FROM canvas_instances WHERE org_id = $1 AND id = $2`,
        [orgId, instanceId],
      );
      const row = r.rows[0];
      if (row === undefined) return null;
      return {
        instanceId: row.id,
        workshopId: row.workshop_id,
        groupId: row.group_id,
        headVersion: row.head_version,
        templateKey: row.template_key,
        templateVersion: row.template_version,
      };
    });
  }

  async findVersion(
    orgId: OrgId,
    instanceId: string,
    versionId: string | undefined,
  ): Promise<CanvasInstanceVersionRow | null> {
    return this.db.withTenant(orgId, async (s) => {
      const r =
        versionId === undefined
          ? await s.query<VersionSqlRow>(
              // head = 指针指的那一行，不是 `max(version)`：两者今天恒等，但事实源
              // 只能有一处（head_version 是 appendVersion 那条 CTE 维护的那一个）。
              `SELECT v.id, v.version, v.markdown, v.content_hash
                 FROM canvas_instance_versions v
                 JOIN canvas_instances i ON i.id = v.instance_id AND i.org_id = v.org_id
                WHERE v.org_id = $1 AND v.instance_id = $2 AND v.version = i.head_version`,
              [orgId, instanceId],
            )
          : await s.query<VersionSqlRow>(
              `SELECT id, version, markdown, content_hash
                 FROM canvas_instance_versions
                WHERE org_id = $1 AND instance_id = $2 AND id = $3`,
              [orgId, instanceId, versionId],
            );
      const row = r.rows[0];
      if (row === undefined) return null;
      return {
        versionId: row.id,
        version: row.version,
        markdown: row.markdown,
        contentHash: row.content_hash,
      };
    });
  }

  async appendVersion(cmd: AppendVersionCmd): Promise<CanvasInstanceVersionRow | null> {
    return this.db.withTenant(cmd.orgId, async (s) => {
      const r = await s.query<VersionSqlRow>(
        `WITH bump AS (
           UPDATE canvas_instances
              SET head_version = head_version + 1
            WHERE org_id = $1 AND id = $2 AND head_version = $3
            RETURNING id, head_version
         )
         INSERT INTO canvas_instance_versions
           (id, org_id, instance_id, version, markdown, content_hash, created_by)
         SELECT $4, $1, bump.id, bump.head_version, $5, $6, $7 FROM bump
         RETURNING id, version, markdown, content_hash`,
        [
          cmd.orgId, cmd.instanceId, cmd.expectedHeadVersion,
          cmd.versionId, cmd.markdown, cmd.contentHash, cmd.createdBy,
        ],
      );
      const row = r.rows[0];
      if (row === undefined) return null; // expectedHeadVersion 已不是 head ⇒ VERSION_CHANGED
      return {
        versionId: row.id,
        version: row.version,
        markdown: row.markdown,
        contentHash: row.content_hash,
      };
    });
  }

  async findCurrentStickyRevision(
    orgId: OrgId,
    instanceId: string,
    stickyId: string,
  ): Promise<StickyRevisionRow | null> {
    return this.db.withTenant(orgId, async (s) => {
      const r = await s.query<{ id: string; client_ts: string; patch: unknown }>(
        `SELECT id, client_ts, patch FROM canvas_sticky_revisions
          WHERE org_id = $1 AND instance_id = $2 AND sticky_id = $3 AND is_current`,
        [orgId, instanceId, stickyId],
      );
      const row = r.rows[0];
      if (row === undefined) return null;
      return {
        revisionId: row.id,
        clientTs: row.client_ts,
        patch: row.patch as StickyPatchFacts,
      };
    });
  }

  async applyStickyRevision(cmd: ApplyStickyRevisionCmd): Promise<"applied" | "head_moved"> {
    // `withTenant` 一次调用 = 一个事务：修订行、current 指针翻转、版本行三件事
    // 要么全落要么全不落——「只成功一半」会造出没有版本对应的修订（或反之）。
    return this.db.withTenant(cmd.orgId, async (s) => {
      if (cmd.newVersion !== undefined) {
        // 同 `appendVersion` 的 CTE（判定与写入同一条语句）；零行 ⇒ 应用层计算新
        // markdown 所基于的 head 已被并发推进 ⇒ 抛错回滚整个事务，翻译成 "head_moved"。
        const v = await s.query<{ id: string }>(
          `WITH bump AS (
             UPDATE canvas_instances
                SET head_version = head_version + 1
              WHERE org_id = $1 AND id = $2 AND head_version = $3
              RETURNING id, head_version
           )
           INSERT INTO canvas_instance_versions
             (id, org_id, instance_id, version, markdown, content_hash, created_by)
           SELECT $4, $1, bump.id, bump.head_version, $5, $6, $7 FROM bump
           RETURNING id`,
          [
            cmd.orgId, cmd.instanceId, cmd.newVersion.expectedHeadVersion,
            cmd.newVersion.versionId, cmd.newVersion.markdown,
            cmd.newVersion.contentHash, cmd.createdBy,
          ],
        );
        if (v.rows.length === 0) throw new StickyHeadMoved();
      }
      if (cmd.winning) {
        // 旧 current → 历史。部分唯一索引 canvas_sticky_revisions_current_uniq
        // 是这条 UPDATE 写漏时的最后防线（两个 current 直接撞索引）。
        await s.query(
          `UPDATE canvas_sticky_revisions SET is_current = false
            WHERE org_id = $1 AND instance_id = $2 AND sticky_id = $3 AND is_current`,
          [cmd.orgId, cmd.instanceId, cmd.stickyId],
        );
      }
      await s.query(
        `INSERT INTO canvas_sticky_revisions
           (id, org_id, instance_id, sticky_id, patch, client_ts, is_current, created_by)
         VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8)`,
        [
          cmd.revisionId, cmd.orgId, cmd.instanceId, cmd.stickyId,
          JSON.stringify(cmd.patch), cmd.clientTs, cmd.winning, cmd.createdBy,
        ],
      );
      return "applied" as const;
    }).catch((e) => {
      if (e instanceof StickyHeadMoved) return "head_moved" as const;
      throw e;
    });
  }
}

/** 仅在 `applyStickyRevision` 的事务里流通：head 已被并发推进 ⇒ 回滚并翻译成 "head_moved"。 */
class StickyHeadMoved extends Error {
  constructor() {
    super("canvas head moved during sticky revision");
    this.name = "StickyHeadMoved";
  }
}

interface VersionSqlRow {
  id: string;
  version: number;
  markdown: string;
  content_hash: string;
}

/** 仅在 `createInstances` 的事务里流通：撞幂等唯一约束 ⇒ 回滚整批并翻译成 "conflict"。 */
class IdempotencyConflict extends Error {
  constructor() {
    super("canvas instance idempotency conflict");
    this.name = "IdempotencyConflict";
  }
}
