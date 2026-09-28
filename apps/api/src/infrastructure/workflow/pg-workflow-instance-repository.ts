/**
 * WF01 —— `WorkflowInstanceRepository` 的 PostgreSQL 适配器（workflow_instances）。
 *
 * I-4：本适配器只有 INSERT 与 SELECT，不提供修改冻结字段的路径；库里触发器 `wf_instance_pin_immutable`
 * 另行拒绝任何改动 definition_version / pinned_skills 等冻结列的 UPDATE（迁移 20260929010000）。
 */
import type { DatabasePort } from "../../application/ports/database.port";
import type { PinnedWorkflowInstance, WorkflowInstanceRepository } from "../../application/workflow/workflow-ports";
import { toOrgId } from "../../domain/org-id";

interface InstanceRow {
  id: string;
  org_id: string;
  workflow_key: string;
  definition_version: number;
  graph_ref: string;
  pinned_skills: PinnedWorkflowInstance["pinnedSkills"];
  agent_id: string;
  agent_version_id: string;
  initiator_user_id: string;
  trigger_kind: PinnedWorkflowInstance["triggerKind"];
  status: PinnedWorkflowInstance["status"];
  state_version: number;
}

export class PgWorkflowInstanceRepository implements WorkflowInstanceRepository {
  constructor(private readonly db: DatabasePort) {}

  async create(i: PinnedWorkflowInstance): Promise<void> {
    await this.db.withTenant(toOrgId(i.orgId), (s) =>
      s.query(
        `INSERT INTO workflow_instances (id, org_id, workflow_key, definition_version, graph_ref, pinned_skills,
           agent_id, agent_version_id, initiator_user_id, trigger_kind, status, state_version)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10, $11, $12)`,
        [i.instanceId, i.orgId, i.workflowKey, i.definitionVersion, i.graphRef, JSON.stringify(i.pinnedSkills),
          i.agentId, i.agentVersionId, i.initiatorUserId, i.triggerKind, i.status, i.stateVersion],
      ),
    );
  }

  find(orgId: string, instanceId: string): Promise<PinnedWorkflowInstance | null> {
    return this.db.withTenant(toOrgId(orgId), async (s) => {
      const { rows } = await s.query<InstanceRow>(
        `SELECT id, org_id, workflow_key, definition_version, graph_ref, pinned_skills, agent_id, agent_version_id,
                initiator_user_id, trigger_kind, status, state_version
           FROM workflow_instances WHERE org_id = $1 AND id = $2`,
        [orgId, instanceId],
      );
      const r = rows[0];
      if (!r) return null;
      return {
        instanceId: r.id,
        orgId: r.org_id,
        workflowKey: r.workflow_key,
        definitionVersion: r.definition_version,
        graphRef: r.graph_ref,
        pinnedSkills: r.pinned_skills,
        agentId: r.agent_id,
        agentVersionId: r.agent_version_id,
        initiatorUserId: r.initiator_user_id,
        triggerKind: r.trigger_kind,
        status: r.status,
        stateVersion: r.state_version,
      };
    });
  }
}
