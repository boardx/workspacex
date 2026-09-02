/**
 * 线程自动命名叠加模型摘要（`generate-thread-title.ts`）——**真实栈**门控。
 *
 * 同 `generate-followup-suggestions.test.ts` 的纪律：真实 HTTP loopback provider、
 * 真实 `ConfiguredModelProvider`，不在 `ModelCallPort` 边界注入假实现。走的是完整的
 * `POST /chat/threads/:threadId/messages`（自动命名唯一的接线点是 `acceptHumanMessage`，
 * 见 `message-roundtrip.ts` 头注），不是直接调用 `generateThreadTitle`——那样测不出
 * "两条轨道共用同一份接线"这件事的真实值。
 *
 * 三条断言线：
 *   ① 模型可用 ⇒ 标题是模型回复（经折叠/截断），不是首条消息的字面截断；
 *   ② 模型失败（HTTP 500）⇒ 落回 `deriveThreadTitle`，请求仍然 202，不因为起名失败
 *      让整个「发消息」变成失败；
 *   ③ 模型超时（响应挂起超过 `THREAD_TITLE_TIMEOUT_MS`）⇒ 同样落回截断，且落回
 *      发生在这条请求返回之前——不存在"标题先显示新对话、几秒后自己跳成模型版本"。
 */
import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  addOrgMember, asApp, asOwner, ensureDatabase, migrateOnce, resetOrgs, seedOrg,
} from "../support/db";
import { addChatThread } from "../support/chat-db";
import { createChatWave2FixtureSchema } from "../support/chat-wave2-fixture-schema";
import { DEFAULT_PERSONAL_THREAD_TITLE } from "../../src/application/chat/mutate-thread";
import { deriveThreadTitle } from "../../src/domain/chat/thread-title";
import { THREAD_TITLE_TIMEOUT_MS } from "../../src/application/chat/generate-thread-title";

process.env.KERNEL_ALLOW_TEST_PRINCIPAL = "1";
process.env.KERNEL_QUIET = "1";
process.env.KERNEL_AGENT_CATALOG_SCHEMA = "chat_wave2_fixture";
process.env.KERNEL_AGENT_RUN_AUTOSTART = "0"; // 只验受理落库+起名，不跑执行

const ORG = "org-thread-title-model";
const PROJECT = "proj-thread-title-model";
const ACTOR = "u-thread-title-model-owner";
const AGENT = "agent-thread-title-model";
const VERSION = "agent-version-thread-title-model-v1";

const PROVIDER = "thread-title-loopback";
const API_KEY = "sk-thread-title-do-not-echo";

let app: NestExpressApplication;
let BASE = "";
let providerServer: Server;
let providerBase = "";

interface CapturedCall {
  readonly body: { messages?: { role: string; content: string }[] };
}
let calls: CapturedCall[] = [];
/** 每个测试按需覆盖。 */
let nextReplyText = "周报撰写协助";
let nextStatus = 200;
/** 模拟"挂起不回"，用来测超时落回——不是快速 500，是真的不 respond。 */
let hangResponse = false;

async function startProvider(): Promise<void> {
  providerServer = createServer((req: IncomingMessage, res: ServerResponse) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      if (hangResponse) return; // 故意不 respond，模拟慢/挂起的上游。
      const raw = Buffer.concat(chunks).toString("utf8");
      let body: CapturedCall["body"] = {};
      try {
        body = JSON.parse(raw) as CapturedCall["body"];
      } catch {
        body = {};
      }
      calls.push({ body });
      if (nextStatus !== 200) {
        res.writeHead(nextStatus, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "loopback configured to fail" }));
        return;
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({
        choices: [{ message: { role: "assistant", content: nextReplyText } }],
        usage: { total_tokens: 9 },
      }));
    });
  });
  await new Promise<void>((resolve) => providerServer.listen(0, "127.0.0.1", resolve));
  const addr = providerServer.address() as AddressInfo;
  providerBase = `http://127.0.0.1:${addr.port}`;
}

