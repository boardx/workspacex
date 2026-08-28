/**
 * issue #2321 round 2 -- 真实 devapp 证据：点「重试」时 `copilotkit-v2-panel.tsx`
 * 发起的是**第二次** `POST /copilotkit/agui`，此前这条轨道对每一次 HTTP 调用都用
 * `randomUUID()` 现铸 `clientMessageId`（`copilotkit-agui.controller.ts`），
 * `acceptHumanMessage` 里本来就有的 `(actorId, threadId, clientMessageId)` 幂等
 * 去重因此永远命不中——两次调用会创建两个独立的人类消息 + 两个独立的 agent run，
 * 而第一个 run（真实 skill 调用，例如 PDF 生成）可能仍在服务端跑，两边互不知情，
 * 各自真的调一次模型、各自真的生成一次文件。
 *
 * 这个文件用真实 Postgres + 真实（loopback）模型 provider 证两件事：
 * 1. 两次 POST 带**相同** `forwardedProps.clientMessageId`（模拟真实重试）→ 只有
 *    ONE 条 `agent_runs` 行、模型只被真的调了一次——不是「第二次 POST 什么都没做」
 *    （那样重试会卡死），而是「第二次 POST 命中同一个 run，对它重新发起一轮轮询」
 *    （两次响应体里的 assistant 回复字节相同，因为读的是同一个 run 的同一次
 *    writeback）。
 * 2. 不带 `clientMessageId`（未升级的旧调用方）时行为不变：两次独立 POST 各自创建
 *    一条独立的 run——这是回归防线，不是本文件的新行为。
 */
import { createHash, randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { EventType } from "@ag-ui/core";
import {
  addOrgMember, addProjectMember, asApp, ensureDatabase, migrateOnce, resetOrgs, seedOrg,
} from "../support/db";

process.env.KERNEL_ALLOW_TEST_PRINCIPAL = "1";
process.env.KERNEL_QUIET = "1";

const ORG = "org-agui-retry-dedup";
const PROJECT = "proj-agui-retry-dedup";
const ACTOR = "u-agui-retry-dedup-actor";

const PROVIDER = "agui-retry-dedup-loopback";
const AGENT = "agent-agui-retry-dedup";
const V1 = "agent-version-agui-retry-dedup-v1";
const SKILL = "skill-agui-retry-dedup";
const SV = "skill-version-agui-retry-dedup-v1";
const MODEL = "pinned-model-agui-retry-dedup";

const sha256 = (v: string): string => createHash("sha256").update(v).digest("hex");

/* ─────────────────────────── loopback provider ─────────────────────────── */

let providerServer: Server;
let providerBase = "";
let nextReplyText = "durable reply from the loopback provider";
let providerCalls = 0;

async function startProvider(): Promise<void> {
  providerServer = createServer((req: IncomingMessage, res: ServerResponse) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      providerCalls += 1;
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ choices: [{ message: { role: "assistant", content: nextReplyText } }] }));
    });
  });
  await new Promise<void>((resolve) => providerServer.listen(0, "127.0.0.1", resolve));
  const addr = providerServer.address() as AddressInfo;
  providerBase = `http://127.0.0.1:${addr.port}`;
}

/* ─────────────────────────── catalog fixtures ─────────────────────────── */

async function addSkillVersion(): Promise<void> {
  await asApp(ORG, async (c) => {
    await c.query(
      `INSERT INTO skills (id,org_id,stable_name,name,status,creator_id,created_at,updated_at)
       VALUES ($1,$2,$3,$4,'enabled',$5,now(),now()) ON CONFLICT DO NOTHING`,
      [SKILL, ORG, SKILL, SKILL, ACTOR],
    );
    await c.query(
      `INSERT INTO skill_versions
         (id,org_id,skill_id,semantic_label,content_digest,manifest,creator_id,created_at,published)
       VALUES ($1,$2,$3,$4,$5,'{}'::jsonb,$6,now(),false)`,
      [SV, ORG, SKILL, SV, sha256("# AG-UI retry dedup skill"), ACTOR],
    );
    await c.query(
      `INSERT INTO skill_version_files (org_id,version_id,path,content,media_type,digest)
       VALUES ($1,$2,'SKILL.md',$3::bytea,'text/markdown',$4)`,
      [ORG, SV, Buffer.from("# AG-UI retry dedup skill", "utf8"), sha256("# AG-UI retry dedup skill")],
    );
    await c.query("SELECT wave2_publish_skill_version($1,$2)", [ORG, SV]);
  });
}

