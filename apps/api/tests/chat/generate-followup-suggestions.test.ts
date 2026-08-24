/**
 * `POST /chat/threads/:threadId/followup-suggestions` —— UIUX 对标 CopilotKit gap #2
 * （issue #712）：把 composer 下方的「追问建议」chip 从纯前端确定性规则换成一次真实
 * 模型推理。同 `trial-run-agent.test.ts` 的纪律：真实 HTTP loopback provider、真实
 * `ConfiguredModelProvider`，不在 `ModelCallPort` 边界注入假实现。
 *
 * 三条断言线：
 *   ① 线程正文真的进了请求体（不是套壳/固定 prompt）——两个不同线程喂不同对话内容，
 *      断言 loopback 收到的 `messages` 里带着各自线程的正文，证明「随对话内容变化」。
 *   ② 模型回复被如实解析成建议数组，不是原样回声/截断成一条。
 *   ③ 模型调用失败 ⇒ 503 `AGENT_DEPENDENCY_FAILED`，不是拿一个编造的建议顶上。
 */
import { createHash } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { chat as C } from "@repo/contracts";
import { addOrgMember, addProjectMember, asApp, ensureDatabase, migrateOnce, resetOrgs, seedOrg } from "../support/db";
import { addChatMessage, addChatThread } from "../support/chat-db";

process.env.KERNEL_ALLOW_TEST_PRINCIPAL = "1";
process.env.KERNEL_QUIET = "1";

const ORG = "org-followup-suggestions";
const PROJECT = "proj-followup-suggestions";
const AGENT = "agent-followup-suggestions";
const V1 = "agent-version-followup-suggestions-v1";
/** 根因回归：一个 modelProvider="deep-agent" 的 Agent——不是这条用例真正要调的
 * provider（见下方测试 ⑤）。刻意**不设** `KERNEL_DEEP_AGENT_BASE_URL`：若修复前的
 * 代码路径复发（把这个 Agent 快照的 modelProvider 转给 complete()），会以
 * `MODEL_PROVIDER_NOT_CONFIGURED` 503 失败，测试能抓到复发。 */
const DEEP_AGENT = "agent-followup-suggestions-deep";
const DEEP_AGENT_V1 = "agent-version-followup-suggestions-deep-v1";
const FACILITATOR = "u-followup-fac";
const OBSERVER = "u-followup-obs";

const PROVIDER = "followup-suggestions-loopback";
const API_KEY = "sk-followup-suggestions-do-not-echo";
const MODEL_ID = "followup-suggestions-model-v1";

const sha256 = (v: string): string => createHash("sha256").update(v).digest("hex");

/* ─────────────────────────── loopback provider ─────────────────────────── */

interface CapturedCall {
  readonly body: { model?: string; messages?: { role: string; content: string }[] };
}

let providerServer: Server;
let providerBase = "";
let calls: CapturedCall[] = [];
/** 每个测试按需覆盖——默认是一个合法的 JSON 数组回复。 */
let nextReplyText = '["能否再展开第二点？", "这个结论适用于哪些场景？"]';
let nextStatus = 200;

async function startProvider(): Promise<void> {
  providerServer = createServer((req: IncomingMessage, res: ServerResponse) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
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
        usage: { total_tokens: 17 },
      }));
    });
  });
  await new Promise<void>((resolve) => providerServer.listen(0, "127.0.0.1", resolve));
  const addr = providerServer.address() as AddressInfo;
  providerBase = `http://127.0.0.1:${addr.port}`;
}

/* ─────────────────────────── fixtures ─────────────────────────── */

async function publishAgent(): Promise<void> {
  await asApp(ORG, async (c) => {
    await c.query(
      `INSERT INTO agents (id,org_id,stable_name,name,status,creator_id,created_at,updated_at)
       VALUES ($1,$2,$3,$4,'enabled',$5,now(),now()) ON CONFLICT DO NOTHING`,
      [AGENT, ORG, AGENT, AGENT, FACILITATOR],
    );
    await c.query(
      `INSERT INTO agent_versions
         (id,org_id,agent_id,semantic_label,instruction_digest,instructions,skill_version_ids,
          model_provider,model_id,tool_policy,creator_id,created_at,published_at)
       VALUES ($1,$2,$3,$4,$5,$6,'{}'::text[],$7,$8,'[]'::jsonb,$9,now(),now())`,
      [V1, ORG, AGENT, V1, sha256("followup"), "You are the assistant.", PROVIDER, MODEL_ID, FACILITATOR],
    );
    await c.query("UPDATE agents SET published_version_id=$1 WHERE id=$2 AND org_id=$3", [V1, AGENT, ORG]);
  });
}

