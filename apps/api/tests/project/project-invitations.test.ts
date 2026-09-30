/**
 * 通用项目邀请（#4787）八个用例的**编排**断言，喂可编排的假仓储 / 假邮件（同 `non-workshop-members.test.ts`
 * 的做法）。SQL 那一侧（令牌索引、租户切换、限频占位、部分唯一索引、RLS、座位配额）由
 * `project-invitations-pg.test.ts` 对真实 PostgreSQL 断言。
 *
 * 钉住：
 *   · 负责人门 = `addNonWorkshopMember` 的门：owner 放行；collaborator ⇒ PROJECT_ROLE_INSUFFICIENT；
 *     外人 ⇒ NO_PROJECT_ROLE；空 owner 时组织 lead 可当第一位；归档 ⇒ PROJECT_ARCHIVED（撤销 / 列表不挡归档）；
 *   · 创建：逐邮箱各自成败、批内去重、非法邮箱不落库、超每日上限整体拒绝；邮件发送失败**可见**
 *     （outcome=send_failed + 归类码，并回写仓储），不抛错、不丢邀请；
 *   · 邮件：中文正文、`?invite=` 链接、令牌明文只进邮件、只有哈希交给仓储；
 *   · 重发：仓储的五种拒绝各映射到自己的码；限频带 retryAfterSeconds；成功后 remainingSends 正确；
 *   · 预览：失效 ⇒ valid:false 且其余全 null；按会话 / 邮箱账号给出 nextStep；
 *   · 接受 / 激活：仓储拒绝原因逐一映射；激活口令策略先于查库；链接邀请不发会话；邮箱邀请发会话；
 *     请求里的邮箱对邮箱邀请无影响（只传给仓储 linkEmail，由仓储取邀请行里的邮箱）；
 *   · `addNonWorkshopMember` 之后的通知：尽力而为——通知抛错不让加人失败；自己加自己不通知。
 */
import { describe, expect, it } from "vitest";
import { projectInvitation as C } from "@repo/contracts";
import {
  createProjectInvitations,
  issueProjectInviteLink,
  listProjectInvitations,
  resendProjectInvitation,
  revokeProjectInvitation,
  type ManageProjectInvitationsDeps,
} from "../../src/application/project/manage-project-invitations";
import {
  acceptProjectInvitation,
  activateProjectInvitation,
  previewProjectInvitation,
} from "../../src/application/project/accept-project-invitation";
import { addNonWorkshopMember } from "../../src/application/project/add-non-workshop-member";
import { TransactionalMailError } from "../../src/application/notifications/transactional-mail-ports";
import type {
  AcceptInvitationResult,
  ActivateInvitationCmd,
  ActivateInvitationResult,
  InvitationListRow,
  InvitationLookup,
  IssueLinkCmd,
  IssueLinkResult,
  PrepareEmailInvitationsCmd,
  PrepareEmailInvitationsResult,
  PrepareResendCmd,
  PrepareResendResult,
  ProjectInvitationRepository,
  RevokeInvitationResult,
} from "../../src/application/project/project-invitation-ports";
import type {
  NonWorkshopContainer,
  NonWorkshopKind,
  NonWorkshopMemberRepository,
  NonWorkshopMemberRole,
  NonWorkshopStanding,
  UpsertNonWorkshopMemberOutcome,
} from "../../src/application/project/non-workshop-member-ports";
import { PasswordPolicyError } from "../../src/application/auth/errors";
import { guard } from "../../src/application/security/permission-filter";
import { hashInvitationToken, LIMITS } from "../../src/domain/project/project-invitation";
import { toOrgId, type OrgId } from "../../src/domain/org-id";
import { FakeDecisionIds, FakeProvenanceWriter, FakeRoleViewRepository } from "../support/role-view-fakes";

const ORG = toOrgId("org-inv");
const PROJECT = "p-inv";
const ARCHIVED = "p-inv-archived";
const NOW = new Date("2026-10-01T00:00:00Z");

/* ───────────────────────── 假件 ───────────────────────── */

class FakeMembers {
  readonly containers = new Map<string, NonWorkshopContainer>([
    [PROJECT, { kind: "general", status: "active" }],
    [ARCHIVED, { kind: "general", status: "archived" }],
  ]);
  readonly owners = new Set<string>(["u-owner"]);
  readonly collaborators = new Set<string>(["u-collab"]);
  hasOwner = true;
  async findContainer(_o: OrgId, projectId: string) {
    return this.containers.get(projectId) ?? null;
  }
  async findStanding(_o: OrgId, _p: string, _k: NonWorkshopKind, userId: string): Promise<NonWorkshopStanding> {
    const memberRole: NonWorkshopMemberRole | null = this.owners.has(userId) ? "owner" : this.collaborators.has(userId) ? "collaborator" : null;
    return { memberRole, containerHasOwner: this.hasOwner };
  }
  async upsertMember(): Promise<UpsertNonWorkshopMemberOutcome> {
    return { kind: "written", role: "collaborator" };
  }
  async listMembers(_o: OrgId, projectId: string) {
    return guard({ kind: "project" as const, id: projectId }, []);
  }
  async removeMember() {
    return "absent" as const;
  }
}

