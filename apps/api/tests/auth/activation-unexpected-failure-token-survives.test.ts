/**
 * issue #985 —— devapp 实测事故（2026-08-12）：人类点激活链接撞上部署重启窗口得到 500。
 *
 * `activation-member-creation-atomic.test.ts` 已钉住**业务判定**触发的回滚
 * （邮箱被占 / 入参畸形 / 途中撤销）。但线上那个 500 不是业务判定——
 * 它是**非预期基础设施异常**（进程被杀 / 连接断 / 某条 SQL 意外炸掉）。
 * 这两类失败在代码里走的是不同分支：业务判定抛 `Rollback` 被 `activate` 捕成
 * `{ ok: false }`；非预期异常一路抛穿。共同点必须是：**事务回滚，令牌未核销**。
 *
 * 本文件补的正是那半边反证：
 *   ① 在事务**已核销令牌、已建号、已建成员之后**的一步（标 used）注入一个
 *      非预期异常 ⇒ 断言四张表全部回到原样、令牌未核销；
 *   ② **同一枚令牌重试 ⇒ 激活成功** —— 这是 activate 页上那句
 *      「你的邀请链接不会因这次失败而失效」的全部背书。
 *
 * ⚠ 注入方式是包一层 `DatabasePort` 装饰器、对指定 SQL 抛错——不改源码、
 *   不 mock pg：要证的是「PgDatabase 的事务形状在回调抛任意异常时会 ROLLBACK」，
 *   mock 掉数据库就什么也没证。
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { DatabasePort, TenantSession } from "../../src/application/ports/database.port";
import type { OrgId } from "../../src/domain/org-id";
import { inviteOrgMember } from "../../src/application/auth/invite-org-member";
import { PgOrgInviteRepository } from "../../src/infrastructure/auth/pg-org-invite-repository";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { appConfig } from "../../src/infrastructure/db/pg-config";
import { toOrgId } from "../../src/domain/org-id";
import {
  addOrgMember,
  asApp,
  asOwner,
  ensureDatabase,
  migrateOnce,
  resetOrgs,
  seedOrg,
} from "../support/db";
import { fakeHasher, NO_CLAIMS } from "../support/org-invite";

const ORG = "org-f10-unexpected";
const ADMIN = "u-f10-unexpected-admin";
const EMAIL = "victim@f10unexpected.test";
const HOOK_TIMEOUT_MS = 60_000;

/** 模拟部署重启窗口里那种谁也没判定过的失败。 */
class InfraExplosion extends Error {
  constructor() {
    super("connection reset mid-deploy");
  }
}

/**
 * 对匹配 `pattern` 的第一条 SQL 抛 `InfraExplosion` 的装饰器。
 * 其余查询原样透传——事务、RLS、约束全部真实。
 */
function explodeOn(db: DatabasePort, pattern: RegExp): DatabasePort {
  const wrap = (s: TenantSession): TenantSession => ({
    query: (sql, params) => {
      if (pattern.test(sql)) throw new InfraExplosion();
      return s.query(sql, params);
    },
  });
  return {
    withTenant: (orgId: OrgId, fn) => db.withTenant(orgId, (s) => fn(wrap(s))),
    withoutTenant: (fn) => db.withoutTenant((s) => fn(wrap(s))),
    close: () => db.close(),
  };
}

let db: PgDatabase;
let repo: PgOrgInviteRepository;
let fixture: Awaited<ReturnType<typeof seedOrg>>;

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  db = new PgDatabase(appConfig());
  repo = new PgOrgInviteRepository(db);
}, HOOK_TIMEOUT_MS);

afterAll(async () => {
  await resetOrgs(ORG);
  await asOwner((c) => c.query("DELETE FROM credentials WHERE email LIKE '%@f10unexpected.test'"));
  await db?.close();
}, HOOK_TIMEOUT_MS);

beforeEach(async () => {
  await resetOrgs(ORG);
  await asOwner((c) => c.query("DELETE FROM credentials WHERE email LIKE '%@f10unexpected.test'"));
  fixture = await seedOrg({ orgId: ORG, teamNames: ["energy"], projectId: `${ORG}-p` });
  await addOrgMember(ORG, ADMIN, "admin", fixture.teams.energy!);
}, HOOK_TIMEOUT_MS);

