/**
 * S7（#4364）—— 回答下的引用 chip：服务端对账 + 当场纠正（「这条不对」/「已过时」）+ 纠正率。真实数据库。
 *
 * - chip 只从**这一轮的召回集合**里出、且只出回答真的用到的那几条：回答里提到一条没被召回的说法（库里真有、
 *   或模型编的）⇒ 不出 chip；召回了却没用到 ⇒ 也不出。
 * - 纠正生效后，**下一轮**召回不再用那一条（真实召回 `knowledgeMemoryFor`，不是读模型打桩）。
 * - 越权：不是所有者 / 不是这一轮的提问人 / 不是这一轮的引用 / 别人的会话 ⇒ 拒绝，数据库一侧再挡一次。
 * - 纠正率 = 纠正 / 被引用（`getCitationMetrics`）。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { correctCitation, getCitationMetrics, type CitationCorrectionDeps } from "../../src/application/knowledge-graph/correct-citation";
import { newKgId } from "../../src/application/knowledge-graph/ids";
import { KgHumanActionError } from "../../src/application/knowledge-graph/ports";
import { getPersonalKnowledge } from "../../src/application/knowledge-graph/read-personal-knowledge";
import { getTurnMemory, KgReadError } from "../../src/application/knowledge-graph/read-thread-knowledge";
import { knowledgeMemoryFor } from "../../src/application/knowledge-graph/recall-knowledge";
import { toOrgId } from "../../src/domain/org-id";
import { appConfig } from "../../src/infrastructure/db/pg-config";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { PgCitationCorrection } from "../../src/infrastructure/knowledge-graph/pg-citation-correction";
import { PgKnowledgeRecall } from "../../src/infrastructure/knowledge-graph/pg-knowledge-recall";
import { addChatMessage } from "../support/chat-db";
import { asOwner } from "../support/db";
import { DEMAND, seedL1Org, type L1Org } from "./kg-l1-fixtures";

const ORG = "org-kg-s7-cite";
const ORG_ID = toOrgId(ORG);
let db: PgDatabase;
let port: PgKnowledgeRecall;
let corrections: PgCitationCorrection;
let fx: L1Org;
let deps: CitationCorrectionDeps;
const log = () => undefined;

const INVOICE = "客户 A 要求发票按月开具";
const LANGUAGE = "客户 A 要求交付物用中文";
const LANGUAGE_NEW = "客户 A 要求交付物用英文";
const MEETING = "客户 A 要求每周五开例会";
const UNUSED = "客户 A 偏好周末不打电话";

const sqlRows = <T>(q: string, params: unknown[] = []) => asOwner(async (c) => (await c.query(q, params)).rows as T[]);

async function insertClaim(id: string, statement: string, scope: { kind: "personal" | "chat_session" | "project"; id: string }) {
  await asOwner((c) => c.query(
    `INSERT INTO claims (id, org_id, statement, status, tsv, claim_kind, confidence, created_by, reviewed_by, scope_kind, scope_id, valid_from)
     VALUES ($1, $2, $3, 'accepted', to_tsvector('simple', $3), 'fact', 1, 'human', 'u-owner', $4, $5, now())`,
    [id, ORG, statement, scope.kind, scope.id]));
}

/** 一轮：这一轮的召回集合就是 `items`（执行器写下的那份记录），回答正文是 `body`。 */
async function turnWith(threadId: string, runId: string, items: readonly string[], body: string, requester = "u-owner") {
  await port.recordTurn(ORG_ID, {
    runId, threadId, userId: requester, graphDegraded: false,
    items: items.map((claimId) => ({ claimId, channels: ["fts"], retrievalReasons: ["recall"], score: 0.02, graphPath: null })),
  });
  const answerId = `ans-${runId}`;
  await addChatMessage({ orgId: ORG, id: answerId, threadId, body, authorId: "agent-1", authorKind: "agent", agentId: "agent-1" });
  await asOwner((c) => c.query("UPDATE chat_messages SET agent_run_id = $1 WHERE id = $2", [runId, answerId]));
  return answerId;
}

const read = (threadId: string, messageId: string, userId = "u-owner") => getTurnMemory(fx.readDeps, { userId, orgId: ORG_ID, threadId, messageId });
const recallText = (threadId: string, query: string, runId: string) =>
  knowledgeMemoryFor(port, { orgId: ORG_ID, userId: "u-owner", threadId, query, runId }, log);

async function rejected(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    if (e instanceof KgHumanActionError || e instanceof KgReadError) return e.code;
    throw e;
  }
  return "resolved";
}

beforeAll(async () => {
  db = new PgDatabase(appConfig());
  fx = await seedL1Org(db, ORG);
  port = new PgKnowledgeRecall(db);
  corrections = new PgCitationCorrection(db);
  deps = { ...fx.readDeps, corrections, expiry: corrections, newId: newKgId };
  await insertClaim("clm-s7-invoice", INVOICE, { kind: "personal", id: "u-owner" });
  await insertClaim("clm-s7-lang", LANGUAGE, { kind: "chat_session", id: fx.B });
  await insertClaim("clm-s7-meeting", MEETING, { kind: "personal", id: "u-owner" });
  await insertClaim("clm-s7-unused", UNUSED, { kind: "personal", id: "u-owner" });
}, 600_000);
afterAll(async () => { await db.close(); });

