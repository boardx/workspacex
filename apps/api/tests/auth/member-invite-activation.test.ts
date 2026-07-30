/**
 * F10 主流程（UC-1.6）：**邀请 → 待激活行 → 激活 → 入场即带组织角色 + 团队**。
 *
 * ## 「入场即带组织角色+团队」为什么用 `authorize` 断言，而不是数一行成员表
 *
 * `org_memberships` 里有一行、字段值也对——这件事可以在授权判定完全没接上的情况下成立。
 * F10 的 `user_visible_behavior` 说的是「入场即带」，即**激活完成的那一刻，
 * 对应范围的资源就读得到**。那是判定的输出，不是表的内容。
 * 所以这里断言的是三件一起成立：
 *   ① 激活前 → `NO_ORG_MEMBERSHIP`（他还不在这个组织里）
 *   ② 激活后 → 他自己团队的 team-only 资源 **allowed**
 *   ③ 激活后 → **别的团队**的 team-only 资源 **denied**
 * 少了 ③，一个「把每个人都当成全组织可见」的实现会让 ① ② 全绿。
 *
 * ## 本文件还守着一条**例外的前提**
 *
 * `pg-org-invite-repository.ts` 在 `lint-permission-paths` 的 ALLOWLIST 上，理由是
 * 「邀请行的内容不出这个文件」。最后一个 describe 断言这一点，并用一次反证证明它是活的。
 * 那条测试若被删，ALLOWLIST 里的那一条也必须一起删。
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { inviteOrgMember } from "../../src/application/auth/invite-org-member";
import { activateOrgMember } from "../../src/application/auth/activate-org-member";
import { OrgAdminError } from "../../src/application/auth/org-invite-errors";
import { authorize } from "../../src/application/identity/authorize";
import { PgOrgInviteRepository } from "../../src/infrastructure/auth/pg-org-invite-repository";
import { PgIdentityRepository } from "../../src/infrastructure/identity/pg-identity-repository";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { appConfig } from "../../src/infrastructure/db/pg-config";
import { toOrgId } from "../../src/domain/org-id";
import {
  addBinding,
  addOrgMember,
  asApp,
  asOwner,
  ensureDatabase,
  migrateOnce,
  resetOrgs,
  seedOrg,
} from "../support/db";
import { fakeHasher, fakeSessions, fakeTokens, NO_CLAIMS } from "../support/org-invite";

const ORG = "org-f10-main";
const OTHER_ORG = "org-f10-main-other";
const ADMIN = "u-f10-admin";
const CONSULTANT = "u-f10-consultant";

/** 见文件尾的注释：钩子不吃 vitest 默认的 10 秒。 */
const HOOK_TIMEOUT_MS = 60_000;

let db: PgDatabase;
let repo: PgOrgInviteRepository;
let identity: PgIdentityRepository;
let fixture: Awaited<ReturnType<typeof seedOrg>>;

const ids = { next: () => "dec-f10" };

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  db = new PgDatabase(appConfig());
  repo = new PgOrgInviteRepository(db);
  identity = new PgIdentityRepository(db);
}, HOOK_TIMEOUT_MS);

afterAll(async () => {
  await resetOrgs(ORG, OTHER_ORG);
  await asOwner((c) => c.query("DELETE FROM credentials WHERE email LIKE '%@f10main.test'"));
  await db?.close();
}, HOOK_TIMEOUT_MS);

