/**
 * #660 —— 用户自建的 agent 必须存在一条「发布」路径。
 *
 * ## 这份文件先是复现证据（已翻转），现在是验收证据
 *
 * 2026-08-09 实测（devapp 真实浏览器）：管理员在后台新建 agent → 它出现在 chat 的 agent
 * 下拉里 → 选中 → 发消息 → **HTTP 422**「消息无效或所选 Agent 没有可用的已发布版本」。
 *
 * 根因链（三段，本文件曾逐段断言，见 git history `c89038a5`）：
 *   ① `createAgent`（#617）落库 `agents.publish_state='草稿'` / `published_version_id=NULL`，
 *      且**不写 `agent_versions`**。**这一段依然成立且依然被断言**——`createAgent`
 *      的语义没有被改动，改动的是"之后还能做什么"。
 *   ② 发消息路径 `PgPublishedAgentReader` 要求
 *      `agents JOIN agent_versions ON a.published_version_id=v.id AND v.published_at IS NOT NULL`，
 *      查不到就 `AgentNotPublishedError` → controller 映射 422 `AGENT_NOT_FOUND`。
 *      **这一段也没有被改动**——本 feature 没有放宽任何读取条件。
 *   ③ ← **这一段被补上了**：`POST /agents/:agentId/self-publish`
 *      （契约 `selfPublishToollessAgent`，⚠⚠ **草案边，尚未经人类签核**，
 *      `KNOWN_CONTRACT_GAPS.AR11`）。它是 `草稿 → 运行中` 的一条受门控的例外边，
 *      **只对零工具零 skill 的 agent 开放**，且**不改动** `submitAgentForReview` /
 *      `decideAgentPublish`（I-28 / O-21）的任何一道门。
 *
 * ## ⚠ 反转契约（原文件头注逐字要求的三件，本次逐条兑现）
 *
 *   · 第一个 describe（「复现」）已整体反转：422 → **202**，且补了 C 反证的断言。
 *   · 第二个 describe（原「缺口：两条路由 404」）已整体删除。⚠ **删除的理由要说清**：
 *     不是因为那两条路由被接上了（它们**至今仍是 404**，双人评审路径依然零 controller），
 *     而是因为 #660 走的是**另一条**边。那两条路由的缺失是**另一个**缺口，
 *     已如实写进 issue #660 的收尾评论与 AR11，不在这里假装它被修好了。
 *   · 新增第三个 describe：**门控的反面**——有工具/有 skill 挂载的 agent 走这条边被拒。
 *     没有它，这条例外边等于"任何 agent 都能自助发布"，I-28 就被绕过了。
 *
 * ## 反证义务（不许「全绿但空转」）
 * A：② 的 JOIN 条件若被放宽（例如去掉 `published_at IS NOT NULL`），
 *    「草稿发不出消息」这条断言必须变红 —— 它锚的是真实 422，不是「抛了个错」。
 *    ⚠ 反转后这条**照旧保留**：发布**前**必须仍是 422（否则证明不了是"发布"起的作用）。
 * B：（原装置自检，随第二个 describe 一并删除）
 * C：发布之后必须断言 `agent_versions` 真多出一行且 `published_version_id` 指向它 ——
 *    只把 `publish_state` 改成 `运行中` 而不铸版本，②的 JOIN 依然查不到，依然 422。
 *    ⚠ **已实测**（2026-08-09，本分支）：把 `pg-self-publish-agent-repository.ts` 那条
 *    UPDATE 的 `published_version_id = $3` 赋值去掉（保留 `$3::text IS NOT NULL`
 *    让参数仍然绑定，否则红的是 PG 的 `could not determine data type of parameter $3`
 *    ——那种红证明不了任何事，第一次试就是这么假红的），结果：
 *      **恰好一条用例变红**，红在 `published_version_id` 那句
 *      （`expected null to be 'agent-version-…'`），其余四条照常绿。
 *    ⚠ 红点落在 DB 断言而不是发消息那一步，是因为本用例把 DB 现场断言排在发消息之前；
 *      这是刻意的：它把失败**定位到那一刀**，而不是只告诉你"最后没聊成"。
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
import { dropDatabaseAfterDraining } from "../support/drop-database";

process.env.KERNEL_QUIET = "1";
/**
 * ⚠ 见证阶段这里是 `"0"`（当时只需要证明 422）。R9 的判据逐字是「产出**恰好一条**回复」，
 * 所以验收阶段必须让 run 真的跑起来——否则断言到 202 就停，证明的是"消息被收下了"，
 * 不是"agent 回了话"。上游是本文件自己起的 deepagents stub。
 */