const as = (userId: string) => ({
  "x-kernel-test-principal": `${userId}:${ORG}`,
  "content-type": "application/json",
});

function postMessage(threadId: string, text: string) {
  return fetch(`${BASE}/chat/threads/${threadId}/messages`, {
    method: "POST",
    headers: as(ACTOR),
    body: JSON.stringify({ clientMessageId: randomUUID(), text, agentId: AGENT }),
  });
}

async function newPersonalThread(): Promise<string> {
  const id = `thr-title-model-${randomUUID()}`;
  await addChatThread({
    orgId: ORG, id, projectId: null, visibilityScope: "private", createdBy: ACTOR,
    title: DEFAULT_PERSONAL_THREAD_TITLE,
  });
  return id;
}

type Card = { id: string; title: string };
type ListOut = { groups: { cards: Card[] }[] };

async function titleOf(threadId: string): Promise<string | undefined> {
  const res = await fetch(`${BASE}/chat/threads`, { headers: as(ACTOR) });
  expect(res.status).toBe(200);
  const body = (await res.json()) as ListOut;
  return body.groups.flatMap((g) => g.cards).find((c) => c.id === threadId)?.title;
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
      [VERSION, ORG, AGENT, JSON.stringify([])]);
  });
}

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  await asOwner((c) => createChatWave2FixtureSchema(c));
  await startProvider();
  // 本文件是仅有的两个真调这条路径的文件之一（另一个是
  // thread-title-and-status.test.ts）——默认关，见 `thread-title-model-config.ts`
  // 头注：不这样开，`readThreadTitleModelConfig` 读到的 provider 恒为 `""`。
  process.env.KERNEL_THREAD_TITLE_MODEL_ENABLED = "1";
  process.env.KERNEL_MODEL_PROVIDER = PROVIDER;
  process.env.KERNEL_MODEL_BASE_URL = providerBase;
  process.env.KERNEL_MODEL_API_KEY = API_KEY;
  const { createApp } = await import("../../src/main");
  app = await createApp();
  await app.listen(0);
  const addr = app.getHttpServer().address();
  BASE = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
}, 180_000);

afterAll(async () => {
  await app?.close();
  // ③ 的挂起用例故意不 respond，那条连接的 socket 因此永远打开——graceful `close()`
  // 会等它，在这里挂到 hook 超时。`closeAllConnections()`（Node ≥18.2）先把仍打开的
  // 连接砍断，`close()` 才能真的 resolve。
  providerServer.closeAllConnections();
  await new Promise<void>((resolve) => providerServer.close(() => resolve()));
  await asOwner((c) => c.query("DROP SCHEMA IF EXISTS chat_wave2_fixture CASCADE"));
  delete process.env.KERNEL_THREAD_TITLE_MODEL_ENABLED;
  delete process.env.KERNEL_MODEL_PROVIDER;
  delete process.env.KERNEL_MODEL_BASE_URL;
  delete process.env.KERNEL_MODEL_API_KEY;
});

afterEach(() => {
  calls = [];
  nextReplyText = "周报撰写协助";
  nextStatus = 200;
  hangResponse = false;
});

beforeEach(async () => {
  // 同 message-write-roundtrip.test.ts 的既有先例：chat_wave2_fixture 是本文件
  // beforeAll 建的固定 schema（同名，非按测试隔离），resetOrgs 只清标准 org 表，
  // 不会带上这两张 fixture 表——不先清，第二个用例的 publishAgent() 就撞主键。
  await asOwner(async (c) => {
    await c.query("DELETE FROM chat_wave2_fixture.agent_versions");
    await c.query("DELETE FROM chat_wave2_fixture.agents");
  });
  await resetOrgs(ORG);
  const fx = await seedOrg({ orgId: ORG, projectId: PROJECT });
  await addOrgMember(ORG, ACTOR, "consultant", fx.teams.energy!);
  await publishAgent();
});

