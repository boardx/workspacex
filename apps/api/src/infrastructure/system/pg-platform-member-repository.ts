/**
 * `PlatformMemberRepository` on PostgreSQL（member-role-management delta，平台级名册）。
 *
 * ⚠ 本文件点名了 `credentials`、`organizations`、`org_memberships`，需要在
 *   `lint-permission-paths` 的 ALLOWLIST 上——理由见端口文件头：它**没有**新开任何
 *   跨租户读路径，三段读分别是无租户表 / 既有的一人一次 DEFINER 函数 / 租户上下文内的
 *   本组织读；披露面的授权（平台超管）在 interface 层的 guard，早于本仓储被触达。
 *
 * ## 三段读的形状
 *
 * ① `withoutTenant`：`credentials` 全表（无 RLS，`pg-credential-repository.ts` 同一处置），
 *    同一事务里对每个 user_id 调 `kernel_user_org_ids`（0010）拿 `(org_id, org_role)`。
 * ② 对出现过的每个 org_id：`withTenant(orgId)` 读 `organizations.name/kind` 与该组织
 *    全部成员行的 `team_id/joined_at`。kind ≠ 'organization' 的组织整个跳过——
 *    本地组织（F16）与平台组织（`org-platform`）都不进名册。
 * ③ 拼装：账号 × 它的正式组织成员身份；没有任何正式组织的账号也保留（空 `memberships`）。
 *
 * ⚠ `org_role` 以 ② 读到的成员行为准而不是 ① 的 DEFINER 结果——两者本是同一行，
 *   但 ② 在租户事务里读到的是提交后的最新值，且带 team_id/joined_at；① 只用来发现
 *   「要去哪些组织里读」。
 */
import type { DatabasePort } from "../../application/ports/database.port";
import type {
  PlatformMemberListRow,
  PlatformMemberRepository,
  PlatformMembershipListRow,
} from "../../application/system/platform-member-ports";
import type { OrgRoleValue } from "../../domain/auth/org-role-change";
import { toOrgId, type OrgId } from "../../domain/org-id";

interface CredentialRow {
  user_id: string;
  email: string;
  display_name: string;
  email_verified_at: Date | null;
  created_at: Date;
}

export class PgPlatformMemberRepository implements PlatformMemberRepository {
  constructor(private readonly db: DatabasePort) {}

  async listAll(): Promise<readonly PlatformMemberListRow[]> {
    // ① 账号 + 每人所在的组织 id 集合。
    const { accounts, orgIdsOf } = await this.db.withoutTenant(async (s) => {
      const creds = await s.query<CredentialRow>(
        `SELECT user_id, email, display_name, email_verified_at, created_at
           FROM credentials
          ORDER BY created_at ASC, user_id ASC`,
      );
      const orgIdsOf = new Map<string, string[]>();
      for (const c of creds.rows) {
        const r = await s.query<{ org_id: string }>("SELECT org_id FROM kernel_user_org_ids($1)", [c.user_id]);
        orgIdsOf.set(c.user_id, r.rows.map((x) => x.org_id));
      }
      return { accounts: creds.rows, orgIdsOf };
    });

    // ② 每个出现过的组织：名字 / kind / 成员行，在**该组织自己的**租户上下文里读。
    const distinctOrgIds = [...new Set([...orgIdsOf.values()].flat())].sort();
    const orgs = new Map<string, { name: string; members: Map<string, PlatformMembershipListRow> }>();
    for (const orgId of distinctOrgIds) {
      const org = await this.readManagedOrg(toOrgId(orgId));
      if (org !== null) orgs.set(orgId, org);
    }

    // ③ 拼装。
    return accounts.map((c) => {
      const memberships: PlatformMembershipListRow[] = [];
      for (const orgId of orgIdsOf.get(c.user_id) ?? []) {
        const row = orgs.get(orgId)?.members.get(c.user_id);
        if (row !== undefined) memberships.push(row);
      }
      return {
        userId: c.user_id,
        displayName: c.display_name,
        email: c.email,
        emailVerified: c.email_verified_at !== null,
        createdAt: c.created_at.toISOString(),
        memberships,
      };
    });
  }

  async isManagedOrg(orgId: OrgId): Promise<boolean> {
    return this.db.withTenant(orgId, async (s) => {
      const r = await s.query<{ kind: string }>("SELECT kind FROM organizations WHERE id = $1", [orgId]);
      return r.rows[0]?.kind === "organization";
    });
  }

  /** 该组织不存在或不是正式组织 ⇒ null（整个组织跳过，不进名册）。 */
  private async readManagedOrg(
    orgId: OrgId,
  ): Promise<{ name: string; members: Map<string, PlatformMembershipListRow> } | null> {
    return this.db.withTenant(orgId, async (s) => {
      const org = await s.query<{ name: string; kind: string }>("SELECT name, kind FROM organizations WHERE id = $1", [
        orgId,
      ]);
      const row = org.rows[0];
      if (row === undefined || row.kind !== "organization") return null;

      const members = await s.query<{ user_id: string; org_role: string; team_id: string | null; joined_at: Date }>(
        `SELECT user_id, org_role, team_id, joined_at FROM org_memberships WHERE org_id = $1`,
        [orgId],
      );
      const byUser = new Map<string, PlatformMembershipListRow>();
      for (const m of members.rows) {
        byUser.set(m.user_id, {
          orgId,
          orgName: row.name,
          orgRole: m.org_role as OrgRoleValue,
          teamId: m.team_id,
          joinedAt: m.joined_at.toISOString(),
        });
      }
      return { name: row.name, members: byUser };
    });
  }
}
