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
  ResendOrgInviteInput,
  ResendOrgInviteResult,
  ReviewOrgInviteInput,
  ReviewOrgInviteResult,
  RevokeOrgInviteInput,
  RevokeOrgInviteResult,
} from "../../application/auth/org-invite-ports";
import { detectTamper, isSelfReview } from "../../domain/auth/org-invite";
import { toOrgId, type OrgId } from "../../domain/org-id";

/** 事务内抛、事务外接，唯一能让一个不该提交的事务不提交的办法。 */
class Rollback extends Error {
  constructor(
    readonly reason:
      | "duplicate"
      | "already-member"
      | "not-found"
      | "quota-exhausted"
      | "self-review"
      | "already-decided"
      | "rate-limited"
      | "not-resendable"
      | "already-used",
  ) {
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

        // (1.4) 幂等重放 / 冲突的判定**必须先于**配额判定。
        //
        // ⚠ 这是本文件第一版撞出来的 bug：把配额判定放在幂等判定之前，会让「重复提交
        //   同一条已存在的邀请」在配额恰好用满时被判成 `QUOTA_EXHAUSTED`——而幂等重放
        //   根本不产生新行，不该占用任何座位，也就不该被座位数挡住。反证：
        //   `tests/auth/quota-exhausted-hard-block.test.ts` 那条"幂等重放不占用第二个
        //   座位"曾经真的红过，红的就是这一段顺序颠倒。
        // ⚠ 这一步只做**读**，不加锁——两路并发都读到"不存在"时会各自往下走到 (1.5)
        //   的配额锁定与 (2) 的插入，第二路撞 `org_invites_live_uniq` 时进 catch 分支，
        //   那里有一份同形状的重放/冲突判断兜底（见下）。两处判断不是重复：
        //   这一处是**常见路径的快路径**（不用先插入失败一次才知道是重放），
        //   catch 分支是**并发下这条快路径本身失手时**的兜底，两者缺一，
        //   要么幂等重放会被配额挡住，要么两路并发新邮箱会各自绕过配额检查。
        const preExisting = await s.query<InviteRow>(
          `SELECT id, org_id, email, org_role, team_id, status FROM org_invites
            WHERE org_id = $1 AND email = $2
              AND status IN ('pending', 'awaiting-review', 'send-failed')`,
          [input.orgId, input.email],
        );
        const preExistingRow = preExisting.rows[0];
        if (preExistingRow !== undefined) {
          if (preExistingRow.org_role !== input.orgRole || preExistingRow.team_id !== input.teamId) {
            throw new Rollback("duplicate");
          }
          return {
            ok: true as const,
            inviteId: preExistingRow.id,
            tokenIssued: false,
            replayed: true,
          };
        }

        // (1.5) I-9：配额硬阻断。**锁定 organizations 那一行**再数——不是先数、
        // 再插、指望没人在中间插一脚。`SELECT ... FOR UPDATE` 把并发的两名管理员
        // 串行在这一行上，第二路重新求值时会看到第一路已经占用的那个座位。
        //
        // ⚠ 座位数是**数出来的**，不是存出来的：count(org_memberships) + count(未失效
        //   org_invites)。没有第二本账本要跟这两张表保持同步——那正是本仓五次
        //   「同一事实两处声明」漂移的形状，这里刻意不重蹈。
        const quota = await s.query<{ seat_quota: string }>(
          `SELECT seat_quota FROM organizations WHERE id = $1 FOR UPDATE`,
          [input.orgId],
        );
        const seatQuota = Number(quota.rows[0]?.seat_quota ?? 0);
        const usedMembers = await s.query<{ n: string }>(
          `SELECT count(*)::text AS n FROM org_memberships WHERE org_id = $1`,
          [input.orgId],
        );
        const usedInvites = await s.query<{ n: string }>(
          `SELECT count(*)::text AS n FROM org_invites
            WHERE org_id = $1 AND status IN ('pending', 'awaiting-review', 'send-failed')`,
          [input.orgId],
        );
        const usedSeats = Number(usedMembers.rows[0]?.n ?? 0) + Number(usedInvites.rows[0]?.n ?? 0);
        // I-9 逐字：「组织未分配额度为 0 时一律失败，且不产生任何 OrgInvite 行」——
        // 这条判断必须发生在下面的 INSERT **之前**，本函数到这里为止还没有写过任何行。
        if (usedSeats >= seatQuota) throw new Rollback("quota-exhausted");

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
      if (
        e instanceof Rollback &&
        (e.reason === "duplicate" || e.reason === "already-member" || e.reason === "quota-exhausted")
      ) {
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
      if (e instanceof Rollback && (e.reason === "not-found" || e.reason === "already-member")) {
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

  /* ─────────────────────────── 双人复核（F11 / O-28 ⑥） ─────────────────────────── */

  async reviewAdminInvite(input: ReviewOrgInviteInput): Promise<ReviewOrgInviteResult> {
    try {
      return await this.db.withTenant(input.orgId, (s) => this.reviewOne(s, input));
    } catch (e) {
      if (e instanceof Rollback && (e.reason === "not-found" || e.reason === "self-review" || e.reason === "already-decided")) {
        return { ok: false, reason: e.reason };
      }
      throw e;
    }
  }

  private async reviewOne(s: TenantSession, input: ReviewOrgInviteInput): Promise<ReviewOrgInviteResult> {
    // `FOR UPDATE`：判定（自批？还在 awaiting-review 吗？）与写入必须在同一次锁定里，
    // 否则两名管理员同时批只生效一次（I-4 的并发半句）拿不到保证——与 `create` 的
    // 配额锁定同一条理由：先查后写之间的窗口会让两路都看到"可以批"，然后都写成功。
    const res = await s.query<{
      id: string;
      invited_by: string;
      status: string;
      reviewed_by: string | null;
    }>(
      `SELECT id, invited_by, status, reviewed_by FROM org_invites WHERE id = $1 FOR UPDATE`,
      [input.inviteId],
    );
    const row = res.rows[0];
    if (row === undefined) throw new Rollback("not-found");

    // I-4：发起人不可自批。**优先于**状态判断——即便邀请已经被别人批过，
    // 「你就是当初邀请他的人」这件事本身不因为状态变了而变得可以。
    if (isSelfReview(input.reviewerId, row.invited_by)) throw new Rollback("self-review");

    if (row.status !== "awaiting-review") {
      // 幂等重放：**同一个** reviewer 对**同一个**最终状态的重复提交，返回同一结果，
      // 不重复签发令牌（usecases.md 逐字）。
      const decidedToPending = row.status === "pending";
      const decidedToRevoked = row.status === "revoked";
      const sameReviewer = row.reviewed_by === input.reviewerId;
      if (sameReviewer && decidedToPending && input.decision === "approve") {
        return { ok: true, status: "pending", tokenIssued: false };
      }
      if (sameReviewer && decidedToRevoked && input.decision === "reject") {
        return { ok: true, status: "revoked", tokenIssued: false };
      }
      // 别人已经先批/先拒了，或它已被撤销（`revoked` 但 `reviewed_by` 不是这个人）——
      // 邀请**仍然存在**，只是状态已经翻过去了，映射为 VERSION_CHANGED 而非 NOT_FOUND。
      throw new Rollback("already-decided");
    }

    if (input.decision === "reject") {
      await s.query(
        `UPDATE org_invites SET status = 'revoked', reviewed_by = $2, reviewed_at = $3 WHERE id = $1`,
        [row.id, input.reviewerId, input.now],
      );
      return { ok: true, status: "revoked", tokenIssued: false };
    }

    // approve：签发新令牌 + 转 pending + 记录复核人。三件在同一事务。
    await s.query(
      `UPDATE org_invites
          SET status = 'pending', reviewed_by = $2, reviewed_at = $3, sent_at = $3
        WHERE id = $1`,
      [row.id, input.reviewerId, input.now],
    );
    if (input.token !== null && input.tokenExpiresAt !== null) {
      await s.query(
        `INSERT INTO org_invite_tokens (token, invite_id, org_id_hint, expires_at)
         VALUES ($1, $2, $3, $4)`,
        [input.token, row.id, input.orgId, input.tokenExpiresAt],
      );
    }
    return { ok: true, status: "pending", tokenIssued: true };
  }

  /* ─────────────────── 重发 / 撤销（#363 / I-6） ─────────────────── */

  async resendOrgInvite(input: ResendOrgInviteInput): Promise<ResendOrgInviteResult> {
    try {
      return await this.db.withTenant(input.orgId, (s) => this.resendOne(s, input));
    } catch (e) {
      if (
        e instanceof Rollback &&
        (e.reason === "not-found" || e.reason === "rate-limited" || e.reason === "not-resendable")
      ) {
        return { ok: false, reason: e.reason };
      }
      throw e;
    }
  }

  private async resendOne(s: TenantSession, input: ResendOrgInviteInput): Promise<ResendOrgInviteResult> {
    // `FOR UPDATE`：状态判定、限流判定、作废旧令牌、写新令牌，四件必须在同一次锁定里。
    //
    // ⚠ 限流放在锁外的表现极具欺骗性：两名管理员同一秒各点一次「重发」，两路都读到
    //   「冷却已过」，于是两枚新令牌各自作废对方，两个人手上都是一条已失效的链接，
    //   而两次调用都返回 200。这不是理论——`create` 的配额锁定注释里记的是同一个形状。
    //
    // ⚠ 这里**不查 org_id**：`withTenant` 已经把 RLS 的 `app.current_org` 设好了，
    //   别人组织的那一行由构造读不到 ⇒ 「不存在」与「不是你的」是同一个零行结果（V10）。
    //   与 `reviewOne` 逐字同一处置。
    const res = await s.query<{ id: string; status: string }>(
      `SELECT id, status FROM org_invites WHERE id = $1 FOR UPDATE`,
      [input.inviteId],
    );
    const row = res.rows[0];
    if (row === undefined) throw new Rollback("not-found");

    // 可重发的两种状态：
    //   `pending`      正常的「链接发出去了但对方没点」。
    //   `send-failed`  上一次投递失败——重发正是为它准备的动作。
    // 其余三种一律拒：`awaiting-review`（I-3：复核前**不签发**，重发会绕过整条双人复核）、
    // `revoked`、`used`。
    if (row.status !== "pending" && row.status !== "send-failed") {
      throw new Rollback("not-resendable");
    }

    // 限流。两条阈值都由调用方传进来（策略常量的单一事实源是 `AUTH_POLICY`），
    // 判定在这里做，因为它必须与写入同一次锁定。
    //
    // ⚠ 计数的对象是 `org_invite_tokens` 的**历史行**，不是某个计数器列。
    //   核销/作废都只打标记不删行（迁移 0022 的最后一句），所以这张表本身就是
    //   「这条邀请一共签发过几枚令牌、分别什么时候」的账本——再加一个 resend_count 列
    //   就是第二份事实源，而它与账本漂移时不会有任何报错。
    const stats = await s.query<{ last_issued_at: Date | null; issued_24h: string }>(
      `SELECT max(issued_at) AS last_issued_at,
              count(*) FILTER (WHERE issued_at > $2)::text AS issued_24h
         FROM org_invite_tokens
        WHERE invite_id = $1`,
      [row.id, new Date(input.now.getTime() - 24 * 60 * 60 * 1000)],
    );
    const last = stats.rows[0]?.last_issued_at ?? null;
    const issued24h = Number(stats.rows[0]?.issued_24h ?? 0);

    if (last !== null) {
      const elapsedSec = (input.now.getTime() - new Date(last).getTime()) / 1000;
      if (elapsedSec < input.cooldownSeconds) throw new Rollback("rate-limited");
    }
    if (issued24h >= input.dailyMax) throw new Rollback("rate-limited");

    // I-6 上半句：**作废旧令牌**。不是可选步骤——`org_invite_tokens_live_uniq`
    // （部分唯一索引 `WHERE consumed_at IS NULL`）就是为它建的，漏掉它的表现
    // 不是「旧链接还能用」，是下面那条 INSERT 当场 23505。
    //
    // ⚠ 用 `consumed_at` 而不是新加一列 `invalidated_at`：迁移 0022 的文件头把这一列
    //   定义成「非空 = 已核销」，并且逐字说明这条部分索引存在的理由就是重发。
    //   「作废」与「被用掉」在**激活路径**上要产生的结果完全相同（那条链接不再能换到成员），
    //   而区分这两者的账本是 `org_invites.used_at` / `used_by_user_id`——那两列只有
    //   真正的激活会写。加第二列只会让「这条链接还能用吗」有两个可以互相矛盾的答案。
    await s.query(
      `UPDATE org_invite_tokens SET consumed_at = $2 WHERE invite_id = $1 AND consumed_at IS NULL`,
      [row.id, input.now],
    );

    // I-6 下半句：签发新令牌。令牌值由用例生成（见 `resend-org-invite.ts`）。
    await s.query(
      `INSERT INTO org_invite_tokens (token, invite_id, org_id_hint, expires_at, issued_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [input.token, row.id, input.orgId, input.tokenExpiresAt, input.now],
    );

    // `send-failed` 重新回到 `pending`：链接又发出去了。`sent_at` 一并更新。
    await s.query(`UPDATE org_invites SET status = 'pending', sent_at = $2 WHERE id = $1`, [
      row.id,
      input.now,
    ]);

    return { ok: true, newTokenIssued: true, cooldownSec: input.cooldownSeconds };
  }

  async revokeOrgInvite(input: RevokeOrgInviteInput): Promise<RevokeOrgInviteResult> {
    try {
      return await this.db.withTenant(input.orgId, (s) => this.revokeOne(s, input));
    } catch (e) {
      if (e instanceof Rollback && (e.reason === "not-found" || e.reason === "already-used")) {
        return { ok: false, reason: e.reason };
      }
      throw e;
    }
  }

  private async revokeOne(s: TenantSession, input: RevokeOrgInviteInput): Promise<RevokeOrgInviteResult> {
    // 同 `resendOne`：租户上下文已由 `withTenant` 设好，跨组织的 id 读到零行。
    const res = await s.query<{ id: string; status: string }>(
      `SELECT id, status FROM org_invites WHERE id = $1 FOR UPDATE`,
      [input.inviteId],
    );
    const row = res.rows[0];
    if (row === undefined) throw new Rollback("not-found");

    // 幂等：已经是 revoked 就直接返回同一状态，**不再写一次**——重复撤销
    // 不该刷新任何时间戳，否则「这条邀请是什么时候被撤的」每被问一次就变一次。
    if (row.status === "revoked") return { ok: true, status: "revoked" };

    // 已激活的邀请撤不回去：成员已经建好了，而把他踢出组织是 `removeOrgMember` 的事。
    if (row.status === "used") throw new Rollback("already-used");

    // ⚠ 只翻 status，不动 `org_invite_tokens`——理由见端口注释与
    //   `activateAll` 第 (3) 步（它逐字要求 `status = 'pending'`）。
    // ⚠ 不写 `reviewed_by`：撤销不是复核。迁移 20260731085758 那条
    //   `reviewed_by <> invited_by` 的 CHECK 会让「发起人自己撤销自己发的邀请」
    //   ——一个完全正常的动作——因为一条与它无关的约束而失败。
    await s.query(`UPDATE org_invites SET status = 'revoked' WHERE id = $1`, [row.id]);
    return { ok: true, status: "revoked" };
  }
}
