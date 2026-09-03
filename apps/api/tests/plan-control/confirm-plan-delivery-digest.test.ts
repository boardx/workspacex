/**
 * F975 —— UC-7 `confirmPlan` + UC-12 `deliverPlanToRun`：`deliveredPlanDigest` 是
 * 「实际送进 `POST /threads/:id/runs` 请求体那段计划正文」的哈希，与账本当前 revision
 * 的序列化结果逐字一致（I-10 的可验收出口）。
 *
 * 真栈：真实 app（`createApp()`）+ 一个捕获请求体的 deep-agent 服务替身（与
 * `agui-bridge-hitl.test.ts` 同一契约），不信 `confirmPlan` 自己的返回值——独立从
 * 替身捕获的 HTTP 请求体里抠出计划正文，重新算一次哈希，断言与返回的
 * `deliveredPlanDigest` 相等。
 *
 * 权威规格：usecases.md UC-7/UC-8/UC-12 + domain.md I-10。
 */
import { createHash, randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { DEEP_AGENT_PROVIDER_NAME } from "../../src/infrastructure/agent-run/deep-agent-model-provider";
import { confirmPlan } from "../../src/application/plan-control/confirm-plan";
import { serializePlanForDelivery, planDeliveryDigest } from "../../src/application/plan-control/plan-delivery-text";
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

const ORG = "org-f975-confirm-digest";
const PROJECT = "proj-f975-confirm-digest";
const THREAD = "thread-f975-confirm-digest";
const ACTOR = "u-f975-confirm-digest";
const AGENT = "agent-f975-confirm-digest";
const AGENT_VERSION = "agent-version-f975-confirm-digest-v1";

const sha256 = (v: string): string => createHash("sha256").update(v).digest("hex");

/* ── deep-agent 服务替身：与 agui-bridge-hitl.test.ts 同一契约 ── */
interface DeepAgentFakeHandle {
  readonly port: number;
  readonly runBodies: Array<{ input?: { messages?: Array<{ role: string; content: string }> } }>;
  close(): Promise<void>;
}

async function startDeepAgentFake(): Promise<DeepAgentFakeHandle> {
  const runBodies: DeepAgentFakeHandle["runBodies"] = [];
  const threads = new Set<string>();
  const server: Server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const url = req.url ?? "";
    const json = (status: number, body: unknown): void => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    if (req.method === "POST" && url === "/threads") {
      const chunks: Buffer[] = [];
      req.on("data", (c: Buffer) => chunks.push(c));
      req.on("end", () => {
        const raw = Buffer.concat(chunks).toString("utf8");
        let requested: string | undefined;
        try {
          const parsed = raw === "" ? {} : (JSON.parse(raw) as { thread_id?: string });
          requested = typeof parsed.thread_id === "string" && parsed.thread_id !== "" ? parsed.thread_id : undefined;
        } catch { requested = undefined; }
        const threadId = requested ?? randomUUID();
        threads.add(threadId);
        json(200, { thread_id: threadId });
      });
      return;
    }
    const runsMatch = /^\/threads\/([^/]+)\/runs$/.exec(url);
    if (req.method === "POST" && runsMatch) {
      const threadId = runsMatch[1]!;
      threads.add(threadId);
      const chunks: Buffer[] = [];
      req.on("data", (c: Buffer) => chunks.push(c));
      req.on("end", () => {
        const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as DeepAgentFakeHandle["runBodies"][number];
        runBodies.push(body);
        json(200, { run_id: threadId });
      });
      return;
    }
    const statusMatch = /^\/threads\/([^/]+)\/runs\/[^/]+$/.exec(url);
    if (req.method === "GET" && statusMatch) {
      const threadId = statusMatch[1]!;
      if (!threads.has(threadId)) { json(404, { error: "unknown thread" }); return; }
      json(200, { status: "success" });
      return;
    }
    const stateMatch = /^\/threads\/([^/]+)\/state$/.exec(url);
    if (req.method === "GET" && stateMatch) {
      json(200, { values: { messages: [{ type: "ai", content: "好的，我会按计划执行。" }] } });
      return;
    }
    res.writeHead(404).end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    port: (server.address() as AddressInfo).port,
    runBodies,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
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
      [AGENT_VERSION, ORG, AGENT, AGENT_VERSION, sha256("f975 confirm digest instructions"),
        "You are the F975 confirm-plan-digest test agent.", DEEP_AGENT_PROVIDER_NAME, "deep-agent", ACTOR],
    );
    await c.query("UPDATE agents SET published_version_id=$1 WHERE id=$2 AND org_id=$3", [AGENT_VERSION, AGENT, ORG]);
  });
}

