/**
 * `OrgMemberRepository` on PostgreSQL（F11 / O-29 ②）。
 *
 * ⚠ 本文件点名了 `org_memberships`、`credentials`、`org_invites`——与
 * `pg-org-invite-repository.ts` 同一处境，需要在 `lint-permission-paths` 的
 * ALLOWLIST 上。越权判定（谁能移除谁）已经在用例层做过；这里只是移除动作本身。
 */
import type { DatabasePort } from "../../application/ports/database.port";
import type { OrgMemberRepository, RemoveOrgMemberResult } from "../../application/auth/org-member-ports";
import type { OrgId } from "../../domain/org-id";

export class PgOrgMemberRepository implements OrgMemberRepository {
  constructor(private readonly db: DatabasePort) {}

  async remove(orgId: OrgId, userId: string): Promise<RemoveOrgMemberResult> {
    return this.db.withTenant(orgId, async (s) => {
      // (1) 删成员行本身。RETURNING 判断「这一行本来就在吗」——幂等重放的分界点。
      // ⚠ 不是 UPDATE 一个 `removedAt` 标记：与 F03/auth 的会话不同，`org_memberships`
      //   没有「保留行、只翻状态」的既有约定（它是判定输入，见 identity 的
      //   `findOrgMembership` 直接 SELECT 整行），删行就是「停用访问」在这张表上的形状；
      //   历史产出的 attribution 保留靠的是**根本不碰**产出表，不是保留这一行。
      const removed = await s.query<{ user_id: string }>(
        `DELETE FROM org_memberships WHERE org_id = $1 AND user_id = $2 RETURNING user_id`,
        [orgId, userId],
      );
      if (removed.rows.length === 0) {
        // 幂等重放：上一次调用已经删过。不作废任何邀请（没有新东西可作废），
        // 不报错——usecases.md 逐字「重复移除返回同一结果」。
        return { removed: false, revokedInvites: 0 };
      }

      // (2) 作废该成员名下 `pending` 的未接受邀请（I-8）。
      //
      // ⚠ 邀请按**邮箱**匹配，不是按 `invited_by`——I-8 说的是「其全部 pending 邀请」，
      //   指的是**发给他的**邀请（他还没接受、后来才被拉进来 或 有条历史重复邀请），
      //   不是他邀请别人时留下的那些行（那些邀请与被移除的这个人是否还是成员无关）。
      const cred = await s.query<{ email: string }>(`SELECT email FROM credentials WHERE user_id = $1`, [userId]);
      const email = cred.rows[0]?.email;
      let revokedInvites = 0;
      if (email !== undefined) {
        const revoked = await s.query<{ id: string }>(
          `UPDATE org_invites SET status = 'revoked'
            WHERE org_id = $1 AND email = $2 AND status = 'pending'
          RETURNING id`,
          [orgId, email],
        );
        revokedInvites = revoked.rows.length;
      }

      return { removed: true, revokedInvites };
    });
  }
}
