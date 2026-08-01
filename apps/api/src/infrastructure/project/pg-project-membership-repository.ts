/**
 * `ProjectMembershipRepository` 的 PostgreSQL 实现（F125）。
 *
 * ## 归档判定：INSERT/UPDATE 靠捕获策略异常，DELETE 靠显式预读
 *
 * 见 `application/project/member-ports.ts` 文件头「PROJECT_ARCHIVED 的判定，三个方法
 * 各不相同」一节：F124 的冻结策略对 INSERT/UPDATE 挂 `WITH CHECK`（拒绝时抛
 * `42501`），对 DELETE 挂 `USING`（拒绝时**静默过滤掉那一行**，不抛异常）。
 * `addMember`/`changeRole` 因此让写入直接撞策略、捕获后翻译；`removeMember` 必须先读
 * 一次 `projects.status`，否则「已归档」与「这个人根本不是成员」在 DELETE 的返回值里
 * 完全一样（`rows.length === 0`）。
 *
 * ## `lint-permission-paths` 豁免
 *
 * 见 `scripts/lint-permission-paths.mjs` 的 ALLOWLIST 条目：本文件只写
 * `project_memberships`（`application/project/member-authorization.ts` 已经在调用本仓储
 * 之前做过判定），`removeMember` 里那一条 `SELECT projects.status` 不返回内容,
 * 只返回一个用于分支的布尔状态,同 `pg-project-archive-repository.ts` 的豁免同型。
 */
import type { DatabasePort } from "../../application/ports/database.port";
import type {
  AddMemberCommand,
  AddMemberOutcome,
  ChangeRoleCommand,
  ChangeRoleOutcome,
  ProjectMembershipRepository,
  ProjectMembershipSnapshot,
  RemoveMemberCommand,
  RemoveMemberOutcome,
} from "../../application/project/member-ports";
import type { ProjectRole } from "../../domain/identity/roles";

interface MembershipRow {
  user_id: string;
  project_id: string;
  project_role: ProjectRole;
  is_host: boolean;
  group_id: string | null;
}

function toSnapshot(row: MembershipRow): ProjectMembershipSnapshot {
  return {
    projectId: row.project_id,
    userId: row.user_id,
    projectRole: row.project_role,
    isHost: row.is_host,
    groupId: row.group_id,
  };
}

/** PostgreSQL SQLSTATE：外键冲突、主键冲突、RLS 拒绝（同 `advance-agenda-segment.ts` 的判据风格）。 */
function sqlState(e: unknown): string | undefined {
  return (e as { code?: string } | null)?.code;
}

function isRlsViolation(e: unknown): boolean {
  if (sqlState(e) === "42501") return true;
  const message = (e as { message?: string } | null)?.message ?? "";
  return /row-level security|policy/i.test(message);
}

export class PgProjectMembershipRepository implements ProjectMembershipRepository {
  constructor(private readonly db: DatabasePort) {}

  async addMember(cmd: AddMemberCommand): Promise<AddMemberOutcome> {
    return this.db.withTenant(cmd.orgId, async (s) => {
      try {
        const inserted = await s.query<MembershipRow>(
          `INSERT INTO project_memberships (user_id, project_id, org_id, project_role, group_id, is_host)
             VALUES ($1,$2,$3,$4,$5,$6)
           RETURNING user_id, project_id, project_role, is_host, group_id`,
          [cmd.userId, cmd.projectId, cmd.orgId, cmd.projectRole, cmd.groupId, cmd.isHost],
        );
        return { kind: "added", row: toSnapshot(inserted.rows[0]!) };
      } catch (e) {
        if (sqlState(e) === "23503") return { kind: "not-found" }; // project_id 外键冲突
        if (sqlState(e) === "23505") return { kind: "already-member" }; // (user_id, project_id) 主键冲突
        if (isRlsViolation(e)) return { kind: "archived" };
        throw e;
      }
    });
  }

  async changeRole(cmd: ChangeRoleCommand): Promise<ChangeRoleOutcome> {
    return this.db.withTenant(cmd.orgId, async (s) => {
      try {
        const updated = await s.query<MembershipRow>(
          `UPDATE project_memberships SET project_role = $4, is_host = $5
             WHERE user_id = $1 AND project_id = $2 AND org_id = $3
           RETURNING user_id, project_id, project_role, is_host, group_id`,
          [cmd.userId, cmd.projectId, cmd.orgId, cmd.projectRole, cmd.isHost],
        );
        const row = updated.rows[0];
        if (row === undefined) return { kind: "not-found" };
        return { kind: "changed", row: toSnapshot(row) };
      } catch (e) {
        if (isRlsViolation(e)) return { kind: "archived" };
        throw e;
      }
    });
  }

  async removeMember(cmd: RemoveMemberCommand): Promise<RemoveMemberOutcome> {
    return this.db.withTenant(cmd.orgId, async (s) => {
      // 见文件头：DELETE 的冻结策略挂 `USING`，拒绝时静默返回 0 行而不抛异常，
      // 所以「已归档」必须在 DELETE 之前显式判——不是重复声明冻结，是弥补 DELETE
      // 这一种语句下冻结策略「无法翻译」的那个角落。
      const check = await s.query<{ status: "active" | "archived" }>(
        `SELECT status FROM projects WHERE id = $1`,
        [cmd.projectId],
      );
      const proj = check.rows[0];
      if (proj === undefined) return { kind: "not-found" };
      if (proj.status === "archived") return { kind: "archived" };

      const deleted = await s.query<{ user_id: string }>(
        `DELETE FROM project_memberships WHERE user_id = $1 AND project_id = $2 AND org_id = $3
         RETURNING user_id`,
        [cmd.userId, cmd.projectId, cmd.orgId],
      );
      if (deleted.rows.length === 0) return { kind: "not-found" };
      return { kind: "removed" };
    });
  }
}
