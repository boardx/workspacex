/**
 * F976 —— UC-10 `retryPlanStep`（判据六 ①）+ I-13：四个执行控制动作各产生一条审计事件。
 *
 * 权威规格：usecases.md UC-10 + domain.md I-13。真栈，复用与
 * `pause-resume-run.test.ts` 同一契约的 deep-agent 服务替身。
 */
import { createHash, randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { DEEP_AGENT_PROVIDER_NAME } from "../../src/infrastructure/agent-run/deep-agent-model-provider";
import { retryPlanStep } from "../../src/application/plan-control/retry-plan-step";
import { pausePlanRun } from "../../src/application/plan-control/pause-plan-run";
import { resumePlanRun } from "../../src/application/plan-control/resume-plan-run";
import { ingestEnginePlanSnapshot } from "../../src/application/plan-control/ingest-engine-plan-snapshot";
import { DeepAgentEngineRunController } from "../../src/infrastructure/plan-control/deep-agent-engine-run-controller";
import { AcceptMessagePlanRunCreator } from "../../src/infrastructure/plan-control/accept-message-plan-run-creator";
import { PLAN_LEDGER_REPOSITORY, type PlanLedgerRepository, type PlanRunStatusReader } from "../../src/application/plan-control/ports";
import { PROVENANCE_WRITER, type ProvenanceWriter } from "../../src/application/provenance/ports";
import { DATABASE_PORT } from "../../src/application/ports/database.port";
import type { DatabasePort } from "../../src/application/ports/database.port";
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
import { toOrgId } from "../../src/domain/org-id";
import {
  addOrgMember, addProjectMember, asApp, ensureDatabase, migrateOnce, resetOrgs, seedOrg,
} from "../support/db";
import { addChatThread, addChatMessage } from "../support/chat-db";

process.env.KERNEL_ALLOW_TEST_PRINCIPAL = "1";
process.env.KERNEL_QUIET = "1";

const ORG = "org-f976-retry-audit";
const PROJECT = "proj-f976-retry-audit";
const THREAD = "thread-f976-retry-audit";
const ACTOR = "u-f976-retry-audit";
const AGENT = "agent-f976-retry-audit";
const AGENT_VERSION = "agent-version-f976-retry-audit-v1";

const sha256 = (v: string): string => createHash("sha256").update(v).digest("hex");

async function startDeepAgentFake(): Promise<{ port: number; runBodies: unknown[]; close(): Promise<void> }> {
  const runBodies: unknown[] = [];
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
    if (req.method === "POST" && /^\/threads\/[^/]+\/runs\/[^/]+\/cancel$/.test(path)) { json(200, { ok: true }); return; }
    const runsMatch = /^\/threads\/([^/]+)\/runs$/.exec(path);
    if (req.method === "POST" && runsMatch) {
      threads.add(runsMatch[1]!);
      const chunks: Buffer[] = [];
      req.on("data", (c: Buffer) => chunks.push(c));
      req.on("end", () => {
        runBodies.push(JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown);
        json(200, { run_id: runsMatch[1]! });
      });
      return;
    }
    if (req.method === "GET" && /^\/threads\/[^/]+\/runs\/[^/]+$/.test(path)) { json(200, { status: "success" }); return; }
    if (req.method === "GET" && /^\/threads\/[^/]+\/state$/.test(path)) {
      json(200, { values: { messages: [{ type: "ai", content: "好的。" }] } });
      return;
    }
    res.writeHead(404).end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    port: (server.address() as AddressInfo).port, runBodies,
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
      [AGENT_VERSION, ORG, AGENT, AGENT_VERSION, sha256("f976 retry audit instructions"),
        "You are the F976 retry/audit test agent.", DEEP_AGENT_PROVIDER_NAME, "deep-agent", ACTOR],
    );
    await c.query("UPDATE agents SET published_version_id=$1 WHERE id=$2 AND org_id=$3", [AGENT_VERSION, AGENT, ORG]);
  });
}

let app: NestExpressApplication;
let deepAgent: Awaited<ReturnType<typeof startDeepAgentFake>>;
let planLedger: PlanLedgerRepository & PlanRunStatusReader;
let provenance: ProvenanceWriter;
let db: DatabasePort;
let engine: DeepAgentEngineRunController;
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
  provenance = app.get<ProvenanceWriter>(PROVENANCE_WRITER);
  db = app.get<DatabasePort>(DATABASE_PORT);
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

async function seedRun(status: string): Promise<string> {
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
        `remote-${runId}`, status === "failed" ? "MODEL_CALL_FAILED" : null,
      ],
    ),
  );
  return runId;
}

async function auditRow(id: string): Promise<{ actor_id: string; detail: Record<string, unknown> } | undefined> {
  const r = await asApp(ORG, (c) =>
    c.query<{ actor_id: string; detail: Record<string, unknown> }>(
      "SELECT actor_id, detail FROM provenance_events WHERE id = $1", [id],
    ),
  );
  return r.rows[0];
}