process.env.KERNEL_AGENT_RUN_AUTOSTART = "1";
process.env.KERNEL_ALLOW_TEST_PRINCIPAL = "1";

const ORIGINAL_DATABASE = process.env.PGDATABASE;
const DATABASE = `wsx_i660_agent_publish_${process.pid}_${Date.now()}`;
const THREAD_ID = `da-thread-i660-${randomUUID()}`;
const RUN_ID = `da-run-i660-${randomUUID()}`;
/** 用户自己写的可执行定义。刻意与 agent 的 name/role 毫无字面重叠，见下方断言。 */
const INSTRUCTIONS = "把用户说的每一件事整理成带编号的要点，最后一行给出下一步建议。";

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

  const { createApp } = await import("../../src/main");
  app = await createApp();
  databasePort = app.get(DATABASE_PORT) as PgDatabase;
  await app.listen(0);
  const address = app.getHttpServer().address();
  base = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;

  /* 一个真实注册出来的用户 + 他自己的组织（他是该组织 admin）。
     取消注册邀请码后（issue #1929），注册走 registerNewAccount（POST /auth/register-open）。 */
  const register = await fetch(`${base}/auth/register-open`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
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
      roleLabel: "自建助手",
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

interface ThreadMessage {
  readonly authorKind: string;
  readonly body?: string;
  readonly text?: string;
}

/**
 * 轮询到**至少** `atLeast` 条 agent 回复为止，然后把当时看到的全部回复原样返回。
 *
 * ⚠ 刻意返回"全部"而不是"前 N 条"：调用方要断言的是**恰好一条**，
 * 一个在内部就截断到 N 的 helper 会把"多回了一条"这个 bug 吃掉。
 * ⚠ 超时后**不抛**、照常返回已看到的（可能是 0 条），让红点落在调用方那句
 * `toHaveLength(1)` 上——那句话读起来就是判据本身。
 */
async function waitForAgentReplies(threadId: string, atLeast: number): Promise<ThreadMessage[]> {
  const deadline = Date.now() + 15_000;
  let seen: ThreadMessage[] = [];
  for (;;) {
    const res = await fetch(`${base}/chat/threads/${threadId}/messages?limit=50`, { headers: principal });
    if (res.status === 200) {
      const page = (await res.json()) as { messages?: ThreadMessage[]; items?: ThreadMessage[] };
      const all = page.messages ?? page.items ?? [];
      seen = all.filter((m) => m.authorKind === "agent");
      if (seen.length >= atLeast) return seen;
    }
    if (Date.now() >= deadline) return seen;
    await new Promise((r) => setTimeout(r, 200));
  }
}

/** #660 候选 A —— 用户自己写下这个 agent 执行什么（`PATCH /agents/:agentId`）。 */
async function setInstructions(agentId: string, instructions: string): Promise<Response> {
  return fetch(`${base}/agents/${agentId}`, {
    method: "PATCH",
    headers: principal,
    body: JSON.stringify({ agentId, patch: { instructions }, expectedVersion: "" }),
  });
}

async function selfPublish(agentId: string): Promise<Response> {
  return fetch(`${base}/agents/${agentId}/self-publish`, {
    method: "POST",
    headers: principal,
    body: JSON.stringify({ agentId }),
  });
}

describe("#660 验收：自建 agent 发布后真的能在会话里拿到回复", () => {
  it("建 agent →（发布前仍 422）→ 自助发布 → 发消息 202 → 恰好一条回复", async () => {
    const agentId = await createOwnAgent("我自己建的 agent 验收用");
    const threadId = await newThread("i660 验收对话");

    /* ⚠ A 反证保留：发布**之前**必须仍是 422。少了这一步，后面的 202 证明不了
     * 是"发布"起的作用——可能这条链路本来就通。 */
    const before = await sendTo(agentId, threadId);
    expect(before.status, await before.clone().text()).toBe(422);

    /* ⚠ 发布**之前**必须先写可执行定义。没有它 `agent_versions.instructions`（NOT NULL）
     * 拼不出来——这正是 #856 接通发布状态机之后 422 依旧的根因。
     * 先断言"没写指令就发布 = 422"，再写指令，再发布：三步都锚在真实 HTTP 上。 */
    const tooEarly = await selfPublish(agentId);
    expect(tooEarly.status, await tooEarly.clone().text()).toBe(422);

    const wrote = await setInstructions(agentId, INSTRUCTIONS);
    expect(wrote.status, await wrote.clone().text()).toBe(200);

    const published = await selfPublish(agentId);
    expect(published.status, await published.clone().text()).toBe(201);
    const body = (await published.json()) as {
      publishState: string;
      agentVersionId: string;
      publishRoute: string;
    };
    expect(body.publishState).toBe("运行中");
    expect(body.publishRoute).toBe("自助发布");

    /* C 反证：不是"把 publish_state 改成运行中"就算数——必须真铸出一行不可变版本，
     * 且 `published_version_id` 指向它。否则 `resolvePublished` 的 JOIN 查不到。 */
    const after = await databasePort.withTenant(toOrgId(orgId), async (s) => {
      const a = await s.query<{ publish_state: string; published_version_id: string | null }>(
        "SELECT publish_state, published_version_id FROM agents WHERE id=$1 AND org_id=$2",
        [agentId, orgId],
      );
      const v = await s.query<{ id: string; published_at: string | null; instructions: string }>(
        "SELECT id, published_at, instructions FROM agent_versions WHERE agent_id=$1 AND org_id=$2",
        [agentId, orgId],
      );
      return { row: a.rows[0] ?? null, versions: v.rows };
    });
    expect(after.row?.publish_state).toBe("运行中");
    expect(after.versions).toHaveLength(1);
    expect(after.row?.published_version_id).toBe(after.versions[0]?.id);
    expect(after.versions[0]?.id).toBe(body.agentVersionId);
    expect(after.versions[0]?.published_at).not.toBeNull();
    /* ⚠ 铸进版本的指令**逐字**等于用户自己写的那一段 —— 不是由 name/role 拼出来的。
     * `design-deltas/agent-instructions` 逐字禁止那条捷径（人类 2026-08-09 裁决），
     * 这条断言就是它的机械化：任何"兜底拼一段"的实现都会让它变红。 */
    expect(after.versions[0]?.instructions).toBe(INSTRUCTIONS);
    expect(after.versions[0]?.instructions).not.toContain("我自己建的助手");

    /* R9 的正题：在会话里发消息，拿到**恰好一条**回复。 */
    const sent = await sendTo(agentId, threadId);
    expect(sent.status, await sent.clone().text()).toBe(202);

    /* ⚠ 「恰好一条」是 R9 判据的逐字要求，不是"至少一条"：一次发送产出两条回复
     * （重试写了两遍、或 run 被投递两次）同样是坏的，而 `toBeGreaterThan(0)` 抓不到。 */
    const replies = await waitForAgentReplies(threadId, 1);
    expect(replies).toHaveLength(1);
    expect(replies[0]?.body ?? replies[0]?.text).toContain("已回复");

    /* 它还必须真的出现在 chat 的 agent 下拉里（capability_listings.id = agentId）——
     * 否则"用户能选中它"这件事没有兑现，R9 依然不成立。 */
    const caps = await fetch(`${base}/capabilities?orgId=${orgId}&kind=agent`, { headers: principal });
    const listing = (await caps.json()) as { id: string; name: string }[];
    expect(listing.map((a) => a.id)).toContain(agentId);
  });

  it("落库现场：发布前依然是草稿 / 零版本 / published_version_id 为 NULL（createAgent 的语义没被改动）", async () => {
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

describe("#660 门控的反面：这条例外边不得成为 I-28 / O-21 的绕过路径", () => {
  it("已自助发布的 agent 再发一次 ⇒ 422 AGENT_NOT_DRAFT（不是幂等成功，也不是铸第二个版本）", async () => {
    const agentId = await createOwnAgent("我自己建的 agent 重复发布");
    expect((await setInstructions(agentId, INSTRUCTIONS)).status).toBe(200);
    expect((await selfPublish(agentId)).status).toBe(201);

    const again = await selfPublish(agentId);
    expect(again.status, await again.clone().text()).toBe(422);

    const versionCount = await databasePort.withTenant(toOrgId(orgId), async (s) => {
      const v = await s.query<{ n: string }>(
        "SELECT count(*)::text AS n FROM agent_versions WHERE agent_id=$1 AND org_id=$2",
        [agentId, orgId],
      );
      return v.rows[0]?.n;
    });
    expect(versionCount, "重复发布不得铸出第二个版本").toBe("1");
  });

  it("有工具白名单的 agent 走这条边 ⇒ 422 AGENT_NOT_TOOLLESS，且**没有**被发布出去", async () => {
    const agentId = await createOwnAgent("我自己建的 agent 带工具");
    /* 先写指令，好让下面那个 422 **只能**是"有工具"造成的，不是"没指令"。 */
    expect((await setInstructions(agentId, INSTRUCTIONS)).status).toBe(200);
    /* ⚠ 直接写库造出"有能力面"的前态：`setToolWhitelist` 至今零实现（这正是
     * #660 收尾评论里如实上报的另一个缺口），所以这里没有产品路径可用。
     * 造前态用直写、断言用真实 HTTP —— 被验的是那道门，不是造数据的手段。 */
    await databasePort.withTenant(toOrgId(orgId), async (s) => {
      await s.query(
        `UPDATE agents SET tool_whitelist = $3::jsonb WHERE id=$1 AND org_id=$2`,
        [
          agentId,
          orgId,
          JSON.stringify([{ toolFullName: "fs.read", state: "在授权范围内", elevationDecision: null }]),
        ],
      );
    });

    const res = await selfPublish(agentId);
    expect(res.status, await res.clone().text()).toBe(422);

    const state = await databasePort.withTenant(toOrgId(orgId), async (s) => {
      const a = await s.query<{ publish_state: string; published_version_id: string | null }>(
        "SELECT publish_state, published_version_id FROM agents WHERE id=$1 AND org_id=$2",
        [agentId, orgId],
      );
      return a.rows[0];
    });
    expect(state?.publish_state, "被拒之后不得留下半发布状态").toBe("草稿");
    expect(state?.published_version_id).toBeNull();
  });

  it("没写可执行定义就发布 ⇒ 422，且**没有**被发布出去（不是「先发了再说」）", async () => {
    const agentId = await createOwnAgent("我自己建的 agent 没写指令");
    const res = await selfPublish(agentId);
    expect(res.status, await res.clone().text()).toBe(422);

    const state = await databasePort.withTenant(toOrgId(orgId), async (s) => {
      const a = await s.query<{ publish_state: string; published_version_id: string | null }>(
        "SELECT publish_state, published_version_id FROM agents WHERE id=$1 AND org_id=$2",
        [agentId, orgId],
      );
      return a.rows[0];
    });
    expect(state?.publish_state).toBe("草稿");
    expect(state?.published_version_id).toBeNull();
  });

  it("双人评审路径（submit / publish-decision）已由 #856 接线，本条边**不是**它的替代品", async () => {
    /* ⚠ 这条断言在见证阶段是「两条路由都是 404」。#856 合入后它们不再是 404 ——
     * 断言随之翻转，而不是删掉：本 feature 与 #856 是**互补**关系
     * （有能力面走双人评审、无能力面走自助），需要一条会红的东西钉住"两条都在"。 */
    const agentId = await createOwnAgent("我自己建的 agent 评审路径并存");
    const submit = await fetch(`${base}/agents/${agentId}/submit`, {
      method: "POST",
      headers: principal,
      body: JSON.stringify({ agentId }),
    });
    /* 装置自检：一条确实不存在的邻近路径仍然 404 —— 否则"不是 404"不说明任何事。 */
    const bogus = await fetch(`${base}/agents/${agentId}/definitely-not-a-real-route`, {
      method: "POST",
      headers: principal,
      body: JSON.stringify({}),
    });
    expect(bogus.status).toBe(404);
    expect(submit.status, "#856 已接线，submit 不该再是 404").not.toBe(404);
  });
});