describe("S7：引用 chip 由服务端对账", () => {
  it("chip = 召回集合 ∩ 回答真的用到的；回答里提到没被召回的说法（库里真有的 / 编的）不出 chip", async () => {
    // 这一轮召回了 DEMAND 与 UNUSED；回答用了 DEMAND，没用 UNUSED；又提到了项目会话 S 里真有的一条、和一条编的——都不在召回里。
    const answer = await turnWith(fx.B, "run-s7-recon", [fx.personalClaimId, "clm-s7-unused"],
      `根据你之前说的：${DEMAND}。另外，客户 A 的合同在法务那里；客户 A 要求所有页面都用红色。`);
    const out = await read(fx.B, answer);
    expect(out.recalled.map((r) => r.claimId)).toEqual([fx.personalClaimId, "clm-s7-unused"]);
    expect(out.cited).toEqual([fx.personalClaimId]);
    expect(out.canCorrect).toBe(true);
    const [sClaim] = await sqlRows<{ id: string }>(
      "SELECT id FROM claims WHERE org_id = $1 AND scope_kind = 'chat_session' AND scope_id = $2 AND statement = '客户 A 的合同在法务那里'", [ORG, fx.S]);
    expect(sClaim).toBeDefined();
    expect(out.cited).not.toContain(sClaim!.id);
    expect(out.cited!.every((id) => out.recalled.some((r) => r.claimId === id))).toBe(true);
  });

  it("回答没用到任何召回的记忆 ⇒ 没有 chip（召回照旧列在「为什么用到它」里）", async () => {
    const answer = await turnWith(fx.B, "run-s7-none", [fx.personalClaimId], "好的，我们换个话题：今天天气不错。");
    const out = await read(fx.B, answer);
    expect(out.recalled).toHaveLength(1);
    expect(out.cited).toEqual([]);
  });
});

describe("S7：越权防护", () => {
  it("别人的会话 ⇒ 看不见（KG_THREAD_NOT_FOUND）；项目会话里不是所有者的成员 ⇒ KG_NOT_OWNER", async () => {
    const answer = await turnWith(fx.B, "run-s7-authz", [fx.personalClaimId], `你说过：${DEMAND}。`);
    expect(await rejected(correctCitation(deps, { userId: "u-other", orgId: ORG_ID, threadId: fx.B, messageId: answer, claimId: fx.personalClaimId, kind: "wrong" })))
      .toBe("KG_THREAD_NOT_FOUND");
    const [shared] = await sqlRows<{ id: string }>(
      "SELECT id FROM claims WHERE org_id = $1 AND scope_kind = 'chat_session' AND scope_id = $2 AND revoked_at IS NULL LIMIT 1", [ORG, fx.S]);
    const sAnswer = await turnWith(fx.S, "run-s7-member", [shared!.id], "客户 A 的合同在法务那里。", "u-member");
    // review F6：界面据 canCorrect 给不给入口——提问的成员不是所有者、所有者不是这一轮的提问人 ⇒ 都是 false
    expect((await read(fx.S, sAnswer, "u-member")).canCorrect).toBe(false);
    expect((await read(fx.S, sAnswer, "u-owner")).canCorrect).toBe(false);
    expect(await rejected(correctCitation(deps, { userId: "u-member", orgId: ORG_ID, threadId: fx.S, messageId: sAnswer, claimId: shared!.id, kind: "wrong" })))
      .toBe("KG_NOT_OWNER");
    // 所有者也不能替别人那一轮纠正：数据库核的是「这一轮的提问人」
    expect(await rejected(correctCitation(deps, { userId: "u-owner", orgId: ORG_ID, threadId: fx.S, messageId: sAnswer, claimId: shared!.id, kind: "expired" })))
      .toBe("KG_CLAIM_NOT_FOUND");
    expect((await sqlRows<{ n: string }>("SELECT count(*) AS n FROM claims WHERE id = $1 AND revoked_at IS NULL", [shared!.id]))[0]!.n).toBe("1");
  });

  it("不是这一轮的引用（召回了没用到 / 根本没召回）⇒ KG_CLAIM_NOT_FOUND；绕过应用层直接调数据库也一样", async () => {
    const answer = await turnWith(fx.B, "run-s7-notcited", [fx.personalClaimId, "clm-s7-unused"], `你说过：${DEMAND}。`);
    for (const claimId of ["clm-s7-unused", "clm-s7-invoice"]) {
      expect(await rejected(correctCitation(deps, { userId: "u-owner", orgId: ORG_ID, threadId: fx.B, messageId: answer, claimId, kind: "wrong" })))
        .toBe("KG_CLAIM_NOT_FOUND");
    }
    // 数据库一侧：不在召回集合里的 id 直接拒（「模型编不出 chip」在写侧也成立）
    expect(await rejected(corrections.retract(ORG_ID, "u-owner",
      { actionId: newKgId("act"), threadId: fx.B, messageId: answer, claimId: "clm-s7-invoice" }, null))).toBe("KG_CLAIM_NOT_FOUND");
    expect((await sqlRows<{ n: string }>("SELECT count(*) AS n FROM claims WHERE id IN ('clm-s7-unused', 'clm-s7-invoice') AND revoked_at IS NULL"))[0]!.n).toBe("2");
  });

  it("「已过时」不接受新说法（KG_INVALID_REQUEST）", async () => {
    const answer = await turnWith(fx.B, "run-s7-badreq", [fx.personalClaimId], `你说过：${DEMAND}。`);
    expect(await rejected(correctCitation(deps, {
      userId: "u-owner", orgId: ORG_ID, threadId: fx.B, messageId: answer, claimId: fx.personalClaimId, kind: "expired", replacement: "x",
    }))).toBe("KG_INVALID_REQUEST");
  });
});

