/**
 * #662 直接后续 —— 图片生成 agent（2026-08-07，人类直接指令："这里要可以直接看到图片，
 * 不是只是文字"——gpt-image-2 技能在没有任何图像生成工具时只能退化成"写一段 prompt 交给
 * 用户"，人类要的是真的看到图）。
 *
 * 同 `deep-research-agent-bootstrap-chat.test.ts` 那份证据的形状与强度：新组织
 * bootstrap 出来，不做任何 agent 管理操作，直接能在 chat 里选到"图片生成"这个 agent、
 * 发消息、真实执行成功——执行侧是 `BailianImageProvider` 对着一个 stub 的 DashScope
 * HTTP 服务完整走一遍"提交任务 → 轮询到终态 → 取图片 URL"，且要求至少轮询两次才转
 * 终态，证明轮询循环本身被真实走过。
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
const DATABASE = `wsx_image_gen_${process.pid}_${Date.now()}`;
const CHAT_MODEL_PROVIDER = "wave2-loopback-image-gen";
const TASK_ID = `task-${randomUUID()}`;
const IMAGE_URL = "https://dashscope-result-bj.oss-cn-beijing.aliyuncs.com/i662-image-gen-test.png";

let app: NestExpressApplication;
let databasePort: PgDatabase;
let base = "";
let chatModelServer: Server;
let bailianServer: Server;
let taskPollCount = 0;

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

/** 真实实现 `bailian-image-provider.ts` 依赖的两个端点形状（提交 + 轮询），不是随便回 200。 */
async function startBailianServer(): Promise<string> {
  bailianServer = createServer((req: IncomingMessage, res: ServerResponse) => {
    const url = req.url ?? "";
    const respond = (status: number, body: unknown) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    if (req.method === "POST" && url === "/api/v1/services/aigc/text2image/image-synthesis") {
      return respond(200, { output: { task_id: TASK_ID, task_status: "PENDING" } });
    }
    if (req.method === "GET" && url === `/api/v1/tasks/${TASK_ID}`) {
      taskPollCount += 1;
      // 前两次仍在跑，第三次才转终态——证明轮询循环本身被真实走过。
      if (taskPollCount < 3) return respond(200, { output: { task_status: "RUNNING" } });
      return respond(200, { output: { task_status: "SUCCEEDED", results: [{ url: IMAGE_URL }] } });
    }
    respond(404, { error: "not_found" });
  });
  await new Promise<void>((resolve) => bailianServer.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${(bailianServer.address() as AddressInfo).port}`;
}

beforeAll(async () => {
  ensureRedis();
  const chatModelBase = await startChatModelServer();
  const bailianBase = await startBailianServer();
  process.env.KERNEL_MODEL_PROVIDER = CHAT_MODEL_PROVIDER;
  process.env.KERNEL_MODEL_BASE_URL = chatModelBase;
  process.env.KERNEL_MODEL_API_KEY = "sk-image-gen-e2e-do-not-echo";
  process.env.KERNEL_BAILIAN_IMAGE_BASE_URL = bailianBase;
  process.env.KERNEL_BAILIAN_IMAGE_POLL_INTERVAL_MS = "50";
  process.env.KERNEL_BAILIAN_IMAGE_TIMEOUT_MS = "10000";

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
  await new Promise<void>((resolve) => bailianServer.close(() => resolve()));
  const admin = await adminClient();
  try { await dropDatabaseAfterDraining(admin, DATABASE); }
  finally {
    await admin.end();
    if (ORIGINAL_DATABASE === undefined) delete process.env.PGDATABASE;
    else process.env.PGDATABASE = ORIGINAL_DATABASE;
  }
}, 30_000);

describe("#662 直接后续：新组织 bootstrap 出来就有一个能用的图片生成 agent", () => {
  it("不做任何 agent 管理操作，直接进 chat → 选中图片生成 → 发消息 → 真实走完轮询 → markdown 图片写回", async () => {
    const bootstrap = await fetch(`${base}/auth/bootstrap`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: "first@image-gen.test",
        password: "correct-horse-battery-staple",
        displayName: "第一个用户",
        orgName: "第一个组织",
      }),
    });
    expect(bootstrap.status, await bootstrap.clone().text()).toBe(201);
    const { userId, orgId } = (await bootstrap.json()) as { userId: string; orgId: string };
    const principal = { "x-kernel-test-principal": `${userId}:${orgId}`, "content-type": "application/json" };

    /* ── 能力目录里应该有三个 agent：通用助手 + Deep Research + 图片生成 ── */
    const caps = await fetch(`${base}/capabilities?orgId=${orgId}&kind=agent`, { headers: principal });
    expect(caps.status).toBe(200);
    const listing = (await caps.json()) as { id: string; name: string; enabled: boolean }[];
    expect(listing.map((a) => a.name).sort()).toEqual(["Deep Research", "图片生成", "通用助手"]);
    const imageGenAgentId = listing.find((a) => a.name === "图片生成")!.id;
    expect(imageGenAgentId).toBeTruthy();

    /* ── 建一个个人对话线程，选中图片生成 agent 发消息，能被正常受理 ── */
    const threadRes = await fetch(`${base}/chat/threads/mutate`, {
      method: "POST",
      headers: principal,
      body: JSON.stringify({
        op: "create", projectId: null, threadId: null, groupId: null,
        title: "图片生成测试", visibilityScope: "private", expectedVersion: null, reason: null,
      }),
    });
    const { threadId } = (await threadRes.json()) as { threadId: string };

    const prompt = "画一只在敲代码的猫";
    const msgRes = await fetch(`${base}/chat/threads/${threadId}/messages`, {
      method: "POST",
      headers: principal,
      body: JSON.stringify({ clientMessageId: randomUUID(), text: prompt, agentId: imageGenAgentId }),
    });
    expect(msgRes.status, await msgRes.clone().text()).toBe(202);
    const { agentRunId } = (await msgRes.json()) as { agentRunId: string };

    /* ── 驱动同一个生产执行器，真的走完"提交任务→轮询→取图"全程 ── */
    await app.get<AgentRunExecutorPort>(AGENT_RUN_EXECUTOR).tick(toOrgId(orgId));

    const runRes = await fetch(`${base}/agent-runs/${agentRunId}`, { headers: principal });
    const run = (await runRes.json()) as { status: string };
    expect(run.status).toBe("succeeded");
    // 轮询循环真的被走过，不是第一次查询就判定终态。
    expect(taskPollCount).toBeGreaterThanOrEqual(3);

    /* ── 最终回复是 markdown 图片语法，不是纯文字 ── */
    const messagesRes = await fetch(`${base}/chat/threads/${threadId}/messages`, { headers: principal });
    const { messages } = (await messagesRes.json()) as { messages: { authorKind: string; text: string }[] };
    const reply = messages.find((m) => m.authorKind === "agent");
    expect(reply?.text).toBe(`![${prompt}](${IMAGE_URL})`);
  });
});
