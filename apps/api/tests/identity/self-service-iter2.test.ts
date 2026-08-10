/**
 * #638 delta，迭代 2 —— `changeOwnPassword` / `uploadOwnAvatar` / `listOwnActivity`。
 * 真实起服务 + 真 Postgres + 真 Redis，同 `password-reset-revokes-sessions.test.ts` 的模式：
 * 断言不止看响应体，还要独立核实存储层真的变了。
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { addOrgMember, ensureDatabase, migrateOnce, resetOrgs, seedOrg } from "../support/db";
import { ensureRedis, resetCredentials, seedCredential } from "../support/auth";
import { asOwner } from "../support/db";
import { SESSION_TOKEN_STORE } from "../../src/application/auth/ports";
import type { RedisSessionTokenStore } from "../../src/infrastructure/auth/redis-session-token-store";

process.env.KERNEL_QUIET = "1";

const ORG = "org-f638-iter2";
const PROJECT = "proj-f638-iter2";
const USER = "u-f638-iter2";
const EMAIL = "iter2@f638.test";
const OLD_PASSWORD = "correct-horse-battery-staple";
const NEW_PASSWORD = "a-brand-new-passphrase-here-2";

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
  await resetCredentials([USER], [EMAIL]);
  await asOwner((c) => c.query("DELETE FROM user_avatars WHERE user_id = $1", [USER]));
  const fx = await seedOrg({ orgId: ORG, projectId: PROJECT });
  await addOrgMember(ORG, USER, "consultant", fx.teams.energy!);
  await seedCredential({ userId: USER, email: EMAIL, password: OLD_PASSWORD });
  await sessions.purgeForUser(USER);
});

async function loginAs(email: string, password: string): Promise<string> {
  const res = await fetch(`${BASE}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (res.status !== 200) throw new Error(`login failed with ${res.status}`);
  return ((await res.json()) as { sessionToken: string }).sessionToken;
}

async function stillWorks(token: string): Promise<boolean> {
  const r = await fetch(`${BASE}/kernel/probe/whoami`, { headers: { authorization: `Bearer ${token}` } });
  return r.status === 200;
}

function pngBytes(sizeBytes: number): Buffer {
  const header = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const filler = Buffer.alloc(Math.max(0, sizeBytes - header.length), 0x00);
  return Buffer.concat([header, filler]).subarray(0, sizeBytes);
}

async function uploadAvatar(token: string, bytes: Buffer, contentType: string): Promise<Response> {
  const form = new FormData();
  form.set(
    "meta",
    JSON.stringify({ filename: "avatar.png", sizeBytes: bytes.byteLength, sha256: "irrelevant-for-server-check", contentType }),
  );
  form.set("file", new Blob([bytes], { type: contentType }), "avatar.png");
  return fetch(`${BASE}/identity/me/avatar`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
    body: form,
  });
}

describe("changeOwnPassword（#638 delta，迭代 2）", () => {
  it("反证：改密成功后，除当前会话外的其它会话真的失效了", async () => {
    const current = await loginAs(EMAIL, OLD_PASSWORD);
    const other = await loginAs(EMAIL, OLD_PASSWORD);
    expect(await stillWorks(current)).toBe(true);
    expect(await stillWorks(other)).toBe(true);

    const res = await fetch(`${BASE}/identity/me/password`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${current}` },
      body: JSON.stringify({ currentPassword: OLD_PASSWORD, newPassword: NEW_PASSWORD }),
    });
    expect(res.status).toBe(201); // Nest 默认 POST 201（本操作没有 @HttpCode(OK) 覆盖）
    const body = (await res.json()) as { changed: true; revokedSessionCount: number };
    expect(body.changed).toBe(true);
    // 第二台设备的那一条被吊销，当前这一条不算在内。
    expect(body.revokedSessionCount).toBe(1);

    // 独立核实：当前会话仍然能用，另一条真的死了。
    expect(await stillWorks(current)).toBe(true);
    expect(await stillWorks(other)).toBe(false);

    // 新密码真的生效了。
    const fresh = await loginAs(EMAIL, NEW_PASSWORD);
    expect(await stillWorks(fresh)).toBe(true);

    // 反证（#638 迭代 4）：改密成功写一条 password-changed provenance 行，actor 是本人，
    // target 是本人的账户，`detail` 里没有任何密码字节（只记 revokedSessionCount）。
    const events = await asOwner((c) =>
      c.query<{ type: string; actor_id: string; target_kind: string; target_id: string; detail: { revokedSessionCount: number } }>(
        `SELECT type, actor_id, target_kind, target_id, detail FROM provenance_events
          WHERE org_id = $1 AND type = 'password-changed' AND actor_id = $2`,
        [ORG, USER],
      ),
    );
    expect(events.rows).toHaveLength(1);
    expect(events.rows[0]).toMatchObject({ type: "password-changed", actor_id: USER, target_kind: "account", target_id: USER });
    expect(events.rows[0]!.detail).toEqual({ revokedSessionCount: 1 });
  }, 120_000);

  it("当前密码错误时拒绝，且不吊销任何会话", async () => {
    const current = await loginAs(EMAIL, OLD_PASSWORD);
    const other = await loginAs(EMAIL, OLD_PASSWORD);

    const res = await fetch(`${BASE}/identity/me/password`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${current}` },
      body: JSON.stringify({ currentPassword: "totally-wrong-password", newPassword: NEW_PASSWORD }),
    });
    expect(res.status).toBe(403);
    // ⚠ 不只断言状态码——`all-exceptions.filter.ts` 是允许列表，本机真实 HTTP 实测踩到过
    // 这个坑：状态码对（403），但 `reasonCode` 因为没有登记进任何一个闭合枚举而被静默丢弃，
    // 界面上只剩"HTTP 403"，用户看不到"当前密码不正确"。断言 reasonCode 就是防它再丢一次。
    expect(((await res.json()) as { reasonCode: string }).reasonCode).toBe("CURRENT_PASSWORD_INVALID");
    expect(await stillWorks(current)).toBe(true);
    expect(await stillWorks(other)).toBe(true);

    // 被拒绝的改密尝试不写 password-changed（没有发生的事不该留下"发生过"的痕迹）。
    const events = await asOwner((c) =>
      c.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM provenance_events WHERE org_id = $1 AND type = 'password-changed' AND actor_id = $2`,
        [ORG, USER],
      ),
    );
    expect(events.rows[0]!.n).toBe(0);
  }, 60_000);
});

describe("uploadOwnAvatar（#638 delta，迭代 2）", () => {
  it("反证：超过 5MB 被真的拒绝，不落对象存储、不落 PG 元数据", async () => {
    const token = await loginAs(EMAIL, OLD_PASSWORD);
    const oversized = pngBytes(5 * 1024 * 1024 + 1024);
    const res = await uploadAvatar(token, oversized, "image/png");
    expect(res.status).toBe(400);
    expect(((await res.json()) as { reasonCode: string }).reasonCode).toBe("FILE_TOO_LARGE");

    const row = await asOwner((c) => c.query("SELECT count(*)::int AS n FROM user_avatars WHERE user_id = $1", [USER]));
    expect((row.rows[0] as { n: number }).n).toBe(0);
  }, 60_000);

  it("反证：声明的 content-type 与实际字节不符被拒绝（不是随便信声明）", async () => {
    const token = await loginAs(EMAIL, OLD_PASSWORD);
    // 声明 png，实际字节根本不是任何已知图片格式的 magic bytes。
    const fakeBytes = Buffer.from("this is not an image at all, just text pretending", "utf8");
    const res = await uploadAvatar(token, fakeBytes, "image/png");
    expect(res.status).toBe(400);
    expect(((await res.json()) as { reasonCode: string }).reasonCode).toBe("UNSUPPORTED_CONTENT_TYPE");

    const row = await asOwner((c) => c.query("SELECT count(*)::int AS n FROM user_avatars WHERE user_id = $1", [USER]));
    expect((row.rows[0] as { n: number }).n).toBe(0);
  }, 60_000);

  it("成功路径：合法头像真的落对象存储 + PG，且 updateOwnProfile 能把它设为当前头像并读回", async () => {
    const token = await loginAs(EMAIL, OLD_PASSWORD);
    const bytes = pngBytes(1024);
    const uploadRes = await uploadAvatar(token, bytes, "image/png");
    expect(uploadRes.status).toBe(201);
    const uploaded = (await uploadRes.json()) as { avatarArtifactId: string; avatarUrl: string };
    expect(uploaded.avatarArtifactId).toBeTruthy();

    const row = await asOwner((c) =>
      c.query("SELECT user_id, content_type, size_bytes FROM user_avatars WHERE artifact_id = $1", [uploaded.avatarArtifactId]),
    );
    // `size_bytes` 是 bigint 列——node-postgres 把它读回成字符串，不是 number
    // （精度理由：bigint 超出 JS number 的安全整数范围时静默丢精度会比字符串更危险）。
    expect(row.rows[0]).toMatchObject({ user_id: USER, content_type: "image/png" });
    expect(Number((row.rows[0] as { size_bytes: string }).size_bytes)).toBe(1024);

    const patchRes = await fetch(`${BASE}/identity/me`, {
      method: "PATCH",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ avatarArtifactId: uploaded.avatarArtifactId }),
    });
    expect(patchRes.status).toBe(200);
    const patched = (await patchRes.json()) as { avatarUrl: string | null };
    expect(patched.avatarUrl).toBe(uploaded.avatarUrl);

    // 反证（#638 迭代 4）：`updateOwnProfile` 落地头像那一刻写一条 avatar-changed（不是
    // `uploadOwnAvatar` 那一步——上传只是把字节放进对象存储，真正"改了我的头像"是这次
    // PATCH）。target 是本人账户，`detail.avatarArtifactId` 对得上刚上传的那个 id。
    const events = await asOwner((c) =>
      c.query<{ type: string; actor_id: string; target_kind: string; target_id: string; detail: { avatarArtifactId: string; cleared: boolean } }>(
        `SELECT type, actor_id, target_kind, target_id, detail FROM provenance_events
          WHERE org_id = $1 AND type = 'avatar-changed' AND actor_id = $2`,
        [ORG, USER],
      ),
    );
    expect(events.rows).toHaveLength(1);
    expect(events.rows[0]).toMatchObject({ type: "avatar-changed", actor_id: USER, target_kind: "account", target_id: USER });
    expect(events.rows[0]!.detail).toEqual({ avatarArtifactId: uploaded.avatarArtifactId, cleared: false });

    // resolveIdentity 也要读到——`session-provider.tsx` 靠这条读回来渲染。
    const meRes = await fetch(`${BASE}/identity/me?orgId=${ORG}`, { headers: { authorization: `Bearer ${token}` } });
    expect(meRes.status).toBe(200);

    // 下载路由真的能取回字节。
    const dlRes = await fetch(`${BASE}${uploaded.avatarUrl}`, { headers: { authorization: `Bearer ${token}` } });
    expect(dlRes.status).toBe(200);
    // Nest 的默认序列化在 Content-Type 后附加了 `; charset=utf-8`（框架行为，不是本
    // 路由自己加的——`downloadAvatar` 只 `res.set("Content-Type", row.contentType)`）；
    // 断言前缀即可，真正要守住的是"类型没被猜错"。
    expect(dlRes.headers.get("content-type")).toMatch(/^image\/png/);
    const dlBytes = Buffer.from(await dlRes.arrayBuffer());
    expect(dlBytes.equals(bytes)).toBe(true);
  }, 60_000);
});

describe("listOwnActivity（#638 delta，迭代 2；迭代 4 补写路径后回填的非空断言）", () => {
  it("反证：改名后活动记录真的非空，且内容对得上——不是硬编码/mock（六条写路径补齐 provenance 前，这里 count 恒为 0）", async () => {
    const token = await loginAs(EMAIL, OLD_PASSWORD);
    // 迭代 4 之前 `updateOwnProfile` 不写 provenance，这条断言会失败——现在 `profile-renamed`
    // 落库了，`listOwnActivity` 应该读得到。
    const patchRes = await fetch(`${BASE}/identity/me`, {
      method: "PATCH",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ displayName: "活动记录反证专用名字" }),
    });
    expect(patchRes.status).toBe(200);

    const res = await fetch(`${BASE}/identity/me/activity?limit=20&cursor=`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      events: { eventId: string; kind: string; occurredAt: string; summary: string }[];
      nextCursor: string | null;
    };
    expect(Array.isArray(body.events)).toBe(true);
    expect(body.events.length).toBeGreaterThan(0);
    const renameEvent = body.events.find((e) => e.kind === "profile-renamed");
    expect(renameEvent).toBeDefined();
    expect(renameEvent!.eventId).toBeTruthy();
    expect(new Date(renameEvent!.occurredAt).toString()).not.toBe("Invalid Date");
    // 迭代 4 修复：summary 是人话文案（带上改后的显示名），不是裸枚举值 `profile-renamed`。
    expect(renameEvent!.summary).toContain("活动记录反证专用名字");
    expect(renameEvent!.summary).not.toContain("profile-renamed");
  }, 60_000);

  it("反证的另一半：全新用户没有任何活动记录时返回空列表，不是别人的数据", async () => {
    const freshUser = "u-f638-iter2-fresh";
    const freshEmail = "iter2-fresh@f638.test";
    await resetCredentials([freshUser], [freshEmail]);
    // 组织已经在 beforeEach 里 seed 过——这里只加一个新成员，不重复 seedOrg
    // （否则撞 `organizations_pkey`）。
    await addOrgMember(ORG, freshUser, "consultant", null);
    await seedCredential({ userId: freshUser, email: freshEmail, password: OLD_PASSWORD });

    const token = await loginAs(freshEmail, OLD_PASSWORD);
    const res = await fetch(`${BASE}/identity/me/activity?limit=20&cursor=`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { events: unknown[] };
    expect(body.events).toEqual([]);

    await resetCredentials([freshUser], [freshEmail]);
  }, 60_000);
});
