/**
 * Phase 18 F14 北极星端到端的共享夹具：起**完整的应用**（`createApp`，真 HTTP、真守卫、真控制器），
 * 用户看到的一切都经 HTTP 读出来；只有两处是替身，而且都是本仓认可的取证探针：
 *
 *   - 抽取模型：确定性的回环模型（F06 夹具同款），按「本条消息（用户说的）」里的关键词回固定 JSON；
 *     助手的回答一律回空——免得回答里复述的原话被当成新知识。
 *   - 对话模型：**只照着它收到的【记忆】作答**的回环模型（grounded loopback）。回答里有没有张三、
 *     客户 A，取决于执行器这一轮真的交给模型什么，而不是测试里写死的字符串；没有记忆 ⇒ 按 uc-18-2 E3
 *     回答「本会话里没有找到相关内容」。每次调用的输入都记下来，供断言「模型收到了什么」。
 *
 * 真实链路：POST /chat/threads/:id/messages（acceptHumanMessage 落库 + 排队 run）→ F06 抽取 tick
 * （真队列 / 真执行器）→ F04 AGE 投影 → executeQueuedRuns（生产同款的 PgKnowledgeRecall 注入）+
 * writeBackPendingRuns（回答落库、agent_run_id 回指）→ GET memory / sources / threads（真控制器）。
 * 执行器的 kick 在应用里关掉（KERNEL_AGENT_RUN_AUTOSTART=0），由测试显式驱动每一轮，
 * 否则应用自己的执行器会用部署配置的模型抢先执行这些 run。
 */
import type { NestExpressApplication } from "@nestjs/platform-express";
import { expect } from "vitest";
import { executeQueuedRuns, type ExecuteAgentRunDeps } from "../../src/application/agent-run/execute-run";
import { writeBackPendingRuns } from "../../src/application/agent-run/writeback";
import { AGENT_RUN_STORE, type AgentRunStore, type ModelCallInput, type ModelCallPort } from "../../src/application/agent-run/ports";
import { runExtractionTick } from "../../src/application/knowledge-graph/extract-message-knowledge";
import type { KnowledgeRecallPort } from "../../src/application/knowledge-graph/ports";
import { projectPendingGraph } from "../../src/application/knowledge-graph/project-pending-graph";
import { DATABASE_PORT, type DatabasePort } from "../../src/application/ports/database.port";
import { toOrgId } from "../../src/domain/org-id";
import { PgGraphProjection } from "../../src/infrastructure/knowledge-graph/pg-graph-projection";
import { PgKnowledgeRecall } from "../../src/infrastructure/knowledge-graph/pg-knowledge-recall";
import { asApp, asOwner, ensureDatabase, migrateOnce } from "../support/db";
import { enableExtraction, extractionDeps, silentLogger } from "./kg-extraction-fixtures";

process.env.KERNEL_ALLOW_TEST_PRINCIPAL = "1";
process.env.KERNEL_QUIET = "1";

/* ───────────── 对话里说的话（uc-18-2 V1 / uc-18-4 V1 的原句） ───────────── */

export const SAY_DECISION = "张三决定下周一上线 v2。";
export const SAY_DEMAND = "这是因为客户 A 要求 v2 下周一上线，不然就换供应商。";
export const DECISION = "张三决定下周一上线 v2";
export const DEMAND = "客户 A 要求 v2 下周一上线";
export const ASK_WHO_WHY = "上线 v2 是谁定的、为什么？";
export const ASK_DEMAND = "客户 A 有什么要求？";
export const NOTHING_FOUND = "本会话里没有找到相关内容";
/** 「20 轮后」的那 20 轮：与 v2 / 张三 / 客户 A 都没有字面关系的闲聊。 */
export const FILLER = Array.from({ length: 20 }, (_, i) => `顺便记一下第 ${i + 1} 件杂事：周报模板第 ${i + 1} 版改了字体。`);

