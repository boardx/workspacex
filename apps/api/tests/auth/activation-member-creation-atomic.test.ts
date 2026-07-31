/**
 * 不变量 I-1（V9）：**核销令牌 + 建账号 + 建 org_membership + 标 used 是一个事务。
 * 任何一步失败 ⇒ 全回滚 ⇒ 令牌仍未核销。**
 *
 * ## 「半个成员」长什么样
 *
 * 不是一个错误。是一枚被核销掉、却没换来任何成员身份的令牌——受邀人再点一次链接，
 * 拿到的是「链接已失效，请找管理员重发」，而管理员看到的是「已激活」。
 * 或者反过来：`org_memberships` 里有一行，`org_invites` 却还是 `pending`，
 * 于是同一枚令牌还能再用一次。两种都不会报错，两种都只有靠**数表**才看得见。
 * ⇒ 所以下面每一条回滚用例都断言**四张表**（令牌 / 邀请 / 成员 / 凭据），
 *   而不是断言那个抛出来的错误。
 *
 * ## 并发那一半
 *
 * 同一枚令牌两路同时激活，必须**恰好一个成员**。这条在 SELECT-then-UPDATE 的写法下
 * 两路都会成功、两路都不报错、两个 org_membership（或者一个约束冲突 500），
 * 而条件 UPDATE 的写法下由数据库序列化。与 `one-code-one-org-concurrency.test.ts`
 * 同一类断言，同一个理由。
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
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

const ORG = "org-f10-atomic";
const ADMIN = "u-f10-atomic-admin";

/** 见文件尾的注释：钩子不吃 vitest 默认的 10 秒。 */
const HOOK_TIMEOUT_MS = 60_000;

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
  await asOwner((c) => c.query("DELETE FROM credentials WHERE email LIKE '%@f10atomic.test'"));
  await db?.close();
}, HOOK_TIMEOUT_MS);

beforeEach(async () => {
  await resetOrgs(ORG);
  await asOwner((c) => c.query("DELETE FROM credentials WHERE email LIKE '%@f10atomic.test'"));
  fixture = await seedOrg({ orgId: ORG, teamNames: ["energy"], projectId: `${ORG}-p` });
  await addOrgMember(ORG, ADMIN, "admin", fixture.teams.energy!);
}, HOOK_TIMEOUT_MS);

async function invite(email: string) {
  return inviteOrgMember(
    { repo },
    {
      orgId: toOrgId(ORG),
      actorId: ADMIN,
      actorOrgRole: "admin",
      email,
      orgRole: "consultant",
      teamId: fixture.teams.energy!,
    },
  );
}

/** 四张表一次读完 —— 「半个成员」只有把它们摆在一起才看得见。 */
async function snapshot(inviteId: string, emailLike: string) {
  return asApp(ORG, async (c) => {
    const tok = await c.query(
      "SELECT consumed_at FROM org_invite_tokens WHERE invite_id = $1",
      [inviteId],
    );
    const inv = await c.query(
      "SELECT status, used_by_user_id, used_at FROM org_invites WHERE id = $1",
      [inviteId],
    );
    const mem = await c.query(
      "SELECT count(*)::int AS n FROM org_memberships WHERE org_id = $1 AND user_id <> $2",
      [ORG, ADMIN],
    );
    const cred = await c.query("SELECT count(*)::int AS n FROM credentials WHERE email LIKE $1", [
      emailLike,
    ]);
    return {
      tokenConsumed: tok.rows[0]?.consumed_at !== null && tok.rows[0]?.consumed_at !== undefined,
      inviteStatus: inv.rows[0]?.status ?? null,
      inviteUsedBy: inv.rows[0]?.used_by_user_id ?? null,
      members: mem.rows[0].n as number,
      credentials: cred.rows[0].n as number,
    };
  });
}

const EMAIL_LIKE = "%@f10atomic.test";

function activateRaw(token: string, userId: string, over: Record<string, unknown> = {}) {
  return repo.activate({
    token,
    now: new Date(),
    newAccount: { userId, displayName: "a", passwordHash: fakeHasher.canned },
    existingUserId: null,
    untrustedClaims: NO_CLAIMS,
    ...over,
  } as Parameters<typeof repo.activate>[0]);
}

describe("成功路径：四张表一起前进", () => {
  it("令牌已核销 · 邀请 used 且记了谁用的 · 成员 1 · 凭据 1", async () => {
    const inv = await invite("ok@f10atomic.test");
    const before = await snapshot(inv.inviteId, EMAIL_LIKE);
    expect(before).toMatchObject({
      tokenConsumed: false,
      inviteStatus: "pending",
      inviteUsedBy: null,
      members: 0,
      credentials: 0,
    });

    const r = await activateRaw(inv.token!, "u-f10-atomic-ok");
    expect(r.ok).toBe(true);

    const after = await snapshot(inv.inviteId, EMAIL_LIKE);
    expect(after).toMatchObject({
      tokenConsumed: true,
      inviteStatus: "used",
      inviteUsedBy: "u-f10-atomic-ok",
      members: 1,
      credentials: 1,
    });
  });
});

