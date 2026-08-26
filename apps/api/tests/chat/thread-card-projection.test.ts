/**
 * 🔴 issue #2094 —— 线程卡投影的**真实栈门控**（人类裁决落地，回指 #2068）。
 *
 * 走完整链路：建个人线程 → `POST /chat/threads/:id/messages` → `GET /chat/threads`，
 * 断言卡片上的三件事都是**真的**：
 *
 *   ① 自动命名真的发生了（标题不再是「新对话」，且逐字等于首条消息的截断）；
 *   ② `agentSummary` 真的不在响应里了（契约 `.strict()` 会拒，但这里显式钉住，
 *      免得将来有人「顺手加回去」时只有一个不易读懂的 zod 错误）；
 *   ③ `status` / `artifactCount` 真的在，且取值来自真实的表，不是常量。
 *
 * ## 为什么这个文件必须存在，而不是靠 e2e
 *
 * 真栈 e2e 证的是「屏幕上看得见」。本文件证的是**服务端这一半独立成立**——
 * 两者失败时的诊断完全不同：e2e 红可能是前端没刷新、可能是服务端没起名，
 * 一条断言分不清是哪一层。本轮实测就撞上了这个：`TW-P1-1` 在真栈上红，
 * 而红的原因**不是**服务端没起名（本文件绿），是侧栏列表在消息落定后没有重取。
 * 没有这一层，那次诊断只能靠猜。
 *
 * ## 「自动命名不覆盖用户改过的名字」是反证，不是正证
 *
 * 一个「无条件起名」的实现能通过上面①。只有「先改名、再发消息、断言改名还在」
 * 那一条能把它抓出来——`WHERE title = $默认名` 那句 SQL 的全部价值就在这条用例里。
 */
import { randomUUID } from "node:crypto";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  addOrgMember, asApp, asOwner, ensureDatabase, migrateOnce, resetOrgs, seedOrg,
} from "../support/db";
import { addChatThread } from "../support/chat-db";
import { createChatWave2FixtureSchema } from "../support/chat-wave2-fixture-schema";
import { DEFAULT_PERSONAL_THREAD_TITLE } from "../../src/application/chat/mutate-thread";
import { deriveThreadTitle } from "../../src/domain/chat/thread-title";

process.env.KERNEL_ALLOW_TEST_PRINCIPAL = "1";
process.env.KERNEL_QUIET = "1";
process.env.KERNEL_AGENT_CATALOG_SCHEMA = "chat_wave2_fixture";
process.env.KERNEL_AGENT_RUN_AUTOSTART = "0"; // 只验受理落库，不跑执行

const ORG = "org-2094-card";
const PROJECT = "proj-2094-card";
const ACTOR = "u-2094-card-owner";
const AGENT = "agent-2094-card";
const VERSION = "agent-version-2094-card-v1";

let BASE: string;
let app: NestExpressApplication;

const as = (userId: string) => ({
  "x-kernel-test-principal": `${userId}:${ORG}`,
  "content-type": "application/json",
});

type Card = {
  id: string;
  title: string;
  status: string;
  artifactCount: number;
  agentSummary?: unknown;
};
type ListOut = { groups: { label: string; cards: Card[] }[] };

async function listPersonalCards(): Promise<Card[]> {
  const res = await fetch(`${BASE}/chat/threads`, { headers: as(ACTOR) });
  expect(res.status).toBe(200);
  const body = (await res.json()) as ListOut;
  return body.groups.flatMap((g) => g.cards);
}

function postMessage(threadId: string, text: string) {
  return fetch(`${BASE}/chat/threads/${threadId}/messages`, {
    method: "POST",
    headers: as(ACTOR),
    body: JSON.stringify({ clientMessageId: randomUUID(), text, agentId: AGENT }),
  });
}

