/**
 * F22 上半：**一账号归属多组织**（O-12 / UC-1.5 R10 / V10，coverage V5）。
 *
 * ## 四条断言分别防住什么
 *
 * V10 ①「不新建账号」—— 这是唯一能抓住「同邮箱两个账号」的断言。做错时**什么都不报**：
 *   两个账号都能登录，用户的组织按他碰巧记起哪个密码而分裂在两边。
 * V10 ②「新组织创建成功且该账号为其管理员」—— 成员关系两行、都是 admin。
 * V10 ③「切换器出现两个可选组织」—— `Login.out.orgs` 是它的服务端形态。
 * V10 ④ 的服务端形态是：**切换之后服务端认的是新组织**。
 *   ⚠ 这条最容易假绿：`/identity/switch-org` 返回 200 并给出新组织，
 *   而 Guard 的 principal 一动未动。见本文件第三节的永久反证。
 *
 * ## 为什么有一条「解析源码」的断言
 *
 * usecases.md 逐字要求 `switchOrgAtLogin` **不重新实现切换**，而是调
 * `identity.switchOrganization`。这条纪律的失效方式是：有人为了少一层依赖，
 * 在 auth 里把那三个副作用抄一遍。抄完之后**所有行为断言依然全绿**——
 * 直到 identity 那份加了第四个副作用，而抄来的这份没有。
 * 行为测不出来的东西只能结构上测：解析实现文件。
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { auth as A, identity as I } from "@repo/contracts";
import { SESSION_TOKEN_STORE } from "../../src/application/auth/ports";
import type { RedisSessionTokenStore } from "../../src/infrastructure/auth/redis-session-token-store";
import { ensureDatabase, migrateOnce } from "../support/db";
import { ensureRedis } from "../support/auth";
import {
  countCredentials,
  issueInviteCode,
  makeCode,
  membershipsOf,
  readVerificationTokens,
  resetAuthFixtures,
  resetOrgsOwnedBy,
} from "../support/auth-db";

process.env.KERNEL_QUIET = "1";

const DOMAIN = "f22multi.test";
const EMAIL = `founder@${DOMAIN}`;
const PASSWORD = "correct-horse-battery-staple";
// open-self-serve-registration delta (issue #1929): the initial onboarding step used to
// spend an invite code (`/auth/register`, now removed); onboarding is now open registration
// and needs none. CODE_B is the one code this file still spends for real, through the
// UNTOUCHED `joinOrgWithInvite` (F22) path -- becoming admin of a SECOND org.
const CODE_B = makeCode("F22MULTIB");
const OUTSIDER_EMAIL = `outsider@${DOMAIN}`;

let BASE: string;
let app: NestExpressApplication;
let sessions: RedisSessionTokenStore;

const post = (path: string, body: unknown, token?: string) =>
  fetch(`${BASE}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });

/** 开放注册 + 完成邮箱验证 + 登录，返回 token 与 userId。 */
async function onboard(email: string, orgName: string) {
  const reg = await post("/auth/register-open", {
    email,
    password: PASSWORD,
    displayName: "Founder",
    orgName,
  });
  expect(reg.status, await reg.clone().text()).toBe(201);
  const { userId, orgId } = (await reg.json()) as { userId: string; orgId: string };

  const [challenge] = await readVerificationTokens(userId);
  const { HmacEmailVerificationTokenCodec, emailVerificationSecret } = await import(
    "../../src/infrastructure/auth/email-verification-token-codec"
  );
  const codec = new HmacEmailVerificationTokenCodec(emailVerificationSecret());
  const confirmed = await post("/auth/email-verifications/confirm", {
    token: codec.tokenForChallenge(challenge!.id),
  });
  expect(confirmed.status, await confirmed.clone().text()).toBe(201);

  const res = await post("/auth/login", { email, password: PASSWORD });
  expect(res.status, await res.clone().text()).toBe(200);
  const login = (await res.json()) as { sessionToken: string; orgs: string[] };
  return { userId, orgId, token: login.sessionToken, orgs: login.orgs };
}

