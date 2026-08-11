/**
 * `OrgProfileRepository` on PostgreSQL + object storage（#363 delta）。
 *
 * ⚠ 本文件点名了 `organizations`、`org_memberships`、`credentials`、`org_invites`、
 *   `org_invite_tokens`、`org_avatar_artifacts`，与 `pg-team-repository.ts`/
 *   `pg-org-invite-repository.ts` 同一处境：越权判定已经在用例层
 *   （`actorOrgRole !== "admin"`）与 controller 层（组织成员资格）做过，
 *   这里读的是「判定所依据/已判定过的那些行」，用 `guard()` 包一层会是一个
 *   只为过门控套的壳——需要写进 `lint-permission-paths` 的 ALLOWLIST。
 */
import { randomBytes } from "node:crypto";
import { ORG_INVITE_LINK_VALIDITY_MS } from "../../domain/auth/org-invite";
import type { DatabasePort, TenantSession } from "../../application/ports/database.port";
import type { ObjectStore } from "../../application/artifact/ports";
import type {
  OrgInviteListRow,
  OrgMemberListRow,
  OrgProfile,
  OrgProfileRepository,
  StoredOrgAvatar,
  UpdateOrganizationInput,
  UpdateOrganizationResult,
} from "../../application/auth/org-profile-ports";
import type { OrgId } from "../../domain/org-id";

function newAvatarArtifactId(): string {
  return `org-avatar-${randomBytes(12).toString("hex")}`;
}

/**
 * 组织头像下载 URL 的**唯一**拼装处。`pg-identity-repository.ts`（resolveIdentity 的
 * `org.avatarUrl`，invite-link-and-reads delta ④）import 这一份，不各自手写第二份——
 * 路由若改，两个读路径一起变。
 */
export function avatarUrlFor(orgId: OrgId, avatarArtifactId: string | null): string | null {
  return avatarArtifactId === null ? null : `/organizations/${orgId}/avatar-file/${avatarArtifactId}`;
}

export class PgOrgProfileRepository implements OrgProfileRepository {
  constructor(
    private readonly db: DatabasePort,
    private readonly store: ObjectStore,
  ) {}

  async listMembers(orgId: OrgId): Promise<readonly OrgMemberListRow[]> {
    return this.db.withTenant(orgId, async (s) => {
      const res = await s.query<{
        user_id: string;
        display_name: string;
        email: string;
        org_role: string;
        team_id: string | null;
        joined_at: Date;
      }>(
        `SELECT m.user_id, c.display_name, c.email, m.org_role, m.team_id, m.joined_at
           FROM org_memberships m
           JOIN credentials c ON c.user_id = m.user_id
          WHERE m.org_id = $1
          ORDER BY m.joined_at ASC, m.user_id ASC`,
        [orgId],
      );
      return res.rows.map((r) => ({
        userId: r.user_id,
        displayName: r.display_name,
        email: r.email,
        orgRole: r.org_role,
        teamId: r.team_id,
        joinedAt: r.joined_at.toISOString(),
        // OA11 ③：`org_memberships` 目前没有「停用但保留记录」的概念——一行存在即活跃。
        status: "active" as const,
      }));
    });
  }

  async listInvites(orgId: OrgId): Promise<readonly OrgInviteListRow[]> {
    return this.db.withTenant(orgId, async (s) => {
      const res = await s.query<{
        id: string;
        email: string;
        status: string;
        invited_by: string;
        invited_by_display_name: string | null;
        created_at: Date;
        latest_token_expires_at: Date | null;
      }>(
        /**
         * 2026-08-09 复核（D 类，可用性）：`invited_by` 原样是 `oi.invited_by`（裸
         * user id）——邀请列表每一行渲染出「由 u-a3f86b... 邀请」，同 `app-shell.tsx`
         * 注释批评过的那类写法。JOIN `credentials` 换成真实姓名，同 `listMembers`
         * 已有的先例（`c.display_name`）。LEFT JOIN 而非 JOIN：邀请人账号理论上可能
         * 已不在 `credentials` 里（本仓无级联删除保证），此时退回裸 id 好过整行消失。
         */
        `SELECT oi.id, oi.email, oi.status, oi.invited_by, c.display_name AS invited_by_display_name,
                oi.created_at, t.expires_at AS latest_token_expires_at
           FROM org_invites oi
           LEFT JOIN credentials c ON c.user_id = oi.invited_by
           LEFT JOIN LATERAL (
             SELECT expires_at FROM org_invite_tokens
              WHERE invite_id = oi.id
              ORDER BY issued_at DESC
              LIMIT 1
           ) t ON true
          WHERE oi.org_id = $1
          ORDER BY oi.created_at DESC`,
        [orgId],
      );
      return res.rows.map((r) => ({
        inviteId: r.id,
        email: r.email,
        status: r.status,
        invitedBy: r.invited_by_display_name ?? r.invited_by,
        // invite-link-and-reads delta ②：裸 id 一并回传，供前端做「发起人不渲染批准按钮」
        // 的判定——展示名判不了这件事（可重名、可改名）。
        invitedByUserId: r.invited_by,
        // OA11 ④：从未签发过令牌的邀请（如 awaiting-review）没有 org_invite_tokens 行，
        // 取 created_at + 既有的 7 天域常量作估计值，不新造第二份有效期数字。
        expiresAt: (
          r.latest_token_expires_at ?? new Date(r.created_at.getTime() + ORG_INVITE_LINK_VALIDITY_MS)
        ).toISOString(),
      }));
    });
  }