describe("S7：纠正之后下一轮不再用它", () => {
  it("「这条不对」（没给新说法）⇒ 忘掉：下一轮召回不再带它，之前那条回答下也不再引用", async () => {
    const q = "客户 A 对发票有什么要求？";
    expect(await recallText(fx.B, q, "run-s7-inv-pre")).toContain(INVOICE);
    const answer = await turnWith(fx.B, "run-s7-inv", ["clm-s7-invoice"], `你之前说过：${INVOICE}。`);
    expect((await read(fx.B, answer)).cited).toEqual(["clm-s7-invoice"]);
    const out = await correctCitation(deps, { userId: "u-owner", orgId: ORG_ID, threadId: fx.B, messageId: answer, claimId: "clm-s7-invoice", kind: "wrong" });
    expect(out).toEqual({ outcome: "forgotten", newClaimId: null });
    expect(await recallText(fx.B, q, "run-s7-inv-next")).not.toContain(INVOICE);
    expect((await read(fx.B, answer)).cited).toEqual([]);
    const [row] = await sqlRows<{ revocation_reason: string }>("SELECT revocation_reason FROM claims WHERE id = 'clm-s7-invoice'");
    expect(row!.revocation_reason).toBe("user_citation_wrong");
    // 同一条不能再纠正第二次（已经不在了）
    expect(await rejected(correctCitation(deps, { userId: "u-owner", orgId: ORG_ID, threadId: fx.B, messageId: answer, claimId: "clm-s7-invoice", kind: "wrong" })))
      .toBe("KG_CLAIM_NOT_FOUND");
  });

  it("「这条不对」+ 新说法 ⇒ 取代：下一轮用新说法，旧说法不再出现；证据挂到新说法上", async () => {
    const q = "客户 A 对交付物有什么要求？";
    expect(await recallText(fx.B, q, "run-s7-lang-pre")).toContain(LANGUAGE);
    const answer = await turnWith(fx.B, "run-s7-lang", ["clm-s7-lang"], `记得你说过：${LANGUAGE}。`);
    const out = await correctCitation(deps, {
      userId: "u-owner", orgId: ORG_ID, threadId: fx.B, messageId: answer, claimId: "clm-s7-lang", kind: "wrong", replacement: LANGUAGE_NEW,
    });
    expect(out.outcome).toBe("superseded");
    expect(out.newClaimId).not.toBeNull();
    const next = await recallText(fx.B, q, "run-s7-lang-next");
    expect(next).toContain(LANGUAGE_NEW);
    expect(next).not.toContain(LANGUAGE);
    const [neu] = await sqlRows<{ supersedes_claim_id: string; scope_kind: string; scope_id: string }>(
      "SELECT supersedes_claim_id, scope_kind, scope_id FROM claims WHERE id = $1", [out.newClaimId]);
    expect(neu).toEqual({ supersedes_claim_id: "clm-s7-lang", scope_kind: "chat_session", scope_id: fx.B });
  });

  it("「已过时」⇒ expireClaim = valid_to 到此刻（F4，S6 #4363）：不撤；下一轮不再用它；/brain 标「已过期」；再点一次不重复记", async () => {
    const q = "客户 A 对例会有什么要求？";
    expect(await recallText(fx.B, q, "run-s7-meet-pre")).toContain(MEETING);
    const answer = await turnWith(fx.B, "run-s7-meet", ["clm-s7-meeting"], `你说过：${MEETING}。`);
    const out = await correctCitation(deps, { userId: "u-owner", orgId: ORG_ID, threadId: fx.B, messageId: answer, claimId: "clm-s7-meeting", kind: "expired" });
    expect(out).toEqual({ outcome: "expired", newClaimId: null });
    expect(await recallText(fx.B, q, "run-s7-meet-next")).not.toContain(MEETING);
    const [row] = await sqlRows<{ revocation_reason: string | null; revoked: boolean; status: string; expired: boolean }>(
      `SELECT revocation_reason, revoked_at IS NOT NULL AS revoked, status, valid_to IS NOT NULL AND valid_to <= now() AS expired
         FROM claims WHERE id = 'clm-s7-meeting'`);
    expect(row).toEqual({ revocation_reason: null, revoked: false, status: "accepted", expired: true });
    // /brain（本人长期记忆）：照旧列出，标「已过期」——不是被撤掉
    const brain = await getPersonalKnowledge(fx.readDeps, { userId: "u-owner", orgId: ORG_ID });
    expect(brain.claims.find((c) => c.id === "clm-s7-meeting")).toMatchObject({ statement: MEETING, expired: true });
    // 已经过期的再点「已过时」：同「不在了」，不再记一条纠正事件
    const before = (await sqlRows<{ n: string }>("SELECT count(*) AS n FROM kg_citation_corrections WHERE claim_id = 'clm-s7-meeting'"))[0]!.n;
    expect(await rejected(correctCitation(deps, { userId: "u-owner", orgId: ORG_ID, threadId: fx.B, messageId: answer, claimId: "clm-s7-meeting", kind: "expired" })))
      .toBe("KG_CLAIM_NOT_FOUND");
    expect((await sqlRows<{ n: string }>("SELECT count(*) AS n FROM kg_citation_corrections WHERE claim_id = 'clm-s7-meeting'"))[0]!.n).toBe(before);
  });

  it("F4：「这条不对」+ 新说法 ⇒ 新说法带上旧条的 valid_to / due_at / todo_state（S6 kg_revise_inherits_time）", async () => {
    await asOwner((c) => c.query(
      `INSERT INTO claims (id, org_id, statement, status, tsv, claim_kind, confidence, created_by, reviewed_by, scope_kind, scope_id,
                           valid_from, valid_to, due_at, todo_state)
       VALUES ('clm-s7-todo', $1, '周三前把报价单发给客户 A', 'accepted', to_tsvector('simple', '周三前把报价单发给客户 A'), 'todo', 1,
               'human', 'u-owner', 'chat_session', $2, now() - interval '1 day', now() + interval '30 days', now() + interval '2 days', 'done')`,
      [ORG, fx.B]));
    const answer = await turnWith(fx.B, "run-s7-todo", ["clm-s7-todo"], "你说过：周三前把报价单发给客户 A。");
    const out = await correctCitation(deps, {
      userId: "u-owner", orgId: ORG_ID, threadId: fx.B, messageId: answer, claimId: "clm-s7-todo", kind: "wrong", replacement: "周四前把报价单发给客户 A",
    });
    const rows = await sqlRows<{ id: string; valid_to: Date; due_at: Date; todo_state: string }>(
      "SELECT id, valid_to, due_at, todo_state FROM claims WHERE id = ANY($1::text[]) ORDER BY id = 'clm-s7-todo' DESC", [["clm-s7-todo", out.newClaimId]]);
    const [old, neu] = rows;
    expect(neu!.todo_state).toBe("done");
    expect(neu!.valid_to.toISOString()).toBe(old!.valid_to.toISOString());
    expect(neu!.due_at.toISOString()).toBe(old!.due_at.toISOString());
  });
});

