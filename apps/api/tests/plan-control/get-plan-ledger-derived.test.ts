/**
 * F973 —— UC-1 `getPlanLedger`：读模型唯一数据来源，`phase`/`gate`/`progress` 全是派生值（I-7）。
 *
 * 权威规格：usecases.md UC-1 + domain.md I-7 + XC-59（`packages/contracts/src/plan-control.ts`
 * 的 `PLAN_APPROVAL_TOOL_WHITELIST`）。真 Postgres。
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getPlanLedger } from "../../src/application/plan-control/get-plan-ledger";
import { ingestEnginePlanSnapshot } from "../../src/application/plan-control/ingest-engine-plan-snapshot";
import { PgPlanLedgerRepository } from "../../src/infrastructure/plan-control/pg-plan-ledger-repository";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { appConfig } from "../../src/infrastructure/db/pg-config";
import { asApp, ensureDatabase, migrateOnce, resetOrgs, seedOrg } from "../support/db";
import { addChatThread, addChatMessage } from "../support/chat-db";
import { toOrgId } from "../../src/domain/org-id";

const ORG = "org-f973-get-ledger";
const PROJECT = "proj-f973-get-ledger";
const THREAD = "thread-f973-get-ledger";
const HOOK_TIMEOUT_MS = 60_000;

let db: PgDatabase;
let repo: PgPlanLedgerRepository;

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  db = new PgDatabase(appConfig());
  repo = new PgPlanLedgerRepository(db);
}, HOOK_TIMEOUT_MS);

afterAll(async () => {
  await resetOrgs(ORG);
  await db.close();
});

beforeEach(async () => {
  await resetOrgs(ORG);
  await seedOrg({ orgId: ORG, projectId: PROJECT });
  await addChatThread({
    orgId: ORG, id: THREAD, projectId: PROJECT, visibilityScope: "plenary", createdBy: "u-author",
  });
});

async function insertRun(status: string, pendingToolName: string | null = null): Promise<string> {
  const runId = `run-${randomUUID()}`;
  const messageId = `msg-${randomUUID()}`;
  await addChatMessage({ orgId: ORG, id: messageId, threadId: THREAD, body: "hi", authorId: "u-author" });
  await asApp(ORG, (c) =>
    c.query(
      `INSERT INTO agent_runs
         (id, org_id, thread_id, input_message_id, agent_id, agent_version_id, skill_version_ids,
          model_provider, model_id, status, pending_tool_name, error_code)
       VALUES ($1,$2,$3,$4,'a-1','av-1','[]','openai','gpt',$5,$6,$7)`,
      [
        runId, ORG, THREAD, messageId, status, pendingToolName,
        status === "failed" ? "MODEL_CALL_FAILED" : null,
      ],
    ),
  );
  return runId;
}

describe("UC-1 getPlanLedger：零计划是正常态，不报 PLAN_NOT_FOUND", () => {
  it("新线程返回 revision:0 / steps:[] / phase:'preparing' / gate no-plan", async () => {
    const out = await getPlanLedger(repo, repo, { orgId: toOrgId(ORG), threadId: THREAD });
    expect(out.revision).toBe(0);
    expect(out.steps).toEqual([]);
    expect(out.phase).toBe("preparing");
    expect(out.gate).toEqual({ required: false, reason: "no-plan" });
    expect(out.activeRunId).toBeNull();
    expect(out.pendingApplyAtNextRun).toBe(false);
    expect(out.progress).toEqual({ completed: 0, total: 0, elapsedMs: 0 });
  });
});

describe("I-7：phase/gate 是派生值，由账本内容 + run 状态唯一决定", () => {
  it("单步计划、无活跃 run：gate.required=false（single-step），phase='planning'", async () => {
    await ingestEnginePlanSnapshot(repo, { orgId: toOrgId(ORG), threadId: THREAD, todos: [
      { content: "唯一一步", status: "pending" },
    ] });
    const out = await getPlanLedger(repo, repo, { orgId: toOrgId(ORG), threadId: THREAD });
    expect(out.gate).toEqual({ required: false, reason: "single-step" });
    expect(out.phase).toBe("planning");
  });

  it("多步计划（≥2）、无活跃 run：gate.required=true（multi-step）", async () => {
    await ingestEnginePlanSnapshot(repo, { orgId: toOrgId(ORG), threadId: THREAD, todos: [
      { content: "第一步", status: "pending" }, { content: "第二步", status: "pending" },
    ] });
    const out = await getPlanLedger(repo, repo, { orgId: toOrgId(ORG), threadId: THREAD });
    expect(out.gate).toEqual({ required: true, reason: "multi-step" });
  });

  it("有活跃 run（status=running）：phase='executing'，activeRunId 非空", async () => {
    await ingestEnginePlanSnapshot(repo, { orgId: toOrgId(ORG), threadId: THREAD, todos: [
      { content: "第一步", status: "in_progress" }, { content: "第二步", status: "pending" },
    ] });
    const runId = await insertRun("running");
    const out = await getPlanLedger(repo, repo, { orgId: toOrgId(ORG), threadId: THREAD });
    expect(out.phase).toBe("executing");
    expect(out.activeRunId).toBe(runId);
  });

  it("progress 按 steps 状态计数：completed/total", async () => {
    await ingestEnginePlanSnapshot(repo, { orgId: toOrgId(ORG), threadId: THREAD, todos: [
      { content: "第一步", status: "completed" },
      { content: "第二步", status: "in_progress" },
      { content: "第三步", status: "pending" },
    ] });
    const out = await getPlanLedger(repo, repo, { orgId: toOrgId(ORG), threadId: THREAD });
    expect(out.progress.completed).toBe(1);
    expect(out.progress.total).toBe(3);
  });

  it("run 终态 succeeded：phase='done'", async () => {
    await ingestEnginePlanSnapshot(repo, { orgId: toOrgId(ORG), threadId: THREAD, todos: [
      { content: "第一步", status: "completed" },
    ] });
    await insertRun("succeeded");
    const out = await getPlanLedger(repo, repo, { orgId: toOrgId(ORG), threadId: THREAD });
    expect(out.phase).toBe("done");
    // 终态 run 不是「活跃」run。
    expect(out.activeRunId).toBeNull();
  });

  it("run 终态 failed：phase='failed'", async () => {
    await ingestEnginePlanSnapshot(repo, { orgId: toOrgId(ORG), threadId: THREAD, todos: [
      { content: "第一步", status: "pending" },
    ] });
    await insertRun("failed");
    const out = await getPlanLedger(repo, repo, { orgId: toOrgId(ORG), threadId: THREAD });
    expect(out.phase).toBe("failed");
  });
});

describe("XC-59 反证：agent-interrupts 三个新工具名不得触发 phase='approving'", () => {
  it("awaiting_approval + pending_tool_name='call_skill'：phase='approving'（白名单命中）", async () => {
    await ingestEnginePlanSnapshot(repo, { orgId: toOrgId(ORG), threadId: THREAD, todos: [
      { content: "第一步", status: "in_progress" }, { content: "第二步", status: "pending" },
    ] });
    await insertRun("awaiting_approval", "call_skill");
    const out = await getPlanLedger(repo, repo, { orgId: toOrgId(ORG), threadId: THREAD });
    expect(out.phase).toBe("approving");
  });

  it.each(["confirm_task_intent", "fill_run_params", "choose_execution_option"])(
    "awaiting_approval + pending_tool_name=%s（agent-interrupts 新工具）：phase 不是 'approving'",
    async (toolName) => {
      await ingestEnginePlanSnapshot(repo, { orgId: toOrgId(ORG), threadId: THREAD, todos: [
        { content: "第一步", status: "in_progress" }, { content: "第二步", status: "pending" },
      ] });
      await insertRun("awaiting_approval", toolName);
      const out = await getPlanLedger(repo, repo, { orgId: toOrgId(ORG), threadId: THREAD });
      expect(out.phase).not.toBe("approving");
      expect(out.phase).toBe("executing");
    },
  );
});
