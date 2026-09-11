/**
 * issue #3445 —— `requeueAuthorizedToolCall`（#3420，`running → queued`，已授权工具
 * 自动续跑）修好了「永不恢复」（#3439），但把 run 写回 `queued` 之后**没有任何一条路径
 * 立刻去领它**：`executeQueuedRuns` 本次 tick 的 `claimQueued` 早在这一行变成 `queued`
 * 之前就跑过了（同一个调用栈内部），下一次真正的 `claimQueued` 只能等
 * `sweepOrphanedRuns` 的周期性发现（约 1 分钟 tick + 2 分钟租约阈值）——docx/xlsx
 * 两次真实复测（#3445 issue 正文）都固定卡 2-3 分钟，占端到端总耗时的一半以上。
 *
 * ## 判据落在哪
 *
 * 「界面上等了一会儿最终还是成功了」不是判据——修复前也会成功，只是慢。本文件断言的是
 * `requeueAuthorizedToolCall` 成功写回 `queued` 之后，**同一个调用栈内**有没有真的去
 * `claimQueued` 把这一行重新领回 `running`：
 * - 不接 `deps.kick`（缺省未注入，等价于修复之前）：`handleInterruptedToolCall` 返回时，
 *   没有任何东西碰过 `claimQueued`——行原样躺在 `queued`，这正是 #3445 实测卡住的那
 *   2-3 分钟里数据库的真实状态。
 * - 接上 `deps.kick`（`AgentRunExecutor` 生产合成时注入的 `(orgId) => this.kick(orgId)`
 *   同款）：`handleInterruptedToolCall` 返回之前，`kick` 已经被调用，且这次调用真的把
 *   `claimQueued`（**同一个** `PgAgentRunRepository`，走真实 Postgres 的原子 CAS SQL）
 *   跑了一遍，把这一行重新领回 `running`——全程发生在同一个调用栈，不依赖任何计时器
 *   或第二次网络请求，「2-3 分钟」因此从机制上被消除，不是被某一次实测跑得快掩盖过去。
 *
 * ## 为什么是真库 + 真 `PgAgentRunRepository.claimQueued`，不是内存替身
 *
 * `claimQueued` 自己的原子 CAS（`FOR UPDATE SKIP LOCKED` + `WHERE status='queued'`）是
 * 「重入的 kick 会不会跟当前 tick 剩下的认领撞车」这条并发论证成立的前提——内存替身可以
 * 随手写一个恒真的 `claimQueued`，把这条论证需要的东西正好替身掉，用真库才是真的在验证
 * 生产会跑的那条 SQL。model 层不需要真实模型：这里要证的是编排层的时序，不是模型输出。
 */
import { beforeAll, beforeEach, expect, it } from "vitest";
import type { DatabasePort } from "../../src/application/ports/database.port";
import { toOrgId } from "../../src/domain/org-id";
import { asApp, ensureDatabase, migrateOnce, resetOrgs, seedOrg } from "../support/db";
import { addChatMessage, addChatThread } from "../support/chat-db";
import { PgAgentRunRepository } from "../../src/infrastructure/agent-run/pg-agent-run-repository";
import { PgToolPermissionGrantRepository } from "../../src/infrastructure/agent-run/pg-tool-permission-grant-repository";
import { handleInterruptedToolCall } from "../../src/application/agent-run/tool-permission-gate";
import type { ExecuteAgentRunDeps } from "../../src/application/agent-run/execute-run";

const ORG = "org-3445-immediate-kick";
const org = toOrgId(ORG);
const THREAD = "thread-3445-immediate-kick";
const AGENT = "agent-3445-immediate-kick";
const AGENT_VERSION = "agent-version-3445-immediate-kick";
/** #3445 issue 正文的两次真实复测都在这个工具上——docx/xlsx 生成走的 execute。 */
const TOOL = "execute";

const db: DatabasePort = {
  withTenant: (id, fn) => asApp(id, (c) => fn({
    query: async (sql, params = []) => ({ rows: (await c.query(sql, [...params])).rows }),
  })),
  withoutTenant: async () => { throw new Error("tenant required"); },
  close: async () => {},
};