/**
 * review F1：会话里的原说法 ⇄ 它记进本人长期记忆的副本（derived_from）是「一家」。纠正任何一份，整家都不再被召回，
 * 新说法只落一份（落在长期记忆里），也不带 derived_from（review F2）。
 */
async function family(tag: string, statement: string) {
  const session = `clm-s7-fam-${tag}-s`;
  const personal = `clm-s7-fam-${tag}-p`;
  await insertClaim(session, statement, { kind: "chat_session", id: fx.A });
  await insertClaim(personal, statement, { kind: "personal", id: "u-owner" });
  await asOwner(async (c) => {
    for (const id of [session, personal]) {
      await c.query(
        "INSERT INTO claim_message_evidence (claim_id, org_id, message_id, stance, excerpt) VALUES ($1, $2, $3, 'supporting', $4)",
        [id, ORG, `m-${fx.A}`, statement]);
    }
    await c.query(
      `INSERT INTO ontology_edges (id, org_id, src_kind, src_id, dst_kind, dst_id, relation, created_by, scope_kind, scope_id)
       VALUES ($1, $2, 'claim', $3, 'claim', $4, 'derived_from', 'model', 'personal', 'u-owner')`,
      [`edge-s7-fam-${tag}`, ORG, personal, session]);
  });
  return { session, personal };
}
const live = (statement: string) => sqlRows<{ id: string; scope_kind: string }>(
  "SELECT id, scope_kind FROM claims WHERE org_id = $1 AND statement = $2 AND revoked_at IS NULL AND status <> 'superseded' ORDER BY id",
  [ORG, statement]);

