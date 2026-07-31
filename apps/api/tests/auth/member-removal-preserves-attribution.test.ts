/**
 * F11 — 移除组织成员：停用访问，不删产出（O-29 ② / I-8）。
 * phase-01 `org-admin` · usecases.md `RemoveOrgMember`。
 *
 * ⚠ **本文件按 worker 交接说明未在本地执行**（需要 Postgres）；已跑
 * `pnpm --filter api run typecheck`，请 coordinator 在隔离环境里跑一次真实断言。
 *
 * ## 「与 UC-17.2 授权撤回结果相反」这条反证怎么戳穿
 *
 * 一个抄错了路径的实现会**顺手删掉** `credentials` 行或改写 `email`——那正是
 * 授权撤回该做的事，而移除成员绝对不该做。本文件第一个 `it` 之后专门重新
 * 查一次 `credentials`，断言该用户的账号行**原封不动**（行还在、邮箱没变）——
 * 只断言 `org_memberships` 那一行没了，捕捉不到这类"抄错文件"的错误。
 *
 * ## 会话吊销为什么用一个真的会记账的假件，而不是 F10 那个恒返回 0 的 `fakeSessions()`
 *
 * `tests/support/org-invite.ts` 的 `fakeSessions()` 是给 F10 用的：那边只关心
 * "激活时签发了几条会话"，`revokeAllForUser` 从未被断言过，所以它安全地恒返回 0。
 * 这里 `revokedSessions` 是契约输出的一部分，必须真的被断言等于"这个人有几条活会话"，
 * 所以本文件自带一个真正维护状态的假件。
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { removeOrgMember } from "../../src/application/auth/remove-org-member";
import { OrgAdminError } from "../../src/application/auth/org-invite-errors";
import { PgOrgMemberRepository } from "../../src/infrastructure/auth/pg-org-member-repository";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { appConfig } from "../../src/infrastructure/db/pg-config";
import { toOrgId } from "../../src/domain/org-id";
import type { SessionTokenStore } from "../../src/application/auth/ports";
import { addOrgMember, asApp, asOwner, ensureDatabase, migrateOnce, resetOrgs, seedOrg } from "../support/db";

const ORG = "org-f11-remove";
const ADMIN = "u-f11-remove-admin";
const MEMBER = "u-f11-remove-member";
const MEMBER_EMAIL = "member@f11remove.test";

const HOOK_TIMEOUT_MS = 60_000;

/** 一个真正记账的会话存储假件——见文件头。只实现本文件用得到的方法，其余抛错以防误用。 */
function trackingSessions(): SessionTokenStore & { liveFor(userId: string): number; seed(userId: string, n: number): void } {
  const live = new Map<string, number>();
  const notImplemented = (name: string) => () => {
    throw new Error(`trackingSessions.${name} not used by this test`);
  };
  return {
    issue: notImplemented("issue") as SessionTokenStore["issue"],
    findByToken: async () => null,
    listForUser: async () => [],
    setCurrentOrg: notImplemented("setCurrentOrg") as SessionTokenStore["setCurrentOrg"],
    revokeSession: notImplemented("revokeSession") as SessionTokenStore["revokeSession"],
    touch: notImplemented("touch") as SessionTokenStore["touch"],
    seed(userId: string, n: number) {
      live.set(userId, n);
    },
    liveFor: (userId: string) => live.get(userId) ?? 0,
    revokeAllForUser: async (userId: string) => {
      const n = live.get(userId) ?? 0;
      live.set(userId, 0);
      return n;
    },
  } as unknown as SessionTokenStore & { liveFor(userId: string): number; seed(userId: string, n: number): void };
}

let db: PgDatabase;
let repo: PgOrgMemberRepository;

async function insertCredential(userId: string, email: string): Promise<void> {
  await asOwner((c) =>
    c.query(
      `INSERT INTO credentials (user_id, email, display_name, password_hash, email_verified_at)
       VALUES ($1, $2, $3, $4, now())`,
      [userId, email, "F11 Test Member", "$2b$12$abcdefghijklmnopqrstuu5Q3nJ0G5x4c1oV1YyBpJ0N0m3nJ4dEa"],
    ),
  );
}

async function membershipExists(orgId: string, userId: string): Promise<boolean> {
  const res = await asOwner((c) =>
    c.query<{ n: string }>("SELECT count(*)::text AS n FROM org_memberships WHERE org_id = $1 AND user_id = $2", [
      orgId,
      userId,
    ]),
  );
  return Number(res.rows[0]?.n ?? 0) > 0;
}

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  db = new PgDatabase(appConfig());
  repo = new PgOrgMemberRepository(db);
}, HOOK_TIMEOUT_MS);

