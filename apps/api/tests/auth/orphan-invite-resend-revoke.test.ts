/**
 * #363（可做的那一半）—— `ResendOrgInvite` / `RevokeOrgInvite` 两条**孤儿契约操作**
 * 接上路由。契约 `org-admin.ts:341` / `:357` 早就存在，controller 里此前零命中。
 *
 * ⚠ 本文件**不覆盖** `GET /organizations/:orgId/members` 与 `…/invites`（列成员 / 列邀请）：
 *   那两条**契约里根本没有**，新增契约操作要走 ADR-023 的设计签核，而
 *   `design-signoff.md` 的 status 只有人类能改。#363 不因本文件关闭。
 *
 * ## 三条反证，写在这里而不是留给下一个人重新想
 *
 * A（授权断的是**调用点**，不是名字在不在文件里）：`NON-ADMIN` 那两个 it 断言的是
 *   **副作用没发生**——顾问调用 resend 之后 `org_invite_tokens` 的行数纹丝不动、
 *   调用 revoke 之后 `status` 仍是 `pending`。把 `resend-org-invite.ts` /
 *   `revoke-org-invite.ts` 里那行 `if (actorOrgRole !== "admin") throw` **注释掉**，
 *   这两条当场红：顾问的调用会成功，令牌多一行、状态翻成 revoked。
 *   ⚠ 刻意**不**写 `expect(source).toContain("actorOrgRole")` 这一类断言——今天有一颗
 *     钉子正是这么写的，命中的是私有方法**定义本身**，把调用整行注释掉依然全绿。
 *
 * C（令牌只在签发那一次响应里出现——2026-08-11 随 coord-main 裁决 A 反转）：
 *   原断言是「resend 返回体不含令牌值」；裁决 A（invite-link-and-reads delta ①）把
 *   它改成两半：**签发那一次**响应里的 `activationToken` 与库里在案的活令牌是同一枚
 *   （正例），而**再查列表**（第二个管理员视角）搜不到那个值（「随时可再读」仍封死，
 *   搜的是值本身不是字段名）。旧断言防的威胁没有被放松，只是把「一次」从 0 改成 1。
 *
 * B（红落在目标那一步之后）：每个 describe 里的断言按「先证明前提成立、再证明目标」
 *   排列——例如反证 A 的两个 it 都先 `expect(before).toBe(...)` 确认起始状态，
 *   再调用、再断言副作用。摘掉授权后红的是最后那条，前面的仍绿。
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { orgAdmin as C } from "@repo/contracts";
import { auth as A } from "@repo/contracts";
import { inviteOrgMember } from "../../src/application/auth/invite-org-member";
import { activateOrgMember } from "../../src/application/auth/activate-org-member";
import { OrgAdminError } from "../../src/application/auth/org-invite-errors";
import { PgOrgInviteRepository } from "../../src/infrastructure/auth/pg-org-invite-repository";
import { PgOrgProfileRepository } from "../../src/infrastructure/auth/pg-org-profile-repository";
import { PgIdentityRepository } from "../../src/infrastructure/identity/pg-identity-repository";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { appConfig } from "../../src/infrastructure/db/pg-config";
import { OrgAdminManagementController } from "../../src/interface/controllers/org-admin-management.controller";
import { toOrgId } from "../../src/domain/org-id";
import type { Principal } from "../../src/domain/principal";
import { addOrgMember, asApp, asOwner, ensureDatabase, migrateOnce, resetOrgs, seedOrg } from "../support/db";
import { fakeHasher, fakeSessions, fakeTokens, NO_CLAIMS } from "../support/org-invite";

const ORG = "org-363-resend";
const OTHER_ORG = "org-363-other";
const ADMIN = "u-363-admin";
const ADMIN_B = "u-363-admin-b";
const CONSULTANT = "u-363-consultant";
const OUTSIDER = "u-363-outsider";

const HOOK_TIMEOUT_MS = 60_000;

let db: PgDatabase;
let repo: PgOrgInviteRepository;
let controller: OrgAdminManagementController;

/**
 * ⚠ `principal.orgId` 是「这个会话当前落在哪个组织」，**不是**授权依据——
 * 授权读的是路径参数那个 org 下的成员关系（`requireAdminRole`）。所以外组织管理员
 * 的 principal 带的是他自己的 OTHER_ORG，而请求打的是 ORG，这正是越权的真实形状。
 */
