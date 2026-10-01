/**
 * 项目中枢 R6 —— 权限闭环（真实 HTTP + PostgreSQL，同 `chat/visibility-two-layer-intersection.test.ts` 的装配）。
 *
 * 一条链走完，每一步都对着**服务端**断言，不看前端按钮：
 *   ① 组织成员但非项目成员：概览 403 `NO_PROJECT_ROLE`；成员名单 403；线程列表看不到任何卡；
 *      签发邀请 403 `NO_PROJECT_ROLE`。
 *   ② 引导师签发邀请链接（`POST /projects/:id/invite-links`）。
 *   ③ 非成员用令牌自助接受（`POST /project-invites/accept`）⇒ 成为成员；重复接受幂等 `alreadyMember`。
 *   ④ 成为成员后：概览 200、名单里有他、能在项目里建线程。
 *   ⑤ 分享：非创建者的组员改可见范围 ⇒ 403 `NO_WRITE_ROLE`；创建者改成 `plenary` ⇒ 200，
 *      此后观察者也能在列表里看到它（`plenary` 含观察者）。
 *   ⑥ 不在本组织的人拿同一条令牌 ⇒ 403 `NO_ORG_MEMBERSHIP`，且**不消耗**令牌。
 *
 * 反证意识：每一条「拒绝」都在对应的「放行」旁边——只测放行，一个对谁都放行的实现全绿。
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { NestExpressApplication } from "@nestjs/platform-express";
import {
  addOrgMember, addProjectMember, ensureDatabase, migrateOnce, resetOrgs, seedOrg,
} from "../support/db";

process.env.KERNEL_ALLOW_TEST_PRINCIPAL = "1";
process.env.KERNEL_QUIET = "1";

const ORG = "org-r6-chain";
const PROJECT = "proj-r6-chain";
let BASE: string;
let app: NestExpressApplication;

const as = (userId: string, org = ORG) => ({
  "x-kernel-test-principal": `${userId}:${org}`,
  "content-type": "application/json",
});
const get = (userId: string, path: string) => fetch(`${BASE}${path}`, { headers: as(userId) });
const post = (userId: string, path: string, body: unknown, org = ORG) =>
  fetch(`${BASE}${path}`, { method: "POST", headers: as(userId, org), body: JSON.stringify(body) });

async function reasonOf(res: Response): Promise<string | null> {
  const j = (await res.json().catch(() => ({}))) as { reasonCode?: string };
  return j.reasonCode ?? null;
}

async function threadIds(userId: string): Promise<string[]> {
  const res = await get(userId, `/chat/projects/${PROJECT}/threads`);
  expect(res.status).toBe(200);
  const j = (await res.json()) as { groups: Array<{ cards: Array<{ id: string }> }> };
  return j.groups.flatMap((g) => g.cards.map((c) => c.id));
}

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  const { createApp } = await import("../../src/main");
  app = await createApp();
  await app.listen(0, "127.0.0.1");
  const addr = app.getHttpServer().address();
  BASE = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
}, 180_000);

afterAll(async () => {
  await app?.close();
});

beforeEach(async () => {
  await resetOrgs(ORG);
  const fx = await seedOrg({ orgId: ORG, projectId: PROJECT, groupNames: ["g1"] });
  // 引导师 + 一名已在 g1 的组员 + 一名观察者；`u-new` 是组织成员但还不在项目里；`u-out` 不在组织里。
  await addOrgMember(ORG, "u-fac", "consultant", null);
  await addProjectMember(ORG, PROJECT, "u-fac", "facilitator", null, true);
  await addOrgMember(ORG, "u-mem", "consultant", null);
  await addProjectMember(ORG, PROJECT, "u-mem", "member", fx.groups.g1!);
  await addOrgMember(ORG, "u-obs", "consultant", null);
  await addProjectMember(ORG, PROJECT, "u-obs", "observer", null);
  await addOrgMember(ORG, "u-new", "consultant", null);
}, 60_000);

describe("R6 权限闭环：受邀才能进 → 进了才看得见 → 分享由创建者 / 引导师决定", () => {
  it("整条链", async () => {
    // ① 非成员：处处被挡，且挡的是服务端
    const overview0 = await get("u-new", `/projects/${PROJECT}/overview`);
    expect(overview0.status).toBe(403);
    expect(await reasonOf(overview0)).toBe("NO_PROJECT_ROLE");
    const members0 = await get("u-new", `/projects/${PROJECT}/members`);
    expect(members0.status).toBe(403);
    const issue0 = await post("u-new", `/projects/${PROJECT}/invite-links`, {
      projectId: PROJECT, kind: "main", groupId: null, identity: "member", validity: "7d",
    });
    expect(issue0.status).toBe(403);
    expect(await reasonOf(issue0)).toBe("NO_PROJECT_ROLE");

    // 成员先在项目里建一条线程，非成员的列表里不该有它
    const created = await post("u-mem", "/chat/threads/mutate", {
      op: "create", projectId: PROJECT, threadId: null, groupId: null, title: "并网周期整理",
      visibilityScope: null, expectedVersion: null, reason: null,
    });
    expect(created.status).toBe(200);
    const { threadId, version } = (await created.json()) as { threadId: string; version: number };
    expect(await threadIds("u-new")).not.toContain(threadId);

    // ② 引导师签发
    const issued = await post("u-fac", `/projects/${PROJECT}/invite-links`, {
      projectId: PROJECT, kind: "main", groupId: null, identity: "member", validity: "7d",
    });
    expect(issued.ok).toBe(true);
    const { token } = (await issued.json()) as { token: string };
    expect(token.length).toBeGreaterThan(0);

    // ⑥ 不在组织里的人拿同一条令牌：NO_ORG_MEMBERSHIP，且令牌未被消耗（下面 ③ 仍能用）
    const outsider = await post("u-out", "/project-invites/accept", { token });
    expect(outsider.status).toBe(403);
    expect(await reasonOf(outsider)).toBe("NO_ORG_MEMBERSHIP");

    // ③ 非成员自助接受 ⇒ 成员；再接受一次幂等
    const accept1 = await post("u-new", "/project-invites/accept", { token });
    expect(accept1.ok).toBe(true);
    expect(await accept1.json()).toMatchObject({ projectId: PROJECT, projectRole: "member", alreadyMember: false });
    const accept2 = await post("u-new", "/project-invites/accept", { token });
    expect(accept2.ok).toBe(true);
    expect(await accept2.json()).toMatchObject({ projectId: PROJECT, alreadyMember: true });

    // ④ 成为成员后：概览可读、名单里有他、能建线程
    const overview1 = await get("u-new", `/projects/${PROJECT}/overview`);
    expect(overview1.status).toBe(200);
    const members1 = await get("u-fac", `/projects/${PROJECT}/members`);
    expect(members1.status).toBe(200);
    const roster = (await members1.json()) as { members: Array<{ userId: string; projectRole: string }> };
    expect(roster.members.find((m) => m.userId === "u-new")).toMatchObject({ projectRole: "member" });
    const createdByNew = await post("u-new", "/chat/threads/mutate", {
      op: "create", projectId: PROJECT, threadId: null, groupId: null, title: "新成员的对话",
      visibilityScope: null, expectedVersion: null, reason: null,
    });
    expect(createdByNew.status).toBe(200);

    // ⑤ 分享：非创建者的成员不能改别人线程的可见范围；创建者能；改成全场后观察者能看到
    expect(await threadIds("u-obs")).not.toContain(threadId); // group-shared 对观察者不可见
    const denied = await post("u-new", "/chat/threads/mutate", {
      op: "setVisibility", projectId: PROJECT, threadId, groupId: null, title: null,
      visibilityScope: "plenary", expectedVersion: version, reason: null,
    });
    // u-new 不在 g1（无组）：对 group-shared 线程本就不可见 ⇒ 404（I-3 不泄露存在性）；
    // 引导师之外唯一能改的是创建者，两者都不是 ⇒ 无论哪条门先挡，都不是 200。
    expect([403, 404]).toContain(denied.status);
    const shared = await post("u-mem", "/chat/threads/mutate", {
      op: "setVisibility", projectId: PROJECT, threadId, groupId: null, title: null,
      visibilityScope: "plenary", expectedVersion: version, reason: null,
    });
    expect(shared.status).toBe(200);
    expect(await shared.json()).toMatchObject({ threadId, version: version + 1 });
    expect(await threadIds("u-obs")).toContain(threadId);
    expect(await threadIds("u-new")).toContain(threadId);

    // 越权分享的反证：同组的另一名组员（非创建者）明确被 NO_WRITE_ROLE 挡住
    await addOrgMember(ORG, "u-mem2", "consultant", null);
    const fx2 = await get("u-fac", `/projects/${PROJECT}/members`);
    expect(fx2.status).toBe(200);
    const g1 = (await post("u-fac", `/projects/${PROJECT}/members`, {
      projectId: PROJECT, subject: { kind: "orgUser", ref: "u-mem2" }, projectRole: "member", isHost: false,
    })).status;
    expect([200, 201]).toContain(g1);
    const denied2 = await post("u-mem2", "/chat/threads/mutate", {
      op: "setVisibility", projectId: PROJECT, threadId, groupId: null, title: null,
      visibilityScope: "member-private", expectedVersion: version + 1, reason: null,
    });
    expect(denied2.status).toBe(403);
    expect(await reasonOf(denied2)).toBe("NO_WRITE_ROLE");
  }, 60_000);
});
