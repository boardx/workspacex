/**
 * #2463 -- `pg-agent-run-repository.ts`'s `readRun` collapses `agent_run_steps`' two
 * append-only rows per `tool_call_id` (an `in_progress` announcement and its later
 * terminal outcome, `#742 Gap 1`) down to one projected step. Which row's CONTENT wins
 * (terminal once it exists) was already correct; which row's `seq` decided the projected
 * step's POSITION was not -- it used the terminal row's own (always-newer) `seq`, so a
 * step first announced EARLY silently moved to the TAIL of the array the moment it
 * resolved, sliding past any position-based "already reported" cursor a caller took a
 * snapshot of in between (`agui-bridge.ts`'s `pollAguiRunToOutcome`/
 * `initialReportedStepCount`) -- see `agui-bridge-hitl.test.ts`'s "approve：resume 请求把
 * run 续跑到 succeeded" case for the real symptom this produced (a duplicate
 * `STEP_STARTED`).
 *
 * This file tests the ordering fix directly against the collapse query, independent of
 * the bridge/executor machinery: append rows exactly the way `resumeAguiBridgeTurn`'s
 * real sequence does (pending tool_call -> its own `model_called` announcement -> a
 * SECOND `model_called` for the resumed turn, appended with resume's always-higher `seq`
 * -> finally the tool_call's terminal row, sharing the SAME `tool_call_id`, also at a
 * resume-time `seq`) and assert the position the reader sees, not just the content.
 *
 * Real Postgres, not a mock -- the whole point is a window-function ORDER BY that a
 * fake repository could not get wrong the same way a real one did.
 */
import { randomUUID } from "node:crypto";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { addOrgMember, addProjectMember, asApp, ensureDatabase, migrateOnce, resetOrgs, seedOrg } from "../support/db";
import { addChatThread, addChatMessage } from "../support/chat-db";
import { toOrgId } from "../../src/domain/org-id";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { appConfig } from "../../src/infrastructure/db/pg-config";
import { PgAgentRunRepository } from "../../src/infrastructure/agent-run/pg-agent-run-repository";
import type { AppendedRunStep } from "../../src/application/agent-run/ports";

process.env.KERNEL_ALLOW_TEST_PRINCIPAL = "1";
process.env.KERNEL_QUIET = "1";

const ORG = toOrgId("org-i2463-step-collapse-order");
const PROJECT = "proj-i2463-step-collapse-order";
const THREAD = "thread-i2463-step-collapse-order";
const ACTOR = "u-i2463-step-collapse-order-actor";

const APPROVAL_TOOL_NAME = "send_email";

let db: PgDatabase;
let repo: PgAgentRunRepository;
let app: NestExpressApplication;
let BASE = "";

const principal = (user: string, org: string) => ({
  "x-kernel-test-principal": `${user}:${org}`,
  "content-type": "application/json",
});

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  db = new PgDatabase(appConfig());
  repo = new PgAgentRunRepository(db);
  const { createApp } = await import("../../src/main");
  app = await createApp();
  await app.listen(0);
  const addr = app.getHttpServer().address();
  BASE = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
}, 180_000);

afterAll(async () => {
  await app?.close();
  await db.close();
  await resetOrgs(ORG);
});

beforeEach(async () => {
  await resetOrgs(ORG);
  await seedOrg({ orgId: ORG, projectId: PROJECT });
  await addOrgMember(ORG, ACTOR, "consultant", null);
  await addProjectMember(ORG, PROJECT, ACTOR, "facilitator", null);
  await addChatThread({
    orgId: ORG, id: THREAD, projectId: PROJECT, visibilityScope: "plenary", createdBy: ACTOR,
  });
});

/** No FK on `agent_id`/`agent_version_id` (only `thread_id`/`input_message_id` reference
 *  real tables) -- same minimal fixture `reclaim-stale-running.test.ts` already relies on,
 *  no agent/skill catalog rows needed just to attach steps to a run. */
async function seedRun(id: string): Promise<void> {
  const inputMessageId = `${id}-input`;
  await addChatMessage({ orgId: ORG, id: inputMessageId, threadId: THREAD, body: "hi", authorId: ACTOR });
  await asApp(ORG, (c) =>
    c.query(
      `INSERT INTO agent_runs
         (id, org_id, thread_id, input_message_id, agent_id, agent_version_id,
          skill_version_ids, model_provider, model_id, status)
       VALUES ($1,$2,$3,$4,$5,$6,'[]'::jsonb,$7,$8,'running')`,
      [id, ORG, THREAD, inputMessageId, "agent-i2463", "agent-version-i2463", "test-provider", "test-model"],
    ),
  );
}

function step(over: Partial<AppendedRunStep> & { runId: string; seq: number }): AppendedRunStep {
  return {
    kind: "model_called", status: "succeeded", startedAt: new Date().toISOString(),
    endedAt: new Date().toISOString(), inputDigest: null, outputDigest: null, failureCode: null,
    toolName: null, toolArgsSummary: null, toolResultSummary: null, planningNote: null,
    toolCallId: null,
    ...over,
  };
}