const principal = (userId: string, orgId = ORG): Principal => ({ userId, orgId: toOrgId(orgId) });

/** Nest 的 HttpException：状态与响应体只从 getter 读，不摸私有字段。 */
async function catchHttp(fn: () => Promise<unknown>): Promise<{ status: number; body: unknown }> {
  try {
    await fn();
  } catch (e) {
    const ex = e as { getStatus?: () => number; getResponse?: () => unknown };
    if (typeof ex.getStatus === "function" && typeof ex.getResponse === "function") {
      return { status: ex.getStatus(), body: ex.getResponse() };
    }
    throw e;
  }
  throw new Error("expected the call to reject, it resolved");
}

async function setSeatQuota(orgId: string, n: number): Promise<void> {
  await asApp(orgId, (c) => c.query("UPDATE organizations SET seat_quota = $2 WHERE id = $1", [orgId, n]));
}

async function tokenRows(inviteId: string): Promise<{ token: string; consumed_at: Date | null }[]> {
  const r = await asOwner((c) =>
    c.query<{ token: string; consumed_at: Date | null }>(
      "SELECT token, consumed_at FROM org_invite_tokens WHERE invite_id = $1 ORDER BY issued_at",
      [inviteId],
    ),
  );
  return r.rows;
}

async function liveToken(inviteId: string): Promise<string> {
  const rows = await tokenRows(inviteId);
  const live = rows.filter((r) => r.consumed_at === null);
  expect(live.length, "恰好一枚可用令牌（org_invite_tokens_live_uniq）").toBe(1);
  return live[0]!.token;
}

async function inviteStatus(inviteId: string): Promise<string | null> {
  const r = await asOwner((c) =>
    c.query<{ status: string }>("SELECT status FROM org_invites WHERE id = $1", [inviteId]),
  );
  return r.rows[0]?.status ?? null;
}

/** 把令牌的 issued_at 往前推 n 秒，好在不 sleep 的情况下越过冷却窗口。 */
async function ageTokens(inviteId: string, seconds: number): Promise<void> {
  await asOwner((c) =>
    c.query("UPDATE org_invite_tokens SET issued_at = issued_at - ($2 || ' seconds')::interval WHERE invite_id = $1", [
      inviteId,
      String(seconds),
    ]),
  );
}

async function newInvite(email: string, orgRole = "consultant"): Promise<string> {
  const out = await inviteOrgMember(
    { repo },
    { orgId: toOrgId(ORG), actorId: ADMIN, actorOrgRole: "admin", email, orgRole, teamId: null },
  );
  return out.inviteId;
}

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  db = new PgDatabase(appConfig());
  repo = new PgOrgInviteRepository(db);
  controller = new OrgAdminManagementController(
    repo,
    // 本文件只调 resend / revoke 两条路由，其余四个端口不参与——给 null 而不是
    // 一个假件：假件会让「某天有人把 teams 的判断挪进 resend」这件事悄悄通过。
    null as never,
    null as never,
    // #363 时不参与；2026-08-11 起参与——反证 C 的「随时可再读」半边要打真实的
    // `listInvites`（对象存储不在这些用例的路径上，仍给 null）。
    new PgOrgProfileRepository(db, null as never),
    null as never,
    new PgIdentityRepository(db),
    null as never, // #638 迭代 4：新增的 PROVENANCE_WRITER，同样不参与,
    null as never,  // F160 token 额度仓储：本文件不调那三条路由,
    null as never,  // F162 限额规则仓储：本文件不调那五条路由
  );
}, HOOK_TIMEOUT_MS);

afterAll(async () => {
  await resetOrgs(ORG, OTHER_ORG);
  await db?.close();
}, HOOK_TIMEOUT_MS);