async function invite() {
  return inviteOrgMember(
    { repo },
    {
      orgId: toOrgId(ORG),
      actorId: ADMIN,
      actorOrgRole: "admin",
      email: EMAIL,
      orgRole: "consultant",
      teamId: fixture.teams.energy!,
    },
  );
}

async function snapshot(inviteId: string) {
  return asApp(ORG, async (c) => {
    const tok = await c.query("SELECT consumed_at FROM org_invite_tokens WHERE invite_id = $1", [
      inviteId,
    ]);
    const inv = await c.query("SELECT status, used_by_user_id FROM org_invites WHERE id = $1", [
      inviteId,
    ]);
    const mem = await c.query(
      "SELECT count(*)::int AS n FROM org_memberships WHERE org_id = $1 AND user_id <> $2",
      [ORG, ADMIN],
    );
    const cred = await c.query(
      "SELECT count(*)::int AS n FROM credentials WHERE email LIKE '%@f10unexpected.test'",
    );
    return {
      tokenConsumed: tok.rows[0]?.consumed_at !== null && tok.rows[0]?.consumed_at !== undefined,
      inviteStatus: inv.rows[0]?.status ?? null,
      inviteUsedBy: inv.rows[0]?.used_by_user_id ?? null,
      members: mem.rows[0]!.n as number,
      credentials: cred.rows[0]!.n as number,
    };
  });
}

function activateWith(repoUnderTest: PgOrgInviteRepository, token: string, userId: string) {
  return repoUnderTest.activate({
    token,
    now: new Date(),
    newAccount: { userId, displayName: "受邀人", passwordHash: fakeHasher.canned },
    existingUserId: null,
    untrustedClaims: NO_CLAIMS,
  });
}

describe("非预期异常中途炸掉激活事务 ⇒ 令牌未核销，且同一枚令牌重试成功", () => {
  it("在「标 used」一步（令牌已核销、账号成员已建之后）炸掉 ⇒ 全回滚 ⇒ 重试激活成功", async () => {
    const inv = await invite();

    // ① 注入：`UPDATE org_invites SET status = 'used' …` 是事务的第 (6) 步——
    //    此时令牌已核销、credentials 与 org_memberships 都已 INSERT。
    //    如果这些步骤各自提交，下面的断言会看到「半个成员」。
    const exploding = new PgOrgInviteRepository(
      explodeOn(db, /UPDATE org_invites\s+SET status = 'used'/),
    );
    await expect(activateWith(exploding, inv.token!, "u-f10-unexpected-a")).rejects.toBeInstanceOf(
      InfraExplosion,
    );

    // ② 🔴 I-1 的整句话：四张表全部回到原样，**令牌仍未核销**。
    const after = await snapshot(inv.inviteId);
    expect(after).toMatchObject({
      tokenConsumed: false,
      inviteStatus: "pending",
      inviteUsedBy: null,
      members: 0,
      credentials: 0,
    });

    // ③ 同一枚令牌重试（用没被注入的真实仓储）⇒ 成功。
    //    这一步是 activate 页那句「链接不会因这次失败而失效」的背书：
    //    只有回滚 + 可重试都成立，那句承诺才不是安慰话。
    const retry = await activateWith(repo, inv.token!, "u-f10-unexpected-b");
    expect(retry.ok).toBe(true);

    const final = await snapshot(inv.inviteId);
    expect(final).toMatchObject({
      tokenConsumed: true,
      inviteStatus: "used",
      inviteUsedBy: "u-f10-unexpected-b",
      members: 1,
      credentials: 1,
    });
  });

  it("在建成员一步炸掉（更早）⇒ 同样全回滚、令牌未核销、重试成功", async () => {
    const inv = await invite();

    const exploding = new PgOrgInviteRepository(
      explodeOn(db, /INSERT INTO org_memberships/),
    );
    await expect(activateWith(exploding, inv.token!, "u-f10-unexpected-c")).rejects.toBeInstanceOf(
      InfraExplosion,
    );

    const after = await snapshot(inv.inviteId);
    expect(after.tokenConsumed).toBe(false);
    expect(after.members).toBe(0);
    expect(after.credentials).toBe(0);

    const retry = await activateWith(repo, inv.token!, "u-f10-unexpected-d");
    expect(retry.ok).toBe(true);
  });
});
