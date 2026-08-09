/**
 * #660 —— 用户自建的 agent 必须存在一条「发布」路径。
 *
 * ## 这份文件先是复现证据，然后才是验收证据
 *
 * 2026-08-09 实测（devapp 真实浏览器）：管理员在后台新建 agent → 它出现在 chat 的 agent
 * 下拉里 → 选中 → 发消息 → **HTTP 422**「消息无效或所选 Agent 没有可用的已发布版本」。
 *
 * 根因链（三段，缺一不可，本文件逐段断言）：
 *   ① `createAgent`（#617）落库 `agents.publish_state='草稿'` / `published_version_id=NULL`，
 *      且**不写 `agent_versions`** —— 见 `pg-create-agent-repository.ts` 头注。
 *   ② 发消息路径 `PgPublishedAgentReader` 要求
 *      `agents JOIN agent_versions ON a.published_version_id=v.id AND v.published_at IS NOT NULL`，
 *      查不到就 `AgentNotPublishedError` → controller 映射 422 `AGENT_NOT_FOUND`。
 *   ③ 契约里 `submitAgentForReview`（`POST /agents/:agentId/submit`）与
 *      `decideAgentPublish`（`POST /agents/:agentId/publish-decision`）**都已声明**，
 *      domain 里 `publish-review.ts` 的两道门也**都已实现**，但全仓**零 controller、
 *      零 application 用例、零仓储** —— 于是草稿永远是草稿。
 *
 * ## ⚠ 这是一份「缺口见证」测试，不是验收测试 —— 它现在是绿的，因为它断言的是 BUG
 *
 * 把缺口写成会跑的断言，是为了让它**不能被悄悄改掉**。当 #660 真被修好时：
 *   · 第一个 describe（「复现」）必须整体反转：422 → 202，且末尾补断言
 *     `agent_versions` 多出一行、`published_version_id` 指向它（见反证 C）。
 *   · 第二个 describe（「缺口」）必须整体删除 —— 两条路由不再是 404。
 * 任何声称修好了 #660 但没有动这个文件的 PR，都没有修好它。
 *
 * ## 反证义务（不许「全绿但空转」）
 * A：② 的 JOIN 条件若被放宽（例如去掉 `published_at IS NOT NULL`），
 *    「草稿发不出消息」这条断言必须变红 —— 它锚的是真实 422，不是「抛了个错」。
 * B：③ 的路由存在性用**邻近未知路径确实 404** 作装置自检，避免「什么都 404」蒙混过关。
 * C：发布之后必须断言 `agent_versions` 真多出一行且 `published_version_id` 指向它 ——
 *    只把 `publish_state` 改成 `运行中` 而不铸版本，②的 JOIN 依然查不到，依然 422。
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
import type { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { toOrgId } from "../../src/domain/org-id";
import { ensureRedis } from "../support/auth";
import { issueInviteCode, makeCode } from "../support/auth-db";
import { dropDatabaseAfterDraining } from "../support/drop-database";

process.env.KERNEL_QUIET = "1";
process.env.KERNEL_AGENT_RUN_AUTOSTART = "0";
process.env.KERNEL_ALLOW_TEST_PRINCIPAL = "1";

const ORIGINAL_DATABASE = process.env.PGDATABASE;
const DATABASE = `wsx_i660_agent_publish_${process.pid}_${Date.now()}`;
const THREAD_ID = `da-thread-i660-${randomUUID()}`;
const RUN_ID = `da-run-i660-${randomUUID()}`;
const CODE = makeCode("I660AGENTPUBLISH");

let app: NestExpressApplication;
let databasePort: PgDatabase;
let base = "";
let deepAgentServer: Server;

let userId = "";
let orgId = "";
let principal: Record<string, string> = {};

function ownerConfig(database: string) {
  return { ...migrationConfig(), database };
}

async function adminClient(database = "postgres") {
  const client = new pg.Client(ownerConfig(database));
  await client.connect();
  return client;
}

/** 同 `default-agent-register-path.test.ts` 的 stub —— deepagents 的四个端点。 */
async function startDeepAgentServer(): Promise<string> {
  deepAgentServer = createServer((req: IncomingMessage, res: ServerResponse) => {
    const url = req.url ?? "";
    const respond = (status: number, body: unknown) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    if (req.method === "POST" && url === "/threads") return respond(200, { thread_id: THREAD_ID });
    if (req.method === "POST" && url === `/threads/${THREAD_ID}/runs`) {
      req.resume();
      req.on("end", () => respond(200, { run_id: RUN_ID }));
      return;
    }
    if (req.method === "GET" && url === `/threads/${THREAD_ID}/runs/${RUN_ID}`) {
      return respond(200, { status: "success" });
    }
    if (req.method === "GET" && url === `/threads/${THREAD_ID}/state`) {
      return respond(200, { values: { messages: [{ type: "ai", content: "已回复" }] } });
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
  try {
    await admin.query(`CREATE DATABASE ${DATABASE}`);
  } finally {
    await admin.end();
  }
  process.env.PGDATABASE = DATABASE;
  await migrate(ownerConfig(DATABASE));
  await issueInviteCode(CODE);

  const { createApp } = await import("../../src/main");
  app = await createApp();
  databasePort = app.get(DATABASE_PORT) as PgDatabase;
  await app.listen(0);
  const address = app.getHttpServer().address();
  base = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;

  /* 一个真实注册出来的用户 + 他自己的组织（他是该组织 admin）。 */
  const register = await fetch(`${base}/auth/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      code: CODE,
      email: "founder@i660publish.test",
      password: "correct-horse-battery-staple",
      displayName: "自建 agent 的用户",
      orgName: "i660 组织",
    }),
  });
  if (register.status !== 201) throw new Error(`register failed: ${register.status} ${await register.text()}`);
  ({ userId, orgId } = (await register.json()) as { userId: string; orgId: string });
  principal = { "x-kernel-test-principal": `${userId}:${orgId}`, "content-type": "application/json" };
}, 180_000);

afterAll(async () => {
  await app?.close();
  await databasePort?.close();
  await new Promise<void>((resolve) => deepAgentServer.close(() => resolve()));
  const admin = await adminClient();
  try {
    await dropDatabaseAfterDraining(admin, DATABASE);
  } finally {
    await admin.end();
    if (ORIGINAL_DATABASE === undefined) delete process.env.PGDATABASE;
    else process.env.PGDATABASE = ORIGINAL_DATABASE;
  }
}, 30_000);

async function createOwnAgent(name: string): Promise<string> {
  const res = await fetch(`${base}/agents`, {
    method: "POST",
    headers: principal,
    body: JSON.stringify({
      name,
      initials: "ZJ",
      role: "我自己建的助手",
      visibility: "全组织可用",
      cloneFrom: null,
      source: "self",
    }),
  });
  const body = (await res.clone().json()) as { agentId: string; publishState: string };
  expect(res.status, await res.text()).toBe(201);
  /* ① 复现链第一段：新建出来恒为草稿。 */
  expect(body.publishState).toBe("草稿");
  return body.agentId;
}

async function newThread(title: string): Promise<string> {
  const res = await fetch(`${base}/chat/threads/mutate`, {
    method: "POST",
    headers: principal,
    body: JSON.stringify({
      op: "create",
      projectId: null,
      threadId: null,
      groupId: null,
      title,
      visibilityScope: "private",
      expectedVersion: null,
      reason: null,
    }),
  });
  expect(res.status, await res.clone().text()).toBe(200);
  return ((await res.json()) as { threadId: string }).threadId;
}

async function sendTo(agentId: string, threadId: string): Promise<Response> {
  return fetch(`${base}/chat/threads/${threadId}/messages`, {
    method: "POST",
    headers: principal,
    body: JSON.stringify({ clientMessageId: randomUUID(), text: "你好", agentId }),
  });
}

describe("#660 复现：自建 agent 永远是草稿，发消息 422", () => {
  it("建 agent → 直接发消息 → 422 AGENT_NOT_FOUND（不是 500，也不是静默成功）", async () => {
    const agentId = await createOwnAgent("我自己建的 agent 复现用");
    const threadId = await newThread("i660 复现对话");

    const res = await sendTo(agentId, threadId);
    /* ② 复现链第二段：这就是 devapp 上那个 422。 */
    /* ⚠ 线上响应体只有 `{"error":"unprocessable",traceId}` —— reasonCode 不过线（脱敏）。
     * 所以这里断言 422 本身，并用「同一线程同一用户换成已发布的系统 agent 就是 202」
     * 作为 A 反证：422 来自"没有已发布版本"，不是这条线程/这个用户本身不能发消息。 */
    expect(res.status, await res.clone().text()).toBe(422);

    const caps = await fetch(`${base}/capabilities?orgId=${orgId}&kind=agent`, { headers: principal });
    const listing = (await caps.json()) as { id: string; name: string }[];
    const systemAgentId = listing.find((a) => a.name === "通用助手")?.id;
    expect(systemAgentId, "系统默认 agent 必须存在，否则本反证不成立").toBeTruthy();
    const ok = await sendTo(systemAgentId!, threadId);
    expect(ok.status, await ok.clone().text()).toBe(202);
  });

  it("落库现场：agents 行在、agent_versions 零行、published_version_id 为 NULL", async () => {
    const agentId = await createOwnAgent("我自己建的 agent 落库现场");
    const { row, versionCount } = await databasePort.withTenant(toOrgId(orgId), async (s) => {
      const a = await s.query<{ publish_state: string; published_version_id: string | null }>(
        "SELECT publish_state, published_version_id FROM agents WHERE id=$1 AND org_id=$2",
        [agentId, orgId],
      );
      const v = await s.query<{ n: string }>(
        "SELECT count(*)::text AS n FROM agent_versions WHERE agent_id=$1 AND org_id=$2",
        [agentId, orgId],
      );
      return { row: a.rows[0] ?? null, versionCount: v.rows[0]?.n ?? "?" };
    });
    expect(row?.publish_state).toBe("草稿");
    expect(row?.published_version_id).toBeNull();
    expect(versionCount).toBe("0");
  });
});

describe("#660 缺口：契约声明了两条发布操作，全仓无路由可达", () => {
  it("POST /agents/:agentId/submit 与 /publish-decision 目前都到不了（装置自检：邻近未知路径确实 404）", async () => {
    const agentId = await createOwnAgent("我自己建的 agent 路由探测");

    const submit = await fetch(`${base}/agents/${agentId}/submit`, {
      method: "POST",
      headers: principal,
      body: JSON.stringify({ agentId }),
    });
    const decide = await fetch(`${base}/agents/${agentId}/publish-decision`, {
      method: "POST",
      headers: principal,
      body: JSON.stringify({ agentId, decision: "批准发布", reason: null }),
    });
    /* B：装置自检 —— 一条确实不存在的邻近路径。它 404 才说明上面两条的 404 有意义。 */
    const bogus = await fetch(`${base}/agents/${agentId}/definitely-not-a-real-route`, {
      method: "POST",
      headers: principal,
      body: JSON.stringify({}),
    });
    expect(bogus.status).toBe(404);

    // eslint-disable-next-line no-console -- 复现证据要能贴进 issue
    console.log(`[#660] submit=${submit.status} publish-decision=${decide.status} bogus=${bogus.status}`);
    expect([submit.status, decide.status]).toEqual([404, 404]);
  });
});
