import { AGUI_EXECUTION_EVENT_NAME } from "@repo/contracts/execution-journal";
/**
 * DA-17（UX-9 Line D2）-- AG-UI 状态轴：`write_todos` → `STATE_SNAPSHOT` over
 * `POST /copilotkit/agui`。
 *
 * 同 `agui-bridge-tool-call-events.test.ts` 的纪律：真实 HTTP POST 打真实 Nest 应用、
 * 真实 socket，驱动真实的 `DeepAgentModelProvider` 轮询路径（loopback LangGraph
 * 服务器），断言 SSE wire 上出现（或**不**出现）`@ag-ui/core` 的真实事件类型——
 * 不是隔离地断言内部回调被调了。
 *
 * 三条反证（任务卡逐字，「零 STATE_x/CUSTOM」范围见下方 DA-19a 说明）：
 *   1. run 含 write_todos → 流里出现 STATE_SNAPSHOT，且 snapshot.todos 与账本一致；
 *   2. run 无 write_todos（但有别的工具调用）→ 零业务态 STATE_x / CUSTOM 事件（不发空的）；
 *   3. toolArgsSummary 是坏 JSON（走生产上真实存在的 4000 字符截断路径，见
 *      deep-agent-model-provider 的 DA-06 注释）→ 零业务态 STATE_* 事件（解析失败不编造）。
 *
 * DA-19a（2026-08-24 补）-- `POST /copilotkit/agui` 现在每一轮都会在 RUN_STARTED 之后
 * 无条件发一个 `CUSTOM chat_thread_id` 事件（续聊事件，不是业务数据生产者，见
 * `copilotkit-agui.controller.ts`）。上面「零 STATE_x/CUSTOM」的契约因此收窄为「零
 * *业务态* STATE_x/CUSTOM 事件」——`chat_thread_id` 这一个具名例外被 `isBusinessStateEvent`
 * 显式排除，不是放宽成"CUSTOM 事件随便发"：任何其它 name 的 CUSTOM 事件仍然会让这三条
 * 反证失败。
 */
