/**
 * `ProjectInvitationRepository` 的 PostgreSQL 实现（#4787 通用项目邀请）。
 *
 * ## 两类调用者
 *
 * 负责人一侧（create / issueLink / list / resend / revoke）：调用者已由用例过了
 * `authorizeNonWorkshopMember(…, "manage")`，这里在 `withTenant(orgId)` 里读写，跨组织的 id 由 RLS
 * 读成零行。名单读侧返回 `guard()`，披露由用例解开。
 *
 * 受邀人一侧（lookup / acceptLoggedIn / activate）：**可能没有会话**。令牌 SHA-256 先在无租户键的
 * `project_invitation_tokens` 里定位 `org_id_hint`，再在同一个事务里 `set_config('app.current_org', …, true)`
 * 切进租户读 `project_invitations`（手法同 `pg-org-invite-repository.ts`，也是它在
 * `lint-permission-paths` 里被豁免的同一理由：这条路径上没有 requester 可判）。
 * ⚠ `org_id_hint` 只决定「去哪个租户里找」，授予值（项目 / 角色 / 邮箱）恒取自邀请行。
 *
 * ## 失败一律 `throw Rollback`
 *
 * `withTenant` / `withoutTenant` 会把回调返回时已经写下的东西 COMMIT。所以「这一步判不过」必须抛出去
 * 让整个事务回滚——否则建了一半的账号 / 成员会被一并提交（同 `pg-registration-repository.ts`）。
 *
 * ## 授予组织成员资格的只有两处
 *
 * `acceptLoggedIn` 与 `activate`，且都只授予 `INVITED_ORG_ROLE`（组织里权限最小的一档）。
 * 两处都先过「座位配额」——与共享组织邀请链接同一条口径（成员数 + 待处理的组织邀请数 ≥ 配额即拒）。
 */
import type { DatabasePort, TenantSession } from "../../application/ports/database.port";
import type {
  AcceptInvitationResult,
  ActivateInvitationCmd,
  ActivateInvitationResult,
  InvitationListRow,
  InvitationLookup,
  InvitationMailContext,
  IssueLinkCmd,
  IssueLinkResult,
  PrepareEmailInvitationsCmd,
  PrepareEmailInvitationsResult,
  PreparedEmailItem,
  PrepareResendCmd,
  PrepareResendResult,
  ProjectInvitationRepository,
  RevokeInvitationResult,
} from "../../application/project/project-invitation-ports";
import { guard, type Guarded } from "../../application/security/permission-filter";
import { toOrgId, type OrgId } from "../../domain/org-id";
import {
  DAILY_CAP_WINDOW_MS,
  INVITED_ORG_ROLE,
  decideInvitationUse,
  decideResend,
  deriveInvitationStatus,
  type InvitationKind,
  type InvitationSendError,
  type InvitationStoredStatus,
} from "../../domain/project/project-invitation";

type RollbackReason = "invalid" | "email-mismatch" | "login-required" | "email-required" | "archived" | "quota";

/** 事务内抛、事务外接，唯一能让一个不该提交的事务不提交的办法。 */
class Rollback extends Error {
  constructor(readonly reason: RollbackReason) {
    super(reason);
  }
}

function uniqueViolationConstraint(e: unknown): string | null {
  const err = e as { code?: string; constraint?: string };
  return err?.code === "23505" ? (err.constraint ?? "") : null;
}

function isRlsViolation(e: unknown): boolean {
  if ((e as { code?: string } | null)?.code === "42501") return true;
  const message = (e as { message?: string } | null)?.message ?? "";
  return /row-level security|policy/i.test(message);
}

const FALLBACK_INVITER_NAME = "项目负责人";

interface InvitationRow {
  id: string;
  org_id: string;
  project_id: string;
  kind: InvitationKind;
  email: string | null;
  status: InvitationStoredStatus;
  expires_at: Date;
  accepted_by: string | null;
}

export class PgProjectInvitationRepository implements ProjectInvitationRepository {
  constructor(private readonly db: DatabasePort) {}

  /* ═══════════════════════ 负责人一侧 ═══════════════════════ */

