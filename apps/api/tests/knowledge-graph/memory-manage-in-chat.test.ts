/**
 * Issue #4361（phase-18 S4）—— 在对话里管理记忆：「忘掉关于 X 的」「我改主意了，改成 Y」「你记得我什么」。真实数据库。
 *
 * 一轮 = 用户消息落库 → 执行器同一个入口（turnKnowledgeContext：先卡片 / 改口，再召回）→ 抽取流水线真实跑一轮（回环模型）
 * → 回答落库（chat_messages.agent_run_id 指向这个 run）。卡从 getTurnMemory 读，决定 / 撤销经应用层（与接口层同一个入口）。
 *
 * 覆盖：
 *   - 意图：三类的正例与反例（「遗忘曲线」「我忘了密码」不触发忘掉；「你记得我昨天说的方案吗」不是查看）；
 *   - 忘掉：候选来自本人个人空间（本人别的个人对话 + 长期记忆），确认后 F07 级联（L1 副本、边）；可撤销（结论、副本、边都回来）；
 *     撤过再撤 / 没生效的卡 ⇒ KG_CARD_STALE；项目会话不出卡；
 *   - 越权：别人撤我的卡 / 不存在的卡 ⇒ 同一个 404（KG_CARD_NOT_FOUND）；Agent ⇒ KG_ACTOR_NOT_HUMAN；别人的清单读不到；
 *   - 改口：R8 分级——明确 + 高把握 ⇒ 自动取代（可撤销）；只到 frame_only ⇒ 卡、两条都不动；反对 / 不相干 ⇒ 什么都不写；
 *     项目会话 / 别人 ⇒ 不碰；
 *   - 查看：按种类分组、带来源对话；忘掉之后清单里没有了；项目会话不列；清单卡上不接受任何决定。
 */
import { NotFoundException, ConflictException } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { actOnMemoryCard, undoMemoryCard, type MemoryCardDeps } from "../../src/application/knowledge-graph/act-on-memory-card";
import { applyHumanAction } from "../../src/application/knowledge-graph/apply-human-action";
import type { ChangeMindPorts } from "../../src/application/knowledge-graph/change-mind";
import { runExtractionTick, type ExtractionDeps } from "../../src/application/knowledge-graph/extract-message-knowledge";
import { newKgId } from "../../src/application/knowledge-graph/ids";
import { knowledgeMemoryFor, turnKnowledgeContext } from "../../src/application/knowledge-graph/recall-knowledge";
import { getThreadKnowledge, getTurnMemory } from "../../src/application/knowledge-graph/read-thread-knowledge";
import { detectMemoryIntent } from "../../src/domain/knowledge-graph/memory-intent";
import { toOrgId } from "../../src/domain/org-id";
import { PgChatRepository } from "../../src/infrastructure/chat/pg-chat-repository";
import { appConfig } from "../../src/infrastructure/db/pg-config";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { CountingDecisionIdFactory } from "../../src/infrastructure/identity/in-memory-session-store";
import { PgIdentityRepository } from "../../src/infrastructure/identity/pg-identity-repository";
import { PgHumanAction } from "../../src/infrastructure/knowledge-graph/pg-human-action";
import { PgKgAutoCopy } from "../../src/infrastructure/knowledge-graph/pg-kg-auto-copy";
import { PgKgConflict } from "../../src/infrastructure/knowledge-graph/pg-kg-conflict";
import { PgKnowledgeRead } from "../../src/infrastructure/knowledge-graph/pg-knowledge-read";
import { PgKnowledgeRecall } from "../../src/infrastructure/knowledge-graph/pg-knowledge-recall";
import { PgMemoryCard } from "../../src/infrastructure/knowledge-graph/pg-memory-card";
import { PgOntologyStore } from "../../src/infrastructure/knowledge-graph/pg-ontology-store";
import { PgPromotion } from "../../src/infrastructure/knowledge-graph/pg-promotion";
import { KnowledgeGraphController } from "../../src/interface/controllers/knowledge-graph.controller";
import { addChatMessage, addChatThread } from "../support/chat-db";
import { addOrgMember, addProjectMember, asApp, asOwner, ensureDatabase, migrateOnce, resetOrgs, seedOrg } from "../support/db";
import { enableExtraction, extractionDeps, loopbackModel } from "./kg-extraction-fixtures";