describe("S7 review F1：纠正落在整家（会话原说法 ⇄ 长期记忆副本）", () => {
  it("在原对话里纠正会话那条（带新说法）⇒ 长期记忆副本也不再生效；新说法只一份、在长期记忆里；两个对话下一轮都只用新说法", async () => {
    const OLD = "客户 A 要求报价单用美元";
    const NEW = "客户 A 要求报价单用人民币";
    const f = await family("a", OLD);
    const q = "客户 A 对报价单有什么要求？";
    expect(await recallText(fx.B, q, "run-s7-fa-pre")).toContain(OLD);
    const answer = await turnWith(fx.A, "run-s7-fa", [f.session], `你说过：${OLD}。`);
    expect((await read(fx.A, answer)).cited).toEqual([f.session]);
    const out = await correctCitation(deps, {
      userId: "u-owner", orgId: ORG_ID, threadId: fx.A, messageId: answer, claimId: f.session, kind: "wrong", replacement: NEW,
    });
    expect(out.outcome).toBe("superseded");
    expect(await live(OLD)).toEqual([]);
    expect(await live(NEW)).toEqual([{ id: out.newClaimId, scope_kind: "personal" }]);
    for (const [thread, run] of [[fx.A, "run-s7-fa-a"], [fx.B, "run-s7-fa-b"]] as const) {
      const next = await recallText(thread, q, run);
      expect(next).toContain(NEW);
      expect(next).not.toContain(OLD);
      expect(next!.split(NEW).length - 1).toBe(1);
    }
    // F2：新说法不带 derived_from；证据保留（来源抽屉 / 跳回原消息还能用）
    const edges = await sqlRows<{ n: string }>(
      "SELECT count(*) AS n FROM ontology_edges WHERE org_id = $1 AND relation = 'derived_from' AND (src_id = $2 OR dst_id = $2)", [ORG, out.newClaimId]);
    expect(edges[0]!.n).toBe("0");
    const ev = await sqlRows<{ message_id: string }>("SELECT message_id FROM claim_message_evidence WHERE claim_id = $1", [out.newClaimId]);
    expect(ev).toEqual([{ message_id: `m-${fx.A}` }]);
    const [neu] = await sqlRows<{ supersedes_claim_id: string }>("SELECT supersedes_claim_id FROM claims WHERE id = $1", [out.newClaimId]);
    expect(neu!.supersedes_claim_id).toBe(f.personal);
    // delta review L4：anchor（长期记忆那份）只是被取代，不被 F07 顺着 derived_from 一起撤掉；家里那条边先收掉了
    const rows = await sqlRows<{ id: string; status: string; revoked: boolean }>(
      "SELECT id, status, revoked_at IS NOT NULL AS revoked FROM claims WHERE id = ANY($1::text[]) ORDER BY id", [[f.personal, f.session]]);
    expect(rows).toEqual([
      { id: f.personal, status: "superseded", revoked: false },
      { id: f.session, status: "superseded", revoked: true },
    ]);
    const [edge] = await sqlRows<{ status: string }>("SELECT status FROM ontology_edges WHERE id = 'edge-s7-fam-a'");
    expect(edge!.status).toBe("invalidated");
  });

  it("在新对话里纠正长期记忆那份（带新说法）⇒ 原对话里的会话那条也不再生效，原对话下一轮只用新说法（不重复）", async () => {
    const OLD = "客户 A 要求合同一式三份";
    const NEW = "客户 A 要求合同一式两份";
    const f = await family("b", OLD);
    const q = "客户 A 对合同份数有什么要求？";
    expect(await recallText(fx.A, q, "run-s7-fb-pre")).toContain(OLD);
    const answer = await turnWith(fx.B, "run-s7-fb", [f.personal], `你说过：${OLD}。`);
    const out = await correctCitation(deps, {
      userId: "u-owner", orgId: ORG_ID, threadId: fx.B, messageId: answer, claimId: f.personal, kind: "wrong", replacement: NEW,
    });
    expect(await live(OLD)).toEqual([]);
    expect(await live(NEW)).toEqual([{ id: out.newClaimId, scope_kind: "personal" }]);
    const next = await recallText(fx.A, q, "run-s7-fb-a");
    expect(next).toContain(NEW);
    expect(next).not.toContain(OLD);
    expect(next!.split(NEW).length - 1).toBe(1);
  });

  it("「这条不对」不带新说法纠正长期记忆那份 ⇒ 原对话里那条一起失效；「已过时」纠正会话那条 ⇒ 整家到期（不撤）", async () => {
    const f1 = await family("c", "客户 A 要求周报用英文");
    const a1 = await turnWith(fx.B, "run-s7-fc", [f1.personal], "你说过：客户 A 要求周报用英文。");
    await correctCitation(deps, { userId: "u-owner", orgId: ORG_ID, threadId: fx.B, messageId: a1, claimId: f1.personal, kind: "wrong" });
    expect(await live("客户 A 要求周报用英文")).toEqual([]);
    const f2 = await family("d", "客户 A 要求月报抄送财务");
    const a2 = await turnWith(fx.A, "run-s7-fd", [f2.session], "你说过：客户 A 要求月报抄送财务。");
    await correctCitation(deps, { userId: "u-owner", orgId: ORG_ID, threadId: fx.A, messageId: a2, claimId: f2.session, kind: "expired" });
    // F4：整家（会话那条 + 长期记忆副本）有效期到此刻、都不撤；家里的 derived_from 边不动
    const fam = await sqlRows<{ id: string; revoked: boolean; expired: boolean }>(
      `SELECT id, revoked_at IS NOT NULL AS revoked, valid_to IS NOT NULL AND valid_to <= now() AS expired
         FROM claims WHERE id = ANY($1::text[]) ORDER BY id`, [[f2.personal, f2.session]]);
    expect(fam).toEqual([
      { id: f2.personal, revoked: false, expired: true },
      { id: f2.session, revoked: false, expired: true },
    ]);
    expect((await sqlRows<{ status: string }>("SELECT status FROM ontology_edges WHERE id = 'edge-s7-fam-d'"))[0]!.status).toBe("active");
    expect(await recallText(fx.B, "客户 A 对月报有什么要求？", "run-s7-fd-b")).not.toContain("客户 A 要求月报抄送财务");
  });
});

const corrRows = async (claimId: string) =>
  (await sqlRows<{ n: string }>("SELECT count(*) AS n FROM kg_citation_corrections WHERE claim_id = $1", [claimId]))[0]!.n;

