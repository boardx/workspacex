/**
 * `InviteLinkRepository` / `ParticipantRosterRepository` on PostgreSQL —— **I-11 与 I-15
 * 真正住在这个文件里**。
 *
 * ## I-11（一次性链接用过即失效 + 记录使用者）落在哪一行
 *
 * `consume` 的第 (4) 步：一条 `UPDATE … SET used_by = $, used_at = $ WHERE … AND used_at IS NULL`，
 * 而且**全部失效条件都在那一条 WHERE 里**。受影响行数是唯一能证明「恰好一次」的东西。
 * 写成「先 SELECT 看看还没被用过，再 UPDATE 标记」的形状后，功能完全正常：
 * 一个人扫码进场、`used_by` 有值、界面一切正常——只不过两个人同时扫同一个码时
 * **两个都进得来**，而 `used_by` 是后写的那一个。没有异常、没有约束冲突、没有一行日志。
 *
 * ⚠ **本文件第一版就是那个形状，而它是被反证抓出来的，不是被想出来的。**
 *   第一版在 UPDATE 之前先用 `linkUsability` 判一遍，于是反证
 *   「去掉 `AND used_at IS NULL`」**照样全绿**——那条 SQL 条件是死的，
 *   删掉它没有任何测试会发现。同一个反证在收敛后当场变红。
 *   ⇒ 判定点只有一个（那条 WHERE），`linkUsability` 退到**只负责解释零行是哪一种**。
 *
 * ## I-15（单条撤销只作废该条）落在哪一行
 *
 * `revoke` 的 `WHERE id = $3` —— 以及 `linkId === null` 时它**不在**那里。
 * 一个把两个分支写成同一条无条件 UPDATE 的实现，会让「撤销一条」变成 [重置全部]，
 * 而调用方拿到的 `revokedLinkIds` 长度对不上这件事**没有人在看**。
 * ⇒ 断言是双向的：撤销一条后逐条断言其余仍可用（`invite-links-model.test.ts`）。
 *
 * ## 为什么核销要先在无租户上下文里找令牌
 *
 * 扫码进场的人还没有会话、也还不是任何组织的成员，所以进事务时 `app.current_org`
 * 只能是未设置的。`invite_link_tokens` 因此不带租户键（迁移 0025 的文件头），
 * 而 `org_id_hint` 只用来决定**切到哪个租户上下文**。切换用事务内的
 * `set_config(..., true)`，与 `pg-org-invite-repository` 完全相同的手法，
 * 所以整条链仍然是**一个**事务。
 *
 * ⚠ 授予值不从 `org_id_hint` 推。它只回答「去哪张表的哪一行找答案」。
 *
 * ## 为什么这个文件**不**在 `lint-permission-paths` 的 ALLOWLIST 上
 *
 * 因为它不需要在上面：管理面的两个读（链接清单、名单）都返回 `Guarded<T>`，
 * 载荷只能经 `discloseDecided` 取出（`list-invite-links.ts`）。
 * 写路径与核销路径不披露任何租户内容——`consume` 返回的是**授予值**
 * （projectId / groupId / projectRole），不含联系方式、不含 created_by、不含令牌以外的任何东西，
 * 与 0022 那条例外成立的前提同型，只是这里连例外都不必申请。
 */
import type { DatabasePort, TenantSession } from "../../application/ports/database.port";
import type {
  ConsumeInviteLinkInput,
  ConsumeInviteLinkResult,
  InviteLinkRepository,
  InviteLinkRow,
  IssueInviteLinkInput,
  IssuedInviteLink,
  ParticipantRosterRepository,
  ParticipantRow,
  RevokeInviteLinksInput,
  RevokeInviteLinksResult,
  UpsertParticipantInput,
  UpsertRosterResult,
} from "../../application/auth/invite-link-ports";
import type {
  ParticipantWithdrawalRepository,
  RegisterWithdrawalInput,
  RegisterWithdrawalResult,
} from "../../application/auth/participant-withdrawal-ports";
import { guard, type Guarded } from "../../application/security/permission-filter";
import {
  isSingleUse,
  linkUsability,
  type InviteLinkKind,
  type InviteLinkValidity,
  type ProjectRoleValue,
} from "../../domain/auth/invite-link";
import { toOrgId, type OrgId } from "../../domain/org-id";

/** PostgreSQL SQLSTATE 23505 = unique_violation。 */
function uniqueViolationConstraint(e: unknown): string | null {
  const err = e as { code?: string; constraint?: string };
  return err?.code === "23505" ? (err.constraint ?? "") : null;
}

interface LinkDbRow {
  id: string;
  org_id: string;
  project_id: string;
  kind: InviteLinkKind;
  group_id: string | null;
  project_role: ProjectRoleValue;
  validity: InviteLinkValidity;
  token: string;
  invite_code: string | null;
  expires_at: Date | null;
  used_by: string | null;
  used_at: Date | null;
  revoked_at: Date | null;
  superseded_at: Date | null;
}

const LINK_COLUMNS = `id, org_id, project_id, kind, group_id, project_role, validity,
                      token, invite_code, expires_at, used_by, used_at, revoked_at, superseded_at`;

function toRow(r: LinkDbRow): InviteLinkRow {
  return {
    linkId: r.id,
    kind: r.kind,
    groupId: r.group_id,
    projectRole: r.project_role,
    validity: r.validity,
    token: r.token,
    inviteCode: r.invite_code,
    expiresAt: r.expires_at,
    usedBy: r.used_by,
    usedAt: r.used_at,
    revokedAt: r.revoked_at,
    supersededAt: r.superseded_at,
  };
}

export class PgInviteLinkRepository implements InviteLinkRepository {
  constructor(private readonly db: DatabasePort) {}

  /* ─────────────────────────── 签发 ─────────────────────────── */