async function runRow(runId: string): Promise<{ status: string; pending_decision: string | null }> {
  return asApp(ORG, async (c) => (await c.query(
    "SELECT status,pending_decision FROM agent_runs WHERE org_id=$1 AND id=$2", [ORG, runId],
  )).rows[0]);
}

/** 一条正在被执行、即将在这一拍再次被 `execute` 中断的 run（与 #3420 测试同一个形状）。 */
async function seedRunningRun(runId: string, inputMessageId: string): Promise<void> {
  await addChatMessage({ orgId: ORG, id: inputMessageId, threadId: THREAD, body: "帮我做一个 Excel 表格", authorId: "u-3445" });
  await asApp(ORG, async (c) => {
    await c.query(
      `INSERT INTO agent_runs
         (id,org_id,thread_id,input_message_id,agent_id,agent_version_id,skill_version_ids,
          model_provider,model_id,status,started_at,heartbeat_at,lease_epoch,lease_expires_at)
       VALUES ($1,$2,$3,$4,$5,$6,'[]','deep-agent','deep-agent','running',now(),now(),2,now()+interval '5 minute')`,
      [runId, ORG, THREAD, inputMessageId, AGENT, AGENT_VERSION],
    );
  });
}

/** 用户点过「本 run 内都允许」——授权走产品路径真实落库，不是测试手插一行 tool_permission_grants。 */
async function userChoosesRunScope(repo: PgAgentRunRepository, runId: string): Promise<void> {
  await repo.markAwaitingToolPermission(org, runId, { toolName: TOOL, argsSummary: "{}" });
  const requestId = await asApp(ORG, async (c) => (await c.query(
    "SELECT pending_permission_request_id FROM agent_runs WHERE org_id=$1 AND id=$2", [ORG, runId],
  )).rows[0].pending_permission_request_id as string);
  expect(await repo.decidePermissionRequest(org, runId, requestId, "run", "u-3445")).toBe(true);
  // 裁决之后 executor 会把它领回 running 继续跑——同 #3420 测试一致，回到 running
  // 才是「已授权工具在同一 run 内第二次被中断」这颗形状的起点。
  await asApp(ORG, (c) => c.query(
    "UPDATE agent_runs SET status='running', pending_decision=NULL WHERE org_id=$1 AND id=$2", [ORG, runId],
  ));
}

beforeAll(async () => { await ensureDatabase(); await migrateOnce(); });

beforeEach(async () => {
  await resetOrgs(ORG);
  await seedOrg({ orgId: ORG, projectId: "proj-3445-immediate-kick" });
  await addChatThread({ orgId: ORG, id: THREAD, projectId: "proj-3445-immediate-kick", visibilityScope: "plenary", createdBy: "u-3445" });
  await asApp(ORG, async (c) => {
    await c.query(
      `INSERT INTO agents(id,org_id,stable_name,name,status,creator_id,created_at,updated_at)
       VALUES ($1,$2,$3,$4,'enabled','u-3445',now(),now())`,
      [AGENT, ORG, AGENT, AGENT],
    );
    await c.query(
      `INSERT INTO agent_versions
         (id,org_id,agent_id,semantic_label,instruction_digest,instructions,skill_version_ids,
          model_provider,model_id,tool_policy,creator_id,created_at,published_at)
       VALUES ($1,$2,$3,'v1',repeat('a',64),'test','{}'::text[],'deep-agent','deep-agent','[]'::jsonb,'u-3445',now(),now())`,
      [AGENT_VERSION, ORG, AGENT],
    );
  });
});

