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
  bannerColor: null,
  bannerImageArtifactId: null,
  quickActions: [
    { key: "chat", enabled: true, order: 0 },
    { key: "projects", enabled: false, order: 1 },
    { key: "brain", enabled: true, order: 2 },
  ],
  recommendedCapabilities: [{ kind: "skill", refId: "sk-1", name: "周报助手", note: "每周五用" }],
  recommendedAgents: [{ agentId: "ag-1", name: "小研", roleLabel: "研究员", avatarKey: "robot", note: "桌面研究" }],
  sections: { recentWork: true, currentTasks: false },
};

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);

/** 横幅上传：元数据走查询串，字节是请求体本身（同组织头像上传的真实形状）。 */
const upload = (orgId: string, as: string, asOrg: string, bytes: Uint8Array, contentType = "image/png", declared = bytes.byteLength) =>
  fetch(
    `${base}/organizations/${orgId}/home-banner?${new URLSearchParams({ filename: "b.png", sizeBytes: String(declared), sha256: "x", contentType })}`,
    { method: "POST", headers: { "x-kernel-test-principal": `${as}:${asOrg}`, "content-type": contentType }, body: new Blob([bytes.slice().buffer as ArrayBuffer], { type: contentType }) },
  );

const getBannerFile = (orgId: string, id: string, as: string, asOrg: string) =>
  fetch(`${base}/organizations/${orgId}/home-banner-file/${id}`, { headers: { "x-kernel-test-principal": `${as}:${asOrg}` } });

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
    expect(read.recommendedAgents).toEqual(BODY.recommendedAgents);
    expect(read.sections).toEqual(BODY.sections);
    expect(read.bannerColor).toBeNull();
    expect(read.bannerImageUrl).toBeNull();
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

  it("自定义色：合法 → 200 落库；格式不对 → 400；选自定义却没色值 → 409 BANNER_COLOR_REQUIRED", async () => {
    const ok = await req("PUT", ORG, ADMIN, ORG, { ...BODY, bannerPreset: "custom", bannerColor: "#1A2B3C" });
    expect(ok.status, await ok.clone().text()).toBe(200);
    expect(C.HomeConfig.parse(await (await req("GET", ORG, MEMBER, ORG)).json()).bannerColor).toBe("#1A2B3C");

    const bad = await req("PUT", ORG, ADMIN, ORG, { ...BODY, bannerPreset: "custom", bannerColor: "#12" });
    expect(bad.status).toBe(400);

    const missing = await req("PUT", ORG, ADMIN, ORG, { ...BODY, bannerPreset: "custom", bannerColor: null });
    expect(missing.status).toBe(409);
    expect(await missing.text()).toContain("BANNER_COLOR_REQUIRED");
    // 被拒的写不改库
    expect(C.HomeConfig.parse(await (await req("GET", ORG, MEMBER, ORG)).json()).bannerColor).toBe("#1A2B3C");
  });

  it("横幅图片全链路（真实 HTTP）：admin 上传 200 → PUT 引用 → 成员取回字节一致；成员上传 403", async () => {
    const up = await upload(ORG, ADMIN, ORG, PNG);
    const upText = await up.text();
    expect(up.status, upText).toBe(201);
    const uploaded = C.operations.uploadHomeBanner.out.parse(JSON.parse(upText));

    const put = await req("PUT", ORG, ADMIN, ORG, { ...BODY, bannerImageArtifactId: uploaded.bannerImageArtifactId });
    expect(put.status, await put.clone().text()).toBe(200);
    const read = C.HomeConfig.parse(await (await req("GET", ORG, MEMBER, ORG)).json());
    expect(read.bannerImageUrl).toBe(uploaded.bannerImageUrl);

    const file = await getBannerFile(ORG, uploaded.bannerImageArtifactId, MEMBER, ORG);
    expect(file.status).toBe(200);
    expect(file.headers.get("content-type")).toContain("image/png");
    expect(Array.from(new Uint8Array(await file.arrayBuffer()))).toEqual(Array.from(PNG));

    const memberUp = await upload(ORG, MEMBER, ORG, PNG);
    expect(memberUp.status).toBe(403);
  });

  it("横幅上传的拒绝形状：伪造字节 415、声明超限 413、声明格式非法 415；引用不存在的图 409", async () => {
    const fake = await upload(ORG, ADMIN, ORG, new TextEncoder().encode("plain text, not an image"));
    expect(fake.status, await fake.clone().text()).toBe(415);
    expect(await fake.text()).toContain("UNSUPPORTED_CONTENT_TYPE");

    const tooBig = await upload(ORG, ADMIN, ORG, PNG, "image/png", 5 * 1024 * 1024 + 1);
    expect(tooBig.status).toBe(413);

    const gif = await upload(ORG, ADMIN, ORG, PNG, "image/gif");
    expect(gif.status).toBe(415);

    const ghost = await req("PUT", ORG, ADMIN, ORG, { ...BODY, bannerImageArtifactId: "home-banner-nope" });
    expect(ghost.status).toBe(409);
    expect(await ghost.text()).toContain("BANNER_ARTIFACT_NOT_OWNED");
  });

  it("别的组织读不到本组织的横幅图（403/404），也不能引用它", async () => {
    const up = C.operations.uploadHomeBanner.out.parse(await (await upload(ORG, ADMIN, ORG, PNG)).json());
    const cross = await getBannerFile(ORG, up.bannerImageArtifactId, OTHER_ADMIN, OTHER_ORG);
    expect([403, 404]).toContain(cross.status);

    const ref = await req("PUT", OTHER_ORG, OTHER_ADMIN, OTHER_ORG, { ...BODY, bannerImageArtifactId: up.bannerImageArtifactId });
    expect(ref.status).toBe(409);
  });

  it("超过 10 个快捷入口 / 6 个推荐数字人 → 400", async () => {
    const many = await req("PUT", ORG, ADMIN, ORG, { ...BODY, recommendedAgents: Array.from({ length: 7 }, (_, i) => ({ agentId: `a${String(i)}`, name: "n", roleLabel: null, avatarKey: null, note: null })) });
    expect(many.status).toBe(400);
  });
});