const ORG = "org-kg-i4361";
const ORG_ID = toOrgId(ORG);
const OWNER = "u-i4361-owner";
const MEMBER = "u-i4361-member";
const PERSONAL = ["p1", "p2", "p3", "p4", "c1", "c2", "c3", "c4", "c5", "o1", "o2", "x1", "x2"] as const;
const T = Object.fromEntries([...PERSONAL, "s", "m"].map((k) => [k, `thr-i4361-${k}`])) as Record<(typeof PERSONAL)[number] | "s" | "m", string>;

const CONTACT = "客户A的对接人是王经理";
const OLD = "我决定关注211高校";
const TODO = "周五之前把报价单发给客户A";
const fact = (entity: string, statement: string) => JSON.stringify({
  entities: [{ name: entity, kind: "organization", aliases: [] }],
  claims: [{ statement, kind: "fact", confidence: 0.9, about: [entity], decidedBy: null, quote: statement }],
});
const decision = (statement: string) => JSON.stringify({
  entities: [], claims: [{ statement, kind: "decision", confidence: 0.9, about: [], decidedBy: null, quote: statement }],
});
const todo = (statement: string) => JSON.stringify({
  entities: [], claims: [{ statement, kind: "todo", confidence: 0.9, about: [], decidedBy: null, quote: statement }],
});
// 回环抽取：只认这几句；「我改主意了…」这类改口句故意**不**给抽取结果——改口是这一轮自己走的 R8，不靠抽取模型
const MODEL = loopbackModel([[CONTACT, fact("客户A", CONTACT)], [OLD, decision(OLD)], [TODO, todo(TODO)]]);

let db: PgDatabase;
let deps: MemoryCardDeps;
let recall: PgKnowledgeRecall;
let cards: PgMemoryCard;
let change: ChangeMindPorts;
let xdeps: ExtractionDeps;
let ctl: KnowledgeGraphController;
let seq = 0;

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  await resetOrgs(ORG);
  const fx = await seedOrg({ orgId: ORG, projectId: `${ORG}-p` });
  await enableExtraction(ORG);
  for (const u of [OWNER, MEMBER]) {
    await addOrgMember(ORG, u, "consultant", fx.teams.energy!);
    await addProjectMember(ORG, `${ORG}-p`, u, "facilitator", null);
  }
  for (const k of PERSONAL) {
    await addChatThread({ orgId: ORG, id: T[k], projectId: null, visibilityScope: "private", createdBy: OWNER, title: `对话${k}` });
  }
  await addChatThread({ orgId: ORG, id: T.s, projectId: `${ORG}-p`, visibilityScope: "plenary", createdBy: OWNER, title: "项目对话" });
  await addChatThread({ orgId: ORG, id: T.m, projectId: null, visibilityScope: "private", createdBy: MEMBER, title: "成员的对话" });
  db = new PgDatabase(appConfig());
  recall = new PgKnowledgeRecall(db);
  cards = new PgMemoryCard(db);
  change = { store: new PgOntologyStore(db), conflicts: new PgKgConflict(db), autoCopy: new PgKgAutoCopy(db), newId: newKgId };
  deps = {
    repo: new PgIdentityRepository(db), ids: new CountingDecisionIdFactory(), chat: new PgChatRepository(db),
    knowledge: new PgKnowledgeRead(db, true), cards, newId: newKgId,
  };
  ctl = new KnowledgeGraphController(deps.repo, deps.ids, deps.chat, deps.knowledge, new PgHumanAction(db), new PgPromotion(db), {} as never, {} as never, {} as never, cards);
  xdeps = extractionDeps(db, MODEL.model, ORG);
});
afterAll(async () => { await db.close(); });

/* ── 夹具 ─────────────────────────────────────────────────────────── */

const sql = <R>(q: string, params: unknown[] = []) => asOwner(async (c) => (await c.query(q, params)).rows as R[]);

async function extractUntilDone(messageId: string): Promise<void> {
  for (let i = 0; i < 20; i += 1) {
    await runExtractionTick(xdeps);
    if ((await sql("SELECT 1 FROM kg_extraction_queue WHERE message_id = $1", [messageId])).length === 0) return;
  }
  throw new Error(`message ${messageId} still queued for extraction`);
}