describe("F4 review（PR #4507）：窗口未开始的也能到期（M1）、S10 项目副本一起到期（M2）、审计只列真到期的（L1）、长期记忆 anchor 继承时间（L2）", () => {
  it("M1：有效期窗口还没开始的一条，点一次「已过时」就不再被召回；再点被拒、不多记一条纠正", async () => {
    const S = "客户 A 要求下季度起合同走电子签";
    await asOwner((c) => c.query(
      `INSERT INTO claims (id, org_id, statement, status, tsv, claim_kind, confidence, created_by, reviewed_by, scope_kind, scope_id, valid_from)
       VALUES ('clm-s7-future', $1, $2, 'accepted', to_tsvector('simple', $2), 'fact', 1, 'human', 'u-owner', 'personal', 'u-owner', now() + interval '10 days')`,
      [ORG, S]));
    const q = "客户 A 对合同签署有什么要求？";
    expect(await recallText(fx.B, q, "run-s7-fut-pre")).toContain(S);
    const answer = await turnWith(fx.B, "run-s7-fut", ["clm-s7-future"], `你说过：${S}。`);
    await correctCitation(deps, { userId: "u-owner", orgId: ORG_ID, threadId: fx.B, messageId: answer, claimId: "clm-s7-future", kind: "expired" });
    expect(await recallText(fx.B, q, "run-s7-fut-next")).not.toContain(S);
    const [row] = await sqlRows<{ expired: boolean; ordered: boolean }>(
      "SELECT valid_to <= now() AS expired, valid_from < valid_to AS ordered FROM claims WHERE id = 'clm-s7-future'");
    expect(row).toEqual({ expired: true, ordered: true });
    expect(await corrRows("clm-s7-future")).toBe("1");
    expect(await rejected(correctCitation(deps, { userId: "u-owner", orgId: ORG_ID, threadId: fx.B, messageId: answer, claimId: "clm-s7-future", kind: "expired" })))
      .toBe("KG_CLAIM_NOT_FOUND");
    expect(await corrRows("clm-s7-future")).toBe("1");
  });

  it("M2：长期记忆那条「已过时」⇒ S10 分享到项目的副本一起到期，项目成员下一轮不再召回；审计只列这一次真到期的（L1）", async () => {
    const S = "客户 A 要求验收报告用模板 B";
    await insertClaim("clm-s7-shared-p", S, { kind: "personal", id: "u-owner" });
    await insertClaim("clm-s7-shared-proj", S, { kind: "project", id: `${ORG}-p` });
    // 家里另一条早就过期了：这一次不该再算到它头上（L1）
    await insertClaim("clm-s7-shared-old", S, { kind: "chat_session", id: fx.A });
    await asOwner(async (c) => {
      await c.query(
        `INSERT INTO ontology_edges (id, org_id, src_kind, src_id, dst_kind, dst_id, relation, created_by, scope_kind, scope_id)
         VALUES ('edge-s7-share', $1, 'claim', 'clm-s7-shared-proj', 'claim', 'clm-s7-shared-p', 'derived_from', 'human', 'project', $2),
                ('edge-s7-share-old', $1, 'claim', 'clm-s7-shared-p', 'claim', 'clm-s7-shared-old', 'derived_from', 'model', 'personal', 'u-owner')`,
        [ORG, `${ORG}-p`]);
      // 边建好之后再让它过期（建边时 S6 kg_copy_inherits_time 会把来源的有效期抄到副本上）
      await c.query("UPDATE claims SET valid_from = now() - interval '2 days', valid_to = now() - interval '1 day' WHERE id = 'clm-s7-shared-old'");
    });
    const q = "客户 A 对验收报告有什么要求？";
    const memberRecall = (runId: string) =>
      knowledgeMemoryFor(port, { orgId: ORG_ID, userId: "u-member", threadId: fx.S, query: q, runId }, log);
    expect(await memberRecall("run-s7-share-pre")).toContain(S);
    const answer = await turnWith(fx.B, "run-s7-share", ["clm-s7-shared-p"], `你说过：${S}。`);
    await correctCitation(deps, { userId: "u-owner", orgId: ORG_ID, threadId: fx.B, messageId: answer, claimId: "clm-s7-shared-p", kind: "expired" });
    expect(await memberRecall("run-s7-share-next")).not.toContain(S);
    const [proj] = await sqlRows<{ revoked: boolean; expired: boolean }>(
      "SELECT revoked_at IS NOT NULL AS revoked, valid_to <= now() AS expired FROM claims WHERE id = 'clm-s7-shared-proj'");
    expect(proj).toEqual({ revoked: false, expired: true });
    const audits = await sqlRows<{ scope_kind: string; claims: { id: string }[] }>(
      `SELECT scope_kind, payload->'claims' AS claims FROM ontology_actions
        WHERE org_id = $1 AND action_type = 'expireClaim' AND payload->>'via' = 'citation'
          AND (payload->'claims' @> '[{"id":"clm-s7-shared-p"}]'::jsonb OR payload->'claims' @> '[{"id":"clm-s7-shared-proj"}]'::jsonb)
        ORDER BY scope_kind`, [ORG]);
    expect(audits).toEqual([
      { scope_kind: "personal", claims: [{ id: "clm-s7-shared-p" }] },
      { scope_kind: "project", claims: [{ id: "clm-s7-shared-proj" }] },
    ]);
  });

  it("N1：项目对话里的会话结论「已过时」⇒ R7 记到项目大脑的副本、以及合并进去的同事的项目结论都不动，也不写项目作用域的审计", async () => {
    const S = "客户 A 要求周会纪要当天发出";
    await insertClaim("clm-s7-n1-s", S, { kind: "chat_session", id: fx.S });
    await insertClaim("clm-s7-n1-r7", S, { kind: "project", id: `${ORG}-p` });
    await insertClaim("clm-s7-n1-colleague", S, { kind: "project", id: `${ORG}-p` });
    await asOwner(async (c) => {
      await c.query("UPDATE claims SET reviewed_by = 'u-member' WHERE id = 'clm-s7-n1-colleague'");
      await c.query(
        `INSERT INTO ontology_edges (id, org_id, src_kind, src_id, dst_kind, dst_id, relation, created_by, scope_kind, scope_id)
         VALUES ('edge-s7-n1-r7', $1, 'claim', 'clm-s7-n1-r7', 'claim', 'clm-s7-n1-s', 'derived_from', 'human', 'project', $2),
                ('edge-s7-n1-merge', $1, 'claim', 'clm-s7-n1-colleague', 'claim', 'clm-s7-n1-s', 'derived_from', 'human', 'project', $2)`,
        [ORG, `${ORG}-p`]);
    });
    const answer = await turnWith(fx.S, "run-s7-n1", ["clm-s7-n1-s"], `你说过：${S}。`);
    const out = await correctCitation(deps, { userId: "u-owner", orgId: ORG_ID, threadId: fx.S, messageId: answer, claimId: "clm-s7-n1-s", kind: "expired" });
    expect(out.outcome).toBe("expired");
    const rows = await sqlRows<{ id: string; expired: boolean; revoked: boolean }>(
      `SELECT id, coalesce(valid_to <= now(), false) AS expired, revoked_at IS NOT NULL AS revoked FROM claims
        WHERE id = ANY($1::text[]) ORDER BY id`, [["clm-s7-n1-s", "clm-s7-n1-r7", "clm-s7-n1-colleague"]]);
    expect(Object.fromEntries(rows.map((r) => [r.id, [r.expired, r.revoked]]))).toEqual({
      "clm-s7-n1-s": [true, false],
      "clm-s7-n1-r7": [false, false],
      "clm-s7-n1-colleague": [false, false],
    });
    const projectAudits = await sqlRows<{ n: string }>(
      `SELECT count(*) AS n FROM ontology_actions WHERE org_id = $1 AND scope_kind = 'project' AND action_type = 'expireClaim'
          AND payload->>'via' = 'citation' AND payload->'claims' @> ANY(ARRAY['[{"id":"clm-s7-n1-r7"}]'::jsonb, '[{"id":"clm-s7-n1-colleague"}]'::jsonb])`,
      [ORG]);
    expect(projectAudits[0]!.n).toBe("0");
  });

  it("L2：长期记忆那份是 anchor 时，「这条不对」的新说法同样带上 valid_to / due_at / todo_state", async () => {
    const OLD = "周五前把验收清单发给客户 A";
    await asOwner(async (c) => {
      await c.query(
        `INSERT INTO claims (id, org_id, statement, status, tsv, claim_kind, confidence, created_by, reviewed_by, scope_kind, scope_id,
                             valid_from, valid_to, due_at, todo_state)
         VALUES ('clm-s7-l2-s', $1, $2, 'accepted', to_tsvector('simple', $2), 'todo', 1, 'human', 'u-owner', 'chat_session', $3,
                 now() - interval '1 day', now() + interval '20 days', now() + interval '3 days', 'done'),
                ('clm-s7-l2-p', $1, $2, 'accepted', to_tsvector('simple', $2), 'todo', 1, 'human', 'u-owner', 'personal', 'u-owner',
                 now() - interval '1 day', now() + interval '20 days', now() + interval '3 days', 'done')`,
        [ORG, OLD, fx.A]);
      await c.query(
        `INSERT INTO ontology_edges (id, org_id, src_kind, src_id, dst_kind, dst_id, relation, created_by, scope_kind, scope_id)
         VALUES ('edge-s7-l2', $1, 'claim', 'clm-s7-l2-p', 'claim', 'clm-s7-l2-s', 'derived_from', 'model', 'personal', 'u-owner')`, [ORG]);
    });
    const answer = await turnWith(fx.A, "run-s7-l2", ["clm-s7-l2-s"], `你说过：${OLD}。`);
    const out = await correctCitation(deps, {
      userId: "u-owner", orgId: ORG_ID, threadId: fx.A, messageId: answer, claimId: "clm-s7-l2-s", kind: "wrong", replacement: "下周一前把验收清单发给客户 A",
    });
    const rows = await sqlRows<{ id: string; scope_kind: string; supersedes_claim_id: string | null; valid_to: Date; due_at: Date; todo_state: string }>(
      "SELECT id, scope_kind, supersedes_claim_id, valid_to, due_at, todo_state FROM claims WHERE id = ANY($1::text[])", [["clm-s7-l2-p", out.newClaimId]]);
    const anchor = rows.find((r) => r.id === "clm-s7-l2-p")!;
    const neu = rows.find((r) => r.id === out.newClaimId)!;
    expect(neu).toMatchObject({ scope_kind: "personal", supersedes_claim_id: "clm-s7-l2-p", todo_state: "done" });
    expect(neu.valid_to.toISOString()).toBe(anchor.valid_to.toISOString());
    expect(neu.due_at.toISOString()).toBe(anchor.due_at.toISOString());
  });
});

