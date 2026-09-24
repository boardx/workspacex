/**
 * Phase 18 F17 —— 对话里「记住 / 忘掉」确认卡（uc-18-6 A / B，V1 / V2；I-15 / I-17 / I-18），真实数据库。
 *
 * 一轮 = 用户消息落库 → 执行器开卡（memoryCardFor，与 execute-run 同一个入口）→ 抽取流水线真实跑一轮（回环模型）
 * → 回答落库（chat_messages.agent_run_id 指向这个 run）。卡从 getTurnMemory 读（回答下方用户看到的就是它），
 * 决定经 actOnMemoryCard（应用层 + 接口层）→ kg_act_on_memory_card；应用层挡在前面的守卫，这里另外直接调数据库函数再验一遍。
 */
import { createHash } from "node:crypto";
import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from "@nestjs/common";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { executeQueuedRuns, type ExecuteAgentRunDeps } from "../../src/application/agent-run/execute-run";
import type { ModelCallInput } from "../../src/application/agent-run/ports";
import { writeBackPendingRuns } from "../../src/application/agent-run/writeback";
import { actOnMemoryCard, type MemoryCardDeps } from "../../src/application/knowledge-graph/act-on-memory-card";
import { applyHumanAction } from "../../src/application/knowledge-graph/apply-human-action";
import { runExtractionTick, type ExtractionDeps } from "../../src/application/knowledge-graph/extract-message-knowledge";
import { newKgId } from "../../src/application/knowledge-graph/ids";
import { knowledgeMemoryFor, memoryCardFor } from "../../src/application/knowledge-graph/recall-knowledge";
import { getThreadKnowledge, getTurnMemory } from "../../src/application/knowledge-graph/read-thread-knowledge";
import { detectMemoryIntent, forgetMatches } from "../../src/domain/knowledge-graph/memory-intent";
import type { RecallClaim } from "../../src/domain/knowledge-graph/recall";
import { toOrgId } from "../../src/domain/org-id";
import { PgAgentRunRepository } from "../../src/infrastructure/agent-run/pg-agent-run-repository";
import { PgChatRepository } from "../../src/infrastructure/chat/pg-chat-repository";
import { appConfig } from "../../src/infrastructure/db/pg-config";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { CountingDecisionIdFactory } from "../../src/infrastructure/identity/in-memory-session-store";
import { PgIdentityRepository } from "../../src/infrastructure/identity/pg-identity-repository";
import { PgHumanAction } from "../../src/infrastructure/knowledge-graph/pg-human-action";
import { PgKnowledgeRead } from "../../src/infrastructure/knowledge-graph/pg-knowledge-read";
import { PgKnowledgeRecall } from "../../src/infrastructure/knowledge-graph/pg-knowledge-recall";
import { PgMemoryCard } from "../../src/infrastructure/knowledge-graph/pg-memory-card";
import type { DatabasePort } from "../../src/application/ports/database.port";
import { PgPromotion } from "../../src/infrastructure/knowledge-graph/pg-promotion";
import { KnowledgeGraphController } from "../../src/interface/controllers/knowledge-graph.controller";
import { addChatMessage, addChatThread } from "../support/chat-db";
import { addOrgMember, addProjectMember, asApp, asOwner, ensureDatabase, migrateOnce, resetOrgs, seedOrg } from "../support/db";
import { enableExtraction, extractionDeps, loopbackModel } from "./kg-extraction-fixtures";

const ORG = "org-kg-f17-card";
const ORG_ID = toOrgId(ORG);
const PERSONAL = ["r1", "r2", "r3", "r4", "f", "z", "amb", "g1", "g2", "g3", "d", "e", "c", "fr", "priv", "run", "u1", "u2", "mv", "rv", "dx", "db", "da"] as const;
const T = Object.fromEntries([...PERSONAL, "s"].map((k) => [k, `thr-f17-${k}`])) as Record<(typeof PERSONAL)[number] | "s", string>;

const reply = (entity: string, kind: "person" | "organization" | "project", statement: string, claimKind: "fact" | "decision" = "fact") => JSON.stringify({
  entities: [{ name: entity, kind, aliases: [] }],
  claims: [{ statement, kind: claimKind, confidence: 0.9, about: [entity], decidedBy: null, quote: statement }],
});
const CONTACT = "客户A的对接人是王经理";
const APPROVE = "王经理负责审批合同";
const MIGRATE = "李四负责迁移演练";
const BUDGET = "赵六负责预算";
const MODEL = loopbackModel([
  [CONTACT, reply("客户A", "organization", CONTACT)],
  [APPROVE, reply("王经理", "person", APPROVE)],
  [MIGRATE, reply("李四", "person", MIGRATE)],
  [BUDGET, reply("赵六", "person", BUDGET)],
  ["赵六的报销", reply("赵六", "person", "赵六负责报销")],
  ["项目A 定在 9/29 上线", reply("项目A", "project", "项目A 9/29 上线", "decision")],
  ["项目A 上线改到 10/1", reply("项目A", "project", "项目A 上线改到 10/1", "decision")],
  ["项目Z 定在 9/29 发布", reply("项目Z", "project", "项目Z 9/29 发布", "decision")],
  ["项目Z 发布改到 10/1", reply("项目Z", "project", "项目Z 发布改到 10/1", "decision")],
]);

const MEMBER_THREAD = "thr-f17-member";
let db: PgDatabase;
let deps: MemoryCardDeps;
let recall: PgKnowledgeRecall;
let cards: PgMemoryCard;
let xdeps: ExtractionDeps;
let ctl: KnowledgeGraphController;
let seq = 0;

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  await resetOrgs(ORG);
  const fx = await seedOrg({ orgId: ORG, projectId: `${ORG}-p` });
  await enableExtraction();
  for (const u of ["u-owner", "u-member"]) {
    await addOrgMember(ORG, u, "consultant", fx.teams.energy!);
    await addProjectMember(ORG, `${ORG}-p`, u, "facilitator", null);
  }
  for (const k of PERSONAL) await addChatThread({ orgId: ORG, id: T[k], projectId: null, visibilityScope: "private", createdBy: "u-owner" });
  await addChatThread({ orgId: ORG, id: T.s, projectId: `${ORG}-p`, visibilityScope: "plenary", createdBy: "u-owner" });
  await addChatThread({ orgId: ORG, id: MEMBER_THREAD, projectId: null, visibilityScope: "private", createdBy: "u-member" });
  db = new PgDatabase(appConfig());
  recall = new PgKnowledgeRecall(db);
  cards = new PgMemoryCard(db);
  deps = {
    repo: new PgIdentityRepository(db), ids: new CountingDecisionIdFactory(), chat: new PgChatRepository(db),
    knowledge: new PgKnowledgeRead(db), cards, newId: newKgId,
  };
  ctl = new KnowledgeGraphController(deps.repo, deps.ids, deps.chat, deps.knowledge, new PgHumanAction(db), new PgPromotion(db), cards);
  xdeps = extractionDeps(db, MODEL.model, ORG);
});
afterAll(async () => { await db.close(); });

/* ── 夹具 ─────────────────────────────────────────────────────────── */

const sql = <R>(q: string, params: unknown[] = []) => asOwner(async (c) => (await c.query(q, params)).rows as R[]);
const logs: string[] = [];

/** 只说一句（不经执行器）：抽取照常跑。 */
async function say(threadId: string, body: string, author = "u-owner"): Promise<string> {
  const id = `m-f17-${String(++seq)}`;
  await addChatMessage({ orgId: ORG, id, threadId, body, authorId: author });
  await extractUntilDone(id);
  return id;
}

/** 抽取一批有上限：一直跑到这条消息离开队列（前面几轮的回答也在排队）。 */
async function extractUntilDone(messageId: string): Promise<void> {
  for (let i = 0; i < 20; i += 1) {
    await runExtractionTick(xdeps);
    if ((await sql("SELECT 1 FROM kg_extraction_queue WHERE message_id = $1", [messageId])).length === 0) return;
  }
  throw new Error(`message ${messageId} still queued for extraction`);
}

