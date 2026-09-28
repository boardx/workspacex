/**
 * WF03 —— 事件日志 + 状态机（workflow_events / workflow_instances）与阶段业务产出（workflow_stage_outputs）
 * 的 PostgreSQL 适配器。
 *
 * append：一个事务内 `SELECT … FOR UPDATE` 锁实例行 → 校验非终态与 expectedStateVersion → 改 status /
 *   reason_code 且 state_version+1 → 插入 seq = 最大 seq + 1 的事件。同实例追加因此串行；库里触发器
 *   wf_event_seq_contiguous（I-10）与 wf_instance_state_machine（I-12）兜底，不靠本文件自觉。
 * loadSnapshot：`FOR SHARE` 锁实例行后读事件与产出——追加者要等本事务结束，快照内 status / stateVersion /
 *   lastSeq 彼此一致（I-8：projection 只来自业务行）。
 * 可见性（发起人 / 组织管理员）由应用层 instance-projection.ts 在调用前判定。
 */
import { WORKFLOW_TERMINAL_STATUSES, type WorkflowInstanceStatus, type WorkflowReasonCode } from "@repo/contracts/workflow-runtime";
import type { DatabasePort, TenantSession } from "../../application/ports/database.port";
import type {
  WorkflowAppendResult,
  WorkflowEventInput,
  WorkflowEventStore,
  WorkflowInstanceState,
  WorkflowStageOutputRow,
  WorkflowStageOutputStore,
  WorkflowStoredEvent,
} from "../../application/workflow/workflow-runtime-ports";
import { toOrgId } from "../../domain/org-id";

interface InstanceRow {
  id: string;
  org_id: string;
  workflow_key: string;
  definition_version: number;
  graph_ref: string;
  pinned_skills: WorkflowInstanceState["pinnedSkills"];
  agent_id: string;
  agent_version_id: string;
  initiator_user_id: string;
  trigger_kind: WorkflowInstanceState["triggerKind"];
  status: WorkflowInstanceStatus;
  state_version: number;
  reason_code: WorkflowReasonCode | null;
  created_at: Date;
  updated_at: Date;
}

interface EventRow {
  seq: string;
  type: WorkflowEventInput["type"];
  state_version: number;
  stage_id: string | null;
  reason_code: WorkflowReasonCode | null;
  data: Record<string, unknown>;
  created_at: Date;
}

interface OutputRow {
  stage_id: string;
  attempt: number;
  output_id: string;
  label: string;
  content: Record<string, unknown>;
}

const EVENT_COLUMNS = "seq, type, state_version, stage_id, reason_code, data, created_at";

function toEvent(r: EventRow): WorkflowStoredEvent {
  return {
    seq: Number(r.seq),
    type: r.type,
    stateVersion: r.state_version,
    stageId: r.stage_id,
    reasonCode: r.reason_code,
    data: r.data,
    createdAt: r.created_at.toISOString(),
  };
}

function toOutput(r: OutputRow): WorkflowStageOutputRow {
  return { stageId: r.stage_id, attempt: r.attempt, outputId: r.output_id, label: r.label, content: r.content };
}

function toInstance(r: InstanceRow): WorkflowInstanceState {
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
    reasonCode: r.reason_code,
    createdAt: r.created_at.toISOString(),
    updatedAt: r.updated_at.toISOString(),
  };
}

async function lockInstance(s: TenantSession, orgId: string, instanceId: string, mode: "UPDATE" | "SHARE") {
  const { rows } = await s.query<InstanceRow>(
    `SELECT id, org_id, workflow_key, definition_version, graph_ref, pinned_skills, agent_id, agent_version_id,
            initiator_user_id, trigger_kind, status, state_version, reason_code, created_at, updated_at
       FROM workflow_instances WHERE org_id = $1 AND id = $2 FOR ${mode}`,
    [orgId, instanceId],
  );
  return rows[0] ?? null;
}

export class PgWorkflowEventStore implements WorkflowEventStore {
  constructor(private readonly db: DatabasePort) {}