class FakeInvitations implements ProjectInvitationRepository {
  prepared: PrepareEmailInvitationsCmd[] = [];
  links: IssueLinkCmd[] = [];
  failures: { invitationId: string; error: string }[] = [];
  resendCmds: PrepareResendCmd[] = [];
  activateCmds: ActivateInvitationCmd[] = [];
  lookups: { hash: string; viewer: string | null }[] = [];

  prepareResult: ((cmd: PrepareEmailInvitationsCmd) => PrepareEmailInvitationsResult) | null = null;
  linkResult: IssueLinkResult = { ok: true, replacedInvitationId: null };
  listRows: InvitationListRow[] = [];
  resendResult: PrepareResendResult | null = null;
  revokeResult: RevokeInvitationResult = "revoked";
  lookupResult: InvitationLookup = NONE;
  acceptResult: AcceptInvitationResult = { ok: true, orgId: ORG, projectId: PROJECT, joinedOrg: true, alreadyMember: false };
  activateResult: ActivateInvitationResult = { ok: true, userId: "u-new", orgId: ORG, projectId: PROJECT, emailVerified: true };

  async prepareEmailInvitations(cmd: PrepareEmailInvitationsCmd) {
    this.prepared.push(cmd);
    if (this.prepareResult !== null) return this.prepareResult(cmd);
    return {
      ok: true as const,
      context: { projectName: "北极星项目", inviterName: "负责人甲" },
      items: cmd.items.map((i) => ({ email: i.email, outcome: "created" as const, invitationId: i.invitationId })),
    };
  }
  async issueLink(cmd: IssueLinkCmd) {
    this.links.push(cmd);
    return this.linkResult;
  }
  async list(_o: OrgId, projectId: string) {
    return guard({ kind: "project" as const, id: projectId }, this.listRows);
  }
  async prepareResend(cmd: PrepareResendCmd) {
    this.resendCmds.push(cmd);
    return (
      this.resendResult ?? {
        ok: true as const,
        email: "new@x.test",
        expiresAt: new Date(NOW.getTime() + 86_400_000),
        sendAttempts: 2,
        lastSentAt: NOW,
        context: { projectName: "北极星项目", inviterName: "负责人甲" },
      }
    );
  }
  async recordSendFailure(cmd: { orgId: OrgId; invitationId: string; error: string }) {
    this.failures.push({ invitationId: cmd.invitationId, error: cmd.error });
  }
  async revoke() {
    return this.revokeResult;
  }
  async lookup(hash: string, _now: Date, viewer: string | null) {
    this.lookups.push({ hash, viewer });
    return this.lookupResult;
  }
  async acceptLoggedIn() {
    return this.acceptResult;
  }
  async activate(cmd: ActivateInvitationCmd) {
    this.activateCmds.push(cmd);
    return this.activateResult;
  }
}

const NONE: InvitationLookup = {
  found: false, valid: false, kind: null, projectName: null, inviterName: null, invitedEmail: null,
  invitedEmailHasAccount: false, viewerEmail: null, viewerIsProjectMember: false,
};

class FakeMail {
  sent: { to: string; subject: string; text: string }[] = [];
  failWith: Error | null = null;
  async send(m: { to: string; subject: string; text: string }) {
    if (this.failWith !== null) throw this.failWith;
    this.sent.push(m);
    return {};
  }
}

function setup() {
  const members = new FakeMembers();
  const invitations = new FakeInvitations();
  const mail = new FakeMail();
  let n = 0;
  const identity = new FakeRoleViewRepository({
    "u-owner": { orgRole: "consultant", projectRole: null },
    "u-collab": { orgRole: "consultant", projectRole: null },
    "u-lead": { orgRole: "lead", projectRole: null },
    "u-target": { orgRole: "consultant", projectRole: null },
  });
  const deps: ManageProjectInvitationsDeps = {
    identity,
    ids: new FakeDecisionIds(),
    members: members as unknown as NonWorkshopMemberRepository,
    invitations,
    mail,
    appPublicUrl: () => "https://app.test/",
    now: () => NOW,
    newToken: () => `tok-${++n}`,
    newId: () => `inv-${n}`,
  };
  return { members, invitations, mail, deps, identity };
}