  async prepareEmailInvitations(cmd: PrepareEmailInvitationsCmd): Promise<PrepareEmailInvitationsResult> {
    return this.db.withTenant(cmd.orgId, async (s) => {
      await this.lockProject(s, cmd.projectId);
      await this.expireStale(s, cmd.orgId, cmd.projectId, cmd.now);
      const context = await this.mailContext(s, cmd.orgId, cmd.projectId, cmd.invitedBy);

      const plan: { item: PrepareEmailInvitationsCmd["items"][number]; existing: PreparedEmailItem | null }[] = [];
      for (const item of cmd.items) {
        const member = await s.query(
          `SELECT 1 FROM credentials c
             JOIN general_project_members m ON m.user_id = c.user_id AND m.project_id = $1 AND m.org_id = $2
            WHERE c.email = $3`,
          [cmd.projectId, cmd.orgId, item.email],
        );
        if (member.rows.length > 0) {
          plan.push({ item, existing: { email: item.email, outcome: "already_member", invitationId: null } });
          continue;
        }
        const pending = await s.query<{ id: string }>(
          `SELECT id FROM project_invitations
            WHERE project_id = $1 AND org_id = $2 AND kind = 'email' AND email = $3 AND status = 'pending'`,
          [cmd.projectId, cmd.orgId, item.email],
        );
        const p = pending.rows[0];
        plan.push({
          item,
          existing: p === undefined ? null : { email: item.email, outcome: "already_pending", invitationId: p.id },
        });
      }

      const toCreate = plan.filter((p) => p.existing === null);
      if (toCreate.length > 0 && (await this.usedToday(s, cmd.orgId, cmd.projectId, cmd.now)) + toCreate.length > cmd.dailyCap) {
        return { ok: false as const, reason: "daily-cap" as const };
      }

      const items: PreparedEmailItem[] = [];
      for (const { item, existing } of plan) {
        if (existing !== null) {
          items.push(existing);
          continue;
        }
        // 「先占位再发」：send_attempts=1 / last_sent_at=now 与行同事务落库，随后才调邮件。
        await s.query(
          `INSERT INTO project_invitations
             (id, org_id, project_id, kind, email, token_hash, role, status, expires_at, invited_by,
              created_at, last_sent_at, send_attempts)
           VALUES ($1, $2, $3, 'email', $4, $5, 'collaborator', 'pending', $6, $7, $8, $8, 1)`,
          [item.invitationId, cmd.orgId, cmd.projectId, item.email, item.tokenHash, item.expiresAt, cmd.invitedBy, cmd.now],
        );
        await s.query(
          `INSERT INTO project_invitation_tokens (token_hash, invitation_id, org_id_hint) VALUES ($1, $2, $3)`,
          [item.tokenHash, item.invitationId, cmd.orgId],
        );
        items.push({ email: item.email, outcome: "created", invitationId: item.invitationId });
      }
      return { ok: true as const, context, items };
    });
  }

  async issueLink(cmd: IssueLinkCmd): Promise<IssueLinkResult> {
    return this.db.withTenant(cmd.orgId, async (s) => {
      await this.lockProject(s, cmd.projectId);
      await this.expireStale(s, cmd.orgId, cmd.projectId, cmd.now);
      if ((await this.usedToday(s, cmd.orgId, cmd.projectId, cmd.now)) + 1 > cmd.dailyCap) {
        return { ok: false as const, reason: "daily-cap" as const };
      }
      // 重置 = 旧的作废（其令牌行仍留在索引里，解析出 revoked 行 ⇒ 对外仍是「邀请无效」）、再签新的。
      const old = await s.query<{ id: string }>(
        `UPDATE project_invitations SET status = 'revoked'
          WHERE project_id = $1 AND org_id = $2 AND kind = 'link' AND status = 'pending'
          RETURNING id`,
        [cmd.projectId, cmd.orgId],
      );
      await s.query(
        `INSERT INTO project_invitations
           (id, org_id, project_id, kind, email, token_hash, role, status, expires_at, invited_by, created_at)
         VALUES ($1, $2, $3, 'link', NULL, $4, 'collaborator', 'pending', $5, $6, $7)`,
        [cmd.invitationId, cmd.orgId, cmd.projectId, cmd.tokenHash, cmd.expiresAt, cmd.invitedBy, cmd.now],
      );
      await s.query(
        `INSERT INTO project_invitation_tokens (token_hash, invitation_id, org_id_hint) VALUES ($1, $2, $3)`,
        [cmd.tokenHash, cmd.invitationId, cmd.orgId],
      );
      return { ok: true as const, replacedInvitationId: old.rows[0]?.id ?? null };
    });
  }

