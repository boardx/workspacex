/**
 * 通用项目邀请（#4787）—— `PgProjectInvitationRepository` 对真实 PostgreSQL 的断言
 * （装配同 `non-workshop-members-pg.test.ts`）。用例层的编排见 `project-invitations.test.ts`。
 *
 * ⚠ 本文件**未在本地执行**（切片规则：不起服务、不跑 PG；写好标明，CI 跑）。其中的 SQL 已另用
 *   进程内 PostgreSQL（pglite）+ 同一份迁移文件 + 仓储类本身核对过一遍（建表 / 重放幂等 / RLS / 部分唯一索引 /
 *   令牌轮换 / 激活 / 接受 / 限频 / 上限），但 pglite 不带 `kernel_apply_org_freeze_policies`、roles 与其余迁移，
 *   所以这里的断言仍以 CI 为准。
 *
 * 清理：`credentials` / `mail_outbox` / `email_verification_challenges` 没有 org_id 列，删 org 带不走；
 *   本文件用后缀 `@pinv.test` 的 DELETE 自己收敛（`cleanGlobal`）。
 *
 * 钉住：
 *   · 令牌只存哈希（库里没有明文）；重发 = 轮换令牌，旧令牌当场与「从未存在」不可分辨；
 *   · 邮箱邀请一次性 / 绑定邮箱；链接邀请可重复使用、至多一条在世链接（重置取代旧的）；
 *   · 接受：已登录老用户（在别的组织）⇒ 以 consultant 入项目所在组织 + 项目 collaborator；已在项目里的 owner 不被降级；
 *     邮箱不符拒绝；同一用户重复接受幂等；
 *   · 激活（匿名新用户）：邮箱邀请 ⇒ 账号已验证、邮箱取自邀请；链接邀请 ⇒ 账号未验证 + 验证邮件入队；
 *     邮箱已注册 ⇒ login-required 且整个事务回滚（不留半个账号）；
 *   · 座位配额：满了拒绝且回滚（邀请仍有效、不留账号）；归档项目拒绝；
 *   · 限频：每条最多 5 次、60 秒冷却；每日上限；跨租户读 / 撤销读成零行。
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { TransactionalMailError } from "../../src/application/notifications/transactional-mail-ports";
import {
  activateProjectInvitation,
  acceptProjectInvitation,
  previewProjectInvitation,
} from "../../src/application/project/accept-project-invitation";
import {
  createProjectInvitations,
  issueProjectInviteLink,
  listProjectInvitations,
  resendProjectInvitation,
  revokeProjectInvitation,
  type ManageProjectInvitationsDeps,
} from "../../src/application/project/manage-project-invitations";
import { toOrgId } from "../../src/domain/org-id";
import { LIMITS, RESEND_COOLDOWN_MS, hashInvitationToken } from "../../src/domain/project/project-invitation";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { appConfig } from "../../src/infrastructure/db/pg-config";
import { CountingDecisionIdFactory } from "../../src/infrastructure/identity/in-memory-session-store";
import { PgIdentityRepository } from "../../src/infrastructure/identity/pg-identity-repository";
import { PgNonWorkshopMemberRepository } from "../../src/infrastructure/project/pg-non-workshop-member-repository";
import { PgProjectInvitationRepository } from "../../src/infrastructure/project/pg-project-invitation-repository";
import { FakeProvenanceWriter } from "../support/role-view-fakes";
import { addCredential, addOrgMember, asApp, asOwner, ensureDatabase, migrateOnce, resetOrgs, seedOrg } from "../support/db";

const HOOK_TIMEOUT_MS = 120_000;
const ORG = "org-pinv";
const OTHER = "org-pinv-other";
const ORG_ID = toOrgId(ORG);
const OTHER_ID = toOrgId(OTHER);
const PROJECT = `${ORG}-p1`;
const PROJECT_2 = `${ORG}-p2`;
const OTHER_PROJECT = `${OTHER}-p1`;
const OWNER = "u-pinv-owner";
const EXISTING = "u-pinv-existing"; // 只在另一个组织里的老用户
const STRANGER = "u-pinv-stranger"; // 有账号、哪个组织都不在
const STRONG = "a-very-Strong-pass-2026!";

let db: PgDatabase;
let repo: PgProjectInvitationRepository;
let mailSent: { to: string; subject: string; text: string }[];
let mailFail: Error | null;
let nowMs: number;
let counter: number;
let deps: ManageProjectInvitationsDeps;
let provenance: FakeProvenanceWriter;
const now = () => new Date(nowMs);

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  db = new PgDatabase(appConfig());
  repo = new PgProjectInvitationRepository(db);
}, HOOK_TIMEOUT_MS);

async function cleanGlobal(): Promise<void> {
  await asOwner(async (c) => {
    await c.query("DELETE FROM mail_outbox WHERE recipient LIKE '%@pinv.test'");
    await c.query("DELETE FROM email_verification_challenges WHERE user_id IN (SELECT user_id FROM credentials WHERE email LIKE '%@pinv.test')");
    await c.query("DELETE FROM credentials WHERE email LIKE '%@pinv.test'");
  });
}

afterAll(async () => {
  await resetOrgs(ORG, OTHER);
  await cleanGlobal();
  await db?.close();
}, HOOK_TIMEOUT_MS);

beforeEach(async () => {
  await resetOrgs(ORG, OTHER);
  await cleanGlobal();
  await seedOrg({ orgId: ORG, projectId: PROJECT, projectKind: "general", groupNames: [], seatQuota: 50 });
  await asApp(ORG, async (c) => {
    await c.query("INSERT INTO projects (id, org_id, name, kind) VALUES ($1, $2, '第二个项目', 'general')", [PROJECT_2, ORG]);
    await c.query("INSERT INTO general_projects (id, org_id) VALUES ($1, $2)", [PROJECT_2, ORG]);
    await c.query("UPDATE projects SET name = '北极星项目' WHERE id = $1", [PROJECT]);
    await c.query("INSERT INTO general_project_members (user_id, project_id, org_id, role) VALUES ($1, $2, $3, 'owner')", [OWNER, PROJECT, ORG]);
  });
  await seedOrg({ orgId: OTHER, projectId: OTHER_PROJECT, projectKind: "general", groupNames: [], seatQuota: 50 });
  await addOrgMember(ORG, OWNER, "consultant", null);
  await addOrgMember(OTHER, EXISTING, "admin", null);
  await addCredential(OWNER, `${OWNER}@pinv.test`, "负责人甲");
  await addCredential(EXISTING, "existing@pinv.test", "老用户");
  await addCredential(STRANGER, "stranger@pinv.test", "路人");

  mailSent = [];
  mailFail = null;
  nowMs = Date.parse("2026-10-01T00:00:00Z");
  counter = 0;
  provenance = new FakeProvenanceWriter();
  deps = {
    identity: new PgIdentityRepository(db),
    ids: new CountingDecisionIdFactory(),
    members: new PgNonWorkshopMemberRepository(db),
    invitations: repo,
    mail: {
      async send(m) {
        if (mailFail !== null) throw mailFail;
        mailSent.push(m);
        return {};
      },
    },
    appPublicUrl: () => "https://app.test",
    now,
    newToken: () => `pinv-tok-${++counter}`,
  };
}, HOOK_TIMEOUT_MS);

const owner = (projectId = PROJECT) => ({ actorId: OWNER, orgId: ORG_ID, projectId });
const tokenOf = (n: number) => `pinv-tok-${n}`;
/** 最近一封邮件里的令牌（重发会多次取号，包括被限频拒绝的那几次，所以不按序号猜）。 */
const lastMailedToken = () => decodeURIComponent(/invite=([^\s]+)/.exec(mailSent[mailSent.length - 1]!.text)![1]!);
const lookup = (token: string, viewer: string | null = null) => repo.lookup(hashInvitationToken(token), now(), viewer);

