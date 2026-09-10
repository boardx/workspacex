/**
 * issue #3310 ① / ② / ③ —— 「这一条中断已经被裁决过了」必须是**服务端**读得到的事实，
 * 而且它要带着**用户按下确认的那一份参数**。
 *
 * # 这条用例为什么存在（真实链路，不是界面痕迹）
 *
 * 人类实测（devapp `6df8148cc`，`deploy=success`）：模型复述「为**舟山**马鞍岛的房产中介
 * 生成用户画像」，用户点「改假设」把舟山改成中山并确认。此后 ①卡片没消失、仍说「等待服务端
 * 确认此请求」；②卡片里还是舟山；③开始生成画布时整张卡片消失。
 *
 * 三条同源：那张卡片「现在该画成什么样」此前由两个**会在正确时刻丢失**的活信号决定
 * （宿主的 `pendingRunId` + 组件自己的 `fallbackWasPending`），而真正拥有这条事实的是
 * 这一行数据。#3302 刚因同一机理修过授权次数，修法同样是把事实交回服务端。
 *
 * # 判据是行为
 *
 * 走真库，真的走一遍「中断 → edit 裁决 → 回到 running → 下一次中断」，在每一段上读权威
 * 投影。特别是**中间那段 running**（前端组件在真实链路上正是在这里第一次挂载）与**下一次
 * 中断**（③ 里"生成画布"的那一刻）：这两段上留痕都必须读得到，且里面是
 * 中山，不是舟山。
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

const ORG = "org-resolved-approval-3310";
const org = toOrgId(ORG);
const RUN = "resolved-approval-run";

const db: DatabasePort = {
  withTenant: (id, fn) => asApp(id, (c) => fn({
    query: async (sql, params = []) => ({ rows: (await c.query(sql, [...params])).rows }),
  })),
  withoutTenant: async () => { throw new Error("tenant required"); },
  close: async () => {},
};

const ALLOW_ALL = { allowed: true, decisionId: "decision-3310" } as unknown as PermissionDecision;

/** 人类那一条的原始提案与编辑值，逐字保留「舟山 → 中山」。 */
const PROPOSED = {
  toolName: "confirm_task_intent" as const,
  args: { requestId: "intent-1", understanding: "为舟山马鞍岛的一位房产中介生成用户画像", assumptions: ["服务区域是舟山马鞍岛"] },
};
const EDITED_ARGS_JSON = JSON.stringify({
  understanding: "为中山马鞍岛的一位房产中介生成用户画像",
  assumptions: ["服务区域是中山马鞍岛"],
});

async function readProjection(repo: PgAgentRunRepository): Promise<RunProjection> {
  const guarded = await repo.readRun(org, RUN);
  expect(guarded, "这条 run 必须读得到").not.toBeNull();
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
  await seedOrg({ orgId: ORG, projectId: "resolved-project" });
  await addChatThread({ orgId: ORG, id: "resolved-thread", projectId: null, visibilityScope: "plenary", createdBy: "resolved-user" });
  await addChatMessage({ orgId: ORG, id: "resolved-input", threadId: "resolved-thread", body: "run", authorId: "resolved-user" });
  await asApp(ORG, async (c) => {
    await c.query(`INSERT INTO agents(id,org_id,stable_name,name,status,creator_id,created_at,updated_at) VALUES('resolved-agent',$1,'resolved-agent','resolved-agent','enabled','resolved-user',now(),now())`, [ORG]);
    await c.query(`INSERT INTO agent_versions(id,org_id,agent_id,semantic_label,instruction_digest,instructions,skill_version_ids,model_provider,model_id,tool_policy,creator_id,created_at,published_at) VALUES('resolved-version',$1,'resolved-agent','v1',repeat('a',64),'test','{}'::text[],'deep-agent','deep-agent','[]'::jsonb,'resolved-user',now(),now())`, [ORG]);
    await c.query(`INSERT INTO agent_runs(id,org_id,thread_id,input_message_id,agent_id,agent_version_id,skill_version_ids,model_provider,model_id,status,started_at,lease_epoch,lease_expires_at) VALUES('${RUN}',$1,'resolved-thread','resolved-input','resolved-agent','resolved-version','[]','deep-agent','deep-agent','running',now()-interval '1 second',2,now()+interval '1 minute')`, [ORG]);
  });
});