beforeEach(async () => {
  await resetOrgs(ORG, OTHER_ORG);
  await seedOrg({ orgId: ORG, projectId: `${ORG}-p` });
  await seedOrg({ orgId: OTHER_ORG, projectId: `${OTHER_ORG}-p` });
  await setSeatQuota(ORG, 20);
  await setSeatQuota(OTHER_ORG, 20);
  await addOrgMember(ORG, ADMIN, "admin", null);
  await addOrgMember(ORG, ADMIN_B, "admin", null);
  await addOrgMember(ORG, CONSULTANT, "consultant", null);
  await addOrgMember(OTHER_ORG, OUTSIDER, "admin", null);
});

/* ═══════════════════════ I-6：重发 = 新令牌 + 旧令牌作废 ═══════════════════════ */

describe("ResendOrgInvite —— I-6", () => {
  it("签发新令牌**并且**作废旧令牌，旧链接当场换不到成员", async () => {
    const inviteId = await newInvite("i6@363.test");
    const oldToken = await liveToken(inviteId);
    await ageTokens(inviteId, A.AUTH_POLICY.resendCooldownSeconds + 1);

    const out = await controller.resend(ORG, inviteId, { orgId: ORG, inviteId }, principal(ADMIN));
    expect(out.newTokenIssued).toBe(true);
    expect(out.cooldownSec).toBe(A.AUTH_POLICY.resendCooldownSeconds);

    // 前提：确实多了一枚，且旧的那枚已被作废。
    const rows = await tokenRows(inviteId);
    expect(rows.length).toBe(2);
    expect(rows.find((r) => r.token === oldToken)?.consumed_at).not.toBeNull();

    const newToken = await liveToken(inviteId);
    expect(newToken).not.toBe(oldToken);

    // 目标：**旧链接不再能激活**。I-6 的整个意义就是这一条。
    await expect(
      activateOrgMember(
        { repo, hasher: fakeHasher, sessions: fakeSessions(), tokens: fakeTokens() },
        {
          token: oldToken,
          mode: "new-account",
          profile: { name: "旧链接", password: "correct-horse-battery" },
          existingUserId: null,
          untrustedClaims: NO_CLAIMS,
        },
      ),
    ).rejects.toMatchObject({ reasonCode: "INVITE_NOT_FOUND" });

    // 而新链接可以。（否则上一条断言在一个「两枚都作废了」的实现上也是绿的。）
    const activated = await activateOrgMember(
      { repo, hasher: fakeHasher, sessions: fakeSessions(), tokens: fakeTokens() },
      {
        token: newToken,
        mode: "new-account",
        profile: { name: "新链接", password: "correct-horse-battery" },
        existingUserId: null,
        untrustedClaims: NO_CLAIMS,
      },
    );
    expect(activated.orgId).toBe(ORG);
  });

  it("冷却窗口内的第二次重发被拒（RATE_LIMITED），且**不产生第二枚令牌**", async () => {
    const inviteId = await newInvite("cooldown@363.test");
    await ageTokens(inviteId, A.AUTH_POLICY.resendCooldownSeconds + 1);
    await controller.resend(ORG, inviteId, { orgId: ORG, inviteId }, principal(ADMIN));
    const before = (await tokenRows(inviteId)).length;
    expect(before).toBe(2);

    expect(await catchHttp(() => controller.resend(ORG, inviteId, { orgId: ORG, inviteId }, principal(ADMIN)))).toEqual({
      status: 429,
      body: { reasonCode: "RATE_LIMITED" },
    });

    expect((await tokenRows(inviteId)).length, "被限流的重发不留下任何行").toBe(before);
  });

  it("24 小时内签发数达到 resendDailyMax 后拒绝，即便冷却已过", async () => {
    const inviteId = await newInvite("daily@363.test");
    // 初次邀请已经签发了 1 枚；再重发到刚好 dailyMax 枚。
    for (let n = 1; n < A.AUTH_POLICY.resendDailyMax; n += 1) {
      await ageTokens(inviteId, A.AUTH_POLICY.resendCooldownSeconds + 1);
      await controller.resend(ORG, inviteId, { orgId: ORG, inviteId }, principal(ADMIN));
    }
    expect((await tokenRows(inviteId)).length).toBe(A.AUTH_POLICY.resendDailyMax);

    // 冷却推过去，剩下唯一挡住它的就是日上限。
    await ageTokens(inviteId, A.AUTH_POLICY.resendCooldownSeconds + 1);
    expect(await catchHttp(() => controller.resend(ORG, inviteId, { orgId: ORG, inviteId }, principal(ADMIN)))).toEqual({
      status: 429,
      body: { reasonCode: "RATE_LIMITED" },
    });
  });

  it("`awaiting-review` 的管理员邀请不可重发（I-3：复核前不签发）", async () => {
    const inviteId = await newInvite("adm@363.test", "admin");
    expect(await inviteStatus(inviteId)).toBe("awaiting-review");
    expect(await tokenRows(inviteId)).toEqual([]);

    expect(
      await catchHttp(() => controller.resend(ORG, inviteId, { orgId: ORG, inviteId }, principal(ADMIN_B))),
    ).toEqual({ status: 409, body: { reasonCode: "VERSION_CHANGED" } });

    expect(await tokenRows(inviteId), "重发不得绕过双人复核签出令牌").toEqual([]);
  });
});