const DECISION_REPLY = JSON.stringify({
  entities: [{ name: "张三", kind: "person", aliases: ["老张"] }, { name: "v2", kind: "product", aliases: [] }],
  claims: [{ statement: DECISION, kind: "decision", confidence: 0.9, about: ["v2"], decidedBy: "张三", quote: DECISION }],
});
const DEMAND_REPLY = JSON.stringify({
  entities: [{ name: "客户 A", kind: "organization", aliases: [] }, { name: "v2", kind: "product", aliases: [] }],
  claims: [{ statement: DEMAND, kind: "fact", confidence: 0.9, about: ["客户 A", "v2"], decidedBy: null, quote: DEMAND }],
});
export const CONTRACT = "客户 A 的合同在法务那里";
const CONTRACT_REPLY = JSON.stringify({
  entities: [{ name: "客户 A", kind: "organization", aliases: [] }],
  claims: [{ statement: CONTRACT, kind: "fact", confidence: 0.8, about: ["客户 A"], decidedBy: null, quote: CONTRACT }],
});

export const SAY_RELEASE = "v2 的发布说明由李四来写。";
export const RELEASE = "v2 的发布说明由李四来写";
const RELEASE_REPLY = JSON.stringify({
  entities: [{ name: "李四", kind: "person", aliases: [] }, { name: "v2", kind: "product", aliases: [] }],
  claims: [{ statement: RELEASE, kind: "decision", confidence: 0.9, about: ["v2"], decidedBy: "李四", quote: RELEASE }],
});

/** 抽取回环：只对用户说的话按关键词回 JSON；助手的回答、闲聊、提问一律回空。 */
export function extractionModel(): ModelCallPort {
  const replies: ReadonlyArray<readonly [string, string]> = [
    ["张三决定下周一上线", DECISION_REPLY], ["因为客户 A 要求", DEMAND_REPLY], ["合同在法务那里", CONTRACT_REPLY],
    ["发布说明由李四来写", RELEASE_REPLY],
  ];
  return {
    complete: async (input) => {
      if (!input.user.startsWith("本条消息（用户说的）")) return { text: '{"entities":[],"claims":[]}' };
      const hit = replies.find(([k]) => input.user.includes(k));
      return { text: hit === undefined ? '{"entities":[],"claims":[]}' : hit[1] };
    },
  };
}

/** 对话回环：只照着这一轮收到的【记忆】作答（见文件头）。 */
export function groundedModel() {
  const calls: ModelCallInput[] = [];
  const model: ModelCallPort = {
    complete: async (input) => {
      calls.push(input);
      const memory = memoryOf(input);
      if (memory === null) return { text: `${NOTHING_FOUND}。` };
      const facts = memory.split("\n").filter((l) => l.startsWith("- ")).map((l) => l.slice(2));
      return { text: facts.length === 0 ? `${NOTHING_FOUND}。` : `根据之前的对话：${facts.join("；")}。` };
    },
  };
  return { model, calls };
}

/** 这一轮交给模型的那段【记忆】参考材料（没有 ⇒ null）。 */
export function memoryOf(input: ModelCallInput): string | null {
  return (input.history ?? []).find((m) => m.content.startsWith("【记忆】"))?.content ?? null;
}

/* ───────────── 应用与 HTTP ───────────── */

export interface E2eApp {
  readonly app: NestExpressApplication;
  readonly base: string;
  readonly db: DatabasePort;
  readonly runs: AgentRunStore;
  /** 生产合成（kernel.module.ts）注入执行器的同一个实现。 */
  readonly recall: PgKnowledgeRecall;
}

