/**
 * `OrgInviteLinkRepository` on PostgreSQL —— 共享链接的 I-1 / I-2 住在这个文件里。
 *
 * ## I-2（授予以服务端为准）落在哪一行
 *
 * `activate` 第 (3) 步 `SELECT org_role … FROM org_invite_links WHERE id = $1 AND
 * status = 'active' FOR UPDATE`，以及第 (6) 步 `INSERT INTO org_memberships` 的第 3 个
 * 参数**恒来自那次 SELECT**——请求里根本没有角色字段（契约 `in` 不含 orgRole，
 * 字段不存在是契约事实），这一层守的是「将来有人把它接到别的输入上」。
 *
 * ## used_count 为什么在锁里 +1
 *
 * 第 (3) 步的 `FOR UPDATE` 把并发的两次加入串行在链接行上：第二路重新求值时看到
 * 第一路已 +1 的计数，`max_uses = 2` 时第三人由构造被拒——不是先读计数再更新的
 * 两步窗口（那个形状下两路都读到 1，都写成 2，三个人都进来了且没有任何报错）。
 *
 * ## 为什么先在无租户上下文里查 hash，再切进租户
 *
 * 与 `pg-org-invite-repository.activateAll` 逐字同一段推理：激活请求是匿名的，
 * `org_invite_link_tokens` 不带租户键（迁移 20260813100000 文件头），`org_id_hint`
 * 只回答「去哪查」。差别只有一处：这里查的是 **sha-256 hash 的等值匹配**，
 * 明文在库里不存在。
 *
 * ## 为什么这个文件要加进 `lint-permission-paths` 的 ALLOWLIST
 *
 * 与 `pg-org-invite-repository.ts` 的既有条目同形：读的是**授予所依据的那一行**，
 * 且这条路径上没有 requester 可判（点链接的人还不属于任何组织）。例外成立的前提
 * 同样是**行内容不出这个文件**：`activate` 只返回授予值（userId / orgId / orgRole），
 * 不含 created_by、不含计数。`tests/auth/shared-invite-links.test.ts` 有一条断言
 * 钉住返回形状，那条测试若被删，ALLOWLIST 里的条目也必须一起删。
 */
import type { DatabasePort, TenantSession } from "../../application/ports/database.port";
import type {
  ActivateViaOrgInviteLinkInput,
  ActivateViaOrgInviteLinkResult,
  CreateOrgInviteLinkInput,
  OrgInviteLinkRepository,
  OrgInviteLinkRow,
  ReviewOrgInviteLinkInput,
  ReviewOrgInviteLinkResult,
  RevokeOrgInviteLinkInput,
  RevokeOrgInviteLinkResult,
} from "../../application/auth/org-invite-link-ports";
import {
  deriveOrgInviteLinkStatus,
  ORG_INVITE_LINK_EXPIRY_MS,
  type OrgInviteLinkExpiryKind,
  type StoredLinkStatus,
} from "../../domain/auth/org-invite-link";
import { isSelfReview } from "../../domain/auth/org-invite";
import { toOrgId, type OrgId } from "../../domain/org-id";

/** 事务内抛、事务外接（pg-org-invite-repository 的同一手法）。 */
class Rollback extends Error {
  constructor(
    readonly reason:
      | "not-found"
      | "self-review"
      | "already-decided"
      | "already-member"
      | "quota-exhausted",
  ) {
    super(reason);
  }
}

function uniqueViolationConstraint(e: unknown): string | null {
  const err = e as { code?: string; constraint?: string };
  return err?.code === "23505" ? (err.constraint ?? "") : null;
}

export class PgOrgInviteLinkRepository implements OrgInviteLinkRepository {
  constructor(private readonly db: DatabasePort) {}

