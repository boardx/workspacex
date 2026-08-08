/**
 * #662 直接后续 —— 深度研究 agent（2026-08-07，人类直接指令："去 LangChain GitHub 里面
 * 搜索 Open Deep Research 的一个 agent，导入到后台，在 chat 里面可以去引用 deep
 * research"）。
 *
 * 同 `default-agent-bootstrap-chat.test.ts` 那份证据的形状与强度：新组织 bootstrap 出来，
 * 不做任何 agent 管理操作，直接能在 chat 里选到"Deep Research"这个 agent、发消息、
 * 真实执行成功——只是这次执行侧不是一次 chat completion，是走
 * `DeepResearchModelProvider` 对着一个 stub 的 LangGraph HTTP 服务完整走一遍
 * "建线程 → 提交 run → 轮询到终态 → 读 state 取最终消息"。
 *
 * stub 服务器不是"随便返回点什么就算过"：它真实实现了 `deep-research-model-provider.ts`
 * 依赖的四个端点形状（`POST /threads`、`POST /threads/:id/runs`、
 * `GET /threads/:id/runs/:runId`、`GET /threads/:id/state`），并且要求至少轮询两次
 * 才转终态——如果测试只在"第一次查询就成功"这条路径上通过，没证明轮询循环本身是对的。
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
process.env.KERNEL_ALLOW_TEST_PRINCIPAL = "1";

const ORIGINAL_DATABASE = process.env.PGDATABASE;
const DATABASE = `wsx_i662_deep_research_${process.pid}_${Date.now()}`;
const CHAT_MODEL_PROVIDER = "wave2-loopback-i662-deep-research";
const THREAD_ID = `dr-thread-${randomUUID()}`;
const RUN_ID = `dr-run-${randomUUID()}`;
const FINAL_REPORT = "## 一句话定义\n\nLangGraph 是一个用于构建有状态、可循环的多智能体应用的图编排框架。";

let app: NestExpressApplication;
let databasePort: PgDatabase;
let base = "";
let chatModelServer: Server;
let deepResearchServer: Server;
let statusPollCount = 0;

function ownerConfig(database: string) {
  return { ...migrationConfig(), database };
}

async function adminClient(database = "postgres") {
  const client = new pg.Client(ownerConfig(database));
  await client.connect();
  return client;
}

async function startChatModelServer(): Promise<string> {
  chatModelServer = createServer((_req: IncomingMessage, res: ServerResponse) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ choices: [{ message: { role: "assistant", content: "ack" } }] }));
  });
  await new Promise<void>((resolve) => chatModelServer.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${(chatModelServer.address() as AddressInfo).port}`;
}

/** 真实实现 `deep-research-model-provider.ts` 依赖的四个端点形状，不是随便回 200。 */
async function startDeepResearchServer(): Promise<string> {
  deepResearchServer = createServer((req: IncomingMessage, res: ServerResponse) => {
    const url = req.url ?? "";
    const respond = (status: number, body: unknown) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    if (req.method === "POST" && url === "/threads") {
      return respond(200, { thread_id: THREAD_ID });
    }
    if (req.method === "POST" && url === `/threads/${THREAD_ID}/runs`) {
      return respond(200, { run_id: RUN_ID });
    }
    if (req.method === "GET" && url === `/threads/${THREAD_ID}/runs/${RUN_ID}`) {
      statusPollCount += 1;
      // 前两次仍在跑，第三次才转终态——证明轮询循环本身被真实走过，不是只测了
      // "第一次查询就成功"这一条最短路径。
      const status = statusPollCount < 3 ? "running" : "success";
      return respond(200, { status });
    }
    if (req.method === "GET" && url === `/threads/${THREAD_ID}/state`) {
      return respond(200, {
        values: {
          messages: [
            { type: "human", content: "用一句话总结：什么是 LangGraph？" },
            { type: "ai", content: FINAL_REPORT },
          ],
        },
      });
    }
    respond(404, { error: "not_found" });
  });
  await new Promise<void>((resolve) => deepResearchServer.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${(deepResearchServer.address() as AddressInfo).port}`;
}

beforeAll(async () => {
  ensureRedis();
  const chatModelBase = await startChatModelServer();
  const deepResearchBase = await startDeepResearchServer();
  process.env.KERNEL_MODEL_PROVIDER = CHAT_MODEL_PROVIDER;
  process.env.KERNEL_MODEL_BASE_URL = chatModelBase;
  process.env.KERNEL_MODEL_API_KEY = "sk-i662-deep-research-e2e-do-not-echo";
  process.env.KERNEL_DEEP_RESEARCH_BASE_URL = deepResearchBase;
  process.env.KERNEL_DEEP_RESEARCH_POLL_INTERVAL_MS = "50";
  process.env.KERNEL_DEEP_RESEARCH_TIMEOUT_MS = "10000";

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
  await new Promise<void>((resolve) => chatModelServer.close(() => resolve()));
  await new Promise<void>((resolve) => deepResearchServer.close(() => resolve()));
  const admin = await adminClient();
  try { await dropDatabaseAfterDraining(admin, DATABASE); }
  finally {
    await admin.end();
    if (ORIGINAL_DATABASE === undefined) delete process.env.PGDATABASE;
    else process.env.PGDATABASE = ORIGINAL_DATABASE;
  }
}, 30_000);

describe("#662 直接后续：新组织 bootstrap 出来就有一个能用的 Deep Research agent", () => {
  it("不做任何 agent 管理操作，直接进 chat → 选中 Deep Research → 发消息 → 真实走完轮询 → 报告写回", async () => {
    const bootstrap = await fetch(`${base}/auth/bootstrap`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: "first@i662-deep-research.test",
        password: "correct-horse-battery-staple",
        displayName: "第一个用户",
        orgName: "第一个组织",
      }),
    });
    expect(bootstrap.status, await bootstrap.clone().text()).toBe(201);
    const { userId, orgId } = (await bootstrap.json()) as { userId: string; orgId: string };
    const principal = { "x-kernel-test-principal": `${userId}:${orgId}`, "content-type": "application/json" };

    /* ── ① 能力目录里应该有三个 agent：通用助手 + Deep Research + 图片生成 ── */
    const caps = await fetch(`${base}/capabilities?orgId=${orgId}&kind=agent`, { headers: principal });
    expect(caps.status).toBe(200);
    const listing = (await caps.json()) as { id: string; name: string; enabled: boolean }[];
    expect(listing.map((a) => a.name).sort()).toEqual(["Deep Research", "图片生成", "通用助手"]);
    const deepResearchAgentId = listing.find((a) => a.name === "Deep Research")!.id;
    expect(deepResearchAgentId).toBeTruthy();

    /* ── ② 建一个个人对话线程，选中 Deep Research 发消息 ── */
    const threadRes = await fetch(`${base}/chat/threads/mutate`, {
      method: "POST",
      headers: principal,
      body: JSON.stringify({
        op: "create", projectId: null, threadId: null, groupId: null,
        title: "深度研究测试", visibilityScope: "private", expectedVersion: null, reason: null,
      }),
    });
    const { threadId } = (await threadRes.json()) as { threadId: string };

    const msgRes = await fetch(`${base}/chat/threads/${threadId}/messages`, {
      method: "POST",
      headers: principal,
      body: JSON.stringify({ clientMessageId: randomUUID(), text: "用一句话总结：什么是 LangGraph？", agentId: deepResearchAgentId }),
    });
    expect(msgRes.status, await msgRes.clone().text()).toBe(202);
    const { agentRunId } = (await msgRes.json()) as { agentRunId: string };

    /* ── ③ 驱动同一个生产执行器，真的走完"建线程→提交 run→轮询→读 state"全程 ── */
    await app.get<AgentRunExecutorPort>(AGENT_RUN_EXECUTOR).tick(toOrgId(orgId));

    const runRes = await fetch(`${base}/agent-runs/${agentRunId}`, { headers: principal });
    const run = (await runRes.json()) as { status: string };
    expect(run.status).toBe("succeeded");
    // 轮询循环真的被走过，不是第一次查询就判定终态。
    expect(statusPollCount).toBeGreaterThanOrEqual(3);

    /* ── ④ 最终报告真实写回了 chat 线程，不是一个占位符 ── */
    const messagesRes = await fetch(`${base}/chat/threads/${threadId}/messages`, { headers: principal });
    const { messages } = (await messagesRes.json()) as { messages: { authorKind: string; text: string }[] };
    const reply = messages.find((m) => m.authorKind === "agent");
    expect(reply?.text).toBe(FINAL_REPORT);
  });
});