/** 完整一轮：用户消息 → 执行器开卡（与 execute-run 同一个入口）→ 抽取 → 回答落库。 */
async function turn(threadId: string, text: string, user = "u-owner") {
  const n = String(++seq);
  const msg = `m-f17-${n}`;
  const runId = `run-f17-${n}`;
  await addChatMessage({ orgId: ORG, id: msg, threadId, body: text, authorId: user });
  const note = await memoryCardFor(recall, cards, { orgId: ORG_ID, userId: user, threadId, runId, messageId: msg, text }, (m, d) => {
    logs.push(`${m}: ${String(d.detail)}`);
  });
  await extractUntilDone(msg);
  const answerId = `ans-f17-${n}`;
  await addChatMessage({ orgId: ORG, id: answerId, threadId, body: "（回答）", authorId: "agent-1", authorKind: "agent", agentId: "agent-1" });
  await asOwner((c) => c.query("UPDATE chat_messages SET agent_run_id = $1 WHERE id = $2", [runId, answerId]));
  return { msg, runId, note, answerId };
}

const read = (threadId: string, userId = "u-owner") => getThreadKnowledge(deps, { userId, orgId: ORG_ID, threadId });
const turnMemory = (threadId: string, messageId: string, userId = "u-owner") => getTurnMemory(deps, { userId, orgId: ORG_ID, threadId, messageId });
async function cardOf(threadId: string, answerId: string, userId = "u-owner") {
  const t = await turnMemory(threadId, answerId, userId);
  if (t.prompt?.type !== "memory_card") throw new Error(`no memory card under ${answerId}: ${JSON.stringify(t.prompt)}`);
  return t.prompt.card;
}
const act = (cardId: string, over: Partial<Parameters<typeof actOnMemoryCard>[1]> = {}) =>
  actOnMemoryCard(deps, { userId: "u-owner", orgId: ORG_ID, actorKind: "human", cardId, decision: "accept", ...over });
const rawAct = (user: string | null, p: Record<string, unknown>) => asApp(ORG, async (c) => {
  if (user !== null) await c.query("SELECT set_config('app.current_user_id', $1, true)", [user]);
  return c.query("SELECT kg_act_on_memory_card($1::jsonb) AS r", [JSON.stringify({ action_id: newKgId("act"), decision: "accept", actor_kind: "human", ...p })]);
});
const cardRow = async (cardId: string) => (await sql<{ status: string; acted_by: string | null; action_ids: string[] }>(
  "SELECT status, acted_by, action_ids FROM kg_memory_cards WHERE id = $1", [cardId]))[0]!;
const claim = async (id: string) => (await sql<{ status: string; revoked: boolean; revocation_reason: string | null; reviewed_by: string | null; created_by: string; scope_kind: string; scope_id: string; statement: string }>(
  "SELECT status, revoked_at IS NOT NULL AS revoked, revocation_reason, reviewed_by, created_by, scope_kind, scope_id, statement FROM claims WHERE id = $1", [id]))[0]!;
const rememberedRow = async (cardId: string) => (await sql<{ remembered_claim_id: string | null; remembered_personal_id: string | null; claim_created: boolean; personal_created: boolean }>(
  "SELECT remembered_claim_id, remembered_personal_id, claim_created, personal_created FROM kg_memory_cards WHERE id = $1", [cardId]))[0]!;
const personalLive = (statement: string) => sql<{ id: string }>(
  "SELECT id FROM claims WHERE org_id = $1 AND scope_kind = 'personal' AND scope_id = 'u-owner' AND statement = $2 AND revoked_at IS NULL", [ORG, statement]);
const memoryFor = (threadId: string, query: string) =>
  knowledgeMemoryFor(recall, { orgId: ORG_ID, userId: "u-owner", threadId, query, runId: `run-f17-q${String(++seq)}` }, () => undefined);
const threadClaimBy = async (threadId: string, statement: string) => {
  const c = (await read(threadId)).claims.find((x) => x.statement === statement);
  if (c === undefined) throw new Error(`no live claim「${statement}」in ${threadId}`);
  return c;
};

/* ── 意图识别（纯函数）：宁可漏，不可误 ─────────────────────────── */

describe("F17: 意图识别", () => {
  it("明确的「记住」：冒号 / 逗号，或「请记住」「帮我记住」", () => {
    expect(detectMemoryIntent("记住：客户A的对接人是王经理")).toEqual({ kind: "remember", statement: "客户A的对接人是王经理" });
    expect(detectMemoryIntent("  记住, 周报每周五交。")).toEqual({ kind: "remember", statement: "周报每周五交" });
    expect(detectMemoryIntent("帮我记住客户B预算50万")).toEqual({ kind: "remember", statement: "客户B预算50万" });
    expect(detectMemoryIntent("请记住：合同由法务审")).toEqual({ kind: "remember", statement: "合同由法务审" });
    expect(detectMemoryIntent("记一下：下周二开会")).toEqual({ kind: "remember", statement: "下周二开会" });
  });

  it("明确的「忘掉」：去掉「关于 / 那条」这类修饰", () => {
    expect(detectMemoryIntent("忘掉王经理那条")).toEqual({ kind: "forget", target: "王经理" });
    expect(detectMemoryIntent("忘掉关于王经理的那条")).toEqual({ kind: "forget", target: "王经理" });
    expect(detectMemoryIntent("别再提李四的事了")).toEqual({ kind: "forget", target: "李四" });
    expect(detectMemoryIntent("忘记：赵六负责预算")).toEqual({ kind: "forget", target: "赵六负责预算" });
    expect(detectMemoryIntent("不要再提张三")).toEqual({ kind: "forget", target: "张三" });
    expect(detectMemoryIntent("别再记张三的电话")).toEqual({ kind: "forget", target: "张三的电话" });
    expect(detectMemoryIntent("别再提：提醒的事")).toEqual({ kind: "forget", target: "提醒" });
    expect(detectMemoryIntent("记住：几乎每天都下雨")).toEqual({ kind: "remember", statement: "几乎每天都下雨" });
  });

  it("不确定 ⇒ 不出卡（A1）：问句、指代、没有分隔的「忘记 / 忘了」、没有前缀", () => {
    for (const text of [
      "这个挺重要的吧？", "记住：这个挺重要的吧？", "记住了吗", "记住了", "我记住了", "把这个记下来", "这个很重要",
      "刚才那个说错了", "记住：客户A的对接人是王经理吗？", "记住：这个", "记住：上面说的方案", "忘掉那个", "忘掉刚才那条", "忘记密码怎么办", "忘了带钥匙",
      "你记得关于客户A的什么", "请记住", "忘掉", "记住：好", "别忘了明天开会", "",
      // B1：「别再提 / 别再记」后面接的是别的词（提醒 / 提交 / 提示 / 记错 / 记得 / 记录…）
      "别再提醒我明天的会议", "不要再记错客户A的对接人", "别再提醒我喝水了", "别再记录日志", "不要再提交了", "别再提示我",
      "别再提起这事", "不要再提到预算", "别再提出新需求", "不要再记得他", "别再记性这么差", "别再提前下班", "不要再提供报价",
      // 「别再提这件事」：说的是忘掉，但忘掉哪件——指代，不猜
      "别再提这件事",
      // N3：没有问号的问句
      "记住：客户A的对接人是王经理吗", "记住：王五喜欢喝茶。对吗", "请记住我的名字叫什么", "记住：谁负责预算",
      "记住：每周交几份报告", "记住：项目A 是不是 9/29 上线", "记住：王五喜欢喝茶，对不对", "忘掉谁负责预算那条",
    ]) expect(detectMemoryIntent(text), text).toBeNull();
  });

  it("忘掉卡的匹配：目标词元至少一半出现在这条里，按相关度排，最多 20 条", () => {
    const c = (id: string, statement: string): RecallClaim => ({ id, statement, kind: "fact", triState: "pending", saidAt: null, scope: "chat_session" });
    const claims = [c("a", "王经理负责审批合同"), c("b", "李四负责迁移演练"), c("c", "客户A的对接人是王经理"), c("d", "王五负责经营")];
    expect(forgetMatches("王经理", claims).map((x) => x.id)).toEqual(["a", "c"]);
    expect(forgetMatches("张三", claims)).toEqual([]);
    // 只沾一点边（2/7 的词元）不列：列出来默认就是勾上的
    expect(forgetMatches("王经理的审批流程", [c("e", "张经理负责审批")])).toEqual([]);
    expect(forgetMatches("", claims)).toEqual([]);
    expect(forgetMatches("经理", Array.from({ length: 30 }, (_, i) => c(`x${String(i).padStart(2, "0")}`, `经理 ${String(i)}`)))).toHaveLength(20);
  });
});