let app: NestExpressApplication;
let deepAgent: DeepAgentFakeHandle;
let planLedger: PlanLedgerRepository & PlanRunStatusReader;
let provenance: ProvenanceWriter;
let runCreator: AcceptMessagePlanRunCreator;

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  deepAgent = await startDeepAgentFake();
  process.env.KERNEL_DEEP_AGENT_BASE_URL = `http://127.0.0.1:${String(deepAgent.port)}`;
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
  await deepAgent?.close();
});

beforeEach(async () => {
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

async function waitForNewRunBody(sinceCount: number, timeoutMs = 10_000): Promise<{
  input?: { messages?: Array<{ role: string; content: string }> };
}> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (deepAgent.runBodies.length > sinceCount) return deepAgent.runBodies[deepAgent.runBodies.length - 1]!;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`no new run body captured within ${String(timeoutMs)}ms (had ${String(sinceCount)})`);
}

describe("UC-7 confirmPlan + UC-12 deliverPlanToRun：deliveredPlanDigest 与实际送达内容逐字一致", () => {
  it("确认一份多步计划：digest 与替身捕获的真实请求体里的计划正文哈希相等", async () => {
    await seedPriorRun();
    const orgId = toOrgId(ORG);
    const ingested = await ingestEnginePlanSnapshot(planLedger, {
      orgId, threadId: THREAD,
      todos: [
        { content: "调研竞品定价", status: "pending" },
        { content: "起草方案初稿", status: "pending" },
      ],
    });

    const beforeCount = deepAgent.runBodies.length;
    const out = await confirmPlan(
      { repo: planLedger, runCreator, appendAudit: (input) => provenance.append({
        orgId: input.orgId, type: "human-edited", actorId: input.actorId,
        target: { kind: "thread", id: input.threadId }, detail: input.detail,
      }) },
      { orgId, threadId: THREAD, actorId: ACTOR, basedOnRevision: ingested.revision },
    );

    expect(out.revision).toBe(ingested.revision);
    expect(out.runId).toBeTruthy();

    // 独立重新计算：不信 confirmPlan 自己声称的 digest，从账本重新序列化再算一次哈希。
    const ledger = await planLedger.getLatest(orgId, THREAD);
    const expectedText = serializePlanForDelivery(ledger!)!;
    expect(out.deliveredPlanDigest).toBe(planDeliveryDigest(expectedText));

    // 真正的断言核心（I-10）：拦截真实 POST 请求体，断言其中携带的计划正文与账本序列化
    // 结果逐字相等——不是信任 confirmPlan 的返回值，是从网络抓包里独立核实。
    const captured = await waitForNewRunBody(beforeCount);
    const systemMessage = captured.input?.messages?.find((m) => m.role === "system");
    expect(systemMessage, JSON.stringify(captured)).toBeDefined();
    expect(systemMessage!.content).toContain(expectedText);

    // 送达内容的哈希（从真实请求体里抠出这一段，独立重算）与 confirmPlan 返回的
    // deliveredPlanDigest 相等——这是「真送达」而不是「声称送达」的机械区分点。
    const deliveredSegment = systemMessage!.content.slice(systemMessage!.content.indexOf(expectedText));
    expect(planDeliveryDigest(deliveredSegment.slice(0, expectedText.length))).toBe(out.deliveredPlanDigest);
  }, 30_000);

  it("basedOnRevision 陈旧 -> PLAN_REVISION_CHANGED，不创建任何新 run（fail 前置校验先挡）", async () => {
    await seedPriorRun();
    const orgId = toOrgId(ORG);
    await ingestEnginePlanSnapshot(planLedger, {
      orgId, threadId: THREAD, todos: [{ content: "第一步", status: "pending" }, { content: "第二步", status: "pending" }],
    });
    const beforeCount = deepAgent.runBodies.length;
    await expect(confirmPlan(
      { repo: planLedger, runCreator, appendAudit: (input) => provenance.append({
        orgId: input.orgId, type: "human-edited", actorId: input.actorId,
        target: { kind: "thread", id: input.threadId }, detail: input.detail,
      }) },
      { orgId, threadId: THREAD, actorId: ACTOR, basedOnRevision: 999 },
    )).rejects.toMatchObject({ code: "PLAN_REVISION_CHANGED" });
    // 给一点时间，确认没有一个迟到的 run 悄悄冒出来。
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(deepAgent.runBodies.length).toBe(beforeCount);
  }, 30_000);
});