/* ═══════════════════════ 撤销 ═══════════════════════ */

describe("RevokeOrgInvite", () => {
  it("撤销后链接当场失效，且重复撤销幂等（返回同一 revoked，时间戳不刷新）", async () => {
    const inviteId = await newInvite("rev@363.test");
    const token = await liveToken(inviteId);

    const first = await controller.revoke(ORG, inviteId, { orgId: ORG, inviteId }, principal(ADMIN));
    expect(first).toEqual({ status: "revoked" });
    expect(await inviteStatus(inviteId)).toBe("revoked");

    await expect(
      activateOrgMember(
        { repo, hasher: fakeHasher, sessions: fakeSessions(), tokens: fakeTokens() },
        {
          token,
          mode: "new-account",
          profile: { name: "撤了", password: "correct-horse-battery" },
          existingUserId: null,
          untrustedClaims: NO_CLAIMS,
        },
      ),
    ).rejects.toMatchObject({ reasonCode: "INVITE_NOT_FOUND" });

    const second = await controller.revoke(ORG, inviteId, { orgId: ORG, inviteId }, principal(ADMIN_B));
    expect(second, "幂等：同一状态，不是 VERSION_CHANGED").toEqual({ status: "revoked" });
  });

  it("已激活的邀请撤不回去（VERSION_CHANGED，不是静默成功）", async () => {
    const inviteId = await newInvite("used@363.test");
    const token = await liveToken(inviteId);
    await activateOrgMember(
      { repo, hasher: fakeHasher, sessions: fakeSessions(), tokens: fakeTokens() },
      {
        token,
        mode: "new-account",
        profile: { name: "已进来", password: "correct-horse-battery" },
        existingUserId: null,
        untrustedClaims: NO_CLAIMS,
      },
    );
    expect(await inviteStatus(inviteId)).toBe("used");

    expect(
      await catchHttp(() => controller.revoke(ORG, inviteId, { orgId: ORG, inviteId }, principal(ADMIN))),
    ).toEqual({ status: 409, body: { reasonCode: "VERSION_CHANGED" } });
    expect(await inviteStatus(inviteId), "撤销邀请不该把一个已建好的成员的凭据改掉").toBe("used");
  });
});

/* ═══════ 反证 A：授权。断的是**调用点**，不是名字在不在文件里 ═══════ */