/* ── V1 记住 ──────────────────────────────────────────────────────── */

describe("F17: 记住（V1）", () => {
  it("说「记住：…」⇒ 回答下出记住卡（可改字）、还没写任何记忆；改字后点「记住」⇒ 本人确认 + 记到个人空间，新的个人会话召回得到", async () => {
    const t = await turn(T.r1, `记住：${CONTACT}`);
    expect(t.note).toContain("确认卡");
    expect(t.note).toContain("不要说「已经记住了」");
    const card = await cardOf(T.r1, t.answerId);
    expect(card).toEqual({ cardId: expect.any(String), kind: "remember", items: [{ claimId: null, statement: CONTACT }], state: "open" });
    // Agent 只出卡：个人空间里还什么都没有
    expect(await personalLive(CONTACT)).toEqual([]);

    const edited = `${CONTACT}，电话找他`;
    const out = await ctl.memoryCard({ userId: "u-owner", orgId: ORG } as never, card.cardId, { decision: "accept", editedStatement: `  ${edited} ` });
    expect(out.card).toEqual({ cardId: card.cardId, kind: "remember", state: "done", items: [{ claimId: expect.any(String), statement: edited }] });
    expect(out.actionIds).toHaveLength(2);
    const l0 = await claim(out.card.items[0]!.claimId!);
    expect(l0).toMatchObject({ status: "accepted", created_by: "human", reviewed_by: "u-owner", scope_kind: "chat_session", scope_id: T.r1, statement: edited });
    const [ev] = await sql<{ message_id: string }>("SELECT message_id FROM claim_message_evidence WHERE claim_id = $1 AND stance = 'supporting'", [out.card.items[0]!.claimId]);
    expect(ev!.message_id).toBe(t.msg);
    const [l1] = await personalLive(edited);
    expect(l1).toBeDefined();
    const [derived] = await sql<{ dst_id: string }>("SELECT dst_id FROM ontology_edges WHERE src_id = $1 AND relation = 'derived_from' AND status = 'active'", [l1!.id]);
    expect(derived!.dst_id).toBe(out.card.items[0]!.claimId);
    const audits = await sql<{ actor_kind: string; actor_id: string; action_type: string; scope_kind: string }>(
      "SELECT actor_kind, actor_id, action_type, scope_kind FROM ontology_actions WHERE id = ANY($1::text[]) ORDER BY id", [out.actionIds]);
    expect(audits).toEqual([
      { actor_kind: "human", actor_id: "u-owner", action_type: "rememberClaim", scope_kind: "chat_session" },
      { actor_kind: "human", actor_id: "u-owner", action_type: "promoteToPersonal", scope_kind: "personal" },
    ]);
    expect(await cardRow(card.cardId)).toMatchObject({ status: "done", acted_by: "u-owner" });
    // 回答下再读：「已记住」
    expect((await cardOf(T.r1, t.answerId)).state).toBe("done");
    // V1：新的个人会话里问，召回得到这一条（来自个人空间）
    const memory = await memoryFor(T.r2, "客户A的对接人是谁？");
    expect(memory).toContain(edited);
    expect(memory).toContain("来自个人空间知识");
  });

  it("本会话里早就说过同一句 ⇒ 卡指着那一条；不改字点「记住」⇒ 确认并晋升它，不另建；长期记忆里已有同一句 ⇒ 合并，不复制第二份", async () => {
    await say(T.r3, CONTACT);
    const said = await threadClaimBy(T.r3, CONTACT);
    expect(said.status).toBe("proposed");
    const t = await turn(T.r3, `记住：${CONTACT}`);
    const card = await cardOf(T.r3, t.answerId);
    expect(card.items).toEqual([{ claimId: said.id, statement: CONTACT }]);
    const out = await act(card.cardId);
    // 用的是早就有的那条 ⇒ 不给撤销（撤了会删掉用户原来就有的那条）
    expect(out.card.items).toEqual([{ claimId: null, statement: CONTACT }]);
    expect((await cardOf(T.r3, t.answerId)).items).toEqual([{ claimId: null, statement: CONTACT }]);
    expect((await rememberedRow(card.cardId)).remembered_claim_id).toBe(said.id);
    expect(await claim(said.id)).toMatchObject({ status: "accepted", reviewed_by: "u-owner", created_by: "model" });
    // 没有另建一条 human 结论（这句「记住：…」本身被抽出来的那条是模型提出的，照常留着）
    expect((await read(T.r3)).claims.filter((c) => c.statement === CONTACT && c.createdBy === "human")).toEqual([]);
    expect(await personalLive(CONTACT)).toHaveLength(1);

    // 另一个会话里又说一次「记住：同一句」：长期记忆里只留一条（合并，derived_from 连到两个来源）
    const t2 = await turn(T.r4, `记住：${CONTACT}`);
    const c2 = await cardOf(T.r4, t2.answerId);
    const out2 = await act(c2.cardId);
    expect(out2.card.items[0]!.claimId).toBeNull();
    // 这句「记住：…」本身被抽成了同一句话 ⇒ 用那一条，不另建
    const r4 = await rememberedRow(c2.cardId);
    expect(r4).toMatchObject({ claim_created: false, personal_created: false });
    expect(await claim(r4.remembered_claim_id!)).toMatchObject({ created_by: "model", status: "accepted" });
    const l1 = await personalLive(CONTACT);
    expect(l1).toHaveLength(1);
    const sources = await sql<{ dst_id: string }>("SELECT dst_id FROM ontology_edges WHERE src_id = $1 AND relation = 'derived_from' AND status = 'active' ORDER BY dst_id", [l1[0]!.id]);
    expect(sources.map((s) => s.dst_id).sort()).toEqual([said.id, r4.remembered_claim_id].sort());
  });

  it("不改字、这句话也还没被抽出来 ⇒ 以本人身份新建一条（human / accepted）", async () => {
    const t = await turn(T.d, "记住：王五的生日是 3/8");
    const card = await cardOf(T.d, t.answerId);
    expect(card.items).toEqual([{ claimId: null, statement: "王五的生日是 3/8" }]);
    const out = await act(card.cardId);
    expect(await claim(out.card.items[0]!.claimId!)).toMatchObject({ created_by: "human", status: "accepted", statement: "王五的生日是 3/8" });
    expect(await personalLive("王五的生日是 3/8")).toHaveLength(1);
  });
});

/* ── V2 忘掉 ──────────────────────────────────────────────────────── */

