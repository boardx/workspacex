/**
 * issue #4344 —— agent 的记忆工具 `wx_remember` 写进知识图谱，走的是 F17 同一张「记住」确认卡。真实数据库 + 真实 HTTP。
 *
 * 一轮 = 用户消息落库 → agent run 在跑（租约有效）→ deep-agent-service 以内部密钥调 `/internal/agent-runs/:runId/remember/invoke`
 * （这里用 fetch 代替 Python 侧，正文与 `standard_remember.py` 发的逐字同形）→ 回答落库（chat_messages.agent_run_id）。
 * 卡从 getTurnMemory 读（回答下方用户看到的就是它），决定经 actOnMemoryCard（与界面同一条路）。
 *
 * 钉住的事实：
 *   - 卡开在 **run 自己的**会话与消息上；模型多带的 id（sourceMessageId / threadId）是 400，改不了卡的归属；
 *   - 工具在 L1：没有任何授权记录也直接开卡（不弹审批框——卡本身就是人的确认）；run 租约 / 密钥不对照样拒；
 *   - 只开卡、不写：确认前会话与个人空间里都没有这句话；点「记住」⇒ 会话里一条 human / accepted + 个人空间一条（F17 原样）；
 *     点「不用了」⇒ 什么都不写；
 *   - 别人看不到、也动不了这张卡；项目对话里不开卡（长期记忆只在个人对话，F17 / F11 同一条边界）；
 *   - 用户自己说了「记住：…」（前缀入口已开卡）时，工具不开第二张、不改那张卡的字，如实回 card_already_open。
 */