  async list(orgId: OrgId, projectId: string): Promise<Guarded<readonly InvitationListRow[]>> {
    const ref = { kind: "project" as const, id: projectId };
    return this.db.withTenant(orgId, async (s) => {
      const r = await s.query<{
        id: string;
        kind: InvitationKind;
        email: string | null;
        role: "collaborator";
        status: InvitationStoredStatus;
        expires_at: Date;
        created_at: Date;
        invited_by_name: string;
        last_sent_at: Date | null;
        send_attempts: number;
        last_send_error: InvitationSendError | null;
      }>(
        // `i.project_id = $1` 是判权谓词不是过滤条件：去掉它，一次合法的读会返回别的项目的邀请。
        `SELECT i.id, i.kind, i.email, i.role, i.status, i.expires_at, i.created_at,
                COALESCE(c.display_name, $3) AS invited_by_name,
                i.last_sent_at, i.send_attempts, i.last_send_error
           FROM project_invitations i
           LEFT JOIN credentials c ON c.user_id = i.invited_by
          WHERE i.project_id = $1 AND i.org_id = $2
          ORDER BY i.created_at DESC, i.id DESC
          LIMIT 200`,
        [projectId, orgId, FALLBACK_INVITER_NAME],
      );
      return guard(
        ref,
        r.rows.map((row) => ({
          invitationId: row.id,
          kind: row.kind,
          email: row.email,
          role: row.role,
          status: row.status,
          expiresAt: row.expires_at,
          createdAt: row.created_at,
          invitedByName: row.invited_by_name,
          lastSentAt: row.last_sent_at,
          sendAttempts: Number(row.send_attempts),
          lastSendError: row.last_send_error,
        })),
      );
    });
  }

  async prepareResend(cmd: PrepareResendCmd): Promise<PrepareResendResult> {
    return this.db.withTenant(cmd.orgId, async (s) => {
      // FOR UPDATE：判定、占名额、轮换令牌必须在同一次锁定里——两路同时点「重发」，
      // 读到同一个「冷却已过」，会各自发一封、各自作废对方的令牌。
      const res = await s.query<{
        id: string;
        kind: InvitationKind;
        email: string | null;
        status: InvitationStoredStatus;
        expires_at: Date;
        send_attempts: number;
        last_sent_at: Date | null;
      }>(
        `SELECT id, kind, email, status, expires_at, send_attempts, last_sent_at
           FROM project_invitations WHERE id = $1 AND project_id = $2 AND org_id = $3 FOR UPDATE`,
        [cmd.invitationId, cmd.projectId, cmd.orgId],
      );
      const row = res.rows[0];
      if (row === undefined) return { ok: false as const, reason: "not-found" as const, retryAfterMs: null };

      const verdict = decideResend(
        {
          kind: row.kind,
          status: row.status,
          expiresAt: row.expires_at,
          sendAttempts: Number(row.send_attempts),
          lastSentAt: row.last_sent_at,
        },
        cmd.now,
      );
      if (!verdict.ok) {
        const reason = verdict.reason === "limit-reached" ? "limit-reached" : verdict.reason;
        return { ok: false as const, reason, retryAfterMs: verdict.retryAfterMs ?? null };
      }
      if (row.email === null) return { ok: false as const, reason: "not-resendable" as const, retryAfterMs: null };

      const updated = await s.query<{ send_attempts: number }>(
        `UPDATE project_invitations
            SET token_hash = $2, send_attempts = send_attempts + 1, last_sent_at = $3, last_send_error = NULL
          WHERE id = $1
          RETURNING send_attempts`,
        [row.id, cmd.newTokenHash, cmd.now],
      );
      // 旧令牌从索引里拿掉：旧邮件里的链接此后与「从来不存在的令牌」表现一致。
      await s.query(`DELETE FROM project_invitation_tokens WHERE invitation_id = $1`, [row.id]);
      await s.query(
        `INSERT INTO project_invitation_tokens (token_hash, invitation_id, org_id_hint) VALUES ($1, $2, $3)`,
        [cmd.newTokenHash, row.id, cmd.orgId],
      );
      const context = await this.mailContext(s, cmd.orgId, cmd.projectId, cmd.actorId);
      return {
        ok: true as const,
        email: row.email,
        expiresAt: row.expires_at,
        sendAttempts: Number(updated.rows[0]?.send_attempts ?? row.send_attempts + 1),
        lastSentAt: cmd.now,
        context,
      };
    });
  }

