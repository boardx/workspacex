/**
 * #662 直接后续 —— `/auth/register`（邀请码建组织）与 `/auth/bootstrap` 必须给出同一个
 * 承诺:新组织落地就有一个真实可聊的默认 agent。
 *
 * 为什么需要一个独立于 `default-agent-bootstrap-chat.test.ts` 的文件而不是加一个 it()：
 * `/auth/bootstrap` 是**实例级仅一次**的冷启动路径 —— 一旦本实例已有首位管理员（几乎
 * 所有真实部署,包括 devapp,从第二个组织起)，往后创建任何新组织走的**只有**
 * `/auth/register`（邀请码)这一条路。2026-08-07 devapp 上曾经真实复现:合并了
 * `/auth/bootstrap` 那一侧的修复(#665)之后,用户在 devapp 上实测新建组织仍然拿到
 * 422「所选 Agent 没有可用的已发布版本」——因为 `register()` controller 从未接上
 * `ensureDefaultAgent`。这个文件就是那次真实复现的回归证据。
 *
 * 走的旅程:`/auth/register`(带真实邀请码)→ 邮箱验证 → 登录 → 不做任何 agent 管理
 * 操作直接读 capability 目录 → 发消息 → 真实执行成功。与 #661 那份证据同一强度,只是
 * 换了创建组织的那扇门。
 *
 * ## 2026-08-08 (#740) —— stub 换成 deepagents 的 LangGraph HTTP 形状
 *
 * 同 `default-agent-bootstrap-chat.test.ts` 头注：默认 agent 的 `model_provider` 换成
 * `DeepAgentModelProvider` 之后，这份测试的 stub 也从 OpenAI 兼容 `/chat/completions`
 * 换成 `deep-agent-model-provider.ts` 依赖的四个端点（create thread / create run / poll
 * status / read state），理由同上，不重复。
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
import { issueInviteCode, makeCode } from "../support/auth-db";
import { dropDatabaseAfterDraining } from "../support/drop-database";

process.env.KERNEL_QUIET = "1";
process.env.KERNEL_AGENT_RUN_AUTOSTART = "0";
process.env.KERNEL_ALLOW_TEST_PRINCIPAL = "1";

const ORIGINAL_DATABASE = process.env.PGDATABASE;
const DATABASE = `wsx_i662_register_default_agent_${process.pid}_${Date.now()}`;
const THREAD_ID = `da-thread-i662-register-${randomUUID()}`;
const RUN_ID = `da-run-i662-register-${randomUUID()}`;
const FINAL_REPLY = "你好，我是本组织的通用助手，很高兴认识你。";
const CODE = makeCode("I662REGDEFAULT");

let app: NestExpressApplication;
let databasePort: PgDatabase;
let base = "";
let deepAgentServer: Server;
let statusPollCount = 0;
let capturedRunBodies: unknown[] = [];

function ownerConfig(database: string) {
  return { ...migrationConfig(), database };
}

async function adminClient(database = "postgres") {
  const client = new pg.Client(ownerConfig(database));
  await client.connect();
  return client;
}

/** 同 `default-agent-bootstrap-chat.test.ts` 的 stub——真实实现
 * `deep-agent-model-provider.ts` 依赖的四个端点形状。 */