/** 根因回归夹具：一个真实发布、modelProvider="deep-agent" 的 Agent。 */
async function publishDeepAgent(): Promise<void> {
  await asApp(ORG, async (c) => {
    await c.query(
      `INSERT INTO agents (id,org_id,stable_name,name,status,creator_id,created_at,updated_at)
       VALUES ($1,$2,$3,$4,'enabled',$5,now(),now()) ON CONFLICT DO NOTHING`,
      [DEEP_AGENT, ORG, DEEP_AGENT, DEEP_AGENT, FACILITATOR],
    );
    await c.query(
      `INSERT INTO agent_versions
         (id,org_id,agent_id,semantic_label,instruction_digest,instructions,skill_version_ids,
          model_provider,model_id,tool_policy,creator_id,created_at,published_at)
       VALUES ($1,$2,$3,$4,$5,$6,'{}'::text[],$7,$8,'[]'::jsonb,$9,now(),now())`,
      [DEEP_AGENT_V1, ORG, DEEP_AGENT, DEEP_AGENT_V1, sha256("followup-deep"), "You are the deep agent.", "deep-agent", "deep-agent-loopback", FACILITATOR],
    );
    await c.query("UPDATE agents SET published_version_id=$1 WHERE id=$2 AND org_id=$3", [DEEP_AGENT_V1, DEEP_AGENT, ORG]);
  });
}

/* ─────────────────────────── HTTP helpers ─────────────────────────── */

let app: NestExpressApplication;
let BASE = "";

const as = (userId: string) => ({
  "x-kernel-test-principal": `${userId}:${ORG}`,
  "content-type": "application/json",
});

async function postFollowUp(threadId: string, agentId = AGENT, userId = FACILITATOR) {
  return fetch(`${BASE}/chat/threads/${threadId}/followup-suggestions`, {
    method: "POST",
    headers: as(userId),
    body: JSON.stringify({ threadId, agentId }),
  });
}

/* ─────────────────────────── lifecycle ─────────────────────────── */

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  await startProvider();
  process.env.KERNEL_MODEL_PROVIDER = PROVIDER;
  process.env.KERNEL_MODEL_BASE_URL = providerBase;
  process.env.KERNEL_MODEL_API_KEY = API_KEY;
  process.env.KERNEL_AGENT_RUN_AUTOSTART = "0";
  // 根因回归（见测试 ⑤）：不设，让 deep-agent provider 若被误用会诚实失败，而不是
  // 悄悄连到一个真的/别的测试留下的 deep-agent 上游。
  delete process.env.KERNEL_DEEP_AGENT_BASE_URL;
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
  calls = [];
  nextReplyText = '["能否再展开第二点？", "这个结论适用于哪些场景？"]';
  nextStatus = 200;
});

beforeEach(async () => {
  await resetOrgs(ORG);
  const fx = await seedOrg({ orgId: ORG, projectId: PROJECT });
  await addOrgMember(ORG, FACILITATOR, "consultant", fx.teams.energy!);
  await addOrgMember(ORG, OBSERVER, "consultant", fx.teams.energy!);
  await addProjectMember(ORG, PROJECT, FACILITATOR, "facilitator", null);
  await addProjectMember(ORG, PROJECT, OBSERVER, "observer", null);
  await publishAgent();
  await publishDeepAgent();
});