/** 只说一句（不经执行器）：抽取照常跑（#4283 本人的决定自动记进长期记忆）。 */
async function say(threadId: string, body: string, author = OWNER): Promise<string> {
  const id = `m-i4361-${String(++seq)}`;
  await addChatMessage({ orgId: ORG, id, threadId, body, authorId: author });
  await extractUntilDone(id);
  return id;
}

/** 完整一轮：用户消息 → 执行器同一个入口（卡片 / 改口 → 召回）→ 抽取 → 回答落库。 */
async function turn(threadId: string, text: string, user = OWNER, withChange = true) {
  const n = String(++seq);
  const msg = `m-i4361-${n}`;
  const runId = `run-i4361-${n}`;
  await addChatMessage({ orgId: ORG, id: msg, threadId, body: text, authorId: user });
  const notes = await turnKnowledgeContext(recall, cards, {
    orgId: ORG_ID, run: { requesterUserId: user, threadId, inputText: text, runId, inputMessageId: msg },
  }, () => undefined, withChange ? change : undefined);
  const note = notes.find((x) => x.startsWith("【记忆卡片】")) ?? null;
  const memory = notes.find((x) => !x.startsWith("【记忆卡片】")) ?? null;
  await extractUntilDone(msg);
  const answerId = `ans-i4361-${n}`;
  await addChatMessage({ orgId: ORG, id: answerId, threadId, body: "（回答）", authorId: "agent-1", authorKind: "agent", agentId: "agent-1" });
  await asOwner((c) => c.query("UPDATE chat_messages SET agent_run_id = $1 WHERE id = $2", [runId, answerId]));
  return { msg, runId, note, memory, answerId };
}

const read = (threadId: string, userId = OWNER) => getThreadKnowledge(deps, { userId, orgId: ORG_ID, threadId });
const turnMemory = (threadId: string, messageId: string, userId = OWNER) => getTurnMemory(deps, { userId, orgId: ORG_ID, threadId, messageId });
async function cardOf(threadId: string, answerId: string, userId = OWNER) {
  const t = await turnMemory(threadId, answerId, userId);
  if (t.prompt?.type !== "memory_card") throw new Error(`no memory card under ${answerId}: ${JSON.stringify(t.prompt)}`);
  return t.prompt.card;
}
const act = (cardId: string, over: Partial<Parameters<typeof actOnMemoryCard>[1]> = {}) =>
  actOnMemoryCard(deps, { userId: OWNER, orgId: ORG_ID, actorKind: "human", cardId, decision: "accept", ...over });
const undo = (cardId: string, userId = OWNER, actorKind: "human" | "agent" = "human") =>
  undoMemoryCard(deps, { userId, orgId: ORG_ID, actorKind, cardId });
const claim = async (id: string) => (await sql<{ status: string; revoked: boolean; revocation_reason: string | null; scope_kind: string; scope_id: string; statement: string }>(
  "SELECT status, revoked_at IS NOT NULL AS revoked, revocation_reason, scope_kind, scope_id, statement FROM claims WHERE id = $1", [id]))[0]!;
const personalLive = (statement: string, user = OWNER) => sql<{ id: string; status: string }>(
  "SELECT id, status FROM claims WHERE org_id = $1 AND scope_kind = 'personal' AND scope_id = $2 AND statement = $3 AND revoked_at IS NULL AND status <> 'superseded'", [ORG, user, statement]);
const threadClaimBy = async (threadId: string, statement: string) => {
  const c = (await read(threadId)).claims.find((x) => x.statement === statement);
  if (c === undefined) throw new Error(`no live claim「${statement}」in ${threadId}`);
  return c;
};
const activeEdges = (claimId: string) => sql<{ id: string; status: string }>(
  "SELECT id, status FROM ontology_edges WHERE org_id = $1 AND ((src_kind = 'claim' AND src_id = $2) OR (dst_kind = 'claim' AND dst_id = $2)) ORDER BY id", [ORG, claimId]);
const memoryFor = (threadId: string, query: string) =>
  knowledgeMemoryFor(recall, { orgId: ORG_ID, userId: OWNER, threadId, query, runId: `run-i4361-q${String(++seq)}` }, () => undefined);
