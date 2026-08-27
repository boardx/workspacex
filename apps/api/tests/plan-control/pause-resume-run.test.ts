/**
 * F976 —— UC-9 `pausePlanRun`（可恢复的中止）+ UC-13 `resumePlanRun`（暂停的另一半）。
 *
 * 真栈：真实 app + 一个同时实现 `/runs`（创建）与 `/runs/:id/cancel`（暂停）的
 * deep-agent 服务替身，与 `agui-bridge-hitl.test.ts` / `confirm-plan-delivery-digest.test.ts`
 * 同一契约。
 *
 * 权威规格：usecases.md UC-9/UC-13 + domain.md I-12。
 */
import { createHash, randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { DEEP_AGENT_PROVIDER_NAME, deriveRemoteThreadId } from "../../src/infrastructure/agent-run/deep-agent-model-provider";
import { pausePlanRun } from "../../src/application/plan-control/pause-plan-run";
import { resumePlanRun } from "../../src/application/plan-control/resume-plan-run";
import { DeepAgentEngineRunController } from "../../src/infrastructure/plan-control/deep-agent-engine-run-controller";
import { AcceptMessagePlanRunCreator } from "../../src/infrastructure/plan-control/accept-message-plan-run-creator";
import { PLAN_LEDGER_REPOSITORY, type PlanLedgerRepository, type PlanRunStatusReader } from "../../src/application/plan-control/ports";
import { PROVENANCE_WRITER, type ProvenanceWriter } from "../../src/application/provenance/ports";
import { IDENTITY_REPOSITORY, DECISION_ID_FACTORY } from "../../src/application/identity/ports";
import type { IdentityRepository, DecisionIdFactory } from "../../src/application/identity/ports";
import { CHAT_REPOSITORY } from "../../src/application/chat/ports";
import type { ChatRepository } from "../../src/application/chat/ports";
import {
  CHAT_MESSAGE_COMMAND_REPOSITORY, PUBLISHED_AGENT_READER, THREAD_MOUNTED_SKILL_READER,
} from "../../src/application/chat/message-command-ports";
import type {
  ChatMessageCommandRepository, PublishedAgentReader, ThreadMountedSkillReader,
} from "../../src/application/chat/message-command-ports";
import { AGENT_RUN_EXECUTOR } from "../../src/application/agent-run/ports";
import type { AgentRunExecutorPort } from "../../src/application/agent-run/ports";
import { MODEL_CALL_PORT } from "../../src/application/agent-run/ports";
import type { ModelCallPort } from "../../src/application/agent-run/ports";
import { THREAD_TITLE_MODEL_CONFIG, type ThreadTitleModelConfig } from "../../src/application/chat/generate-thread-title";
import { toOrgId } from "../../src/domain/org-id";
import {
  addOrgMember, addProjectMember, asApp, ensureDatabase, migrateOnce, resetOrgs, seedOrg,
} from "../support/db";
import { addChatThread, addChatMessage } from "../support/chat-db";

process.env.KERNEL_ALLOW_TEST_PRINCIPAL = "1";
process.env.KERNEL_QUIET = "1";

const ORG = "org-f976-pause-resume";
const PROJECT = "proj-f976-pause-resume";
const THREAD = "thread-f976-pause-resume";
const ACTOR = "u-f976-pause-resume";
const AGENT = "agent-f976-pause-resume";
const AGENT_VERSION = "agent-version-f976-pause-resume-v1";

const sha256 = (v: string): string => createHash("sha256").update(v).digest("hex");

interface DeepAgentFakeHandle {
  readonly port: number;
  readonly runBodies: unknown[];
  readonly cancelCalls: Array<{ threadId: string; runId: string; action: string | null }>;
  close(): Promise<void>;
}

async function startDeepAgentFake(): Promise<DeepAgentFakeHandle> {
  const runBodies: unknown[] = [];
  const cancelCalls: DeepAgentFakeHandle["cancelCalls"] = [];
  const threads = new Set<string>();
  const server: Server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? "", "http://localhost");
    const path = url.pathname;
    const json = (status: number, body: unknown): void => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    if (req.method === "POST" && path === "/threads") {
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
    const cancelMatch = /^\/threads\/([^/]+)\/runs\/([^/]+)\/cancel$/.exec(path);
    if (req.method === "POST" && cancelMatch) {
      cancelCalls.push({
        threadId: cancelMatch[1]!, runId: cancelMatch[2]!, action: url.searchParams.get("action"),
      });
      json(200, { ok: true });
      return;
    }
    const runsMatch = /^\/threads\/([^/]+)\/runs$/.exec(path);
    if (req.method === "POST" && runsMatch) {
      const threadId = runsMatch[1]!;
      threads.add(threadId);
      const chunks: Buffer[] = [];
      req.on("data", (c: Buffer) => chunks.push(c));
      req.on("end", () => {
        const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
        runBodies.push(body);
        json(200, { run_id: threadId });
      });
      return;
    }
    const statusMatch = /^\/threads\/([^/]+)\/runs\/[^/]+$/.exec(path);
    if (req.method === "GET" && statusMatch) {
      json(200, { status: "success" });
      return;
    }
    const stateMatch = /^\/threads\/([^/]+)\/state$/.exec(path);
    if (req.method === "GET" && stateMatch) {
      json(200, { values: { messages: [{ type: "ai", content: "好的。" }] } });
      return;
    }
    res.writeHead(404).end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    port: (server.address() as AddressInfo).port,
    runBodies, cancelCalls,
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
      [AGENT_VERSION, ORG, AGENT, AGENT_VERSION, sha256("f976 pause resume instructions"),
        "You are the F976 pause/resume test agent.", DEEP_AGENT_PROVIDER_NAME, "deep-agent", ACTOR],
    );
    await c.query("UPDATE agents SET published_version_id=$1 WHERE id=$2 AND org_id=$3", [AGENT_VERSION, AGENT, ORG]);
  });
}