it("edit 裁决之后，权威读把这一条画成「已裁决」并带上被采纳的那一份参数（舟山→中山）", async () => {
  const repo = new PgAgentRunRepository(db);

  // ── 待决中：还没有任何裁决，留痕必须是空 ──────────────────────────────────
  await repo.markAwaitingToolPermission(org, RUN, {
    toolName: PROPOSED.toolName, argsSummary: null, interrupt: PROPOSED,
    toolCallId: "intent-call-1", toolArgsDigest: "a".repeat(64),
  });
  const pendingView = await readProjection(repo);
  expect(pendingView.pendingApproval?.interrupt).toEqual(PROPOSED);
  expect(
    pendingView.resolvedApprovals,
    "还在等这一条时它不是「已裁决」——否则界面会在用户还没点之前就把它画成历史记录",
  ).toEqual([]);

  // ── 用户改「舟山→中山」并确认 ─────────────────────────────────────────────
  const requestId = await pendingRequestId();
  expect(await repo.decidePermissionRequest(org, RUN, requestId, "edit", "resolved-user", EDITED_ARGS_JSON)).toBe(true);

  // ── 中间那段 running：前端内联组件在真实链路上**第一次**挂载正是在这里 ─────
  await asApp(ORG, (c) => c.query("UPDATE agent_runs SET status='running' WHERE org_id=$1 AND id=$2", [ORG, RUN]));
  const during = await readProjection(repo);
  expect(during.pendingApproval, "这段窗口里服务端没有待决请求（#3296）").toBeNull();
  expect(during.resolvedApprovals).toHaveLength(1);
  expect(
    during.resolvedApprovals[0]?.permissionRequestId,
    "#3310 ①：服务端必须能说出「刚才那一条已经被裁决了」，否则界面只能猜，猜的结果就是那句「等待服务端确认此请求」",
  ).toBe(requestId);
  expect(during.resolvedApprovals[0]?.decision).toBe("edit");
  expect(
    JSON.stringify(during.resolvedApprovals[0]?.interrupt),
    "#3310 ②：记录要画的是用户按下确认的那一份",
  ).toContain("中山马鞍岛");
  expect(JSON.stringify(during.resolvedApprovals[0]?.interrupt)).not.toContain("舟山");
  expect(
    (during.resolvedApprovals[0]?.interrupt as { args: { requestId: string } }).args.requestId,
    "身份不许被编辑改掉——界面靠它认出「就是我刚才确认的那一条」",
  ).toBe("intent-1");

  // ── ③「开始生成画布」：同一条 run 上的下一次授权请求 ───────────────────────
  await repo.markAwaitingToolPermission(org, RUN, {
    toolName: "wx_canvas_update", argsSummary: "canvas args",
    toolCallId: "canvas-call", toolArgsDigest: "b".repeat(64),
  });
  const atCanvas = await readProjection(repo);
  expect(atCanvas.pendingApproval?.toolName).toBe("wx_canvas_update");
  /*
   * #3310 ③ 的判据就在这里，而且它**推翻过本 PR 的第一版修法**：那一版从 `pending_*`
   * 反推「已裁决」，而 `markAwaitingToolPermission` 刚刚就地覆盖了 `pending_interrupt`
   * ——第一张确认卡在这一刻会失去它的全部事实来源，退回去画模型最初提的舟山。
   * 留痕必须是 append-only 的，且在下一次中断之后逐字不变。
   */
  expect(atCanvas.resolvedApprovals).toHaveLength(1);
  expect(atCanvas.resolvedApprovals[0]?.permissionRequestId).toBe(requestId);
  expect(
    JSON.stringify(atCanvas.resolvedApprovals[0]?.interrupt),
    "生成画布那一刻，第一张卡片仍然必须画成用户确认的中山那一份",
  ).toContain("中山马鞍岛");
  expect(JSON.stringify(atCanvas.resolvedApprovals[0]?.interrupt)).not.toContain("舟山");
});

it("reject 也是一次真实发生过的裁决：pending_* 被清掉（#2999 C 组）不等于「没发生过」，留痕照记", async () => {
  const repo = new PgAgentRunRepository(db);
  await repo.markAwaitingToolPermission(org, RUN, {
    toolName: PROPOSED.toolName, argsSummary: null, interrupt: PROPOSED,
    toolCallId: "intent-call-2", toolArgsDigest: "c".repeat(64),
  });
  const requestId = await pendingRequestId();
  expect(await repo.decidePermissionRequest(org, RUN, requestId, "reject", "resolved-user")).toBe(true);
  const view = await readProjection(repo);
  expect(view.status).toBe("failed");
  expect(view.pendingApproval).toBeNull();
  // reject 也确实发生过，留痕照记（清 pending_* 是给 executor 看的，不该连"发生过"一起抹掉）。
  expect(view.resolvedApprovals).toHaveLength(1);
  expect(view.resolvedApprovals[0]?.decision).toBe("reject");
});

it("从来没被裁决过的中断不留痕：这正是「等待服务端确认此请求」仍然为真的那个窗口", async () => {
  const repo = new PgAgentRunRepository(db);
  await repo.markAwaitingToolPermission(org, RUN, {
    toolName: PROPOSED.toolName, argsSummary: null, interrupt: PROPOSED,
    toolCallId: "intent-call-3", toolArgsDigest: "d".repeat(64),
  });
  // executor 把 run 领回去继续跑（没有任何人裁决过）——这正是「等待服务端确认此请求」
  // 那句话仍然为真的那个窗口，不许被当成已裁决。
  // 状态机不允许 awaiting_tool_permission 直接跳 running（触发器拦），照真实边走 queued。
  await asApp(ORG, async (c) => {
    await c.query("UPDATE agent_runs SET status='queued' WHERE org_id=$1 AND id=$2", [ORG, RUN]);
    await c.query("UPDATE agent_runs SET status='running' WHERE org_id=$1 AND id=$2", [ORG, RUN]);
  });
  const view = await readProjection(repo);
  expect(view.permissionDecisions.count).toBe(0);
  expect(view.resolvedApprovals).toEqual([]);
});
