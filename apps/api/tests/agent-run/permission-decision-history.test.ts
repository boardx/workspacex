/**
 * issue #3302 —— 「这条 run 上已经问过几次授权、上次选了哪档」的权威事实必须在服务端。
 *
 * # 这条用例为什么存在
 *
 * 这个计数曾经只活在 `restored-run-approval.tsx` 的一个 `useState` 里，而该组件的挂载门
 * 是 `status === "awaiting_tool_permission"`：同一条 run 的两次中断之间整段是 `running`，
 * 组件被**正确地**卸载，计数当场销毁 ⇒ #3212 ② 的「这是本次任务里第 N 次请求授权」在
 * 同一条 run 的第二次授权上从未出现过。同一事实声明在两处、而其中一处必然丢失。
 *
 * # 判据是行为，不是痕迹
 *
 * 走真库，真的做两轮「中断 → 裁决」，并在中间那段 `running`（组件在真实链路上被卸载的
 * 那一段）上也读一次权威投影：计数必须在那段窗口里照样读得到，因为它描述的是这条 run
 * 的历史，不是当下有没有待决请求。
 *
 * ⚠ 最后一条断言（输了竞态的裁决一次都不许加）与前面同等重要：计数若在条件 UPDATE
 * 之外自增，用户会看到一个比真实裁决次数大的数字——那比不显示更糟。
 */
import { beforeAll, beforeEach, expect, it } from "vitest";
import type { DatabasePort } from "../../src/application/ports/database.port";
import { toOrgId } from "../../src/domain/org-id";
import { asApp, ensureDatabase, migrateOnce, resetOrgs, seedOrg } from "../support/db";
import { addChatMessage, addChatThread } from "../support/chat-db";
import { PgAgentRunRepository } from "../../src/infrastructure/agent-run/pg-agent-run-repository";
import { discloseDecided, isDisclosed } from "../../src/application/security/permission-filter";
import type { PermissionDecision } from "../../src/domain/identity/permission-decision";
import type { RunProjection } from "../../src/application/agent-run/ports";

const ORG = "org-permission-decision-history";
const org = toOrgId(ORG);
const RUN = "history-run";

const db: DatabasePort = {
  withTenant: (id, fn) => asApp(id, (c) => fn({
    query: async (sql, params = []) => ({ rows: (await c.query(sql, [...params])).rows }),
  })),
  withoutTenant: async () => { throw new Error("tenant required"); },
  close: async () => {},
};

const ALLOW_ALL = { allowed: true, decisionId: "decision-3302" } as unknown as PermissionDecision;

async function readProjection(repo: PgAgentRunRepository): Promise<RunProjection> {
  const guarded = await repo.readRun(org, RUN);
  expect(guarded, "这条 run 必须读得到——读不到的话下面每条断言都无从判起").not.toBeNull();
  const disclosed = discloseDecided(guarded!, ALLOW_ALL);
  expect(isDisclosed(disclosed), "恒允许的判定下必须拿得到载荷").toBe(true);
  return (disclosed as { payload: RunProjection }).payload;
}

async function pendingRequestId(): Promise<string> {
  return asApp(ORG, async (c) => (await c.query(
    "SELECT pending_permission_request_id FROM agent_runs WHERE org_id=$1 AND id=$2", [ORG, RUN],
  )).rows[0].pending_permission_request_id as string);
}

beforeAll(async () => { await ensureDatabase(); await migrateOnce(); });

beforeEach(async () => {
  await resetOrgs(ORG);
  await seedOrg({ orgId: ORG, projectId: "history-project" });
  await addChatThread({ orgId: ORG, id: "history-thread", projectId: null, visibilityScope: "plenary", createdBy: "history-user" });
  await addChatMessage({ orgId: ORG, id: "history-input", threadId: "history-thread", body: "run", authorId: "history-user" });
  await asApp(ORG, async (c) => {
    await c.query(`INSERT INTO agents(id,org_id,stable_name,name,status,creator_id,created_at,updated_at) VALUES('history-agent',$1,'history-agent','history-agent','enabled','history-user',now(),now())`, [ORG]);
    await c.query(`INSERT INTO agent_versions(id,org_id,agent_id,semantic_label,instruction_digest,instructions,skill_version_ids,model_provider,model_id,tool_policy,creator_id,created_at,published_at) VALUES('history-version',$1,'history-agent','v1',repeat('a',64),'test','{}'::text[],'deep-agent','deep-agent','[]'::jsonb,'history-user',now(),now())`, [ORG]);
    await c.query(`INSERT INTO agent_runs(id,org_id,thread_id,input_message_id,agent_id,agent_version_id,skill_version_ids,model_provider,model_id,status,started_at,lease_epoch,lease_expires_at) VALUES('${RUN}',$1,'history-thread','history-input','history-agent','history-version','[]','deep-agent','deep-agent','running',now()-interval '1 second',2,now()+interval '1 minute')`, [ORG]);
  });
});

