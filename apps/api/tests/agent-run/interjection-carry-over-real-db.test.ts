/**
 * issue #3405（#3399 的治因项）—— **未采纳的插话必须真的进下一轮的模型输入。**
 *
 * ## 判据为什么落在这里
 *
 * #3399 的缺陷形状是「显示了一句状态、然后什么都没发生」：触发器给未应用的插话记一条
 * `not_applied` 事件，全仓没有任何一处把那句话带进下一轮。所以本测试的断言**不**落在
 * 「队列里有一条记录」或「接口返回了某个状态」——那两种断言在缺陷下照样是绿的。
 * 断言落在 `ModelCallInput.user`：**模型这一轮真的看到了那句话的逐字原文**
 * （同 #3346 那次「模型请求体里真的有图的字节」的先例）。
 *
 * ## 为什么是真库 + 真受理链路，不是内存替身
 *
 * 「带不带」的判定住在 DB 触发器里（migration `20260911060000` 的那个 `CASE`），
 * 投递走的是 chat 受理的唯一入口 `acceptHumanMessage` + 真实
 * `PgChatMessageCommandRepository`。用替身跑这条链，等于在一个**产不出缺陷形状**的
 * 剧本里断言（本仓已九次「全绿但空转」），触发器写错一个字都不会红。
 *
 * 只有 `ModelCallPort` 是替身——它是取证探针本身（要捕获输入），不是被测对象。
 */
import { randomUUID } from "node:crypto";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AgentRunExecutor } from "../../src/infrastructure/agent-run/agent-run-executor";
import { AcceptMessageCarryOverDelivery } from "../../src/infrastructure/agent-run/accept-message-carry-over-delivery";
import { PgInterjectionStore } from "../../src/infrastructure/agent-run/pg-interjection-store";
import { DATABASE_PORT, type DatabasePort } from "../../src/application/ports/database.port";
import { AGENT_RUN_STORE, MODEL_CALL_PORT, type AgentRunStore, type ModelCallInput, type ModelCallPort } from "../../src/application/agent-run/ports";
import { IDENTITY_REPOSITORY, DECISION_ID_FACTORY, type IdentityRepository, type DecisionIdFactory } from "../../src/application/identity/ports";
import { CHAT_REPOSITORY, type ChatRepository } from "../../src/application/chat/ports";
import {
  CHAT_MESSAGE_COMMAND_REPOSITORY, ENABLED_SKILL_VERSION_READER, PUBLISHED_AGENT_READER, THREAD_MOUNTED_SKILL_READER,
  type ChatMessageCommandRepository, type EnabledSkillVersionReader, type PublishedAgentReader, type ThreadMountedSkillReader,
} from "../../src/application/chat/message-command-ports";
import { LOGGER_PORT, type LoggerPort } from "../../src/application/ports/logger.port";
import { TOOL_PERMISSION_GRANT_STORE, type ToolPermissionGrantStore } from "../../src/application/agent-run/tool-permission-grants";
import { THREAD_TITLE_MODEL_CONFIG, type ThreadTitleModelConfig } from "../../src/application/chat/generate-thread-title";
import { toOrgId } from "../../src/domain/org-id";
import { addOrgMember, addProjectMember, asApp, ensureDatabase, migrateOnce, resetOrgs, seedOrg } from "../support/db";
import { addChatMessage, addChatThread } from "../support/chat-db";

process.env.KERNEL_ALLOW_TEST_PRINCIPAL = "1";
process.env.KERNEL_QUIET = "1";

const ORG = "org-3405-carry-over";
const PROJECT = "proj-3405-carry-over";
const THREAD = "thread-3405-carry-over";
const ACTOR = "u-3405-carry-over";
const AGENT = "agent-3405-carry-over";
const AGENT_VERSION = "agent-version-3405-carry-over-v1";
/** 用户那句被静默丢弃的话。断言逐字找它，不找任何改写过的版本。 */
const INTERJECTION_TEXT = "总结成一个 pdf";

let app: NestExpressApplication;
let db: DatabasePort;
let runs: AgentRunStore;
let interjections: PgInterjectionStore;
let delivery: AcceptMessageCarryOverDelivery;
/** 取证探针：每一次真实进入模型的输入。 */
let modelInputs: ModelCallInput[] = [];

const capturingModel: ModelCallPort = {
  async complete(input: ModelCallInput) { modelInputs.push(input); return { text: "好的，已处理。" }; },
};

function executor(): AgentRunExecutor {
  return new AgentRunExecutor(
    runs, capturingModel, app.get<LoggerPort>(LOGGER_PORT), /* autostart */ false,
    undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined,
    undefined, undefined, undefined, undefined,
    interjections, undefined, undefined, undefined, undefined,
    delivery,
  );
}

