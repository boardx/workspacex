/**
 * `listThreadAttachments` —— 右侧栏「材料」列表真实栈 e2e（#728 D9，人类 2026-08-21 裁决
 * 选项 A：先做「产物 + 材料」两个有真实数据支撑的标签）。
 *
 * 走完整真实链路：上传（F150，pending）→ createMessage(attachmentIds)（F151，挂消息）→
 * `GET /chat/threads/:threadId/attachments`（本 feature，`listThreadAttachments`）。
 * 断言：
 *   · pending 附件（还没随消息发出）不出现在材料列表里——这是本用例的核心边界。
 *   · 挂到消息后的附件出现，且形状带 `messageId`。
 *   · 按 `created_at DESC` 排列。
 *   · 404 不可见/不存在——裸 404 不带 reasonCode（I-3），与 `listThreadArtifacts` 同一处置。
 *   · 观察者（只读角色）仍可读（材料是读路径，不是写路径）。
 */
import { randomUUID } from "node:crypto";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  addOrgMember, addProjectMember, asApp, asOwner, ensureDatabase, migrateOnce, resetOrgs, seedOrg,
} from "../support/db";
import { addChatThread } from "../support/chat-db";
import { createChatWave2FixtureSchema } from "../support/chat-wave2-fixture-schema";

process.env.KERNEL_ALLOW_TEST_PRINCIPAL = "1";
process.env.KERNEL_QUIET = "1";
process.env.KERNEL_AGENT_CATALOG_SCHEMA = "chat_wave2_fixture";
process.env.KERNEL_AGENT_RUN_AUTOSTART = "0"; // 只验受理落库，不跑执行

const ORG = "org-d9-materials";
const PROJECT = "proj-d9-materials";
const THREAD = "thread-d9-materials";
const ACTOR = "u-d9-materials-writer";
const OBSERVER = "u-d9-materials-observer";
const AGENT = "agent-d9-materials-published";
const VERSION = "agent-version-d9-materials-v1";
const SKILLS = ["skill-version-x-v1"];

let BASE: string;
let app: NestExpressApplication;

const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37, 0x0a]);

async function uploadTo(actor: string, threadId: string, filename: string): Promise<string> {
  const fd = new FormData();
  fd.append("file", new Blob([PDF], { type: "application/pdf" }), filename);
  const res = await fetch(`${BASE}/chat/threads/${threadId}/attachments`, {
    method: "POST", headers: { "x-kernel-test-principal": `${actor}:${ORG}` }, body: fd,
  });
  if (res.status !== 201) throw new Error(`upload ${filename} → ${res.status}`);
  return (await res.json() as { id: string }).id;
}