  async recordSendFailure(cmd: { orgId: OrgId; invitationId: string; error: InvitationSendError }): Promise<void> {
    await this.db.withTenant(cmd.orgId, async (s) => {
      await s.query(`UPDATE project_invitations SET last_send_error = $2 WHERE id = $1`, [cmd.invitationId, cmd.error]);
    });
  }

  async revoke(cmd: { orgId: OrgId; projectId: string; invitationId: string }): Promise<RevokeInvitationResult> {
    return this.db.withTenant(cmd.orgId, async (s) => {
      const res = await s.query<{ id: string; status: InvitationStoredStatus }>(
        `SELECT id, status FROM project_invitations WHERE id = $1 AND project_id = $2 AND org_id = $3 FOR UPDATE`,
        [cmd.invitationId, cmd.projectId, cmd.orgId],
      );
      const row = res.rows[0];
      if (row === undefined) return "not-found" as const;
      if (row.status === "accepted") return "already-accepted" as const;
      // 幂等：已撤销直接返回，不再写一次（不刷新任何东西）。
      if (row.status === "revoked") return "revoked" as const;
      await s.query(`UPDATE project_invitations SET status = 'revoked' WHERE id = $1`, [row.id]);
      return "revoked" as const;
    });
  }

  /* ═══════════════════════ 受邀人一侧（可能没有会话） ═══════════════════════ */

  async lookup(tokenHash: string, now: Date, viewerUserId: string | null): Promise<InvitationLookup> {
    return this.db.withoutTenant(async (s) => {
      const located = await this.locate(s, tokenHash, false);
      const none: InvitationLookup = {
        found: false, valid: false, kind: null, projectName: null, inviterName: null, invitedEmail: null,
        invitedEmailHasAccount: false, viewerEmail: null, viewerIsProjectMember: false,
      };
      if (located === null) return none;
      const { row, projectName, inviterName } = located;
      const valid = deriveInvitationStatus({ status: row.status, expiresAt: row.expires_at }, now) === "pending";
      // 失效的邀请对外不带任何内容（不区分原因，也不透出项目名）。
      if (!valid) return { ...none, found: true };

      let hasAccount = false;
      if (row.kind === "email" && row.email !== null) {
        const acc = await s.query(`SELECT 1 FROM credentials WHERE email = $1`, [row.email]);
        hasAccount = acc.rows.length > 0;
      }
      let viewerEmail: string | null = null;
      let viewerIsMember = false;
      if (viewerUserId !== null) {
        const v = await s.query<{ email: string }>(`SELECT email FROM credentials WHERE user_id = $1`, [viewerUserId]);
        viewerEmail = v.rows[0]?.email ?? null;
        const m = await s.query(
          `SELECT 1 FROM general_project_members WHERE user_id = $1 AND project_id = $2 AND org_id = $3`,
          [viewerUserId, row.project_id, row.org_id],
        );
        viewerIsMember = m.rows.length > 0;
      }
      return {
        found: true, valid: true, kind: row.kind, projectName, inviterName,
        invitedEmail: row.kind === "email" ? row.email : null,
        invitedEmailHasAccount: hasAccount, viewerEmail, viewerIsProjectMember: viewerIsMember,
      };
    });
  }

