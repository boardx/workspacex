/**
 * F03 第二条验证 —— **本 feature 的核心安全不变量：I-32**。
 *
 *   「被踢设备的**下一次**请求即失效，不等自然过期。」
 *
 * ## 这个文件真正要挡住的那个错误实现
 *
 * 一个只把会话从「设备列表」里过滤掉、而不写吊销标记的实现，会让界面看起来完全正确：
 * 点[踢下线]、那一行消失、刷新还是消失。**而被踢的那台设备照常发请求，直到 30 天后自然过期。**
 * 没有任何东西会报错，用户以为自己踢掉了闯入者。
 *
 * ⇒ 所以下面每一处都**先证明被踢的令牌原来能用，再证明踢完立刻不能用**。
 *   只断言「列表里不见了」是这个 feature 最容易通过、也最没有价值的写法。
 *
 * ## 吊销是写标记不是删行（I-7）
 *
 * 删行会让「被踢了」与「这条会话从来不存在」不可分辨，而用户需要分辨：
 * 前者要去改密码，后者不用。所以下面在**存储层**断言记录仍在、`revokedAt` 非空——
 * 这一条无法从 HTTP 401 反推出来。
 *
 * ## 反证
 *
 * 把 `checkSession` 里的 `if (s.revokedAt !== null) return "SESSION_REVOKED";` 删掉，
 * 「踢完下一次请求即 401」那几条必须当场变红。见 issue #55 的反证记录。
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { orgAdmin as COrg } from "@repo/contracts";
import { addOrgMember, ensureDatabase, migrateOnce, resetOrgs, seedOrg } from "../support/db";
import { ensureRedis, resetCredentials, seedCredential } from "../support/auth";
import { SESSION_TOKEN_STORE } from "../../src/application/auth/ports";
import type { RedisSessionTokenStore } from "../../src/infrastructure/auth/redis-session-token-store";
import { checkSession } from "../../src/domain/auth/session-lifetime";

process.env.KERNEL_QUIET = "1";

const ORG = "org-f03-kick";
const PROJECT = "proj-f03-kick";
const USER = "u-f03-kick";
const EMAIL = "owner@f03-kick.test";
const OTHER = "u-f03-kick-other";
const OTHER_EMAIL = "bystander@f03-kick.test";
const PASSWORD = "correct-horse-battery-staple";

const LAPTOP_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const PHONE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1 Safari/604.1";

let BASE: string;
let app: NestExpressApplication;
let sessions: RedisSessionTokenStore;

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
}, 120_000);

afterAll(async () => {
  await app?.close();
});

beforeEach(async () => {
  await resetOrgs(ORG);
  await resetCredentials([USER, OTHER], [EMAIL, OTHER_EMAIL]);
  const fx = await seedOrg({ orgId: ORG, projectId: PROJECT });
  await addOrgMember(ORG, USER, "consultant", fx.teams.energy!);
  await addOrgMember(ORG, OTHER, "consultant", fx.teams.energy!);
  await seedCredential({ userId: USER, email: EMAIL, password: PASSWORD });
  await seedCredential({ userId: OTHER, email: OTHER_EMAIL, password: PASSWORD });
  // PURGE（删）而不是 revoke（标记）：这是 fixture 清理，不是产品行为。
  await sessions.purgeForUser(USER);
  await sessions.purgeForUser(OTHER);
});

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const readJson = (res: Response): Promise<Json> => res.json() as Promise<Json>;

async function loginAs(email: string, userAgent: string): Promise<string> {
  const res = await fetch(`${BASE}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json", "user-agent": userAgent },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  if (res.status !== 200) throw new Error(`login failed with ${res.status}`);
  return (await readJson(res)).sessionToken as string;
}

const listRes = (token: string): Promise<Response> =>
  fetch(`${BASE}/me/sessions`, { headers: { authorization: `Bearer ${token}` } });

/** 「这个令牌下一次请求还通得过吗」——I-32 的全部内容就是这一个问题。 */
async function stillWorks(token: string): Promise<boolean> {
  return (await listRes(token)).status === 200;
}

async function rows(token: string): Promise<Json[]> {
  const res = await listRes(token);
  if (res.status !== 200) throw new Error(`list failed with ${res.status}`);
  return (await readJson(res)).sessions as Json[];
}

function kick(token: string, targetSessionId: string, confirmed: unknown = true): Promise<Response> {
  return fetch(`${BASE}/me/sessions/${encodeURIComponent(targetSessionId)}/revoke`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ targetSessionId, confirmed }),
  });
}

