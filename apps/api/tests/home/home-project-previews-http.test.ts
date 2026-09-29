/**
 * 首页项目预览接口（Refs #4698）—— 真实 Nest app + 真实 HTTP + 真实 Postgres。
 *
 * 要守的是：**没有项目角色的项目在响应里直接不出现（200），而不是 403**。
 * 组织 admin/lead 能在列表里「管理」看到自己不是成员的项目；首页若逐个 `GET /projects/:id/members`
 * 就会撞一串必然的 403（浏览器 console 噪音 + 服务端被拒记录，fullstack-smoke 会抓）。
 */
import { randomUUID } from "node:crypto";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { project as C } from "@repo/contracts";
import { addCredential, addOrgMember, addProjectMember, ensureDatabase, migrateOnce, resetOrgs, seedOrg } from "../support/db";

process.env.KERNEL_ALLOW_TEST_PRINCIPAL = "1";
process.env.KERNEL_QUIET = "1";

const sfx = randomUUID().slice(0, 8);
const ORG = `org-home-prev-${sfx}`;
const OTHER_ORG = `org-home-prev-other-${sfx}`;
const PROJ = `${ORG}-p`;
const MEMBER = `u-prev-member-${sfx}`;
const PEER = `u-prev-peer-${sfx}`;
const ADMIN = `u-prev-admin-${sfx}`;
const OUTSIDER = `u-prev-outsider-${sfx}`;

let app: NestExpressApplication;
let base: string;

const previews = (as: string, asOrg: string) =>
  fetch(`${base}/home/project-previews`, { headers: { "x-kernel-test-principal": `${as}:${asOrg}` } });

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  await seedOrg({ orgId: ORG, teamNames: [], projectId: PROJ });
  await seedOrg({ orgId: OTHER_ORG, teamNames: [], projectId: `${OTHER_ORG}-p` });
  for (const [u, name] of [[MEMBER, "张伟"], [PEER, "李娜"], [ADMIN, "管理员"], [OUTSIDER, "外人"]] as const) {
    await addCredential(u, `${u}@prev.test`, name);
  }
  await addOrgMember(ORG, MEMBER, "consultant", null);
  await addOrgMember(ORG, PEER, "consultant", null);
  await addOrgMember(ORG, ADMIN, "admin", null);
  await addOrgMember(OTHER_ORG, OUTSIDER, "admin", null);
  await addProjectMember(ORG, PROJ, MEMBER, "facilitator", null);
  await addProjectMember(ORG, PROJ, PEER, "member", null);
  const { createApp } = await import("../../src/main");
  app = await createApp();
  await app.listen(0, "127.0.0.1");
  const address = app.getHttpServer().address();
  base = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
}, 180_000);

afterAll(async () => {
  await app?.close();
  await resetOrgs(ORG, OTHER_ORG);
});

describe("GET /home/project-previews 真实 HTTP", () => {
  it("项目成员：拿到该项目及协作者（userId/displayName），响应符合契约", async () => {
    const res = await previews(MEMBER, ORG);
    const text = await res.text();
    expect(res.status, text).toBe(200);
    const out = C.operations.getHomeProjectPreviews.out.parse(JSON.parse(text));
    const item = out.items.find((i) => i.projectId === PROJ);
    expect(item, text).toBeDefined();
    expect(item!.members.map((m) => m.displayName).sort()).toEqual(["张伟", "李娜"]);
    for (const m of item!.members) expect(Object.keys(m).sort()).toEqual(["displayName", "userId"]);
  });

  it("组织 admin 能在项目列表里看到该项目、但不是成员：响应 200 且不含它（不是 403）", async () => {
    // 前提：admin 的确能在 GET /projects 里看到这个项目（否则下面「不出现」什么也证明不了）。
    const list = await fetch(`${base}/projects?orgId=${ORG}`, { headers: { "x-kernel-test-principal": `${ADMIN}:${ORG}` } });
    expect((await list.json() as Array<{ id: string }>).some((p) => p.id === PROJ)).toBe(true);

    const res = await previews(ADMIN, ORG);
    const text = await res.text();
    expect(res.status, text).toBe(200);
    expect(C.operations.getHomeProjectPreviews.out.parse(JSON.parse(text)).items.some((i) => i.projectId === PROJ)).toBe(false);
  });

  it("别的组织的人：200 且拿不到本组织任何项目；不带身份 → 401", async () => {
    const res = await previews(OUTSIDER, OTHER_ORG);
    expect(res.status).toBe(200);
    const out = C.operations.getHomeProjectPreviews.out.parse(await res.json());
    expect(out.items.some((i) => i.projectId === PROJ)).toBe(false);

    const anon = await fetch(`${base}/home/project-previews`);
    expect(anon.status).toBe(401);
  });
});