const owner = { actorId: "u-owner", orgId: ORG, projectId: PROJECT };
const rejectsWith = async (p: Promise<unknown>, code: string) => {
  await expect(p).rejects.toMatchObject({ reasonCode: code });
};

/* ───────────────────────── 负责人门 ───────────────────────── */

describe("负责人一侧的门（与 addNonWorkshopMember 同一道）", () => {
  it("collaborator 不能创建 / 列表 / 重发 / 撤销 / 签发链接", async () => {
    const { deps } = setup();
    const collab = { ...owner, actorId: "u-collab" };
    await rejectsWith(createProjectInvitations(deps, { ...collab, emails: ["a@x.test"] }), "PROJECT_ROLE_INSUFFICIENT");
    await rejectsWith(listProjectInvitations(deps, collab), "PROJECT_ROLE_INSUFFICIENT");
    await rejectsWith(resendProjectInvitation(deps, { ...collab, invitationId: "i" }), "PROJECT_ROLE_INSUFFICIENT");
    await rejectsWith(revokeProjectInvitation(deps, { ...collab, invitationId: "i" }), "PROJECT_ROLE_INSUFFICIENT");
    await rejectsWith(issueProjectInviteLink(deps, collab), "PROJECT_ROLE_INSUFFICIENT");
  });
  it("容器里没有 owner 时组织 lead 可以当第一位；有了 owner 之后被收回", async () => {
    const { deps, members } = setup();
    members.owners.clear();
    members.hasOwner = false;
    const lead = { ...owner, actorId: "u-lead" };
    await expect(createProjectInvitations(deps, { ...lead, emails: ["a@x.test"] })).resolves.toBeDefined();
    members.hasOwner = true;
    await rejectsWith(createProjectInvitations(deps, { ...lead, emails: ["a@x.test"] }), "ORG_ROLE_INSUFFICIENT");
  });
  it("容器不存在 / 外人 ⇒ NO_PROJECT_ROLE；归档项目不能创建 / 重发 / 签发，但可以撤销和列表", async () => {
    const { deps, invitations } = setup();
    await rejectsWith(createProjectInvitations(deps, { ...owner, projectId: "nope", emails: ["a@x.test"] }), "NO_PROJECT_ROLE");
    await rejectsWith(createProjectInvitations(deps, { ...owner, actorId: "u-stranger", emails: ["a@x.test"] }), "NO_PROJECT_ROLE");
    const arch = { ...owner, projectId: ARCHIVED };
    await rejectsWith(createProjectInvitations(deps, { ...arch, emails: ["a@x.test"] }), "PROJECT_ARCHIVED");
    await rejectsWith(resendProjectInvitation(deps, { ...arch, invitationId: "i" }), "PROJECT_ARCHIVED");
    await rejectsWith(issueProjectInviteLink(deps, arch), "PROJECT_ARCHIVED");
    expect(invitations.prepared).toHaveLength(0);
    await expect(revokeProjectInvitation(deps, { ...arch, invitationId: "i" })).resolves.toEqual({ invitationId: "i", status: "revoked" });
    await expect(listProjectInvitations(deps, arch)).resolves.toEqual({ invitations: [] });
  });
});

/* ───────────────────────── 创建 ───────────────────────── */