async function promote(threadId: string, claimId: string): Promise<string> {
  return asApp(ORG, async (c) => {
    await c.query("SELECT set_config('app.current_user_id', $1, true)", [OWNER]);
    return (await c.query<{ id: string }>("SELECT kg_promote_claim($1::jsonb) AS id", [JSON.stringify({ action_id: newKgId("act"), thread_id: threadId, claim_id: claimId })])).rows[0]!.id;
  });
}

/* ── 意图（纯函数）：宁可漏，不可误 ─────────────────────────────── */

describe("#4361 意图识别", () => {
  it("忘掉：「忘掉关于 X 的」取出 X；讨论遗忘曲线、忘了密码都不是忘掉", () => {
    expect(detectMemoryIntent("忘掉关于王经理的")).toEqual({ kind: "forget", target: "王经理" });
    expect(detectMemoryIntent("忘掉关于王经理的吧")).toEqual({ kind: "forget", target: "王经理" });
    expect(detectMemoryIntent("忘掉张三的")).toEqual({ kind: "forget", target: "张三" });
    for (const t of ["我们来聊聊遗忘曲线", "遗忘曲线是什么", "艾宾浩斯遗忘曲线怎么用？", "我忘了密码", "我忘了密码怎么办", "忘记密码怎么办",
      "帮我把遗忘曲线画出来", "我老是忘事", "你会忘掉我说过的话吗"]) {
      expect(detectMemoryIntent(t), t).toBeNull();
    }
  });

  it("改口：可选的「我改主意了」开头 + 一句改口分句（过 R8 的 hasChangeSignal）", () => {
    expect(detectMemoryIntent("我改主意了，改成关注985高校")).toEqual({ kind: "change", statement: "改成关注985高校" });
    expect(detectMemoryIntent("改主意了！把Vue换成React")).toEqual({ kind: "change", statement: "把Vue换成React" });
    expect(detectMemoryIntent("我想法变了，不再用Vue了")).toEqual({ kind: "change", statement: "不再用Vue了" });
    expect(detectMemoryIntent("改成关注 985 高校吧")).toEqual({ kind: "change", statement: "改成关注 985 高校吧" });
    for (const t of [
      "我改主意了", "我改主意了，还是关注211吧", "要不要改成985？", "改成985怎么样", "如果改成985呢", "他改主意了，改成去上海",
      "改成关注985高校，我反对", "我也想改成985", "我改主意了，改成关注985高校。另外帮我写周报", "我改主意了，不改成985了", "改成什么好",
    ]) expect(detectMemoryIntent(t), t).toBeNull();
  });

  it("查看：整句在问「你记得我什么」；普通的召回问题、问别人的都不是", () => {
    for (const t of ["你记得我什么", "你都记得我什么？", "你记得关于我的哪些事", "你记住了我哪些东西", "关于我你都知道什么", "你对我了解多少",
      "列出你记住的关于我的所有内容", "你的记忆里有我的什么", "请问你都记得我些什么呢？"]) {
      expect(detectMemoryIntent(t), t).toEqual({ kind: "overview" });
    }
    for (const t of ["你记得关于客户A的什么", "你记得我昨天说的方案吗", "你记得什么是遗忘曲线吗", "我记得你说过什么", "你知道我什么时候开会吗",
      "我对你了解多少", "你记得我什么时候生日吗", "记住：你记得我什么"]) {
      expect(detectMemoryIntent(t)?.kind === "overview", t).toBe(false);
    }
  });
});

/* ── 忘掉 X：本人个人空间、F07 级联、撤销 ─────────────────────────── */

