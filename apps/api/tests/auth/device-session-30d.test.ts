/**
 * F03 第一条验证 —— 设备与会话列表 + 30 天有效期。
 *
 * ## ⚠ 先说依据等级，因为它决定了这个文件断言什么、不断言什么
 *
 * `feature_list.json` 的 `notes` 与 `KNOWN_CONTRACT_GAPS.OA1` 都逐字写着：
 * **30 天是 `[Backlog]` 数字，不是原型证据**；整块设备/会话能力在原型中是「原型确认缺失」。
 *
 * ⇒ 本文件**刻意不断言字面量 30**。断言 `toBe(30)` 会做两件坏事：
 *   ① 把一个未经裁决的 Backlog 数字钉成测试事实，人类将来改成 14 天时，
 *      红的是测试而不是实现——测试变成了改需求的阻力；
 *   ② 那是「同一事实声明在两处」的第六次（本仓最高发的缺陷），
 *      而漂移方向永远是「有人改了 `AUTH_POLICY`，测试纹丝不动」。
 *
 * 真正被守住的是**链路**：`AUTH_POLICY.sessionDays`（唯一事实源）
 * → `SESSION_TTL_MS` → 登录返回的 `expiresAt` → 会话在那个时刻之前有效、之后失效。
 * 人类把 30 改成 14，整条链跟着走，一条断言都不用改。
 *
 * ## 为什么有「三十天差一分钟」这组端到端断言
 *
 * 只断言 `expiresAt = now + SESSION_TTL_MS` 是不够的：它只证明**响应体里写了什么**。
 * 一个把 TTL 写对、而 Redis key 只存活一天的实现，会让这条断言全绿，
 * 用户第二天却被登出——而没有任何东西会失败。
 * 所以下面真的登录一次，把那条**真实会话**整体挪到「满期差一分钟前」，再拿它去请受保护路由：
 * **它必须还能用**。这一条是唯一能分辨「TTL 真的是 sessionDays」的断言。
 *
 * ⚠ 这条断言的写法被一次反证改写过——第一版用同一个常量既造记录又做位移，
 *   把 TTL 改成 1 天它照样绿（两边的错互相抵消）。详见 `loginThenShiftBack` 的注释。
 *   **反证不是走过场，它这次真的抓到了一条空转的断言。**
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { auth as CAuth, orgAdmin as COrg } from "@repo/contracts";
import { addOrgMember, ensureDatabase, migrateOnce, resetOrgs, seedOrg } from "../support/db";
import { ensureRedis, resetCredentials, seedCredential } from "../support/auth";
import { SESSION_TOKEN_STORE } from "../../src/application/auth/ports";
import type { RedisSessionTokenStore } from "../../src/infrastructure/auth/redis-session-token-store";
import {
  SESSION_TTL_MS,
  checkSession,
  shouldTouchLastActive,
  LAST_ACTIVE_TOUCH_INTERVAL_MS,
  type SessionRecord,
} from "../../src/domain/auth/session-lifetime";
import {
  UNKNOWN_DEVICE,
  describeDevice,
  describeLoginOrigin,
} from "../../src/domain/auth/device-fingerprint";
import { deviceContextOf } from "../../src/interface/device-context";

process.env.KERNEL_QUIET = "1";

const ORG = "org-f03-30d";
const PROJECT = "proj-f03-30d";
const USER = "u-f03-30d";
const EMAIL = "devices@f03-30d.test";
const PASSWORD = "correct-horse-battery-staple";

const CHROME_MAC =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

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
  // 与应用**同一个** store 实例：这样「记录还在、只是标记了」这类断言看的是真实存储，
  // 而不是从一个 401 反推出来的。
  sessions = app.get<RedisSessionTokenStore>(SESSION_TOKEN_STORE);
}, 120_000);

afterAll(async () => {
  await app?.close();
});

beforeEach(async () => {
  await resetOrgs(ORG);
  await resetCredentials([USER], [EMAIL]);
  const fx = await seedOrg({ orgId: ORG, projectId: PROJECT });
  await addOrgMember(ORG, USER, "consultant", fx.teams.energy!);
  await seedCredential({ userId: USER, email: EMAIL, password: PASSWORD });
  // PURGE 而不是 revoke：吊销刻意保留记录（I-7），
  // 用例间吊销会让每个用例都看到上一个用例的会话，计数随文件增长。
  await sessions.purgeForUser(USER);
});

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const readJson = (res: Response): Promise<Json> => res.json() as Promise<Json>;

async function loginAs(userAgent: string): Promise<{ token: string; body: Json }> {
  const res = await fetch(`${BASE}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json", "user-agent": userAgent },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  if (res.status !== 200) throw new Error(`login failed with ${res.status}`);
  const body = await readJson(res);
  return { token: body.sessionToken as string, body };
}

/** 受保护路由 = 本 feature 自己的那条。用它就不必借别的 feature 的探针路由。 */
function listSessions(token: string): Promise<Response> {
  return fetch(`${BASE}/me/sessions`, { headers: { authorization: `Bearer ${token}` } });
}