beforeAll(async () => {
  ensureDatabase();
  ensureRedis();
  await migrateOnce();
  const { createApp } = await import("../../src/main");
  app = await createApp();
  await app.listen(0);
  const addr = app.getHttpServer().address();
  BASE = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  sessions = app.get<RedisSessionTokenStore>(SESSION_TOKEN_STORE);
}, 180_000);

afterAll(async () => {
  await app?.close();
});

beforeEach(async () => {
  // 作用域清理，从不 TRUNCATE：vitest 并行跑文件、共用一个库，全局清理会在别的文件
  // 跑到一半时删掉它的夹具（support/db.ts 对此有长注）。
  await resetAuthFixtures({ codes: [CODE_B], emailLike: `%@${DOMAIN}` });
  await issueInviteCode(CODE_B);
});

describe("V10 ①②③：已有账号用新邀请码创建第二个组织", () => {
  it("不新建账号，只新增 org_membership，两边都是 admin", async () => {
    const { userId, orgId: orgA, token } = await onboard(EMAIL, "Org A");
    expect(await countCredentials(`%@${DOMAIN}`)).toBe(1);

    const join = await post("/auth/join-org", { code: CODE_B, orgName: "Org B" }, token);
    expect(join.status, await join.clone().text()).toBe(201);
    const body = await join.json();

    // 硬规则 6：响应体逐条对契约。⚠ `.strict()` 才挡得住「多返回一个字段」——
    // zod object 默认剥离未知键，非 strict 的 safeParse 对多字段是瞎的（C7）。
    const parsed = A.operations.joinOrgWithInvite.out.safeParse(body);
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
    const orgB = (body as { orgId: string }).orgId;
    expect(orgB).not.toBe(orgA);

    // V10 ①：账号表记录数不变。**这是全文件最重要的一条**——做错时什么都不报。
    expect(await countCredentials(`%@${DOMAIN}`), "第二个组织不得带来第二个账号").toBe(1);

    // V10 ②：两个组织，都是 admin，同一个 userId。
    //
    // ⚠ 2026-07-29 F16 合并后修正：注册会**自动建一个个人本地组织**（I-2），
    // 所以成员关系是三条而不是两条。断言写成「恰好两条」会在 F16 之后变红，
    // 而正确的性质不是「一共几条」，是「这两个被邀请的组织都在、且都是 admin，
    // 多出来的恰好是那一个本地组织」——本地组织不出现在这里，
    // 它就从组织切换器里消失了，而它确实是这个人所属的组织。
    const m = await membershipsOf(userId);
    const local = m.filter((x) => x.org_id.startsWith("org-local-"));
    const invited = m.filter((x) => !x.org_id.startsWith("org-local-"));
    expect(invited.map((x) => x.org_id).sort()).toEqual([orgA, orgB].sort());
    expect(invited.every((x) => x.org_role === "admin")).toBe(true);
    // I-2：本地组织恰好一个，不多不少。多了说明自动创建不幂等。
    expect(local).toHaveLength(1);

    await resetOrgsOwnedBy([userId]);
  });

  it("V10 ③：重新登录时 orgs 里出现两个组织", async () => {
    const { userId, orgId: orgA, token } = await onboard(EMAIL, "Org A");
    const join = await post("/auth/join-org", { code: CODE_B, orgName: "Org B" }, token);
    const { orgId: orgB } = (await join.json()) as { orgId: string };

    const res = await post("/auth/login", { email: EMAIL, password: PASSWORD });
    const login = (await res.json()) as { orgs: string[] };
    // 同上：orgs 里还有 F16 自动创建的个人本地组织。断言两个被邀请的组织都在、
    // 且本地组织恰好一个，而不是断言总数。
    const invitedOrgs = login.orgs.filter((o) => !o.startsWith("org-local-"));
    expect(invitedOrgs.sort()).toEqual([orgA, orgB].sort());
    expect(login.orgs.filter((o) => o.startsWith("org-local-"))).toHaveLength(1);

    await resetOrgsOwnedBy([userId]);
  });

  it("同一枚码不能加入两次 —— 一码一组织对这条路径同样成立（I-4）", async () => {
    const { userId, token } = await onboard(EMAIL, "Org A");
    const first = await post("/auth/join-org", { code: CODE_B, orgName: "Org B" }, token);
    expect(first.status).toBe(201);

    const second = await post("/auth/join-org", { code: CODE_B, orgName: "Org B2" }, token);
    expect(second.status).toBe(400);
    expect(((await second.json()) as { reasonCode: string }).reasonCode).toBe("INVITE_CODE_INVALID");

    // ⚠ 关键：失败方**不留下半个组织**。只看状态码看不出这件事——
    // 失败的那次完全可能已经把 organizations 那行提交了。
    //
    // 断言的是「被邀请进的组织仍然只有那两个」，不是成员关系总数——
    // F16 之后还有一个自动创建的个人本地组织（I-2），把它算进总数
    // 会让这条断言在一次与它无关的合并里变红。
    const after = await membershipsOf(userId);
    expect(after.filter((x) => !x.org_id.startsWith("org-local-"))).toHaveLength(2);

    await resetOrgsOwnedBy([userId]);
  });

  it("未登录不能加入组织（这条路径的授权是会话，不是邀请码）", async () => {
    const res = await post("/auth/join-org", { code: CODE_B, orgName: "Org B" });
    expect(res.status).toBe(401);
  });
});