  async acceptLoggedIn(cmd: { tokenHash: string; now: Date; userId: string }): Promise<AcceptInvitationResult> {
    try {
      return await this.db.withoutTenant(async (s) => {
        const located = await this.locate(s, cmd.tokenHash, true);
        if (located === null) throw new Rollback("invalid");
        const { row } = located;
        const orgId = toOrgId(row.org_id);

        // 刷新 / 重复点击：这条邮箱邀请已经是本人接受的 ⇒ 幂等成功。
        if (row.kind === "email" && row.status === "accepted" && row.accepted_by === cmd.userId) {
          return { ok: true as const, orgId, projectId: row.project_id, joinedOrg: false, alreadyMember: true };
        }

        const cred = await s.query<{ email: string }>(`SELECT email FROM credentials WHERE user_id = $1`, [cmd.userId]);
        const verdict = decideInvitationUse(
          {
            kind: row.kind,
            status: row.status,
            expiresAt: row.expires_at,
            email: row.email,
            viewerEmail: cred.rows[0]?.email ?? null,
          },
          cmd.now,
        );
        if (verdict !== "ok") throw new Rollback(verdict);
        // 邮箱邀请必须能验明登录账号的邮箱：查不到账号行就当不匹配，而不是放行。
        if (row.kind === "email" && cred.rows[0] === undefined) throw new Rollback("email-mismatch");

        await this.assertProjectWritable(s, row);

        // ① 组织成员资格（本用例授予它的两处之一）。已是成员就不动他的角色。
        const inOrg = await s.query(`SELECT 1 FROM org_memberships WHERE user_id = $1 AND org_id = $2`, [cmd.userId, orgId]);
        const joinedOrg = inOrg.rows.length === 0;
        if (joinedOrg) {
          await this.assertSeatAvailable(s, orgId);
          await this.insertOrgMembership(s, cmd.userId, orgId);
        }

        // ② 项目成员。已有一行（尤其是 owner）就原样保留——邀请不降级任何人。
        const alreadyMember = !(await this.insertCollaborator(s, cmd.userId, row));

        await this.markAccepted(s, row, cmd.userId, cmd.now);
        return { ok: true as const, orgId, projectId: row.project_id, joinedOrg, alreadyMember };
      });
    } catch (e) {
      if (e instanceof Rollback && (e.reason === "invalid" || e.reason === "email-mismatch" || e.reason === "archived" || e.reason === "quota")) {
        return { ok: false, reason: e.reason };
      }
      throw e;
    }
  }

  async activate(cmd: ActivateInvitationCmd): Promise<ActivateInvitationResult> {
    try {
      return await this.db.withoutTenant(async (s) => {
        const located = await this.locate(s, cmd.tokenHash, true);
        if (located === null) throw new Rollback("invalid");
        const { row } = located;
        const orgId = toOrgId(row.org_id);

        const verdict = decideInvitationUse(
          { kind: row.kind, status: row.status, expiresAt: row.expires_at, email: row.email, viewerEmail: null },
          cmd.now,
        );
        if (verdict !== "ok") throw new Rollback("invalid");
        await this.assertProjectWritable(s, row);

        // 邮箱：邮箱邀请取自邀请行（绝不取自入参——否则持令牌的人能把邀请落到别的地址上）；
        // 链接邀请由受邀人自填，走既有的邮箱验证流程（账号未验证、登录处是死路，直到验证）。
        const isEmailKind = row.kind === "email";
        const email = isEmailKind ? row.email : cmd.linkEmail;
        if (email === null) throw new Rollback("email-required");

        try {
          await s.query(
            `INSERT INTO credentials (user_id, email, display_name, password_hash, email_verified_at)
             VALUES ($1, $2, $3, $4, $5)`,
            [cmd.userId, email, cmd.displayName, cmd.passwordHash, isEmailKind ? cmd.now : null],
          );
        } catch (e) {
          if (uniqueViolationConstraint(e) === "credentials_email_uniq") throw new Rollback("login-required");
          throw e;
        }

        await this.assertSeatAvailable(s, orgId);
        await this.insertOrgMembership(s, cmd.userId, orgId);
        await this.insertCollaborator(s, cmd.userId, row);

        if (!isEmailKind) {
          // 同一事务里把验证邮件入队（同 `pg-registration-repository.ts`）：账号存在 ⇔ 验证邮件已入队。
          await s.query(
            `INSERT INTO email_verification_challenges (id, token_digest, user_id, expires_at) VALUES ($1, $2, $3, $4)`,
            [cmd.verification.challengeId, cmd.verification.tokenDigest, cmd.userId, cmd.verification.expiresAt],
          );
          await s.query(
            `INSERT INTO mail_outbox (id, challenge_id, template, recipient) VALUES ($1, $2, 'email-verification', $3)`,
            [cmd.verification.outboxId, cmd.verification.challengeId, email],
          );
        }

        await this.markAccepted(s, row, cmd.userId, cmd.now);
        // ⚠ 返回只有授予结果，不含邀请行内容（邮箱 / 邀请人）。
        return { ok: true as const, userId: cmd.userId, orgId, projectId: row.project_id, emailVerified: isEmailKind };
      });
    } catch (e) {
      if (
        e instanceof Rollback &&
        (e.reason === "invalid" || e.reason === "login-required" || e.reason === "email-required" || e.reason === "archived" || e.reason === "quota")
      ) {
        return { ok: false, reason: e.reason };
      }
      throw e;
    }
  }