afterAll(async () => {
  await resetOrgs(ORG);
  await asOwner((c) => c.query("DELETE FROM credentials WHERE email LIKE '%@f11remove.test'"));
  await db?.close();
}, HOOK_TIMEOUT_MS);

beforeEach(async () => {
  await resetOrgs(ORG);
  await asOwner((c) => c.query("DELETE FROM credentials WHERE email LIKE '%@f11remove.test'"));
  await seedOrg({ orgId: ORG, teamNames: ["energy"], projectId: `${ORG}-p` });
  await addOrgMember(ORG, ADMIN, "admin", null);
});

describe("移除成员——三件事在一次调用里", () => {
  it("吊销全部会话 + 作废 pending 邀请 + 释放配额；历史署名（credentials 行）原封不动", async () => {
    await insertCredential(MEMBER, MEMBER_EMAIL);
    await addOrgMember(ORG, MEMBER, "consultant", null);
    // 该成员名下一条尚未接受的 pending 邀请（例如重复邀请留下的历史行）。
    await asApp(ORG, (c) =>
      c.query(
        `INSERT INTO org_invites (id, org_id, email, org_role, team_id, status, invited_by, sent_at)
         VALUES ($1, $2, $3, 'consultant', NULL, 'pending', $4, now())`,
        [`oi-f11-remove-${MEMBER}`, ORG, MEMBER_EMAIL, ADMIN],
      ),
    );

    const sessions = trackingSessions();
    sessions.seed(MEMBER, 2);

    const out = await removeOrgMember(
      { repo, sessions },
      { orgId: toOrgId(ORG), actorId: ADMIN, actorOrgRole: "admin", userId: MEMBER },
    );

    expect(out.revokedSessions).toBe(2);
    expect(out.revokedInvites).toBe(1);
    expect(out.quotaReleased).toBe(1);
    expect(out.pendingTasks).toEqual([]);

    // 访问已停用：成员行不在了。
    expect(await membershipExists(ORG, MEMBER)).toBe(false);
    // pending 邀请转 revoked。
    const invite = await asOwner((c) =>
      c.query<{ status: string }>("SELECT status FROM org_invites WHERE id = $1", [`oi-f11-remove-${MEMBER}`]),
    );
    expect(invite.rows[0]?.status).toBe("revoked");

    // ⚠ 历史署名保留：credentials 行原封不动，不是被删除、不是被匿名化。
    const cred = await asOwner((c) =>
      c.query<{ user_id: string; email: string }>("SELECT user_id, email FROM credentials WHERE user_id = $1", [MEMBER]),
    );
    expect(cred.rows).toHaveLength(1);
    expect(cred.rows[0]?.email).toBe(MEMBER_EMAIL);
  });

  it("幂等重放：重复移除返回同一结果（0），配额不重复释放", async () => {
    await insertCredential(MEMBER, MEMBER_EMAIL);
    await addOrgMember(ORG, MEMBER, "consultant", null);
    const sessions = trackingSessions();
    sessions.seed(MEMBER, 1);

    const first = await removeOrgMember(
      { repo, sessions },
      { orgId: toOrgId(ORG), actorId: ADMIN, actorOrgRole: "admin", userId: MEMBER },
    );
    expect(first.quotaReleased).toBe(1);

    const second = await removeOrgMember(
      { repo, sessions },
      { orgId: toOrgId(ORG), actorId: ADMIN, actorOrgRole: "admin", userId: MEMBER },
    );
    expect(second).toEqual({ revokedSessions: 0, revokedInvites: 0, quotaReleased: 0, pendingTasks: [] });
  });

  it("不可自移", async () => {
    const sessions = trackingSessions();
    await expect(
      removeOrgMember(
        { repo, sessions },
        { orgId: toOrgId(ORG), actorId: ADMIN, actorOrgRole: "admin", userId: ADMIN },
      ),
    ).rejects.toMatchObject({ reasonCode: "PROJECT_ROLE_INSUFFICIENT" } satisfies Partial<OrgAdminError>);
    expect(await membershipExists(ORG, ADMIN)).toBe(true);
  });

  it("非管理员调用被拒", async () => {
    await insertCredential(MEMBER, MEMBER_EMAIL);
    await addOrgMember(ORG, MEMBER, "consultant", null);
    const sessions = trackingSessions();
    await expect(
      removeOrgMember(
        { repo, sessions },
        { orgId: toOrgId(ORG), actorId: MEMBER, actorOrgRole: "consultant", userId: ADMIN },
      ),
    ).rejects.toMatchObject({ reasonCode: "PROJECT_ROLE_INSUFFICIENT" } satisfies Partial<OrgAdminError>);
    expect(await membershipExists(ORG, ADMIN)).toBe(true);
  });
});