describe("自动命名叠加模型摘要 —— POST /chat/threads/:id/messages", () => {
  it("① 模型可用 ⇒ 标题是模型回复（折叠后），不是首条消息的字面截断", async () => {
    const threadId = await newPersonalThread();
    const text = "帮我写一份下季度的能耗预算周报，突出同比变化";
    nextReplyText = "能耗预算周报";

    expect((await postMessage(threadId, text)).status).toBe(202);

    const title = await titleOf(threadId);
    expect(title).toBe("能耗预算周报");
    expect(title).not.toBe(deriveThreadTitle(text));
    expect(calls).toHaveLength(1);
    // 真的把首条消息正文送进了模型调用——不是套壳固定 prompt。
    const userTurns = calls[0]!.body.messages!.filter((m) => m.role === "user").map((m) => m.content);
    expect(userTurns.some((c) => c.includes("能耗预算周报"))).toBe(true);
  });

  it("② 模型调用失败（HTTP 500）⇒ 落回 deriveThreadTitle，发消息仍然 202", async () => {
    const threadId = await newPersonalThread();
    const text = "随便问一句测试用的话";
    nextStatus = 500;

    const res = await postMessage(threadId, text);
    expect(res.status, "起名失败不该把发消息本身打红").toBe(202);

    const title = await titleOf(threadId);
    expect(title).toBe(deriveThreadTitle(text));
  });

  it(
    "③ 模型调用挂起超过硬超时 ⇒ 同样落回截断，且这次请求本身没有被拖到超过硬超时太多",
    async () => {
      const threadId = await newPersonalThread();
      const text = "这条消息的模型调用会挂起，必须靠超时兜底";
      hangResponse = true;

      const startedAt = Date.now();
      const res = await postMessage(threadId, text);
      const elapsedMs = Date.now() - startedAt;
      expect(res.status).toBe(202);

      const title = await titleOf(threadId);
      expect(title).toBe(deriveThreadTitle(text));
      // 请求没有被模型调用拖到远超硬超时——留了充分的调度余量，只要求"数量级对"，
      // 不做脆弱的毫秒级断言。
      expect(elapsedMs).toBeLessThan(THREAD_TITLE_TIMEOUT_MS * 5);
    },
    THREAD_TITLE_TIMEOUT_MS * 10,
  );

  it("④ 标题已不是默认名（非首条消息 / 用户改过名）⇒ 一次起名模型调用都不发", async () => {
    const threadId = await newPersonalThread();
    nextReplyText = "首条起名";
    expect((await postMessage(threadId, "第一条：请帮我起个名")).status).toBe(202);
    expect(await titleOf(threadId)).toBe("首条起名");
    expect(calls).toHaveLength(1);

    // 反证：此前的实现在这里会再调一次模型、然后被 `WHERE title = $默认名` 丢掉——
    // 用户每条消息都白等一次起名往返（超时时是整整 THREAD_TITLE_TIMEOUT_MS）。
    hangResponse = true; // 若真的再调模型，这条请求会被拖到超时；不调则秒回。
    const startedAt = Date.now();
    expect((await postMessage(threadId, "第二条：随便聊聊")).status).toBe(202);
    expect(Date.now() - startedAt).toBeLessThan(THREAD_TITLE_TIMEOUT_MS);
    expect(await titleOf(threadId)).toBe("首条起名");
    expect(calls, "第二条消息不该产生新的模型调用").toHaveLength(1);
  });

  it("模型回复为空白 ⇒ 同样落回截断，不写一个空标题", async () => {
    const threadId = await newPersonalThread();
    const text = "这条消息模型会回一个空字符串";
    nextReplyText = "   ";

    expect((await postMessage(threadId, text)).status).toBe(202);

    const title = await titleOf(threadId);
    expect(title).toBe(deriveThreadTitle(text));
  });
});