export async function startApp(): Promise<E2eApp> {
  ensureDatabase();
  await migrateOnce();
  await enableExtraction();
  process.env.KERNEL_AGENT_RUN_AUTOSTART = "0";
  // 用户直接交办更正（2026-09-25）：`KG_EXTRACTION_ENABLED` 已从 `readKgExtractionModelConfig`
  // 的判定里彻底退休，这里不再需要（也不再有用）显式删它防泄漏。真正防的是应用自己的
  // `KgExtractionWorker` 抢在测试手动驱动的 tick 之前跑：它现在只看有没有配置模型 provider
  // （`KERNEL_MODEL_PROVIDER`），这个夹具从不设它，所以 worker 不会启动轮询——与本文件头注
  // 「执行器的 kick 在应用里关掉」同一条纪律，防线搬到了不同的变量上。
  const { createApp } = await import("../../src/main");
  const app = await createApp();
  await app.listen(0, "127.0.0.1");
  const addr = app.getHttpServer().address();
  const base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  const db = app.get<DatabasePort>(DATABASE_PORT);
  return { app, base, db, runs: app.get<AgentRunStore>(AGENT_RUN_STORE), recall: new PgKnowledgeRecall(db) };
}

export interface HttpResult<T = unknown> {
  readonly status: number;
  readonly body: T;
}