async function startDeepAgentServer(): Promise<string> {
  deepAgentServer = createServer((req: IncomingMessage, res: ServerResponse) => {
    const url = req.url ?? "";
    const respond = (status: number, body: unknown) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    if (req.method === "POST" && url === "/threads") {
      return respond(200, { thread_id: THREAD_ID });
    }
    if (req.method === "POST" && url === `/threads/${THREAD_ID}/runs`) {
      const chunks: Buffer[] = [];
      req.on("data", (c: Buffer) => chunks.push(c));
      req.on("end", () => {
        try { capturedRunBodies.push(JSON.parse(Buffer.concat(chunks).toString("utf8"))); }
        catch { capturedRunBodies.push({}); }
        respond(200, { run_id: RUN_ID });
      });
      return;
    }
    if (req.method === "GET" && url === `/threads/${THREAD_ID}/runs/${RUN_ID}`) {
      statusPollCount += 1;
      const status = statusPollCount < 3 ? "running" : "success";
      return respond(200, { status });
    }
    if (req.method === "GET" && url === `/threads/${THREAD_ID}/state`) {
      return respond(200, {
        values: {
          messages: [
            { type: "human", content: "你好,请介绍一下你自己" },
            { type: "ai", content: FINAL_REPLY },
          ],
        },
      });
    }
    respond(404, { error: "not_found" });
  });
  await new Promise<void>((resolve) => deepAgentServer.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${(deepAgentServer.address() as AddressInfo).port}`;
}

beforeAll(async () => {
  ensureRedis();
  const deepAgentBase = await startDeepAgentServer();
  process.env.KERNEL_DEEP_AGENT_BASE_URL = deepAgentBase;
  process.env.KERNEL_DEEP_AGENT_POLL_INTERVAL_MS = "50";
  process.env.KERNEL_DEEP_AGENT_TIMEOUT_MS = "10000";

  const admin = await adminClient();
  try { await admin.query(`CREATE DATABASE ${DATABASE}`); } finally { await admin.end(); }
  process.env.PGDATABASE = DATABASE;
  await migrate(ownerConfig(DATABASE));
  await issueInviteCode(CODE);

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
  await new Promise<void>((resolve) => deepAgentServer.close(() => resolve()));
  const admin = await adminClient();
  try { await dropDatabaseAfterDraining(admin, DATABASE); }
  finally {
    await admin.end();
    if (ORIGINAL_DATABASE === undefined) delete process.env.PGDATABASE;
    else process.env.PGDATABASE = ORIGINAL_DATABASE;
  }
}, 30_000);

describe("#662 直接后续：/auth/register（邀请码建组织）同样给出默认 agent", () => {
  it("邀请码注册 + 邮箱验证 + 登录，不做任何 agent 管理操作，直接能聊", async () => {
    /* ── ① 真实 HTTP 邀请码注册出一个新用户 + 一个新组织 ── */
    const register = await fetch(`${base}/auth/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        code: CODE,
        email: "founder@i662register.test",
        password: "correct-horse-battery-staple",
        displayName: "邀请码建组织的第一个用户",
        orgName: "邀请码建的组织",
      }),
    });
    expect(register.status, await register.clone().text()).toBe(201);
    const { userId, orgId } = (await register.json()) as { userId: string; orgId: string };
    expect(userId).toBeTruthy();
    expect(orgId).toBeTruthy();

    const principal = { "x-kernel-test-principal": `${userId}:${orgId}`, "content-type": "application/json" };

    /* ── ② 不做任何 agent 管理操作,直接读能力目录——应当已经有"通用助手"这条 agent。
     * 2026-08-07 起还会多一条"Deep Research"，同一条产品裁决延伸出的第二个系统 agent，
     * 不断言总数，断言本用例关心的那一条真实存在且已发布。 */
    /* （邮箱验证是否已完成不影响服务端是否已经写好默认 agent——那一步紧跟在
     *  `registerWithInvite` 事务提交之后,与后续登录流程无关，见 controller 注释。） */
    const caps = await fetch(`${base}/capabilities?orgId=${orgId}&kind=agent`, { headers: principal });
    expect(caps.status).toBe(200);
    const listing = (await caps.json()) as { id: string; name: string; enabled: boolean }[];
    const defaultAgent = listing.find((a) => a.name === "通用助手");
    expect(defaultAgent).toBeDefined();
    expect(defaultAgent!.enabled).toBe(true);
    const agentId = defaultAgent!.id;

    /* ── ③ 建一个个人对话线程 ── */
    const threadRes = await fetch(`${base}/chat/threads/mutate`, {
      method: "POST",
      headers: principal,
      body: JSON.stringify({
        op: "create", projectId: null, threadId: null, groupId: null,
        title: "邀请码组织的第一次对话", visibilityScope: "private", expectedVersion: null, reason: null,
      }),
    });
    expect(threadRes.status).toBe(200);
    const { threadId } = (await threadRes.json()) as { threadId: string };

    /* ── ④ 发消息给 capability 目录里选到的那个 agent ── */
    capturedRunBodies = [];
    const msgRes = await fetch(`${base}/chat/threads/${threadId}/messages`, {
      method: "POST",
      headers: principal,
      body: JSON.stringify({ clientMessageId: randomUUID(), text: "你好,请介绍一下你自己", agentId }),
    });
    expect(msgRes.status, await msgRes.clone().text()).toBe(202);
    const { agentRunId } = (await msgRes.json()) as { agentRunId: string };
    expect(agentRunId).toBeTruthy();

    /* ── ⑤ 驱动同一个生产执行器,真的跑完一次 ── */
    await app.get<AgentRunExecutorPort>(AGENT_RUN_EXECUTOR).tick(toOrgId(orgId));

    const runRes = await fetch(`${base}/agent-runs/${agentRunId}`, { headers: principal });
    const run = (await runRes.json()) as { status: string };
    expect(run.status).toBe("succeeded");
    expect(statusPollCount).toBeGreaterThanOrEqual(3);
    expect(capturedRunBodies).toHaveLength(1);

    /* ── ⑥ 最终回复真实写回了 chat 线程 ── */
    const messagesRes = await fetch(`${base}/chat/threads/${threadId}/messages`, { headers: principal });
    const { messages } = (await messagesRes.json()) as { messages: { authorKind: string; text: string }[] };
    const reply = messages.find((m) => m.authorKind === "agent");
    expect(reply?.text).toBe(FINAL_REPLY);
  });
});