describe("NON-ADMIN 反证 A —— 摘掉授权检查这两条必须红", () => {
  it("组织内的顾问 resend → 403，且 org_invite_tokens 一行不多", async () => {
    const inviteId = await newInvite("authz-resend@363.test");
    await ageTokens(inviteId, A.AUTH_POLICY.resendCooldownSeconds + 1);
    const before = (await tokenRows(inviteId)).length;
    expect(before, "前提：这条邀请此刻恰好一枚令牌，且冷却已过（否则限流会替授权背锅）").toBe(1);

    expect(
      await catchHttp(() => controller.resend(ORG, inviteId, { orgId: ORG, inviteId }, principal(CONSULTANT))),
    ).toEqual({ status: 403, body: { reasonCode: "PROJECT_ROLE_INSUFFICIENT" } });

    // 🔴 目标断言：**副作用没发生**。摘掉 `resend-org-invite.ts` 里那行角色判断后，
    //    顾问的调用会成功，这里变成 2，当场红。
    expect((await tokenRows(inviteId)).length).toBe(before);
  });

  it("组织内的顾问 revoke → 403，且 status 仍是 pending", async () => {
    const inviteId = await newInvite("authz-revoke@363.test");
    expect(await inviteStatus(inviteId), "前提").toBe("pending");

    expect(
      await catchHttp(() => controller.revoke(ORG, inviteId, { orgId: ORG, inviteId }, principal(CONSULTANT))),
    ).toEqual({ status: 403, body: { reasonCode: "PROJECT_ROLE_INSUFFICIENT" } });

    // 🔴 目标断言：摘掉 `revoke-org-invite.ts` 那行角色判断后，这里变成 "revoked"。
    expect(await inviteStatus(inviteId)).toBe("pending");
  });

  it("别的组织的管理员既进不来也撤不掉（组织成员资格先于角色）", async () => {
    const inviteId = await newInvite("cross-org@363.test");
    for (const call of [
      () => controller.resend(ORG, inviteId, { orgId: ORG, inviteId }, principal(OUTSIDER, OTHER_ORG)),
      () => controller.revoke(ORG, inviteId, { orgId: ORG, inviteId }, principal(OUTSIDER, OTHER_ORG)),
    ]) {
      expect(await catchHttp(call)).toEqual({ status: 403, body: { reasonCode: "NO_ORG_MEMBERSHIP" } });
    }
    expect(await inviteStatus(inviteId)).toBe("pending");
    expect((await tokenRows(inviteId)).length).toBe(1);
  });
});

/* ═══════════════════════ 防枚举 ═══════════════════════ */

describe("防枚举 —— 不存在的 id 与够不到的 id 不可区分", () => {
  it("管理员拿别人组织的 inviteId，与拿一个纯属捏造的 id，响应逐字节相同", async () => {
    // 一条**真实存在**的邀请，只是它在 OTHER_ORG 里。
    const foreign = await inviteOrgMember(
      { repo },
      {
        orgId: toOrgId(OTHER_ORG),
        actorId: OUTSIDER,
        actorOrgRole: "admin",
        email: "foreign@363.test",
        orgRole: "consultant",
        teamId: null,
      },
    );
    expect(await inviteStatus(foreign.inviteId), "前提：这条邀请确实存在").toBe("pending");

    const shapes: string[] = [];
    for (const id of [foreign.inviteId, "oi-000000000000000000000000"]) {
      for (const call of [
        () => controller.resend(ORG, id, { orgId: ORG, inviteId: id }, principal(ADMIN)),
        () => controller.revoke(ORG, id, { orgId: ORG, inviteId: id }, principal(ADMIN)),
      ]) {
        shapes.push(JSON.stringify(await catchHttp(call)));
      }
    }
    // resend 的两次彼此相同、revoke 的两次彼此相同。
    expect(shapes[0]).toBe(shapes[2]);
    expect(shapes[1]).toBe(shapes[3]);
    expect(shapes[0]).toContain("INVITE_NOT_FOUND");

    // 而那条外组织的邀请**一点没被动过**。
    expect(await inviteStatus(foreign.inviteId)).toBe("pending");
  });

  it("非管理员的 403 与 inviteId 存不存在无关（判定顺序，不是错误码长得像）", async () => {
    const real = await newInvite("order@363.test");
    const errs: string[] = [];
    for (const id of [real, "oi-not-a-real-invite-id"]) {
      errs.push(
        JSON.stringify(await catchHttp(() => controller.revoke(ORG, id, { orgId: ORG, inviteId: id }, principal(CONSULTANT)))),
      );
    }
    expect(errs[0]).toBe(errs[1]);
  });
});