import "reflect-metadata";
import { createHash, randomUUID } from "node:crypto";
import { Module, type INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { RememberOutput } from "@repo/contracts/standard-remember";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { STANDARD_REMEMBER } from "../../src/application/agent-run/standard-remember";
import { ToolExecutionAuthority } from "../../src/application/agent-run/tool-execution-authority";
import { actOnMemoryCard, type MemoryCardDeps } from "../../src/application/knowledge-graph/act-on-memory-card";
import { newKgId } from "../../src/application/knowledge-graph/ids";
import { memoryCardFor } from "../../src/application/knowledge-graph/recall-knowledge";
import { getThreadKnowledge, getTurnMemory } from "../../src/application/knowledge-graph/read-thread-knowledge";
import { toOrgId } from "../../src/domain/org-id";
import { PgAgentRunRepository } from "../../src/infrastructure/agent-run/pg-agent-run-repository";
import { PgParentRunControlReader } from "../../src/infrastructure/agent-run/pg-parent-run-control";
import { PgStandardRemember } from "../../src/infrastructure/agent-run/pg-standard-remember";
import { PgChatRepository } from "../../src/infrastructure/chat/pg-chat-repository";
import { appConfig } from "../../src/infrastructure/db/pg-config";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { CountingDecisionIdFactory } from "../../src/infrastructure/identity/in-memory-session-store";
import { PgIdentityRepository } from "../../src/infrastructure/identity/pg-identity-repository";
import { PgKnowledgeRead } from "../../src/infrastructure/knowledge-graph/pg-knowledge-read";
import { PgKnowledgeRecall } from "../../src/infrastructure/knowledge-graph/pg-knowledge-recall";
import { PgMemoryCard } from "../../src/infrastructure/knowledge-graph/pg-memory-card";
import { StandardRememberController } from "../../src/interface/controllers/standard-remember.controller";
import { addChatMessage, addChatThread } from "../support/chat-db";
import { addOrgMember, addProjectMember, asApp, asOwner, ensureDatabase, migrateOnce, resetOrgs, seedOrg } from "../support/db";

const ORG = "org-kg-i4344-remember";
const ORG_ID = toOrgId(ORG);
const PROJECT = `${ORG}-p`;
const AGENT = `agent-${ORG}`, VERSION = `version-${ORG}`;
const KEY = "remember-test-key";
const T = { mine: "thr-4344-mine", mine2: "thr-4344-mine2", decline: "thr-4344-decline", prefix: "thr-4344-prefix", project: "thr-4344-project", other: "thr-4344-other" };
const GOAL = "用户的目标是今年跑完半马";

let db: PgDatabase;
let app: INestApplication;
let url: string;
let deps: MemoryCardDeps;
let cards: PgMemoryCard;
let previousKey: string | undefined;
let seq = 0;

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  await resetOrgs(ORG);
  const fx = await seedOrg({ orgId: ORG, projectId: PROJECT });
  for (const u of ["u-owner", "u-member"]) {
    await addOrgMember(ORG, u, "consultant", fx.teams.energy!);
    await addProjectMember(ORG, PROJECT, u, "facilitator", null);
  }
  for (const id of [T.mine, T.mine2, T.decline, T.prefix]) await addChatThread({ orgId: ORG, id, projectId: null, visibilityScope: "private", createdBy: "u-owner" });
  await addChatThread({ orgId: ORG, id: T.project, projectId: PROJECT, visibilityScope: "plenary", createdBy: "u-owner" });
  await addChatThread({ orgId: ORG, id: T.other, projectId: null, visibilityScope: "private", createdBy: "u-member" });
  await asApp(ORG, async (c) => {
    await c.query(`INSERT INTO agents(id,org_id,stable_name,name,status,creator_id,created_at,updated_at)
      VALUES($1,$2,'i4344','I4344','enabled','u-owner',now(),now())`, [AGENT, ORG]);
    await c.query(`INSERT INTO agent_versions(id,org_id,agent_id,semantic_label,instruction_digest,instructions,
      skill_version_ids,model_provider,model_id,tool_policy,creator_id,created_at,published_at)
      VALUES($1,$2,$3,'v1',$4,'pinned instructions','{}','test-provider','pinned-model','[]','u-owner',now(),now())`,
    [VERSION, ORG, AGENT, createHash("sha256").update("pinned instructions").digest("hex")]);
  });

  db = new PgDatabase(appConfig());
  cards = new PgMemoryCard(db);
  deps = {
    repo: new PgIdentityRepository(db), ids: new CountingDecisionIdFactory(), chat: new PgChatRepository(db),
    knowledge: new PgKnowledgeRead(db, true), cards, newId: newKgId,
  };
  // 与 kernel.module 同一种组装：真实的 run 授权（租约 / attempt / 分级）；没有任何授权记录——L1 不需要。
  const authority = new ToolExecutionAuthority(new PgParentRunControlReader(db), { readPinnedSkills: async () => [] }, {
    hasGrant: async () => false, grantForRun: async () => {}, grantStanding: async () => {}, revokeAllForRun: async () => {},
    listStanding: async () => [], revokeStanding: async () => false,
  });
  const service = new PgStandardRemember(db, authority, { repo: deps.repo, ids: deps.ids, chat: deps.chat }, cards, new PgAgentRunRepository(db));
  class TestModule {}
  Module({ controllers: [StandardRememberController], providers: [{ provide: STANDARD_REMEMBER, useValue: service }] })(TestModule);
  app = await NestFactory.create(TestModule, { logger: false });
  await app.listen(0, "127.0.0.1");
  url = await app.getUrl();
  previousKey = process.env.DEEP_AGENT_SERVICE_INTERNAL_KEY;
  process.env.DEEP_AGENT_SERVICE_INTERNAL_KEY = KEY;
});

afterAll(async () => {
  await app?.close();
  await db?.close();
  if (previousKey === undefined) delete process.env.DEEP_AGENT_SERVICE_INTERNAL_KEY; else process.env.DEEP_AGENT_SERVICE_INTERNAL_KEY = previousKey;
});

/* ── 夹具 ─────────────────────────────────────────────────────────── */

const sql = <R>(q: string, params: unknown[] = []) => asOwner(async (c) => (await c.query(q, params)).rows as R[]);