describe("S7 delta review：一家只走本人能改的节点（L1）；函数里没有临时表（D1）", () => {
  it("项目记忆（L2）的副本、别人的副本不动；只能经 L2 才连得上的本人长期记忆也不动", async () => {
    const OLD = "客户 A 要求发票抬头写全称";
    const f = await family("e", OLD);
    await insertClaim("clm-s7-fam-e-l2", OLD, { kind: "project", id: `${ORG}-p` });
    await insertClaim("clm-s7-fam-e-other", OLD, { kind: "personal", id: "u-other" });
    await insertClaim("clm-s7-fam-e-via-l2", OLD, { kind: "personal", id: "u-owner" });
    await asOwner(async (c) => {
      const edge = (id: string, src: string, dst: string, scope: [string, string]) => c.query(
        `INSERT INTO ontology_edges (id, org_id, src_kind, src_id, dst_kind, dst_id, relation, created_by, scope_kind, scope_id)
         VALUES ($1, $2, 'claim', $3, 'claim', $4, 'derived_from', 'human', $5, $6)`, [id, ORG, src, dst, scope[0], scope[1]]);
      await edge("edge-s7-e-l2", "clm-s7-fam-e-l2", f.session, ["project", `${ORG}-p`]);
      // 别人的副本、本人长期记忆里另一条，都只经 L2 那条连到这一家：递归不许穿过 L2 走到它们
      //（直接挂在会话那条上的个人副本由 F07 级联按「来源都失效」收，那是 F07 的既有语义，不是这里的「一家」）
      await edge("edge-s7-e-other", "clm-s7-fam-e-other", "clm-s7-fam-e-l2", ["personal", "u-other"]);
      await edge("edge-s7-e-via", "clm-s7-fam-e-via-l2", "clm-s7-fam-e-l2", ["personal", "u-owner"]);
    });
    const answer = await turnWith(fx.A, "run-s7-fe", [f.session], `你说过：${OLD}。`);
    await correctCitation(deps, { userId: "u-owner", orgId: ORG_ID, threadId: fx.A, messageId: answer, claimId: f.session, kind: "wrong" });
    const rows = await sqlRows<{ id: string; live: boolean }>(
      `SELECT id, revoked_at IS NULL AND status <> 'superseded' AS live FROM claims
        WHERE id = ANY($1::text[]) ORDER BY id`,
      [[f.session, f.personal, "clm-s7-fam-e-l2", "clm-s7-fam-e-other", "clm-s7-fam-e-via-l2"]]);
    expect(Object.fromEntries(rows.map((r) => [r.id, r.live]))).toEqual({
      [f.session]: false, [f.personal]: false,
      "clm-s7-fam-e-l2": true, "clm-s7-fam-e-other": true, "clm-s7-fam-e-via-l2": true,
    });
  });

  it("kg_correct_citation 不建临时表（调用方预先建一张同名 TEMP 表也顶替不了什么）", async () => {
    const [fn] = await sqlRows<{ src: string; secdef: boolean }>(
      "SELECT prosrc AS src, prosecdef AS secdef FROM pg_proc WHERE proname = 'kg_correct_citation'");
    expect(fn!.secdef).toBe(true);
    expect(fn!.src).not.toMatch(/\btemp(orary)?\b\s+table/i);
  });
});