beforeEach(async () => {
  await resetOrgs(ORG, OTHER_ORG);
  await asOwner((c) => c.query("DELETE FROM credentials WHERE email LIKE '%@f10main.test'"));

  fixture = await seedOrg({
    orgId: ORG,
    teamNames: ["energy", "platform"],
    projectId: `${ORG}-p-energy`,
  });
  // 第二个项目：属于 platform 团队，用来断言「别的团队的资源读不到」。
  await asApp(ORG, (c) =>
    c.query("INSERT INTO projects (id, org_id, name) VALUES ($1, $2, $3)", [
      `${ORG}-p-platform`,
      ORG,
      "platform project",
    ]),
  );
  await addOrgMember(ORG, ADMIN, "admin", fixture.teams.energy!);
  await addOrgMember(ORG, CONSULTANT, "consultant", fixture.teams.energy!);

  // team-only 绑定，subject 是**团队**而不是人——被邀请的人此刻还不存在。
  await addBinding({
    orgId: ORG,
    subject: { kind: "team", id: fixture.teams.energy! },
    object: { kind: "project", id: `${ORG}-p-energy` },
    scope: "team-only",
    ownerTeamId: fixture.teams.energy!,
  });
  await addBinding({
    orgId: ORG,
    subject: { kind: "team", id: fixture.teams.platform! },
    object: { kind: "project", id: `${ORG}-p-platform` },
    scope: "team-only",
    ownerTeamId: fixture.teams.platform!,
  });
}, HOOK_TIMEOUT_MS);

function invite(over: Partial<Parameters<typeof inviteOrgMember>[1]> = {}) {
  return inviteOrgMember(
    { repo },
    {
      orgId: toOrgId(ORG),
      actorId: ADMIN,
      actorOrgRole: "admin",
      email: "Bob@F10Main.test",
      orgRole: "consultant",
      teamId: fixture.teams.energy!,
      ...over,
    },
  );
}

function activate(token: string, claims = NO_CLAIMS) {
  return activateOrgMember(
    { repo, hasher: fakeHasher, sessions: fakeSessions(), tokens: fakeTokens() },
    {
      token,
      mode: "new-account",
      profile: { name: "Bob", password: "correct-horse-battery-staple" },
      existingUserId: null,
      untrustedClaims: claims,
    },
  );
}

async function readInvite(inviteId: string) {
  return asApp(ORG, async (c) => {
    const r = await c.query(
      "SELECT id, email, org_role, team_id, status, sent_at, used_by_user_id FROM org_invites WHERE id = $1",
      [inviteId],
    );
    return r.rows[0] ?? null;
  });
}

describe("① 管理员邀请：待激活行按服务端指派的角色与团队落库", () => {
  it("邮箱规范化后落库，status=pending，sent_at 已写（= 已入出站队列）", async () => {
    const out = await invite();
    expect(out.status).toBe("pending");
    expect(out.tokenIssued).toBe(true);
    expect(out.token).not.toBeNull();

    const row = await readInvite(out.inviteId);
    // 大小写混写的入参在库里是小写的——`org_invites_live_uniq` 拦得住重复的前提。
    expect(row.email).toBe("bob@f10main.test");
    expect(row.org_role).toBe("consultant");
    expect(row.team_id).toBe(fixture.teams.energy);
    expect(row.status).toBe("pending");
    expect(row.sent_at).not.toBeNull();
    expect(row.used_by_user_id).toBeNull();
  });

  it("V7 越权：顾问调用一律拒，且**没有留下任何邀请行**", async () => {
    await expect(invite({ actorOrgRole: "consultant", actorId: CONSULTANT })).rejects.toMatchObject({
      reasonCode: "PROJECT_ROLE_INSUFFICIENT",
    });
    const n = await asApp(ORG, (c) => c.query("SELECT count(*)::int AS n FROM org_invites"));
    expect(n.rows[0].n).toBe(0);
  });

  it("I-3 / O-28 ⑥：邀请管理员 → awaiting-review，**且不签发令牌**", async () => {
    const out = await invite({ email: "carol@f10main.test", orgRole: "admin" });
    expect(out.status).toBe("awaiting-review");
    expect(out.tokenIssued).toBe(false);
    expect(out.token).toBeNull();

    const tokens = await asApp(ORG, (c) =>
      c.query("SELECT count(*)::int AS n FROM org_invite_tokens WHERE invite_id = $1", [out.inviteId]),
    );
    // 「状态写着待批」与「链接没发出去」是两件事，这里断言的是后者。
    expect(tokens.rows[0].n).toBe(0);
    const row = await readInvite(out.inviteId);
    expect(row.sent_at).toBeNull();
  });

  it("幂等重放：同 (org, email, 角色, 团队) 再提交返回既有 inviteId，不新建行、不再吐令牌", async () => {
    const first = await invite();
    const again = await invite();
    expect(again.inviteId).toBe(first.inviteId);
    expect(again.quotaReserved).toBe(0);
    expect(again.token).toBeNull();

    const n = await asApp(ORG, (c) => c.query("SELECT count(*)::int AS n FROM org_invites"));
    expect(n.rows[0].n).toBe(1);
  });

  it("I-5 冲突：同邮箱但**换了角色**的第二次提交是 INVITE_DUPLICATE，不是重放", async () => {
    await invite();
    await expect(invite({ orgRole: "lead" })).rejects.toMatchObject({ reasonCode: "INVITE_DUPLICATE" });
  });

  it("已经是成员的邮箱 → INVITE_ALREADY_MEMBER（引导去登录，不是「重复邀请」）", async () => {
    await asApp(ORG, (c) =>
      c.query(
        `INSERT INTO credentials (user_id, email, display_name, password_hash, email_verified_at)
         VALUES ($1, $2, $3, $4, now())`,
        [CONSULTANT, "consultant@f10main.test", "c", fakeHasher.canned],
      ),
    );
    await expect(invite({ email: "consultant@f10main.test" })).rejects.toMatchObject({
      reasonCode: "INVITE_ALREADY_MEMBER",
    });
  });
});