/** 用户发一条消息，agent run 开始跑（租约有效）。 */
async function startTurn(threadId: string, text: string, user = "u-owner") {
  const n = String(++seq);
  const msg = `m-4344-${n}`, runId = `run-4344-${n}-${randomUUID()}`;
  await addChatMessage({ orgId: ORG, id: msg, threadId, body: text, authorId: user });
  await asApp(ORG, async (c) => {
    await c.query(`INSERT INTO agent_runs(id,org_id,thread_id,input_message_id,agent_id,agent_version_id,skill_version_ids,model_provider,model_id,
      status,started_at,lease_epoch,lease_expires_at)
      VALUES($1,$2,$3,$4,$5,$6,'[]','test-provider','pinned-model','running',now(),1,now()+interval '10 minutes')`,
    [runId, ORG, threadId, msg, AGENT, VERSION]);
    await c.query(`INSERT INTO agent_run_steps(id,org_id,run_id,seq,kind,status,started_at,ended_at)
      VALUES($1,$2,$3,1,'context_built','succeeded',now(),now())`, [randomUUID(), ORG, runId]);
  });
  return { msg, runId, attemptId: `${runId}:0` };
}

/** 回答落库：chat_messages.agent_run_id 指向这个 run（getTurnMemory 经它找到卡）。 */
async function finishTurn(threadId: string, runId: string) {
  const answerId = `ans-4344-${String(++seq)}`;
  await addChatMessage({ orgId: ORG, id: answerId, threadId, body: "（回答）", authorId: AGENT, authorKind: "agent", agentId: AGENT });
  await asOwner((c) => c.query("UPDATE chat_messages SET agent_run_id = $1 WHERE id = $2", [runId, answerId]));
  return answerId;
}

/** deep-agent-service 发的正文（standard_remember.py `_invoke` 同形）。 */
async function invoke(turn: { runId: string; attemptId: string }, toolArgs: Record<string, unknown>, over: Record<string, unknown> = {}, key = KEY) {
  const res = await fetch(`${url}/internal/agent-runs/${encodeURIComponent(turn.runId)}/remember/invoke`, {
    method: "POST", headers: { "content-type": "application/json", "x-deep-agent-internal-key": key },
    body: JSON.stringify({ orgId: ORG, attemptId: turn.attemptId, leaseEpoch: 1, toolCallId: `call-${String(++seq)}`, toolName: "wx_remember", toolArgs, ...over }),
  });
  return { status: res.status, body: res.status === 200 ? RememberOutput.parse(await res.json()) : null };
}

const cardRows = (runId: string) => sql<{ id: string; thread_id: string; message_id: string; created_by: string; status: string; origin: string; items: { statement: string }[] }>(
  "SELECT id, thread_id, message_id, created_by, status, origin, items FROM kg_memory_cards WHERE org_id = $1 AND run_id = $2", [ORG, runId]);
const liveClaims = (statement: string) => sql<{ id: string; scope_kind: string; scope_id: string; created_by: string; status: string }>(
  "SELECT id, scope_kind, scope_id, created_by, status FROM claims WHERE org_id = $1 AND statement = $2 AND revoked_at IS NULL ORDER BY scope_kind", [ORG, statement]);
async function cardOf(threadId: string, answerId: string, userId = "u-owner") {
  const t = await getTurnMemory(deps, { userId, orgId: ORG_ID, threadId, messageId: answerId });
  if (t.prompt?.type !== "memory_card") throw new Error(`no memory card under ${answerId}: ${JSON.stringify(t.prompt)}`);
  return t.prompt.card;
}
const act = (cardId: string, decision: "accept" | "dismiss", userId = "u-owner") =>
  actOnMemoryCard(deps, { userId, orgId: ORG_ID, actorKind: "human", cardId, decision });

/* ── 用例 ─────────────────────────────────────────────────────────── */