/** 造一条个人线程（`project_id IS NULL`），标题为默认名——即「新建对话」之后的状态。 */
async function newPersonalThread(title = DEFAULT_PERSONAL_THREAD_TITLE): Promise<string> {
  const id = `thr-2094-${randomUUID()}`;
  await addChatThread({
    orgId: ORG, id, projectId: null, visibilityScope: "private", createdBy: ACTOR, title,
  });
  return id;
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
  await publishAgent();
});

describe("线程卡投影 —— 自动命名 + 状态 + 产物数（#2094）", () => {
  it("首条用户消息落库后，标题自动变成该消息的截断——不再是「新对话」", async () => {
    const threadId = await newPersonalThread();
    const text = "帮我调研一下国内协同白板产品的竞品格局";

    const before = (await listPersonalCards()).find((c) => c.id === threadId);
    expect(before?.title, "前置条件：发消息之前它就该叫默认名").toBe(DEFAULT_PERSONAL_THREAD_TITLE);

    expect((await postMessage(threadId, text)).status).toBe(202);

    const after = (await listPersonalCards()).find((c) => c.id === threadId);
    expect(after?.title).not.toBe(DEFAULT_PERSONAL_THREAD_TITLE);
    // 逐字等于纯函数的输出——「标题是怎么来的」只有一个答案，不是「大概像那条消息」。
    expect(after?.title).toBe(deriveThreadTitle(text));
  });

  /**
   * 反证：无条件起名的实现在上一条上是绿的，只有这条能抓住它。
   * `autoTitleThreadIfDefault` 的 `WHERE title = $默认名` 全部价值在此。
   */
  it("用户已改过名的线程，发消息**不会**被自动命名盖掉", async () => {
    const mine = "季度复盘（我自己起的名）";
    const threadId = await newPersonalThread(mine);

    expect((await postMessage(threadId, "随便发一条")).status).toBe(202);

    const after = (await listPersonalCards()).find((c) => c.id === threadId);
    expect(after?.title).toBe(mine);
  });

  /** 只有**首条**消息起名：第二条进来时标题已非默认名，UPDATE 命中 0 行。 */
  it("第二条消息不会重新起名", async () => {
    const threadId = await newPersonalThread();
    expect((await postMessage(threadId, "第一条：写周报")).status).toBe(202);
    const firstTitle = (await listPersonalCards()).find((c) => c.id === threadId)?.title;

    expect((await postMessage(threadId, "第二条：换个话题聊聊别的")).status).toBe(202);
    const secondTitle = (await listPersonalCards()).find((c) => c.id === threadId)?.title;

    expect(secondTitle).toBe(firstTitle);
    expect(secondTitle).toBe(deriveThreadTitle("第一条：写周报"));
  });

  it("空线程的卡片状态是 not-started，发过消息之后不再是", async () => {
    const threadId = await newPersonalThread();

    const before = (await listPersonalCards()).find((c) => c.id === threadId);
    expect(before?.status).toBe("not-started");
    expect(before?.artifactCount).toBe(0);

    expect((await postMessage(threadId, "开始干活")).status).toBe(202);

    const after = (await listPersonalCards()).find((c) => c.id === threadId);
    expect(after?.status).not.toBe("not-started");
  });

  /**
   * 审计点名的那句话的**服务端半边**：载荷里不该再有那个自由字符串字段。
   * 契约 `.strict()` 已经会拒，这里显式钉住是为了让「有人加回去」时的失败信息可读。
   */
  it("响应里没有 agentSummary，也没有任何「N 个 agent」字样", async () => {
    const threadId = await newPersonalThread();
    const res = await fetch(`${BASE}/chat/threads`, { headers: as(ACTOR) });
    const raw = await res.text();

    expect(raw).not.toMatch(/个\s*agent/i);
    expect(raw).not.toContain("agentSummary");

    const cards = (JSON.parse(raw) as ListOut).groups.flatMap((g) => g.cards);
    const card = cards.find((c) => c.id === threadId);
    expect(card).toBeDefined();
    expect(Object.keys(card!)).not.toContain("agentSummary");
    expect(typeof card!.status).toBe("string");
    expect(typeof card!.artifactCount).toBe("number");
  });
});
