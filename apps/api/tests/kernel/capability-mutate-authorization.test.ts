/**
 * #458 —— `POST /capabilities/mutate` 的**服务端**裁决面。
 *
 * ## 为什么这个文件必须存在
 *
 * #458 给 Agent 目录接上了新增 / 更新 / 停用。界面那侧只对管理员显示入口——
 * 但**藏起按钮不是权限**：客户端手里的 `orgRole` 是登录那一刻缓存下来的，
 * 降权与页面刷新之间永远有时间差，而 `fetch` 谁都能自己发。
 * 唯一算数的是服务端在这条路由上真的拒绝：无凭据 401，非管理员 403，非成员 404。
 *
 * `org-scoped-capabilities.test.ts` 已经覆盖了「管理员成功时响应符合契约」，
 * 但**没有任何一条断言覆盖被拒的三种状态码**——写路径接上界面之前，
 * 那三条恰恰是唯一挡在「任意登录用户改组织配置」前面的东西。
 *
 * ## 断言到数据库，不是断言到响应
 *
 * 被拒之后还要问 PostgreSQL：那一行到底有没有落地。只看状态码的版本，
 * 在「先写库再判权限」的实现下**全绿**——而那正是最值得抓的一种写法。
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { identity as C } from "@repo/contracts";
import {
  addCapability,
  addOrgMember,
  asApp,
  ensureDatabase,
  migrateOnce,
  resetOrgs,
  seedOrg,
} from "../support/db";

process.env.KERNEL_ALLOW_TEST_PRINCIPAL = "1";
process.env.KERNEL_QUIET = "1";

const ORG = "org-cap-mutate-458";
const ADMIN = "u-458-admin";
const MEMBER = "u-458-member";
const OUTSIDER = "u-458-outsider";

let BASE: string;
let app: NestExpressApplication;
let fixture: Awaited<ReturnType<typeof seedOrg>>;

const authFor = (user: string, org: string) => ({ "x-kernel-test-principal": `${user}:${org}` });

/** `headers` 显式可空：无凭据这一条正是本文件的第一个断言。 */
const mutate = (headers: Record<string, string> | null, body: unknown) =>
  fetch(`${BASE}/capabilities/mutate`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(headers ?? {}) },
    body: JSON.stringify(body),
  });

const agentRows = () =>
  asApp(ORG, async (c) => {
    const r = await c.query<{ id: string; name: string; enabled: boolean }>(
      "SELECT id, name, enabled FROM capability_listings WHERE org_id = $1 AND kind = 'agent' ORDER BY name",
      [ORG],
    );
    return r.rows;
  });

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  const { createApp } = await import("../../src/main");
  app = await createApp();
  await app.listen(0);
  const addr = app.getHttpServer().address();
  BASE = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
});

afterAll(async () => {
  await app?.close();
  await resetOrgs(ORG);
});

beforeEach(async () => {
  await resetOrgs(ORG);
  fixture = await seedOrg({ orgId: ORG, projectId: `${ORG}-p` });
  await addOrgMember(ORG, ADMIN, "admin", fixture.teams.energy ?? null);
  await addOrgMember(ORG, MEMBER, "consultant", fixture.teams.energy ?? null);
  // OUTSIDER 刻意没有任何 org_memberships 行。
});

const ADD_BODY = {
  orgId: ORG,
  kind: "agent" as const,
  op: "add" as const,
  payload: { name: "越权新增的 Agent", scope: "org-wide" as const },
};

describe("#458 mutate 的服务端裁决", () => {
  it("无凭据 → 401，且什么都没写进 PostgreSQL", async () => {
    const res = await mutate(null, ADD_BODY);
    expect(res.status).toBe(401);
    expect(await agentRows()).toEqual([]);
  });

  it("组织成员但不是管理员 → 403 + 分层 reasonCode，且什么都没写进 PostgreSQL", async () => {
    const res = await mutate(authFor(MEMBER, ORG), ADD_BODY);
    expect(res.status).toBe(403);
    // UC-0.3 R8：不能只回一个光秃秃的「无权限」。
    expect(await res.json()).toMatchObject({ reasonCode: "PROJECT_ROLE_INSUFFICIENT" });
    expect(await agentRows()).toEqual([]);
  });

  it("非本组织成员 → 404（不泄露组织是否存在），且什么都没写进 PostgreSQL", async () => {
    const res = await mutate(authFor(OUTSIDER, ORG), ADD_BODY);
    expect(res.status).toBe(404);
    expect(await agentRows()).toEqual([]);
  });

  it("非管理员同样改不动已存在的记录：update / disable 都是 403 且行未变", async () => {
    await addCapability({ orgId: ORG, id: "cap-458-x", kind: "agent", name: "原名" });

    const update = await mutate(authFor(MEMBER, ORG), {
      orgId: ORG, kind: "agent", op: "update", payload: { id: "cap-458-x", name: "被改的名字" },
    });
    expect(update.status).toBe(403);

    const disable = await mutate(authFor(MEMBER, ORG), {
      orgId: ORG, kind: "agent", op: "disable", payload: { id: "cap-458-x" }, disableMode: "interrupt",
    });
    expect(disable.status).toBe(403);

    expect(await agentRows()).toEqual([{ id: "cap-458-x", name: "原名", enabled: true }]);
  });

  it("反证：同一条请求换成管理员就落地——上面的三个拒绝不是因为这条路由整体坏了", async () => {
    const res = await mutate(authFor(ADMIN, ORG), ADD_BODY);
    expect(res.status).toBe(200);
    const body = await res.json();
    const parsed = C.operations.mutateCapability.out.safeParse(body);
    expect(parsed.success ? null : parsed.error.issues, JSON.stringify(body)).toBeNull();

    const rows = await agentRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.name).toBe("越权新增的 Agent");
    expect(rows[0]!.enabled).toBe(true);

    // 管理员停用之后，PostgreSQL 里的 enabled 真的翻了——界面上的「已停用」有出处。
    const off = await mutate(authFor(ADMIN, ORG), {
      orgId: ORG, kind: "agent", op: "disable", payload: { id: rows[0]!.id },
    });
    expect(off.status).toBe(200);
    expect(await agentRows()).toEqual([
      { id: rows[0]!.id, name: "越权新增的 Agent", enabled: false },
    ]);
  });
});
