/**
 * #946 · V9-a F151 —— 附件挂消息 + listMessages 投影 + 级联删除，真实栈 e2e。
 *
 * 走 F150 上传端点拿到 pending 附件 id，再经 createMessage(attachmentIds) 原子挂载，
 * 断言：挂后 pending 归零、listMessages 回读到 attachments 投影、跨线程/重复挂被拒且
 * 整条消息回滚、删线程时附件（含 pending）随 FK CASCADE 一并消失。
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

const ORG = "org-v9a-mount";
const PROJECT = "proj-v9a-mount";
const THREAD = "thread-v9a-mount";
const THREAD2 = "thread-v9a-mount-other";
const ACTOR = "u-v9a-mount";
const AGENT = "agent-v9a-mount-published";
const VERSION = "agent-version-v9a-mount-v1";
const SKILLS = ["skill-version-x-v1"];

let BASE: string;
let app: NestExpressApplication;

const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37, 0x0a]);

async function uploadTo(threadId: string, filename: string): Promise<string> {
  const fd = new FormData();
  fd.append("file", new Blob([PDF], { type: "application/pdf" }), filename);
  const res = await fetch(`${BASE}/chat/threads/${threadId}/attachments`, {
    method: "POST", headers: { "x-kernel-test-principal": `${ACTOR}:${ORG}` }, body: fd,
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

function getMessages(threadId: string) {
  return fetch(`${BASE}/chat/threads/${threadId}/messages`, {
    headers: { "x-kernel-test-principal": `${ACTOR}:${ORG}` },
  });
}

const pending = (threadId: string) => asApp(ORG, async (c) => Number((await c.query<{ n: string }>(
  "SELECT count(*)::text AS n FROM chat_message_attachments WHERE thread_id=$1 AND message_id IS NULL",
  [threadId])).rows[0]!.n));

const attachedTo = (messageId: string) => asApp(ORG, async (c) => Number((await c.query<{ n: string }>(
  "SELECT count(*)::text AS n FROM chat_message_attachments WHERE message_id=$1",
  [messageId])).rows[0]!.n));

const rowsForThread = (threadId: string) => asApp(ORG, async (c) => Number((await c.query<{ n: string }>(
  "SELECT count(*)::text AS n FROM chat_message_attachments WHERE thread_id=$1",
  [threadId])).rows[0]!.n));

const messageCount = (threadId: string) => asApp(ORG, async (c) => Number((await c.query<{ n: string }>(
  "SELECT count(*)::text AS n FROM chat_messages WHERE thread_id=$1", [threadId])).rows[0]!.n));

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
  await addChatThread({ orgId: ORG, id: THREAD, projectId: PROJECT, visibilityScope: "plenary", createdBy: ACTOR });
  await addChatThread({ orgId: ORG, id: THREAD2, projectId: PROJECT, visibilityScope: "plenary", createdBy: ACTOR });
  await publishAgent();
});

describe("createMessage(attachmentIds) 挂附件 + listMessages 投影 + 级联", () => {
  it("上传两附件→带 attachmentIds 发消息→挂上、pending 归零、listMessages 回读到 attachments", async () => {
    const a = await uploadTo(THREAD, "a.pdf");
    const b = await uploadTo(THREAD, "b.pdf");
    expect(await pending(THREAD)).toBe(2);

    const res = await postMessage(THREAD, {
      clientMessageId: randomUUID(), text: "看这两个文件", agentId: AGENT, attachmentIds: [a, b],
    });
    expect(res.status).toBe(202);
    const messageId = (await res.json() as { message: { id: string } }).message.id;

    expect(await pending(THREAD)).toBe(0);       // 两个都从 pending 转为已挂
    expect(await attachedTo(messageId)).toBe(2);  // 都挂到这条消息

    const list = await getMessages(THREAD);
    expect(list.status).toBe(200);
    const msg = (await list.json() as { messages: Array<{ id: string; attachments?: Array<{ id: string; filename: string; mime: string; bytes: number }> }> })
      .messages.find((m) => m.id === messageId)!;
    expect(msg.attachments).toBeDefined();
    expect(msg.attachments!.map((x) => x.id).sort()).toEqual([a, b].sort());
    expect(msg.attachments!.every((x) => x.mime === "application/pdf" && x.bytes === PDF.byteLength)).toBe(true);
  });

  it("跨线程 attachmentId → 422 ATTACHMENT_NOT_PENDING，消息与挂载都回滚", async () => {
    const foreign = await uploadTo(THREAD2, "foreign.pdf"); // 属于 THREAD2
    const res = await postMessage(THREAD, {
      clientMessageId: randomUUID(), text: "偷挂别线程的", agentId: AGENT, attachmentIds: [foreign],
    });
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ reasonCode: "ATTACHMENT_NOT_PENDING" });
    expect(await messageCount(THREAD)).toBe(0);        // 消息未写入（原子回滚）
    expect(await pending(THREAD2)).toBe(1);            // foreign 仍是 THREAD2 的 pending
  });

  it("同一附件不能挂到两条消息（第二条 → 422，且第二条消息回滚）", async () => {
    const a = await uploadTo(THREAD, "once.pdf");
    const first = await postMessage(THREAD, {
      clientMessageId: randomUUID(), text: "第一次", agentId: AGENT, attachmentIds: [a],
    });
    expect(first.status).toBe(202);
    const second = await postMessage(THREAD, {
      clientMessageId: randomUUID(), text: "想再挂一次", agentId: AGENT, attachmentIds: [a],
    });
    expect(second.status).toBe(422);
    expect(await second.json()).toMatchObject({ reasonCode: "ATTACHMENT_NOT_PENDING" });
    expect(await messageCount(THREAD)).toBe(1); // 只有第一条落库
  });

  it("不存在的 attachmentId → 422，消息回滚", async () => {
    const res = await postMessage(THREAD, {
      clientMessageId: randomUUID(), text: "挂个不存在的", agentId: AGENT, attachmentIds: ["att-nope"],
    });
    expect(res.status).toBe(422);
    expect(await messageCount(THREAD)).toBe(0);
  });

  it("级联删除：删线程 → 该线程附件行随 thread_id FK ON DELETE CASCADE 全部消失", async () => {
    // ⚠ 用 THREAD2（本用例不给它发消息）验级联：一条**带 agent run 的线程**无法被硬删——
    // run 的 append-only steps 触发器会挡下级联到 agent_run_steps 的 DELETE（本系统里带 run
    // 的线程是归档而非硬删）。附件的 thread_id CASCADE 是「组织级删除/线程硬删」的安全网，
    // 用一条无 run 的线程即可如实验证 FK 行为，不与 steps append-only 守卫纠缠。
    await uploadTo(THREAD2, "p1.pdf");
    await uploadTo(THREAD2, "p2.pdf");
    expect(await rowsForThread(THREAD2)).toBe(2); // 两个 pending

    await asApp(ORG, (c) => c.query("DELETE FROM chat_threads WHERE id=$1", [THREAD2]));
    expect(await rowsForThread(THREAD2)).toBe(0); // FK CASCADE 带走
  });
});
