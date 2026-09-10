/**
 * issue #3296 —— 裁决之后，权威读不得再回一个已失效的 `pendingApproval`。
 *
 * # 这条用例为什么存在
 *
 * `decidePermissionRequest` 在 approve / edit / deny 三个分支上**刻意保留**
 * `pending_tool_name` / `pending_args_summary` / `pending_permission_request_id` /
 * `pending_interrupt`（executor 的 `claimQueued` 要读它们恢复那次工具调用），而
 * `readRun` 此前判 `pendingApproval` 的唯一依据是 `pending_tool_name === null`。
 * 两条各自都对的规则乘起来 = 裁决之后一直到 run 落终态，`GET /agent-runs/:id`
 * 都在宣称「有一个待决请求」，回的正是**刚被裁决掉的那一个**。
 *
 * 实测（run 34416935580 证据包，B6 用例 trace.zip）：裁决后连续 25 次权威读、
 * 持续 11.5 秒，`status=running` 而 `pendingApproval.toolName=confirm_task_intent`。
 *
 * # 判据是行为，不是痕迹
 *
 * 本文件不判「代码里有没有那个 status 门」。它走真库、真的建一次待决请求、真的裁决，
 * 然后在**裁决后的每一个非 `awaiting_tool_permission` 状态上**读权威投影。
 *
 * ⚠ 第三条断言（原始列仍在）与前两条同等重要：修的是投影不是存储。少了它，
 * 「把那几列一并清掉」会让前两条变绿而**悄悄毁掉 executor 的恢复路径**——
 * 那是一次典型的「全绿但空转」。
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

const ORG = "org-pending-approval-residue";
const org = toOrgId(ORG);
const RUN = "residue-run";

const db: DatabasePort = {
  withTenant: (id, fn) => asApp(id, (c) => fn({
    query: async (sql, params = []) => ({ rows: (await c.query(sql, [...params])).rows }),
  })),
  withoutTenant: async () => { throw new Error("tenant required"); },
  close: async () => {},
};

/**
 * 权威读的载荷——与 `GET /agent-runs/:id` 走的是**同一条**投影 + 同一道可见性守卫。
 *
 * `Guarded` 的载荷放在模块私有的 WeakMap 里，只有 `discloseDecided` 取得到；本用例判的是
 * 读模型而不是可见性，所以用一个恒允许的判定过闸——但仍然真的过一遍闸，不绕开它。
 */
const ALLOW_ALL = { allowed: true, decisionId: "decision-3296" } as unknown as PermissionDecision;

async function readProjection(repo: PgAgentRunRepository): Promise<RunProjection> {
  const guarded = await repo.readRun(org, RUN);
  expect(guarded, "这条 run 必须读得到——读不到的话下面每条断言都无从判起").not.toBeNull();
  const disclosed = discloseDecided(guarded!, ALLOW_ALL);
  expect(isDisclosed(disclosed), "恒允许的判定下必须拿得到载荷").toBe(true);
  return (disclosed as { payload: RunProjection }).payload;
}

beforeAll(async () => { await ensureDatabase(); await migrateOnce(); });

beforeEach(async () => {
  await resetOrgs(ORG);
  await seedOrg({ orgId: ORG, projectId: "residue-project" });
  await addChatThread({ orgId: ORG, id: "residue-thread", projectId: null, visibilityScope: "plenary", createdBy: "residue-user" });
  await addChatMessage({ orgId: ORG, id: "residue-input", threadId: "residue-thread", body: "run", authorId: "residue-user" });
  await asApp(ORG, async (c) => {
    await c.query(`INSERT INTO agents(id,org_id,stable_name,name,status,creator_id,created_at,updated_at) VALUES('residue-agent',$1,'residue-agent','residue-agent','enabled','residue-user',now(),now())`, [ORG]);
    await c.query(`INSERT INTO agent_versions(id,org_id,agent_id,semantic_label,instruction_digest,instructions,skill_version_ids,model_provider,model_id,tool_policy,creator_id,created_at,published_at) VALUES('residue-version',$1,'residue-agent','v1',repeat('a',64),'test','{}'::text[],'deep-agent','deep-agent','[]'::jsonb,'residue-user',now(),now())`, [ORG]);
    await c.query(`INSERT INTO agent_runs(id,org_id,thread_id,input_message_id,agent_id,agent_version_id,skill_version_ids,model_provider,model_id,status,started_at,lease_epoch,lease_expires_at) VALUES('${RUN}',$1,'residue-thread','residue-input','residue-agent','residue-version','[]','deep-agent','deep-agent','running',now()-interval '1 second',2,now()+interval '1 minute')`, [ORG]);
  });
});

