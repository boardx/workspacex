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
 *
 * ⚠ #609 起本文件多了**一对读方法**（`findProjectKind` / `listWorkshopMembers`，
 * `ProjectMemberRosterRepository`）。它们落在同一条豁免下、而不是另开一条，理由与写端同型：
 * `application/project/list-project-members.ts` 在调用本仓储**之前**已经用 `authorize()`
 * 对同一个 `{kind:"project", id}` 对象判过 `read.published`（与 `getProjectOverview` 同一个
 * 动作词），所以这不是第二条未判定的门缝；读出来的东西是**身份数据**
 * （谁在这个项目里、什么角色）加上 `credentials.display_name`，不是 `acl_bindings` 治理的
 * Artifact/Segment 内容——同 `pg-project-overview-repository.ts` 把同一张表读成计数的那条
 * 豁免，只是这里按行读。`credentials` 是无租户表（`kernel-no-tenant-data`，
 * `pg-credential-repository.ts` 本就整表读它）。
 * 约束由 `tests/project/list-project-members-repo-guard.test.ts` 静态钉住，不留成一句声明。
 */
import type { DatabasePort } from "../../application/ports/database.port";
import type {
  AddMemberCommand,
  AddMemberOutcome,
  ChangeRoleCommand,
  ChangeRoleOutcome,
  ProjectMemberRosterEntry,
  ProjectMemberRosterRepository,
  ProjectMembershipRepository,
  ProjectMembershipSnapshot,
  RemoveMemberCommand,
  RemoveMemberOutcome,
} from "../../application/project/member-ports";
import type { ProjectRole } from "../../domain/identity/roles";
import type { OrgId } from "../../domain/org-id";
import type { ProjectKind } from "../../domain/project/create-project-rules";

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

export class PgProjectMembershipRepository
  implements ProjectMembershipRepository, ProjectMemberRosterRepository
{
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

  /* ═══════════ #609 `listProjectMembers` 的读端（`ProjectMemberRosterRepository`） ═══════════ */

  /**
   * 容器种类。**单独一次读**，不与名单查询合并成一条带 `p.kind = 'workshop'` 谓词的 SQL——
   * 理由见 `member-ports.ts` 的端口头注：合并会把「仅 kind='workshop'」这条已裁的设计收窄
   * 藏进 SQL 里，用例层与它的反证测试都钉不住它。
   */
  async findProjectKind(orgId: OrgId, projectId: string): Promise<ProjectKind | null> {
    return this.db.withTenant(orgId, async (s) => {
      const result = await s.query<{ kind: ProjectKind }>(
        `SELECT kind FROM projects WHERE id = $1`,
        [projectId],
      );
      return result.rows[0]?.kind ?? null;
    });
  }

  /**
   * 名单。`WHERE m.project_id = $1` 是这条查询的**判权谓词**，不是过滤条件：去掉它，
   * 一次合法的读就会返回别的项目的成员（`tests/project/list-project-members-repo-guard.test.ts`
   * 静态断言它还在）。租户边界另由 `withTenant` 的 RLS 上下文把守。
   *
   * `displayName` 来自 `credentials`（`kernel-no-tenant-data`，与 `pg-credential-repository.ts`
   * 读的是同一张表）。LEFT JOIN 而不是 INNER JOIN：`project_memberships.user_id` 上**没有**
   * 指向 `credentials` 的外键（`0003-identity.sql:61`），免注册受邀者可能还没有凭据行——
   * INNER JOIN 会让这样一个人**从名单里整行消失**，而名单少一个人不会有任何东西报警。
   * 没有显示名时回落到 `user_id`（同 `pg-token-quota-repository.ts:85` 的既有处理），
   * 不编造别名、也不落库任何展示名（F125「展示别名不落库」）。
   */
  async listWorkshopMembers(
    orgId: OrgId,
    projectId: string,
  ): Promise<readonly ProjectMemberRosterEntry[]> {
    return this.db.withTenant(orgId, async (s) => {
      const result = await s.query<{
        user_id: string;
        display_name: string | null;
        project_role: ProjectRole;
        is_host: boolean;
      }>(
        `SELECT m.user_id, c.display_name, m.project_role, m.is_host
           FROM project_memberships m
           LEFT JOIN credentials c ON c.user_id = m.user_id
          WHERE m.project_id = $1
          ORDER BY m.user_id ASC`,
        [projectId],
      );
      return result.rows.map((r) => ({
        userId: r.user_id,
        displayName: r.display_name ?? r.user_id,
        projectRole: r.project_role,
        isHost: r.is_host,
      }));
    });
  }
}
