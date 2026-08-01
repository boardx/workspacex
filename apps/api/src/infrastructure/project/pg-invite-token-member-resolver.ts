/**
 * `MemberSubjectResolver` 的 PostgreSQL 实现（F125）。
 *
 * 见 `application/project/member-ports.ts` 的 `MemberSubjectResolver` 长注：本类只读
 * `invite_links`（F15 已建的表），要求 `used_by IS NOT NULL`——即该令牌已经被 01-auth
 * 现有的核销路径（`consumeInviteLink` / `pg-invite-link-repository.ts`）核销过。本类
 * 不重做「令牌是否过期/撤销/已被单次核销」的判定，那四态仍然只由 F15 的 `consume()`
 * 决定；这里只是把核销之后已经写定的授予值，读出来接给本束共用的「加人」用例。
 *
 * ## `lint-permission-paths` 豁免
 *
 * 见 `scripts/lint-permission-paths.mjs` ALLOWLIST：本文件对 `invite_links` 是只读，且
 * 只在「令牌已被核销」（`used_by IS NOT NULL`）时才返回一行，返回的字段
 * （userId/projectId/projectRole/groupId）都是**该令牌自己的授予值**，不是任意可被
 * 请求者置换成别人的内容——同 `pg-org-invite-repository.ts` 那条「这是授予的权威记录，
 * 不是要对某个请求者做披露判断的内容」的豁免同型：核销者读到的只能是自己核销时锁定的
 * 那份授予值，不存在「以某个身份读别人的令牌」的路径（`resolveInviteToken` 的入参只有
 * `token`，没有任何字段能让调用方选择读哪个人的授予值）。
 */
import type { DatabasePort } from "../../application/ports/database.port";
import type { MemberSubjectResolver, ResolvedInviteGrant } from "../../application/project/member-ports";
import type { OrgId } from "../../domain/org-id";
import type { ProjectRole } from "../../domain/identity/roles";

interface InviteLinkGrantRow {
  project_id: string;
  project_role: ProjectRole;
  group_id: string | null;
  used_by: string | null;
}

export class PgInviteTokenMemberResolver implements MemberSubjectResolver {
  constructor(private readonly db: DatabasePort) {}

  async resolveInviteToken(orgId: OrgId, token: string): Promise<ResolvedInviteGrant | null> {
    return this.db.withTenant(orgId, async (s) => {
      const found = await s.query<InviteLinkGrantRow>(
        `SELECT project_id, project_role, group_id, used_by
           FROM invite_links
          WHERE token = $1 AND org_id = $2 AND used_by IS NOT NULL`,
        [token, orgId],
      );
      const row = found.rows[0];
      if (row === undefined || row.used_by === null) return null;
      return {
        userId: row.used_by,
        projectId: row.project_id,
        projectRole: row.project_role,
        groupId: row.group_id,
      };
    });
  }
}