  /* ═══════════════════════ 内部 ═══════════════════════ */

  /**
   * 令牌 → 邀请行。无租户上下文里查索引，再切进租户读邀请行（文件头）。
   * `lock` 时对邀请行 `FOR UPDATE`：并发两次接受同一条一次性邀请，第二路看到已 accepted。
   * 邀请行自己的 `token_hash` 必须等于入参哈希（索引行与邀请行不一致一律当不存在）。
   */
  private async locate(
    s: TenantSession,
    tokenHash: string,
    lock: boolean,
  ): Promise<{ row: InvitationRow; projectName: string; inviterName: string } | null> {
    const idx = await s.query<{ invitation_id: string; org_id_hint: string }>(
      `SELECT invitation_id, org_id_hint FROM project_invitation_tokens WHERE token_hash = $1`,
      [tokenHash],
    );
    const hit = idx.rows[0];
    if (hit === undefined) return null;
    // ⚠ `org_id_hint` 到此为止：它决定去哪个租户里找，不决定答案是什么。
    await s.query("SELECT set_config('app.current_org', $1, true)", [hit.org_id_hint]);

    const res = await s.query<InvitationRow & { project_name: string; inviter_name: string }>(
      `SELECT i.id, i.org_id, i.project_id, i.kind, i.email, i.status, i.expires_at, i.accepted_by,
              p.name AS project_name, COALESCE(c.display_name, $3) AS inviter_name
         FROM project_invitations i
         JOIN projects p ON p.id = i.project_id AND p.org_id = i.org_id
         LEFT JOIN credentials c ON c.user_id = i.invited_by
        WHERE i.id = $1 AND i.token_hash = $2
        ${lock ? "FOR UPDATE OF i" : ""}`,
      [hit.invitation_id, tokenHash, FALLBACK_INVITER_NAME],
    );
    const r = res.rows[0];
    if (r === undefined) return null;
    return { row: r, projectName: r.project_name, inviterName: r.inviter_name };
  }