async function addPublishedAgentVersion(): Promise<void> {
  await asApp(ORG, async (c) => {
    await c.query(`INSERT INTO agents (id,org_id,stable_name,name,status,creator_id,created_at,updated_at)
      VALUES ($1,$2,$3,$4,'enabled',$5,now(),now()) ON CONFLICT DO NOTHING`, [AGENT, ORG, AGENT, AGENT, ACTOR]);
    await c.query(`INSERT INTO agent_versions
      (id,org_id,agent_id,semantic_label,instruction_digest,instructions,skill_version_ids,
       model_provider,model_id,tool_policy,creator_id,created_at,published_at)
      VALUES ($1,$2,$3,$4,$5,$6,'{}'::text[],'chat','test-model','[]'::jsonb,$7,now(),now())`,
    [AGENT_VERSION, ORG, AGENT, AGENT_VERSION, "d".repeat(64), "测试用 agent。", ACTOR]);
    await c.query("UPDATE agents SET published_version_id=$1 WHERE id=$2 AND org_id=$3", [AGENT_VERSION, AGENT, ORG]);
  });
}

/** 一条**正在跑**的 run（插话只有 `running` 时才收）。`carriedOverFrom` 非空 ⇒ 这本身就是带入轮。 */
const inputMessageOf = new Map<string, string>();
async function startRun(body: string, carriedOverFrom: string | null = null): Promise<string> {
  const messageId = `msg-${randomUUID()}`;
  const runId = `run-${randomUUID()}`;
  await addChatMessage({ orgId: ORG, id: messageId, threadId: THREAD, body, authorId: ACTOR });
  await asApp(ORG, async (c) => {
    if (carriedOverFrom !== null) {
      await c.query("UPDATE chat_messages SET carried_over_from_run_id=$3 WHERE org_id=$1 AND id=$2", [ORG, messageId, carriedOverFrom]);
    }
    await c.query(`INSERT INTO agent_runs
      (id,org_id,thread_id,input_message_id,agent_id,agent_version_id,skill_version_ids,model_provider,model_id,status,started_at)
      VALUES ($1,$2,$3,$4,$5,$6,'[]','chat','test-model','running',now())`,
    [runId, ORG, THREAD, messageId, AGENT, AGENT_VERSION]);
  });
  inputMessageOf.set(runId, messageId);
  return runId;
}

/**
 * 生产上 `succeeded` 只有一条路：running → writeback_pending → `commitWriteback`
 * （助手消息落库那一刻才允许转 succeeded，DB 触发器强制）。走真的那一条，不绕过。
 */
async function settleSucceeded(runId: string): Promise<void> {
  await asApp(ORG, (c) => c.query("UPDATE agent_runs SET status='writeback_pending' WHERE org_id=$1 AND id=$2", [ORG, runId]));
  await runs.commitWriteback(toOrgId(ORG), {
    runId, threadId: THREAD, inputMessageId: inputMessageOf.get(runId)!, agentId: AGENT,
    text: "这一轮的回答。", startedAt: new Date().toISOString(), endedAt: new Date().toISOString(),
    outputDigest: "e".repeat(64),
  });
}

/** 用户主动取消：触发器要求 `cancel_requested_at` 非空才允许转 `cancelled`。 */
async function settleCancelledByUser(runId: string): Promise<void> {
  await asApp(ORG, async (c) => {
    await c.query("UPDATE agent_runs SET cancel_requested_at=now() WHERE org_id=$1 AND id=$2", [ORG, runId]);
    await c.query("UPDATE agent_runs SET status='cancelled', ended_at=now() WHERE org_id=$1 AND id=$2", [ORG, runId]);
  });
}

async function publicStatuses(runId: string): Promise<readonly (readonly [string, string])[]> {
  return (await interjections.listPublic(toOrgId(ORG), runId)).map((i) => [i.text, i.status] as const);
}

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  delete process.env.KERNEL_AGENT_RUN_AUTOSTART;
  const { createApp } = await import("../../src/main");
  app = await createApp();
  await app.init();
  db = app.get<DatabasePort>(DATABASE_PORT);
  runs = app.get<AgentRunStore>(AGENT_RUN_STORE);
  interjections = new PgInterjectionStore(db);
  delivery = new AcceptMessageCarryOverDelivery(
    app.get<IdentityRepository>(IDENTITY_REPOSITORY), app.get<DecisionIdFactory>(DECISION_ID_FACTORY),
    app.get<ChatRepository>(CHAT_REPOSITORY), app.get<ChatMessageCommandRepository>(CHAT_MESSAGE_COMMAND_REPOSITORY),
    app.get<PublishedAgentReader>(PUBLISHED_AGENT_READER), app.get<ThreadMountedSkillReader>(THREAD_MOUNTED_SKILL_READER),
    app.get<EnabledSkillVersionReader>(ENABLED_SKILL_VERSION_READER), app.get<ModelCallPort>(MODEL_CALL_PORT),
    app.get<ThreadTitleModelConfig>(THREAD_TITLE_MODEL_CONFIG), app.get<LoggerPort>(LOGGER_PORT),
  );
}, 180_000);

afterAll(async () => { await app?.close(); });