import { createHash, randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { EventType } from "@ag-ui/core";
import { AGUI_CHAT_MESSAGE_ID_EVENT_NAME, AGUI_RUN_PHASE_EVENT_NAME } from "@repo/contracts/agui-state-events";
import { DEEP_AGENT_PROVIDER_NAME } from "../../src/infrastructure/agent-run/deep-agent-model-provider";
import {
  addOrgMember, addProjectMember, asApp, ensureDatabase, migrateOnce, resetOrgs, seedOrg,
} from "../support/db";

process.env.KERNEL_ALLOW_TEST_PRINCIPAL = "1";
process.env.KERNEL_QUIET = "1";

const ORG = "org-agui-state";
const PROJECT = "proj-agui-state";
const ACTOR = "u-agui-state-actor";

const AGENT = "agent-agui-state";
const V1 = "agent-version-agui-state-v1";
const MODEL = "pinned-model-agui-state";

const FINAL_TEXT = "计划已经更新好了。";
const TODOS = [
  { content: "分析需求", status: "completed" },
  { content: "画架构图", status: "in_progress" },
  { content: "写验证", status: "pending" },
] as const;

const STATE_EVENT_TYPES = new Set<string>([
  EventType.STATE_SNAPSHOT, EventType.STATE_DELTA, EventType.CUSTOM,
]);

/**
 * DA-19a -- every real run now also mints/echoes a `CUSTOM chat_thread_id` event (see
 * `copilotkit-agui.controller.ts`'s own doc), unconditionally, regardless of whether
 * `write_todos` ran. It is not a DA-17 state/business producer -- it is session-continuation
 * plumbing -- so this file's "零 STATE_x/CUSTOM 事件" contract (task-card-literal, see file
 * head) is scoped to exclude it: the guarantee is "no business-data STATE event or CUSTOM
 * event without a real producer", not "no CUSTOM event at all on the wire".
 */
/**
 * CK-P3（issue #2054）—— 第二个同类具名例外：`CUSTOM chat_message_id`。它在 run
 * `succeeded` 后回显「这条 assistant 消息的真实 `chat_messages.id`」，与 `chat_thread_id`
 * 是同一种东西——会话/消息定位的**管道事件**，不是 DA-17 那种业务态数据。
 *
 * ⚠ 加的是**具名**例外，不是把 CUSTOM 整类放行。任何其它 name 的 CUSTOM 事件仍然
 *   会让下面三条反证红——「零业务态 STATE_x/CUSTOM」这条契约本身没有被放宽。
 *
 * 第三个同类具名例外：`CUSTOM run_phase`（准备阶段进度，见 `copilotkit-agui.controller.ts`
 * `onPhase` 与 `agui-bridge.ts` `pollAguiRunToOutcome` 头注）。同样是会话进度管道事件，
 * 不是业务态数据，且每轮出现次数不确定（`context_building`/`model_thinking` 各至多一次，
 * 取决于轮询命中的时序），因此按 name 排除而不是按位置断言。
 */
const PLUMBING_CUSTOM_EVENT_NAMES = new Set<string>([
  "chat_thread_id",
  AGUI_EXECUTION_EVENT_NAME,
  AGUI_CHAT_MESSAGE_ID_EVENT_NAME,
  AGUI_RUN_PHASE_EVENT_NAME,
]);

function isBusinessStateEvent(event: ParsedSseEvent): boolean {
  return STATE_EVENT_TYPES.has(event.type)
    && !(event.type === EventType.CUSTOM && PLUMBING_CUSTOM_EVENT_NAMES.has(typeof event.name === "string" ? event.name : ""));
}

const sha256 = (v: string): string => createHash("sha256").update(v).digest("hex");

let langgraphServer: Server;
let langgraphBase = "";
let threadId = "";
let runId = "";
/** 同 `agui-bridge-tool-call-events.test.ts`：第一次轮询只有人类消息，之后是完整终态。 */
let stateCallCount = 0;
let statusCallCount = 0;
/** 每条测试各自设定的终态消息序列（loopback 服务器返回的 `values.messages`）。 */
let finalMessages: unknown[] = [];

function respond(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

async function startLanggraphServer(): Promise<void> {
  langgraphServer = createServer((req: IncomingMessage, res: ServerResponse) => {
    const url = req.url ?? "";
    if (req.method === "POST" && url === "/threads") {
      return respond(res, 200, { thread_id: threadId });
    }
    if (req.method === "POST" && url === `/threads/${threadId}/runs`) {
      const chunks: Buffer[] = [];
      req.on("data", (c: Buffer) => chunks.push(c));
      req.on("end", () => respond(res, 200, { run_id: runId }));
      return;
    }
    if (req.method === "GET" && url === `/threads/${threadId}/runs/${runId}`) {
      const status = statusCallCount === 0 ? "running" : "success";
      statusCallCount += 1;
      return respond(res, 200, { status });
    }
    if (req.method === "GET" && url === `/threads/${threadId}/state`) {
      const messages = stateCallCount === 0
        ? [{ type: "human", content: "更新一下计划" }]
        : finalMessages;
      stateCallCount += 1;
      return respond(res, 200, { values: { messages } });
    }
    respond(res, 404, { error: "not_found" });
  });
  await new Promise<void>((resolve) => langgraphServer.listen(0, "127.0.0.1", resolve));
  const addr = langgraphServer.address() as AddressInfo;
  langgraphBase = `http://127.0.0.1:${addr.port}`;
}

/** 一条完整的工具调用轮次：human → ai(tool_calls) → tool 结果 → ai 最终答案。 */
function toolCallTurn(toolName: string, args: unknown): unknown[] {
  const callId = `call-${toolName}`;
  return [
    { type: "human", content: "更新一下计划" },
    { type: "ai", content: "", tool_calls: [{ id: callId, name: toolName, args }] },
    { type: "tool", tool_call_id: callId, content: "已更新。" },
    { type: "ai", content: FINAL_TEXT },
  ];
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
      [V1, ORG, AGENT, V1, sha256("agui state instructions"), "You are the AG-UI state-events test agent.",
        [], DEEP_AGENT_PROVIDER_NAME, MODEL, ACTOR],
    );
    await c.query("UPDATE agents SET published_version_id=$1 WHERE id=$2 AND org_id=$3", [V1, AGENT, ORG]);
  });
}

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

async function postBridgeTurn(text: string): Promise<ParsedSseEvent[]> {
  const url = new URL(`${BASE}/copilotkit/agui`);
  url.searchParams.set("agentId", AGENT);
  const response = await fetch(url, {
    method: "POST",
    headers: principal(ACTOR, ORG),
    body: JSON.stringify({
      threadId: randomUUID(), runId: randomUUID(),
      messages: [{ id: randomUUID(), role: "user", content: text }],
    }),
  });
  const raw = await response.text();
  expect(response.status, raw).toBe(200);
  return parseSse(raw);
}

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  await startLanggraphServer();
  process.env.KERNEL_DEEP_AGENT_BASE_URL = langgraphBase;
  process.env.KERNEL_DEEP_AGENT_POLL_INTERVAL_MS = "5";
  process.env.KERNEL_DEEP_AGENT_TIMEOUT_MS = "10000";
  delete process.env.KERNEL_AGENT_RUN_AUTOSTART;
  const { createApp } = await import("../../src/main");
  app = await createApp();
  await app.listen(0);
  const addr = app.getHttpServer().address();
  BASE = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
}, 180_000);