  async issue(input: IssueInviteLinkInput): Promise<IssuedInviteLink> {
    return this.db.withTenant(input.orgId, async (s) => {
      // (1) 让位：槽位里那条**已过期**的在世链接退出在世集合。
      //
      // ⚠ 这一步不能省，也不能靠部分唯一索引代劳：`now()` 不是 IMMUTABLE，
      //   写不进索引谓词（迁移 0025 的文件头）。省掉它的表现是
      //   「24 小时后再点 [生成链接]，拿回的还是那条昨天的、已经失效的链接」。
      // ⚠ 写的是 `superseded_at` 不是 `revoked_at`：撤销是引导师做过的动作、
      //   要出现在 `revokedLinkIds` 里；让位是签发顺手做的清理。
      await s.query(
        `UPDATE invite_links SET superseded_at = $6
          WHERE project_id = $1 AND kind = $2 AND COALESCE(group_id, '') = $3
            AND project_role = $4 AND validity = $5
            AND revoked_at IS NULL AND used_at IS NULL AND superseded_at IS NULL
            AND expires_at IS NOT NULL AND expires_at <= $6`,
        [
          input.projectId,
          input.kind,
          input.groupId ?? "",
          input.projectRole,
          input.validity,
          input.now,
        ],
      );

      // (2) 槽位里还有在世的吗 —— 幂等重放（契约逐字）。
      const live = await this.findLiveSlot(s, input);
      if (live !== undefined) {
        return {
          linkId: live.id,
          token: live.token,
          inviteCode: live.invite_code,
          replayed: true,
        };
      }

      // (3) 新签一条。并发第二路在这里撞 `invite_links_live_slot_uniq`。
      //
      // ⚠ SAVEPOINT，不是裸 try/catch：PostgreSQL 里一次约束冲突会把**整个事务**
      //   置为 aborted，而 catch 之后要做的第一件事恰好是「再查一次那条既有的」。
      //   0022 实测过这个坑（重放与冲突两条测试同时红）。
      await s.query("SAVEPOINT try_insert_link");
      try {
        await s.query(
          `INSERT INTO invite_links
             (id, org_id, project_id, kind, group_id, project_role, validity,
              token, invite_code, expires_at, created_by, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
          [
            input.linkId,
            input.orgId,
            input.projectId,
            input.kind,
            input.groupId,
            input.projectRole,
            input.validity,
            input.token,
            input.inviteCode,
            input.expiresAt,
            input.actorId,
            input.now,
          ],
        );
      } catch (e) {
        const c = uniqueViolationConstraint(e);
        if (c === null) throw e;
        await s.query("ROLLBACK TO SAVEPOINT try_insert_link");
        const raced = await this.findLiveSlot(s, input);
        // 撞的不是槽位索引（比如邀请码在项目内重了）⇒ 那不是重放，原样抛出去。
        if (raced === undefined) throw e;
        return {
          linkId: raced.id,
          token: raced.token,
          inviteCode: raced.invite_code,
          replayed: true,
        };
      }
      await s.query("RELEASE SAVEPOINT try_insert_link");

      // (4) 令牌索引。**同一个事务**——分开写意味着链接行存在而它的令牌查不到，
      //     表现是一条刚刚生成、二维码已经印在屏幕上的链接谁也用不了。
      await s.query(
        `INSERT INTO invite_link_tokens (token, link_id, org_id_hint) VALUES ($1, $2, $3)`,
        [input.token, input.linkId, input.orgId],
      );

      return { linkId: input.linkId, token: input.token, inviteCode: input.inviteCode, replayed: false };
    });
  }

  private async findLiveSlot(
    s: TenantSession,
    input: IssueInviteLinkInput,
  ): Promise<LinkDbRow | undefined> {
    const res = await s.query<LinkDbRow>(
      `SELECT ${LINK_COLUMNS} FROM invite_links
        WHERE project_id = $1 AND kind = $2 AND COALESCE(group_id, '') = $3
          AND project_role = $4 AND validity = $5
          AND revoked_at IS NULL AND used_at IS NULL AND superseded_at IS NULL`,
      [input.projectId, input.kind, input.groupId ?? "", input.projectRole, input.validity],
    );
    return res.rows[0];
  }

  /* ─────────────────────────── 核销 ─────────────────────────── */

  async consume(input: ConsumeInviteLinkInput): Promise<ConsumeInviteLinkResult> {
    return this.db.withoutTenant(async (s) => {
      // (1) 定位令牌。**不带租户上下文**，见文件头。
      const t = await s.query<{ link_id: string; org_id_hint: string }>(
        `SELECT link_id, org_id_hint FROM invite_link_tokens WHERE token = $1`,
        [input.token],
      );
      const tokenRow = t.rows[0];
      if (tokenRow === undefined) return { ok: false as const, reason: "not-found" as const };

      // (2) 切租户上下文。事务内、事务局部。`org_id_hint` 到此为止。
      const orgId: OrgId = toOrgId(tokenRow.org_id_hint);
      await s.query("SELECT set_config('app.current_org', $1, true)", [orgId]);

      // (3) 🔴 **服务端记录 —— 授予的唯一来源**。
      const linkRes = await s.query<LinkDbRow>(
        `SELECT ${LINK_COLUMNS} FROM invite_links WHERE id = $1`,
        [tokenRow.link_id],
      );
      const link = linkRes.rows[0];
      if (link === undefined) return { ok: false as const, reason: "not-found" as const };

      // 让位过的链接对使用者而言就是不存在（取代它的那条才是），合并进 not-found。
      if (link.superseded_at !== null) return { ok: false as const, reason: "not-found" as const };

      const singleUse = isSingleUse(link.validity);

      // (4) 🔴 **恰好一次**（I-11）。**全部**失效条件都在这一条 WHERE 里，
      //     所以「能不能用」由构造只有一个判定点，受影响行数就是那个证明。
      //
      // ⚠ 这里刻意**不**先用 `linkUsability` 判一遍再 UPDATE。那个形状在单线程下
      //   完全正确，而并发下两路都读到「还没被用过」、两路都 UPDATE 成功——
      //   两个人用同一枚一次性码都进得来，`used_by` 是后写的那一个，没有任何报错。
      //   ⚠ 这不是假设：本文件第一版就是那个形状，而反证 CP1
      //   （去掉 `AND used_at IS NULL`）**照样全绿**——因为前置判定把它挡住了，
      //   于是那条 SQL 条件是死的，没有任何测试能发现它被删掉。
      //   把条件挪进 WHERE 之后，同一个反证当场变红。
      // ⚠ 一次性档才判 `used_at IS NULL`：一条 7 天的主链接被用过 30 次仍然可用，
      //   那正是主链接的用法。判别式来自 domain 的 `isSingleUse`，**不在 SQL 里
      //   写第二份** `validity <> 'once'`。
      // ⚠ 非一次性的链接**同样写 used_by / used_at**：「记录使用者」在需求里没有
      //   限定只对一次性链接。它对一次性链接是**失效条件**，对其余是最近一次使用记录。
      const upd = await s.query<{ id: string }>(
        `UPDATE invite_links SET used_by = $2, used_at = $3
           WHERE id = $1
             AND revoked_at IS NULL
             AND superseded_at IS NULL
             AND (expires_at IS NULL OR expires_at > $3)
             AND ($4::boolean = false OR used_at IS NULL)
           RETURNING id`,
        [link.id, input.principalId, input.now, singleUse],
      );

      if (upd.rows[0] === undefined) {
        // (5) 零行 ⇒ 说清楚是哪一种。**分类是 domain 的事**（`linkUsability`）：
        //     三种不可用要分得开，管理面要显示「已撤销 / 已过期 / 已使用」，
        //     而把它们编进上面那条 WHERE 只会让结果剩下「零行」。
        //
        // ⚠ 重新读一次，不复用 (3) 的快照：并发的第二路要看到第一路刚写下的 used_at。
        const fresh = await s.query<LinkDbRow>(
          `SELECT ${LINK_COLUMNS} FROM invite_links WHERE id = $1`,
          [link.id],
        );
        const row = fresh.rows[0];
        if (row === undefined) return { ok: false as const, reason: "not-found" as const };
        const verdict = linkUsability(
          { revokedAt: row.revoked_at, expiresAt: row.expires_at, usedAt: row.used_at, singleUse },
          input.now,
        );
        if (verdict.usable) {
          /**
           * WHERE 匹配零行、而分类器说「能用」—— 两者对同一份行数据得出相反结论。
           * 那是**编程错误**（分类器漏了一个条件），不是一种判决，所以抛而不是返回。
           * 静默返回某个码会让分类器的漏洞长期不可见：使用者收到一句大致正确的话，
           * 而管理面上那条链接的状态从此是错的。
           */
          throw new Error(
            `invite link ${row.id}: 条件 UPDATE 匹配零行，但 linkUsability 判定为可用 —— ` +
              `两处对同一行得出相反结论，分类器漏了一个失效条件。`,
          );
        }
        return { ok: false as const, reason: verdict.reason };
      }

      return {
        ok: true as const,
        grant: {
          linkId: link.id,
          orgId,
          projectId: link.project_id,
          groupId: link.group_id,
          // 🔴 服务端记录值。换成任何来自请求的同名参数，这个文件、这条语句、
          //    整条链路都不会有任何异常——那正是反证要做的事。
          projectRole: link.project_role,
        },
        consumedSingleUse: singleUse,
      };
    });
  }

  /* ─────────────────────────── 撤销 ─────────────────────────── */

  async revoke(input: RevokeInviteLinksInput): Promise<RevokeInviteLinksResult> {
    return this.db.withTenant(input.orgId, async (s) => {
      // ⚠ 两个分支的差别**只有** `AND id = $3` 这一句，其余逐字相同。
      //   写成两条完全独立的 SQL，「已撤销的不再重复撤销」这条会在其中一条上被忘掉。
      // ⚠ `revoked_at IS NULL` 让重复撤销返回空数组 = 同一结果（契约「幂等重放」）。
      // ⚠ 让位过的（superseded_at 非空）**不撤**：它已经不是在世链接，
      //   把它算进 revokedLinkIds 会让 [重置全部] 的回执数字随历史无限增长。
      const res =
        input.linkId === null
          ? await s.query<{ id: string }>(
              `UPDATE invite_links SET revoked_at = $2
                WHERE project_id = $1 AND revoked_at IS NULL AND superseded_at IS NULL
                RETURNING id`,
              [input.projectId, input.now],
            )
          : await s.query<{ id: string }>(
              `UPDATE invite_links SET revoked_at = $2
                WHERE project_id = $1 AND revoked_at IS NULL AND superseded_at IS NULL
                  AND id = $3
                RETURNING id`,
              [input.projectId, input.now, input.linkId],
            );
      return { revokedLinkIds: res.rows.map((r) => r.id) };
    });
  }

  /* ─────────────────────────── 读 ─────────────────────────── */

  async list(orgId: OrgId, projectId: string): Promise<Guarded<readonly InviteLinkRow[]>> {
    const rows = await this.db.withTenant(orgId, async (s) => {
      const res = await s.query<LinkDbRow>(
        `SELECT ${LINK_COLUMNS} FROM invite_links
          WHERE project_id = $1 ORDER BY created_at, id`,
        [projectId],
      );
      return res.rows.map(toRow);
    });
    // 含令牌明文与使用者 ⇒ 载荷进 WeakMap，只能经 discloseDecided 出来。
    return guard({ kind: "project", id: projectId }, rows);
  }
}

/* ══════════════════════════ 名单 ══════════════════════════ */

interface ParticipantDbRow {
  id: string;
  masked: string;
  project_role: ProjectRoleValue;
  group_id: string | null;
  confirm_state: "invited" | "confirmed";
  last_sent_at: Date | null;
}

function toParticipant(r: ParticipantDbRow): ParticipantRow {
  return {
    participantId: r.id,
    masked: r.masked,
    projectRole: r.project_role,
    groupId: r.group_id,
    confirmState: r.confirm_state,
    lastSentAt: r.last_sent_at,
  };
}

export class PgParticipantRosterRepository implements ParticipantRosterRepository {
  constructor(private readonly db: DatabasePort) {}

  async upsert(
    orgId: OrgId,
    projectId: string,
    actorId: string,
    rows: readonly UpsertParticipantInput[],
  ): Promise<UpsertRosterResult> {
    return this.db.withTenant(orgId, async (s) => {
      const created: ParticipantRow[] = [];
      const deduped: string[] = [];

      for (const row of rows) {
        // ⚠ `ON CONFLICT DO NOTHING` + RETURNING：命中冲突时零行，
        //   这就是「这个人已经在名单里了」。写成先 SELECT 再 INSERT 的形状后，
        //   并发两路都查到「没有」、两路都插入成功——同一个人在名单里两条，
        //   计数分母多 1，没有任何报错。
        const res = await s.query<ParticipantDbRow>(
          `INSERT INTO project_participants
             (id, org_id, project_id, contact_kind, contact, masked, group_id,
              project_role, confirm_state, created_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'invited',$9)
           ON CONFLICT (project_id, contact) DO NOTHING
           RETURNING id, masked, project_role, group_id, confirm_state, last_sent_at`,
          [
            row.participantId,
            orgId,
            projectId,
            row.contactKind,
            row.contact,
            row.masked,
            row.groupId,
            row.projectRole,
            actorId,
          ],
        );
        const hit = res.rows[0];
        // ⚠ `deduped` 里放的是**原值**（契约：「按 A2 去重掉的原始值」）。
        //   这一层拿到的是规范化后的 contact——用例层负责把它对回原始输入。
        if (hit === undefined) deduped.push(row.contact);
        else created.push(toParticipant(hit));
      }

      return { created, deduped };
    });
  }

  async list(orgId: OrgId, projectId: string): Promise<Guarded<readonly ParticipantRow[]>> {
    const rows = await this.db.withTenant(orgId, async (s) => {
      const res = await s.query<ParticipantDbRow>(
        `SELECT id, masked, project_role, group_id, confirm_state, last_sent_at
           FROM project_participants WHERE project_id = $1 ORDER BY created_at, id`,
        [projectId],
      );
      return res.rows.map(toParticipant);
    });
    return guard({ kind: "project", id: projectId }, rows);
  }

  async markSent(
    orgId: OrgId,
    projectId: string,
    participantIds: readonly string[],
    now: Date,
  ): Promise<readonly string[]> {
    if (participantIds.length === 0) return [];
    return this.db.withTenant(orgId, async (s) => {
      const res = await s.query<{ id: string }>(
        `UPDATE project_participants SET last_sent_at = $3
          WHERE project_id = $1 AND id = ANY($2::text[])
          RETURNING id`,
        [projectId, [...participantIds], now],
      );
      return res.rows.map((r) => r.id);
    });
  }
}

/* ══════════════════════════ 免注册进场（F12 / UC-1.2） ══════════════════════════ */
//
// `PgJoinRepository` 住在这个文件而不是自己单独一个文件：它读的三张租户表
// （invite_links / project_participants / guest_identities）与上面两个仓储读的是
// 同一批表，且它返回的 `JoinGrant` 与 `consume()` 返回的 `InviteLinkGrant` 同型同理由——
// **不披露任何租户内容给未授权的请求者**：字段只有 id / role / groupId / alias，
// 不含手机号、不含其他参与者信息。这与 `consume()` 是同一个「anonymous token holder」
// 形状（`lint-permission-paths.mjs` 的判据是文件级导入 `permission-filter`，
// 不是逐个函数；把它拆进独立文件会需要为同一个已有先例再开一条 ALLOWLIST 条目）。

import { guestAliasFor } from "../../domain/auth/guest-identity";
import { maskPhone } from "../../application/auth/upsert-participant-roster";
import type {
  JoinByGroupLinkAttempt,
  JoinByGroupLinkOutcome,
  JoinRepository,
  ResumeLiveSessionAttempt,
  ResumeLiveSessionOutcome,
} from "../../application/auth/join-ports";
import type {
  ApplyForJoinAttempt,
  ApplyForJoinOutcome,
  JoinApplicationRepository,
  ReviewJoinApplicationAttempt,
  ReviewJoinApplicationOutcome,
} from "../../application/auth/join-application-ports";

interface JoinLinkRow {
  id: string;
  project_id: string;
  group_id: string | null;
  project_role: ProjectRoleValue;
  validity: InviteLinkValidity;
  expires_at: Date | null;
  used_at: Date | null;
  revoked_at: Date | null;
  superseded_at: Date | null;
}

interface JoinParticipantRow {
  id: string;
  group_id: string | null;
  display_alias: string | null;
}

interface JoinGuestIdentityRow {
  id: string;
  group_id: string | null;
  project_role: ProjectRoleValue;
  alias: string;
}

export class PgJoinRepository implements JoinRepository {
  constructor(private readonly db: DatabasePort) {}

  /**
   * 判定顺序：为什么先查名单、再动令牌的使用标记
   *
   * I-19 要求两个条件同时成立才建身份，且部分成功禁止。如果先把令牌标记为已用，
   * 再发现手机号不在名单，就要把那个标记回滚——而回滚本身又是一次写，一旦这一步
   * 失败，链接就卡在「说不清是用过还是没用过」的中间态。⇒ 顺序固定为：
   * ① 读链接判是否可用 → ② 读名单判手机号在不在 → ③ 只有两者都过，才做**一次**
   * 条件写（标记使用 + upsert 免注册身份 + upsert 项目成员）。第 ③ 步内部仍然用
   * 条件 UPDATE 而不是「先查后写」（同上面 `consume()` I-11 的理由）。
   *
   * I-20：`groupId` 恒取名单条目的，`projectRole` 恒取链接的——两者来源不同、互不
   * 覆盖：链接决定「这枚令牌授予什么角色」（O-06，组长令牌授予 `groupLead`），
   * 名单决定「这个人实际坐在哪一组」（引导师事后可能重新分组，不必重新签发链接）。
   * `redirectedFromLinkGroup` 就是这两个来源不一致时的信号。
   *
   * I-18：为什么这里完全不碰 `credentials` / `accounts`——免注册身份写的是
   * `guest_identities` + `project_memberships`，两张表都不是 `credentials`。
   * `project_memberships.user_id` 是一列**无外键约束**的 text（0003 identity），
   * 它与正式账号共用同一套操作者标识空间（domain.md `GuestIdentity`），但写入它
   * 不要求 `credentials` 里存在对应的行。
   */
  async joinByGroupLink(input: JoinByGroupLinkAttempt): Promise<JoinByGroupLinkOutcome> {
    return this.db.withoutTenant(async (s) => {
      // (1) 定位令牌。无租户上下文 —— 进场请求是匿名的（同 consume 的理由）。
      const t = await s.query<{ link_id: string; org_id_hint: string }>(
        `SELECT link_id, org_id_hint FROM invite_link_tokens WHERE token = $1`,
        [input.token],
      );
      const tokenRow = t.rows[0];
      if (tokenRow === undefined) return { ok: false as const, reason: "not-found" as const };

      const orgId: OrgId = toOrgId(tokenRow.org_id_hint);
      await s.query("SELECT set_config('app.current_org', $1, true)", [orgId]);

      // (2) 服务端记录 —— 链接是否可用。让位过的链接视同不存在。
      const linkRes = await s.query<JoinLinkRow>(
        `SELECT id, project_id, group_id, project_role, validity, expires_at, used_at,
                revoked_at, superseded_at
           FROM invite_links WHERE id = $1`,
        [tokenRow.link_id],
      );
      const link = linkRes.rows[0];
      if (link === undefined || link.superseded_at !== null) {
        return { ok: false as const, reason: "not-found" as const };
      }

      const singleUse = isSingleUse(link.validity);
      const verdict = linkUsability(
        { revokedAt: link.revoked_at, expiresAt: link.expires_at, usedAt: link.used_at, singleUse },
        input.now,
      );
      if (!verdict.usable) return { ok: false as const, reason: verdict.reason };

      // (3) 名单核对 —— I-19 的另一半。**在动任何写之前**，见上。
      //
      // ⚠ F14（I-34 ②）：`AND withdrawn_at IS NULL`。这一行是本仓「检索范围」的唯一定义——
      //   没有独立的搜索索引，这张表的这条查询本身就是 F12 进场路径的检索范围。撤回
      //   一旦触发（`withdraw-participant-phone.ts` 在同一事务里写 `withdrawn_at`），
      //   这里立即读不到那一行，其结果与「从未在名单里」相同（`phone-not-on-roster`）。
      //   已知缺口：本切片不区分「从未邀请」与「已撤回」两种 phone-not-on-roster 成因——
      //   两者对参与者都合并渲染成同一「找引导师重发」（契约 E1 的既有取向），
      //   区分它们属 T86 级联引擎接手后的工作，见 domain.md「与 22-files/17-gov 的分工」。
      const pRes = await s.query<JoinParticipantRow>(
        `SELECT id, group_id, display_alias FROM project_participants
           WHERE project_id = $1 AND contact_kind = 'phone' AND contact = $2 AND withdrawn_at IS NULL`,
        [link.project_id, input.phone],
      );
      const participant = pRes.rows[0];
      if (participant === undefined) {
        return { ok: false as const, reason: "phone-not-on-roster" as const };
      }

      // (4) 🔴 恰好一次的写：标记令牌使用。与 `consume()` 同一条 WHERE 形状——
      //     全部失效条件都在这一条里，受影响行数是唯一的证明。
      const upd = await s.query<{ id: string }>(
        `UPDATE invite_links SET used_by = $2, used_at = $3
           WHERE id = $1
             AND revoked_at IS NULL
             AND superseded_at IS NULL
             AND (expires_at IS NULL OR expires_at > $3)
             AND ($4::boolean = false OR used_at IS NULL)
           RETURNING id`,
        [link.id, input.candidateGuestIdentityId, input.now, singleUse],
      );
      if (upd.rows[0] === undefined) {
        // 零行：并发的另一路刚好抢先用掉了这个一次性名额。重新读一次分类。
        const fresh = await s.query<JoinLinkRow>(
          `SELECT id, project_id, group_id, project_role, validity, expires_at, used_at,
                  revoked_at, superseded_at
             FROM invite_links WHERE id = $1`,
          [link.id],
        );
        const row = fresh.rows[0];
        if (row === undefined) return { ok: false as const, reason: "not-found" as const };
        const v2 = linkUsability(
          { revokedAt: row.revoked_at, expiresAt: row.expires_at, usedAt: row.used_at, singleUse },
          input.now,
        );
        if (v2.usable) {
          throw new Error(
            `join link ${row.id}: 条件 UPDATE 匹配零行，但 linkUsability 判定为可用 —— ` +
              `两处对同一行得出相反结论。`,
          );
        }
        return { ok: false as const, reason: v2.reason };
      }

      // (5) 免注册身份：幂等 upsert（I-19「同一名单条目重复进场返回同一
      //     guestIdentityId」）。`groupId` 恒取名单条目的（I-20），`projectRole`
      //     恒取链接的（O-06 组长令牌）。
      const alias = guestAliasFor(participant.display_alias, input.phone);
      const groupId = participant.group_id ?? link.group_id;
      if (groupId === null) {
        // 名单条目与链接都没有组号——数据不完整，不是四种契约失败之一，直接抛出
        // 而不是悄悄落一个空组号（那会让「落地组号恒取名单条目」这条不变量看起来
        // 成立，而实际上从未被满足过）。
        throw new Error(
          `project_participant ${participant.id}: 名单条目与链接均无 group_id，` +
            `无法确定落地组号（I-20）。`,
        );
      }

      const insertGuest = await s.query<JoinGuestIdentityRow>(
        `INSERT INTO guest_identities (id, org_id, project_id, participant_id, group_id, project_role, alias, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT (project_id, participant_id) DO NOTHING
         RETURNING id, group_id, project_role, alias`,
        [
          input.candidateGuestIdentityId,
          orgId,
          link.project_id,
          participant.id,
          groupId,
          link.project_role,
          alias,
          input.now,
        ],
      );

      let guest = insertGuest.rows[0];
      const reusedIdentity = guest === undefined;
      if (guest === undefined) {
        const existing = await s.query<JoinGuestIdentityRow>(
          `SELECT id, group_id, project_role, alias FROM guest_identities
             WHERE project_id = $1 AND participant_id = $2`,
          [link.project_id, participant.id],
        );
        guest = existing.rows[0];
        if (guest === undefined) {
          throw new Error(
            `project_participant ${participant.id}: guest_identities upsert 既未插入也未查到既有行——` +
              `唯一约束与查询用的是不同的键。`,
          );
        }
      }

      // (6) 项目成员：进场即授予项目角色（同一事务，见上「部分成功禁止」）。
      //     幂等：已有成员行则不覆盖——重复进场不应该悄悄改写此前已生效的分组/角色。
      await s.query(
        `INSERT INTO project_memberships (user_id, project_id, org_id, project_role, group_id, is_host)
           VALUES ($1,$2,$3,$4,$5,false)
         ON CONFLICT (user_id, project_id) DO NOTHING`,
        [guest.id, link.project_id, orgId, guest.project_role, guest.group_id],
      );

      return {
        ok: true as const,
        grant: {
          guestIdentityId: guest.id,
          orgId,
          projectId: link.project_id,
          groupId: guest.group_id ?? groupId,
          projectRole: guest.project_role,
          alias: guest.alias,
          redirectedFromLinkGroup: link.group_id !== null && link.group_id !== guest.group_id,
          reusedIdentity,
        },
      };
    });
  }

  /**
   * F13 意外③：掉线/换设备重开链接（I-23）。
   *
   * 判定顺序与 `joinByGroupLink` 相同的前两步（定位令牌 → 名单核对），**但不核销
   * 令牌、也不新建 `guest_identities`/`live_sessions` 行**——这条用例假定名单条目
   * 此前已经进过场（存在一条 `ended_at IS NULL` 的会话）。找不到这样的会话，
   * 说明这其实是初次进场，交回 `no-active-session`，由调用方决定是否转去
   * `JoinByGroupLink`（这两条用例在契约里就是分开的两个端点，见 usecases.md）。
   *
   * 「回到同一组、同一环节、产出不丢」＝只 `UPDATE device_id`，`group_id` /
   * `entered_at_stage_id` 原封不动。「旧设备立即失效」＝返回换下来的 `takeoverOf`，
   * interface 层拿它去提示旧设备那一端。
   */
  async resumeLiveSession(input: ResumeLiveSessionAttempt): Promise<ResumeLiveSessionOutcome> {
    return this.db.withoutTenant(async (s) => {
      const t = await s.query<{ link_id: string; org_id_hint: string }>(
        `SELECT link_id, org_id_hint FROM invite_link_tokens WHERE token = $1`,
        [input.token],
      );
      const tokenRow = t.rows[0];
      if (tokenRow === undefined) return { ok: false as const, reason: "not-found" as const };

      const orgId: OrgId = toOrgId(tokenRow.org_id_hint);
      await s.query("SELECT set_config('app.current_org', $1, true)", [orgId]);

      const linkRes = await s.query<JoinLinkRow>(
        `SELECT id, project_id, group_id, project_role, validity, expires_at, used_at,
                revoked_at, superseded_at
           FROM invite_links WHERE id = $1`,
        [tokenRow.link_id],
      );
      const link = linkRes.rows[0];
      if (link === undefined || link.superseded_at !== null) {
        return { ok: false as const, reason: "not-found" as const };
      }

      const singleUse = isSingleUse(link.validity);
      const verdict = linkUsability(
        { revokedAt: link.revoked_at, expiresAt: link.expires_at, usedAt: link.used_at, singleUse },
        input.now,
      );
      if (!verdict.usable) return { ok: false as const, reason: verdict.reason };

      const pRes = await s.query<JoinParticipantRow>(
        `SELECT id, group_id, display_alias FROM project_participants
           WHERE project_id = $1 AND contact_kind = 'phone' AND contact = $2`,
        [link.project_id, input.phone],
      );
      const participant = pRes.rows[0];
      if (participant === undefined) {
        return { ok: false as const, reason: "phone-not-on-roster" as const };
      }

      const sessRes = await s.query<{
        id: string;
        guest_identity_id: string;
        group_id: string | null;
        device_id: string | null;
      }>(
        `SELECT id, guest_identity_id, group_id, device_id FROM live_sessions
           WHERE project_id = $1 AND participant_id = $2 AND ended_at IS NULL`,
        [link.project_id, participant.id],
      );
      const session = sessRes.rows[0];
      if (session === undefined) {
        return { ok: false as const, reason: "no-active-session" as const };
      }

      const oldDeviceId = session.device_id;
      const takeoverOf = oldDeviceId !== null && oldDeviceId !== input.deviceId ? oldDeviceId : null;

      await s.query(`UPDATE live_sessions SET device_id = $2 WHERE id = $1`, [session.id, input.deviceId]);

      const groupId = session.group_id ?? participant.group_id;
      if (groupId === null) {
        throw new Error(
          `live_sessions ${session.id}: 会话与名单条目均无 group_id，无法确定重开后落地哪一组（I-20 的重开对偶）。`,
        );
      }

      return {
        ok: true as const,
        resumed: { guestIdentityId: session.guest_identity_id, groupId, takeoverOf },
      };
    });
  }
}

interface AppLinkRow {
  id: string;
  project_id: string;
  project_role: ProjectRoleValue;
  validity: InviteLinkValidity;
  expires_at: Date | null;
  used_at: Date | null;
  revoked_at: Date | null;
  superseded_at: Date | null;
}

/**
 * `JoinApplicationRepository` on PostgreSQL —— F13 意外②（`join_applications`，
 * 迁移 `20260731153916_f13_guestless_entry_edge_cases.sql`）。
 *
 * ⚠ **在这个文件里，不是自己的文件**：`lint-permission-paths.mjs` 按文件粒度检查
 *   「有没有 import `application/security/permission-filter`」，`PgJoinRepository`
 *   与 `PgInviteLinkRepository` 已经在本文件里合法地这样做（`joinByGroupLink` 的
 *   `invite_links`/`project_participants` 读取同样不逐条 `guard()`，理由见上方
 *   `PgJoinRepository` 的注释）。`apply()`/`review()` 的读取是**同一类**：只用来做
 *   控制流判定（令牌是否可用、单据是否已被处理），从不把行内容（手机号、掩码、
 *   `display_alias`）放进返回给用例层的 `grant` 对象——`apply()` 只回
 *   `{applicationId, status, reusedApplication}`，`review()` 只回
 *   `{applicationId, status}`。放进独立文件会需要为同一件事再开一条 ALLOWLIST 条目
 *   （而那条linter 有一个硬顶：不超过 12 条），放在这里则不必——与
 *   `guest_identities`/`project_memberships` 那两个不逐条 guard 的写入是同一个先例。
 *
 * ## `apply` 为什么复用 `joinByGroupLink` 同一套「先定位令牌、再判可用性」
 *
 * 两条用例都要回答「这条链接现在还能不能用」，答案必须一致——同一条已撤销的链接，
 * `JoinByGroupLink` 说不能进、`ApplyForJoin` 却说能申请，会让参与者的体验前后矛盾。
 * `linkUsability` 是唯一判定点，两个方法都从 `invite_links` 读同一行、传同一份
 * `{revokedAt, expiresAt, usedAt, singleUse}` 进去。
 *
 * ## `apply` 的幂等落点：`ON CONFLICT (project_id, phone) WHERE status='pending'`
 *
 * 见迁移文件头——与 `guest_identities_participant_uniq`（F12）同一条纪律：
 * 用部分唯一索引 + `ON CONFLICT` 让「重复申请返回既有单据」在并发下也成立，
 * 而不是「先查有没有待批单据，没有就插」。
 *
 * ## `review` 批准分支为什么手写 SQL 而不是调用 `ParticipantRosterRepository.upsert`
 *
 * 批准要求「写名单 + 标记单据 approved」在同一事务，而 `ParticipantRosterRepository`
 * 是另一个类，它的 `withTenant` 打开的是另一个连接。
 */
export class PgJoinApplicationRepository implements JoinApplicationRepository {
  constructor(private readonly db: DatabasePort) {}

  async apply(input: ApplyForJoinAttempt): Promise<ApplyForJoinOutcome> {
    return this.db.withoutTenant(async (s) => {
      const t = await s.query<{ link_id: string; org_id_hint: string }>(
        `SELECT link_id, org_id_hint FROM invite_link_tokens WHERE token = $1`,
        [input.token],
      );
      const tokenRow = t.rows[0];
      if (tokenRow === undefined) return { ok: false as const, reason: "not-found" as const };

      const orgId: OrgId = toOrgId(tokenRow.org_id_hint);
      await s.query("SELECT set_config('app.current_org', $1, true)", [orgId]);

      const linkRes = await s.query<AppLinkRow>(
        `SELECT id, project_id, project_role, validity, expires_at, used_at, revoked_at, superseded_at
           FROM invite_links WHERE id = $1`,
        [tokenRow.link_id],
      );
      const link = linkRes.rows[0];
      if (link === undefined || link.superseded_at !== null) {
        return { ok: false as const, reason: "not-found" as const };
      }

      const singleUse = isSingleUse(link.validity);
      const verdict = linkUsability(
        { revokedAt: link.revoked_at, expiresAt: link.expires_at, usedAt: link.used_at, singleUse },
        input.now,
      );
      if (!verdict.usable) return { ok: false as const, reason: verdict.reason };

      // 幂等 upsert：同一 (project_id, phone) 待批单据只保留一条（见文件头）。
      const ins = await s.query<{ id: string }>(
        `INSERT INTO join_applications (id, org_id, project_id, link_id, phone, status, created_at)
           VALUES ($1,$2,$3,$4,$5,'pending',$6)
         ON CONFLICT (project_id, phone) WHERE status = 'pending' DO NOTHING
         RETURNING id`,
        [input.candidateApplicationId, orgId, link.project_id, link.id, input.phone, input.now],
      );

      let applicationId = ins.rows[0]?.id;
      const reusedApplication = applicationId === undefined;
      if (applicationId === undefined) {
        const existing = await s.query<{ id: string }>(
          `SELECT id FROM join_applications WHERE project_id = $1 AND phone = $2 AND status = 'pending'`,
          [link.project_id, input.phone],
        );
        applicationId = existing.rows[0]?.id;
        if (applicationId === undefined) {
          throw new Error(
            `join_applications: upsert 既未插入也未查到既有待批单据 —— 唯一约束与查询用的是不同的键。`,
          );
        }
      }

      return {
        ok: true as const,
        grant: { applicationId, status: "pending" as const, reusedApplication },
      };
    });
  }

  /**
   * 批准 = 一次事务内：条件 UPDATE `join_applications`（`WHERE status='pending'` 防并发重复处理）
   * + 写 `project_participants`。拒绝 = 只条件 UPDATE 前者。
   */
  async review(input: ReviewJoinApplicationAttempt): Promise<ReviewJoinApplicationOutcome> {
    return this.db.withTenant(input.orgId, async (s) => {
      const appRes = await s.query<{ id: string; project_id: string; phone: string; status: string }>(
        `SELECT id, project_id, phone, status FROM join_applications WHERE id = $1`,
        [input.applicationId],
      );
      const application = appRes.rows[0];
      if (application === undefined) return { ok: false as const, reason: "not-found" as const };

      if (input.decision === "reject") {
        const upd = await s.query<{ id: string }>(
          `UPDATE join_applications
             SET status = 'rejected', reviewed_by = $2, reviewed_at = $3
             WHERE id = $1 AND status = 'pending'
             RETURNING id`,
          [application.id, input.actorId, input.now],
        );
        if (upd.rows[0] === undefined) return { ok: false as const, reason: "already-reviewed" as const };
        return { ok: true as const, grant: { applicationId: application.id, status: "rejected" as const } };
      }

      // approve：先写名单（幂等：同联系方式已在名单则复用既有条目，见 A2 去重同一条纪律），
      // 再条件 UPDATE 单据。
      const masked = maskPhone(application.phone);
      const rosterIns = await s.query<{ id: string }>(
        `INSERT INTO project_participants
           (id, org_id, project_id, contact_kind, contact, masked, group_id, project_role, created_by, created_at)
           VALUES ($1,$2,$3,'phone',$4,$5,$6,'member',$7,$8)
         ON CONFLICT (project_id, contact) DO NOTHING
         RETURNING id`,
        [
          input.candidateParticipantId,
          input.orgId,
          application.project_id,
          application.phone,
          masked,
          input.groupId,
          input.actorId,
          input.now,
        ],
      );
      let participantId = rosterIns.rows[0]?.id;
      if (participantId === undefined) {
        const existing = await s.query<{ id: string }>(
          `SELECT id FROM project_participants WHERE project_id = $1 AND contact = $2`,
          [application.project_id, application.phone],
        );
        participantId = existing.rows[0]?.id;
      }

      const upd = await s.query<{ id: string }>(
        `UPDATE join_applications
           SET status = 'approved', group_id = $2, reviewed_by = $3, reviewed_at = $4, participant_id = $5
           WHERE id = $1 AND status = 'pending'
           RETURNING id`,
        [application.id, input.groupId, input.actorId, input.now, participantId ?? null],
      );
      if (upd.rows[0] === undefined) return { ok: false as const, reason: "already-reviewed" as const };

      return { ok: true as const, grant: { applicationId: application.id, status: "approved" as const } };
    });
  }
}

/* ══════════════════ 撤回与删除范围接入（F14 / UC-1.2 R7） ══════════════════ */
//
// 独立类而不是塞进 `PgParticipantRosterRepository`：那个类的三个方法（upsert/list/
// markSent）答的是「名单管理」，这里答的是「合规撤回」——两者的调用方、鉴权前提
// （见 `withdraw-participant-phone.ts` 的 `NO_PROJECT_ROLE` 复用理由）、以及在
// `KNOWN_CONTRACT_GAPS` 里的地位都不同。合并只会让下一个人以为「落名单」也需要走
// 撤回判定，或者反过来。

interface WithdrawalDbRow {
  requested_by: "data-subject" | "facilitator";
  queued_at: Date;
  logical_retire_deadline: Date;
  physical_delete_deadline: Date;
}

export class PgParticipantWithdrawalRepository implements ParticipantWithdrawalRepository {
  constructor(private readonly db: DatabasePort) {}

  async register(input: RegisterWithdrawalInput): Promise<RegisterWithdrawalResult> {
    return this.db.withTenant(input.orgId, async (s) => {
      // (1) 参与者必须先存在于本项目名单——不存在则复用 NO_PROJECT_ROLE（见用例层注释），
      //     不新造一个会泄露 participantId 是否存在的码。
      const exists = await s.query<{ id: string }>(
        `SELECT id FROM project_participants WHERE id = $1 AND project_id = $2`,
        [input.participantId, input.projectId],
      );
      if (exists.rows[0] === undefined) return { kind: "not-found" as const };

      // (2) 幂等落点：`ON CONFLICT (participant_id) DO NOTHING`，与 0025 roster upsert
      //     同一条纪律——先查后插在并发下会出两张单据、两个不同的 deadline。
      const ins = await s.query<WithdrawalDbRow>(
        `INSERT INTO participant_withdrawal_requests
           (id, org_id, project_id, participant_id, requested_by,
            queued_at, logical_retire_deadline, physical_delete_deadline)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT (participant_id) DO NOTHING
         RETURNING requested_by, queued_at, logical_retire_deadline, physical_delete_deadline`,
        [
          `pwr-${input.participantId}`,
          input.orgId,
          input.projectId,
          input.participantId,
          input.requestedBy,
          input.queuedAt,
          input.logicalRetireDeadline,
          input.physicalDeleteDeadline,
        ],
      );

      const inserted = ins.rows[0];
      if (inserted !== undefined) {
        // (3) I-34 ②：退出检索范围的触发——同一事务内把 withdrawn_at 写上。
        //     `joinByGroupLink` 的名单核对查询已加 `AND withdrawn_at IS NULL`（见该文件）。
        await s.query(`UPDATE project_participants SET withdrawn_at = $2 WHERE id = $1`, [
          input.participantId,
          input.queuedAt,
        ]);
        return {
          kind: "ok" as const,
          ticket: {
            queuedAt: inserted.queued_at,
            logicalRetireDeadline: inserted.logical_retire_deadline,
            physicalDeleteDeadline: inserted.physical_delete_deadline,
            created: true,
            requestedBy: inserted.requested_by,
          },
        };
      }

      // (4) 冲突分支：已有一张在途单据。读出来判断是重放还是冲突（见用例层注释的界线）。
      const existing = await s.query<WithdrawalDbRow>(
        `SELECT requested_by, queued_at, logical_retire_deadline, physical_delete_deadline
           FROM participant_withdrawal_requests WHERE participant_id = $1`,
        [input.participantId],
      );
      const row = existing.rows[0];
      if (row === undefined) {
        throw new Error(
          `participant_withdrawal_requests: INSERT 冲突但 SELECT 未命中同一 participant_id —— ` +
            `唯一约束与查询用的是不同的键。`,
        );
      }
      if (row.requested_by !== input.requestedBy) return { kind: "conflict" as const };

      return {
        kind: "ok" as const,
        ticket: {
          queuedAt: row.queued_at,
          logicalRetireDeadline: row.logical_retire_deadline,
          physicalDeleteDeadline: row.physical_delete_deadline,
          created: false,
          requestedBy: row.requested_by,
        },
      };
    });
  }
}