async function addPublishedAgentVersion(): Promise<void> {
  await asApp(ORG, async (c) => {
    await c.query(
      `INSERT INTO agents (id,org_id,stable_name,name,status,creator_id,created_at,updated_at)
       VALUES ($1,$2,$3,$4,'enabled',$5,now(),now()) ON CONFLICT DO NOTHING`,
      [AGENT, ORG, AGENT, AGENT, ACTOR],
    );
    await c.query(
      `INSERT INTO agent_versions
         (id,org_id,agent_id,semantic_label,instruction_digest,instructions,skill_version_ids,
          model_provider,model_id,tool_policy,creator_id,created_at,published_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7::text[],$8,$9,'[]'::jsonb,$10,now(),now())`,
      [V1, ORG, AGENT, V1, sha256("agui retry dedup instructions"),
        "You are the AG-UI retry dedup test agent.", [SV], PROVIDER, MODEL, ACTOR],
    );
    await c.query("UPDATE agents SET published_version_id=$1 WHERE id=$2 AND org_id=$3", [V1, AGENT, ORG]);
  });
}

/* ─────────────────────────── HTTP helpers ─────────────────────────── */

let app: NestExpressApplication;
let BASE = "";

const principal = (user: string, org: string) => ({
  "x-kernel-test-principal": `${user}:${org}`,
  "content-type": "application/json",
});

interface ParsedSseEvent {
  readonly type: EventType;
  readonly [key: string]: unknown;
}

function parseSse(raw: string): ParsedSseEvent[] {
  return raw
    .split("\n\n")
    .map((chunk) => chunk.trim())
    .filter((chunk) => chunk.startsWith("data: "))
    .map((chunk) => JSON.parse(chunk.slice("data: ".length)) as ParsedSseEvent);
}

async function postBridgeTurn(input: {
  text: string; chatThreadId?: string; clientMessageId?: string;
}): Promise<{ status: number; events: ParsedSseEvent[] }> {
  const url = new URL(`${BASE}/copilotkit/agui`);
  url.searchParams.set("agentId", AGENT);
  const forwardedProps: { chatThreadId?: string; clientMessageId?: string } = {};
  if (input.chatThreadId !== undefined) forwardedProps.chatThreadId = input.chatThreadId;
  if (input.clientMessageId !== undefined) forwardedProps.clientMessageId = input.clientMessageId;
  const response = await fetch(url, {
    method: "POST",
    headers: principal(ACTOR, ORG),
    body: JSON.stringify({
      threadId: randomUUID(), runId: randomUUID(),
      messages: [{ id: randomUUID(), role: "user", content: input.text }],
      ...(Object.keys(forwardedProps).length > 0 ? { forwardedProps } : {}),
    }),
  });
  const raw = await response.text();
  return { status: response.status, events: response.status === 200 ? parseSse(raw) : [] };
}

/* ─────────────────────────── lifecycle ─────────────────────────── */

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  await startProvider();
  process.env.KERNEL_MODEL_PROVIDER = PROVIDER;
  process.env.KERNEL_MODEL_BASE_URL = providerBase;
  process.env.KERNEL_MODEL_API_KEY = "sk-agui-retry-dedup-do-not-echo";
  delete process.env.KERNEL_AGENT_RUN_AUTOSTART;
  const { createApp } = await import("../../src/main");
  app = await createApp();
  await app.listen(0);
  const addr = app.getHttpServer().address();
  BASE = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
}, 180_000);

afterAll(async () => {
  await app?.close();
  await new Promise<void>((resolve) => providerServer.close(() => resolve()));
});

afterEach(() => {
  delete process.env.KERNEL_AGENT_RUN_AUTOSTART;
});