describe("I-32 —— 被踢会话的下一次请求即失效", () => {
  it("踢掉手机后，手机的下一次请求就是 401，而笔记本不受影响", async () => {
    const laptop = await loginAs(EMAIL, LAPTOP_UA);
    const phone = await loginAs(EMAIL, PHONE_UA);

    // 建立前提。少了这两行，下面的「不能用了」对一个从来就不能用的令牌同样成立。
    expect(await stillWorks(laptop)).toBe(true);
    expect(await stillWorks(phone)).toBe(true);

    const phoneRow = (await rows(laptop)).find((r) => r.device === "Safari on iPhone");
    expect(phoneRow).toBeDefined();

    const res = await kick(laptop, phoneRow!.id as string);
    expect(res.status).toBe(200);

    // ⚠ 本 feature 的全部价值就是这一行：**下一次请求**，不是三十天后。
    expect(await stillWorks(phone)).toBe(false);
    // 而且不是「谁都用不了了」——只踢了那一条。
    expect(await stillWorks(laptop)).toBe(true);
  });

  it("被踢的记录仍在存储里、只是被标记了（I-7），不是被删掉", async () => {
    const laptop = await loginAs(EMAIL, LAPTOP_UA);
    const phone = await loginAs(EMAIL, PHONE_UA);
    const phoneRow = (await rows(laptop)).find((r) => r.device === "Safari on iPhone")!;

    expect(await kick(laptop, phoneRow.id as string).then((r) => r.status)).toBe(200);

    // 存储层，不是从 401 反推。
    const stored = await sessions.findByToken(phone);
    expect(stored).not.toBeNull();
    expect(stored!.revokedAt).not.toBeNull();
    // ⚠ 吊销先于过期：用户需要分辨「设备被移除了」和「太久没来」——
    //   前者要去改密码，后者不用。
    expect(checkSession(stored!, Date.now())).toBe("SESSION_REVOKED");

    // 全量列表里它还在（listForUser 不过滤），而设备列表里它不在。
    expect((await sessions.listForUser(USER)).map((s) => s.id)).toContain(phoneRow.id);
    expect((await rows(laptop)).map((r) => r.id)).not.toContain(phoneRow.id);
  });

  it("响应体过契约，且反向断言证明这个 schema 真的会拒绝漂移的 body", async () => {
    const laptop = await loginAs(EMAIL, LAPTOP_UA);
    await loginAs(EMAIL, PHONE_UA);
    const phoneRow = (await rows(laptop)).find((r) => r.device === "Safari on iPhone")!;

    const body = await readJson(await kick(laptop, phoneRow.id as string));
    const S = COrg.operations.kickDeviceSession.out;
    expect(S.safeParse(body).success).toBe(true);
    expect(body.affectedDevice).toBe("Safari on iPhone");
    expect(Number.isNaN(Date.parse(body.revokedAt as string))).toBe(false);

    // 反向：schema 不是摆设。
    expect(S.safeParse({ revokedAt: "x" }).success).toBe(false);
    expect(S.safeParse({ revokedAt: "x", affectedDevice: "d", extra: 1 }).success).toBe(false);
    expect(S.safeParse({ revokedAt: 1, affectedDevice: "d" }).success).toBe(false);
  });
});