describe("V10 ④ / coverage V5：切换组织", () => {
  it("切换成功，且**会话侧**的 currentOrgId 真的变了", async () => {
    const { userId, orgId: orgA, token } = await onboard(EMAIL, "Org A");
    const join = await post("/auth/join-org", { code: CODE_B, orgName: "Org B" }, token);
    const { orgId: orgB } = (await join.json()) as { orgId: string };

    const before = await sessions.findByToken(token);
    expect(before?.currentOrgId).toBe(orgA);

    const res = await post("/auth/switch-org", { toOrgId: orgB }, token);
    expect(res.status, await res.clone().text()).toBe(200);
    const body = await res.json();
    const parsed = A.operations.switchOrgAtLogin.out.safeParse(body);
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
    expect((body as { org: { id: string } }).org.id).toBe(orgB);

    // ⚠ 这一条才是 F22 真正补上的东西：Guard 的 principal 来自这条记录。
    const after = await sessions.findByToken(token);
    expect(after?.currentOrgId, "切换之后服务端认的必须是新组织").toBe(orgB);

    await resetOrgsOwnedBy([userId]);
  });

  /**
   * 永久反证，形态同 `one-code-one-org-concurrency.test.ts` 的 layer 2：
   * **既有的 `/identity/switch-org` 返回 200，而会话侧一动未动。**
   *
   * 它不会空转——只要哪天 identity 那条路由也补上了会话侧，这条断言就会红，
   * 而那正是应该有人来读这段注释、并把 C8 从缺口表里划掉的时刻。
   */
  it("反证 C8：/identity/switch-org 成功了，但 principal 的组织没变", async () => {
    const { userId, orgId: orgA, token } = await onboard(EMAIL, "Org A");
    const join = await post("/auth/join-org", { code: CODE_B, orgName: "Org B" }, token);
    const { orgId: orgB } = (await join.json()) as { orgId: string };

    // ⚠ 201 而不是 200，也是查出来的：`/identity/switch-org` 用的是 Nest 对 POST 的默认
    // 状态码，而切换组织**什么也没创建**。`/auth/switch-org` 显式写了 200。
    // 不在这里顺手改 identity 那条——它属于 identity 束的签核范围（同 F19 对 C7 的处理）。
    const res = await post("/identity/switch-org", { toOrgId: orgB }, token);
    expect(res.status, await res.clone().text()).toBe(201);

    const after = await sessions.findByToken(token);
    expect(
      after?.currentOrgId,
      "identity 那条路由若已补上会话侧，请删掉本条并划掉 KNOWN_CONTRACT_GAPS.C8",
    ).toBe(orgA);

    await resetOrgsOwnedBy([userId]);
  });

  it("切到一个自己不属于的组织 → 404（不泄露它存不存在）", async () => {
    const { userId: outsiderId, orgId: orgC } = await onboard(
      OUTSIDER_EMAIL,
      "Org C",
    );
    const { userId, token } = await onboard(EMAIL, "Org A");

    const res = await post("/auth/switch-org", { toOrgId: orgC }, token);
    expect(res.status).toBe(404);

    // 非空转：同一个组织，它自己的成员切得进去。
    const outsiderLogin = (await (
      await post("/auth/login", { email: OUTSIDER_EMAIL, password: PASSWORD })
    ).json()) as { sessionToken: string };
    const own = await post("/auth/switch-org", { toOrgId: orgC }, outsiderLogin.sessionToken);
    expect(own.status, "拒绝必须是隔离，不是瘫痪").toBe(200);

    await resetOrgsOwnedBy([userId, outsiderId]);
  });

  /**
   * ⚠ **这条测试暴露了一个契约与运行时的冲突，如实写在这里。**
   *
   * 契约的 `switchOrgAtLogin.err` 列了 `SESSION_EXPIRED` 与 `SESSION_REVOKED` 两个码，
   * usecases.md 也明写「用户需要知道是『被踢了』还是『太久没用』」。
   * 但全局 `PrincipalGuard` 在 handler 之前就跑：会话失效时它 401 `unauthenticated`，
   * **两种情形一视同仁**，用例里那两个码在 HTTP 上永远到不了调用方。
   *
   * 这不是本 feature 制造的——`validate-session.ts` 的文件头早就写着它把三种情形都收敛成
   * null，因为「Guard 的规则是结构性的」。F22 只是第一个**需要**那个区别的用例。
   * 修法要动 Guard 与 F18 的结构性断言，那属于 `api-kernel` 束的签核范围。
   *
   * ⇒ 断言分两层：HTTP 上断言「被拒」，application 上断言「拒得对」。
   *   只写第一层，两个码就是死代码；只写第二层，就假装 HTTP 上分得清。
   */
  it("会话已被吊销时切换被拒（HTTP 层：401，且 Guard 抹平了两个码）", async () => {
    const { userId, token } = await onboard(EMAIL, "Org A");
    const join = await post("/auth/join-org", { code: CODE_B, orgName: "Org B" }, token);
    const { orgId: orgB } = (await join.json()) as { orgId: string };

    await sessions.revokeAllForUser(userId, new Date());
    const res = await post("/auth/switch-org", { toOrgId: orgB }, token);
    expect(res.status).toBe(401);
    expect(
      ((await res.json()) as { reasonCode?: string }).reasonCode,
      "Guard 若哪天开始转发用例的 reasonCode，请删掉本断言并更新报告里的那条发现",
    ).toBeUndefined();

    await resetOrgsOwnedBy([userId]);
  });

  it("会话已被吊销时切换被拒（application 层：SESSION_REVOKED，不是 SESSION_EXPIRED）", async () => {
    const { userId, token } = await onboard(EMAIL, "Org A");
    const join = await post("/auth/join-org", { code: CODE_B, orgName: "Org B" }, token);
    const { orgId: orgB } = (await join.json()) as { orgId: string };
    await sessions.revokeAllForUser(userId, new Date());

    const { switchOrgAtLogin } = await import("../../src/application/auth/switch-org-at-login");
    const { CLOCK } = await import("../../src/application/auth/ports");
    const {
      AUTHORIZATION_CACHE, DECISION_ID_FACTORY, IDENTITY_REPOSITORY, SESSION_STORE,
    } = await import("../../src/application/identity/ports");
    const { CAPABILITY_REPOSITORY } = await import("../../src/application/identity/capability-ports");
    const { toOrgId } = await import("../../src/domain/org-id");

    // 用**应用自己装配好的**那套依赖，不是 fake：断言的对象是真实会话记录的状态。
    const deps = {
      sessions,
      clock: app.get(CLOCK),
      identity: {
        repo: app.get(IDENTITY_REPOSITORY),
        sessions: app.get(SESSION_STORE),
        cache: app.get(AUTHORIZATION_CACHE),
        capabilities: app.get(CAPABILITY_REPOSITORY),
        ids: app.get(DECISION_ID_FACTORY),
      },
    };

    await expect(
      switchOrgAtLogin(deps, { sessionToken: token, toOrgId: toOrgId(orgB) }),
    ).rejects.toMatchObject({ reason: "SESSION_REVOKED" });

    // 非空转：同一条路径上，一个**活着的**会话切得过去。
    const fresh = (
      (await (await post("/auth/login", { email: EMAIL, password: PASSWORD })).json()) as {
        sessionToken: string;
      }
    ).sessionToken;
    await expect(
      switchOrgAtLogin(deps, { sessionToken: fresh, toOrgId: toOrgId(orgB) }),
    ).resolves.toMatchObject({ org: { id: orgB } });

    await resetOrgsOwnedBy([userId]);
  });
});

