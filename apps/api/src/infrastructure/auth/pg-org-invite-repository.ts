/**
 * `OrgInviteRepository` on PostgreSQL —— **I-1 与 I-2 真正住在这个文件里**。
 *
 * ## I-2（链接身份以服务端为准）落在哪一行
 *
 * `SELECT org_role, team_id, email FROM org_invites WHERE id = $1 …`（`activate` 第 2 步），
 * 以及紧接着那条 `INSERT INTO org_memberships` 的第 3、4 个参数**恒来自那次 SELECT**。
 * 把这两处换成 `input.untrustedClaims.*`，功能仍然完全正常：受邀人激活成功，
 * 界面显示他的角色，日志一切正常——只不过角色是他自己在链接里写的。
 * 没有异常、没有约束冲突、没有一行日志。
 * ⇒ `tests/auth/activation-link-tamper-server-authoritative.test.ts` 的反证就是做这一步，
 *   断言当场变红；不做那次反证，这段注释就只是一段注释。
 *
 * ## I-1（部分成功禁止）靠的是事务的形状，不是靠 try/catch
 *
 * 核销令牌 → 读记录 → 建账号（新用户分支）→ 建 org_membership → 标 used，
 * 五步一个事务。任何一步失败 ⇒ 全回滚 ⇒ **令牌仍未核销**（usecases.md 逐字）。
 * 中途 `return` 是做不到这一点的：`withTenant` 会把回调返回时已经写下的东西 COMMIT 掉。
 * 所以失败一律 `throw Rollback`，与 `pg-registration-repository` 同一条理由。
 *
 * ## 为什么先在无租户上下文里核销令牌，再切进租户
 *
 * 激活请求是匿名的：点链接的人还没有会话，也还不是任何组织的成员，
 * 所以进事务时 `app.current_org` 只能是未设置的。`org_invite_tokens` 因此不带租户键
 * （迁移 0018 的文件头），而 `org_id_hint` 只用来决定**切到哪个租户上下文**。
 * 切换用的是事务内的 `set_config(..., true)`——与注册路径建个人本地组织时
 * 完全相同的手法，所以整条链仍然是**一个**事务。
 *
 * ⚠ 授予值不从 `org_id_hint` 推。它只回答「去哪张表的哪一行找答案」，
 *   不回答「答案是什么」。
 *
 * ## 为什么这个文件在 `lint-permission-paths` 的 ALLOWLIST 上
 *
 * 规则：任何在 SQL 里点名租户表的文件必须走 `application/security/permission-filter`。
 * 本文件点名了 `org_invites`、`org_memberships`、`org_invite_tamper_attempts`。
 *
 * 它不能走那道门，理由与 `pg-identity-repository` **同形**：那个文件读的是
 * 「判定所依据的成员关系与绑定」，用判定去守它是循环的。这里读的是
 * **授予所依据的那一行**，而且这条路径上根本没有 requester 可判——
 * 点链接的人还不属于任何组织，「他能不能读这一行」没有答案。
 * 用 `guard()` 包一层再 `void` 掉，只会是一个为过门控套的壳；
 * 这个仓库的规矩是宁可把例外写在明处。
 *
 * ⚠ 例外成立的前提是**邀请行的内容不出这个文件**：`activate` 返回的是
 * 授予值（userId / orgId / orgRole / teamId），不含 email、不含 invited_by。
 * 这一条不留作声明——`tests/auth/member-invite-activation.test.ts` 里有一条
 * 断言解析本文件的返回形状并在多出任何内容字段时变红。那条测试若被删，
 * ALLOWLIST 里的这一条也必须一起删。
 */
import type { DatabasePort, TenantSession } from "../../application/ports/database.port";
import type {
  ActivateOrgInviteInput,
  ActivateOrgInviteResult,
  CreateOrgInviteInput,
  CreateOrgInviteResult,
  OrgInviteRepository,
} from "../../application/auth/org-invite-ports";
import { detectTamper } from "../../domain/auth/org-invite";
import { toOrgId, type OrgId } from "../../domain/org-id";

/** 事务内抛、事务外接，唯一能让一个不该提交的事务不提交的办法。 */
class Rollback extends Error {
  constructor(readonly reason: "duplicate" | "already-member" | "not-found") {
    super(reason);
  }
}

/** PostgreSQL SQLSTATE 23505 = unique_violation。 */
function uniqueViolationConstraint(e: unknown): string | null {
  const err = e as { code?: string; constraint?: string };
  return err?.code === "23505" ? (err.constraint ?? "") : null;
}

interface InviteRow {
  id: string;
  org_id: string;
  email: string;
  org_role: string;
  team_id: string | null;
  status: string;
}

export class PgOrgInviteRepository implements OrgInviteRepository {
  constructor(private readonly db: DatabasePort) {}

  /* ─────────────────────────── 邀请 ─────────────────────────── */