/** 以某个用户、某个组织的身份调用真 HTTP 接口。 */
export function client(e: E2eApp, userId: string, org: string) {
  const headers = { "x-kernel-test-principal": `${userId}:${org}`, "content-type": "application/json" };
  const call = async <T>(method: string, path: string, body?: unknown): Promise<HttpResult<T>> => {
    const res = await fetch(`${e.base}${path}`, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const text = await res.text();
    return { status: res.status, body: (text.length > 0 ? JSON.parse(text) : null) as T };
  };
  return {
    get: <T = unknown>(path: string) => call<T>("GET", path),
    post: <T = unknown>(path: string, body: unknown) => call<T>("POST", path, body),
  };
}
export type Client = ReturnType<typeof client>;

export async function publishAgent(org: string, agentId: string, creator: string): Promise<void> {
  const version = `${agentId}-v1`;
  await asApp(org, async (c) => {
    await c.query(`INSERT INTO agents (id,org_id,stable_name,name,status,creator_id,created_at,updated_at)
      VALUES ($1,$2,$1,$1,'enabled',$3,now(),now())`, [agentId, org, creator]);
    await c.query(`INSERT INTO agent_versions
      (id,org_id,agent_id,semantic_label,instruction_digest,instructions,skill_version_ids,
       model_provider,model_id,tool_policy,creator_id,created_at,published_at)
      VALUES ($1,$2,$3,'v1',$4,'你是团队助手。','{}'::text[],'chat','loopback','[]'::jsonb,$5,now(),now())`,
    [version, org, agentId, "d".repeat(64), creator]);
    await c.query("UPDATE agents SET published_version_id=$1 WHERE id=$2 AND org_id=$3", [version, agentId, org]);
  });
}

/* ───────────── 一轮对话 ───────────── */

export interface Turn {
  readonly questionId: string;
  readonly runId: string;
  /** 回答那条消息（chat_messages.agent_run_id = runId）。 */
  readonly answerId: string;
  readonly answer: string;
  /** 这一轮模型真正收到的输入。 */
  readonly input: ModelCallInput;
  readonly memory: string | null;
}

interface AcceptedBody {
  readonly message: { readonly id: string };
  readonly agentRunId: string;
}

let clientSeq = 0;

/** 用户发一句话（真受理接口），只落库 + 排队，不执行。 */
export async function post(api: Client, threadId: string, text: string, agentId: string): Promise<AcceptedBody> {
  clientSeq += 1;
  const clientMessageId = `00000000-0000-4000-8000-${String(clientSeq).padStart(12, "0")}`;
  const r = await api.post<AcceptedBody>(`/chat/threads/${threadId}/messages`, { clientMessageId, text, agentId });
  expect(r.status, JSON.stringify(r.body)).toBe(202);
  return r.body;
}

/**
 * 发一句话并跑完这一轮：执行器召回 → 模型 → 写回。`knowledge` 默认是生产同款的 PgKnowledgeRecall，
 * 零越权测试可以换成往图路里掺别人 id 的包装。
 */
export async function turn(
  e: E2eApp, api: Client, org: string, threadId: string, text: string, agentId: string,
  opts: { knowledge?: KnowledgeRecallPort } = {},
): Promise<Turn> {
  const accepted = await post(api, threadId, text, agentId);
  const { model, calls } = groundedModel();
  let tick = 0;
  const deps: ExecuteAgentRunDeps = {
    runs: e.runs, model, knowledge: opts.knowledge ?? e.recall,
    clock: { now: () => new Date(Date.now() + tick++).toISOString(), newStepId: () => `step-${accepted.agentRunId}-${tick}` },
    log: () => undefined,
  };
  await executeQueuedRuns(deps, { orgId: toOrgId(org) });
  await writeBackPendingRuns(deps, { orgId: toOrgId(org) });
  expect(calls, "这一轮模型必须被真的调用一次").toHaveLength(1);
  const [row] = await asOwner(async (c) => (await c.query<{ id: string; body: string; status: string }>(
    `SELECT m.id, m.body, r.status FROM chat_messages m JOIN agent_runs r ON r.id = m.agent_run_id AND r.org_id = m.org_id
      WHERE m.org_id = $1 AND m.agent_run_id = $2 AND m.author_kind = 'agent'`, [org, accepted.agentRunId])).rows);
  expect(row?.status).toBe("succeeded");
  const input = calls[0]!;
  return { questionId: accepted.message.id, runId: accepted.agentRunId, answerId: row!.id, answer: row!.body, input, memory: memoryOf(input) };
}

/** F06 抽取 worker 的 tick，跑到本组织队列排空；再跑 F04 投影 worker 的 tick。 */
export async function settleKnowledge(e: E2eApp, org: string): Promise<void> {
  const deps = extractionDeps(e.db, extractionModel(), org);
  for (let i = 0; i < 50; i += 1) {
    const r = await runExtractionTick(deps);
    expect(r.failed).toBe(0);
    if (r.processed === 0) break;
  }
  await projectGraph(e);
}

export async function projectGraph(e: E2eApp): Promise<void> {
  await projectPendingGraph(new PgGraphProjection(e.db), silentLogger);
}

/* ───────────── 读 ───────────── */

export interface RecalledMemory {
  readonly claimId: string;
  readonly statement: string;
  readonly scope: "chat_session" | "personal";
  readonly triState: string;
  readonly saidAt: string | null;
  readonly channels: readonly string[];
  readonly retrievalReasons: readonly string[];
  readonly graphPath: ReadonlyArray<{ from: string; relation: string; to: string }> | null;
}
export interface TurnMemoryBody {
  readonly recalled: readonly RecalledMemory[];
  readonly recallDegraded: boolean;
}
export interface ClaimSourcesBody {
  readonly claim: { readonly id: string; readonly statement: string; readonly scope: { kind: string; id: string }; readonly derivedFromClaimId: string | null };
  readonly evidence: ReadonlyArray<{ sourceKind: string; sourceRef: string; excerpt: string; revoked: boolean }>;
  readonly provenance: ReadonlyArray<{ action: string }>;
}
export interface ThreadKnowledgeBody {
  readonly revision: number;
  readonly claims: ReadonlyArray<{ id: string; statement: string; triState: string; scope: { kind: string; id: string } }>;
}

export const memoryPath = (threadId: string, messageId: string) => `/knowledge-graph/threads/${threadId}/messages/${messageId}/memory`;
export const sourcesPath = (claimId: string) => `/knowledge-graph/claims/${claimId}/sources`;

/** 结论 id → 它的来源抽屉里点得回去的原消息（messageId → 该消息所在会话 + 原文）。 */
export async function messageRow(org: string, messageId: string): Promise<{ thread_id: string; body: string } | undefined> {
  return (await asOwner(async (c) => (await c.query<{ thread_id: string; body: string }>(
    "SELECT thread_id, body FROM chat_messages WHERE org_id = $1 AND id = $2", [org, messageId])).rows))[0];
}