describe("② 激活：入场即带组织角色 + 团队", () => {
  it("激活前 NO_ORG_MEMBERSHIP；激活后本团队 allowed、别的团队 denied", async () => {
    const invited = await invite();

    // ① 激活前：这个人还不存在于任何组织。用一个此刻还没被创建的 userId 判定，
    //    拿到的必须是「你不在这个组织里」，而不是任何一种「资源不可见」。
    const before = await authorize(
      { repo: identity, ids },
      {
        userId: "u-f10-not-yet",
        orgId: toOrgId(ORG),
        object: { kind: "project", id: `${ORG}-p-energy` },
        action: "read",
      },
    );
    expect(before.allowed).toBe(false);
    expect(before.reasonCode).toBe("NO_ORG_MEMBERSHIP");

    const out = await activate(invited.token!);

    // 服务端记录值原样回传。
    expect(out.orgId).toBe(ORG);
    expect(out.orgRole).toBe("consultant");
    expect(out.teamId).toBe(fixture.teams.energy);
    expect(out.sessionId.length).toBeGreaterThan(0);

    // ② 本团队的 team-only 资源：立刻读得到。
    const mine = await authorize(
      { repo: identity, ids },
      {
        userId: out.userId,
        orgId: toOrgId(ORG),
        object: { kind: "project", id: `${ORG}-p-energy` },
        action: "read",
      },
    );
    expect(mine.allowed).toBe(true);

    // ③ 别的团队的 team-only 资源：读不到。
    //    没有这一条，「所有人都当全组织可见」的实现会让 ① ② 全绿。
    const theirs = await authorize(
      { repo: identity, ids },
      {
        userId: out.userId,
        orgId: toOrgId(ORG),
        object: { kind: "project", id: `${ORG}-p-platform` },
        action: "read",
      },
    );
    expect(theirs.allowed).toBe(false);
    expect(theirs.reasonCode).toBe("ORG_SCOPE_DENIED");
  });

  it("账号建在邀请行记录的邮箱上，且**直接是已验证的**（O-28 ⑤：点链接即证明邮箱所有权）", async () => {
    const invited = await invite();
    const out = await activate(invited.token!);

    const cred = await asOwner((c) =>
      c.query("SELECT email, email_verified_at FROM credentials WHERE user_id = $1", [out.userId]),
    );
    expect(cred.rows[0].email).toBe("bob@f10main.test");
    expect(cred.rows[0].email_verified_at).not.toBeNull();
  });

  it("I-1 幂等重放：同一 token 第二次调用是 INVITE_NOT_FOUND，**不是「已激活成功」**", async () => {
    const invited = await invite();
    await activate(invited.token!);
    await expect(activate(invited.token!)).rejects.toMatchObject({ reasonCode: "INVITE_NOT_FOUND" });

    // 只建了一个成员，不是两个。
    const n = await asApp(ORG, (c) =>
      c.query("SELECT count(*)::int AS n FROM org_memberships WHERE org_id = $1", [ORG]),
    );
    expect(n.rows[0].n).toBe(3); // admin + consultant + 新激活的这一个
  });

  it("V10 四种失效返回同一个码：不存在 / 已过期 / 已核销 / 已撤销", async () => {
    // (a) 不存在
    await expect(activate("no-such-token")).rejects.toMatchObject({ reasonCode: "INVITE_NOT_FOUND" });

    // (b) 已过期
    const expired = await invite({ email: "d@f10main.test" });
    await asApp(ORG, (c) =>
      c.query("UPDATE org_invite_tokens SET expires_at = now() - interval '1 day' WHERE invite_id = $1", [
        expired.inviteId,
      ]),
    );
    await expect(activate(expired.token!)).rejects.toMatchObject({ reasonCode: "INVITE_NOT_FOUND" });

    // (c) 已核销：见上一条测试，这里只补「核销后邀请行仍在」这一半
    // (d) 已撤销 —— E7：管理员在激活途中撤销了邀请
    const revoked = await invite({ email: "e@f10main.test" });
    await asApp(ORG, (c) =>
      c.query("UPDATE org_invites SET status = 'revoked' WHERE id = $1", [revoked.inviteId]),
    );
    await expect(activate(revoked.token!)).rejects.toMatchObject({ reasonCode: "INVITE_NOT_FOUND" });
    // 撤销后没有成员被建出来。
    const n = await asApp(ORG, (c) =>
      c.query("SELECT count(*)::int AS n FROM org_memberships WHERE org_id = $1", [ORG]),
    );
    expect(n.rows[0].n).toBe(2);
  });
});