describe("F17: 忘掉（V2）", () => {
  it("说「忘掉 …」⇒ 列出本会话与本人长期记忆里相关的条目（默认全选）；取消勾选一条后点「忘掉」⇒ 选中的失效、L1 同步失效，下一轮不再召回", async () => {
    await say(T.f, APPROVE);
    await say(T.f, MIGRATE);
    const approve = await threadClaimBy(T.f, APPROVE);
    const [editedL1] = await personalLive(`${CONTACT}，电话找他`);
    const [contactL1] = await personalLive(CONTACT);
    const before = await memoryFor(T.f, "王经理");
    expect(before).toContain(APPROVE);
    expect(before).toContain(CONTACT);

    const t = await turn(T.f, "忘掉王经理那条");
    expect(t.note).toContain("默认全选");
    const card = await cardOf(T.f, t.answerId);
    expect(card.kind).toBe("forget");
    expect(card.state).toBe("open");
    expect(card.items.map((i) => i.claimId).sort()).toEqual([approve.id, contactL1!.id, editedL1!.id].sort());
    expect(card.items.map((i) => i.statement)).not.toContain(MIGRATE);

    const out = await ctl.memoryCard({ userId: "u-owner", orgId: ORG } as never, card.cardId, { decision: "accept", claimIds: [approve.id, contactL1!.id] });
    expect(out.card.state).toBe("done");
    expect(out.card.items.map((i) => i.claimId).sort()).toEqual([approve.id, contactL1!.id].sort());
    expect(await claim(approve.id)).toMatchObject({ status: "superseded", revoked: true, revocation_reason: "user_forgot" });
    expect(await claim(contactL1!.id)).toMatchObject({ status: "superseded", revoked: true, revocation_reason: "user_forgot" });
    expect(await claim(editedL1!.id)).toMatchObject({ revoked: false });
    const audits = await sql<{ scope_kind: string; actor_id: string; payload: { claims: { id: string }[] } }>(
      "SELECT scope_kind, actor_id, payload FROM ontology_actions WHERE id = ANY($1::text[]) ORDER BY scope_kind", [out.actionIds]);
    expect(audits.map((a) => [a.scope_kind, a.actor_id])).toEqual([["chat_session", "u-owner"], ["personal", "u-owner"]]);
    // 会话里的审计不带个人空间的 id
    expect(JSON.stringify(audits[0]!.payload)).not.toContain(contactL1!.id);

    // 下一轮：忘掉的不再召回，没勾的那条还在
    const after = await memoryFor(T.f, "王经理");
    expect(after).not.toContain(APPROVE);
    expect(after).not.toMatch(new RegExp(`${CONTACT}（`));
    expect(after).toContain(`${CONTACT}，电话找他`);
    // 在会话里忘掉 L0 ⇒ 由它晋升出去的 L1 副本一起失效（F07）
    await say(T.fr, MIGRATE);
    const m = await threadClaimBy(T.fr, MIGRATE);
    await applyHumanAction({ ...deps, actions: new PgHumanAction(db), newId: newKgId }, {
      userId: "u-owner", orgId: ORG_ID, threadId: T.fr, basedOnRevision: (await read(T.fr)).revision, action: { type: "confirmClaim", claimId: m.id },
    });
    await asApp(ORG, async (c) => {
      await c.query("SELECT set_config('app.current_user_id', 'u-owner', true)");
      await c.query("SELECT kg_promote_claim($1::jsonb)", [JSON.stringify({ action_id: newKgId("act"), thread_id: T.fr, claim_id: m.id })]);
    });
    expect(await personalLive(MIGRATE)).toHaveLength(1);
    const t2 = await turn(T.fr, "忘掉李四那条");
    const c2 = await cardOf(T.fr, t2.answerId);
    expect(c2.items.map((i) => i.claimId)).toEqual([m.id]);
    await act(c2.cardId);
    expect(await personalLive(MIGRATE)).toEqual([]);
  });

  it("「忘掉 …」一条也没匹配到 ⇒ 不出卡，让模型照实说「没找到相关的记忆」（A2）", async () => {
    const t = await turn(T.z, "忘掉张三那条");
    expect(t.note).toContain("没找到相关的记忆");
    expect((await turnMemory(T.z, t.answerId)).prompt).toBeNull();
    expect(await sql("SELECT id FROM kg_memory_cards WHERE run_id = $1", [t.runId])).toEqual([]);
  });

  it("意图不确定 ⇒ 不出卡、不给模型任何说明、一行都不写", async () => {
    for (const text of ["这个挺重要的吧？", "把这个记下来", "忘记密码怎么办"]) {
      const t = await turn(T.amb, text);
      expect(t.note, text).toBeNull();
      expect((await turnMemory(T.amb, t.answerId)).prompt, text).toBeNull();
      expect(await sql("SELECT id FROM kg_memory_cards WHERE run_id = $1", [t.runId])).toEqual([]);
    }
  });
});

/* ── 守卫 ─────────────────────────────────────────────────────────── */