  append(
    orgId: string,
    instanceId: string,
    event: WorkflowEventInput,
    opts: { expectedStateVersion?: number; status?: WorkflowInstanceStatus; reasonCode?: WorkflowReasonCode | null } = {},
  ): Promise<WorkflowAppendResult> {
    return this.db.withTenant(toOrgId(orgId), async (s) => {
      const row = await lockInstance(s, orgId, instanceId, "UPDATE");
      if (!row) return { ok: false, conflict: "workflow_not_found" };
      if (WORKFLOW_TERMINAL_STATUSES.includes(row.status)) return { ok: false, conflict: "instance_terminal" };
      if (opts.expectedStateVersion !== undefined && opts.expectedStateVersion !== row.state_version) {
        return { ok: false, conflict: "state_version_conflict" };
      }
      const status = opts.status ?? row.status;
      const reason = opts.reasonCode === undefined ? row.reason_code : opts.reasonCode;
      const stateVersion = row.state_version + 1;
      await s.query(
        `UPDATE workflow_instances SET status = $3, reason_code = $4, state_version = $5, updated_at = now()
          WHERE org_id = $1 AND id = $2`,
        [orgId, instanceId, status, reason, stateVersion],
      );
      const { rows } = await s.query<{ seq: string }>(
        `INSERT INTO workflow_events (instance_id, org_id, seq, type, state_version, stage_id, reason_code, data)
         SELECT $1, $2, coalesce(max(seq), 0) + 1, $3, $4, $5, $6, $7::jsonb FROM workflow_events WHERE instance_id = $1
         RETURNING seq`,
        [instanceId, orgId, event.type, stateVersion, event.stageId, event.reasonCode, JSON.stringify(event.data)],
      );
      return { ok: true, seq: Number(rows[0]!.seq), stateVersion, status };
    });
  }

  listAfter(orgId: string, instanceId: string, afterSeq: number, limit: number): Promise<WorkflowStoredEvent[]> {
    return this.db.withTenant(toOrgId(orgId), async (s) => {
      const { rows } = await s.query<EventRow>(
        `SELECT ${EVENT_COLUMNS} FROM workflow_events
          WHERE org_id = $1 AND instance_id = $2 AND seq > $3 ORDER BY seq LIMIT $4`,
        [orgId, instanceId, afterSeq, limit],
      );
      return rows.map(toEvent);
    });
  }

  hasStageEvent(orgId: string, instanceId: string, type: string, stageId: string, attempt: number): Promise<boolean> {
    return this.db.withTenant(toOrgId(orgId), async (s) => {
      const { rows } = await s.query(
        `SELECT 1 FROM workflow_events
          WHERE org_id = $1 AND instance_id = $2 AND type = $3 AND stage_id = $4 AND data->'attempt' = to_jsonb($5::int)
          LIMIT 1`,
        [orgId, instanceId, type, stageId, attempt],
      );
      return rows.length > 0;
    });
  }

  loadSnapshot(orgId: string, instanceId: string) {
    return this.db.withTenant(toOrgId(orgId), async (s) => {
      const row = await lockInstance(s, orgId, instanceId, "SHARE");
      if (!row) return null;
      const events = await s.query<EventRow>(
        `SELECT ${EVENT_COLUMNS} FROM workflow_events WHERE org_id = $1 AND instance_id = $2 ORDER BY seq`,
        [orgId, instanceId],
      );
      const outputs = await s.query<OutputRow>(
        `SELECT stage_id, attempt, output_id, label, content FROM workflow_stage_outputs
          WHERE org_id = $1 AND instance_id = $2 ORDER BY stage_id, attempt`,
        [orgId, instanceId],
      );
      return { instance: toInstance(row), events: events.rows.map(toEvent), outputs: outputs.rows.map(toOutput) };
    });
  }
}

export class PgWorkflowStageOutputStore implements WorkflowStageOutputStore {
  constructor(private readonly db: DatabasePort) {}

  put(orgId: string, instanceId: string, row: WorkflowStageOutputRow): Promise<{ row: WorkflowStageOutputRow; created: boolean }> {
    return this.db.withTenant(toOrgId(orgId), async (s) => {
      const inserted = await s.query<OutputRow>(
        `INSERT INTO workflow_stage_outputs (instance_id, org_id, stage_id, attempt, output_id, label, content)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb) ON CONFLICT (instance_id, stage_id, attempt) DO NOTHING
         RETURNING stage_id, attempt, output_id, label, content`,
        [instanceId, orgId, row.stageId, row.attempt, row.outputId, row.label, JSON.stringify(row.content)],
      );
      if (inserted.rows[0]) return { row: toOutput(inserted.rows[0]), created: true };
      const existing = await this.findIn(s, orgId, instanceId, row.stageId, row.attempt);
      if (!existing) throw new Error(`workflow stage output ${instanceId}/${row.stageId}/${row.attempt} vanished`);
      return { row: existing, created: false };
    });
  }

  find(orgId: string, instanceId: string, stageId: string, attempt: number): Promise<WorkflowStageOutputRow | null> {
    return this.db.withTenant(toOrgId(orgId), (s) => this.findIn(s, orgId, instanceId, stageId, attempt));
  }

  private async findIn(s: TenantSession, orgId: string, instanceId: string, stageId: string, attempt: number) {
    const { rows } = await s.query<OutputRow>(
      `SELECT stage_id, attempt, output_id, label, content FROM workflow_stage_outputs
        WHERE org_id = $1 AND instance_id = $2 AND stage_id = $3 AND attempt = $4`,
      [orgId, instanceId, stageId, attempt],
    );
    return rows[0] ? toOutput(rows[0]) : null;
  }
}