describe("createProjectInvitations", () => {
  it("逐邮箱：规范化 + 去重 + 非法邮箱不落库；每个有效邮箱恰一封邮件；只有哈希交给仓储", async () => {
    const { deps, invitations, mail } = setup();
    const out = await createProjectInvitations(deps, { ...owner, emails: [" New@X.test ", "bad", "new@x.test", "b@x.test"] });
    expect(out.invitations.map((i) => i.outcome)).toEqual(["sent", "invalid_email", "sent", "sent"]);
    expect(out.invitations[0]!.invitationId).toBe(out.invitations[2]!.invitationId);
    expect(out.invitations[1]).toMatchObject({ email: "bad", invitationId: null });
    expect(out.invitations[0]!.email).toBe("New@X.test"); // 回显 trim 后的原样
    expect(invitations.prepared[0]!.items.map((i) => i.email)).toEqual(["new@x.test", "b@x.test"]);
    expect(mail.sent.map((m) => m.to)).toEqual(["new@x.test", "b@x.test"]);
    // 明文令牌只在邮件里；仓储拿到的是哈希。
    expect(mail.sent[0]!.text).toContain("https://app.test/projects/join?invite=tok-1");
    expect(invitations.prepared[0]!.items[0]!.tokenHash).toBe(hashInvitationToken("tok-1"));
    expect(JSON.stringify(invitations.prepared[0])).not.toContain("tok-1");
    expect(invitations.prepared[0]!.dailyCap).toBe(LIMITS.dailyCapPerProject);
  });
  it("全是非法邮箱 ⇒ 不碰仓储、不发邮件", async () => {
    const { deps, invitations, mail } = setup();
    const out = await createProjectInvitations(deps, { ...owner, emails: ["x", "y@"] });
    expect(out.invitations.every((i) => i.outcome === "invalid_email")).toBe(true);
    expect(invitations.prepared).toHaveLength(0);
    expect(mail.sent).toHaveLength(0);
  });
  it("已有待接受 / 已是成员：不发邮件、不报错", async () => {
    const { deps, invitations, mail } = setup();
    invitations.prepareResult = (cmd) => ({
      ok: true,
      context: { projectName: "P", inviterName: "甲" },
      items: [
        { email: cmd.items[0]!.email, outcome: "already_pending", invitationId: "inv-old" },
        { email: cmd.items[1]!.email, outcome: "already_member", invitationId: null },
      ],
    });
    const out = await createProjectInvitations(deps, { ...owner, emails: ["a@x.test", "b@x.test"] });
    expect(out.invitations.map((i) => i.outcome)).toEqual(["already_pending", "already_member"]);
    expect(out.invitations[0]!.invitationId).toBe("inv-old");
    expect(mail.sent).toHaveLength(0);
  });
  it("超每日上限 ⇒ DAILY_CAP_REACHED，整批不发", async () => {
    const { deps, invitations, mail } = setup();
    invitations.prepareResult = () => ({ ok: false, reason: "daily-cap" });
    await rejectsWith(createProjectInvitations(deps, { ...owner, emails: ["a@x.test"] }), "DAILY_CAP_REACHED");
    expect(mail.sent).toHaveLength(0);
  });
  it("邮件发送失败可见：outcome=send_failed + 归类码，回写仓储；邀请仍在，不抛错", async () => {
    const { deps, invitations, mail } = setup();
    mail.failWith = new TransactionalMailError("timeout");
    const out = await createProjectInvitations(deps, { ...owner, emails: ["a@x.test"] });
    expect(out.invitations[0]).toMatchObject({ outcome: "send_failed", lastSendError: "MAIL_SEND_FAILED" });
    expect(invitations.failures).toEqual([{ invitationId: out.invitations[0]!.invitationId, error: "MAIL_SEND_FAILED" }]);
    mail.failWith = new TransactionalMailError("configuration_missing");
    const out2 = await createProjectInvitations(deps, { ...owner, emails: ["b@x.test"] });
    expect(out2.invitations[0]!.lastSendError).toBe("MAIL_NOT_CONFIGURED");
    mail.failWith = new TransactionalMailError("provider_http_422");
    const out3 = await createProjectInvitations(deps, { ...owner, emails: ["c@x.test"] });
    expect(out3.invitations[0]!.lastSendError).toBe("MAIL_RECIPIENT_REJECTED");
  });
  it("公开地址取不到（部署没配好）也只是一个可见的失败码，不是 500", async () => {
    const { deps, invitations } = setup();
    const broken = { ...deps, appPublicUrl: () => { throw new Error("APP_PUBLIC_URL must use HTTPS in production"); } };
    const out = await createProjectInvitations(broken, { ...owner, emails: ["a@x.test"] });
    expect(out.invitations[0]).toMatchObject({ outcome: "send_failed", lastSendError: "MAIL_SEND_FAILED" });
    expect(invitations.failures).toHaveLength(1);
  });
});

/* ───────────────────────── 链接 ───────────────────────── */

describe("issueProjectInviteLink", () => {
  it("返回一次性可见的链接；仓储只拿到哈希；重置会回报被取代的旧邀请", async () => {
    const { deps, invitations } = setup();
    invitations.linkResult = { ok: true, replacedInvitationId: "inv-old" };
    const out = await issueProjectInviteLink(deps, owner);
    expect(out.inviteUrl).toBe("https://app.test/projects/join?invite=tok-1");
    expect(out.replacedInvitationId).toBe("inv-old");
    expect(new Date(out.expiresAt).getTime() - NOW.getTime()).toBe(LIMITS.ttlDays * 86_400_000);
    expect(invitations.links[0]!.tokenHash).toBe(hashInvitationToken("tok-1"));
    expect(JSON.stringify(invitations.links[0])).not.toContain("tok-1");
  });
  it("每日上限 ⇒ DAILY_CAP_REACHED；公开地址取不到 ⇒ 在落库之前就失败", async () => {
    const { deps, invitations } = setup();
    invitations.linkResult = { ok: false, reason: "daily-cap" };
    await rejectsWith(issueProjectInviteLink(deps, owner), "DAILY_CAP_REACHED");
    const broken = { ...deps, appPublicUrl: () => { throw new Error("no url"); } };
    invitations.links = [];
    await expect(issueProjectInviteLink(broken, owner)).rejects.toThrow();
    expect(invitations.links).toHaveLength(0);
  });
});