beforeEach(async () => {
  modelInputs = [];
  await resetOrgs(ORG);
  await seedOrg({ orgId: ORG, projectId: PROJECT });
  await addOrgMember(ORG, ACTOR, "consultant", null);
  await addProjectMember(ORG, PROJECT, ACTOR, "facilitator", null);
  await addChatThread({ orgId: ORG, id: THREAD, projectId: PROJECT, visibilityScope: "plenary", createdBy: ACTOR, title: "带入下一轮" });
  await addPublishedAgentVersion();
});

describe("issue #3405 未采纳的插话带入下一轮", () => {
  it("① run 成功结束时还没应用的插话，逐字进了下一轮的模型输入", async () => {
    const runA = await startRun("帮我分析一下这份数据");
    await interjections.submit(toOrgId(ORG), runA, {
      interjectionId: "itj-a", text: INTERJECTION_TEXT, receivedAt: new Date().toISOString(),
    });
    await settleSucceeded(runA);

    await executor().tick(toOrgId(ORG));

    // ⚠ 判据在这里：模型**真的看到了**那句话，不是"队列里有一条记录"。
    const seenByModel = modelInputs.map((input) => input.user);
    expect(seenByModel.some((user) => user.includes(INTERJECTION_TEXT)),
      `模型输入里找不到那句话。实际收到的 user 字段：${JSON.stringify(seenByModel)}`).toBe(true);

    // 用户看得见去向，且回指真正执行它的那一轮。
    expect(await publicStatuses(runA)).toEqual([[INTERJECTION_TEXT, "carried_over"]]);
    const carried = (await interjections.listPublic(toOrgId(ORG), runA))[0]!;
    expect(carried.carriedOverRunId).not.toBeNull();

    // 约束⑤：**授权不被静默继承。** 只断言「id 不一样」是弱的——真正会红的判据是：
    // 来源 run 上一条真实的 run 级授权，在带入起的那一轮上 `hasGrant` 必须为 false，
    // 下一次同类 L2 调用因此重新走四选一，而不是沿用旧任务性质下给出的那个「是」。
    const grants = app.get<ToolPermissionGrantStore>(TOOL_PERMISSION_GRANT_STORE);
    await grants.grantForRun(toOrgId(ORG), runA, "call_skill");
    expect(await grants.hasGrant(toOrgId(ORG), runA, "call_skill")).toBe(true);
    expect(await grants.hasGrant(toOrgId(ORG), carried.carriedOverRunId!, "call_skill")).toBe(false);
  });

  it("② 用户主动取消本轮之后，绝不自动执行那句话", async () => {
    const runA = await startRun("帮我分析一下这份数据");
    await interjections.submit(toOrgId(ORG), runA, {
      interjectionId: "itj-c", text: INTERJECTION_TEXT, receivedAt: new Date().toISOString(),
    });
    await settleCancelledByUser(runA);

    await executor().tick(toOrgId(ORG));

    // 他刚表达了停止意图。一次模型调用都不该发生，那句话一个字都不该进模型。
    expect(modelInputs.map((input) => input.user)).toEqual([]);
    expect(await publicStatuses(runA)).toEqual([[INTERJECTION_TEXT, "not_applied"]]);
    const after = await asApp(ORG, (c) => c.query<{ n: string }>(
      "SELECT count(*) AS n FROM agent_runs WHERE org_id=$1 AND id<>$2", [ORG, runA]));
    expect(after.rows[0]!.n, "取消之后不许凭空多出一轮 run").toBe("0");
  });

  it("③ 深度上限 ≤ 1：带入轮自己的未应用插话不再自动带入", async () => {
    const carryOverRun = await startRun("上一轮带进来的那句话", "run-origin-3405");
    await interjections.submit(toOrgId(ORG), carryOverRun, {
      interjectionId: "itj-d", text: "再改一下标题", receivedAt: new Date().toISOString(),
    });
    await settleSucceeded(carryOverRun);

    await executor().tick(toOrgId(ORG));

    expect(modelInputs.map((input) => input.user)).toEqual([]);
    expect(await publicStatuses(carryOverRun)).toEqual([["再改一下标题", "not_applied"]]);
  });

  it("④ 一轮里的多条插话合并成一条消息、起一轮，而不是放大成 N 轮", async () => {
    const runA = await startRun("帮我分析一下这份数据");
    await interjections.submit(toOrgId(ORG), runA, { interjectionId: "itj-1", text: INTERJECTION_TEXT, receivedAt: new Date().toISOString() });
    await interjections.submit(toOrgId(ORG), runA, { interjectionId: "itj-2", text: "顺便加个封面", receivedAt: new Date().toISOString() });
    await settleSucceeded(runA);

    await executor().tick(toOrgId(ORG));

    const seenByModel = modelInputs.map((input) => input.user);
    expect(seenByModel).toHaveLength(1);
    expect(seenByModel[0]).toContain(INTERJECTION_TEXT);
    expect(seenByModel[0]).toContain("顺便加个封面");
    // 收到时刻正序，不是任意序。
    expect(seenByModel[0]!.indexOf(INTERJECTION_TEXT)).toBeLessThan(seenByModel[0]!.indexOf("顺便加个封面"));
  });
});