/* ═══════ 反证 C：令牌只在签发那一次响应里出现 ═══════ */

/**
 * 2026-08-11 改写（invite-link-and-reads delta ①，coord-main 裁决 A）：原断言是
 * 「resend 返回体不含令牌值」，裁决把它反转为「**签发那一次**返回令牌，此外任何
 * 可再读的地方都拿不到」。旧断言防的威胁（任何管理员随时可读他人链接）由下面
 * 第二条守住：**再查列表拿不到 token**——那才是「随时可再读」的形状。
 */
describe("TOKEN ONLY ONCE 反证 C", () => {
  it("resend 的返回体带 activationToken（正是库里那枚新令牌），key 集合逐字等于契约 out", async () => {
    const inviteId = await newInvite("echo@363.test");
    await ageTokens(inviteId, A.AUTH_POLICY.resendCooldownSeconds + 1);

    const out = await controller.resend(ORG, inviteId, { orgId: ORG, inviteId }, principal(ADMIN));
    const token = await liveToken(inviteId);
    expect(token.length, "前提：库里确实有一枚可搜的令牌").toBeGreaterThan(20);

    // 裁决 A 正例：响应里的令牌与库里在案的活令牌是同一枚——不是第二枚、不是旧的。
    expect(out.activationToken).toBe(token);
    expect(Object.keys(out).sort()).toEqual(Object.keys(C.operations.resendOrgInvite.out.shape).sort());
  });

  it("「只此一次」的另一半：再查列表拿不到令牌值（任何管理员都不能事后把链接读出来）", async () => {
    const inviteId = await newInvite("once@363.test");
    await ageTokens(inviteId, A.AUTH_POLICY.resendCooldownSeconds + 1);
    const out = await controller.resend(ORG, inviteId, { orgId: ORG, inviteId }, principal(ADMIN));
    expect(out.activationToken.length, "前提：这次签发确实带出了令牌").toBeGreaterThan(20);

    // 🔴 搜的是**值**，不是字段名——一个叫 `activationLink` 的字段也藏不住。
    // 用第二个管理员查：正是旧注释担心的那个角色（「任何一个管理员把别人的链接读出来」）。
    const listed = await controller.listInvites(ORG, principal(ADMIN_B));
    expect(JSON.stringify(listed)).not.toContain(out.activationToken);
    // 且每行的 key 集合逐字等于契约（`.strict()` 在协议层再守一遍）。
    for (const row of listed.invites) {
      expect(Object.keys(row).sort()).toEqual(
        Object.keys(C.operations.listOrgInvites.out.shape.invites.element.shape).sort(),
      );
    }
  });

  it("revoke 的返回体同样只有契约那一个字段", async () => {
    const inviteId = await newInvite("echo2@363.test");
    const token = await liveToken(inviteId);
    const out = await controller.revoke(ORG, inviteId, { orgId: ORG, inviteId }, principal(ADMIN));
    expect(JSON.stringify(out)).not.toContain(token);
    expect(Object.keys(out).sort()).toEqual(Object.keys(C.operations.revokeOrgInvite.out.shape).sort());
  });
});

/* ═══════════════════════ 契约单一事实源 ═══════════════════════ */

describe("契约是同一个对象，不是长得像", () => {
  it("两条路由的校验 schema 引用自 @repo/contracts", async () => {
    const m = await import("../../src/interface/controllers/org-admin-management.controller");
    expect(m.RESEND_ORG_INVITE_SCHEMA).toBe(C.operations.resendOrgInvite.in);
    expect(m.REVOKE_ORG_INVITE_SCHEMA).toBe(C.operations.revokeOrgInvite.in);
  });

  it("OrgAdminError 抛的码都在契约的闭合枚举里", () => {
    for (const code of ["RATE_LIMITED", "INVITE_NOT_FOUND", "VERSION_CHANGED", "PROJECT_ROLE_INSUFFICIENT"]) {
      expect(() => new OrgAdminError(C.OrgAdminError.parse(code))).not.toThrow();
    }
  });
});