describe("#4361 忘掉 X", () => {
  it("在新的个人对话里说「忘掉关于王经理的」⇒ 列出别的个人对话里记下、已记到长期记忆的那条；确认 ⇒ 原话与长期记忆都失效、边一起收掉；撤销 ⇒ 全部回来", async () => {
    await say(T.p1, CONTACT);
    const src = await threadClaimBy(T.p1, CONTACT);
    const l1 = await promote(T.p1, src.id);
    const srcEdgesBefore = (await activeEdges(src.id)).filter((e) => e.status === "active").map((e) => e.id);
    expect(srcEdgesBefore.length).toBeGreaterThan(0);
    expect(await memoryFor(T.p3, "王经理")).toContain(CONTACT);

    const t = await turn(T.p2, "忘掉关于王经理的");
    expect(t.note).toContain("默认全选");
    const card = await cardOf(T.p2, t.answerId);
    expect(card).toMatchObject({ kind: "forget", state: "open" });
    // 召回在别的对话里看到的是长期记忆那条（原话那条由它代表，不重复列）
    expect(card.items.map((i) => i.claimId)).toEqual([l1]);

    const out = await act(card.cardId);
    expect(out.card.state).toBe("done");
    expect(await claim(l1)).toMatchObject({ revoked: true, revocation_reason: "user_forgot" });
    // 长期记忆那条的原话（本人别的个人对话里）一起忘掉：回到那个对话也不再有它
    expect(await claim(src.id)).toMatchObject({ revoked: true, revocation_reason: "user_forgot" });
    expect((await activeEdges(src.id)).filter((e) => e.status === "active")).toEqual([]);
    expect((await read(T.p1)).claims.map((c) => c.statement)).not.toContain(CONTACT);
    expect(await memoryFor(T.p3, "王经理")).toBeNull();
    expect(await memoryFor(T.p1, "王经理")).toBeNull();
    // 审计：原话所在的对话一条、长期记忆一条，都是本人
    const audits = await sql<{ scope_kind: string; scope_id: string; actor_id: string; action_type: string }>(
      "SELECT scope_kind, scope_id, actor_id, action_type FROM ontology_actions WHERE id = ANY($1::text[]) ORDER BY scope_kind", [out.actionIds]);
    expect(audits).toEqual([
      { scope_kind: "chat_session", scope_id: T.p1, actor_id: OWNER, action_type: "revokeClaim" },
      { scope_kind: "personal", scope_id: OWNER, actor_id: OWNER, action_type: "revokeClaim" },
    ]);
    expect((await cardOf(T.p2, t.answerId)).state).toBe("done");

    // 撤销：原话、长期记忆、边都回来，照常召回；卡读作 undone
    const back = await ctl.undoCard({ userId: OWNER, orgId: ORG } as never, card.cardId);
    expect(back.card.state).toBe("undone");
    expect(await claim(l1)).toMatchObject({ revoked: false, revocation_reason: null, status: "accepted" });
    expect(await claim(src.id)).toMatchObject({ revoked: false, revocation_reason: null, status: "accepted" });
    expect((await activeEdges(src.id)).filter((e) => e.status === "active").map((e) => e.id)).toEqual(srcEdgesBefore);
    expect(await memoryFor(T.p3, "王经理")).toContain(CONTACT);
    expect((await cardOf(T.p2, t.answerId)).state).toBe("undone");
    const undoAudits = await sql<{ scope_kind: string; action_type: string }>(
      "SELECT scope_kind, action_type FROM ontology_actions WHERE id = ANY($1::text[]) ORDER BY scope_kind", [back.actionIds]);
    expect(undoAudits).toEqual([{ scope_kind: "chat_session", action_type: "undoForget" }, { scope_kind: "personal", action_type: "undoForget" }]);

    // 撤过再撤 ⇒ KG_CARD_STALE（HTTP 409）
    await expect(undo(card.cardId)).rejects.toMatchObject({ code: "KG_CARD_STALE" });
    await expect(ctl.undoCard({ userId: OWNER, orgId: ORG } as never, card.cardId)).rejects.toBeInstanceOf(ConflictException);
  });

  it("同一个对话里：忘掉本会话那条 ⇒ F07 级联把由它记进长期记忆的副本一起收掉；撤销只恢复这张卡忘掉的", async () => {
    await say(T.p4, TODO);
    const src = await threadClaimBy(T.p4, TODO);
    const l1 = await promote(T.p4, src.id);
    const t = await turn(T.p4, "忘掉报价单那条");
    const card = await cardOf(T.p4, t.answerId);
    expect(card.items.map((i) => i.claimId)).toEqual([src.id]);
    await act(card.cardId);
    // 级联：长期记忆的副本 revocation_reason 跟着是 user_forgot
    expect(await claim(l1)).toMatchObject({ revoked: true, revocation_reason: "user_forgot" });
    expect(await personalLive(TODO)).toEqual([]);
    // 期间别的原因失效的不算这张卡的：把副本改成「别的原因」失效，撤销时它不回来
    await asOwner((c) => c.query("UPDATE claims SET revocation_reason = 'source_deleted' WHERE id = $1", [l1]));
    const back = await undo(card.cardId);
    expect(back.card.state).toBe("undone");
    expect(await claim(src.id)).toMatchObject({ revoked: false });
    expect(await claim(l1)).toMatchObject({ revoked: true, revocation_reason: "source_deleted" });
  });

  it("还开着 / 点了「不用了」的卡不能撤销；项目会话里不出忘掉卡、项目的那条不动", async () => {
    const t = await turn(T.x1, "忘掉张三的电话");
    // 本人个人空间里没有相关的 ⇒ 不出卡，照 A2 说没找到
    expect(t.note).toContain("没找到");
    expect(await sql("SELECT id FROM kg_memory_cards WHERE run_id = $1", [t.runId])).toEqual([]);
    await say(T.x2, CONTACT);
    const t2 = await turn(T.x2, "忘掉关于王经理的");
    const card = await cardOf(T.x2, t2.answerId);
    await expect(undo(card.cardId)).rejects.toMatchObject({ code: "KG_CARD_STALE" });
    await act(card.cardId, { decision: "dismiss" });
    await expect(undo(card.cardId)).rejects.toMatchObject({ code: "KG_CARD_STALE" });

    await say(T.s, CONTACT);
    const inProject = await threadClaimBy(T.s, CONTACT);
    const pt = await turn(T.s, "忘掉关于王经理的");
    expect(pt.note).toContain("个人对话");
    expect(await sql("SELECT id FROM kg_memory_cards WHERE run_id = $1", [pt.runId])).toEqual([]);
    expect(await claim(inProject.id)).toMatchObject({ revoked: false });
  });
});