/* ───────────────────────── 列表 ───────────────────────── */

describe("listProjectInvitations", () => {
  it("状态按过期时间派生；canResend 只对待接受的邮件邀请为 true；日期是 ISO 串；不含令牌", async () => {
    const { deps, invitations } = setup();
    const base = {
      role: "collaborator" as const, createdAt: NOW, invitedByName: "负责人甲", lastSentAt: NOW, sendAttempts: 1, lastSendError: null,
    };
    invitations.listRows = [
      { ...base, invitationId: "a", kind: "email", email: "a@x.test", status: "pending", expiresAt: new Date(NOW.getTime() + 1000) },
      { ...base, invitationId: "b", kind: "email", email: "b@x.test", status: "pending", expiresAt: new Date(NOW.getTime() - 1000) },
      { ...base, invitationId: "c", kind: "link", email: null, status: "pending", expiresAt: new Date(NOW.getTime() + 1000), lastSentAt: null, sendAttempts: 0 },
      { ...base, invitationId: "d", kind: "email", email: "d@x.test", status: "accepted", expiresAt: new Date(NOW.getTime() + 1000) },
      { ...base, invitationId: "e", kind: "email", email: "e@x.test", status: "pending", expiresAt: new Date(NOW.getTime() + 1000), sendAttempts: LIMITS.maxSendsPerInvitation, lastSendError: "MAIL_SEND_FAILED" },
    ];
    const out = await listProjectInvitations(deps, owner);
    expect(out.invitations.map((i) => [i.invitationId, i.status, i.canResend])).toEqual([
      ["a", "pending", true],
      ["b", "expired", false],
      ["c", "pending", false],
      ["d", "accepted", false],
      ["e", "pending", false],
    ]);
    expect(out.invitations[4]!.lastSendError).toBe("MAIL_SEND_FAILED");
    expect(out.invitations[0]!.expiresAt).toBe("2026-10-01T00:00:01.000Z");
    expect(C.operations.listProjectInvitations.out.safeParse(out).success).toBe(true);
    expect(JSON.stringify(out)).not.toMatch(/token/i);
  });
});

/* ───────────────────────── 重发 / 撤销 ───────────────────────── */

describe("resendProjectInvitation", () => {
  it("成功：发新令牌的邮件（旧令牌失效由仓储轮换），remainingSends 正确", async () => {
    const { deps, invitations, mail } = setup();
    const out = await resendProjectInvitation(deps, { ...owner, invitationId: "inv-1" });
    expect(out).toMatchObject({ invitationId: "inv-1", outcome: "sent", lastSendError: null, sendAttempts: 2, remainingSends: LIMITS.maxSendsPerInvitation - 2 });
    expect(mail.sent[0]!.text).toContain("invite=tok-1");
    expect(invitations.resendCmds[0]!.newTokenHash).toBe(hashInvitationToken("tok-1"));
    expect(invitations.resendCmds[0]!.actorId).toBe("u-owner");
  });
  it("发送失败：outcome=send_failed 并回写", async () => {
    const { deps, invitations, mail } = setup();
    mail.failWith = new TransactionalMailError("network");
    const out = await resendProjectInvitation(deps, { ...owner, invitationId: "inv-1" });
    expect(out).toMatchObject({ outcome: "send_failed", lastSendError: "MAIL_SEND_FAILED" });
    expect(invitations.failures).toEqual([{ invitationId: "inv-1", error: "MAIL_SEND_FAILED" }]);
  });
  it("仓储的五种拒绝各映射到自己的码；限频带 retryAfterSeconds（向上取整）", async () => {
    const { deps, invitations, mail } = setup();
    const cases: [string, string][] = [
      ["not-found", "INVITATION_NOT_FOUND"],
      ["not-resendable", "INVITATION_NOT_RESENDABLE"],
      ["expired", "INVITATION_EXPIRED"],
      ["limit-reached", "RESEND_LIMIT_REACHED"],
    ];
    for (const [reason, code] of cases) {
      invitations.resendResult = { ok: false, reason: reason as "not-found", retryAfterMs: null };
      await rejectsWith(resendProjectInvitation(deps, { ...owner, invitationId: "x" }), code);
    }
    invitations.resendResult = { ok: false, reason: "too-soon", retryAfterMs: 12_001 };
    await expect(resendProjectInvitation(deps, { ...owner, invitationId: "x" })).rejects.toMatchObject({
      reasonCode: "RESEND_TOO_SOON",
      retryAfterSeconds: 13,
    });
    expect(mail.sent).toHaveLength(0);
  });
});

