/**
 * `TaskRepository` / `TaskStatusAuditWriter` PostgreSQL 实现 (F01 地基 + F02/F06 扩展)。
 *
 * ## R5 权限过滤在这里，不在 controller/application 层
 *
 * uc-11-1 R5 的四条角色规则本次实现为：
 *   · facilitator / org-wide-admin（项目经理/引导师）：项目内全部卡。
 *   · groupLead（组长）：owner=我 或 executor=我 的卡，加上"卡的负责人与我在同一项目
 *     属于同一个 group"的卡（通过 `project_memberships.group_id` 联查得到）。
 *   · member（组员）：同 groupLead 这条规则——R5 原文对组员是"分派给自己的卡 + 本组
 *     共享卡"，本表没有一个独立的"共享"标记，用"同组"近似"共享"（记录在案的近似，
 *     写权限那一半仍然分得开：groupLead 能改本组任意卡，member 只能改自己是负责人的
 *     卡，见 `board.controller.ts` 的写前置检查）。
 *   · observer：controller 层直接 403，这里不会被调用到。
 *
 * `groupId` 参数是**调用方（我）**的 group_id（由 controller 从 `findProjectMembership`
 * 取得），不是每张卡各自的——每张卡的 group 通过 JOIN `project_memberships` 用卡的
 * `owner_user_id` 现查。
 */
import type { TenantSession } from "../../application/ports/database.port";
import type { TaskRepository, TaskRow, TaskStatusAuditWriter } from "../../application/board/ports";
import type { TaskStatus } from "../../domain/board/task-status";
import type { RawTaskRow } from "../../domain/board/card-render";

interface TaskSqlRow {
  id: string;
  title: string;
  status: TaskStatus;
  source_kind: RawTaskRow["sourceKind"];
  owner_user_id: string | null;
  executor: string | null;
  due_at: string | null;
  risk_level: RawTaskRow["riskLevel"];
  waiting_on: string | null;
  sync_status: "synced" | "out_of_sync";
  project_id: string | null;
  updated_at: string;
}

function toRawTaskRow(r: TaskSqlRow): RawTaskRow {
  return {
    id: r.id,
    title: r.title,
    status: r.status,
    sourceKind: r.source_kind,
    ownerUserId: r.owner_user_id,
    executor: r.executor,
    dueAt: r.due_at === null ? null : new Date(r.due_at).toISOString(),
    riskLevel: r.risk_level,
    waitingOn: r.waiting_on,
    syncStatus: r.sync_status,
    projectId: r.project_id,
    updatedAt: new Date(r.updated_at).toISOString(),
  };
}

export class PgTaskRepository implements TaskRepository {
  async getByIdWithin(session: TenantSession, taskId: string): Promise<TaskRow | null> {
    const result = await session.query<{ id: string; org_id: string; project_id: string | null; status: TaskStatus }>(
      "SELECT id, org_id, project_id, status FROM tasks WHERE id = $1",
      [taskId],
    );
    const row = result.rows[0];
    if (!row) return null;
    return { id: row.id, orgId: row.org_id, projectId: row.project_id, status: row.status };
  }

  async updateStatusWithin(session: TenantSession, taskId: string, status: TaskStatus): Promise<void> {
    await session.query("UPDATE tasks SET status = $2 WHERE id = $1", [taskId, status]);
  }

  async updateSyncStatusWithin(
    session: TenantSession,
    taskId: string,
    syncStatus: "synced" | "out_of_sync",
  ): Promise<void> {
    await session.query("UPDATE tasks SET sync_status = $2 WHERE id = $1", [taskId, syncStatus]);
  }

  async createWithin(
    session: TenantSession,
    input: Parameters<TaskRepository["createWithin"]>[1],
  ): Promise<void> {
    await session.query(
      `INSERT INTO tasks (id, org_id, project_id, title, status, source_kind, owner_user_id, executor, due_at, risk_level, waiting_on)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        input.id,
        input.orgId,
        input.projectId,
        input.title,
        input.status,
        input.sourceKind,
        input.ownerUserId,
        input.executor,
        input.dueAt,
        input.riskLevel,
        input.waitingOn,
      ],
    );
  }

  async listVisibleWithin(
    session: TenantSession,
    input: Parameters<TaskRepository["listVisibleWithin"]>[1],
  ): Promise<readonly RawTaskRow[]> {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (input.projectIds !== null) {
      if (input.projectIds.length === 0) return [];
      params.push(input.projectIds);
      conditions.push(`t.project_id = ANY($${params.length}::text[])`);
    }

    const isPrivileged = input.role === "facilitator" || input.role === "org-wide-admin";
    if (!isPrivileged) {
      params.push(input.userId);
      const selfIdx = params.length;
      const clauses = [`t.owner_user_id = $${selfIdx}`, `t.executor = $${selfIdx}`];
      if (input.groupId !== null) {
        params.push(input.groupId);
        const groupIdx = params.length;
        clauses.push(
          `EXISTS (
             SELECT 1 FROM project_memberships pm
              WHERE pm.project_id = t.project_id
                AND pm.user_id = t.owner_user_id
                AND pm.group_id = $${groupIdx}
           )`,
        );
      }
      conditions.push(`(${clauses.join(" OR ")})`);
    }

    const whereSql = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const result = await session.query<TaskSqlRow>(
      `SELECT t.id, t.title, t.status, t.source_kind, t.owner_user_id, t.executor, t.due_at,
              t.risk_level, t.waiting_on, t.sync_status, t.project_id, t.updated_at
         FROM tasks t
         ${whereSql}
         ORDER BY t.created_at ASC`,
      params,
    );
    return result.rows.map(toRawTaskRow);
  }
}

export class PgTaskStatusAuditWriter implements TaskStatusAuditWriter {
  async appendWithin(
    session: TenantSession,
    input: Parameters<TaskStatusAuditWriter["appendWithin"]>[1],
  ): Promise<string> {
    const result = await session.query<{ id: number }>(
      `INSERT INTO task_status_audit (org_id, task_id, actor_user_id, from_status, to_status, reason)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [input.orgId, input.taskId, input.actorId, input.fromStatus, input.toStatus, input.reason],
    );
    return String(result.rows[0]!.id);
  }
}