let app: NestExpressApplication;
let deepAgent: DeepAgentFakeHandle;
let planLedger: PlanLedgerRepository & PlanRunStatusReader;
let provenance: ProvenanceWriter;
let engine: DeepAgentEngineRunController;
let runCreator: AcceptMessagePlanRunCreator;

/** 同 confirm-plan-delivery-digest.test.ts 的既有先例：轮询而非固定 sleep，避免
 *  machine 负载高时 executor.kick() 这个 fire-and-forget 还没到达就先断言。 */
async function waitForNewRunBody(sinceCount: number, timeoutMs = 10_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (deepAgent.runBodies.length > sinceCount) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`no new run body captured within ${String(timeoutMs)}ms (had ${String(sinceCount)})`);
}

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
  provenance = app.get<ProvenanceWriter>(PROVENANCE_WRITER);
  engine = new DeepAgentEngineRunController();
  runCreator = new AcceptMessagePlanRunCreator({
    repo: app.get<IdentityRepository>(IDENTITY_REPOSITORY),
    ids: app.get<DecisionIdFactory>(DECISION_ID_FACTORY),
    chat: app.get<ChatRepository>(CHAT_REPOSITORY),
    commands: app.get<ChatMessageCommandRepository>(CHAT_MESSAGE_COMMAND_REPOSITORY),
    publishedAgents: app.get<PublishedAgentReader>(PUBLISHED_AGENT_READER),
    threadMounts: app.get<ThreadMountedSkillReader>(THREAD_MOUNTED_SKILL_READER),
    executor: app.get<AgentRunExecutorPort>(AGENT_RUN_EXECUTOR),
    runs: planLedger,
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

async function seedRun(status: string, opts: { remoteRunId?: string | null } = {}): Promise<string> {
  const runId = `run-${randomUUID()}`;
  const messageId = `msg-${randomUUID()}`;
  await addChatMessage({ orgId: ORG, id: messageId, threadId: THREAD, body: "帮我做一件事", authorId: ACTOR });
  await asApp(ORG, (c) =>
    c.query(
      `INSERT INTO agent_runs
         (id, org_id, thread_id, input_message_id, agent_id, agent_version_id, skill_version_ids,
          model_provider, model_id, status, remote_run_id, error_code)
       VALUES ($1,$2,$3,$4,$5,$6,'[]',$7,'deep-agent',$8,$9,$10)`,
      [
        runId, ORG, THREAD, messageId, AGENT, AGENT_VERSION, DEEP_AGENT_PROVIDER_NAME, status,
        opts.remoteRunId === undefined ? `remote-${runId}` : opts.remoteRunId,
        status === "failed" ? "MODEL_CALL_FAILED" : null,
      ],
    ),
  );
  return runId;
}

describe("UC-9 pausePlanRun", () => {
  it("有活跃 run（status=running，remote_run_id 已记账）：真实调用 cancel(action=interrupt)，run 打上 pausedAt", async () => {
    const runId = await seedRun("running");
    const out = await pausePlanRun(
      { runs: planLedger, engine, provenance },
      { orgId: toOrgId(ORG), threadId: THREAD, actorId: ACTOR },
    );
    expect(out.runId).toBe(runId);
    expect(out.pausedAtStepId).toBeNull();
    expect(out.auditEventId).toBeTruthy();

    // 独立核实：真实替身确实收到了 cancel 请求，且 action=interrupt（domain.md I-12
    // 的证据链：不是 rollback，是保留已完成步骤的 interrupt）。
    expect(deepAgent.cancelCalls).toHaveLength(1);
    expect(deepAgent.cancelCalls[0]!.action).toBe("interrupt");
    expect(deepAgent.cancelCalls[0]!.threadId).toBe(deriveRemoteThreadId(THREAD));
    expect(deepAgent.cancelCalls[0]!.runId).toBe(`remote-${runId}`);

    // 独立查库：paused_at 真的写进去了，不是只信返回值。
    const row = await asApp(ORG, (c) =>
      c.query<{ paused_at: Date | null }>("SELECT paused_at FROM agent_runs WHERE id = $1", [runId]),
    );
    expect(row.rows[0]!.paused_at).not.toBeNull();
  });

  it("没有任何 run -> NO_ACTIVE_RUN", async () => {
    await expect(pausePlanRun(
      { runs: planLedger, engine, provenance },
      { orgId: toOrgId(ORG), threadId: THREAD, actorId: ACTOR },
    )).rejects.toMatchObject({ code: "NO_ACTIVE_RUN" });
  });

  it("run 已终态（succeeded）-> RUN_ALREADY_TERMINAL", async () => {
    await seedRun("succeeded");
    await expect(pausePlanRun(
      { runs: planLedger, engine, provenance },
      { orgId: toOrgId(ORG), threadId: THREAD, actorId: ACTOR },
    )).rejects.toMatchObject({ code: "RUN_ALREADY_TERMINAL" });
  });

  it("run 已终态（failed）-> RUN_ALREADY_TERMINAL", async () => {
    await seedRun("failed");
    await expect(pausePlanRun(
      { runs: planLedger, engine, provenance },
      { orgId: toOrgId(ORG), threadId: THREAD, actorId: ACTOR },
    )).rejects.toMatchObject({ code: "RUN_ALREADY_TERMINAL" });
  });

  it("重复暂停已暂停的 run -> NO_ACTIVE_RUN（没有第二次可暂停的对象）", async () => {
    await seedRun("running");
    await pausePlanRun({ runs: planLedger, engine, provenance }, { orgId: toOrgId(ORG), threadId: THREAD, actorId: ACTOR });
    await expect(pausePlanRun(
      { runs: planLedger, engine, provenance },
      { orgId: toOrgId(ORG), threadId: THREAD, actorId: ACTOR },
    )).rejects.toMatchObject({ code: "NO_ACTIVE_RUN" });
  });
});

describe("UC-13 resumePlanRun（暂停的配对动作）", () => {
  it("暂停后可恢复：真实创建新一轮 run（复用 acceptHumanMessage 管线），产生新 runId 与审计", async () => {
    const pausedRunId = await seedRun("running");
    await pausePlanRun({ runs: planLedger, engine, provenance }, { orgId: toOrgId(ORG), threadId: THREAD, actorId: ACTOR });

    const beforeCount = deepAgent.runBodies.length;
    const out = await resumePlanRun(
      { runs: planLedger, runCreator, provenance },
      { orgId: toOrgId(ORG), threadId: THREAD, actorId: ACTOR },
    );
    expect(out.runId).toBeTruthy();
    expect(out.runId).not.toBe(pausedRunId);
    expect(out.resumedFromStepId).toBeNull();
    expect(out.auditEventId).toBeTruthy();

    // 独立核实：替身确实收到了新一轮 run 的创建请求（"恢复=起新一轮"的机制事实）。
    // executor.kick() 是 fire-and-forget，固定 50ms sleep 在机器负载高时会先于它到达
    // 就断言——同 confirm-plan-delivery-digest.test.ts 的既有先例，改轮询。
    await waitForNewRunBody(beforeCount);
  }, 30_000);

  it("从未暂停过 -> NO_PAUSED_STATE", async () => {
    await seedRun("running");
    await expect(resumePlanRun(
      { runs: planLedger, runCreator, provenance },
      { orgId: toOrgId(ORG), threadId: THREAD, actorId: ACTOR },
    )).rejects.toMatchObject({ code: "NO_PAUSED_STATE" });
  });

  it("线程从没有任何 run -> NO_PAUSED_STATE", async () => {
    await expect(resumePlanRun(
      { runs: planLedger, runCreator, provenance },
      { orgId: toOrgId(ORG), threadId: THREAD, actorId: ACTOR },
    )).rejects.toMatchObject({ code: "NO_PAUSED_STATE" });
  });
});
