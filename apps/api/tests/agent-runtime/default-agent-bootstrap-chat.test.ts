/**
 * #661 —— 新用户注册完不需要自己建/发布 agent 就能直接聊。
 *
 * 人类原话（issue #661）：「彻底消灭'新建agent→(不知道怎么)发布→选中→才能发消息'这条
 * 摩擦链路，用户注册完直接能聊」。本文件是这条产品裁决唯一的真实端到端证据：走完整
 * HTTP 旅程，不预置任何 agent、不手填任何 id。
 *
 * `POST /auth/bootstrap`（第一个用户，产出真实 admin + 真实组织）
 *   → `GET /capabilities?kind=agent`（不做任何 agent 管理操作,应当已经能看到一条）
 *   → `POST /chat/threads/mutate`（op:create, projectId:null,建一个人对话线程）
 *   → `POST /chat/threads/:id/messages`（agentId 就是上一步 capability 列表返回的
 *     `row.id`——与真实前端 `personal-chat-screen.tsx` 的 `toAgentOption` 做的事一致）
 *   → 期望 202,不是 422
 *   → 驱动同一个生产执行器 `tick()`
 *   → `GET /agent-runs/:id` 断言 `succeeded`——不是"看起来能跑",是真的跑完一次。
 *
 * 独立数据库(同 `bootstrap-first-user-concurrency.test.ts` 的理由:全局测试库的
 * bootstrap 名额早被消费掉了,这件事只能在一个全新库上证明)。
 */
import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { NestExpressApplication } from "@nestjs/platform-express";
import pg from "pg";
import { migrate } from "../../src/infrastructure/db/migrator";
import { migrationConfig } from "../../src/infrastructure/db/pg-config";
import { DATABASE_PORT } from "../../src/application/ports/database.port";
import { AGENT_RUN_EXECUTOR, type AgentRunExecutorPort } from "../../src/application/agent-run/ports";
import type { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { toOrgId } from "../../src/domain/org-id";
import { ensureRedis } from "../support/auth";
import { dropDatabaseAfterDraining } from "../support/drop-database";

process.env.KERNEL_QUIET = "1";
process.env.KERNEL_AGENT_RUN_AUTOSTART = "0";
// 与 model provider 同一条纪律（读一次,不能中途换）：test-principal 解析器也是组装期
// 读 env,必须在 `createApp()` 之前就设好,不能等到某个 `it()` 里再设。
process.env.KERNEL_ALLOW_TEST_PRINCIPAL = "1";

const ORIGINAL_DATABASE = process.env.PGDATABASE;
const DATABASE = `wsx_i661_default_agent_${process.pid}_${Date.now()}`;
const MODEL_PROVIDER = "wave2-loopback-i661";

let app: NestExpressApplication;
let databasePort: PgDatabase;
let base = "";
let modelServer: Server;
let modelBase = "";
let capturedModelBodies: unknown[] = [];

function ownerConfig(database: string) {
  return { ...migrationConfig(), database };
}

async function adminClient(database = "postgres") {
  const client = new pg.Client(ownerConfig(database));
  await client.connect();
  return client;
}

async function startModelServer(): Promise<void> {
  modelServer = createServer((req: IncomingMessage, res: ServerResponse) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      try { capturedModelBodies.push(JSON.parse(Buffer.concat(chunks).toString("utf8"))); }
      catch { capturedModelBodies.push({}); }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ choices: [{ message: { role: "assistant", content: "ack" } }] }));
    });
  });
  await new Promise<void>((resolve) => modelServer.listen(0, "127.0.0.1", resolve));
  modelBase = `http://127.0.0.1:${(modelServer.address() as AddressInfo).port}`;
}