describe("二次确认在契约上不可绕", () => {
  it("confirmed 缺失或为 false 都被拒，且此时会话仍然可用", async () => {
    const laptop = await loginAs(EMAIL, LAPTOP_UA);
    const phone = await loginAs(EMAIL, PHONE_UA);
    const phoneRow = (await rows(laptop)).find((r) => r.device === "Safari on iPhone")!;

    expect((await kick(laptop, phoneRow.id as string, false)).status).toBe(400);
    // 拒绝之后**什么都没发生**——一个「校验失败但顺手踢了」的实现在这里变红。
    expect(await stillWorks(phone)).toBe(true);

    const res = await fetch(`${BASE}/me/sessions/${phoneRow.id}/revoke`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${laptop}` },
      body: JSON.stringify({ targetSessionId: phoneRow.id }),
    });
    expect(res.status).toBe(400);
    expect(await stillWorks(phone)).toBe(true);
  });
});

describe("只能踢自己的（usecases.md 的 pre）", () => {
  it("别人的 sessionId 踢不动，且那条会话照常可用", async () => {
    const mine = await loginAs(EMAIL, LAPTOP_UA);
    const theirs = await loginAs(OTHER_EMAIL, PHONE_UA);
    const theirRow = (await rows(theirs))[0]!;

    const res = await kick(mine, theirRow.id as string);
    // 409：目标已经不是你看到的那个状态。⚠ 与「不存在」**同码同状态**——
    // 分开就等于给了一个会话 id 存在性探测器。
    expect(res.status).toBe(409);
    expect((await readJson(res)).reasonCode).toBe("VERSION_CHANGED");

    // 真正要守的是这一条：别人的会话毫发无损。
    expect(await stillWorks(theirs)).toBe(true);
    expect((await sessions.findByToken(theirs))!.revokedAt).toBeNull();
  });

  it("不存在的 sessionId 与别人的 sessionId 返回逐字节相同的响应", async () => {
    const mine = await loginAs(EMAIL, LAPTOP_UA);
    const theirs = await loginAs(OTHER_EMAIL, PHONE_UA);
    const theirRow = (await rows(theirs))[0]!;

    const a = await kick(mine, theirRow.id as string);
    const b = await kick(mine, "sess-does-not-exist-at-all");
    expect(a.status).toBe(b.status);

    // ⚠ `traceId` 每个请求都不同，那是可观测性字段、不是区分信息——
    //   它对两种情况**同样**是随机的，所以不构成分辨通道。剥掉它再逐字节比。
    //   （不剥就写不出这条断言；而写不出这条断言，就没人挡得住将来有人把
    //    「这条不是你的」和「这条不存在」拆成两个 reasonCode。）
    const scrub = (j: Json): string => {
      const { traceId: _traceId, ...rest } = j;
      return JSON.stringify(rest);
    };
    expect(scrub(await readJson(a))).toBe(scrub(await readJson(b)));
  });

  it("路径里没有 userId —— 越权在路由层面就无法表达", () => {
    // 契约把路径定成 `/me/sessions/:targetSessionId/revoke`。
    // 出现 `:userId` 就等于承认「可以指定别人」，然后正确性全靠一句 if，
    // 而那句 if 是可以被后来的人「顺手支持管理员视图」删掉的。
    expect(COrg.operations.kickDeviceSession.path).toBe("/me/sessions/:targetSessionId/revoke");
    expect(COrg.operations.listDeviceSessions.path).toBe("/me/sessions");
    expect(COrg.operations.kickDeviceSession.path).not.toContain(":userId");
    // `in` 里也没有 userId：没有任何入参能指定「替谁踢」。
    expect(Object.keys(COrg.operations.kickDeviceSession.in.shape)).toEqual([
      "targetSessionId",
      "confirmed",
    ]);
  });
});

describe("幂等重放", () => {
  it("重复踢同一条返回同一个 revokedAt，不刷新时间戳", async () => {
    const laptop = await loginAs(EMAIL, LAPTOP_UA);
    await loginAs(EMAIL, PHONE_UA);
    const phoneRow = (await rows(laptop)).find((r) => r.device === "Safari on iPhone")!;

    const first = await readJson(await kick(laptop, phoneRow.id as string));
    // 隔开一点时间，好让「第二次刷新了时间戳」这种实现真的产生一个不同的值。
    await new Promise((r) => setTimeout(r, 50));
    const second = await readJson(await kick(laptop, phoneRow.id as string));

    // ⚠ 刷新时间戳会让「这台设备是什么时候被踢的」得到一个错误答案，
    //   而那是 uc-1-1 R6 要求可审计的事件之一。
    expect(second.revokedAt).toBe(first.revokedAt);
    expect(second.affectedDevice).toBe(first.affectedDevice);
  });

  it("并发两路踢同一条：最终状态唯一，两路拿到同一个 revokedAt", async () => {
    const laptop = await loginAs(EMAIL, LAPTOP_UA);
    const phone = await loginAs(EMAIL, PHONE_UA);
    const phoneRow = (await rows(laptop)).find((r) => r.device === "Safari on iPhone")!;

    const [a, b] = await Promise.all([
      kick(laptop, phoneRow.id as string).then(readJson),
      kick(laptop, phoneRow.id as string).then(readJson),
    ]);
    expect(a.revokedAt).toBe(b.revokedAt);
    expect(await stillWorks(phone)).toBe(false);
    expect((await sessions.listForUser(USER)).filter((s) => s.id === phoneRow.id)).toHaveLength(1);
  });
});

describe("自踢", () => {
  it("踢掉自己当前这条，下一次请求即 401（没有『当前会话豁免』的暗门）", async () => {
    const laptop = await loginAs(EMAIL, LAPTOP_UA);
    const mineRow = (await rows(laptop)).find((r) => r.current === true)!;

    expect((await kick(laptop, mineRow.id as string)).status).toBe(200);
    // ⚠ 一个「当前会话不许踢」的暗门会让这条变红。契约里没有这条豁免，
    //   而「在公用电脑上退出」正是要它。
    expect(await stillWorks(laptop)).toBe(false);
  });
});
