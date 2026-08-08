/**
 * Addendum A（#638 迭代 1 独立 UIUX 复核后追加，见
 * `phases/phase-01-run-a-project/design-deltas/self-service-profile/contract.md` 「Addendum A」
 * 一节 + `design-signoff.md` 的 `addendum_a_status: confirmed` 独立签核块）。
 *
 * ## 这条文件专门证什么
 *
 * PR #736 之前的状态：`updateOwnProfile` 真的把 `displayName` 写进
 * `credentials.display_name`，界面也弹出"已保存"，但 `resolveIdentity`（`/identity/me`）
 * 不带 `displayName` 字段——所以改名之后，**任何读"显示名"的地方**（不只是这张表单自己）
 * 都读不到新值，包括退出重新登录之后。这不是本地状态问题，是读路径整个不存在。
 *
 * 本文件走的是**真实注册 + 真实邮箱验证 + 真实登录**（跟 `multi-org-membership.test.ts`
 * 同一模式），不是 `x-kernel-test-principal` 那条测试专用捷径——因为要证的正是
 * "退出重新登录"这条链路，捷径本身就绕开了登录，没法证明这个。
 *
 * 反证 C / D 都在这一条测试里按顺序做完：
 *   C：PATCH 改名 → 不重新登录，直接用同一个 token 再 GET 一次 /identity/me → 新名字在。
 *      （这就是"reload 页面"的服务端等价物——前端 reload 后重新调的还是这同一个端点。）
 *   D：退出（丢弃旧 token）→ 用邮箱密码重新走一次真实 `/auth/login` → 拿到全新 session →
 *      用新 token GET /identity/me → 新名字仍然在，证明它来自数据库，不是任何一种
 *      内存态/session 态的巧合残留。
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { identity as I } from "@repo/contracts";
import { ensureDatabase, migrateOnce } from "../support/db";
import { ensureRedis } from "../support/auth";
import { issueInviteCode, makeCode, readVerificationTokens, resetAuthFixtures, resetOrgsOwnedBy } from "../support/auth-db";

process.env.KERNEL_QUIET = "1";

const DOMAIN = "f638addendum-a.test";
const EMAIL = `renamer@${DOMAIN}`;
const PASSWORD = "correct-horse-battery-staple";
const CODE = makeCode("F638ADDA");

let BASE: string;
let app: NestExpressApplication;

const post = (path: string, body: unknown, token?: string) =>
  fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });

const patch = (path: string, body: unknown, token: string) =>
  fetch(`${BASE}${path}`, {
    method: "PATCH",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });

const get = (path: string, token: string) => fetch(`${BASE}${path}`, { headers: { authorization: `Bearer ${token}` } });

/** 注册 + 完成邮箱验证 + 登录，返回 token/userId/orgId（同 multi-org-membership.test.ts 的写法）。 */
async function onboard(): Promise<{ userId: string; orgId: string; token: string }> {
  const reg = await post("/auth/register", {
    code: CODE, email: EMAIL, password: PASSWORD, displayName: "原名", orgName: "Addendum A Org",
  });
  expect(reg.status, await reg.clone().text()).toBe(201);
  const { userId, orgId } = (await reg.json()) as { userId: string; orgId: string };

  const [challenge] = await readVerificationTokens(userId);
  const { HmacEmailVerificationTokenCodec, emailVerificationSecret } = await import(
    "../../src/infrastructure/auth/email-verification-token-codec"
  );
  const codec = new HmacEmailVerificationTokenCodec(emailVerificationSecret());
  const confirmed = await post("/auth/email-verifications/confirm", { token: codec.tokenForChallenge(challenge!.id) });
  expect(confirmed.status, await confirmed.clone().text()).toBe(201);

  const res = await post("/auth/login", { email: EMAIL, password: PASSWORD });
  expect(res.status, await res.clone().text()).toBe(200);
  const login = (await res.json()) as { sessionToken: string };
  return { userId, orgId, token: login.sessionToken };
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
}, 180_000);

afterAll(async () => {
  await app?.close();
});

beforeEach(async () => {
  await resetAuthFixtures({ codes: [CODE], emailLike: `%@${DOMAIN}` });
  await issueInviteCode(CODE);
});

describe("改名之后，任何读显示名的地方都要读到新值（不是只有 PATCH 的返回值）", () => {
  it("A: resolveIdentity 的 out 真的带 displayName，且符合契约 schema", async () => {
    const { orgId, token } = await onboard();
    const body = await get(`/identity/me?orgId=${orgId}`, token).then((r) => r.json());
    const parsed = I.operations.resolveIdentity.out.safeParse(body);
    expect(parsed.success ? null : parsed.error.issues, JSON.stringify(body)).toBeNull();
    expect((body as { displayName: string }).displayName).toBe("原名");
  });

  it("B/C/D: 改名 → 同一 session 立刻可读到新值 → 退出重新登录后新值仍在", async () => {
    const { userId, orgId, token } = await onboard();

    // 改名前：resolveIdentity 读到的是注册时填的名字。
    const before = await get(`/identity/me?orgId=${orgId}`, token).then((r) => r.json()) as { displayName: string };
    expect(before.displayName).toBe("原名");

    // 改名：PATCH /identity/me（PR #736 已实现的写路径）。
    const patched = await patch("/identity/me", { displayName: "改名后" }, token);
    expect(patched.status, await patched.clone().text()).toBe(200);
    const patchedBody = (await patched.json()) as { displayName: string };
    expect(patchedBody.displayName).toBe("改名后");

    // C：不重新登录，用同一个 token 再读一次——这是前端"reload 页面"的服务端等价物,
    // 因为 reload 后前端重新调的还是这同一个 resolveIdentity。
    const afterSameSession = await get(`/identity/me?orgId=${orgId}`, token).then((r) => r.json()) as { displayName: string };
    expect(afterSameSession.displayName, "reload 语义：同一账号、新请求，必须读到新名字").toBe("改名后");

    // D：退出（本测试直接丢弃旧 token，不调用 logout 端点——效果等价：不再使用它），
    // 用邮箱密码重新走一次真实登录，拿到全新的 session token。
    const relogin = await post("/auth/login", { email: EMAIL, password: PASSWORD });
    expect(relogin.status, await relogin.clone().text()).toBe(200);
    const { sessionToken: freshToken } = (await relogin.json()) as { sessionToken: string };
    expect(freshToken).not.toBe(token);

    const afterRelogin = await get(`/identity/me?orgId=${orgId}`, freshToken).then((r) => r.json()) as { displayName: string };
    expect(
      afterRelogin.displayName,
      "退出重新登录后新名字必须仍在——证明它来自 credentials 表，不是会话态的巧合残留",
    ).toBe("改名后");

    await resetOrgsOwnedBy([userId]);
  });
});
