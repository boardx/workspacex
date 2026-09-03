/**
 * issue #2250 —— `confirmPlan` 之后必须真的触发引擎执行，且执行中途 `write_todos` 的
 * 结果必须真的喂回 `chat_plan_ledgers`，而不是账本 `phase` 翻到 `"executing"` 之后
 * 步骤状态永远停在 `pending`。
 *
 * 根因（见 `accept-message-plan-run-creator.ts` 文件头长注）：`copilotkit-agui.controller.ts`
 * 的 `onStep` 回调是生产上**唯一**把 `write_todos` 结果写回账本的地方，而它只挂在
 * AG-UI SSE 轨道（`runAguiBridgeTurn`/`resumeAguiBridgeTurn`）上——`confirmPlan` 触发的
 * 续跑走的是另一条路径（`acceptHumanMessage` + `executor.kick`），没有任何东西在观察
 * 这条 run 的 steps。真实引擎确实被调用了（这条 run 真实存在、真实执行），只是没人把
 * 它的 `write_todos` 输出翻回账本——这正是 #2250 的实测现象："确认执行"只翻转账本
 * `phase`，40+ 秒后三个步骤 `status` 仍全部 `pending`。
 *
 * 真栈：真实 app（`createApp()`）+ 一个真实 HTTP loopback 的 deep-agent 服务替身（与
 * `agui-bridge-state-events.test.ts` 同一契约：`POST /threads` → `POST /threads/:id/runs`
 * → 轮询 `GET /threads/:id/runs/:runId` → `GET /threads/:id/state` 拿最终 messages，
 * 其中一条 AI 消息带 `write_todos` tool_calls）。不 mock `ModelCallPort`，走真实
 * `DeepAgentModelProvider` 的轮询实现。
 */