  async create(input: CreateOrgInviteLinkInput): Promise<void> {
    await this.db.withTenant(input.orgId, async (s) => {
      await s.query(
        `INSERT INTO org_invite_links
           (id, org_id, org_role, expiry, expires_at, max_uses, status, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          input.linkId,
          input.orgId,
          input.orgRole,
          input.expiry,
          input.expiresAt,
          input.maxUses,
          input.status,
          input.actorId,
        ],
      );
      // pending-review 时**不写 token 行**（令牌不存在，拍板③的机械判据）。
      if (input.tokenHash !== null) {
        await s.query(
          `INSERT INTO org_invite_link_tokens (token_hash, link_id, org_id_hint) VALUES ($1, $2, $3)`,
          [input.tokenHash, input.linkId, input.orgId],
        );
      }
    });
  }

  async list(orgId: OrgId, now: Date): Promise<OrgInviteLinkRow[]> {
    return this.db.withTenant(orgId, async (s) => {
      // 展示名 join credentials（listOrgInvites 的先例）；credentials 非租户表，
      // LEFT JOIN 兜底裸 id——一个已被移除账号建过的链接仍要能被审计。
      const res = await s.query<{
        id: string;
        org_role: string;
        expiry: string;
        expires_at: Date | null;
        max_uses: number | null;
        used_count: number;
        status: string;
        created_by: string;
        created_at: Date;
        creator_name: string | null;
      }>(
        `SELECT l.id, l.org_role, l.expiry, l.expires_at, l.max_uses, l.used_count,
                l.status, l.created_by, l.created_at, c.display_name AS creator_name
           FROM org_invite_links l
           LEFT JOIN credentials c ON c.user_id = l.created_by
          ORDER BY l.created_at DESC`,
        [],
      );
      return res.rows.map((r) => ({
        linkId: r.id,
        orgRole: r.org_role,
        // 派生五态的唯一规则在 domain（deriveOrgInviteLinkStatus）；这里只搬运。
        status: deriveOrgInviteLinkStatus({
          status: r.status as StoredLinkStatus,
          expiresAt: r.expires_at,
          maxUses: r.max_uses,
          usedCount: Number(r.used_count),
          now,
        }),
        expiry: r.expiry as OrgInviteLinkExpiryKind,
        expiresAt: r.expires_at,
        maxUses: r.max_uses === null ? null : Number(r.max_uses),
        usedCount: Number(r.used_count),
        createdBy: r.creator_name ?? r.created_by,
        createdByUserId: r.created_by,
        createdAt: r.created_at,
      }));
    });
  }

  async revoke(input: RevokeOrgInviteLinkInput): Promise<RevokeOrgInviteLinkResult> {
    try {
      return await this.db.withTenant(input.orgId, async (s) => {
        const res = await s.query<{ id: string; status: string }>(
          `SELECT id, status FROM org_invite_links WHERE id = $1 FOR UPDATE`,
          [input.linkId],
        );
        const row = res.rows[0];
        if (row === undefined) throw new Rollback("not-found");
        // 幂等：已作废直接返回，不刷新 revoked_at（revokeOrgInvite 同款）。
        if (row.status === "revoked") return { ok: true as const, status: "revoked" as const };
        await s.query(
          `UPDATE org_invite_links SET status = 'revoked', revoked_at = $2 WHERE id = $1`,
          [row.id, input.now],
        );
        return { ok: true as const, status: "revoked" as const };
      });
    } catch (e) {
      if (e instanceof Rollback && e.reason === "not-found") return { ok: false, reason: "not-found" };
      throw e;
    }
  }

  async review(input: ReviewOrgInviteLinkInput): Promise<ReviewOrgInviteLinkResult> {
    try {
      return await this.db.withTenant(input.orgId, (s) => this.reviewOne(s, input));
    } catch (e) {
      if (
        e instanceof Rollback &&
        (e.reason === "not-found" || e.reason === "self-review" || e.reason === "already-decided")
      ) {
        return { ok: false, reason: e.reason };
      }
      throw e;
    }
  }

  private async reviewOne(s: TenantSession, input: ReviewOrgInviteLinkInput): Promise<ReviewOrgInviteLinkResult> {
    // FOR UPDATE：判定与写入同一次锁定（reviewOne@pg-org-invite-repository 同款）。
    const res = await s.query<{
      id: string;
      created_by: string;
      status: string;
      reviewed_by: string | null;
      expiry: string;
      expires_at: Date | null;
    }>(
      `SELECT id, created_by, status, reviewed_by, expiry, expires_at
         FROM org_invite_links WHERE id = $1 FOR UPDATE`,
      [input.linkId],
    );
    const row = res.rows[0];
    if (row === undefined) throw new Rollback("not-found");

    // I-4：建链人不可自批，优先于状态判断（同一条函数，同一个优先级理由）。
    if (isSelfReview(input.reviewerId, row.created_by)) throw new Rollback("self-review");

    if (row.status !== "pending-review") {
      // 幂等重放：同一 reviewer、同一最终状态 → 同一结果，不重复签发。
      const sameReviewer = row.reviewed_by === input.reviewerId;
      if (sameReviewer && row.status === "active" && input.decision === "approve") {
        return { ok: true, status: "active", tokenIssued: false, expiresAt: row.expires_at };
      }
      if (sameReviewer && row.status === "revoked" && input.decision === "reject") {
        return { ok: true, status: "revoked", tokenIssued: false, expiresAt: null };
      }
      throw new Rollback("already-decided");
    }

    if (input.decision === "reject") {
      await s.query(
        `UPDATE org_invite_links
            SET status = 'revoked', reviewed_by = $2, reviewed_at = $3, revoked_at = $3
          WHERE id = $1`,
        [row.id, input.reviewerId, input.now],
      );
      return { ok: true, status: "revoked", tokenIssued: false, expiresAt: null };
    }

    // approve：窗口从批准起算，时长取**行内存的档位**（用例注释里说明的分工）。
    const expiresAt =
      input.expiresAt ??
      new Date(input.now.getTime() + ORG_INVITE_LINK_EXPIRY_MS[row.expiry as OrgInviteLinkExpiryKind]);
    await s.query(
      `UPDATE org_invite_links
          SET status = 'active', reviewed_by = $2, reviewed_at = $3, expires_at = $4
        WHERE id = $1`,
      [row.id, input.reviewerId, input.now, expiresAt],
    );
    if (input.tokenHash !== null) {
      await s.query(
        `INSERT INTO org_invite_link_tokens (token_hash, link_id, org_id_hint, issued_at)
         VALUES ($1, $2, $3, $4)`,
        [input.tokenHash, row.id, input.orgId, input.now],
      );
    }
    return { ok: true, status: "active", tokenIssued: input.tokenHash !== null, expiresAt };
  }

  /* ─────────────────────────── 激活（匿名，一个事务） ─────────────────────────── */

  async activate(input: ActivateViaOrgInviteLinkInput): Promise<ActivateViaOrgInviteLinkResult> {
    try {
      const grant = await this.db.withoutTenant((s) => this.activateAll(s, input));
      return { ok: true, grant };
    } catch (e) {
      if (
        e instanceof Rollback &&
        (e.reason === "not-found" || e.reason === "already-member" || e.reason === "quota-exhausted")
      ) {
        return { ok: false, reason: e.reason };
      }
      throw e;
    }
  }

  private async activateAll(s: TenantSession, input: ActivateViaOrgInviteLinkInput) {
    // (1) 按 hash 找链接——无租户上下文（表不带租户键，迁移文件头）。
    //     待复核的链接在这里由构造拿到零行：token 行根本不存在。
    const tokenRes = await s.query<{ link_id: string; org_id_hint: string }>(
      `SELECT link_id, org_id_hint FROM org_invite_link_tokens WHERE token_hash = $1`,
      [input.tokenHash],
    );
    const tokenRow = tokenRes.rows[0];
    if (tokenRow === undefined) throw new Rollback("not-found");

    // (2) 切租户上下文。事务内、事务局部（set_config 第三参 true）。
    const orgId: OrgId = toOrgId(tokenRow.org_id_hint);
    await s.query("SELECT set_config('app.current_org', $1, true)", [orgId]);

    // (3) 🔴 授予的唯一来源 + 多次语义的串行点。FOR UPDATE 把并发加入串行在链接行上；
    //     状态 / 过期 / 上限三种失效在同一个 WHERE 之外逐条判——但都映射同一个
    //     Rollback("not-found")（V10：五种失效对外逐字节相同）。
    const linkRes = await s.query<{
      id: string;
      org_role: string;
      expires_at: Date | null;
      max_uses: number | null;
      used_count: number;
      status: string;
    }>(
      `SELECT id, org_role, expires_at, max_uses, used_count, status
         FROM org_invite_links WHERE id = $1 FOR UPDATE`,
      [tokenRow.link_id],
    );
    const link = linkRes.rows[0];
    if (link === undefined) throw new Rollback("not-found");
    // 与 domain 的 deriveOrgInviteLinkStatus 同一优先级（revoked > expired > exhausted）；
    // 测试断言两者不漂移。
    if (link.status !== "active") throw new Rollback("not-found");
    if (link.expires_at === null || link.expires_at.getTime() <= input.now.getTime()) {
      throw new Rollback("not-found");
    }
    if (link.max_uses !== null && Number(link.used_count) >= Number(link.max_uses)) {
      throw new Rollback("not-found");
    }

    // (4) I-9 配额硬闸（拍板①）：锁组织行再数座位——与 create@pg-org-invite-repository
    //     同一形状、同一"数出来不存出来"的账本纪律。
    const quota = await s.query<{ seat_quota: string }>(
      `SELECT seat_quota FROM organizations WHERE id = $1 FOR UPDATE`,
      [orgId],
    );
    const seatQuota = Number(quota.rows[0]?.seat_quota ?? 0);
    const usedMembers = await s.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM org_memberships WHERE org_id = $1`,
      [orgId],
    );
    const usedInvites = await s.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM org_invites
        WHERE org_id = $1 AND status IN ('pending', 'awaiting-review', 'send-failed')`,
      [orgId],
    );
    const usedSeats = Number(usedMembers.rows[0]?.n ?? 0) + Number(usedInvites.rows[0]?.n ?? 0);
    if (usedSeats >= seatQuota) throw new Rollback("quota-exhausted");

    // (5) 建号。邮箱查重靠 credentials 的唯一约束，不是先查后插（两步窗口下两路
    //     并发同邮箱都能查到「没有」）。已有账号 → already-member（OA12②：明确拒绝、
    //     不重复建号——本次 INSERT 已回滚，credentials 行数不变）。
    //
    // ⚠ email_verified_at 置为激活时刻：OA12① 的记录在案裁定（未验证账号在登录处
    //   是死路），风险边界见 delta contract.md「待人类确认点」。
    try {
      await s.query(
        `INSERT INTO credentials (user_id, email, display_name, password_hash, email_verified_at)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          input.newAccount.userId,
          input.email,
          input.newAccount.displayName,
          input.newAccount.passwordHash,
          input.now,
        ],
      );
    } catch (e) {
      if (uniqueViolationConstraint(e) !== null) throw new Rollback("already-member");
      throw e;
    }

    // (6) 🔴 授予。第 3 个参数恒来自 (3) 的 SELECT；team 恒 NULL（契约头注：共享链接
    //     不预分团队）。
    try {
      await s.query(
        `INSERT INTO org_memberships (user_id, org_id, org_role, team_id) VALUES ($1, $2, $3, NULL)`,
        [input.newAccount.userId, orgId, link.org_role],
      );
    } catch (e) {
      if (uniqueViolationConstraint(e) !== null) throw new Rollback("already-member");
      throw e;
    }

    // (7) 多次语义的账本：+1 在同一把锁里（文件头的理由）。**不核销 token**——
    //     它继续为下一个人服务，直到过期/作废/用满。
    await s.query(`UPDATE org_invite_links SET used_count = used_count + 1 WHERE id = $1`, [link.id]);

    // ⚠ 返回**只有授予值**：不含 created_by、不含计数、不含 email——
    //   ALLOWLIST 例外的前提（文件头），测试钉住。
    return { userId: input.newAccount.userId, orgId, orgRole: link.org_role };
  }
}