describe("revokeProjectInvitation", () => {
  it("撤销成功；不存在 ⇒ NOT_FOUND；已接受 ⇒ ALREADY_ACCEPTED", async () => {
    const { deps, invitations } = setup();
    await expect(revokeProjectInvitation(deps, { ...owner, invitationId: "i" })).resolves.toEqual({ invitationId: "i", status: "revoked" });
    invitations.revokeResult = "not-found";
    await rejectsWith(revokeProjectInvitation(deps, { ...owner, invitationId: "i" }), "INVITATION_NOT_FOUND");
    invitations.revokeResult = "already-accepted";
    await rejectsWith(revokeProjectInvitation(deps, { ...owner, invitationId: "i" }), "INVITATION_ALREADY_ACCEPTED");
  });
});

/* ───────────────────────── 预览 ───────────────────────── */

describe("previewProjectInvitation", () => {
  const valid = (over: Partial<InvitationLookup>): InvitationLookup => ({
    ...NONE, found: true, valid: true, kind: "email", projectName: "北极星项目", inviterName: "负责人甲", invitedEmail: "a@x.test", ...over,
  });
  const run = async (lookup: InvitationLookup, viewerUserId: string | null) => {
    const repo = new FakeInvitations();
    repo.lookupResult = lookup;
    const out = await previewProjectInvitation({ invitations: repo, now: () => NOW }, { token: "tok", viewerUserId });
    return { out, repo };
  };

  it("失效（不存在 / 过期 / 撤销 / 已用）：valid:false，其余全 null", async () => {
    for (const l of [NONE, { ...NONE, found: true }]) {
      const { out } = await run(l, null);
      expect(out).toEqual({ valid: false, kind: null, projectName: null, inviterName: null, invitedEmail: null, nextStep: null });
    }
  });
  it("令牌只以哈希去查；登录用户 id 传给仓储", async () => {
    const { repo } = await run(valid({}), "u-1");
    expect(repo.lookups).toEqual([{ hash: hashInvitationToken("tok"), viewer: "u-1" }]);
  });
  it("匿名：邮箱邀请 ⇒ 已有账号 login / 没有账号 register；链接邀请 ⇒ login_or_register；链接邀请不回邮箱", async () => {
    expect((await run(valid({ invitedEmailHasAccount: true }), null)).out.nextStep).toBe("login");
    expect((await run(valid({ invitedEmailHasAccount: false }), null)).out.nextStep).toBe("register");
    const link = (await run(valid({ kind: "link", invitedEmail: "leak@x.test" }), null)).out;
    expect(link).toMatchObject({ kind: "link", nextStep: "login_or_register", invitedEmail: null, projectName: "北极星项目" });
  });
  it("已登录：邮箱相符 accept；已在项目里 already_member；邮箱不符（或查不到登录邮箱）email_mismatch；链接邀请不看邮箱", async () => {
    expect((await run(valid({ viewerEmail: "A@x.test" }), "u")).out.nextStep).toBe("accept");
    expect((await run(valid({ viewerEmail: "a@x.test", viewerIsProjectMember: true }), "u")).out.nextStep).toBe("already_member");
    expect((await run(valid({ viewerEmail: "b@x.test" }), "u")).out.nextStep).toBe("email_mismatch");
    expect((await run(valid({ viewerEmail: null }), "u")).out.nextStep).toBe("email_mismatch");
    expect((await run(valid({ kind: "link", invitedEmail: null, viewerEmail: "z@y.test" }), "u")).out.nextStep).toBe("accept");
  });
  it("输出满足契约（strict）", async () => {
    const { out } = await run(valid({}), null);
    expect(C.operations.previewProjectInvitation.out.safeParse(out).success).toBe(true);
  });
});

/* ───────────────────────── 接受 / 激活 ───────────────────────── */