describe("UC-10 retryPlanStep：该 step 及其后续置回 pending，起新一轮 run", () => {
  it("失败的 run + 多步计划：目标 step 及后续全部回 pending，之前的 step 不受影响", async () => {
    const ingested = await ingestEnginePlanSnapshot(planLedger, {
      orgId: toOrgId(ORG), threadId: THREAD,
      todos: [
        { content: "第一步", status: "completed" },
        { content: "第二步", status: "completed" },
        { content: "第三步（失败）", status: "pending" },
        { content: "第四步", status: "pending" },
      ],
    });
    await seedRun("failed");
    const latest = await planLedger.getLatest(toOrgId(ORG), THREAD);
    const targetStepId = latest!.steps[2]!.planStepId;

    const beforeCount = deepAgent.runBodies.length;
    const out = await retryPlanStep(
      { db, repo: planLedger, runs: planLedger, runCreator }, provenance,
      { orgId: toOrgId(ORG), threadId: THREAD, actorId: ACTOR, planStepId: targetStepId },
    );
    expect(out.runId).toBeTruthy();
    expect(out.auditEventId).toBeTruthy();

    const after = await planLedger.getLatest(toOrgId(ORG), THREAD);
    expect(after!.revision).toBe(ingested.revision + 1);
    expect(after!.steps.map((s) => s.status)).toEqual(["completed", "completed", "pending", "pending"]);

    // 独立核实：确实起了一轮新 run（送达路径真的被调用）。
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(deepAgent.runBodies.length).toBeGreaterThan(beforeCount);
  }, 30_000);

  it("planStepId 不存在 -> PLAN_STEP_NOT_FOUND", async () => {
    await ingestEnginePlanSnapshot(planLedger, {
      orgId: toOrgId(ORG), threadId: THREAD, todos: [{ content: "唯一一步", status: "pending" }],
    });
    await seedRun("failed");
    await expect(retryPlanStep(
      { db, repo: planLedger, runs: planLedger, runCreator }, provenance,
      { orgId: toOrgId(ORG), threadId: THREAD, actorId: ACTOR, planStepId: "no-such-step" },
    )).rejects.toMatchObject({ code: "PLAN_STEP_NOT_FOUND" });
  });

  it("没有失败的 run（run 还在跑）-> NO_ACTIVE_RUN", async () => {
    await ingestEnginePlanSnapshot(planLedger, {
      orgId: toOrgId(ORG), threadId: THREAD, todos: [{ content: "唯一一步", status: "pending" }],
    });
    const latest = await planLedger.getLatest(toOrgId(ORG), THREAD);
    await seedRun("running");
    await expect(retryPlanStep(
      { db, repo: planLedger, runs: planLedger, runCreator }, provenance,
      { orgId: toOrgId(ORG), threadId: THREAD, actorId: ACTOR, planStepId: latest!.steps[0]!.planStepId },
    )).rejects.toMatchObject({ code: "NO_ACTIVE_RUN" });
  });
});

describe("I-13：pause / resume / retry-step 三个执行控制动作各产生一条可独立查证的审计事件", () => {
  it("三个动作各留痕，detail.action 各不相同，actor_id 都是发起人", async () => {
    await ingestEnginePlanSnapshot(planLedger, {
      orgId: toOrgId(ORG), threadId: THREAD,
      todos: [{ content: "第一步", status: "pending" }, { content: "第二步", status: "pending" }],
    });

    await seedRun("running");
    const pauseOut = await pausePlanRun(
      { runs: planLedger, engine, provenance }, { orgId: toOrgId(ORG), threadId: THREAD, actorId: ACTOR },
    );
    const pauseAudit = await auditRow(pauseOut.auditEventId);
    expect(pauseAudit?.actor_id).toBe(ACTOR);
    expect(pauseAudit?.detail.action).toBe("pausePlanRun");

    const resumeOut = await resumePlanRun(
      { runs: planLedger, runCreator, provenance }, { orgId: toOrgId(ORG), threadId: THREAD, actorId: ACTOR },
    );
    const resumeAudit = await auditRow(resumeOut.auditEventId);
    expect(resumeAudit?.actor_id).toBe(ACTOR);
    expect(resumeAudit?.detail.action).toBe("resumePlanRun");

    // 把最新 run 标成失败，才能重试。
    await asApp(ORG, (c) =>
      c.query(
        "UPDATE agent_runs SET status = 'failed', error_code = 'MODEL_CALL_FAILED' WHERE id = $1",
        [resumeOut.runId],
      ),
    );
    const latest = await planLedger.getLatest(toOrgId(ORG), THREAD);
    const retryOut = await retryPlanStep(
      { db, repo: planLedger, runs: planLedger, runCreator }, provenance,
      { orgId: toOrgId(ORG), threadId: THREAD, actorId: ACTOR, planStepId: latest!.steps[0]!.planStepId },
    );
    const retryAudit = await auditRow(retryOut.auditEventId);
    expect(retryAudit?.actor_id).toBe(ACTOR);
    expect(retryAudit?.detail.action).toBe("retryPlanStep");

    // 三条审计事件是三条不同的行——不是同一行被复用/覆盖。
    expect(new Set([pauseOut.auditEventId, resumeOut.auditEventId, retryOut.auditEventId]).size).toBe(3);
  }, 30_000);
});