afterAll(async () => {
  await app?.close();
  await new Promise<void>((resolve) => langgraphServer.close(() => resolve()));
});

beforeEach(async () => {
  threadId = `thread-${randomUUID()}`;
  runId = `run-${randomUUID()}`;
  stateCallCount = 0;
  statusCallCount = 0;
  finalMessages = [];
  await resetOrgs(ORG);
  const fx = await seedOrg({ orgId: ORG, projectId: PROJECT });
  await addOrgMember(ORG, ACTOR, "consultant", fx.teams.energy!);
  await addProjectMember(ORG, PROJECT, ACTOR, "facilitator", null);
  await addPublishedAgentVersion();
});

describe("POST /copilotkit/agui -- DA-17 状态轴：write_todos → STATE_SNAPSHOT", () => {
  it("run 含 write_todos → 流里出现 STATE_SNAPSHOT，snapshot.todos 与账本一致，且在真实工具 TOOL_CALL_RESULT 之后", async () => {
    finalMessages = toolCallTurn("write_todos", { todos: TODOS });
    const events = await postBridgeTurn("更新一下计划");

    const snapshots = events.filter((e) => e.type === EventType.STATE_SNAPSHOT);
    expect(snapshots).toHaveLength(1);
    // snapshot 是真实账本（write_todos 的参数）逐字往下传，不是编造/改写过的。
    expect(snapshots[0]!.snapshot).toEqual({
      todos: TODOS.map((t) => ({ content: t.content, status: t.status })),
    });

    // Journal模式不再伪造STEP包络；真实TOOL_CALL_RESULT先出现，计划快照随后。
    const finishedIdx = events.findIndex((e) => e.type === EventType.TOOL_CALL_RESULT);
    const snapshotIdx = events.findIndex((e) => e.type === EventType.STATE_SNAPSHOT);
    expect(finishedIdx).toBeGreaterThanOrEqual(0);
    expect(snapshotIdx).toBeGreaterThan(finishedIdx);

    // 本轮没有 STATE_DELTA / 业务态 CUSTOM 生产者——它们不许在没有真实数据源时出现。
    // （DA-19a 的 `CUSTOM chat_thread_id` 是每轮都有的续聊事件，不在此列——见
    // `isBusinessStateEvent` 头注。）
    expect(events.filter((e) => e.type === EventType.STATE_DELTA)).toHaveLength(0);
    expect(events.filter(
      (e) => e.type === EventType.CUSTOM && !PLUMBING_CUSTOM_EVENT_NAMES.has(typeof e.name === "string" ? e.name : ""),
    )).toHaveLength(0);

    // 轮询循环真的被走过（不是第一次查询就判定终态）。
    expect(statusCallCount).toBeGreaterThanOrEqual(2);
  }, 30_000);

  it("run 无 write_todos（但有别的工具调用）→ 零 STATE_*/CUSTOM 事件，不发空快照", async () => {
    finalMessages = toolCallTurn("call_skill", { skill_stable_name: "some-skill", task: "随便" });
    const events = await postBridgeTurn("更新一下计划");

    // 工具调用序列本身照常出现（对照组是真实的，不是没跑到工具路径）。
    expect(events.some((e) => e.type === EventType.TOOL_CALL_START)).toBe(true);
    expect(events.filter(isBusinessStateEvent)).toHaveLength(0);
  }, 30_000);

  it("write_todos 的 toolArgsSummary 被 4000 字符截断成坏 JSON → 零 STATE_* 事件，解析失败不编造", async () => {
    // 单条 content 超过 4000 字符 → provider 的 write_todos 特判截断（DA-06）把
    // JSON 切残 → parseWriteTodosSnapshot 返回 null → 不发。这是生产上真实存在的
    // 坏 JSON 路径，不是测试杜撰的形状。
    finalMessages = toolCallTurn("write_todos", {
      todos: [{ content: "长".repeat(5000), status: "pending" }],
    });
    const events = await postBridgeTurn("更新一下计划");

    // 工具调用序列仍然出现（step 本身是真实且成功的，只是参数摘要不可解析）。
    expect(events.some((e) => e.type === EventType.TOOL_CALL_START)).toBe(true);
    expect(events.filter(isBusinessStateEvent)).toHaveLength(0);
    // run 正常收尾——快照缺席是「不编造」，不是 run 失败的副作用。
    expect(events.at(-1)?.type).toBe(EventType.RUN_FINISHED);
  }, 30_000);
});
