/**
 * 实测回归（native loopback 栈，W029）：Agent 调 `start_workflow` 后聊天挂住——run 停在
 * `writeback_pending` 直到下一条用户消息触发 tick，那条消息还吃 409。
 *
 * 根因：`handleWorkflowStartCall` 在**该 run 的执行栈里**（`withRunLease` 的 ALS 上下文）
 * requeue + `kick()`。kick 起的后台 tick 继承了旧 epoch 的租约围栏：`claimQueued` 领回 run
 * （epoch+1）、续跑在新租约里走到 `writeback_pending`，随后 `writeBackPendingRuns` 回到继承的
 * 旧围栏下 ⇒ `RunLeaseLostError` ⇒ tick 被 kick 的 catch 当 `claim_failed` 吞掉。
 *
 * 判据：真 `PgDatabase`（带租约围栏）+ 真 `PgAgentRunRepository` + 真 `AgentRunExecutor`，
 * 只 tick **一次**；续跑的模型调用被闸住直到外层 tick 自己的 writeback 已经跑完（排除外层
 * 顺手把它写回的偶然），之后不再有任何 tick / 消息，run 必须自己走到 `succeeded`。
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import { AgentRunExecutor } from "../../src/infrastructure/agent-run/agent-run-executor";
import { PgAgentRunRepository } from "../../src/infrastructure/agent-run/pg-agent-run-repository";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { appConfig } from "../../src/infrastructure/db/pg-config";
import type { ModelCallCompletion, ModelCallInput, ModelCallPort } from "../../src/application/agent-run/ports";
import type { LoggerPort } from "../../src/application/ports/logger.port";
import { toOrgId } from "../../src/domain/org-id";
import { asApp, ensureDatabase, migrateOnce, resetOrgs, seedOrg } from "../support/db";
import { addChatMessage, addChatThread } from "../support/chat-db";

const ORG = "org-wf-start-kick";
const org = toOrgId(ORG);
const PROJECT = "proj-wf-start-kick";
const THREAD = "thread-wf-start-kick";
const AGENT = "agent-wf-start-kick";
const VERSION = "agent-version-wf-start-kick";
const USER = "u-wf-start-kick";

let db: PgDatabase;
const errors: Array<Record<string, unknown>> = [];
const logger = {
  info: () => {}, warn: () => {}, debug: () => {},
  error: (_m: string, fields: Record<string, unknown>) => { errors.push(fields); },
} as unknown as LoggerPort;

beforeAll(async () => { ensureDatabase(); await migrateOnce(); db = new PgDatabase(appConfig()); });
afterAll(async () => { await db.close(); });

beforeEach(async () => {
  errors.length = 0;
  await resetOrgs(ORG);
  await seedOrg({ orgId: ORG, projectId: PROJECT });
  await addChatThread({ orgId: ORG, id: THREAD, projectId: PROJECT, visibilityScope: "plenary", createdBy: USER });
  await asApp(ORG, async (c) => {
    await c.query(`INSERT INTO agents(id,org_id,stable_name,name,status,creator_id,created_at,updated_at)
      VALUES ($1,$2,$1,$1,'enabled',$3,now(),now())`, [AGENT, ORG, USER]);
    await c.query(`INSERT INTO agent_versions
        (id,org_id,agent_id,semantic_label,instruction_digest,instructions,skill_version_ids,
         model_provider,model_id,tool_policy,creator_id,created_at,published_at,workflow_allowlist)
       VALUES ($1,$2,$3,'v1',repeat('a',64),'角色','{}'::text[],'chat','m','[]'::jsonb,$4,now(),now(),$5)`,
    [VERSION, ORG, AGENT, USER, ["W029"]]);
  });
});

async function status(runId: string): Promise<string> {
  return asApp(ORG, async (c) => (await c.query<{ status: string }>(
    "SELECT status FROM agent_runs WHERE org_id=$1 AND id=$2", [ORG, runId])).rows[0]!.status);
}

it("start_workflow → requeue + kick：续跑不靠下一条消息就走到 succeeded", async () => {
  const runId = `run-${randomUUID()}`;
  await addChatMessage({ orgId: ORG, id: `${runId}-in`, threadId: THREAD, body: "帮我发起 W029", authorId: USER });
  await asApp(ORG, (c) => c.query(`INSERT INTO agent_runs (id,org_id,thread_id,input_message_id,agent_id,agent_version_id,
      skill_version_ids,model_provider,model_id,status) VALUES ($1,$2,$3,$4,$5,$6,'[]'::jsonb,'chat','m','queued')`,
  [runId, ORG, THREAD, `${runId}-in`, AGENT, VERSION]));

  let releaseContinuation!: () => void;
  const continuationGate = new Promise<void>((r) => { releaseContinuation = r; });
  let continuationStarted!: () => void;
  const continuationReached = new Promise<void>((r) => { continuationStarted = r; });
  const calls: ModelCallInput[] = [];
  const model: ModelCallPort = {
    async complete(input): Promise<ModelCallCompletion> {
      calls.push(input);
      if (calls.length === 1) {
        return { text: "", interrupted: { toolName: "start_workflow", toolCallId: "call-1", argsSummary: JSON.stringify({ workflowId: "W029", input: {} }) } };
      }
      continuationStarted();
      await continuationGate;
      return { text: "流程结果已告知。" };
    },
  };
  const executor = new AgentRunExecutor(new PgAgentRunRepository(db), model, logger, /* autostart */ true);

  await executor.tick(org);
  await continuationReached;
  releaseContinuation();

  const deadline = Date.now() + 15_000;
  let s = await status(runId);
  while (s !== "succeeded" && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 100));
    s = await status(runId);
  }
  expect(errors, "kick 起的 tick 不得被吞成 claim_failed").toEqual([]);
  expect(calls).toHaveLength(2);
  expect(s, "只 tick 一次、没有第二条消息：续跑必须自己写回完成").toBe("succeeded");
});