/* ── 越权：跨账号一律 404，不泄露存在性 ─────────────────────────── */

describe("#4361 越权防护", () => {
  it("别人撤我的忘掉卡 / 撤不存在的卡 ⇒ 同一个 404；Agent ⇒ KG_ACTOR_NOT_HUMAN；绕过应用层直调数据库同样拒；卡不动", async () => {
    await say(T.o1, CONTACT);
    const t = await turn(T.o1, "忘掉关于王经理的");
    const card = await cardOf(T.o1, t.answerId);
    await act(card.cardId);

    await expect(undo(card.cardId, MEMBER)).rejects.toMatchObject({ code: "KG_CARD_NOT_FOUND" });
    await expect(undo("card-does-not-exist", MEMBER)).rejects.toMatchObject({ code: "KG_CARD_NOT_FOUND" });
    await expect(ctl.undoCard({ userId: MEMBER, orgId: ORG } as never, card.cardId)).rejects.toBeInstanceOf(NotFoundException);
    const missing = await ctl.undoCard({ userId: MEMBER, orgId: ORG } as never, "card-does-not-exist").catch((e: unknown) => e);
    const foreign = await ctl.undoCard({ userId: MEMBER, orgId: ORG } as never, card.cardId).catch((e: unknown) => e);
    expect((foreign as NotFoundException).getResponse()).toEqual((missing as NotFoundException).getResponse());
    await expect(undo(card.cardId, OWNER, "agent")).rejects.toMatchObject({ code: "KG_ACTOR_NOT_HUMAN" });
    const raw = (user: string | null) => asApp(ORG, async (c) => {
      if (user !== null) await c.query("SELECT set_config('app.current_user_id', $1, true)", [user]);
      return c.query("SELECT kg_undo_memory_card($1::jsonb)", [JSON.stringify({ action_id: newKgId("act"), card_id: card.cardId, actor_kind: "human" })]);
    });
    await expect(raw(MEMBER)).rejects.toThrow(/KG_NOT_OWNER/);
    await expect(raw(null)).rejects.toThrow(/KG_ACTOR_NOT_HUMAN/);
    expect((await sql<{ status: string }>("SELECT status FROM kg_memory_cards WHERE id = $1", [card.cardId]))[0]!.status).toBe("done");
  });

  it("别人的忘掉 / 清单卡只列他自己的；开卡函数不收别人的 id", async () => {
    const mine = await personalLive(CONTACT);
    const mt = await turn(T.m, "你记得我什么", MEMBER);
    expect(mt.note).toContain("还没有记住任何事");
    expect(await sql("SELECT id FROM kg_memory_cards WHERE run_id = $1", [mt.runId])).toEqual([]);
    const ft = await turn(T.m, "忘掉关于王经理的", MEMBER);
    expect(ft.note).toContain("没找到");
    // 直调开卡函数、塞进 owner 的 id ⇒ 一条都不收
    const msg = `m-i4361-${String(++seq)}`;
    await addChatMessage({ orgId: ORG, id: msg, threadId: T.m, body: "忘掉：王经理", authorId: MEMBER });
    const out = await asApp(ORG, async (c) => (await c.query<{ r: { outcome: string } }>("SELECT kg_open_memory_card($1::jsonb) AS r", [JSON.stringify({
      card_id: newKgId("card"), run_id: newKgId("run"), thread_id: T.m, message_id: msg, requester: MEMBER, kind: "overview",
      claim_ids: mine.map((x) => x.id),
    })])).rows[0]!.r);
    expect(out).toEqual({ outcome: "no_items" });
  });
});