function postMessage(threadId: string, body: Record<string, unknown>) {
  return fetch(`${BASE}/chat/threads/${threadId}/messages`, {
    method: "POST",
    headers: { "x-kernel-test-principal": `${ACTOR}:${ORG}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function listAttachments(actor: string, threadId: string, projectId = PROJECT) {
  return fetch(`${BASE}/chat/threads/${threadId}/attachments?projectId=${encodeURIComponent(projectId)}`, {
    headers: { "x-kernel-test-principal": `${actor}:${ORG}` },
  });
}

async function publishAgent(): Promise<void> {
  await asApp(ORG, async (c) => {
    await c.query(
      `INSERT INTO chat_wave2_fixture.agents (id, org_id, status, published_version_id)
       VALUES ($1,$2,'enabled',$3)`, [AGENT, ORG, VERSION]);
    await c.query(
      `INSERT INTO chat_wave2_fixture.agent_versions
         (id, org_id, agent_id, skill_version_ids, model_provider, model_id, published_at)
       VALUES ($1,$2,$3,$4::jsonb,'dashscope','qwen-plus',now())`,
      [VERSION, ORG, AGENT, JSON.stringify(SKILLS)]);
  });
}

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  await asOwner((c) => createChatWave2FixtureSchema(c));
  const { createApp } = await import("../../src/main");
  app = await createApp();
  await app.listen(0);
  const addr = app.getHttpServer().address();
  BASE = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
}, 180_000);

afterAll(async () => {
  await app?.close();
  await asOwner((c) => c.query("DROP SCHEMA IF EXISTS chat_wave2_fixture CASCADE"));
});

beforeEach(async () => {
  await asOwner(async (c) => {
    await c.query("DELETE FROM chat_wave2_fixture.agent_versions");
    await c.query("DELETE FROM chat_wave2_fixture.agents");
  });
  await resetOrgs(ORG);
  const fx = await seedOrg({ orgId: ORG, projectId: PROJECT });
  await addOrgMember(ORG, ACTOR, "consultant", fx.teams.energy!);
  await addProjectMember(ORG, PROJECT, ACTOR, "facilitator", null);
  await addOrgMember(ORG, OBSERVER, "consultant", fx.teams.energy!);
  await addProjectMember(ORG, PROJECT, OBSERVER, "observer", null);
  await addChatThread({ orgId: ORG, id: THREAD, projectId: PROJECT, visibilityScope: "plenary", createdBy: ACTOR });
  await publishAgent();
});

describe("GET /chat/threads/:threadId/attachments — listThreadAttachments（#728 D9）", () => {
  it("200：pending 附件不出现，已挂消息的附件出现，形状带 messageId", async () => {
    const pendingOnly = await uploadTo(ACTOR, THREAD, "still-drafting.pdf");
    const sent = await uploadTo(ACTOR, THREAD, "sent.pdf");
    const res = await postMessage(THREAD, {
      clientMessageId: randomUUID(), text: "看这个文件", agentId: AGENT, attachmentIds: [sent],
    });
    expect(res.status).toBe(202);
    const messageId = (await res.json() as { message: { id: string } }).message.id;

    const list = await listAttachments(ACTOR, THREAD);
    expect(list.status).toBe(200);
    const body = await list.json() as { items: Array<{ id: string; filename: string; mime: string; bytes: number; createdAt: string; messageId: string }> };
    const ids = body.items.map((x) => x.id);
    expect(ids).toContain(sent);
    expect(ids).not.toContain(pendingOnly); // 核心边界：草稿态 pending 不算材料
    const hit = body.items.find((x) => x.id === sent)!;
    expect(hit).toMatchObject({
      filename: "sent.pdf", mime: "application/pdf", bytes: PDF.byteLength, messageId,
    });
    expect(typeof hit.createdAt).toBe("string");
  });

  it("200：多条材料按 created_at DESC 排列（最新在前）", async () => {
    const a = await uploadTo(ACTOR, THREAD, "a.pdf");
    await postMessage(THREAD, { clientMessageId: randomUUID(), text: "第一条", agentId: AGENT, attachmentIds: [a] });
    await new Promise((r) => setTimeout(r, 20)); // 确保 created_at 不同，排序才有意义
    const b = await uploadTo(ACTOR, THREAD, "b.pdf");
    await postMessage(THREAD, { clientMessageId: randomUUID(), text: "第二条", agentId: AGENT, attachmentIds: [b] });

    const list = await listAttachments(ACTOR, THREAD);
    const body = await list.json() as { items: Array<{ id: string }> };
    expect(body.items.map((x) => x.id)).toEqual([b, a]); // 最新（b）在前
  });

  it("200：这条线程还没有任何已发出材料时返回空数组，不是伪造一条示例行", async () => {
    const list = await listAttachments(ACTOR, THREAD);
    expect(list.status).toBe(200);
    expect(await list.json()).toEqual({ items: [] });
  });

  it("200：观察者（只读角色）仍能读材料——这是读路径，不是写路径", async () => {
    const a = await uploadTo(ACTOR, THREAD, "shared.pdf");
    await postMessage(THREAD, { clientMessageId: randomUUID(), text: "共享", agentId: AGENT, attachmentIds: [a] });
    const list = await listAttachments(OBSERVER, THREAD);
    expect(list.status).toBe(200);
    const body = await list.json() as { items: Array<{ id: string }> };
    expect(body.items.map((x) => x.id)).toEqual([a]);
  });

  it("404：不存在/不可见的线程——裸 404，不带 reasonCode（I-3，与 listThreadArtifacts 同一处置）", async () => {
    const res = await listAttachments(ACTOR, "thread-does-not-exist");
    expect(res.status).toBe(404);
    expect(await res.json()).not.toHaveProperty("reasonCode");
  });
});

/**
 * 个人线程（`projectId: null`，issue #1824）—— 人类今天在 devapp 实测发现个人对话
 * 完全没有右栏，追查发现 `listThreadAttachments` 全链路（这个用例 + controller +
 * 前端 client）此前都要求 `projectId` 非空字符串，个人线程一条都读不出来。
 * `listThreadArtifacts` 早在 2026-08-21 就支持了 `projectId: null`，这里补齐同一条
 * 判权分派规则（`resolveVisibility` 的 `projectId === null` 分支本就支持，缺的只是
 * 这条 use case/controller/client 三层没有把 `null` 传进去）。
 */
const PERSONAL_THREAD = "thread-d9-materials-personal";
const PERSONAL_OWNER = "u-d9-materials-personal-owner";
const PERSONAL_OTHER = "u-d9-materials-personal-other";

describe("GET /chat/threads/:threadId/attachments — 个人线程（projectId: null，#1824）", () => {
  beforeEach(async () => {
    await addOrgMember(ORG, PERSONAL_OWNER, "consultant", null);
    await addOrgMember(ORG, PERSONAL_OTHER, "consultant", null);
    await addChatThread({
      orgId: ORG, id: PERSONAL_THREAD, projectId: null, groupId: null,
      visibilityScope: "plenary", createdBy: PERSONAL_OWNER, title: "个人对话",
    });
  });

  it("200：不传 projectId query（缺省 ⇒ 后端归一成 null）——创建者能读回已挂消息的材料", async () => {
    const sent = await uploadTo(PERSONAL_OWNER, PERSONAL_THREAD, "personal-sent.pdf");
    const res = await fetch(`${BASE}/chat/threads/${PERSONAL_THREAD}/messages`, {
      method: "POST",
      headers: { "x-kernel-test-principal": `${PERSONAL_OWNER}:${ORG}`, "content-type": "application/json" },
      body: JSON.stringify({
        clientMessageId: randomUUID(), text: "个人对话里的文件", agentId: AGENT, attachmentIds: [sent],
      }),
    });
    expect(res.status).toBe(202);

    // 关键：不带 `?projectId=` 查询参数——这正是个人对话前端会发出的真实请求形状。
    const list = await fetch(`${BASE}/chat/threads/${PERSONAL_THREAD}/attachments`, {
      headers: { "x-kernel-test-principal": `${PERSONAL_OWNER}:${ORG}` },
    });
    expect(list.status).toBe(200);
    const body = await list.json() as { items: Array<{ id: string }> };
    expect(body.items.map((x) => x.id)).toEqual([sent]);
  });

  it("404：非创建者读别人的个人线程材料——不可见与不存在同一个出口（I-3）", async () => {
    const list = await fetch(`${BASE}/chat/threads/${PERSONAL_THREAD}/attachments`, {
      headers: { "x-kernel-test-principal": `${PERSONAL_OTHER}:${ORG}` },
    });
    expect(list.status).toBe(404);
    expect(await list.json()).not.toHaveProperty("reasonCode");
  });
});