/** 契约里的有效期。⚠ 从 `AUTH_POLICY.sessionDays` 推，**不写字面量 30**。 */
const CONTRACT_TTL_MS = CAuth.AUTH_POLICY.sessionDays * 24 * 60 * 60 * 1000;

/**
 * 真的登录一次，然后把**那一条真实会话**整体往前挪 `shiftMs`，另存一份。
 *
 * ⚠ 这个绕法是被一次反证逼出来的，值得写清楚。
 *
 * 最初的写法是「自己造一条 `expiresAt = issuedAt + SESSION_TTL_MS` 的记录」。
 * 反证（把 `SESSION_TTL_MS` 改成 1 天）跑出来：**那条端到端断言仍然绿**——
 * 因为它用同一个被改坏的常量去造记录，记录的寿命跟着一起变短又一起挪，
 * 两边的错互相抵消。它测的是「这个常量等于它自己」。
 *
 * 现在改成：寿命 = **登录真正给出的那个寿命**（`expiresAt - issuedAt`，从存储里读回来），
 * 位移 = **契约常量**。两个来源不同，于是把实现的 TTL 改小，
 * 「满期差一分钟前的会话」就真的过期了，断言当场红。
 */
async function loginThenShiftBack(shiftMs: number): Promise<{ token: string; record: SessionRecord }> {
  const { token: liveToken } = await loginAs(CHROME_MAC);
  const real = (await sessions.findByToken(liveToken))!;
  const record: SessionRecord = {
    ...real,
    id: `${real.id}-shift-${Math.random().toString(36).slice(2)}`,
    issuedAt: real.issuedAt - shiftMs,
    // ⚠ 寿命原样保留：`expiresAt - issuedAt` 是登录真正决定的那个值。
    expiresAt: real.expiresAt - shiftMs,
    lastActiveAt: real.lastActiveAt - shiftMs,
  };
  const token = await sessions.issue(record);
  return { token, record };
}

describe("有效期的单一事实源：AUTH_POLICY.sessionDays → SESSION_TTL_MS → expiresAt", () => {
  it("SESSION_TTL_MS 由契约常量推出，不是另写一份天数", () => {
    // ⚠ 断言的是**关系**不是数值。人类把 sessionDays 从 30 改成 14，这条仍然绿；
    //   有人在实现里写死一个天数，这条当场红。
    expect(SESSION_TTL_MS).toBe(CAuth.AUTH_POLICY.sessionDays * 24 * 60 * 60 * 1000);
  });

  it("登录返回的 expiresAt = 登录时刻 + sessionDays", async () => {
    const before = Date.now();
    const { body } = await loginAs(CHROME_MAC);
    const after = Date.now();

    const expiresAt = Date.parse(body.expiresAt as string);
    expect(Number.isNaN(expiresAt)).toBe(false);
    // 用区间而不是等值：登录里跑了一次 bcrypt，几百毫秒。
    expect(expiresAt).toBeGreaterThanOrEqual(before + SESSION_TTL_MS);
    expect(expiresAt).toBeLessThanOrEqual(after + SESSION_TTL_MS);
  });

  it("checkSession 的边界是闭在过期侧的：恰好到点即失效，早一毫秒仍有效", () => {
    const issuedAt = 1_700_000_000_000;
    const s: SessionRecord = {
      id: "s", userId: USER, currentOrgId: ORG,
      issuedAt, expiresAt: issuedAt + SESSION_TTL_MS, revokedAt: null,
      device: "Chrome on macOS", location: null, lastActiveAt: issuedAt,
    };
    expect(checkSession(s, s.expiresAt - 1)).toBeNull();
    // ⚠ `now >= expiresAt`。写成 `>` 会让「恰好到期的那一毫秒」仍然放行——
    //   一毫秒不重要，但一个 `>` 和一个 `>=` 的差别在下一个 feature 里会被复制。
    expect(checkSession(s, s.expiresAt)).toBe("SESSION_EXPIRED");
    expect(checkSession(s, s.expiresAt + 1)).toBe("SESSION_EXPIRED");
  });
});