  async create(input: CreateOrgInviteInput): Promise<CreateOrgInviteResult> {
    try {
      return await this.db.withTenant(input.orgId, async (s) => {
        // (1) 已经是成员的人不能被邀请（`INVITE_ALREADY_MEMBER`，引导去登录）。
        //
        // ⚠ 这一步与 (2) 的顺序不能反。反过来的话，一个已是成员的邮箱会先撞上
        // `org_invites_live_uniq`（如果他还有一条历史 pending），
        // 于是他收到的是「重复邀请」而不是「你已经是成员了」——
        // 两个码要用户做的事完全不同。
        const member = await s.query<{ user_id: string }>(
          `SELECT m.user_id FROM org_memberships m
             JOIN credentials c ON c.user_id = m.user_id
            WHERE m.org_id = $1 AND c.email = $2`,
          [input.orgId, input.email],
        );
        if (member.rows.length > 0) throw new Rollback("already-member");

        // (2) 邀请行。并发第二路在这里撞 `org_invites_live_uniq`（I-5）。
        //
        // ⚠ 没有「先 SELECT 有没有、没有就 INSERT」。那个形状下两路都查到「没有」，
        // 两路都插入成功，两条链接同时可用且可能授予不同角色——没有任何报错。
        // 与 `REDEEM_SQL` 的条件 UPDATE 是同一类判断，交给数据库做。
        //
        // ⚠ SAVEPOINT，不是裸 try/catch。PostgreSQL 里一次约束冲突会把**整个事务**
        //   置为 aborted：catch 到之后还想再查一次「既有那条长什么样」，
        //   拿到的是 `current transaction is aborted`——而那正是幂等重放要做的第一件事。
        //   这不是理论顾虑，是本文件第一版实测到的失败（重放与冲突两条测试同时红）。
        await s.query("SAVEPOINT try_insert_invite");
        try {
          await s.query(
            `INSERT INTO org_invites
               (id, org_id, email, org_role, team_id, status, invited_by, sent_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [
              input.inviteId,
              input.orgId,
              input.email,
              input.orgRole,
              input.teamId,
              input.status,
              input.actorId,
              // I-3：待复核的邀请**没有发出去**，所以 sent_at 为 NULL。
              // 迁移里的 CHECK 会在这条规则被绕过时拒绝写入。
              // ⚠ 非 NULL 时的语义是「已入站出站队列」，不是「SMTP 接受了」——
              // 投递器不在 F10 范围内（见 invite-org-member.ts 文件头）。
              input.status === "awaiting-review" ? null : new Date(),
            ],
          );
        } catch (e) {
          await s.query("ROLLBACK TO SAVEPOINT try_insert_invite");
          if (uniqueViolationConstraint(e) !== "org_invites_live_uniq") throw e;
          // 幂等重放 vs 冲突：判据是四元组（org, email, orgRole, teamId），见端口注释。
          const existing = await s.query<InviteRow>(
            `SELECT id, org_id, email, org_role, team_id, status FROM org_invites
              WHERE org_id = $1 AND email = $2
                AND status IN ('pending', 'awaiting-review', 'send-failed')`,
            [input.orgId, input.email],
          );
          const row = existing.rows[0];
          if (
            row === undefined ||
            row.org_role !== input.orgRole ||
            row.team_id !== input.teamId
          ) {
            throw new Rollback("duplicate");
          }
          return {
            ok: true as const,
            inviteId: row.id,
            // 重放不签发新令牌：签了就等于每点一次「邀请」都作废上一条链接（I-6 的反面）。
            tokenIssued: false,
            replayed: true,
          };
        }

        // (3) 令牌。`null` ⟺ awaiting-review（I-3）。
        if (input.token !== null && input.tokenExpiresAt !== null) {
          await s.query(
            `INSERT INTO org_invite_tokens (token, invite_id, org_id_hint, expires_at)
             VALUES ($1, $2, $3, $4)`,
            [input.token, input.inviteId, input.orgId, input.tokenExpiresAt],
          );
        }

        return {
          ok: true as const,
          inviteId: input.inviteId,
          tokenIssued: input.token !== null,
          replayed: false,
        };
      });
    } catch (e) {
      if (e instanceof Rollback && e.reason !== "not-found") {
        return { ok: false, reason: e.reason };
      }
      throw e;
    }
  }

  /* ─────────────────────────── 激活 ─────────────────────────── */

  async activate(input: ActivateOrgInviteInput): Promise<ActivateOrgInviteResult> {
    try {
      const grant = await this.db.withoutTenant((s) => this.activateAll(s, input));
      return { ok: true, grant };
    } catch (e) {
      if (e instanceof Rollback && e.reason !== "duplicate") {
        return { ok: false, reason: e.reason };
      }
      throw e;
    }
  }

  private async activateAll(s: TenantSession, input: ActivateOrgInviteInput) {
    // (1) 核销令牌 —— 条件 UPDATE，一条语句同时判「存在 / 未核销 / 未过期」。
    //
    // 三种失效在同一个 WHERE 里，所以它们**由构造**产生同一个零行结果（V10），
    // 而不是靠应用层记得把三个分支合并成一句话。
    // 并发两次点击在这条语句上串行：第二路重新求值 WHERE，看到 consumed_at 非空，匹配零行。
    const consumed = await s.query<{ invite_id: string; org_id_hint: string }>(
      `UPDATE org_invite_tokens
          SET consumed_at = $2
        WHERE token = $1
          AND consumed_at IS NULL
          AND expires_at > $2
        RETURNING invite_id, org_id_hint`,
      [input.token, input.now],
    );
    const tokenRow = consumed.rows[0];
    if (tokenRow === undefined) throw new Rollback("not-found");

    // (2) 切租户上下文。事务内、事务局部。
    //
    // ⚠ `org_id_hint` 到此为止：它决定去哪张表的哪一行找答案，不决定答案是什么。
    const orgId: OrgId = toOrgId(tokenRow.org_id_hint);
    await s.query("SELECT set_config('app.current_org', $1, true)", [orgId]);

    // (3) 🔴 **服务端记录 —— 授予的唯一来源（I-2）**。
    //
    // 这一次 SELECT 就是「链接身份以服务端为准」。它读的是 RLS 下的 `org_invites`，
    // 而 `status = 'pending'` 是「撤回中」那一类的落点：管理员在激活途中撤销了邀请
    // ⇒ 行还在、status 变成 revoked ⇒ 这里零行 ⇒ 当前步骤立即失败（E7）。
    const inviteRes = await s.query<InviteRow>(
      `SELECT id, org_id, email, org_role, team_id, status FROM org_invites
        WHERE id = $1 AND status = 'pending'`,
      [tokenRow.invite_id],
    );
    const invite = inviteRes.rows[0];
    if (invite === undefined) throw new Rollback("not-found");

    // ⚠ `invite.email` 到此为止：它只在下面 (4) 里当 INSERT 的参数用，
    //   不进返回值。ALLOWLIST 里那条例外的前提就是这一点（见文件头）。
    const actual = { orgId: invite.org_id, orgRole: invite.org_role, teamId: invite.team_id };

    // (4) 账号。新账号在这条路径上**直接是已验证的**——O-28 ⑤：点击一次性激活链接
    //     即足以证明邮箱所有权，不再二次发信。
    //
    // ⚠ 邮箱取自 `invite.email`，不取自任何入参。允许调用方带邮箱，
    //   等于允许持有令牌的人把这次邀请落到别的地址上。
    let userId: string;
    if (input.newAccount !== null) {
      try {
        await s.query(
          `INSERT INTO credentials (user_id, email, display_name, password_hash, email_verified_at)
           VALUES ($1, $2, $3, $4, $5)`,
          [
            input.newAccount.userId,
            invite.email,
            input.newAccount.displayName,
            input.newAccount.passwordHash,
            input.now,
          ],
        );
      } catch (e) {
        // 这个邮箱已经有账号了 ⇒ 他该走「已有账号登录后加入」那条分支。
        if (uniqueViolationConstraint(e) === "credentials_email_uniq") {
          throw new Rollback("already-member");
        }
        throw e;
      }
      userId = input.newAccount.userId;
    } else {
      if (input.existingUserId === null) throw new Rollback("not-found");
      userId = input.existingUserId;
    }

    // (5) 🔴 **授予**。第 3、4 个参数恒来自 (3) 的 SELECT。
    //
    // 换成 `input.untrustedClaims.orgRole` / `.teamId` 之后，
    // 这个文件、这条语句、以及整条链路都**不会有任何异常**——
    // 那正是 `activation-link-tamper-server-authoritative.test.ts` 的反证要做的事。
    try {
      await s.query(
        `INSERT INTO org_memberships (user_id, org_id, org_role, team_id) VALUES ($1, $2, $3, $4)`,
        [userId, orgId, actual.orgRole, actual.teamId],
      );
    } catch (e) {
      // 已有账号分支：他已经在这个组织里了。
      if (uniqueViolationConstraint(e) !== null) throw new Rollback("already-member");
      throw e;
    }

    // (6) 邀请行终态。`used` + 谁用的 + 什么时候用的，三者一起动（迁移里的 CHECK）。
    await s.query(
      `UPDATE org_invites SET status = 'used', used_at = $2, used_by_user_id = $3 WHERE id = $1`,
      [invite.id, input.now, userId],
    );

    // (7) 篡改留痕。**在同一个事务里**——分开写意味着授予成功而留痕失败时，
    //     那次尝试就消失了，而它恰好是最值得留下来的那一条。
    const tampered = detectTamper(input.untrustedClaims, actual);
    if (tampered) {
      await s.query(
        `INSERT INTO org_invite_tamper_attempts
           (org_id, invite_id, claimed_org_id, claimed_org_role, claimed_team_id,
            actual_org_role, actual_team_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          orgId,
          invite.id,
          input.untrustedClaims.orgId,
          input.untrustedClaims.orgRole,
          input.untrustedClaims.teamId,
          actual.orgRole,
          actual.teamId,
        ],
      );
    }

    return {
      userId,
      orgId,
      orgRole: actual.orgRole,
      teamId: actual.teamId,
      tamperRecorded: tampered,
    };
  }
}