  async updateOrganization(orgId: OrgId, input: UpdateOrganizationInput): Promise<UpdateOrganizationResult> {
    return this.db.withTenant(orgId, async (s) => {
      // 头像归属校验：非 null 的 avatarArtifactId 必须是这个组织自己的
      // `uploadOrgAvatar` 产出——`org_avatar_artifacts` 上的 RLS 已经把跨组织的行
      // 挡在租户上下文之外，这里的零行结果天然就是「不存在或不是我的」（V10 同形）。
      if (input.avatarArtifactId !== undefined && input.avatarArtifactId !== null) {
        const owned = await s.query<{ id: string }>(`SELECT id FROM org_avatar_artifacts WHERE id = $1`, [
          input.avatarArtifactId,
        ]);
        if (owned.rows[0] === undefined) return { ok: false as const, reason: "avatar-not-owned" as const };
      }

      const sets: string[] = [];
      const params: unknown[] = [orgId];
      if (input.name !== undefined) {
        params.push(input.name);
        sets.push(`name = $${params.length}`);
      }
      if (input.description !== undefined) {
        params.push(input.description);
        sets.push(`description = $${params.length}`);
      }
      if (input.avatarArtifactId !== undefined) {
        params.push(input.avatarArtifactId);
        sets.push(`avatar_artifact_id = $${params.length}`);
      }

      const row =
        sets.length === 0
          ? (await s.query<{ name: string; description: string | null; avatar_artifact_id: string | null }>(
              `SELECT name, description, avatar_artifact_id FROM organizations WHERE id = $1`,
              [orgId],
            )).rows[0]
          : (
              await s.query<{ name: string; description: string | null; avatar_artifact_id: string | null }>(
                `UPDATE organizations SET ${sets.join(", ")} WHERE id = $1
                 RETURNING name, description, avatar_artifact_id`,
                params,
              )
            ).rows[0];

      const profile: OrgProfile = {
        name: row?.name ?? "",
        description: row?.description ?? null,
        avatarArtifactId: row?.avatar_artifact_id ?? null,
        avatarUrl: avatarUrlFor(orgId, row?.avatar_artifact_id ?? null),
      };
      return { ok: true as const, profile };
    });
  }

  async storeAvatar(
    orgId: OrgId,
    actorId: string,
    bytes: Uint8Array,
    contentType: "image/png" | "image/jpeg" | "image/webp",
    sha256: string,
  ): Promise<StoredOrgAvatar> {
    const id = newAvatarArtifactId();
    const objectKey = `org-avatars/${orgId}/${id}`;
    // 对象存储先写（write-once），PG 归属登记后写——同 `materializeArtifact` 的顺序理由
    // （F04 文件头）：反过来会产生指向一个从未写入对象的元数据行。
    await this.store.putOnce(objectKey, bytes, contentType);
    await this.db.withTenant(orgId, (s) =>
      s.query(
        `INSERT INTO org_avatar_artifacts (id, org_id, object_key, content_type, size_bytes, sha256, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [id, orgId, objectKey, contentType, bytes.byteLength, sha256, actorId],
      ),
    );
    return { orgAvatarArtifactId: id, avatarUrl: avatarUrlFor(orgId, id) as string };
  }

  async readAvatarBytes(
    orgId: OrgId,
    avatarArtifactId: string,
  ): Promise<{ bytes: Uint8Array; contentType: string } | null> {
    const row = await this.db.withTenant(orgId, async (s: TenantSession) => {
      const res = await s.query<{ object_key: string; content_type: string }>(
        `SELECT object_key, content_type FROM org_avatar_artifacts WHERE id = $1`,
        [avatarArtifactId],
      );
      return res.rows[0] ?? null;
    });
    if (row === null) return null;
    const bytes = await this.store.get(row.object_key);
    if (bytes === null) return null;
    return { bytes, contentType: row.content_type };
  }
}