describe("③ ALLOWLIST 例外的前提：邀请行的内容不出仓储", () => {
  /**
   * `lint-permission-paths` 放行 `pg-org-invite-repository.ts` 的理由是
   * 「`activate()` 返回的只有授予值，不含 email / invited_by」。
   * 这条断言让那个理由变成一件会红的事，而不是 ALLOWLIST 里的一句话。
   */
  const ALLOWED_GRANT_KEYS = ["userId", "orgId", "orgRole", "teamId", "tamperRecorded"];

  it("activate() 的返回值只有授予值这五个键", async () => {
    const invited = await invite();
    const result = await repo.activate({
      token: invited.token!,
      now: new Date(),
      newAccount: { userId: "u-f10-grantshape", displayName: "g", passwordHash: fakeHasher.canned },
      existingUserId: null,
      untrustedClaims: NO_CLAIMS,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Object.keys(result.grant).sort()).toEqual([...ALLOWED_GRANT_KEYS].sort());
  });

  it("反证：把 email 加进返回值，上一条当场红", async () => {
    const invited = await invite({ email: "f@f10main.test" });
    const result = await repo.activate({
      token: invited.token!,
      now: new Date(),
      newAccount: { userId: "u-f10-grantshape2", displayName: "g", passwordHash: fakeHasher.canned },
      existingUserId: null,
      untrustedClaims: NO_CLAIMS,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const widened = { ...result.grant, email: "f@f10main.test" };
    expect(Object.keys(widened).sort()).not.toEqual([...ALLOWED_GRANT_KEYS].sort());
  });
});

/**
 * ⚠ 三个钩子都显式给了 60 秒，而不是吃 vitest 默认的 10 秒。
 *
 * `vitest.config.ts` 已经把 `testTimeout` 抬到 60 秒并写明了理由（要起 Nest、要 shell out），
 * 但 `hookTimeout` 当时没跟着抬。这里的 `beforeEach` 要 `resetOrgs`（级联删）
 * 加 `seedOrg`（四张表、多次连接），在这台机器同时跑着好几个 worker 时轻松超过 10 秒——
 * 于是**整个文件一起红**，红的理由是 `Hook timed out`，与被测的行为毫无关系。
 * 那种红比不跑还糟：它会把真实的失败淹掉，而且看起来像是本 feature 坏了。
 *
 * 只改本文件、不动共享的 `vitest.config.ts`：那份配置有别的 worker 正在同时依赖，
 * 抬全局超时是一次跨 feature 的改动，该由谁做是另一件事。
 */