describe("#4344 wx_remember 开 F17 的记住卡", () => {
  it("卡开在 run 自己的会话与消息上；模型多带的 id 改不了归属；用户确认后会话与个人空间各一条，面板读得到", async () => {
    await startTurn(T.mine2, "另一条消息，不在本轮");
    const turn = await startTurn(T.mine, "为什么你没有记忆下来我的目标？");

    // 模型想把卡挂到别的消息 / 会话上：契约不接受任何 id ⇒ 400，什么都没开
    const [elsewhere] = await sql<{ id: string }>("SELECT id FROM chat_messages WHERE thread_id = $1", [T.mine2]);
    expect((await invoke(turn, { statement: GOAL, sourceMessageId: elsewhere!.id })).status).toBe(400);
    expect((await invoke(turn, { statement: GOAL, threadId: T.mine2 })).status).toBe(400);
    expect(await cardRows(turn.runId)).toEqual([]);

    // L1：没有任何授权记录也直接开卡；字不必出自本轮消息（用户在卡上确认）
    const opened = await invoke(turn, { statement: GOAL });
    expect(opened.status).toBe(200);
    expect(opened.body).toMatchObject({ outcome: "card_opened", statement: GOAL, saved: false });
    expect(opened.body!.outcome === "card_opened" && opened.body!.instruction).toContain("不要说「已经记住了」");
    const [row] = await cardRows(turn.runId);
    expect(row).toMatchObject({ thread_id: T.mine, message_id: turn.msg, created_by: "u-owner", status: "open", origin: "agent_tool", items: [{ statement: GOAL }] });

    // 同一轮再调：一轮只出一张，如实回 already_open
    const again = await invoke(turn, { statement: "用户的目标是明年跑全马" });
    expect(again.body).toMatchObject({ outcome: "card_already_open", cardId: row!.id, saved: false });
    expect(await cardRows(turn.runId)).toHaveLength(1);

    // 只开卡、不写：确认前哪里都没有这句话
    expect(await liveClaims(GOAL)).toEqual([]);

    // 回答下方就是这张卡（与用户说「记住：…」时同一种卡）
    const answerId = await finishTurn(T.mine, turn.runId);
    const card = await cardOf(T.mine, answerId);
    expect(card).toEqual({ cardId: row!.id, kind: "remember", state: "open", items: [{ claimId: null, statement: GOAL }] });

    // 用户点「记住」：会话里一条 human / accepted（出处 = 本轮用户消息），个人空间一条（F11 晋升）
    const out = await act(card.cardId, "accept");
    expect(out.card).toMatchObject({ cardId: card.cardId, kind: "remember", state: "done", items: [{ statement: GOAL, claimId: expect.any(String) }] });
    const claims = await liveClaims(GOAL);
    expect(claims).toEqual([
      expect.objectContaining({ scope_kind: "chat_session", scope_id: T.mine, created_by: "human", status: "accepted" }),
      expect.objectContaining({ scope_kind: "personal", scope_id: "u-owner" }),
    ]);
    const [evidence] = await sql<{ message_id: string }>("SELECT message_id FROM claim_message_evidence WHERE claim_id = $1", [claims[0]!.id]);
    expect(evidence!.message_id).toBe(turn.msg);
    // 面板（会话知识）读得到；回答下方变成「已记住」
    expect((await getThreadKnowledge(deps, { userId: "u-owner", orgId: ORG_ID, threadId: T.mine })).claims.map((c) => c.statement)).toContain(GOAL);
    expect((await cardOf(T.mine, answerId)).state).toBe("done");
  });

  it("用户点「不用了」⇒ 卡关掉，会话与个人空间什么都不写", async () => {
    const statement = "用户偏好用英文回答";
    const turn = await startTurn(T.decline, "以后都用英文回答我");
    expect((await invoke(turn, { statement })).body).toMatchObject({ outcome: "card_opened" });
    const answerId = await finishTurn(T.decline, turn.runId);
    const card = await cardOf(T.decline, answerId);
    const out = await act(card.cardId, "dismiss");
    expect(out.card.state).toBe("dismissed");
    expect(out.actionIds).toEqual([]);
    expect(await liveClaims(statement)).toEqual([]);
    expect((await cardRows(turn.runId))[0]!.status).toBe("dismissed");
  });

  it("另一个用户看不到、也动不了这张卡", async () => {
    const statement = "用户的车牌尾号是 7";
    const turn = await startTurn(T.mine, "记一下我的车牌尾号是 7，以后提醒限行");
    expect((await invoke(turn, { statement })).body).toMatchObject({ outcome: "card_opened" });
    const answerId = await finishTurn(T.mine, turn.runId);
    const card = await cardOf(T.mine, answerId);
    await expect(getTurnMemory(deps, { userId: "u-member", orgId: ORG_ID, threadId: T.mine, messageId: answerId })).rejects.toThrow();
    await expect(act(card.cardId, "accept", "u-member")).rejects.toMatchObject({ code: "KG_CARD_NOT_FOUND" });
    await expect(act(card.cardId, "dismiss", "u-member")).rejects.toMatchObject({ code: "KG_CARD_NOT_FOUND" });
    // Agent 身份也不能替人点
    await expect(actOnMemoryCard(deps, { userId: "u-owner", orgId: ORG_ID, actorKind: "agent", cardId: card.cardId, decision: "accept" }))
      .rejects.toMatchObject({ code: "KG_ACTOR_NOT_HUMAN" });
    expect((await cardRows(turn.runId))[0]!.status).toBe("open");
    expect(await liveClaims(statement)).toEqual([]);
  });

  it("项目对话里不开卡（长期记忆只在个人对话）；不是对话创建者发起的一轮也不开——两者都是具体原因码", async () => {
    const own = await startTurn(T.project, "记住我的目标");
    expect((await invoke(own, { statement: GOAL })).body).toMatchObject({ outcome: "refused", code: "not_personal_thread", saved: false });
    const member = await startTurn(T.project, "帮我记住我的目标", "u-member");
    expect((await invoke(member, { statement: GOAL })).body).toMatchObject({ outcome: "refused", code: "not_thread_owner", saved: false });
    expect([...await cardRows(own.runId), ...await cardRows(member.runId)]).toEqual([]);
  });

  it("用户自己说了「记住：…」（前缀入口已开卡）⇒ 工具不开第二张、不改那张卡的字", async () => {
    const text = "记住：我喜欢中文回答";
    const turn = await startTurn(T.prefix, text);
    const note = await memoryCardFor(new PgKnowledgeRecall(db), cards, { orgId: ORG_ID, userId: "u-owner", threadId: T.prefix, runId: turn.runId, messageId: turn.msg, text }, () => undefined);
    expect(note).toContain("确认卡");
    const [prefixCard] = await cardRows(turn.runId);
    expect(prefixCard).toMatchObject({ origin: "user_message", items: [{ statement: "我喜欢中文回答" }] });
    expect((await invoke(turn, { statement: "用户喜欢中文回答" })).body).toMatchObject({ outcome: "card_already_open", cardId: prefixCard!.id });
    expect(await cardRows(turn.runId)).toEqual([prefixCard]);
  });

  it("run 授权不成立 ⇒ 403；密钥不对 ⇒ 401；都没有开卡", async () => {
    const turn = await startTurn(T.mine, "记住我的目标");
    expect((await invoke(turn, { statement: GOAL }, {}, "wrong-key-of-same-size")).status).toBe(401);
    expect((await invoke(turn, { statement: GOAL }, { leaseEpoch: 2 })).status).toBe(403);
    expect((await invoke(turn, { statement: GOAL }, { attemptId: `${turn.runId}:9` })).status).toBe(403);
    expect((await invoke({ runId: `run-missing-${randomUUID()}`, attemptId: "x:0" }, { statement: GOAL })).status).toBe(403);
    // 租约过期（worker 掉线 / 已被回收）：同一个 attempt 不能再开卡
    await asApp(ORG, (c) => c.query("UPDATE agent_runs SET lease_expires_at = now() - interval '1 minute' WHERE id = $1", [turn.runId]));
    expect((await invoke(turn, { statement: GOAL })).status).toBe(403);
    expect(await cardRows(turn.runId)).toEqual([]);
  });

  it("数据库这一侧：agent 入口只开记住卡；前缀入口仍要求字出自本条消息（这一条没有放宽）", async () => {
    const turn = await startTurn(T.mine2, "今天天气不错");
    const base = { cardId: newKgId("card"), threadId: T.mine2, runId: turn.runId, messageId: turn.msg, requesterUserId: "u-owner" };
    expect(await cards.open(ORG_ID, { ...base, kind: "remember", statement: GOAL })).toMatchObject({ outcome: "not_from_message" });
    await expect(cards.open(ORG_ID, { ...base, kind: "forget", origin: "agent_tool", target: "天气", claimIds: [] })).rejects.toThrow(/KG_INVALID_REQUEST/);
    expect(await cardRows(turn.runId)).toEqual([]);
  });
});
