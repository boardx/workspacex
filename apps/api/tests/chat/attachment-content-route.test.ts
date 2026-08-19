/**
 * #1584 —— 聊天附件字节读路径真实栈 e2e（起 Nest 应用 + 真 PG + 真对象存储）。
 *
 * 覆盖：200 拿到原字节 + 正确 Content-Type/Content-Disposition（预览 vs 下载两种）·
 * 观察者也能读（读权与写权不同门，见 `get-attachment-content.ts` 头注）·
 * 404 线程不可见 · 404 附件 id 不存在（同一线程但没这个 id，与不可见同响应，I-3）。
 */
import type { NestExpressApplication } from "@nestjs/platform-express";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  addOrgMember, addProjectMember, asApp, ensureDatabase, migrateOnce, resetOrgs, seedOrg,
} from "../support/db";
import { addChatThread } from "../support/chat-db";

process.env.KERNEL_ALLOW_TEST_PRINCIPAL = "1";
process.env.KERNEL_QUIET = "1";

const ORG = "org-i1584-attach-content";
const PROJECT = "proj-i1584-attach-content";
const THREAD = "thread-i1584-attach-content";
const ACTOR = "u-i1584-attach-content-writer";
const OBSERVER = "u-i1584-attach-content-observer";
const OUTSIDER = "u-i1584-attach-content-outsider";

let BASE: string;
let app: NestExpressApplication;

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01, 0x02, 0x03]);

function headersFor(actor: string) {
  return { "x-kernel-test-principal": `${actor}:${ORG}` };
}

async function uploadPng(actor: string, filename = "pic.png"): Promise<string> {
  const fd = new FormData();
  fd.append("file", new Blob([PNG], { type: "image/png" }), filename);
  const res = await fetch(`${BASE}/chat/threads/${THREAD}/attachments`, {
    method: "POST",
    headers: headersFor(actor),
    body: fd,
  });
  expect(res.status).toBe(201);
  const { id } = await res.json() as { id: string };
  return id;
}

function getContent(actor: string, threadId: string, attachmentId: string, opts?: { download?: boolean }) {
  const qs = opts?.download ? "?download=1" : "";
  return fetch(
    `${BASE}/chat/threads/${threadId}/attachments/${attachmentId}/content${qs}`,
    { headers: headersFor(actor) },
  );
}

beforeAll(async () => {
  ensureDatabase();
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
  await resetOrgs(ORG);
  const fx = await seedOrg({ orgId: ORG, projectId: PROJECT });
  await addOrgMember(ORG, ACTOR, "consultant", fx.teams.energy!);
  await addProjectMember(ORG, PROJECT, ACTOR, "facilitator", null);
  await addOrgMember(ORG, OBSERVER, "consultant", fx.teams.energy!);
  await addProjectMember(ORG, PROJECT, OBSERVER, "observer", null);
  await addChatThread({
    orgId: ORG, id: THREAD, projectId: PROJECT, visibilityScope: "plenary", createdBy: ACTOR,
  });
});

describe("GET /chat/threads/:threadId/attachments/:attachmentId/content", () => {
  it("200: 拿回和上传时逐字节相同的内容，Content-Type 是附件的 mime，默认 inline", async () => {
    const id = await uploadPng(ACTOR, "截屏 2026-08-19.png");
    const res = await getContent(ACTOR, THREAD, id);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("content-disposition")).toMatch(/^inline; filename\*=UTF-8''/);
    const body = new Uint8Array(await res.arrayBuffer());
    expect(Array.from(body)).toEqual(Array.from(PNG));
  });

  it("?download=1 时 Content-Disposition 是 attachment（触发另存），字节不变", async () => {
    const id = await uploadPng(ACTOR);
    const res = await getContent(ACTOR, THREAD, id, { download: true });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toMatch(/^attachment; filename\*=UTF-8''/);
    const body = new Uint8Array(await res.arrayBuffer());
    expect(Array.from(body)).toEqual(Array.from(PNG));
  });

  it("观察者（只读角色）也能读——读权与上传的写权不是同一道门", async () => {
    const id = await uploadPng(ACTOR);
    const res = await getContent(OBSERVER, THREAD, id);
    expect(res.status).toBe(200);
  });

  it("404: 线程不存在/不可见——裸 404 不带 reasonCode（I-3）", async () => {
    const id = await uploadPng(ACTOR);
    const res = await getContent(ACTOR, "thread-does-not-exist", id);
    expect(res.status).toBe(404);
  });

  it("404: 线程可见但组织外人士读不到——与不存在同响应", async () => {
    const id = await uploadPng(ACTOR);
    const res = await getContent(OUTSIDER, THREAD, id);
    expect(res.status).toBe(404);
  });

  it("404: 附件 id 在这个线程里不存在——与线程不可见同码同响应体（不泄露「存在但你看不到」vs「根本没有」）", async () => {
    const res = await getContent(ACTOR, THREAD, "att-does-not-exist");
    expect(res.status).toBe(404);
  });
});