describe("F17: 守卫", () => {
  it("Agent 身份直调 actOnMemoryCard ⇒ KG_ACTOR_NOT_HUMAN；绕过应用层直调数据库（模型身份 / 没有登录用户）同样拒；卡还开着", async () => {
    const t = await turn(T.g3, "记住：周报每周五交");
    const card = await cardOf(T.g3, t.answerId);
    await expect(act(card.cardId, { actorKind: "agent" })).rejects.toMatchObject({ code: "KG_ACTOR_NOT_HUMAN" });
    await expect(rawAct("u-owner", { card_id: card.cardId, actor_kind: "model" })).rejects.toThrow(/KG_ACTOR_NOT_HUMAN/);
    await expect(rawAct("u-owner", { card_id: card.cardId, actor_kind: "agent" })).rejects.toThrow(/KG_ACTOR_NOT_HUMAN/);
    await expect(rawAct("u-owner", { card_id: card.cardId, actor_kind: null })).rejects.toThrow(/KG_ACTOR_NOT_HUMAN/);
    await expect(rawAct(null, { card_id: card.cardId })).rejects.toThrow(/KG_ACTOR_NOT_HUMAN/);
    expect(await cardRow(card.cardId)).toMatchObject({ status: "open", acted_by: null });
    expect(await personalLive("周报每周五交")).toEqual([]);
  });

  it("卡片过期：条目在出卡之后被忘掉 ⇒ 回答下显示「过期」，点击 ⇒ KG_CARD_STALE（HTTP 409），其余条目一条不动", async () => {
    await say(T.g1, BUDGET);
    await say(T.g1, "赵六的报销也归他");
    const b = await threadClaimBy(T.g1, BUDGET);
    const t = await turn(T.g1, "忘掉赵六");
    const card = await cardOf(T.g1, t.answerId);
    expect(card.items.map((i) => i.statement).sort()).toEqual([BUDGET, "赵六负责报销"].sort());
    await applyHumanAction({ ...deps, actions: new PgHumanAction(db), newId: newKgId }, {
      userId: "u-owner", orgId: ORG_ID, threadId: T.g1, basedOnRevision: (await read(T.g1)).revision, action: { type: "revokeClaim", claimId: b.id },
    });
    expect((await cardOf(T.g1, t.answerId)).state).toBe("stale");
    await expect(ctl.memoryCard({ userId: "u-owner", orgId: ORG } as never, card.cardId, { decision: "accept" })).rejects.toBeInstanceOf(ConflictException);
    await expect(act(card.cardId)).rejects.toMatchObject({ code: "KG_CARD_STALE" });
    const others = card.items.filter((i) => i.claimId !== b.id);
    for (const o of others) expect((await claim(o.claimId!)).revoked).toBe(false);
    expect(await cardRow(card.cardId)).toMatchObject({ status: "open" });
  });

  it("卡片过期：条目的说法在出卡之后变了 ⇒ stale；卡上没有的 id ⇒ stale；什么都没选 ⇒ 400", async () => {
    await say(T.g2, APPROVE);
    const a = await threadClaimBy(T.g2, APPROVE);
    const t = await turn(T.g2, "忘掉王经理");
    const card = await cardOf(T.g2, t.answerId);
    // 个人线程：本人长期记忆里提到王经理的那条也列出来
    expect(card.items.map((i) => i.claimId)).toContain(a.id);
    expect(card.items.length).toBeGreaterThan(1);
    await expect(act(card.cardId, { claimIds: ["clm-not-on-card"] })).rejects.toMatchObject({ code: "KG_CARD_STALE" });
    await expect(ctl.memoryCard({ userId: "u-owner", orgId: ORG } as never, card.cardId, { decision: "accept", claimIds: [] })).rejects.toBeInstanceOf(BadRequestException);
    await expect(rawAct("u-owner", { card_id: card.cardId, claim_ids: [] })).rejects.toThrow(/KG_INVALID_REQUEST/);
    await asOwner((c) => c.query("UPDATE claims SET statement = '王经理不再负责审批' WHERE id = $1", [a.id]));
    expect((await cardOf(T.g2, t.answerId)).state).toBe("stale");
    await expect(act(card.cardId)).rejects.toMatchObject({ code: "KG_CARD_STALE" });
    // 整张卡回滚：没变的那几条也一条不动
    for (const i of card.items) expect((await claim(i.claimId!)).revoked).toBe(false);
  });

  it("点过一次（done / dismissed）再点 ⇒ KG_CARD_STALE；「不用了」不写任何记忆", async () => {
    const t = await turn(T.e, "记住：年会定在 12/20");
    const card = await cardOf(T.e, t.answerId);
    const actionsBefore = await sql<{ n: string }>("SELECT count(*) AS n FROM ontology_actions WHERE org_id = $1", [ORG]);
    const out = await act(card.cardId, { decision: "dismiss" });
    expect(out).toEqual({ card: { ...card, state: "dismissed" }, actionIds: [] });
    expect((await cardOf(T.e, t.answerId)).state).toBe("dismissed");
    expect(await sql<{ n: string }>("SELECT count(*) AS n FROM ontology_actions WHERE org_id = $1", [ORG])).toEqual(actionsBefore);
    await expect(act(card.cardId)).rejects.toMatchObject({ code: "KG_CARD_STALE" });
    expect(await personalLive("年会定在 12/20")).toEqual([]);
  });

  it("并发：双击「记住」⇒ 恰好一次生效，另一次 KG_CARD_STALE；长期记忆里只有一条", async () => {
    const t = await turn(T.d, "记住：王五喜欢喝茶");
    const card = await cardOf(T.d, t.answerId);
    const results = await Promise.allSettled([act(card.cardId), act(card.cardId)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect((results.find((r) => r.status === "rejected") as PromiseRejectedResult).reason).toMatchObject({ code: "KG_CARD_STALE" });
    expect(await personalLive("王五喜欢喝茶")).toHaveLength(1);
    expect((await read(T.d)).claims.filter((c) => c.statement === "王五喜欢喝茶")).toHaveLength(1);
  });

  it("冻结的组织：开不了卡（对话照常，只记日志），点卡 ⇒ KG_ORG_FROZEN；卡还开着", async () => {
    const t0 = await turn(T.g3, "记住：季度目标是 500 万");
    const card = await cardOf(T.g3, t0.answerId);
    await asOwner((q) => q.query("UPDATE organizations SET status = 'disabled', disabled_at = now(), retention_until = now() + interval '30 days' WHERE id = $1", [ORG]));
    try {
      await expect(rawAct("u-owner", { card_id: card.cardId })).rejects.toThrow(/KG_ORG_FROZEN/);
      // 「不用了」只改卡片本身，也一样拒（不是靠晋升那一步兜底）
      await expect(rawAct("u-owner", { card_id: card.cardId, decision: "dismiss" })).rejects.toThrow(/KG_ORG_FROZEN/);
      const note = await memoryCardFor(recall, cards, { orgId: ORG_ID, userId: "u-owner", threadId: T.g3, runId: "run-f17-frozen", messageId: t0.msg, text: "记住：冻结时不出卡" }, (m, d) => {
        logs.push(`${m}: ${String(d.detail)}`);
      });
      expect(note).toBeNull();
      expect(logs.some((l) => l.includes("KG_ORG_FROZEN"))).toBe(true);
    } finally {
      await asOwner((q) => q.query("UPDATE organizations SET status = 'active', disabled_at = NULL, retention_until = NULL WHERE id = $1", [ORG]));
    }
    expect(await cardRow(card.cardId)).toMatchObject({ status: "open" });
    expect(await sql("SELECT id FROM kg_memory_cards WHERE run_id = 'run-f17-frozen'")).toEqual([]);
  });
});

/* ── 项目会话、非所有者与隐私 ───────────────────────────────────── */

describe("F17: 项目会话、非所有者与隐私", () => {
  it("项目会话：「记住」不出卡（长期记忆只在个人对话），模型照实说；「忘掉」只列会话记忆", async () => {
    const r = await turn(T.s, "记住：客户B预算50万");
    expect(r.note).toContain("个人对话");
    expect((await turnMemory(T.s, r.answerId)).prompt).toBeNull();
    expect(await sql("SELECT id FROM kg_memory_cards WHERE run_id = $1", [r.runId])).toEqual([]);

    await say(T.s, MIGRATE);
    const m = await threadClaimBy(T.s, MIGRATE);
    const t = await turn(T.s, "忘掉李四那条");
    const card = await cardOf(T.s, t.answerId);
    // 项目会话里不列所有者的长期记忆（F12：个人记忆只进本人的个人会话）
    expect(card.items).toEqual([{ claimId: m.id, statement: MIGRATE }]);

    // 成员：看得到只读的卡，点不动 ⇒ KG_NOT_OWNER（HTTP 403）；绕过应用层直调数据库同样拒
    expect((await cardOf(T.s, t.answerId, "u-member")).cardId).toBe(card.cardId);
    await expect(actOnMemoryCard(deps, { userId: "u-member", orgId: ORG_ID, actorKind: "human", cardId: card.cardId, decision: "accept" }))
      .rejects.toMatchObject({ code: "KG_NOT_OWNER" });
    await expect(ctl.memoryCard({ userId: "u-member", orgId: ORG } as never, card.cardId, { decision: "dismiss" })).rejects.toBeInstanceOf(ForbiddenException);
    await expect(rawAct("u-member", { card_id: card.cardId })).rejects.toThrow(/KG_NOT_OWNER/);
    expect(await cardRow(card.cardId)).toMatchObject({ status: "open" });

    // 成员自己说「忘掉 …」：不是会话所有者 ⇒ 不出卡、什么都不说（E1）
    const mt = await turn(T.s, "忘掉李四那条", "u-member");
    expect(mt.note).toBeNull();
    expect(await sql("SELECT id FROM kg_memory_cards WHERE run_id = $1", [mt.runId])).toEqual([]);

    await act(card.cardId);
    expect(await claim(m.id)).toMatchObject({ revoked: true, revocation_reason: "user_forgot" });
  });

  it("隐私：列着本人长期记忆的卡，别人连这张卡存在都读不到（RLS）；别人拿卡 id 来点 ⇒ KG_CARD_NOT_FOUND（不泄露存在性）", async () => {
    const t = await turn(T.priv, "忘掉客户A");
    const card = await cardOf(T.priv, t.answerId);
    expect(card.items.length).toBeGreaterThan(0);
    const [row] = await sql<{ has_personal: boolean }>("SELECT has_personal FROM kg_memory_cards WHERE id = $1", [card.cardId]);
    expect(row!.has_personal).toBe(true);
    const seen = (user: string) => asApp(ORG, async (c) => {
      await c.query("SELECT set_config('app.current_user_id', $1, true)", [user]);
      return (await c.query("SELECT id FROM kg_memory_cards WHERE id = $1", [card.cardId])).rowCount;
    });
    expect(await seen("u-member")).toBe(0);
    expect(await seen("u-owner")).toBe(1);
    await expect(actOnMemoryCard(deps, { userId: "u-member", orgId: ORG_ID, actorKind: "human", cardId: card.cardId, decision: "accept" }))
      .rejects.toMatchObject({ code: "KG_CARD_NOT_FOUND" });
    await expect(ctl.memoryCard({ userId: "u-member", orgId: ORG } as never, card.cardId, { decision: "accept" })).rejects.toBeInstanceOf(NotFoundException);
    // 没有个人条目的卡在别人的个人会话里：卡读得到路由，但会话看不见 ⇒ 同一个出口
    const r = await turn(T.g3, "记住：隐私测试这一条");
    const rc = await cardOf(T.g3, r.answerId);
    await expect(actOnMemoryCard(deps, { userId: "u-member", orgId: ORG_ID, actorKind: "human", cardId: rc.cardId, decision: "accept" }))
      .rejects.toMatchObject({ code: "KG_CARD_NOT_FOUND" });
    await expect(act("no-such-card")).rejects.toMatchObject({ code: "KG_CARD_NOT_FOUND" });
    expect(await cardRow(card.cardId)).toMatchObject({ status: "open" });
  });

  it("卡挂在「那一轮」：别的回答下没有它；别的会话的回答 id 读不到它", async () => {
    const t = await turn(T.g3, "记住：只在这一轮");
    const other = await turn(T.g3, "今天天气不错");
    expect((await turnMemory(T.g3, other.answerId)).prompt).toBeNull();
    expect((await turnMemory(T.r2, t.answerId)).prompt).toBeNull();
    expect((await cardOf(T.g3, t.answerId)).items[0]!.statement).toBe("只在这一轮");
  });
});

describe("F17: 开卡函数自己复核（不信调用方给的 id）", () => {
  const rawOpen = (p: Record<string, unknown>) => asApp(ORG, async (c) =>
    (await c.query<{ r: { outcome: string; card_id?: string } }>("SELECT kg_open_memory_card($1::jsonb) AS r", [JSON.stringify({ card_id: newKgId("card"), run_id: newKgId("run"), ...p })])).rows[0]!.r);

  it("别的会话的结论、项目会话里的个人记忆、已失效的结论 ⇒ 都不上卡；一条不剩 ⇒ no_items", async () => {
    const other = await threadClaimBy(T.r1, `${CONTACT}，电话找他`);
    const [personal] = await personalLive(`${CONTACT}，电话找他`);
    const [gone] = await sql<{ id: string }>("SELECT id FROM claims WHERE org_id = $1 AND revoked_at IS NOT NULL LIMIT 1", [ORG]);
    const msg = await say(T.s, "忘掉：随便什么");
    const out = await rawOpen({ thread_id: T.s, message_id: msg, requester: "u-owner", kind: "forget", target: "随便什么", claim_ids: [other.id, personal!.id, gone!.id] });
    expect(out).toEqual({ outcome: "no_items" });
    // 个人线程里，本人的个人记忆可以上卡；别的会话的仍然不行
    const pm = await say(T.z, "忘掉：随便什么");
    const ok = await rawOpen({ thread_id: T.z, message_id: pm, requester: "u-owner", kind: "forget", target: "随便什么", claim_ids: [other.id, personal!.id] });
    expect(ok.outcome).toBe("opened");
    const [row] = await sql<{ items: { claimId: string }[] }>("SELECT items FROM kg_memory_cards WHERE id = $1", [ok.card_id]);
    expect(row!.items.map((i) => i.claimId)).toEqual([personal!.id]);
  });

  it("消息不是请求人说的 / 请求人不是会话所有者 / 记住卡在项目会话 ⇒ 不开卡", async () => {
    const byMember = await say(T.s, "记住：成员说的", "u-member");
    expect(await rawOpen({ thread_id: T.s, message_id: byMember, requester: "u-member", kind: "forget", target: "成员说的", claim_ids: [] })).toEqual({ outcome: "not_owner" });
    expect(await rawOpen({ thread_id: T.s, message_id: byMember, requester: "u-owner", kind: "forget", target: "成员说的", claim_ids: [] })).toEqual({ outcome: "not_owner" });
    const byOwner = await say(T.s, "记住：所有者说的");
    expect(await rawOpen({ thread_id: T.s, message_id: byOwner, requester: "u-owner", kind: "remember", statement: "所有者说的" })).toEqual({ outcome: "not_personal" });
    expect(await rawOpen({ thread_id: T.r2, message_id: byOwner, requester: "u-owner", kind: "remember", statement: "所有者说的" })).toEqual({ outcome: "not_owner" });
  });

  it("N2：卡上的字必须出自这条消息——调用方给的记住内容 / 忘掉对象不在正文里 ⇒ not_from_message、不开卡", async () => {
    const m = await say(T.u2, "记住：王五喜欢钓鱼");
    expect(await rawOpen({ thread_id: T.u2, message_id: m, requester: "u-owner", kind: "remember", statement: "王五欠我一百万" })).toEqual({ outcome: "not_from_message" });
    expect(await rawOpen({ thread_id: T.u2, message_id: m, requester: "u-owner", kind: "remember", statement: "  " })).toEqual({ outcome: "not_from_message" });
    const [anyClaim] = await personalLive(`${CONTACT}，电话找他`);
    expect(await rawOpen({ thread_id: T.u2, message_id: m, requester: "u-owner", kind: "forget", target: "王经理", claim_ids: [anyClaim!.id] })).toEqual({ outcome: "not_from_message" });
    expect(await rawOpen({ thread_id: T.u2, message_id: m, requester: "u-owner", kind: "forget", claim_ids: [anyClaim!.id] })).toEqual({ outcome: "not_from_message" });
    expect((await rawOpen({ thread_id: T.u2, message_id: m, requester: "u-owner", kind: "remember", statement: "王五喜欢钓鱼" })).outcome).toBe("opened");
  });

  it("N6：Agent 说的话（哪怕 author_id 填成所有者）、有更窄可见范围的消息 ⇒ 不开卡", async () => {
    const byAgent = `m-f17-agent-${String(++seq)}`;
    await addChatMessage({ orgId: ORG, id: byAgent, threadId: T.u2, body: "记住：Agent 说的", authorId: "u-owner", authorKind: "agent", agentId: "agent-1" });
    expect(await rawOpen({ thread_id: T.u2, message_id: byAgent, requester: "u-owner", kind: "remember", statement: "Agent 说的" })).toEqual({ outcome: "not_owner" });
    const narrow = `m-f17-narrow-${String(++seq)}`;
    await addChatMessage({ orgId: ORG, id: narrow, threadId: T.u2, body: "记住：只给自己看的", authorId: "u-owner", visibilityScope: "private" });
    expect(await rawOpen({ thread_id: T.u2, message_id: narrow, requester: "u-owner", kind: "remember", statement: "只给自己看的" })).toEqual({ outcome: "not_owner" });
  });

  it("N6：别人个人空间里的 id、已被取代（改写过）的 id ⇒ 不上卡", async () => {
    await say(MEMBER_THREAD, APPROVE, "u-member");
    const [memberClaim] = await sql<{ id: string }>("SELECT id FROM claims WHERE scope_kind = 'chat_session' AND scope_id = $1 AND statement = $2", [MEMBER_THREAD, APPROVE]);
    const memberL1 = await asApp(ORG, async (c) => {
      await c.query("SELECT set_config('app.current_user_id', 'u-member', true)");
      return (await c.query<{ id: string }>("SELECT kg_promote_claim($1::jsonb) AS id", [JSON.stringify({ action_id: newKgId("act"), thread_id: MEMBER_THREAD, claim_id: memberClaim!.id })])).rows[0]!.id;
    });
    await say(T.u2, APPROVE);
    const own = await threadClaimBy(T.u2, APPROVE);
    await applyHumanAction({ ...deps, actions: new PgHumanAction(db), newId: newKgId }, {
      userId: "u-owner", orgId: ORG_ID, threadId: T.u2, basedOnRevision: (await read(T.u2)).revision,
      action: { type: "reviseClaim", claimId: own.id, statement: "王经理只审批大合同" },
    });
    expect(await claim(own.id)).toMatchObject({ status: "superseded", revoked: false });
    const m = await say(T.u2, "忘掉：王经理");
    expect(await rawOpen({ thread_id: T.u2, message_id: m, requester: "u-owner", kind: "forget", target: "王经理", claim_ids: [memberL1, own.id] })).toEqual({ outcome: "no_items" });
  });
});

/* ── N1：撤销只撤这次新建的东西 ─────────────────────────────────── */

describe("F17: 撤销（N1）", () => {
  it("会话结论与长期记忆那条都是这次新建的 ⇒ 给 claimId（可撤销）；撤销后长期记忆里没有了，卡读作「没有记在长期记忆里」", async () => {
    const t = await turn(T.u1, "记住：王五的爱好是钓鱼");
    const card = await cardOf(T.u1, t.answerId);
    const out = await act(card.cardId);
    const undoId = out.card.items[0]!.claimId;
    expect(undoId).not.toBeNull();
    expect(await rememberedRow(card.cardId)).toMatchObject({ remembered_claim_id: undoId, claim_created: true, personal_created: true });
    expect((await cardOf(T.u1, t.answerId))).toMatchObject({ state: "done", items: [{ claimId: undoId }] });
    expect(await personalLive("王五的爱好是钓鱼")).toHaveLength(1);
    await applyHumanAction({ ...deps, actions: new PgHumanAction(db), newId: newKgId }, {
      userId: "u-owner", orgId: ORG_ID, threadId: T.u1, basedOnRevision: (await read(T.u1)).revision,
      action: { type: "revokeClaim", claimId: undoId!, reason: "user_undo_remember" },
    });
    expect(await personalLive("王五的爱好是钓鱼")).toEqual([]);
    expect(await cardOf(T.u1, t.answerId)).toMatchObject({ state: "dismissed", items: [{ claimId: null }] });
  });

  it("长期记忆那条后来又有了别的来源 ⇒ 不再给撤销（撤会话那条已撤不掉长期记忆）；那条会话结论后来被撤销 ⇒ claimId 为 null、长期记忆仍在 ⇒ 仍是「已记住」", async () => {
    const t = await turn(T.u1, "记住：王五的车牌是 A12345");
    const out = await act((await cardOf(T.u1, t.answerId)).cardId);
    const sessionId = out.card.items[0]!.claimId!;
    expect(sessionId).not.toBeNull();
    const t2 = await turn(T.u2, "记住：王五的车牌是 A12345");
    await act((await cardOf(T.u2, t2.answerId)).cardId);
    expect(await personalLive("王五的车牌是 A12345")).toHaveLength(1);
    expect(await cardOf(T.u1, t.answerId)).toMatchObject({ state: "done", items: [{ claimId: null }] });
    await applyHumanAction({ ...deps, actions: new PgHumanAction(db), newId: newKgId }, {
      userId: "u-owner", orgId: ORG_ID, threadId: T.u1, basedOnRevision: (await read(T.u1)).revision,
      action: { type: "revokeClaim", claimId: sessionId },
    });
    expect(await personalLive("王五的车牌是 A12345")).toHaveLength(1);
    expect(await cardOf(T.u1, t.answerId)).toMatchObject({ state: "done", items: [{ claimId: null }] });
  });
});

/* ── N6：点击时复核 ───────────────────────────────────────────────── */

describe("F17: 点击时复核（N6）", () => {
  it("记住卡指着的那条在出卡之后说法变了 ⇒ 读作过期、点击 KG_CARD_STALE", async () => {
    await say(T.rv, BUDGET);
    const b = await threadClaimBy(T.rv, BUDGET);
    const t = await turn(T.rv, `记住：${BUDGET}`);
    const card = await cardOf(T.rv, t.answerId);
    expect(card.items).toEqual([{ claimId: b.id, statement: BUDGET }]);
    await asOwner((c) => c.query("UPDATE claims SET statement = '赵六不再负责预算' WHERE id = $1", [b.id]));
    expect((await cardOf(T.rv, t.answerId)).state).toBe("stale");
    await expect(act(card.cardId)).rejects.toMatchObject({ code: "KG_CARD_STALE" });
    expect(await personalLive(BUDGET)).toEqual([]);
  });

  it("出卡之后会话被挪进项目 ⇒ 记住卡、列着个人记忆的忘掉卡都 KG_CARD_STALE，一行不写", async () => {
    await say(T.mv, MIGRATE);
    const r = await turn(T.mv, "记住：搬家前要备份");
    const rc = await cardOf(T.mv, r.answerId);
    const f = await turn(T.mv, "忘掉客户A");
    const fc = await cardOf(T.mv, f.answerId);
    const [row] = await sql<{ has_personal: boolean }>("SELECT has_personal FROM kg_memory_cards WHERE id = $1", [fc.cardId]);
    expect(row!.has_personal).toBe(true);
    await asOwner((c) => c.query("UPDATE chat_threads SET project_id = $1 WHERE id = $2", [`${ORG}-p`, T.mv]));
    try {
      await expect(act(rc.cardId)).rejects.toMatchObject({ code: "KG_CARD_STALE" });
      await expect(act(fc.cardId)).rejects.toMatchObject({ code: "KG_CARD_STALE" });
      expect(await personalLive("搬家前要备份")).toEqual([]);
      for (const i of fc.items) expect((await claim(i.claimId!)).revoked).toBe(false);
    } finally {
      await asOwner((c) => c.query("UPDATE chat_threads SET project_id = NULL WHERE id = $1", [T.mv]));
    }
  });
});

/* ── I-18：一轮至多一张主动卡，冲突卡优先 ────────────────────────── */

describe("F17: 与矛盾提醒的先后（I-18）", () => {
  it("同一轮既有矛盾又说了「记住」⇒ 先出矛盾卡；矛盾处理完，同一轮回答下轮到记住卡；有矛盾时点「记住」⇒ KG_CONTESTED_NEEDS_RESOLUTION", async () => {
    await say(T.c, "项目A 定在 9/29 上线");
    const older = await threadClaimBy(T.c, "项目A 9/29 上线");
    await applyHumanAction({ ...deps, actions: new PgHumanAction(db), newId: newKgId }, {
      userId: "u-owner", orgId: ORG_ID, threadId: T.c, basedOnRevision: (await read(T.c)).revision, action: { type: "confirmClaim", claimId: older.id },
    });
    const t = await turn(T.c, "记住：项目A 上线改到 10/1");
    const first = await turnMemory(T.c, t.answerId);
    expect(first.prompt?.type).toBe("conflict");
    if (first.prompt?.type !== "conflict") return;
    await applyHumanAction({ ...deps, actions: new PgHumanAction(db), newId: newKgId }, {
      userId: "u-owner", orgId: ORG_ID, threadId: T.c, basedOnRevision: (await read(T.c)).revision,
      action: { type: "resolveConflict", promptId: first.prompt.conflict.promptId, resolution: "ignore" },
    });
    const card = await cardOf(T.c, t.answerId);
    expect(card).toMatchObject({ kind: "remember", state: "open", items: [{ statement: "项目A 上线改到 10/1" }] });
    await expect(ctl.memoryCard({ userId: "u-owner", orgId: ORG } as never, card.cardId, { decision: "accept" })).rejects.toBeInstanceOf(ConflictException);
    await expect(act(card.cardId)).rejects.toMatchObject({ code: "KG_CONTESTED_NEEDS_RESOLUTION" });
    expect(await cardRow(card.cardId)).toMatchObject({ status: "open" });
    expect(await personalLive("项目A 上线改到 10/1")).toEqual([]);

    // 忘掉矛盾的一方（F16：任一方经任何路径失效 ⇒ 提醒关闭、另一方不再「有矛盾」）
    const newer = first.prompt.conflict.newerClaim.id;
    const f = await turn(T.c, "忘掉项目A 上线改到 10/1");
    const fc = await cardOf(T.c, f.answerId);
    expect(fc.items.map((i) => i.claimId)).toEqual([newer]);
    await act(fc.cardId);
    expect(await claim(newer)).toMatchObject({ revoked: true, revocation_reason: "user_forgot" });
    expect(await claim(older.id)).toMatchObject({ status: "accepted", revoked: false });
    const [p] = await sql<{ status: string }>("SELECT status FROM kg_conflict_prompts WHERE id = $1", [first.prompt.conflict.promptId]);
    expect(p!.status).toBe("closed_by_change");
  });
});

/* ── 真实执行器：一轮对话从头到尾 ───────────────────────────────── */

describe("F17: 执行器接线（executeQueuedRuns → 回答落库 → getTurnMemory）", () => {
  it("用户说「记住：…」⇒ 执行器开卡、模型被告知「卡已出、还没生效」；回答写回后，回答下读得到这张卡；没接卡片端口 ⇒ 不开卡", async () => {
    const AGENT = "agent-kg-f17";
    const instructions = "You are a helpful assistant.";
    await asApp(ORG, async (c) => {
      await c.query(`INSERT INTO agents (id,org_id,stable_name,name,status,creator_id,created_at,updated_at)
                     VALUES ($1,$2,$1,'F17','enabled','u-owner',now(),now())`, [AGENT, ORG]);
      await c.query(`INSERT INTO agent_versions (id,org_id,agent_id,semantic_label,instruction_digest,instructions,skill_version_ids,
                       model_provider,model_id,tool_policy,creator_id,created_at,published_at)
                     VALUES ($1,$2,$3,'v1',$4,$5,'{}'::text[],'p','m','[]'::jsonb,'u-owner',now(),now())`,
        [`${AGENT}-v1`, ORG, AGENT, createHash("sha256").update(instructions).digest("hex"), instructions]);
    });
    const runOnce = async (runId: string, text: string, withCards: boolean) => {
      const qid = `q-${runId}`;
      await addChatMessage({ orgId: ORG, id: qid, threadId: T.run, body: text, authorId: "u-owner" });
      await asApp(ORG, (c) => c.query(
        `INSERT INTO agent_runs (id, org_id, thread_id, input_message_id, agent_id, agent_version_id, skill_version_ids, model_provider, model_id, status)
         VALUES ($1,$2,$3,$4,$5,$6,'[]'::jsonb,'p','m','queued')`, [runId, ORG, T.run, qid, AGENT, `${AGENT}-v1`]));
      const calls: ModelCallInput[] = [];
      let tick = 0;
      const runDeps: ExecuteAgentRunDeps = {
        runs: new PgAgentRunRepository(db),
        model: { complete: async (input) => { calls.push(input); return { text: "好的，点下面的卡片确认就记下了。" }; } },
        knowledge: recall,
        ...(withCards ? { memoryCards: cards } : {}),
        clock: { now: () => new Date(Date.now() + tick++).toISOString(), newStepId: () => `step-${runId}-${String(tick)}` },
        log: () => {},
      };
      await executeQueuedRuns(runDeps, { orgId: ORG_ID });
      expect(await writeBackPendingRuns(runDeps, { orgId: ORG_ID })).toBe(1);
      const [answer] = await sql<{ id: string }>("SELECT id FROM chat_messages WHERE agent_run_id = $1", [runId]);
      return { call: calls.at(-1)!, answerId: answer!.id };
    };
    const { call, answerId } = await runOnce("run-kg-f17-1", "记住：年度预算 800 万", true);
    const note = (call.history ?? []).find((m) => m.content.startsWith("【记忆卡片】"));
    expect(note?.content).toContain("年度预算 800 万");
    expect(note?.content).toContain("现在还没有记");
    expect(await cardOf(T.run, answerId)).toEqual({ cardId: expect.any(String), kind: "remember", state: "open", items: [{ claimId: null, statement: "年度预算 800 万" }] });
    expect(await personalLive("年度预算 800 万")).toEqual([]);

    const off = await runOnce("run-kg-f17-2", "记住：年度预算 900 万", false);
    expect((off.call.history ?? []).some((m) => m.content.startsWith("【记忆卡片】"))).toBe(false);
    expect((await turnMemory(T.run, off.answerId)).prompt).toBeNull();
  });
});

/* ── 与 F16 结束冲突的触发器：忘掉不会被别的会话的锁卡住 ─────────── */

describe("F17 × F16: 忘掉一条长期记忆（它是别的会话里矛盾卡的旧条）不等别的会话的锁", () => {
  it("乙拿着会话 B 的锁；甲在会话 A 用忘掉卡忘掉长期记忆 P ⇒ 甲立刻返回、B 的卡进队列；排空后 B 的卡 closed_by_change、新条不再有矛盾", async () => {
    // P：会话 X 里说「9/29」→ 记到长期记忆；会话 B 说「10/1」⇒ B 里开一张矛盾卡，旧条是 P
    await say(T.dx, "项目Z 定在 9/29 发布");
    const src = await threadClaimBy(T.dx, "项目Z 9/29 发布");
    const pId = await asApp(ORG, async (c) => {
      await c.query("SELECT set_config('app.current_user_id', 'u-owner', true)");
      return (await c.query<{ id: string }>("SELECT kg_promote_claim($1::jsonb) AS id", [JSON.stringify({ action_id: newKgId("act"), thread_id: T.dx, claim_id: src.id })])).rows[0]!.id;
    });
    await say(T.db, "项目Z 发布改到 10/1");
    const [prompt] = await sql<{ id: string; older_claim_id: string; newer_claim_id: string; status: string }>(
      "SELECT id, older_claim_id, newer_claim_id, status FROM kg_conflict_prompts WHERE thread_id = $1", [T.db]);
    expect(prompt).toMatchObject({ older_claim_id: pId, status: "open" });
    expect(await claim(prompt!.newer_claim_id)).toMatchObject({ status: "contested" });

    // 会话 A（个人线程）里说「忘掉项目Z」⇒ 卡上有 P
    const t = await turn(T.da, "忘掉项目Z");
    const card = await cardOf(T.da, t.answerId);
    expect(card.items.map((i) => i.claimId)).toContain(pId);

    const b = new pg.Client(appConfig());
    await b.connect();
    try {
      await b.query("BEGIN");
      // 只拿会话 B 的会话锁（不碰卡那一行）
      await b.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`kg_scope:${ORG}|chat_session|${T.db}`]);
      const started = Date.now();
      const out = await Promise.race([
        act(card.cardId, { claimIds: [pId] }),
        new Promise<never>((_r, reject) => setTimeout(() => reject(new Error("forget still waiting after 3000ms")), 3_000)),
      ]);
      expect(Date.now() - started).toBeLessThan(3_000);
      expect(out.card.state).toBe("done");
      expect(await claim(pId)).toMatchObject({ revoked: true, revocation_reason: "user_forgot" });
      // 拿不到 B 的锁 ⇒ 卡进队列，还开着
      expect(await sql("SELECT prompt_id FROM kg_conflict_close_queue WHERE prompt_id = $1", [prompt!.id])).toHaveLength(1);
      expect((await sql<{ status: string }>("SELECT status FROM kg_conflict_prompts WHERE id = $1", [prompt!.id]))[0]!.status).toBe("open");
    } finally {
      await b.query("ROLLBACK");
      await b.end();
    }
    while ((await asApp(ORG, (c) => c.query<{ done: boolean }>("SELECT kg_conflict_close_drain() AS done"))).rows[0]!.done) { /* 排空 */ }
    expect((await sql<{ status: string }>("SELECT status FROM kg_conflict_prompts WHERE id = $1", [prompt!.id]))[0]!.status).toBe("closed_by_change");
    expect(await sql("SELECT prompt_id FROM kg_conflict_close_queue WHERE prompt_id = $1", [prompt!.id])).toEqual([]);
    expect((await claim(prompt!.newer_claim_id)).status).toBe("proposed");
  });
});