describe("端到端：有效期真的是 sessionDays，不只是响应体里写的那个数", () => {
  it("『满期差一分钟前』登录的会话仍然可用", async () => {
    const { token } = await loginThenShiftBack(CONTRACT_TTL_MS - 60_000);
    const res = await listSessions(token);
    // 这条是全文件最关键的一条，也是被反证改写过的那条：
    // 位移用契约常量、寿命用登录实际给出的值，所以把实现的 TTL 改小它立刻变红。
    expect(res.status).toBe(200);
  });

  it("『满期多一分钟前』登录的会话，下一次请求即被拒", async () => {
    const { token } = await loginThenShiftBack(CONTRACT_TTL_MS + 60_000);

    // 先证明**记录还在存储里**——否则下面的 401 可能只是「key 被 Redis 回收了」，
    // 那样这条断言就没有在检验 checkSession 的过期判定。
    const stored = await sessions.findByToken(token);
    expect(stored).not.toBeNull();
    expect(stored!.expiresAt).toBeLessThan(Date.now());

    const res = await listSessions(token);
    expect(res.status).toBe(401);
  });
});

describe("设备与登录地点：从传输元数据派生，不是客户端自报", () => {
  it("登录写入设备与地点，并在 /me/sessions 里可见", async () => {
    const { token } = await loginAs(CHROME_MAC);
    const res = await listSessions(token);
    expect(res.status).toBe(200);
    const body = await readJson(res);

    // 响应体逐条过契约（`contract-design.md` 修订 B-8：出去的方向也要被校验）。
    const parsed = COrg.operations.listDeviceSessions.out.safeParse(body);
    expect(parsed.success).toBe(true);

    expect(body.sessions).toHaveLength(1);
    const row = body.sessions[0];
    expect(row.device).toBe("Chrome on macOS");
    // 测试从 127.0.0.1 连上来，所以地点是「本机」。它是**服务端看到的对端地址**，
    // 不是请求里带来的任何东西。
    expect(row.location).toBe("本机");
    expect(row.current).toBe(true);
    expect(Number.isNaN(Date.parse(row.lastActiveAt))).toBe(false);
  });

  it("⚠ 反向断言：契约会拒绝漂移的响应体，所以上面的 safeParse 不是空转", () => {
    const S = COrg.operations.listDeviceSessions.out;
    // 少一个字段
    expect(S.safeParse({ sessions: [{ id: "a", device: "d", location: null, current: true }] }).success).toBe(false);
    // 多一个字段（`.strict()`）
    expect(
      S.safeParse({
        sessions: [{ id: "a", device: "d", location: null, lastActiveAt: "x", current: true, extra: 1 }],
      }).success,
    ).toBe(false);
    // location 不可缺省（可为 null，但键必须在）
    expect(S.safeParse({ sessions: [{ id: "a", device: "d", lastActiveAt: "x", current: true }] }).success).toBe(false);
  });

  it("设备名不带版本号，认不出来时说『未知设备』而不是回吐原始 UA", () => {
    expect(describeDevice(CHROME_MAC)).toBe("Chrome on macOS");
    // Edge 的 UA 里同时有 Chrome/ 和 Safari/：顺序表决定它归 Edge。
    expect(
      describeDevice(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36 Edg/126.0",
      ),
    ).toBe("Edge on Windows");
    expect(describeDevice("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Safari/604.1")).toBe(
      "Safari on iPhone",
    );
    expect(describeDevice(null)).toBe(UNKNOWN_DEVICE);
    expect(describeDevice("")).toBe(UNKNOWN_DEVICE);
    // ⚠ 认不出来时**不得**把原始 UA 当设备名塞进列表。
    const weird = "SomeBot/1.2 (+http://example.test/bot)";
    expect(describeDevice(weird)).toBe(UNKNOWN_DEVICE);
    expect(describeDevice(weird)).not.toContain("1.2");
  });

  it("『地点』是网络来源不是地理定位，且没有地址时是 null 而不是『未知』", () => {
    expect(describeLoginOrigin("127.0.0.1")).toBe("本机");
    // Node 双栈下 IPv4 会带 ::ffff: 前缀；不剥掉，回环会被当成公网地址泄进列表。
    expect(describeLoginOrigin("::ffff:127.0.0.1")).toBe("本机");
    expect(describeLoginOrigin("::1")).toBe("本机");
    expect(describeLoginOrigin("10.0.0.7")).toBe("内网 (10.0.0.7)");
    expect(describeLoginOrigin("192.168.1.9")).toBe("内网 (192.168.1.9)");
    expect(describeLoginOrigin("172.20.3.1")).toBe("内网 (172.20.3.1)");
    // 172.32 不在 RFC1918 里——判据是段不是「172 开头」。
    expect(describeLoginOrigin("172.32.3.1")).toBe("172.32.3.1");
    expect(describeLoginOrigin(null)).toBeNull();
    expect(describeLoginOrigin("   ")).toBeNull();
  });

  it("⚠ X-Forwarded-For 不被信任：客户端伪造的地点进不了会话", () => {
    const ctx = deviceContextOf({
      headers: { "user-agent": CHROME_MAC, "x-forwarded-for": "203.0.113.9" },
      socket: { remoteAddress: "127.0.0.1" },
    });
    // 伪造值出现在结果里，就等于任何人都能让自己的登录记录显示成任意地址——
    // 而这一列的全部用处是让用户认出「这次登录不是我」。
    expect(ctx.location).toBe("本机");
    expect(ctx.location).not.toContain("203.0.113.9");
  });
});