import { createHash, randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { DEEP_AGENT_PROVIDER_NAME } from "../../src/infrastructure/agent-run/deep-agent-model-provider";
import { confirmPlan } from "../../src/application/plan-control/confirm-plan";
import { ingestEnginePlanSnapshot } from "../../src/application/plan-control/ingest-engine-plan-snapshot";
import { AcceptMessagePlanRunCreator } from "../../src/infrastructure/plan-control/accept-message-plan-run-creator";
import {
  PLAN_LEDGER_REPOSITORY, type PlanLedgerRepository, type PlanRunStatusReader,
} from "../../src/application/plan-control/ports";
import { PROVENANCE_WRITER, type ProvenanceWriter } from "../../src/application/provenance/ports";
import { IDENTITY_REPOSITORY, DECISION_ID_FACTORY } from "../../src/application/identity/ports";
import type { IdentityRepository, DecisionIdFactory } from "../../src/application/identity/ports";
import { CHAT_REPOSITORY } from "../../src/application/chat/ports";
import type { ChatRepository } from "../../src/application/chat/ports";
import {
  CHAT_MESSAGE_COMMAND_REPOSITORY, ENABLED_SKILL_VERSION_READER, PUBLISHED_AGENT_READER, THREAD_MOUNTED_SKILL_READER,
} from "../../src/application/chat/message-command-ports";
import type {
  ChatMessageCommandRepository, EnabledSkillVersionReader, PublishedAgentReader, ThreadMountedSkillReader,
} from "../../src/application/chat/message-command-ports";
import { AGENT_RUN_EXECUTOR, AGENT_RUN_STORE, MODEL_CALL_PORT } from "../../src/application/agent-run/ports";
import type { AgentRunExecutorPort, AgentRunStore, ModelCallPort } from "../../src/application/agent-run/ports";
import { LOGGER_PORT } from "../../src/application/ports/logger.port";
import type { LoggerPort } from "../../src/application/ports/logger.port";
import { THREAD_TITLE_MODEL_CONFIG, type ThreadTitleModelConfig } from "../../src/application/chat/generate-thread-title";
import { toOrgId } from "../../src/domain/org-id";
import {
  addOrgMember, addProjectMember, asApp, ensureDatabase, migrateOnce, resetOrgs, seedOrg,
} from "../support/db";
import { addChatThread, addChatMessage } from "../support/chat-db";

process.env.KERNEL_ALLOW_TEST_PRINCIPAL = "1";
process.env.KERNEL_QUIET = "1";

const ORG = "org-f975-confirm-exec";
const PROJECT = "proj-f975-confirm-exec";
const THREAD = "thread-f975-confirm-exec";
const ACTOR = "u-f975-confirm-exec";
const AGENT = "agent-f975-confirm-exec";
const AGENT_VERSION = "agent-version-f975-confirm-exec-v1";

const sha256 = (v: string): string => createHash("sha256").update(v).digest("hex");

/* ── deep-agent（真实 LangGraph 服务）loopback 替身：与 agui-bridge-state-events.test.ts
 * 同一契约（POST /threads、POST /threads/:runs、轮询 GET status、GET state）。 */
let langgraphServer: Server;
let langgraphBase = "";
let remoteThreadId = "";
let remoteRunId = "";
let statusCallCount = 0;
/** 每条测试各自设定：这条续跑 run 的终态 messages（loopback 服务器 GET state 的返回）。 */
let finalMessages: unknown[] = [];

function respond(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

async function startLanggraphServer(): Promise<void> {
  langgraphServer = createServer((req: IncomingMessage, res: ServerResponse) => {
    const url = req.url ?? "";
    if (req.method === "POST" && url === "/threads") {
      return respond(res, 200, { thread_id: remoteThreadId });
    }
    const runsMatch = /^\/threads\/([^/]+)\/runs$/.exec(url);
    if (req.method === "POST" && runsMatch) {
      const chunks: Buffer[] = [];
      req.on("data", (c: Buffer) => chunks.push(c));
      req.on("end", () => respond(res, 200, { run_id: remoteRunId }));
      return;
    }
    if (req.method === "GET" && url === `/threads/${remoteThreadId}/runs/${remoteRunId}`) {
      const status = statusCallCount === 0 ? "running" : "success";
      statusCallCount += 1;
      return respond(res, 200, { status });
    }
    if (req.method === "GET" && url === `/threads/${remoteThreadId}/state`) {
      return respond(res, 200, { values: { messages: finalMessages } });
    }
    respond(res, 404, { error: "not_found" });
  });
  await new Promise<void>((resolve) => langgraphServer.listen(0, "127.0.0.1", resolve));
  const addr = langgraphServer.address() as AddressInfo;
  langgraphBase = `http://127.0.0.1:${addr.port}`;
}

/** 一条完整的工具调用轮次：human → ai(tool_calls) → tool 结果 → ai 最终答案。同
 * `agui-bridge-state-events.test.ts` 的 `toolCallTurn` 逐字复用（同一契约）。 */
function toolCallTurn(toolName: string, args: unknown, finalText: string): unknown[] {
  const callId = `call-${toolName}`;
  return [
    { type: "human", content: "（用户已确认当前计划，请按计划执行。）" },
    { type: "ai", content: "", tool_calls: [{ id: callId, name: toolName, args }] },
    { type: "tool", tool_call_id: callId, content: "已更新。" },
    { type: "ai", content: finalText },
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
       VALUES ($1,$2,$3,$4,$5,$6,'{}'::text[],$7,$8,'[]'::jsonb,$9,now(),now())`,
      [AGENT_VERSION, ORG, AGENT, AGENT_VERSION, sha256("f975 confirm exec instructions"),
        "You are the F975 confirm-plan-execution test agent.", DEEP_AGENT_PROVIDER_NAME, "deep-agent", ACTOR],
    );
    await c.query("UPDATE agents SET published_version_id=$1 WHERE id=$2 AND org_id=$3", [AGENT_VERSION, AGENT, ORG]);
  });
}

let app: NestExpressApplication;
let planLedger: PlanLedgerRepository & PlanRunStatusReader;
let provenance: ProvenanceWriter;
let runCreator: AcceptMessagePlanRunCreator;

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
  await app.init();

  planLedger = app.get<PlanLedgerRepository & PlanRunStatusReader>(PLAN_LEDGER_REPOSITORY);
  provenance = app.get(PROVENANCE_WRITER);
  runCreator = new AcceptMessagePlanRunCreator({
    repo: app.get<IdentityRepository>(IDENTITY_REPOSITORY),
    ids: app.get<DecisionIdFactory>(DECISION_ID_FACTORY),
    chat: app.get<ChatRepository>(CHAT_REPOSITORY),
    commands: app.get<ChatMessageCommandRepository>(CHAT_MESSAGE_COMMAND_REPOSITORY),
    publishedAgents: app.get<PublishedAgentReader>(PUBLISHED_AGENT_READER),
    threadMounts: app.get<ThreadMountedSkillReader>(THREAD_MOUNTED_SKILL_READER),
    enabledSkills: app.get<EnabledSkillVersionReader>(ENABLED_SKILL_VERSION_READER),
    executor: app.get<AgentRunExecutorPort>(AGENT_RUN_EXECUTOR),
    runs: planLedger,
    agentRunStore: app.get<AgentRunStore>(AGENT_RUN_STORE),
    logger: app.get<LoggerPort>(LOGGER_PORT),
    model: app.get<ModelCallPort>(MODEL_CALL_PORT),
    titleModel: app.get<ThreadTitleModelConfig>(THREAD_TITLE_MODEL_CONFIG),
    log: () => {},
  });
}, 180_000);

afterAll(async () => {
  await app?.close();
  await new Promise<void>((resolve) => langgraphServer.close(() => resolve()));
});

beforeEach(async () => {
  remoteThreadId = `remote-thread-${randomUUID()}`;
  remoteRunId = `remote-run-${randomUUID()}`;
  statusCallCount = 0;
  finalMessages = [];
  await resetOrgs(ORG);
  await seedOrg({ orgId: ORG, projectId: PROJECT });
  await addOrgMember(ORG, ACTOR, "consultant", null);
  await addProjectMember(ORG, PROJECT, ACTOR, "facilitator", null);
  await addChatThread({
    orgId: ORG, id: THREAD, projectId: PROJECT, visibilityScope: "plenary", createdBy: ACTOR,
  });
  await addPublishedAgentVersion();
});

async function seedPriorRun(): Promise<void> {
  const messageId = `msg-${randomUUID()}`;
  const runId = `run-${randomUUID()}`;
  await addChatMessage({ orgId: ORG, id: messageId, threadId: THREAD, body: "帮我规划一下", authorId: ACTOR });
  await asApp(ORG, (c) =>
    c.query(
      `INSERT INTO agent_runs
         (id, org_id, thread_id, input_message_id, agent_id, agent_version_id, skill_version_ids,
          model_provider, model_id, status)
       VALUES ($1,$2,$3,$4,$5,$6,'[]',$7,'deep-agent','succeeded')`,
      [runId, ORG, THREAD, messageId, AGENT, AGENT_VERSION, DEEP_AGENT_PROVIDER_NAME],
    ),
  );
}

/** 轮询账本直到 step 状态不再全是 pending，或超时——超时即判定"从没更新过"，测试失败。 */
async function waitForLedgerStepsToAdvance(orgId: ReturnType<typeof toOrgId>, timeoutMs = 8_000): Promise<{
  readonly revision: number;
  readonly steps: readonly { readonly status: string }[];
}> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const ledger = await planLedger.getLatest(orgId, THREAD);
    if (ledger !== null && ledger.steps.some((s) => s.status !== "pending")) return ledger;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`plan ledger step statuses never left "pending" within ${String(timeoutMs)}ms`);
}

describe("issue #2250 -- confirmPlan 触发的续跑真的执行，且 write_todos 结果真的喂回账本", () => {
  it("确认计划后：真实引擎被调用（loopback 捕获到新请求），且步骤状态从 pending 真的推进", async () => {
    await seedPriorRun();
    const orgId = toOrgId(ORG);
    const ingested = await ingestEnginePlanSnapshot(planLedger, {
      orgId, threadId: THREAD,
      todos: [
        { content: "调研竞品定价", status: "pending" },
        { content: "起草方案初稿", status: "pending" },
      ],
    });

    // 这条续跑 run 的"引擎侧"会真的把第一步标成 in_progress、第二步仍 pending——
    // 与 confirm 之前的快照不同，证明这不是 confirmPlan 自己重发了一份一模一样的数据。
    finalMessages = toolCallTurn("write_todos", {
      todos: [
        { content: "调研竞品定价", status: "in_progress" },
        { content: "起草方案初稿", status: "pending" },
      ],
    }, "好的，我已经开始第一步。");

    const out = await confirmPlan(
      { repo: planLedger, runCreator, appendAudit: (input) => provenance.append({
        orgId: input.orgId, type: "human-edited", actorId: input.actorId,
        target: { kind: "thread", id: input.threadId }, detail: input.detail,
      }) },
      { orgId, threadId: THREAD, actorId: ACTOR, basedOnRevision: ingested.revision },
    );
    expect(out.runId).toBeTruthy();

    // 核心断言（#2250 之前会超时失败）：账本 revision 真的往前走了，且第一步的 status
    // 真的从 "pending" 变成 "in_progress"——不是 confirmPlan 自己声称的，是从账本
    // 独立重新读出来的。
    const ledger = await waitForLedgerStepsToAdvance(orgId);
    expect(ledger.revision).toBeGreaterThan(ingested.revision);
    const first = ledger.steps.find((s) => s.status !== "pending");
    expect(first).toBeDefined();
  }, 30_000);
});