/* ── 我改主意了 → Y：R8 分级 ─────────────────────────────────────── */

describe("#4361 我改主意了", () => {
  it("明确 + 高把握（same_kind）⇒ 这一轮就自动取代（不靠抽取模型），回答下一行「已用〈新〉取代〈旧〉」、可撤销；召回读的是取代之后的样子", async () => {
    await say(T.c1, OLD);
    const [old] = await personalLive(OLD);
    expect(old).toBeDefined();

    const t = await turn(T.c2, "我改主意了，改成关注985高校");
    expect(t.note).toContain("取代");
    expect(t.note).toContain("改成关注985高校");
    expect(t.note).toContain(OLD);
    // 召回在改口之后：旧说法不再交给模型
    expect(t.memory ?? "").not.toContain("211");
    expect(await claim(old!.id)).toMatchObject({ revoked: true, revocation_reason: "decision_changed" });
    expect(await personalLive("改成关注985高校")).toHaveLength(1);
    const tm = await turnMemory(T.c2, t.answerId);
    expect(tm.supersede).toMatchObject({ state: "applied", newerClaim: { statement: "改成关注985高校" }, olderClaim: { id: old!.id } });
    // 抽取任务之后再来处理这条消息：同一个幂等键 ⇒ 不会多出第二条
    expect((await read(T.c2)).claims.filter((c) => c.statement === "改成关注985高校")).toHaveLength(1);

    // 撤销（R8 同一个动作）⇒ 旧的回来
    await applyHumanAction({ ...deps, actions: new PgHumanAction(db), newId: newKgId }, {
      userId: OWNER, orgId: ORG_ID, threadId: T.c2, basedOnRevision: (await read(T.c2)).revision,
      action: { type: "undoSupersede", noticeId: tm.supersede!.noticeId },
    });
    expect(await claim(old!.id)).toMatchObject({ revoked: false });
    // 再改回来（给下一个用例一个干净的起点）
    await asOwner((c) => c.query("UPDATE claims SET status = 'superseded', revoked_at = now(), revocation_reason = 'decision_changed' WHERE id = $1", [old!.id]));
  });

  it("只到 frame_only ⇒ 不自动：回答下一张「用〈新〉取代〈旧〉？」卡，两条都照常生效", async () => {
    const [cur] = await personalLive("改成关注985高校");
    const t = await turn(T.c3, "我改主意了，改成关注C9");
    expect(t.note).toContain("要不要用");
    const tm = await turnMemory(T.c3, t.answerId);
    expect(tm.supersede).toBeNull();
    expect(tm.prompt).toMatchObject({ type: "conflict", conflict: { kind: "possible_change", olderClaim: { id: cur!.id } } });
    expect(await claim(cur!.id)).toMatchObject({ revoked: false });
    expect(await personalLive("改成关注C9")).toHaveLength(1);
  });

  it("反对 / 不相干 / 没说中哪条 ⇒ 什么都不写（没有新结论、没有提示、没有卡）；对照：点名旧对象的改口会取代", async () => {
    const before = await sql<{ n: string }>("SELECT count(*) AS n FROM claims WHERE org_id = $1", [ORG]);
    for (const text of ["改成关注北大，我反对", "把报告改成英文", "我改主意了，改成周五开会"]) {
      const t = await turn(T.c4, text);
      expect(t.note, text).toBeNull();
      const tm = await turnMemory(T.c4, t.answerId);
      expect(tm.supersede, text).toBeNull();
      expect(tm.prompt, text).toBeNull();
    }
    expect(await sql<{ n: string }>("SELECT count(*) AS n FROM claims WHERE org_id = $1", [ORG])).toEqual(before);
    // 对照（不让上面的「什么都不写」空洞成立）：点名旧对象的改口（「不再关注C9了」对「改成关注C9」，explicit）⇒ 这一轮就取代
    const control = await turn(T.c4, "我改主意了，不再关注C9了");
    expect(control.note).toContain("取代了长期记忆里的「改成关注C9」");
    expect((await turnMemory(T.c4, control.answerId)).supersede).toMatchObject({ state: "applied", olderClaim: { statement: "改成关注C9" } });
  });

  it("项目会话 / 别人 ⇒ 不碰：本人长期记忆里的决定原样", async () => {
    const [cur] = await personalLive("改成关注985高校");
    const pt = await turn(T.s, "我改主意了，改成关注清华高校");
    expect(pt.note).toBeNull();
    const mt = await turn(T.m, "我改主意了，改成关注清华高校", MEMBER);
    expect(mt.note).toBeNull();
    expect(await claim(cur!.id)).toMatchObject({ revoked: false });
    expect(await sql("SELECT id FROM kg_supersede_notices WHERE org_id = $1 AND message_id = ANY($2::text[])", [ORG, [pt.msg, mt.msg]])).toEqual([]);
  });

  it("没接改口端口（旧的执行器构造）⇒ 与 #4361 之前相同：不做", async () => {
    const [cur] = await personalLive("改成关注985高校");
    const t = await turn(T.c5, "我改主意了，改成关注清华高校", OWNER, false);
    expect(t.note).toBeNull();
    expect(await claim(cur!.id)).toMatchObject({ revoked: false });
  });
});