describe("acceptProjectInvitation", () => {
  it("成功：回 projectId / orgId / joinedOrg / alreadyMember，并尽力写审计（加入组织 + 加入项目各一条）", async () => {
    const repo = new FakeInvitations();
    const provenance = new FakeProvenanceWriter();
    const out = await acceptProjectInvitation({ invitations: repo, provenance, now: () => NOW }, { token: "t", userId: "u-1" });
    expect(out).toEqual({ projectId: PROJECT, orgId: ORG, joinedOrg: true, alreadyMember: false });
    expect(provenance.appended.map((e) => e.detail.op)).toEqual(["org-member-joined-via-project-invitation", "project-invitation-accepted"]);
    expect(provenance.appended[0]!.detail.orgRole).toBe("consultant");
  });
  it("审计写失败不让已提交的加入变成失败", async () => {
    const repo = new FakeInvitations();
    const logs: string[] = [];
    const provenance = { append: async () => { throw new Error("audit down"); }, appendWithin: async () => "" };
    const out = await acceptProjectInvitation({ invitations: repo, provenance, log: (m) => logs.push(m), now: () => NOW }, { token: "t", userId: "u-1" });
    expect(out.projectId).toBe(PROJECT);
    expect(logs).toHaveLength(1);
  });
  it("幂等重复（已是成员、没新入组织）不再写审计", async () => {
    const repo = new FakeInvitations();
    repo.acceptResult = { ok: true, orgId: ORG, projectId: PROJECT, joinedOrg: false, alreadyMember: true };
    const provenance = new FakeProvenanceWriter();
    await acceptProjectInvitation({ invitations: repo, provenance, now: () => NOW }, { token: "t", userId: "u-1" });
    expect(provenance.appended).toHaveLength(0);
  });
  it("仓储拒绝原因逐一映射", async () => {
    const repo = new FakeInvitations();
    const cases: [string, string][] = [
      ["invalid", "INVITATION_INVALID"],
      ["email-mismatch", "INVITATION_EMAIL_MISMATCH"],
      ["archived", "PROJECT_ARCHIVED"],
      ["quota", "SEAT_QUOTA_EXHAUSTED"],
    ];
    for (const [reason, code] of cases) {
      repo.acceptResult = { ok: false, reason: reason as "invalid" };
      await rejectsWith(acceptProjectInvitation({ invitations: repo, now: () => NOW }, { token: "t", userId: "u" }), code);
    }
  });
});

describe("activateProjectInvitation", () => {
  const STRONG = "a-very-Strong-pass-2026!";
  function activateDeps(repo: FakeInvitations) {
    const issued: unknown[] = [];
    let hashed = 0;
    return {
      issued,
      hashedCount: () => hashed,
      deps: {
        invitations: repo,
        hasher: { hash: async (p: string) => { hashed++; return `$2b$12$h-${p}`; }, verify: async () => true, verifyDummy: async () => false as const },
        sessions: { issue: async (rec: unknown) => { issued.push(rec); return "bearer-1"; } } as never,
        tokens: { sessionId: () => "sess-1", opaqueToken: () => "o" },
        verificationTokens: {
          newChallengeId: () => "ch-1",
          tokenForChallenge: (c: string) => `vt-${c}`,
          digest: (t: string) => `dg-${t}`,
          pendingProofForChallenge: (c: string) => c,
          challengeIdFromPendingProof: (p: string) => p,
        },
        now: () => NOW,
      },
    };
  }

  it("口令策略先于查库：弱口令 ⇒ PasswordPolicyError，不碰仓储、不做慢哈希", async () => {
    const repo = new FakeInvitations();
    const { deps, hashedCount } = activateDeps(repo);
    await expect(activateProjectInvitation(deps, { token: "t", name: "新人", password: "short", email: null })).rejects.toBeInstanceOf(PasswordPolicyError);
    expect(repo.activateCmds).toHaveLength(0);
    expect(hashedCount()).toBe(0);
  });
  it("邮箱邀请：返回会话（已验证）；只把哈希 / 慢哈希口令 / 验证计划交给仓储", async () => {
    const repo = new FakeInvitations();
    const { deps, issued } = activateDeps(repo);
    const out = await activateProjectInvitation(deps, { token: "t", name: "新人", password: STRONG, email: "ignored@evil.test" });
    expect(out).toMatchObject({ userId: "u-new", orgId: ORG, projectId: PROJECT, verificationRequired: false, sessionId: "sess-1" });
    expect(out.session?.sessionToken).toBe("bearer-1");
    expect(issued).toHaveLength(1);
    expect(issued[0]).toMatchObject({ userId: "u-new", currentOrgId: ORG });
    const cmd = repo.activateCmds[0]!;
    expect(cmd.tokenHash).toBe(hashInvitationToken("t"));
    expect(cmd.passwordHash).toBe(`$2b$12$h-${STRONG}`);
    expect(cmd.passwordHash).not.toContain("ignored");
    expect(cmd.verification).toMatchObject({ challengeId: "ch-1", tokenDigest: "dg-vt-ch-1", outboxId: "verify-ch-1" });
    expect(C.operations.activateProjectInvitation.out.safeParse(out).success).toBe(true);
  });
  it("链接邀请（邮箱未验证）：不发会话，verificationRequired=true", async () => {
    const repo = new FakeInvitations();
    repo.activateResult = { ok: true, userId: "u-new", orgId: ORG, projectId: PROJECT, emailVerified: false };
    const { deps, issued } = activateDeps(repo);
    const out = await activateProjectInvitation(deps, { token: "t", name: "链接人", password: STRONG, email: " Link@X.test " });
    expect(out).toMatchObject({ verificationRequired: true, sessionId: null, session: null });
    expect(issued).toHaveLength(0);
    expect(repo.activateCmds[0]!.linkEmail).toBe("link@x.test");
    expect(C.operations.activateProjectInvitation.out.safeParse(out).success).toBe(true);
  });
  it("email-required 按自填邮箱是否存在 / 形状分成 EMAIL_REQUIRED 与 EMAIL_INVALID；形状不对不传给仓储", async () => {
    const repo = new FakeInvitations();
    repo.activateResult = { ok: false, reason: "email-required" };
    const { deps } = activateDeps(repo);
    await rejectsWith(activateProjectInvitation(deps, { token: "t", name: "n", password: STRONG, email: null }), "EMAIL_REQUIRED");
    await rejectsWith(activateProjectInvitation(deps, { token: "t", name: "n", password: STRONG, email: "  " }), "EMAIL_REQUIRED");
    await rejectsWith(activateProjectInvitation(deps, { token: "t", name: "n", password: STRONG, email: "not-an-email" }), "EMAIL_INVALID");
    expect(repo.activateCmds.every((c) => c.linkEmail === null)).toBe(true);
  });
  it("仓储拒绝原因逐一映射（login-required = 邮箱已注册，引导登录）", async () => {
    const repo = new FakeInvitations();
    const { deps } = activateDeps(repo);
    const cases: [string, string][] = [
      ["invalid", "INVITATION_INVALID"],
      ["login-required", "LOGIN_REQUIRED"],
      ["archived", "PROJECT_ARCHIVED"],
      ["quota", "SEAT_QUOTA_EXHAUSTED"],
    ];
    for (const [reason, code] of cases) {
      repo.activateResult = { ok: false, reason: reason as "invalid" };
      await rejectsWith(activateProjectInvitation(deps, { token: "t", name: "n", password: STRONG, email: null }), code);
    }
  });
});

