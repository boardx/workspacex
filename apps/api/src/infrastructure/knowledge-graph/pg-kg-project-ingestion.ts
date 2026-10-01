/**
 * B3-T2（issue #4496）—— `KgProjectIngestionPort` 的 Postgres 实现。
 *
 *   · `pendingProjects` 经 SECURITY DEFINER 函数 `kg_project_ingestion_pending()`（迁移 20260928210000）跨 org 取 id；
 *   · `alreadyIngested` 在租户会话里查 `ontology_actions`，回的只是调用方传进来的 id 里哪些已留痕（不披露内容）；
 *   · `knownObjects` 在租户会话里查 `ontology_objects`（RLS 生效）——实体名是内容，经 `guard()` 出门（ref = 项目），
 *     由 `ingest-project-evidence.ts` 用项目主体的决策 `discloseDecided`。
 * 留痕的判定口径与执行器 I-7 的唯一索引同一组键：`(org_id, source_ref, pipeline_version)` + `outcome = 'accepted'`。
 */
import type { DatabasePort } from "../../application/ports/database.port";
import type { KgProjectIngestionPort } from "../../application/knowledge-graph/ports";
import { guard, type Guarded } from "../../application/security/permission-filter";
import { KG_PROJECT_INGESTION_PIPELINE_VERSION, type KnownObject } from "../../domain/knowledge-graph/extraction";
import { toOrgId, type OrgId } from "../../domain/org-id";

export class PgKgProjectIngestion implements KgProjectIngestionPort {
  constructor(private readonly db: DatabasePort) {}

  async pendingProjects(): Promise<readonly { readonly orgId: OrgId; readonly projectId: string }[]> {
    const r = await this.db.withoutTenant((s) => s.query<{ org_id: string; project_id: string }>(
      "SELECT org_id, project_id FROM kg_project_ingestion_pending()",
    ));
    return r.rows.map((x) => ({ orgId: toOrgId(x.org_id), projectId: x.project_id }));
  }

  async alreadyIngested(orgId: OrgId, projectId: string, evidenceIds: readonly string[]): Promise<ReadonlySet<string>> {
    if (evidenceIds.length === 0) return new Set();
    const r = await this.db.withTenant(orgId, (s) => s.query<{ source_ref: string }>(
      `SELECT source_ref FROM ontology_actions
        WHERE org_id = $1 AND scope_kind = 'project' AND scope_id = $2 AND pipeline_version = $3
          AND outcome = 'accepted' AND source_ref = ANY($4::text[])`,
      [orgId, projectId, KG_PROJECT_INGESTION_PIPELINE_VERSION, [...evidenceIds]],
    ));
    return new Set(r.rows.map((x) => x.source_ref));
  }

  async knownObjects(orgId: OrgId, projectId: string): Promise<Guarded<readonly KnownObject[]>> {
    const r = await this.db.withTenant(orgId, (s) => s.query<{ id: string; name: string; aliases: string[]; object_kind: KnownObject["kind"] }>(
      `SELECT id, name, aliases, object_kind FROM ontology_objects
        WHERE org_id = $1 AND scope_kind = 'project' AND scope_id = $2 AND merged_into IS NULL
        ORDER BY created_at, id`,
      [orgId, projectId],
    ));
    return guard({ kind: "project", id: projectId }, r.rows.map((x) => ({ id: x.id, name: x.name, aliases: x.aliases, kind: x.object_kind })));
  }
}