describe("POST /chat/threads/:threadId/followup-suggestions", () => {
  it("① 真的把线程正文送进模型调用——两条不同线程收到各自的对话内容，不是固定 prompt", async () => {
    const threadA = "followup-thread-a";
    const threadB = "followup-thread-b";
    await addChatThread({
      orgId: ORG, id: threadA, projectId: PROJECT, groupId: null,
      visibilityScope: "plenary", createdBy: FACILITATOR,
    });
    await addChatThread({
      orgId: ORG, id: threadB, projectId: PROJECT, groupId: null,
      visibilityScope: "plenary", createdBy: FACILITATOR,
    });
    await addChatMessage({
      orgId: ORG, id: "fu-a-1", threadId: threadA, authorId: FACILITATOR,
      body: "我们下季度的能耗预算怎么定？",
    });
    await addChatMessage({
      orgId: ORG, id: "fu-a-2", threadId: threadA, authorId: AGENT, authorKind: "agent", agentId: AGENT,
      body: "按去年同期用量上浮 8% 作为基线。",
    });
    await addChatMessage({
      orgId: ORG, id: "fu-b-1", threadId: threadB, authorId: FACILITATOR,
      body: "招聘计划里生产计划员的候选人有哪些？",
    });
    await addChatMessage({
      orgId: ORG, id: "fu-b-2", threadId: threadB, authorId: AGENT, authorKind: "agent", agentId: AGENT,
      body: "目前有三位候选人进入终面。",
    });

    const resA = await postFollowUp(threadA);
    const resB = await postFollowUp(threadB);
    expect(resA.status).toBe(200);
    expect(resB.status).toBe(200);

    expect(calls).toHaveLength(2);
    const userTurnsA = calls[0]!.body.messages!.filter((m) => m.role === "user").map((m) => m.content);
    const userTurnsB = calls[1]!.body.messages!.filter((m) => m.role === "user").map((m) => m.content);
    expect(userTurnsA.some((c) => c.includes("能耗预算"))).toBe(true);
    expect(userTurnsB.some((c) => c.includes("生产计划员"))).toBe(true);
    // 两次调用喂进模型的对话内容不同——建议不可能是同一份固定文案的复述。
    expect(userTurnsA).not.toEqual(userTurnsB);
  });

  it("② 模型回复被如实解析成建议数组", async () => {
    const thread = "followup-thread-parse";
    await addChatThread({
      orgId: ORG, id: thread, projectId: PROJECT, groupId: null,
      visibilityScope: "plenary", createdBy: FACILITATOR,
    });
    await addChatMessage({
      orgId: ORG, id: "fu-p-1", threadId: thread, authorId: FACILITATOR, body: "解释一下这份报告",
    });
    await addChatMessage({
      orgId: ORG, id: "fu-p-2", threadId: thread, authorId: AGENT, authorKind: "agent", agentId: AGENT,
      body: "报告分三部分：概览、风险、建议。",
    });
    nextReplyText = '这是我的建议：\n["能否展开风险那一部分？", "建议部分有没有优先级？"]';

    const res = await postFollowUp(thread);
    expect(res.status).toBe(200);
    const body = await res.json() as unknown;
    const parsed = C.operations.generateFollowUpSuggestions.out.safeParse(body);
    expect(parsed.success ? null : parsed.error.issues, JSON.stringify(body)).toBeNull();
    if (!parsed.success) throw new Error("unreachable");
    expect(parsed.data.suggestions).toEqual(["能否展开风险那一部分？", "建议部分有没有优先级？"]);
  });

  it("③ 模型调用失败 ⇒ 503 AGENT_DEPENDENCY_FAILED，不编造建议", async () => {
    const thread = "followup-thread-fail";
    await addChatThread({
      orgId: ORG, id: thread, projectId: PROJECT, groupId: null,
      visibilityScope: "plenary", createdBy: FACILITATOR,
    });
    await addChatMessage({
      orgId: ORG, id: "fu-f-1", threadId: thread, authorId: FACILITATOR, body: "随便问一句",
    });
    await addChatMessage({
      orgId: ORG, id: "fu-f-2", threadId: thread, authorId: AGENT, authorKind: "agent", agentId: AGENT,
      body: "随便答一句。",
    });
    nextStatus = 500;

    const res = await postFollowUp(thread);
    expect(res.status).toBe(503);
    const body = await res.json() as { reasonCode?: string };
    expect(body.reasonCode).toBe("AGENT_DEPENDENCY_FAILED");
  });

  it("④ 观察者对线程无权可见 ⇒ 404，不进入模型调用", async () => {
    const thread = "followup-thread-private";
    await addChatThread({
      orgId: ORG, id: thread, projectId: null, groupId: null,
      visibilityScope: "private", createdBy: FACILITATOR,
    });
    await addChatMessage({
      orgId: ORG, id: "fu-priv-1", threadId: thread, authorId: FACILITATOR, body: "私聊内容",
    });

    const res = await postFollowUp(thread, AGENT, OBSERVER);
    expect(res.status).toBe(404);
    expect(calls).toHaveLength(0);
  });

  it("⑤ 根因回归：选中的 Agent 是 deep-agent provider 时，追问建议仍走标准 provider 拿到真实建议——不因为快照 modelProvider=\"deep-agent\" 而 503/超时/回退模板", async () => {
    const thread = "followup-thread-deep-agent";
    await addChatThread({
      orgId: ORG, id: thread, projectId: PROJECT, groupId: null,
      visibilityScope: "plenary", createdBy: FACILITATOR,
    });
    await addChatMessage({
      orgId: ORG, id: "fu-deep-1", threadId: thread, authorId: FACILITATOR,
      body: "深度研究一下这个市场的竞争格局",
    });
    await addChatMessage({
      orgId: ORG, id: "fu-deep-2", threadId: thread, authorId: DEEP_AGENT, authorKind: "agent", agentId: DEEP_AGENT,
      body: "已完成初步竞对扫描，识别出三家头部玩家。",
    });

    const res = await postFollowUp(thread, DEEP_AGENT);
    // 修复前：`deps.model.complete` 会把 DEEP_AGENT 快照的 modelProvider="deep-agent"
    // 转给 RoutingModelCallPort——KERNEL_DEEP_AGENT_BASE_URL 未设（见 beforeAll），
    // DeepAgentModelProvider.startRun 以 MODEL_PROVIDER_NOT_CONFIGURED 诚实失败，
    // 这里会拿到 503。修复后：追问建议固定走 deps.followUpModel（标准 loopback），
    // 与被选中的 Agent 是不是 deep-agent 无关。
    expect(res.status).toBe(200);
    const body = await res.json() as unknown;
    const parsed = C.operations.generateFollowUpSuggestions.out.safeParse(body);
    expect(parsed.success ? null : parsed.error.issues, JSON.stringify(body)).toBeNull();
    if (!parsed.success) throw new Error("unreachable");
    // 真实建议数组，不是空/模板占位——且请求确实落在标准 loopback（唯一起了服务的上游）。
    expect(parsed.data.suggestions.length).toBeGreaterThan(0);
    expect(calls).toHaveLength(1);
    const userTurns = calls[0]!.body.messages!.filter((m) => m.role === "user").map((m) => m.content);
    expect(userTurns.some((c) => c.includes("竞争格局"))).toBe(true);
  });
});