describe("回滚路径：任何一步失败 ⇒ 四张表全部回到原样，**令牌仍未核销**", () => {
  it("邮箱已有账号（撞 credentials_email_uniq）⇒ 令牌未核销、邀请仍 pending、无成员", async () => {
    const inv = await invite("dup@f10atomic.test");
    // 同一个邮箱先被别的账号占掉。
    await asOwner((c) =>
      c.query(
        `INSERT INTO credentials (user_id, email, display_name, password_hash, email_verified_at)
         VALUES ($1, $2, $3, $4, now())`,
        ["u-f10-atomic-squatter", "dup@f10atomic.test", "s", fakeHasher.canned],
      ),
    );

    const r = await activateRaw(inv.token!, "u-f10-atomic-dup");
    expect(r).toMatchObject({ ok: false, reason: "already-member" });

    const after = await snapshot(inv.inviteId, EMAIL_LIKE);
    // 🔴 这一条是 I-1 的整句话：**事务失败后 token 仍未核销**。
    // 如果核销是单独一次提交，这里会是 true，而受邀人从此再也进不来，
    // 且没有任何东西会报错。
    expect(after.tokenConsumed).toBe(false);
    expect(after.inviteStatus).toBe("pending");
    expect(after.inviteUsedBy).toBeNull();
    expect(after.members).toBe(0);
    // 占位的那一条还在，激活那条没建出来。
    expect(after.credentials).toBe(1);
  });

  it("入参形状不合法（既没有新账号也没有已登录身份）⇒ 同样全回滚", async () => {
    const inv = await invite("shape@f10atomic.test");
    const r = await repo.activate({
      token: inv.token!,
      now: new Date(),
      newAccount: null,
      existingUserId: null,
      untrustedClaims: NO_CLAIMS,
    });
    expect(r).toMatchObject({ ok: false, reason: "not-found" });

    const after = await snapshot(inv.inviteId, EMAIL_LIKE);
    expect(after.tokenConsumed).toBe(false);
    expect(after.inviteStatus).toBe("pending");
    expect(after.members).toBe(0);
    expect(after.credentials).toBe(0);
  });

  it("邀请在激活途中被撤销（E7）⇒ 令牌未核销、无成员、无凭据", async () => {
    const inv = await invite("revoked@f10atomic.test");
    await asApp(ORG, (c) =>
      c.query("UPDATE org_invites SET status = 'revoked' WHERE id = $1", [inv.inviteId]),
    );

    const r = await activateRaw(inv.token!, "u-f10-atomic-revoked");
    expect(r).toMatchObject({ ok: false, reason: "not-found" });

    const after = await snapshot(inv.inviteId, EMAIL_LIKE);
    expect(after.tokenConsumed).toBe(false);
    expect(after.members).toBe(0);
    expect(after.credentials).toBe(0);
  });
});

describe("并发：同一枚令牌两路同时激活 ⇒ 恰好一个成员", () => {
  it("一路成功一路 not-found，且成员数是 1 不是 2", async () => {
    const inv = await invite("race@f10atomic.test");

    // 两路真并发，不是两次顺序调用：顺序调用下 SELECT-then-UPDATE 的错误写法
    // 也会「第二次失败」，于是那种写法能测绿。
    const [a, b] = await Promise.all([
      activateRaw(inv.token!, "u-f10-atomic-race-a").catch((e) => e as Error),
      activateRaw(inv.token!, "u-f10-atomic-race-b").catch((e) => e as Error),
    ]);

    const oks = [a, b].filter((r) => !(r instanceof Error) && r.ok === true);
    expect(oks).toHaveLength(1);

    const after = await snapshot(inv.inviteId, EMAIL_LIKE);
    expect(after.members).toBe(1);
    expect(after.credentials).toBe(1);
    expect(after.inviteStatus).toBe("used");
  });
});

describe("反证：把核销从条件 UPDATE 改成「先查后写」，并发那条当场红", () => {
  /**
   * 这里不改源码跑子进程（那一手在 tamper 那个文件里做过一次），
   * 而是**直接对着数据库跑那个错误的写法**——因为要证的正是
   * 「这个 SQL 形状在真实并发下会放两路过去」，而它与 TypeScript 无关。
   *
   * ⚠ 若这条反证有一天不红了，含义是数据库的并发行为变了，
   *   `activateAll` 里那条条件 UPDATE 的理由也要重新审。
   */
  it("SELECT-then-UPDATE 的写法下，两路都认为自己抢到了令牌", async () => {
    const inv = await invite("badshape@f10atomic.test");

    async function selectThenUpdate(): Promise<boolean> {
      return asApp(ORG, async (c) => {
        const seen = await c.query(
          "SELECT invite_id FROM org_invite_tokens WHERE token = $1 AND consumed_at IS NULL",
          [inv.token!],
        );
        if (seen.rows.length === 0) return false;
        // 两路都在这里读到了「未核销」，然后都写。
        await new Promise((r) => setTimeout(r, 50));
        await c.query("UPDATE org_invite_tokens SET consumed_at = now() WHERE token = $1", [
          inv.token!,
        ]);
        return true;
      });
    }

    const [a, b] = await Promise.all([selectThenUpdate(), selectThenUpdate()]);
    // 🔴 两路都以为自己赢了。正确写法（条件 UPDATE）下这里是 [true, false]。
    expect([a, b]).toEqual([true, true]);
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