beforeEach(async () => {
  providerCalls = 0;
  nextReplyText = "durable reply from the loopback provider";
  await resetOrgs(ORG);
  const fx = await seedOrg({ orgId: ORG, projectId: PROJECT });
  await addOrgMember(ORG, ACTOR, "consultant", fx.teams.energy!);
  await addProjectMember(ORG, PROJECT, ACTOR, "facilitator", null);
  await addSkillVersion();
  await addPublishedAgentVersion();
});

/* ═══════════════════════════ tests ═══════════════════════════ */

describe("POST /copilotkit/agui -- retry dedup via forwardedProps.clientMessageId", () => {
  it(
    "the SAME clientMessageId on a second POST (a real retry) reuses the FIRST run -- " +
    "one agent_runs row, one real model call, not a duplicate skill execution",
    async () => {
      const clientMessageId = randomUUID();

      // 第一轮不带 chatThreadId（与真实前端 turn 1 一致，`resolveThreadId` 自己建一条
      // 线程）；从 CUSTOM `chat_thread_id` 事件里把服务端真实 resolve 出来的线程 id
      // 读回来，第二轮（模拟「重试」）echo 回去——同一条线程，同一个 clientMessageId，
      // 这才是真实前端 `chatThreadIdRef` + `lastSentRef.current.clientMessageId` 的
      // 组合，不是凭空造一个不存在的线程 id。
      const first = await postBridgeTurn({ text: "生成一份 PDF", clientMessageId });
      expect(first.status).toBe(200);
      expect(first.events.map((e) => e.type)).toContain(EventType.RUN_FINISHED);
      expect(providerCalls).toBe(1);
      const threadIdEvent = first.events.find((e) => e.type === EventType.CUSTOM && e.name === "chat_thread_id");
      const chatThreadId = threadIdEvent?.value as string;
      expect(typeof chatThreadId).toBe("string");

      const second = await postBridgeTurn({ text: "生成一份 PDF", chatThreadId, clientMessageId });
      expect(second.status).toBe(200);
      expect(second.events.map((e) => e.type)).toContain(EventType.RUN_FINISHED);

      // 反证核心：第二次 POST 之后模型调用次数原地不动——没有第二次真的执行。
      expect(providerCalls).toBe(1);

      // 反证核心：数据库里只有一条 agent_runs 行，不是两条。
      const runs = await asApp(ORG, (c) => c.query<{ n: number }>(
        "SELECT count(*)::int AS n FROM agent_runs WHERE org_id=$1", [ORG],
      ));
      expect(runs.rows[0]?.n).toBe(1);

      // 反证核心：只有一条人类消息落库，不是两条重复的。
      const humanMessages = await asApp(ORG, (c) => c.query<{ n: number }>(
        "SELECT count(*)::int AS n FROM chat_messages WHERE org_id=$1 AND author_kind='human'", [ORG],
      ));
      expect(humanMessages.rows[0]?.n).toBe(1);

      // 两次响应都拿到同一次 writeback 的真实字节（不是伪造的"看起来一样"）。
      const firstContent = first.events.find((e) => e.type === EventType.TEXT_MESSAGE_CONTENT);
      const secondContent = second.events.find((e) => e.type === EventType.TEXT_MESSAGE_CONTENT);
      expect(firstContent?.delta).toBe(nextReplyText);
      expect(secondContent?.delta).toBe(nextReplyText);
    },
    30_000,
  );

  it(
    "back-compat: without clientMessageId, two POSTs stay two INDEPENDENT runs -- " +
    "this fix does not silently coalesce turns from an un-upgraded caller",
    async () => {
      const first = await postBridgeTurn({ text: "First independent turn" });
      expect(providerCalls).toBe(1);
      const threadIdEvent = first.events.find((e) => e.type === EventType.CUSTOM && e.name === "chat_thread_id");
      const chatThreadId = threadIdEvent?.value as string;
      expect(typeof chatThreadId).toBe("string");

      await postBridgeTurn({ text: "Second independent turn", chatThreadId });
      expect(providerCalls).toBe(2);

      const runs = await asApp(ORG, (c) => c.query<{ n: number }>(
        "SELECT count(*)::int AS n FROM agent_runs WHERE org_id=$1", [ORG],
      ));
      expect(runs.rows[0]?.n).toBe(2);
    },
    30_000,
  );
});