beforeAll(async () => {
  ensureRedis();
  await startModelServer();
  process.env.KERNEL_MODEL_PROVIDER = MODEL_PROVIDER;
  process.env.KERNEL_MODEL_BASE_URL = modelBase;
  process.env.KERNEL_MODEL_API_KEY = "sk-i661-e2e-do-not-echo";

  const admin = await adminClient();
  try { await admin.query(`CREATE DATABASE ${DATABASE}`); } finally { await admin.end(); }
  process.env.PGDATABASE = DATABASE;
  await migrate(ownerConfig(DATABASE));

  const { createApp } = await import("../../src/main");
  app = await createApp();
  databasePort = app.get(DATABASE_PORT) as PgDatabase;
  await app.listen(0);
  const address = app.getHttpServer().address();
  base = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
}, 180_000);

afterAll(async () => {
  await app?.close();
  await databasePort?.close();
  await new Promise<void>((resolve) => modelServer.close(() => resolve()));
  const admin = await adminClient();
  try { await dropDatabaseAfterDraining(admin, DATABASE); }
  finally {
    await admin.end();
    if (ORIGINAL_DATABASE === undefined) delete process.env.PGDATABASE;
    else process.env.PGDATABASE = ORIGINAL_DATABASE;
  }
}, 30_000);

describe("#661 新组织 bootstrap 出来就有一个真实可聊的默认 agent", () => {
  it("不做任何 agent 管理操作，直接进 chat → 能看到一个可用 agent → 发消息 → 真实执行成功", async () => {
    /* ── ① 真实 HTTP 注册出第一个用户 + 第一个组织（没有任何 agent 相关前置动作）── */
    const bootstrap = await fetch(`${base}/auth/bootstrap`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: "first@i661.test",
        password: "correct-horse-battery-staple",
        displayName: "第一个用户",
        orgName: "第一个组织",
      }),
    });
    expect(bootstrap.status).toBe(201);
    const { userId, orgId } = (await bootstrap.json()) as { userId: string; orgId: string };
    expect(userId).toBeTruthy();
    expect(orgId).toBeTruthy();

    const principal = { "x-kernel-test-principal": `${userId}:${orgId}`, "content-type": "application/json" };

    /* ── ② 不做任何 agent 管理操作,直接读能力目录——应当已经有一条 agent ── */
    const caps = await fetch(`${base}/capabilities?orgId=${orgId}&kind=agent`, { headers: principal });
    expect(caps.status).toBe(200);
    const listing = (await caps.json()) as { id: string; name: string; enabled: boolean }[];
    expect(listing).toHaveLength(1);
    expect(listing[0]!.enabled).toBe(true);
    const agentId = listing[0]!.id;

    /* ── ③ 建一个个人对话线程(前端 createPersonalThread 的真实调用形状)── */
    const threadRes = await fetch(`${base}/chat/threads/mutate`, {
      method: "POST",
      headers: principal,
      body: JSON.stringify({
        op: "create", projectId: null, threadId: null, groupId: null,
        title: "第一次对话", visibilityScope: "private", expectedVersion: null, reason: null,
      }),
    });
    expect(threadRes.status).toBe(200);
    const { threadId } = (await threadRes.json()) as { threadId: string };

    /* ── ④ 发消息给 capability 目录里选到的那个 agent(与前端 toAgentOption 同一条 id)── */
    capturedModelBodies = [];
    const msgRes = await fetch(`${base}/chat/threads/${threadId}/messages`, {
      method: "POST",
      headers: principal,
      body: JSON.stringify({ clientMessageId: randomUUID(), text: "你好,请介绍一下你自己", agentId }),
    });
    expect(msgRes.status).toBe(202);
    const { agentRunId } = (await msgRes.json()) as { agentRunId: string };
    expect(agentRunId).toBeTruthy();

    /* ── ⑤ 驱动同一个生产执行器,真的跑完一次 ── */
    await app.get<AgentRunExecutorPort>(AGENT_RUN_EXECUTOR).tick(toOrgId(orgId));

    const runRes = await fetch(`${base}/agent-runs/${agentRunId}`, { headers: principal });
    const run = (await runRes.json()) as { status: string };
    expect(run.status).toBe("succeeded");
    expect(capturedModelBodies).toHaveLength(1);
  });
});