describe("S7：纠正率 = 纠正 / 被引用", () => {
  it("按同一个对账判据复算被引用次数；纠正按种类计数；只算本人的", async () => {
    const citedRuns = await sqlRows<{ n: string }>(
      "SELECT count(*) AS n FROM kg_citation_corrections WHERE org_id = $1 AND user_id = 'u-owner'", [ORG]);
    expect(citedRuns[0]!.n).toBe("13");
    const m = await getCitationMetrics(deps, { userId: "u-owner", orgId: ORG_ID });
    // 本人提问的回答里被引用过的：recon + authz + notcited + badreq + inv + lang + meet（7）+ 一家的五轮 fa/fb/fc/fd/fe（5）+ F4 待办（1）+ F4 review 三轮 fut/share/l2（3）+ N1（1）= 17；
    // none 那一轮 0。纠正过的那条现在已失效，但它当时被引用过，照样算在分母里。
    expect(m.citedUses).toBe(17);
    expect(m.corrections).toEqual({ wrong: 8, expired: 5 });
    expect(m.correctionRate).toBeCloseTo(13 / 17, 4);
    expect(m.windowDays).toBe(30);
    // 别人：没有纠正、没有被引用（u-member 那一轮的引用不算到 u-owner 头上，反之亦然）
    const other = await getCitationMetrics(deps, { userId: "u-member", orgId: ORG_ID });
    expect(other.corrections).toEqual({ wrong: 0, expired: 0 });
    expect(other.citedUses).toBe(1);
    expect(other.correctionRate).toBe(0);
  });
});
