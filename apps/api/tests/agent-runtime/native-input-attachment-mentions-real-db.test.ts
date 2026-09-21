/**
 * issue #3727 —— `@文件名` 引用的历史附件真的进 run 的输入范围（真实 PG）。
 *
 * devapp 实测坏形态：用户上一条消息传了截图，这一条 `@截屏….png 请重新计算`，模型在
 * `/inputs/` 找不到任何 PNG。这里对两条读路径（沙箱 `/inputs` 挂载与视觉输入）各断言：
 *   ① 触发消息正文点名的、同作者的历史附件 → 在范围内；
 *   ② 没被点名的历史附件 → 不在；
 *   ③ 另一个用户在同一线程贴的同名文件 → 不在（作者锚对 `@` 分支同样生效）；
 *   ④ agent 消息上的同名附件 → 不在（author_kind 锚）；
 *   ⑤ 只是前缀相同（`x.png.bak`）→ 不在（词边界在 domain 纯函数里）；
 *   ⑥ `read()` 对范围外的 id 返回 null，对范围内的历史附件返回字节。
 */
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";
import { addOrgMember, asApp, ensureDatabase, migrateOnce, resetOrgs, seedOrg } from "../support/db";
import { addChatMessage, addChatThread } from "../support/chat-db";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { appConfig } from "../../src/infrastructure/db/pg-config";
import { toOrgId } from "../../src/domain/org-id";
import { PgNativeRunInputs } from "../../src/infrastructure/agent-run/pg-native-run-inputs";
import { PgRunImageInput } from "../../src/infrastructure/agent-run/pg-run-image-input";
import { PgIdentityRepository } from "../../src/infrastructure/identity/pg-identity-repository";
import { PgChatRepository } from "../../src/infrastructure/chat/pg-chat-repository";
import { FsObjectStore } from "../../src/infrastructure/storage/fs-object-store";

const org = toOrgId("mention-" + randomUUID());
const thread = `thread-${org}`, agent = `agent-${org}`, version = `version-${org}`, run = "run-" + randomUUID();
const MENTIONED = "截屏2026-09-18 15.48.24.png";
let db: PgDatabase;
let root: string;
let objects: FsObjectStore;
const ids = { mentioned: "att-" + randomUUID(), unmentioned: "att-" + randomUUID(), intruder: "att-" + randomUUID(), agentFile: "att-" + randomUUID(), prefix: "att-" + randomUUID() };
const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

async function attach(id: string, messageId: string, filename: string, key: string) {
  await objects.putOnce(key, png, "image/png");
  await asApp(org, (c) => c.query(
    `INSERT INTO chat_message_attachments(id,org_id,thread_id,message_id,storage_ref,filename,mime,bytes,created_at)
     VALUES($1,$2,$3,$4,$5,$6,'image/png',$7,now())`, [id, org, thread, messageId, key, filename, png.length]));
}

beforeAll(async () => {
  await ensureDatabase(); await migrateOnce(); db = new PgDatabase(appConfig());
  root = await mkdtemp(join(tmpdir(), "mention-input-")); objects = new FsObjectStore(root);
  await seedOrg({ orgId: org, projectId: `project-${org}` });
  await addOrgMember(org, "actor", "consultant", null);
  await addOrgMember(org, "intruder", "consultant", null);
  await addChatThread({ orgId: org, id: thread, projectId: null, visibilityScope: "private", createdBy: "actor" });
  // 历史消息：actor 传了两张图（一张会被点名）；intruder 和 agent 各贴了一张同名文件；actor 还传了一张只是前缀相同的。
  await addChatMessage({ orgId: org, id: "m-old", threadId: thread, body: "先看这张", authorId: "actor" });
  await addChatMessage({ orgId: org, id: "m-intruder", threadId: thread, body: "我也传一张", authorId: "intruder" });
  await addChatMessage({ orgId: org, id: "m-agent", threadId: thread, body: "生成了一张", authorId: "actor", authorKind: "agent", agentId: agent });
  await addChatMessage({ orgId: org, id: "m-now", threadId: thread, body: `@${MENTIONED} 这个是截图，请重新计算`, authorId: "actor" });
  await asApp(org, async (c) => {
    await c.query(`INSERT INTO agents(id,org_id,stable_name,name,status,creator_id,created_at,updated_at) VALUES($1,$2,'t3727','T3727','enabled','actor',now(),now())`, [agent, org]);
    await c.query(`INSERT INTO agent_versions(id,org_id,agent_id,semantic_label,instruction_digest,instructions,skill_version_ids,model_provider,model_id,tool_policy,creator_id,created_at,published_at)
      VALUES($1,$2,$3,'v1',$4,'pinned','{}','test-provider','pinned-model','[]','actor',now(),now())`, [version, org, agent, createHash("sha256").update("pinned").digest("hex")]);
    await c.query(`INSERT INTO agent_runs(id,org_id,thread_id,input_message_id,agent_id,agent_version_id,skill_version_ids,model_provider,model_id,status)
      VALUES($1,$2,$3,'m-now',$4,$5,'[]','test-provider','pinned-model','running')`, [run, org, thread, agent, version]);
  });
  await attach(ids.mentioned, "m-old", MENTIONED, "mentioned.png");
  await attach(ids.unmentioned, "m-old", "另一张.png", "unmentioned.png");
  await attach(ids.intruder, "m-intruder", MENTIONED, "intruder.png");
  await attach(ids.agentFile, "m-agent", MENTIONED, "agent.png");
  await attach(ids.prefix, "m-old", `${MENTIONED}.bak`, "prefix.png");
});
afterAll(async () => { await db?.close(); await resetOrgs(org); await rm(root, { recursive: true, force: true }); });

it("沙箱 /inputs：正文 @ 点名的同作者历史附件被挂载；未点名 / 他人 / agent / 前缀同名的都不在", async () => {
  const reader = new PgNativeRunInputs(db, objects, { repo: new PgIdentityRepository(db), ids: { next: () => randomUUID() }, chat: new PgChatRepository(db) });
  const set = await reader.read({ orgId: org, parentRunId: run, attemptId: run + ":0", leaseEpoch: 1 });
  expect(set.manifest.map((f) => f.attachmentId)).toEqual([ids.mentioned]);
  expect(set.manifest[0]).toMatchObject({ filename: MENTIONED, mediaType: "image/png", sizeBytes: png.length });
  expect(set.files[0]?.contentBase64).toBe(png.toString("base64"));
});

it("视觉输入：list 只回点名的那一张；read 对范围外的 id 返回 null", async () => {
  const port = new PgRunImageInput(db, objects);
  const scope = { threadId: thread, messageId: "m-now", actorUserId: "actor" };
  expect((await port.list(org, scope)).map((r) => r.attachmentId)).toEqual([ids.mentioned]);
  expect(Buffer.from((await port.read(org, scope, ids.mentioned))!)).toEqual(png);
  for (const id of [ids.unmentioned, ids.intruder, ids.agentFile, ids.prefix]) expect(await port.read(org, scope, id)).toBeNull();
  // 另一个作者以同一条消息为锚也拿不到：作者锚对两个分支同时生效。
  expect(await port.list(org, { ...scope, actorUserId: "intruder" })).toEqual([]);
});