it("① 不接 deps.kick（等价于修复之前）：requeue 成功后，同一个调用栈内没有任何东西去 claimQueued——行原样躺在 queued", async () => {
  const repo = new PgAgentRunRepository(db);
  const grants = new PgToolPermissionGrantRepository(db);
  const runId = "run-3445-no-kick";
  await seedRunningRun(runId, `${runId}-input`);
  await userChoosesRunScope(repo, runId);

  let claimQueuedCalls = 0;
  const spyingRepo = new Proxy(repo, {
    get(target, prop, receiver) {
      if (prop === "claimQueued") {
        return (...args: Parameters<PgAgentRunRepository["claimQueued"]>) => {
          claimQueuedCalls += 1;
          return Reflect.get(target, prop, receiver).apply(target, args);
        };
      }
      return Reflect.get(target, prop, receiver);
    },
  });

  const deps = {
    runs: spyingRepo, toolPermissionGrants: grants,
    clock: { now: () => new Date().toISOString() },
    log: () => {},
    // kick 缺省未注入——与本 feature 之前逐字节相同。
  } as unknown as ExecuteAgentRunDeps;

  const outcome = await handleInterruptedToolCall(deps, org, runId, { toolName: TOOL, argsSummary: "{}" }, {
    seq: 50, modelStartedAt: new Date().toISOString(), systemDigest: "b".repeat(64), system: "system",
  });

  expect(outcome.autoApproved, "已授权的同一工具不该停下来等人").toBe(true);
  expect(claimQueuedCalls, "#3445 缺陷的真实形状：没有 kick，claimQueued 在这个调用栈里一次都没被碰过").toBe(0);
  const row = await runRow(runId);
  expect(row.status, "行原样躺在 queued——这正是实测卡住的那 2-3 分钟里数据库的真实状态").toBe("queued");
});

it("② 接上 deps.kick（AgentRunExecutor 生产同款）：requeue 成功后同一调用栈内立刻 claimQueued 把它领回 running，不等周期性扫描", async () => {
  const repo = new PgAgentRunRepository(db);
  const grants = new PgToolPermissionGrantRepository(db);
  const runId = "run-3445-with-kick";
  await seedRunningRun(runId, `${runId}-input`);
  await userChoosesRunScope(repo, runId);

  let kickCalls = 0;
  let claimQueuedCalls = 0;
  // 生产里 `kick()` 是 fire-and-forget（`void this.tick(orgId).catch(...)`）——调用方
  // 不等它。测试要证的正是「这个 fire-and-forget 触发的动作最终真的把行领回了
  // running，且不依赖任何计时器」，所以这里把 kick 触发的那个 promise 记下来，
  // 稍后显式 await 它一次（相当于让事件循环把这个已经在排队的微任务/DB 往返跑完），
  // 而不是伪造一个同步等待——生产代码路径本身没有变，变的只是测试怎么确认它跑完了。
  let kicked: Promise<unknown> | null = null;
  const deps = {
    runs: repo, toolPermissionGrants: grants,
    clock: { now: () => new Date().toISOString() },
    log: () => {},
    // 生产合成（`AgentRunExecutor.tick`）注入的正是 `(orgId) => this.kick(orgId)`——
    // `kick()` 本身是 fire-and-forget（`void this.tick(orgId).catch(...)`），这里同款地
    // 不 await 它，只是把「谁来触发下一次 claimQueued」这件事从「周期性扫描」提前到
    // 「这个调用栈还没返回的时候」。
    kick: (o: typeof org) => {
      kickCalls += 1;
      kicked = (async () => {
        claimQueuedCalls += 1;
        await repo.claimQueued(o, 10);
      })();
    },
  } as unknown as ExecuteAgentRunDeps;

  const outcome = await handleInterruptedToolCall(deps, org, runId, { toolName: TOOL, argsSummary: "{}" }, {
    seq: 50, modelStartedAt: new Date().toISOString(), systemDigest: "b".repeat(64), system: "system",
  });
  expect(outcome.autoApproved).toBe(true);
  expect(kickCalls, "requeue 成功之后，deps.kick 必须被调用——这就是 #3445 补的那一行").toBe(1);

  await kicked;

  expect(claimQueuedCalls, "kick 必须真的驱动了一次 claimQueued，不是调用了但什么都没做").toBe(1);
  const row = await runRow(runId);
  expect(
    row.status,
    "同一调用栈内已经把这一行重新领回 running——不依赖任何计时器或周期性扫描，2-3 分钟的固定延迟因此从机制上消除",
  ).toBe("running");
});