it("同一条 run 的裁决历史由服务端记账，跨越两次中断之间的 running 窗口仍然读得到", async () => {
  const repo = new PgAgentRunRepository(db);

  // ── 第一次中断：还没有任何裁决 ────────────────────────────────────────────
  await repo.markAwaitingToolPermission(org, RUN, {
    toolName: "call_skill", argsSummary: "{\"skill_stable_name\":\"webresearch\"}",
    toolCallId: "history-call-1", toolArgsDigest: "a".repeat(64),
  });
  expect(
    (await readProjection(repo)).permissionDecisions,
    "第一次弹窗时裁决数必须是 0——否则界面会在第一次就说「这是第 2 次」",
  ).toEqual({ count: 0, last: null });

  // ── 第一次裁决：「仅本次允许」 ─────────────────────────────────────────────
  const first = await pendingRequestId();
  expect(await repo.decidePermissionRequest(org, RUN, first, "once", "history-user")).toBe(true);
  expect((await readProjection(repo)).permissionDecisions).toEqual({ count: 1, last: "once" });

  // ── 中间那段 running：**前端组件在真实链路上正是在这里被卸载的** ──────────
  //   计数描述的是这条 run 的历史，不是当下有没有待决请求，所以这里必须照样读得到。
  await asApp(ORG, (c) => c.query("UPDATE agent_runs SET status='running' WHERE org_id=$1 AND id=$2", [ORG, RUN]));
  const during = await readProjection(repo);
  expect(during.status).toBe("running");
  expect(during.pendingApproval, "这段窗口里服务端没有待决请求（#3296）").toBeNull();
  expect(
    during.permissionDecisions,
    "#3302 的根因：计数若存在于那个会在此刻被卸载的组件里，它到这里就没了",
  ).toEqual({ count: 1, last: "once" });

  // ── 第二次中断：新的请求身份，但历史必须接着数 ──────────────────────────
  await repo.markAwaitingToolPermission(org, RUN, {
    toolName: "call_skill", argsSummary: "{\"skill_stable_name\":\"datasummary\"}",
    toolCallId: "history-call-2", toolArgsDigest: "b".repeat(64),
  });
  const second = await pendingRequestId();
  expect(second, "第二次中断必须是一个新的请求身份").not.toBe(first);
  const atSecond = await readProjection(repo);
  expect(atSecond.status).toBe("awaiting_tool_permission");
  expect(
    atSecond.permissionDecisions,
    "第二次弹窗要说「这是第 2 次请求授权，上次你选的是仅本次允许」——这两个字段就是那句话的全部事实来源",
  ).toEqual({ count: 1, last: "once" });

  // ── 输了竞态的裁决一次都不许加 ────────────────────────────────────────────
  expect(await repo.decidePermissionRequest(org, RUN, first, "run", "history-user")).toBe(false);
  expect(
    (await readProjection(repo)).permissionDecisions,
    "拿着**过期身份**的那次裁决被拒了，它绝不能把计数推进——显示一个比真实裁决次数大的数字比不显示更糟",
  ).toEqual({ count: 1, last: "once" });

  // ── 第二次裁决：本 run 内都允许 ───────────────────────────────────────────
  expect(await repo.decidePermissionRequest(org, RUN, second, "run", "history-user")).toBe(true);
  expect(
    (await readProjection(repo)).permissionDecisions,
    "记的是用户选的那一档原文，不是折叠给 executor 的 pending_decision（once/run/forever 都折成 approve）",
  ).toEqual({ count: 2, last: "run" });
  const row = await asApp(ORG, async (c) => (await c.query(
    "SELECT pending_decision FROM agent_runs WHERE org_id=$1 AND id=$2", [ORG, RUN],
  )).rows[0] as Record<string, unknown>);
  expect(row.pending_decision, "executor 那一侧的取值不受影响").toBe("approve");
});