describe("最后活跃：这一列必须真的会动", () => {
  it("节流规则本身可断言：窗口内不写，窗口到了才写", () => {
    const base: SessionRecord = {
      id: "s", userId: USER, currentOrgId: ORG,
      issuedAt: 1_000_000, expiresAt: 1_000_000 + SESSION_TTL_MS, revokedAt: null,
      device: "Chrome on macOS", location: null, lastActiveAt: 1_000_000,
    };
    expect(shouldTouchLastActive(base, 1_000_000)).toBe(false);
    expect(shouldTouchLastActive(base, 1_000_000 + LAST_ACTIVE_TOUCH_INTERVAL_MS - 1)).toBe(false);
    expect(shouldTouchLastActive(base, 1_000_000 + LAST_ACTIVE_TOUCH_INTERVAL_MS)).toBe(true);
  });

  it("一条老会话被使用后，lastActiveAt 被推到现在（而不是停在登录时刻）", async () => {
    // 起始 lastActiveAt = issuedAt，远早于节流窗口，所以下一次请求必定写一次。
    const { token, record } = await loginThenShiftBack(CONTRACT_TTL_MS - 60_000);
    expect((await sessions.findByToken(token))!.lastActiveAt).toBe(record.lastActiveAt);

    const res = await listSessions(token);
    expect(res.status).toBe(200);

    const after = await sessions.findByToken(token);
    expect(after!.lastActiveAt).toBeGreaterThan(record.lastActiveAt);
    // ⚠ 而且没有顺手延寿：`touch` 用 KEEPTTL，到期时刻一毫秒都不许动。
    //   少了它，一个每分钟被访问一次的会话就永不过期——30 天上限被一个展示字段取消掉，
    //   而没有任何东西会报错。
    expect(after!.expiresAt).toBe(record.expiresAt);
  });
});

describe("I-33：一次登录恰好一条设备会话", () => {
  it("登录一次 → 一条；再登录一次 → 两条，且 id 互不相同", async () => {
    const first = await loginAs(CHROME_MAC);
    expect(await sessions.listForUser(USER)).toHaveLength(1);

    const second = await loginAs("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Safari/604.1");
    const all = await sessions.listForUser(USER);
    expect(all).toHaveLength(2);
    expect(new Set(all.map((s) => s.id)).size).toBe(2);

    // 两条会话的设备名来自各自的 UA，不是同一个值复制两遍。
    const rows = (await readJson(await listSessions(first.token))).sessions as Json[];
    expect(rows.map((r) => r.device).sort()).toEqual(["Chrome on macOS", "Safari on iPhone"]);
    // 用哪条 token 请求，哪条是 current——只有一条。
    expect(rows.filter((r) => r.current)).toHaveLength(1);
    expect(rows.find((r) => r.current)!.device).toBe("Chrome on macOS");

    const rows2 = (await readJson(await listSessions(second.token))).sessions as Json[];
    expect(rows2.find((r) => r.current)!.device).toBe("Safari on iPhone");
  });
});