/* ───────────────────────── 按姓名加人后的通知 ───────────────────────── */

describe("addNonWorkshopMember 之后通知被加的人（尽力而为）", () => {
  function addSetup(notify: () => Promise<void>) {
    const { members, identity } = setup();
    const calls: unknown[] = [];
    const logs: string[] = [];
    const deps = {
      identity,
      ids: new FakeDecisionIds(),
      members: members as unknown as NonWorkshopMemberRepository,
      provenance: new FakeProvenanceWriter(),
      notifier: { notifyAdded: async (i: unknown) => { calls.push(i); await notify(); } },
      log: (m: string) => logs.push(m),
    };
    return { deps, calls, logs };
  }
  it("加人成功后通知一次，带 orgId / projectId / 被加的人 / 操作人 / 档位", async () => {
    const { deps, calls } = addSetup(async () => {});
    await addNonWorkshopMember(deps, { ...owner, userId: "u-target", role: "collaborator" });
    expect(calls).toEqual([{ orgId: ORG, projectId: PROJECT, userId: "u-target", actorId: "u-owner", role: "collaborator" }]);
  });
  it("通知抛错：加人仍然成功，只记日志", async () => {
    const { deps, logs } = addSetup(async () => { throw new Error("mail down"); });
    const out = await addNonWorkshopMember(deps, { ...owner, userId: "u-target", role: "collaborator" });
    expect(out.userId).toBe("u-target");
    expect(logs).toHaveLength(1);
  });
  it("自己加自己不通知；被拒绝的加人（collaborator 操作）不通知", async () => {
    const { deps, calls } = addSetup(async () => {});
    await addNonWorkshopMember(deps, { ...owner, userId: "u-owner", role: "owner" });
    expect(calls).toHaveLength(0);
    await expect(addNonWorkshopMember(deps, { ...owner, actorId: "u-collab", userId: "u-target", role: "collaborator" })).rejects.toMatchObject({
      reasonCode: "PROJECT_ROLE_INSUFFICIENT",
    });
    expect(calls).toHaveLength(0);
  });
  it("组织成员门没有放宽：目标不在组织里仍是 ORG_ROLE_INSUFFICIENT，且不通知", async () => {
    const { deps, calls } = addSetup(async () => {});
    await expect(addNonWorkshopMember(deps, { ...owner, userId: "u-not-in-org", role: "collaborator" })).rejects.toMatchObject({
      reasonCode: "ORG_ROLE_INSUFFICIENT",
    });
    expect(calls).toHaveLength(0);
  });
});