/* ───────────────────── 结构断言：不重新实现切换 ───────────────────── */

const SWITCH_SRC = readFileSync(
  fileURLToPath(new URL("../../src/application/auth/switch-org-at-login.ts", import.meta.url)),
  "utf8",
);

/** 去掉注释——注释里点名这三个副作用正是**在解释纪律**，不是违反它。 */
function code(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((l) => !/^\s*\/\//.test(l))
    .join("\n");
}

const REIMPLEMENTED = ["clearProjectScoped", "invalidateUser", ".setOrg("];

describe("usecases.md：switchOrgAtLogin 不重新实现切换，而是调用 identity", () => {
  it("它确实调用了 switchOrganization", () => {
    expect(code(SWITCH_SRC)).toContain("switchOrganization(");
  });

  it("它没有自己复制那三个副作用", () => {
    const found = REIMPLEMENTED.filter((m) => code(SWITCH_SRC).includes(m));
    expect(
      found,
      `switch-org-at-login.ts 自己做了 ${found.join("、")}——` +
        `那是 identity.switchOrganization 的语义。两处各写一遍就是第八次漂移（usecases.md）。`,
    ).toEqual([]);
  });

  it("这条断言不是空转的：它认得出被抄进来的副作用", () => {
    // 没有这一条，上面那条在「匹配器写错了」时也会绿。
    const mutated = code(SWITCH_SRC).replace(
      "const record = await deps.sessions.findByToken",
      "await deps.identity.sessions.clearProjectScoped(x);\n  const record = await deps.sessions.findByToken",
    );
    expect(mutated).not.toBe(code(SWITCH_SRC)); // 变异确实发生了
    expect(REIMPLEMENTED.filter((m) => mutated.includes(m))).toEqual(["clearProjectScoped"]);
  });
});

describe("同名枚举成员必须有机械门控", () => {
  it("auth.NO_ORG_MEMBERSHIP 与 identity.NO_ORG_MEMBERSHIP 字面一致", () => {
    // 两个束各有自己的失败枚举（一个答「你是谁」、一个答「你能做什么」），
    // 不合并是刻意的——但凡有第二份副本，就必须有一道门控盯着它。
    expect(A.AuthReason.options).toContain("NO_ORG_MEMBERSHIP");
    expect(I.PermissionReason.options).toContain("NO_ORG_MEMBERSHIP");
  });
});
