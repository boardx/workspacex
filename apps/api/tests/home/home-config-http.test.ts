/**
 * 回归：真实栈 PUT /organizations/:orgId/home-config 恒 400
 * `validation_failed · orgId invalid_type`——契约 `in` 含路径参数 orgId，controller 把整份
 * `in` 交给 `ZodBodyPipe`，而 web 端只在路径里带 orgId。直接调 controller 方法的单测绕过了
 * pipe，所以看不到。这里起**真实 Nest app**、走真实 HTTP + 真实 Postgres。
 */
import { randomUUID } from "node:crypto";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { homeConfig as C } from "@repo/contracts";
import { addOrgMember, ensureDatabase, migrateOnce, resetOrgs, seedOrg } from "../support/db";

process.env.KERNEL_ALLOW_TEST_PRINCIPAL = "1";
process.env.KERNEL_QUIET = "1";

const sfx = randomUUID().slice(0, 8);
const ORG = `org-home-http-${sfx}`;
const OTHER_ORG = `org-home-http-other-${sfx}`;
const ADMIN = `u-home-http-admin-${sfx}`;
const MEMBER = `u-home-http-member-${sfx}`;
const OTHER_ADMIN = `u-home-http-oadmin-${sfx}`;

let app: NestExpressApplication;
let base: string;

const req = (method: string, orgId: string, as: string, asOrg: string, body?: unknown) =>
  fetch(`${base}/organizations/${orgId}/home-config`, {
    method,
    headers: { "x-kernel-test-principal": `${as}:${asOrg}`, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

const BODY = {
  title: "Acme 首页",
  tagline: "一起把事做成",
  bannerHeadline: "欢迎回来",
  bannerTagline: "本周重点：发布",
  bannerPreset: "forest",
  quickActions: [
    { key: "chat", enabled: true, order: 0 },
    { key: "projects", enabled: false, order: 1 },
    { key: "brain", enabled: true, order: 2 },
  ],
  recommendedCapabilities: [{ kind: "skill", refId: "sk-1", name: "周报助手", note: "每周五用" }],
};

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  await seedOrg({ orgId: ORG, teamNames: [], projectId: `p-${ORG}` });
  await seedOrg({ orgId: OTHER_ORG, teamNames: [], projectId: `p-${OTHER_ORG}` });
  await addOrgMember(ORG, ADMIN, "admin", null);
  await addOrgMember(ORG, MEMBER, "consultant", null);
  await addOrgMember(OTHER_ORG, OTHER_ADMIN, "admin", null);
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

describe("PUT/GET /organizations/:orgId/home-config 真实 HTTP", () => {
  it("admin PUT（body 不带 orgId）→ 200，成员 GET 读回同一份（推荐 + 快捷入口 round-trip）", async () => {
    const put = await req("PUT", ORG, ADMIN, ORG, BODY);
    const putText = await put.text();
    expect(put.status, putText).toBe(200);
    const saved = C.HomeConfig.parse(JSON.parse(putText));
    expect(saved.orgId).toBe(ORG);

    const get = await req("GET", ORG, MEMBER, ORG);
    const getText = await get.text();
    expect(get.status, getText).toBe(200);
    const read = C.HomeConfig.parse(JSON.parse(getText));
    expect(read.title).toBe(BODY.title);
    expect(read.tagline).toBe(BODY.tagline);
    expect(read.bannerHeadline).toBe(BODY.bannerHeadline);
    expect(read.bannerTagline).toBe(BODY.bannerTagline);
    expect(read.bannerPreset).toBe(BODY.bannerPreset);
    expect(read.quickActions).toEqual(BODY.quickActions);
    expect(read.recommendedCapabilities).toEqual(BODY.recommendedCapabilities);
    expect(read.updatedBy).toBe(ADMIN);
  });

  it("member PUT → 403", async () => {
    const res = await req("PUT", ORG, MEMBER, ORG, { ...BODY, title: "Hijacked" });
    expect(res.status, await res.clone().text()).toBe(403);
    const read = C.HomeConfig.parse(await (await req("GET", ORG, ADMIN, ORG)).json());
    expect(read.title).not.toBe("Hijacked");
  });

  it("跨组织 admin PUT → 403/404，目标组织未被改写", async () => {
    const res = await req("PUT", ORG, OTHER_ADMIN, OTHER_ORG, { ...BODY, title: "CrossOrg" });
    expect([403, 404], await res.clone().text()).toContain(res.status);
    const read = C.HomeConfig.parse(await (await req("GET", ORG, ADMIN, ORG)).json());
    expect(read.title).not.toBe("CrossOrg");
  });

  it("body 里夹带 orgId → 400（orgId 只信路径）", async () => {
    const res = await req("PUT", ORG, ADMIN, ORG, { ...BODY, orgId: OTHER_ORG });
    expect(res.status, await res.clone().text()).toBe(400);
  });

  it("非法 body → 400", async () => {
    const res = await req("PUT", ORG, ADMIN, ORG, { ...BODY, title: "", bannerPreset: "neon" });
    expect(res.status).toBe(400);
    expect(await res.text()).toContain("validation_failed");
  });
});
