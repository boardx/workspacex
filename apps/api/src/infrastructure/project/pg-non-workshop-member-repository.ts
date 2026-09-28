/**
 * `NonWorkshopMemberRepository` 的 PostgreSQL 实现（项目中枢 B3-T5，#4499）。
 *
 * 按 `projects.kind` 分派到两张表：`research_project` → `research_project_members`，
 * `user_insight` → `user_insight_members`（F128 迁移 `20260801190000`）。表名来自一张闭合映射
 * `MEMBER_TABLE`，不是拼接调用方给的字符串——`kind` 在用例层已经是 `NonWorkshopKind` 闭集。
 *
 * 名单读侧返回 `guard({kind:"project"})`，披露由用例拿 `decideNonWorkshopMemberAccess()` 的决策解开。
 * `findContainer` / `findStanding` 读的是**身份 / 状态数据**（容器种类、状态、调用者的档位、
 * 有没有 owner），不是内容——同 `pg-project-membership-repository.ts` 的 `findProjectKind` 与
 * `IdentityRepository.findProjectMembership` 的性质，不 guard。
 *
 * 归档：INSERT/UPDATE 撞 F124 RESTRICTIVE 策略抛 `42501` ⇒ `archived`；DELETE 的策略挂 `USING`
 * 静默过滤，「已归档」由用例先读 `findContainer().status` 判（同 `pg-project-membership-repository.ts` 文件头）。
 *
 * `displayName`：LEFT JOIN `credentials`（无租户表，`kernel-no-tenant-data`），缺则回落 `user_id`，
 * 与 `listWorkshopMembers` 同一处置——INNER JOIN 会让没有凭据行的人从名单里整行消失。
 */
import type { DatabasePort } from "../../application/ports/database.port";
import type {
  NonWorkshopContainer,
  NonWorkshopKind,
  NonWorkshopMemberRepository,
  NonWorkshopMemberRole,
  NonWorkshopMemberRow,
  NonWorkshopStanding,
  RemoveNonWorkshopMemberOutcome,
  UpsertNonWorkshopMemberOutcome,
} from "../../application/project/non-workshop-member-ports";
import { guard, type Guarded } from "../../application/security/permission-filter";
import type { OrgId } from "../../domain/org-id";
import type { ProjectKind } from "../../domain/project/create-project-rules";

/** `kind` → 成员表。闭合映射，是「按 kind 分派」这件事在本文件里的唯一形式。 */
const MEMBER_TABLE: Record<NonWorkshopKind, "research_project_members" | "user_insight_members"> = {
  research_project: "research_project_members",
  user_insight: "user_insight_members",
};

function sqlState(e: unknown): string | undefined {
  return (e as { code?: string } | null)?.code;
}

function isRlsViolation(e: unknown): boolean {
  if (sqlState(e) === "42501") return true;
  const message = (e as { message?: string } | null)?.message ?? "";
  return /row-level security|policy/i.test(message);
}

export class PgNonWorkshopMemberRepository implements NonWorkshopMemberRepository {
  constructor(private readonly db: DatabasePort) {}

  async findContainer(orgId: OrgId, projectId: string): Promise<NonWorkshopContainer | null> {
    return this.db.withTenant(orgId, async (s) => {
      const r = await s.query<{ kind: ProjectKind; status: "active" | "archived" }>(
        `SELECT kind, status FROM projects WHERE id = $1 AND org_id = $2`,
        [projectId, orgId],
      );
      const row = r.rows[0];
      return row === undefined ? null : { kind: row.kind, status: row.status };
    });
  }

  async findStanding(orgId: OrgId, projectId: string, kind: NonWorkshopKind, userId: string): Promise<NonWorkshopStanding> {
    const table = MEMBER_TABLE[kind];
    return this.db.withTenant(orgId, async (s) => {
      const r = await s.query<{ member_role: NonWorkshopMemberRole | null; has_owner: boolean }>(
        `SELECT
           (SELECT m.role FROM ${table} m WHERE m.project_id = $1 AND m.org_id = $2 AND m.user_id = $3) AS member_role,
           EXISTS (SELECT 1 FROM ${table} o WHERE o.project_id = $1 AND o.org_id = $2 AND o.role = 'owner') AS has_owner`,
        [projectId, orgId, userId],
      );
      const row = r.rows[0];
      return { memberRole: row?.member_role ?? null, containerHasOwner: row?.has_owner ?? false };
    });
  }

  /**
   * `WHERE m.project_id = $1` 是这条查询的判权谓词，不是过滤条件：去掉它，一次合法的读会返回
   * 别的容器的成员。owner 在前、再按 userId，与契约 `listNonWorkshopMembers.out.members` 注释一致。
   */
  async listMembers(orgId: OrgId, projectId: string, kind: NonWorkshopKind): Promise<Guarded<readonly NonWorkshopMemberRow[]>> {
    const table = MEMBER_TABLE[kind];
    const ref = { kind: "project" as const, id: projectId };
    return this.db.withTenant(orgId, async (s) => {
      const r = await s.query<{ user_id: string; display_name: string | null; role: NonWorkshopMemberRole }>(
        `SELECT m.user_id, c.display_name, m.role
           FROM ${table} m
           LEFT JOIN credentials c ON c.user_id = m.user_id
          WHERE m.project_id = $1 AND m.org_id = $2
          ORDER BY (m.role = 'owner') DESC, m.user_id ASC`,
        [projectId, orgId],
      );
      return guard(
        ref,
        r.rows.map((row) => ({ userId: row.user_id, displayName: row.display_name ?? row.user_id, role: row.role })),
      );
    });
  }

  async upsertMember(cmd: {
    readonly orgId: OrgId;
    readonly projectId: string;
    readonly kind: NonWorkshopKind;
    readonly userId: string;
    readonly role: NonWorkshopMemberRole;
  }): Promise<UpsertNonWorkshopMemberOutcome> {
    const table = MEMBER_TABLE[cmd.kind];
    return this.db.withTenant(cmd.orgId, async (s) => {
      try {
        const r = await s.query<{ role: NonWorkshopMemberRole }>(
          `INSERT INTO ${table} (user_id, project_id, org_id, role)
             VALUES ($1, $2, $3, $4)
           ON CONFLICT (user_id, project_id) DO UPDATE SET role = EXCLUDED.role
           RETURNING role`,
          [cmd.userId, cmd.projectId, cmd.orgId, cmd.role],
        );
        const row = r.rows[0];
        if (row === undefined) return { kind: "not-found" };
        return { kind: "written", role: row.role };
      } catch (e) {
        if (sqlState(e) === "23503") return { kind: "not-found" }; // (project_id, org_id) 复合外键冲突
        if (isRlsViolation(e)) return { kind: "archived" };
        throw e;
      }
    });
  }

  async removeMember(cmd: {
    readonly orgId: OrgId;
    readonly projectId: string;
    readonly kind: NonWorkshopKind;
    readonly userId: string;
  }): Promise<RemoveNonWorkshopMemberOutcome> {
    const table = MEMBER_TABLE[cmd.kind];
    return this.db.withTenant(cmd.orgId, async (s) => {
      const r = await s.query<{ user_id: string }>(
        `DELETE FROM ${table} WHERE user_id = $1 AND project_id = $2 AND org_id = $3 RETURNING user_id`,
        [cmd.userId, cmd.projectId, cmd.orgId],
      );
      return r.rows.length === 0 ? "absent" : "removed";
    });
  }
}