/* ── 你记得我什么 ─────────────────────────────────────────────────── */

describe("#4361 你记得我什么", () => {
  it("按种类分组、每条带来源对话；给模型的是同一份分组清单；忘掉一条后清单里没有了；清单卡不接受任何决定", async () => {
    await say(T.o2, TODO);
    const t = await turn(T.o2, "你记得我什么？");
    expect(t.note).toContain("按种类分组");
    expect(t.note).toMatch(/决定：\n- /);
    expect(t.note).toContain("待办：");
    const card = await cardOf(T.o2, t.answerId);
    expect(card).toMatchObject({ kind: "overview", state: "open" });
    const kinds = card.items.map((i) => i.claimKind);
    expect(kinds).toContain("decision");
    expect(kinds).toContain("todo");
    // 分组次序（契约 KG_CLAIM_KIND_DISPLAY_ORDER）：决定在前
    expect(kinds.indexOf("decision")).toBeLessThan(kinds.indexOf("todo"));
    const todoItem = card.items.find((i) => i.statement === TODO)!;
    expect(todoItem.source).toEqual({ threadId: T.o2, title: "对话o2" });
    const decisionItem = card.items.find((i) => i.statement === "改成关注985高校")!;
    expect(decisionItem.source).toEqual({ threadId: T.c2, title: "对话c2" });
    // 只有本人读得到这张清单（别人读这一轮 ⇒ 会话都看不见）
    await expect(turnMemory(T.o2, t.answerId, MEMBER)).rejects.toMatchObject({ code: "KG_THREAD_NOT_FOUND" });
    // 清单卡上的任何决定 ⇒ KG_INVALID_REQUEST
    await expect(act(card.cardId)).rejects.toMatchObject({ code: "KG_INVALID_REQUEST" });
    await expect(act(card.cardId, { decision: "dismiss" })).rejects.toMatchObject({ code: "KG_INVALID_REQUEST" });

    // 忘掉那条待办 ⇒ 这一轮的清单按现在的事实读，不再列它
    const f = await turn(T.o2, "忘掉报价单那条");
    await act((await cardOf(T.o2, f.answerId)).cardId);
    expect((await cardOf(T.o2, t.answerId)).items.map((i) => i.statement)).not.toContain(TODO);
  });

  it("项目会话里问 ⇒ 不列个人记忆、如实说去个人对话看", async () => {
    const t = await turn(T.s, "你记得我什么");
    expect(t.note).toContain("个人对话");
    expect(t.note).not.toContain("改成关注985高校");
    expect(await sql("SELECT id FROM kg_memory_cards WHERE run_id = $1", [t.runId])).toEqual([]);
  });
});