async function rows<T extends Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
  return asOwner(async (c) => (await c.query<T>(sql, params)).rows);
}

const activateDeps = () => ({
  invitations: repo,
  hasher: { hash: async (p: string) => `$2b$12$${"b".repeat(40)}${p.length}`, verify: async () => true, verifyDummy: async () => false as const },
  sessions: { issue: async () => "bearer-pinv" } as never,
  tokens: { sessionId: () => "sess-pinv", opaqueToken: () => "o" },
  verificationTokens: {
    newChallengeId: () => `ch-pinv-${++counter}`,
    tokenForChallenge: (c: string) => `vt-${c}`,
    digest: (t: string) => `dg-${t}`,
    pendingProofForChallenge: (c: string) => c,
    challengeIdFromPendingProof: (p: string) => p,
  },
  provenance,
  now,
});

describe("PgProjectInvitationRepository（真实 PG）", () => {
  it("创建：令牌只存哈希；邮件里是明文链接；同一邮箱再邀请 ⇒ already_pending；已是成员 ⇒ already_member", async () => {
    const out = await createProjectInvitations(deps, { ...owner(), emails: ["New@Pinv.test", "bad", OWNER + "@pinv.test"] });
    expect(out.invitations.map((i) => i.outcome)).toEqual(["sent", "invalid_email", "already_member"]);
    expect(mailSent).toHaveLength(1);
    expect(mailSent[0]!.to).toBe("new@pinv.test");
    expect(mailSent[0]!.text).toContain(`https://app.test/projects/join?invite=${tokenOf(1)}`);
    const stored = await rows<{ token_hash: string; email: string; send_attempts: number; status: string; role: string }>(
      "SELECT token_hash, email, send_attempts, status, role FROM project_invitations WHERE project_id = $1",
      [PROJECT],
    );
    expect(stored).toEqual([{ token_hash: hashInvitationToken(tokenOf(1)), email: "new@pinv.test", send_attempts: 1, status: "pending", role: "collaborator" }]);
    expect(JSON.stringify(stored)).not.toContain(tokenOf(1));
    const again = await createProjectInvitations(deps, { ...owner(), emails: ["new@pinv.test"] });
    expect(again.invitations[0]!.outcome).toBe("already_pending");
    expect(mailSent).toHaveLength(1);
    expect(await rows("SELECT 1 FROM project_invitations WHERE project_id = $1", [PROJECT])).toHaveLength(1);
  });

  it("邮件发送失败可见：last_send_error 落库、列表返回；重发成功清掉它", async () => {
    mailFail = new TransactionalMailError("provider_http_400");
    const out = await createProjectInvitations(deps, { ...owner(), emails: ["rej@pinv.test"] });
    expect(out.invitations[0]).toMatchObject({ outcome: "send_failed", lastSendError: "MAIL_RECIPIENT_REJECTED" });
    const list = await listProjectInvitations(deps, owner());
    expect(list.invitations[0]).toMatchObject({ email: "rej@pinv.test", lastSendError: "MAIL_RECIPIENT_REJECTED", sendAttempts: 1, canResend: true });
    mailFail = null;
    nowMs += RESEND_COOLDOWN_MS + 1;
    const re = await resendProjectInvitation(deps, { ...owner(), invitationId: out.invitations[0]!.invitationId! });
    expect(re).toMatchObject({ outcome: "sent", lastSendError: null, sendAttempts: 2 });
    const after = await listProjectInvitations(deps, owner());
    expect(after.invitations[0]!.lastSendError).toBeNull();
  });

  it("重发：60 秒冷却、最多 5 次；轮换令牌后旧令牌与「从未存在」不可分辨；过期 / 撤销后不可重发", async () => {
    const out = await createProjectInvitations(deps, { ...owner(), emails: ["r@pinv.test"] });
    const id = out.invitations[0]!.invitationId!;
    const oldToken = tokenOf(1);
    await expect(resendProjectInvitation(deps, { ...owner(), invitationId: id })).rejects.toMatchObject({ reasonCode: "RESEND_TOO_SOON" });
    for (let i = 0; i < LIMITS.maxSendsPerInvitation - 1; i++) {
      nowMs += RESEND_COOLDOWN_MS + 1;
      await resendProjectInvitation(deps, { ...owner(), invitationId: id });
    }
    expect(await rows<{ send_attempts: number }>("SELECT send_attempts FROM project_invitations WHERE id = $1", [id])).toEqual([{ send_attempts: 5 }]);
    nowMs += RESEND_COOLDOWN_MS + 1;
    await expect(resendProjectInvitation(deps, { ...owner(), invitationId: id })).rejects.toMatchObject({ reasonCode: "RESEND_LIMIT_REACHED" });
    // 旧令牌已失效；最新的邮件令牌有效。
    expect((await lookup(oldToken)).valid).toBe(false);
    expect((await lookup(oldToken))).toEqual(await lookup("never-existed"));
    const latest = lastMailedToken();
    expect(latest).not.toBe(oldToken);
    expect((await lookup(latest)).valid).toBe(true);
    // 撤销后不可重发；撤销幂等。
    await revokeProjectInvitation(deps, { ...owner(), invitationId: id });
    await expect(revokeProjectInvitation(deps, { ...owner(), invitationId: id })).resolves.toMatchObject({ status: "revoked" });
    await expect(resendProjectInvitation(deps, { ...owner(), invitationId: id })).rejects.toMatchObject({ reasonCode: "INVITATION_NOT_RESENDABLE" });
    expect((await lookup(latest)).valid).toBe(false);
    await expect(resendProjectInvitation(deps, { ...owner(), invitationId: "nope" })).rejects.toMatchObject({ reasonCode: "INVITATION_NOT_FOUND" });
  });

  it("过期：7 天后令牌失效、列表派生 expired、重发 ⇒ INVITATION_EXPIRED；再邀请同一邮箱可以新建", async () => {
    const out = await createProjectInvitations(deps, { ...owner(), emails: ["e@pinv.test"] });
    const id = out.invitations[0]!.invitationId!;
    nowMs += LIMITS.ttlDays * 86_400_000 + 1;
    expect((await lookup(tokenOf(1))).valid).toBe(false);
    const list = await listProjectInvitations(deps, owner());
    expect(list.invitations[0]!.status).toBe("expired");
    await expect(resendProjectInvitation(deps, { ...owner(), invitationId: id })).rejects.toMatchObject({ reasonCode: "INVITATION_EXPIRED" });
    const fresh = await createProjectInvitations(deps, { ...owner(), emails: ["e@pinv.test"] });
    expect(fresh.invitations[0]!.outcome).toBe("sent");
    expect(fresh.invitations[0]!.invitationId).not.toBe(id);
    expect(await rows<{ status: string }>("SELECT status FROM project_invitations WHERE id = $1", [id])).toEqual([{ status: "expired" }]);
  });

  it("链接邀请：至多一条在世链接，重置取代旧的；链接可重复使用；邮箱邀请一次性", async () => {
    const a = await issueProjectInviteLink(deps, owner());
    const tokenA = a.inviteUrl.split("invite=")[1]!;
    const b = await issueProjectInviteLink(deps, owner());
    const tokenB = b.inviteUrl.split("invite=")[1]!;
    expect(b.replacedInvitationId).toBe(a.invitationId);
    expect((await lookup(tokenA)).valid).toBe(false);
    expect((await lookup(tokenB)).valid).toBe(true);
    expect(await rows("SELECT 1 FROM project_invitations WHERE project_id = $1 AND kind = 'link' AND status = 'pending'", [PROJECT])).toHaveLength(1);
    // 链接可重复使用：两个不同的人各接受一次，链接仍有效。
    await acceptProjectInvitation({ invitations: repo, now }, { token: tokenB, userId: STRANGER });
    await acceptProjectInvitation({ invitations: repo, now }, { token: tokenB, userId: EXISTING });
    expect((await lookup(tokenB)).valid).toBe(true);
  });

  it("接受（已登录）：别的组织的老用户 ⇒ 以 consultant 入项目所在组织 + 项目 collaborator；邮箱不符拒绝；重复接受幂等", async () => {
    await createProjectInvitations(deps, { ...owner(), emails: ["existing@pinv.test", "someone@pinv.test"] });
    const forExisting = tokenOf(1);
    // 发给别人的邮箱，stranger 拿去用 ⇒ 邮箱不符（不因此核销）。
    await expect(acceptProjectInvitation({ invitations: repo, now }, { token: forExisting, userId: STRANGER })).rejects.toMatchObject({
      reasonCode: "INVITATION_EMAIL_MISMATCH",
    });
    const preview = await previewProjectInvitation({ invitations: repo, now }, { token: forExisting, viewerUserId: EXISTING });
    expect(preview).toMatchObject({ valid: true, nextStep: "accept", invitedEmail: "existing@pinv.test", projectName: "北极星项目", inviterName: "负责人甲" });
    const out = await acceptProjectInvitation({ invitations: repo, provenance, now }, { token: forExisting, userId: EXISTING });
    expect(out).toEqual({ projectId: PROJECT, orgId: ORG, joinedOrg: true, alreadyMember: false });
    expect(await rows("SELECT org_role FROM org_memberships WHERE user_id = $1 AND org_id = $2", [EXISTING, ORG])).toEqual([{ org_role: "consultant" }]);
    expect(await rows("SELECT role FROM general_project_members WHERE user_id = $1 AND project_id = $2", [EXISTING, PROJECT])).toEqual([{ role: "collaborator" }]);
    // 他在另一个组织里原有的角色不动。
    expect(await rows("SELECT org_role FROM org_memberships WHERE user_id = $1 AND org_id = $2", [EXISTING, OTHER])).toEqual([{ org_role: "admin" }]);
    expect(provenance.appended.map((e) => e.detail.op)).toEqual(["org-member-joined-via-project-invitation", "project-invitation-accepted"]);
    // 同一用户重复接受：幂等。其他人再用同一枚邮箱邀请：无效。
    await expect(acceptProjectInvitation({ invitations: repo, now }, { token: forExisting, userId: EXISTING })).resolves.toMatchObject({
      alreadyMember: true,
      joinedOrg: false,
    });
    await expect(acceptProjectInvitation({ invitations: repo, now }, { token: forExisting, userId: STRANGER })).rejects.toMatchObject({
      reasonCode: "INVITATION_INVALID",
    });
    expect((await lookup(forExisting)).valid).toBe(false);
  });

  it("接受：已在项目里的 owner 不被降级", async () => {
    const link = await issueProjectInviteLink(deps, owner());
    const out = await acceptProjectInvitation({ invitations: repo, now }, { token: link.inviteUrl.split("invite=")[1]!, userId: OWNER });
    expect(out).toMatchObject({ alreadyMember: true, joinedOrg: false });
    expect(await rows("SELECT role FROM general_project_members WHERE user_id = $1 AND project_id = $2", [OWNER, PROJECT])).toEqual([{ role: "owner" }]);
  });

  it("激活（邮箱邀请）：账号已验证、邮箱取自邀请（请求里的邮箱被忽略）、consultant + collaborator；令牌一次性", async () => {
    await createProjectInvitations(deps, { ...owner(), emails: ["fresh@pinv.test"] });
    const pv = await previewProjectInvitation({ invitations: repo, now }, { token: tokenOf(1), viewerUserId: null });
    expect(pv).toMatchObject({ valid: true, kind: "email", nextStep: "register", invitedEmail: "fresh@pinv.test" });
    const out = await activateProjectInvitation(activateDeps(), { token: tokenOf(1), name: "新人", password: STRONG, email: "ignored@pinv.test" });
    expect(out).toMatchObject({ orgId: ORG, projectId: PROJECT, verificationRequired: false, sessionId: "sess-pinv" });
    const cred = await rows<{ email: string; email_verified_at: Date | null; display_name: string }>(
      "SELECT email, email_verified_at, display_name FROM credentials WHERE user_id = $1",
      [out.userId],
    );
    expect(cred[0]).toMatchObject({ email: "fresh@pinv.test", display_name: "新人" });
    expect(cred[0]!.email_verified_at).not.toBeNull();
    expect(await rows("SELECT org_role FROM org_memberships WHERE user_id = $1 AND org_id = $2", [out.userId, ORG])).toEqual([{ org_role: "consultant" }]);
    expect(await rows("SELECT role FROM general_project_members WHERE user_id = $1 AND project_id = $2", [out.userId, PROJECT])).toEqual([{ role: "collaborator" }]);
    expect(await rows("SELECT 1 FROM mail_outbox WHERE recipient = 'fresh@pinv.test'")).toHaveLength(0);
    await expect(activateProjectInvitation(activateDeps(), { token: tokenOf(1), name: "x", password: STRONG, email: null })).rejects.toMatchObject({
      reasonCode: "INVITATION_INVALID",
    });
  });

  it("激活（链接邀请）：邮箱自填、账号未验证、不发会话、验证邮件同事务入队；链接仍有效", async () => {
    const link = await issueProjectInviteLink(deps, owner());
    const token = link.inviteUrl.split("invite=")[1]!;
    await expect(activateProjectInvitation(activateDeps(), { token, name: "链接人", password: STRONG, email: null })).rejects.toMatchObject({
      reasonCode: "EMAIL_REQUIRED",
    });
    const out = await activateProjectInvitation(activateDeps(), { token, name: "链接人", password: STRONG, email: "Linked@Pinv.test" });
    expect(out).toMatchObject({ verificationRequired: true, sessionId: null, session: null, orgId: ORG });
    const cred = await rows<{ email_verified_at: Date | null }>("SELECT email_verified_at FROM credentials WHERE user_id = $1", [out.userId]);
    expect(cred[0]!.email_verified_at).toBeNull();
    expect(await rows("SELECT template FROM mail_outbox WHERE recipient = 'linked@pinv.test'")).toEqual([{ template: "email-verification" }]);
    expect(await rows("SELECT 1 FROM email_verification_challenges WHERE user_id = $1", [out.userId])).toHaveLength(1);
    expect((await lookup(token)).valid).toBe(true);
  });

  it("激活：邮箱已注册 ⇒ LOGIN_REQUIRED 且整个事务回滚（不留账号 / 成员 / 已核销的邀请）", async () => {
    await createProjectInvitations(deps, { ...owner(), emails: ["stranger@pinv.test"] });
    const before = (await rows<{ n: string }>("SELECT count(*)::text AS n FROM org_memberships WHERE org_id = $1", [ORG]))[0]!.n;
    await expect(activateProjectInvitation(activateDeps(), { token: tokenOf(1), name: "x", password: STRONG, email: null })).rejects.toMatchObject({
      reasonCode: "LOGIN_REQUIRED",
    });
    expect((await rows<{ n: string }>("SELECT count(*)::text AS n FROM org_memberships WHERE org_id = $1", [ORG]))[0]!.n).toBe(before);
    expect((await lookup(tokenOf(1))).valid).toBe(true);
    // 预览据此给出「去登录」。
    expect(await previewProjectInvitation({ invitations: repo, now }, { token: tokenOf(1), viewerUserId: null })).toMatchObject({ nextStep: "login" });
  });

  it("座位配额：满了 ⇒ SEAT_QUOTA_EXHAUSTED 且回滚（邀请仍有效、不留账号）", async () => {
    await createProjectInvitations(deps, { ...owner(), emails: ["quota@pinv.test", "existing@pinv.test"] });
    const used = (await rows<{ n: string }>("SELECT count(*)::text AS n FROM org_memberships WHERE org_id = $1", [ORG]))[0]!.n;
    await asOwner((c) => c.query("UPDATE organizations SET seat_quota = $2 WHERE id = $1", [ORG, Number(used)]));
    await expect(activateProjectInvitation(activateDeps(), { token: tokenOf(1), name: "x", password: STRONG, email: null })).rejects.toMatchObject({
      reasonCode: "SEAT_QUOTA_EXHAUSTED",
    });
    expect(await rows("SELECT 1 FROM credentials WHERE email = 'quota@pinv.test'")).toHaveLength(0);
    await expect(acceptProjectInvitation({ invitations: repo, now }, { token: tokenOf(2), userId: EXISTING })).rejects.toMatchObject({
      reasonCode: "SEAT_QUOTA_EXHAUSTED",
    });
    expect((await lookup(tokenOf(1))).valid).toBe(true);
    expect((await lookup(tokenOf(2))).valid).toBe(true);
    // 已是该组织成员的人不占新座位：owner 接受链接不受配额影响。
    const link = await issueProjectInviteLink(deps, owner());
    await expect(acceptProjectInvitation({ invitations: repo, now }, { token: link.inviteUrl.split("invite=")[1]!, userId: OWNER })).resolves.toMatchObject({
      alreadyMember: true,
    });
  });

  it("归档项目：创建 / 签发 ⇒ PROJECT_ARCHIVED；已发出的邀请接受 / 激活 ⇒ PROJECT_ARCHIVED 且回滚；撤销仍可", async () => {
    const out = await createProjectInvitations(deps, { ...owner(), emails: ["arch@pinv.test", "existing@pinv.test"] });
    await asApp(ORG, (c) => c.query("UPDATE projects SET status = 'archived' WHERE id = $1", [PROJECT]));
    await expect(createProjectInvitations(deps, { ...owner(), emails: ["x@pinv.test"] })).rejects.toMatchObject({ reasonCode: "PROJECT_ARCHIVED" });
    await expect(issueProjectInviteLink(deps, owner())).rejects.toMatchObject({ reasonCode: "PROJECT_ARCHIVED" });
    await expect(activateProjectInvitation(activateDeps(), { token: tokenOf(1), name: "x", password: STRONG, email: null })).rejects.toMatchObject({
      reasonCode: "PROJECT_ARCHIVED",
    });
    await expect(acceptProjectInvitation({ invitations: repo, now }, { token: tokenOf(2), userId: EXISTING })).rejects.toMatchObject({
      reasonCode: "PROJECT_ARCHIVED",
    });
    expect(await rows("SELECT 1 FROM credentials WHERE email = 'arch@pinv.test'")).toHaveLength(0);
    await expect(revokeProjectInvitation(deps, { ...owner(), invitationId: out.invitations[0]!.invitationId! })).resolves.toMatchObject({ status: "revoked" });
  });

  it("每日上限：按项目、24 小时窗口；整批超限整体拒绝、一条都不建；窗口过去后恢复", async () => {
    const mk = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => `${prefix}${i}@pinv.test`);
    await createProjectInvitations(deps, { ...owner(), emails: mk("a", 20) });
    await createProjectInvitations(deps, { ...owner(), emails: mk("b", 20) });
    await createProjectInvitations(deps, { ...owner(), emails: mk("c", 10) }); // 正好 50
    await expect(createProjectInvitations(deps, { ...owner(), emails: mk("d", 1) })).rejects.toMatchObject({ reasonCode: "DAILY_CAP_REACHED" });
    await expect(issueProjectInviteLink(deps, owner())).rejects.toMatchObject({ reasonCode: "DAILY_CAP_REACHED" });
    expect(await rows("SELECT 1 FROM project_invitations WHERE project_id = $1", [PROJECT])).toHaveLength(LIMITS.dailyCapPerProject);
    // 另一个项目不受影响。
    await asApp(ORG, (c) =>
      c.query("INSERT INTO general_project_members (user_id, project_id, org_id, role) VALUES ($1, $2, $3, 'owner')", [OWNER, PROJECT_2, ORG]),
    );
    await expect(createProjectInvitations(deps, { ...owner(PROJECT_2), emails: mk("e", 1) })).resolves.toBeDefined();
    nowMs += 24 * 3_600_000 + 1;
    await expect(createProjectInvitations(deps, { ...owner(), emails: mk("f", 1) })).resolves.toBeDefined();
  });

  it("权限与跨租户：collaborator 不能管邀请；另一组织读 / 撤销读成零行（RLS + org_id 谓词）", async () => {
    const out = await createProjectInvitations(deps, { ...owner(), emails: ["t@pinv.test"] });
    const id = out.invitations[0]!.invitationId!;
    await asApp(ORG, (c) =>
      c.query("INSERT INTO general_project_members (user_id, project_id, org_id, role) VALUES ($1, $2, $3, 'collaborator')", [STRANGER, PROJECT, ORG]),
    );
    await addOrgMember(ORG, STRANGER, "consultant", null);
    await expect(listProjectInvitations(deps, { ...owner(), actorId: STRANGER })).rejects.toMatchObject({ reasonCode: "PROJECT_ROLE_INSUFFICIENT" });
    await expect(createProjectInvitations(deps, { ...owner(), actorId: STRANGER, emails: ["y@pinv.test"] })).rejects.toMatchObject({
      reasonCode: "PROJECT_ROLE_INSUFFICIENT",
    });
    // 另一组织的人拿本组织的项目 id / 邀请 id 来撤销：仓储读成零行。
    expect(await repo.revoke({ orgId: OTHER_ID, projectId: PROJECT, invitationId: id })).toBe("not-found");
    expect(await rows<{ status: string }>("SELECT status FROM project_invitations WHERE id = $1", [id])).toEqual([{ status: "pending" }]);
    await expect(listProjectInvitations(deps, { actorId: EXISTING, orgId: OTHER_ID, projectId: PROJECT })).rejects.toMatchObject({
      reasonCode: "NO_PROJECT_ROLE",
    });
  });

  it("令牌索引表无租户键：无会话也能按哈希定位租户；令牌行随邀请删除一并级联", async () => {
    await createProjectInvitations(deps, { ...owner(), emails: ["idx@pinv.test"] });
    const idx = await rows<{ org_id_hint: string }>("SELECT org_id_hint FROM project_invitation_tokens WHERE token_hash = $1", [hashInvitationToken(tokenOf(1))]);
    expect(idx).toEqual([{ org_id_hint: ORG }]);
    // 用 app_rw 角色、不设租户读索引表：能读到（它本来就不带租户键），但读不到邀请行本身。
    const asAnon = await asApp(null, async (c) => ({
      tokens: (await c.query("SELECT token_hash FROM project_invitation_tokens")).rows.length,
      invitations: (await c.query("SELECT id FROM project_invitations")).rows.length,
    }));
    expect(asAnon.tokens).toBeGreaterThan(0);
    expect(asAnon.invitations).toBe(0);
  });
});