it("approve 之后权威读不再回已裁决的 pendingApproval，而恢复所需的原始列一列不少", async () => {
  const repo = new PgAgentRunRepository(db);

  await repo.markAwaitingToolPermission(org, RUN, {
    toolName: "confirm_task_intent", argsSummary: "{\"requestId\":\"q\"}",
    toolCallId: "residue-call", toolArgsDigest: "a".repeat(64),
  });
  const requestId = await asApp(ORG, async (c) => (await c.query(
    "SELECT pending_permission_request_id FROM agent_runs WHERE org_id=$1 AND id=$2", [ORG, RUN],
  )).rows[0].pending_permission_request_id as string);

  // ── 前提：中断的时候，权威读**必须**给得出这个待决请求 ─────────────────────
  // 少了它，下面「裁决后为 null」可能只是因为它从头到尾就没出现过（恒真门）。
  expect((await readProjection(repo)).status).toBe("awaiting_tool_permission");
  expect(
    (await readProjection(repo)).pendingApproval,
    "中断态下权威读必须回一个非空 pendingApproval——否则下面那条「裁决后为 null」不成其为判据",
  ).toMatchObject({ toolName: "confirm_task_intent", permissionRequestId: requestId });

  // ── 裁决 ────────────────────────────────────────────────────────────────
  // `"once"` 就是 approve 在这一层的线上取值——`decideAgentRun` 逐字这么转
  // （`input.decision === "approve" ? "once" : input.decision`）。这里照真实调用方写，
  // 不另造一个只在测试里存在的取值。
  expect(await repo.decidePermissionRequest(org, RUN, requestId, "once", "residue-user")).toBe(true);

  // ① 裁决直后（queued）：服务端此刻没有任何待决请求，权威读必须照实说。
  expect((await readProjection(repo)).status).toBe("queued");
  expect(
    (await readProjection(repo)).pendingApproval,
    "#3244 ①/#3186 的根因：approve 之后权威读仍在回那个**已经被裁决掉的**请求，"
    + "界面据此把提交过的确认卡片再渲染一次；用户照它再点一次，decideAgentRun 先验 status "
    + "已不是 awaiting_tool_permission，直接抛冲突 = 「点了没反应」",
  ).toBeNull();

  // ② executor 领走之后（running）：这正是实测里那 11.5 秒的形状。
  await asApp(ORG, (c) => c.query("UPDATE agent_runs SET status='running' WHERE org_id=$1 AND id=$2", [ORG, RUN]));
  expect((await readProjection(repo)).status).toBe("running");
  expect((await readProjection(repo)).pendingApproval, "run 在跑的时候不可能有待决请求").toBeNull();

  // ③ 终态之后：残留此前一路活到 succeeded。
  //    走 running → writeback_pending → succeeded 这条**合法**的边——库上的状态迁移触发器
  //    不许 running 直接跳 succeeded，硬跳会红在触发器上而不是红在本条判据上。
  await asApp(ORG, (c) => c.query("UPDATE agent_runs SET status='writeback_pending' WHERE org_id=$1 AND id=$2", [ORG, RUN]));
  expect((await readProjection(repo)).pendingApproval, "写回阶段的 run 不可能还在等人确认").toBeNull();
  // `succeeded` 还要求助手回复已经落库（触发器：cannot become succeeded before its
  // assistant message is durable）——照真实写回顺序补上那条消息，不绕过不变量。
  await asApp(ORG, (c) => c.query(
    `INSERT INTO chat_messages (id,org_id,thread_id,author_kind,author_id,agent_id,body,agent_run_id)
     VALUES ('residue-reply',$1,'residue-thread','agent','residue-user','residue-agent','done',$2)`,
    [ORG, RUN],
  ));
  await asApp(ORG, (c) => c.query("UPDATE agent_runs SET status='succeeded', ended_at=now() WHERE org_id=$1 AND id=$2", [ORG, RUN]));
  expect((await readProjection(repo)).status).toBe("succeeded");
  expect((await readProjection(repo)).pendingApproval, "已经结束的 run 不可能还在等人确认").toBeNull();

  // ④ 修的是投影，不是存储：恢复那次工具调用所需的原始列必须**一列不少**。
  //    这条挡的是「把列清掉」那种让①②③一起变绿、同时悄悄毁掉 claimQueued 的假修法。
  const row = await asApp(ORG, async (c) => (await c.query(
    "SELECT pending_tool_name, pending_args_summary, pending_permission_request_id, pending_decision FROM agent_runs WHERE org_id=$1 AND id=$2",
    [ORG, RUN],
  )).rows[0] as Record<string, unknown>);
  expect(row, "approve 分支绝不允许清掉 executor 恢复所需的这几列").toMatchObject({
    pending_tool_name: "confirm_task_intent",
    pending_permission_request_id: requestId,
    pending_decision: "approve",
  });
});

it("reject 之后既清列也清投影（既有行为不回退）", async () => {
  const repo = new PgAgentRunRepository(db);
  await repo.markAwaitingToolPermission(org, RUN, {
    toolName: "confirm_task_intent", argsSummary: "{}", toolCallId: "residue-call-2", toolArgsDigest: "b".repeat(64),
  });
  const requestId = await asApp(ORG, async (c) => (await c.query(
    "SELECT pending_permission_request_id FROM agent_runs WHERE org_id=$1 AND id=$2", [ORG, RUN],
  )).rows[0].pending_permission_request_id as string);
  expect(await repo.decidePermissionRequest(org, RUN, requestId, "reject", "residue-user")).toBe(true);
  expect((await readProjection(repo)).status).toBe("failed");
  expect((await readProjection(repo)).pendingApproval).toBeNull();
});
