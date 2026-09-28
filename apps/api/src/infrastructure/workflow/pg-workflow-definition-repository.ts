/**
 * WF01 —— `WorkflowDefinitionRepository` 的 PostgreSQL 适配器（workflow_definitions / workflow_definition_versions）。
 *
 * ⚠ I-2 不只靠这里：`insertPublished` 只有 INSERT，没有覆盖路径（主键冲突即抛）；库里另有触发器
 *   `wf_definition_version_immutable` 拒绝改动已发布行的内容（迁移 20260929010000）。
 * ⚠ `withTenant` 内 WHERE 仍显式带 `org_id`——RLS 之外的第二道防线。
 */
import type { WorkflowDefinitionVersionView } from "@repo/contracts/workflow-runtime";
import type { DatabasePort } from "../../application/ports/database.port";
import type { WorkflowDefinitionRepository } from "../../application/workflow/workflow-ports";
import { toOrgId } from "../../domain/org-id";

interface VersionRow {
  key: string;
  version: number;
  graph_ref: string;
  title: string;
  status: WorkflowDefinitionVersionView["status"];
  stages: WorkflowDefinitionVersionView["stages"];
  input_schema: WorkflowDefinitionVersionView["inputSchema"];
  published_at: Date | null;
}

export class PgWorkflowDefinitionRepository implements WorkflowDefinitionRepository {
  constructor(private readonly db: DatabasePort) {}

  definitionExists(orgId: string, key: string): Promise<boolean> {
    return this.db.withTenant(toOrgId(orgId), async (s) => {
      const { rows } = await s.query("SELECT 1 FROM workflow_definitions WHERE org_id = $1 AND key = $2", [orgId, key]);
      return rows.length > 0;
    });
  }

  findVersion(orgId: string, key: string, version: number): Promise<WorkflowDefinitionVersionView | null> {
    return this.db.withTenant(toOrgId(orgId), async (s) => {
      const { rows } = await s.query<VersionRow>(
        `SELECT key, version, graph_ref, title, status, stages, input_schema, published_at
           FROM workflow_definition_versions WHERE org_id = $1 AND key = $2 AND version = $3`,
        [orgId, key, version],
      );
      const r = rows[0];
      if (!r) return null;
      return {
        key: r.key,
        version: r.version,
        graphRef: r.graph_ref,
        title: r.title,
        inputSchema: r.input_schema,
        stages: r.stages,
        status: r.status,
        publishedAt: r.published_at ? r.published_at.toISOString() : null,
      };
    });
  }

  latestPublishedVersion(orgId: string, key: string): Promise<number | null> {
    return this.db.withTenant(toOrgId(orgId), async (s) => {
      const { rows } = await s.query<{ v: number | null }>(
        "SELECT max(version) AS v FROM workflow_definition_versions WHERE org_id = $1 AND key = $2 AND status = 'published'",
        [orgId, key],
      );
      return rows[0]?.v ?? null;
    });
  }

  async insertPublished(orgId: string, view: WorkflowDefinitionVersionView): Promise<void> {
    await this.db.withTenant(toOrgId(orgId), (s) =>
      s.query(
        `INSERT INTO workflow_definition_versions (org_id, key, version, graph_ref, title, status, stages, input_schema, published_at)
         VALUES ($1, $2, $3, $4, $5, 'published', $6::jsonb, $7::jsonb, $8)`,
        [orgId, view.key, view.version, view.graphRef, view.title, JSON.stringify(view.stages), JSON.stringify(view.inputSchema), view.publishedAt],
      ),
    );
  }
}