async function getRun(runId: string): Promise<{ status: number; body: { steps: { kind: string; status: string; toolName: string | null }[] } | null }> {
  const response = await fetch(`${BASE}/agent-runs/${runId}`, { headers: principal(ACTOR, ORG) });
  const body = response.status === 200
    ? await response.json() as { steps: { kind: string; status: string; toolName: string | null }[] }
    : null;
  return { status: response.status, body };
}

describe("readRun -- append-only tool_call rows collapse to a stable POSITION, not the terminal row's own seq", () => {
  it("一个 tool_call 在 HITL resume 之后完成：折叠后展示终态内容，但仍钉在它最初被宣布的位置", async () => {
    const runId = randomUUID();
    await seedRun(runId);
    const toolCallId = randomUUID();

    // Turn 1 -- exactly `execute-run.ts`'s own sequence for an interrupted tool call:
    // the pending tool_call row, then its `model_called` "等待人工批准" announcement.
    await repo.appendStep(ORG, step({
      runId, seq: 1, kind: "tool_call", status: "in_progress",
      toolName: APPROVAL_TOOL_NAME, toolArgsSummary: "{\"to\":\"ops@example.test\"}",
      toolCallId,
    }));
    await repo.appendStep(ORG, step({
      runId, seq: 2, kind: "model_called", planningNote: `等待人工批准：${APPROVAL_TOOL_NAME}`,
    }));

    // Resume -- `resumeAguiBridgeTurn`'s real order: a NEW `model_called` step for the
    // resumed turn lands FIRST (higher seq, no tool_call_id, its own group), and only
    // once the resumed tool call actually finishes does the terminal `tool_call` row for
    // the SAME `toolCallId` get appended, at a seq higher still.
    await repo.appendStep(ORG, step({
      runId, seq: 3,
    }));
    await repo.appendStep(ORG, step({
      runId, seq: 4, kind: "tool_call", status: "succeeded",
      toolName: APPROVAL_TOOL_NAME, toolResultSummary: "sent",
      toolCallId,
    }));

    const { status, body } = await getRun(runId);
    expect(status).toBe(200);
    // The bug: sorting by the picked row's OWN seq would put the (seq=4) terminal
    // tool_call row LAST -- [model_called, model_called, tool_call]. Position must
    // instead reflect when the call was FIRST announced (seq=1) -- first in the array,
    // exactly where a caller who already reported it (a resume snapshot taken between
    // seq=2 and seq=3) would find it again and NOT mistake it for something new.
    expect(body?.steps.map((s) => [s.kind, s.status, s.toolName])).toEqual([
      ["tool_call", "succeeded", APPROVAL_TOOL_NAME],
      ["model_called", "succeeded", null],
      ["model_called", "succeeded", null],
    ]);
  }, 30_000);

  it("多个并发 tool_call 各自的 toolCallId 分组互不干扰，各自钉在自己最早的位置", async () => {
    const runId = randomUUID();
    await seedRun(runId);
    const toolCallA = randomUUID();
    const toolCallB = randomUUID();

    await repo.appendStep(ORG, step({
      runId, seq: 1, kind: "tool_call", status: "in_progress",
      toolName: "tool_a", toolCallId: toolCallA,
    }));
    await repo.appendStep(ORG, step({
      runId, seq: 2, kind: "tool_call", status: "in_progress",
      toolName: "tool_b", toolCallId: toolCallB,
    }));
    // B finishes first (its terminal row gets the lower of the two later seqs) --
    // ordering must still track each group's OWN first-seen seq (1 and 2), not the
    // order their terminal rows happened to land in.
    await repo.appendStep(ORG, step({
      runId, seq: 3, kind: "tool_call", status: "succeeded",
      toolName: "tool_b", toolCallId: toolCallB,
    }));
    await repo.appendStep(ORG, step({
      runId, seq: 4, kind: "tool_call", status: "failed", failureCode: "MODEL_CALL_FAILED",
      toolName: "tool_a", toolCallId: toolCallA,
    }));

    const { status, body } = await getRun(runId);
    expect(status).toBe(200);
    expect(body?.steps.map((s) => [s.toolName, s.status])).toEqual([
      ["tool_a", "failed"],
      ["tool_b", "succeeded"],
    ]);
  }, 30_000);

  it("没有 toolCallId 的 step（每个都是自己的分组）顺序不变——折叠对它们是恒等操作", async () => {
    const runId = randomUUID();
    await seedRun(runId);

    await repo.appendStep(ORG, step({ runId, seq: 1, planningNote: "first" }));
    await repo.appendStep(ORG, step({ runId, seq: 2, planningNote: "second" }));
    await repo.appendStep(ORG, step({ runId, seq: 3, planningNote: "third" }));

    const { status, body } = await getRun(runId);
    expect(status).toBe(200);
    expect(body?.steps.map((s) => s.kind)).toEqual(["model_called", "model_called", "model_called"]);
  }, 30_000);
});