  private async lockProject(s: TenantSession, projectId: string): Promise<void> {
    await s.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [`workspacex.project-invitations:${projectId}`]);
  }

  private async expireStale(s: TenantSession, orgId: OrgId, projectId: string, now: Date): Promise<void> {
    await s.query(
      `UPDATE project_invitations SET status = 'expired'
        WHERE project_id = $1 AND org_id = $2 AND status = 'pending' AND expires_at <= $3`,
      [projectId, orgId, now],
    );
  }

  private async usedToday(s: TenantSession, orgId: OrgId, projectId: string, now: Date): Promise<number> {
    const r = await s.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM project_invitations
        WHERE project_id = $1 AND org_id = $2 AND created_at > $3`,
      [projectId, orgId, new Date(now.getTime() - DAILY_CAP_WINDOW_MS)],
    );
    return Number(r.rows[0]?.n ?? 0);
  }

  private async mailContext(s: TenantSession, orgId: OrgId, projectId: string, inviterId: string): Promise<InvitationMailContext> {
    const r = await s.query<{ project_name: string; inviter_name: string }>(
      `SELECT p.name AS project_name, COALESCE(c.display_name, $3) AS inviter_name
         FROM projects p LEFT JOIN credentials c ON c.user_id = $4
        WHERE p.id = $1 AND p.org_id = $2`,
      [projectId, orgId, FALLBACK_INVITER_NAME, inviterId],
    );
    const row = r.rows[0];
    return { projectName: row?.project_name ?? "", inviterName: row?.inviter_name ?? FALLBACK_INVITER_NAME };
  }

  /** 归档项目由 F124 策略拒写；这里先显式判，得到干净的 `archived` 而不是一个 42501。 */
  private async assertProjectWritable(s: TenantSession, row: InvitationRow): Promise<void> {
    const r = await s.query<{ status: "active" | "archived" }>(`SELECT status FROM projects WHERE id = $1 AND org_id = $2`, [
      row.project_id,
      row.org_id,
    ]);
    if (r.rows[0] === undefined) throw new Rollback("invalid");
    if (r.rows[0].status === "archived") throw new Rollback("archived");
  }

  /**
   * 座位配额（与共享组织邀请链接同一条口径）：锁组织行，再数「成员 + 待处理的组织邀请」。
   * 已是成员的人不占新座位，调用方只在要新增组织成员时才调。
   */
  private async assertSeatAvailable(s: TenantSession, orgId: OrgId): Promise<void> {
    const quota = await s.query<{ seat_quota: string }>(`SELECT seat_quota FROM organizations WHERE id = $1 FOR UPDATE`, [orgId]);
    const seatQuota = Number(quota.rows[0]?.seat_quota ?? 0);
    const members = await s.query<{ n: string }>(`SELECT count(*)::text AS n FROM org_memberships WHERE org_id = $1`, [orgId]);
    const invites = await s.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM org_invites WHERE org_id = $1 AND status IN ('pending', 'awaiting-review', 'send-failed')`,
      [orgId],
    );
    if (Number(members.rows[0]?.n ?? 0) + Number(invites.rows[0]?.n ?? 0) >= seatQuota) throw new Rollback("quota");
  }

  /** 🔴 授予组织成员资格。角色恒为 `INVITED_ORG_ROLE`，不取自任何入参。 */
  private async insertOrgMembership(s: TenantSession, userId: string, orgId: OrgId): Promise<void> {
    await s.query(`INSERT INTO org_memberships (user_id, org_id, org_role, team_id) VALUES ($1, $2, $3, NULL)`, [
      userId,
      orgId,
      INVITED_ORG_ROLE,
    ]);
  }

  /** @returns `true` = 新增了一行；`false` = 已有一行（原样保留，尤其不降级 owner）。 */
  private async insertCollaborator(s: TenantSession, userId: string, row: InvitationRow): Promise<boolean> {
    try {
      const r = await s.query<{ user_id: string }>(
        `INSERT INTO general_project_members (user_id, project_id, org_id, role)
         VALUES ($1, $2, $3, 'collaborator')
         ON CONFLICT (user_id, project_id) DO NOTHING
         RETURNING user_id`,
        [userId, row.project_id, row.org_id],
      );
      return r.rows.length > 0;
    } catch (e) {
      if (isRlsViolation(e)) throw new Rollback("archived");
      throw e;
    }
  }

  /** 邮箱邀请一次性：置 accepted。链接邀请可重复使用，不改状态。 */
  private async markAccepted(s: TenantSession, row: InvitationRow, userId: string, now: Date): Promise<void> {
    if (row.kind !== "email") return;
    await s.query(`UPDATE project_invitations SET status = 'accepted', accepted_by = $2, accepted_at = $3 WHERE id = $1`, [
      row.id,
      userId,
      now,
    ]);
  }
}