describe("F17: 死锁（40P01）纵深防御", () => {
  const deadlock = Object.assign(new Error("deadlock detected"), { code: "40P01" });
  /** 前 n 次开事务就撞死锁，之后交给真库。 */
  const flaky = (n: number) => {
    let calls = 0;
    const port = {
      withTenant: (o: Parameters<DatabasePort["withTenant"]>[0], fn: Parameters<DatabasePort["withTenant"]>[1]) => {
        calls += 1;
        return calls <= n ? Promise.reject(deadlock) : db.withTenant(o, fn);
      },
    } as unknown as DatabasePort;
    return { cards: new PgMemoryCard(port), calls: () => calls };
  };
  const actWith = (c: PgMemoryCard, cardId: string) => c.act(ORG_ID, "u-owner", { actionId: newKgId("act"), cardId, decision: "accept", actorKind: "human" });

  it("撞一次 ⇒ 整个事务重来、照常生效；连撞两次 ⇒ KG_CARD_STALE（界面：内容已经变了，请刷新后再点），卡还开着", async () => {
    const t1 = await turn(T.u2, "记住：王五住在杭州");
    const once = flaky(1);
    const out = await actWith(once.cards, (await cardOf(T.u2, t1.answerId)).cardId);
    expect(out.card.state).toBe("done");
    expect(once.calls()).toBeGreaterThanOrEqual(2);
    expect(await personalLive("王五住在杭州")).toHaveLength(1);

    const t2 = await turn(T.u2, "记住：王五养了一只猫");
    const c2 = await cardOf(T.u2, t2.answerId);
    await expect(actWith(flaky(10).cards, c2.cardId)).rejects.toMatchObject({ code: "KG_CARD_STALE" });
    expect(await cardRow(c2.cardId)).toMatchObject({ status: "open" });
  });
});
