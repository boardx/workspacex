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

async function insertClaim(id: string, statement: string, scope: { kind: "personal" | "chat_session"; id: string }) {
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

  it("「已过时」⇒ expireClaim（#4363 前按撤回执行）：下一轮不再用它", async () => {
    const q = "客户 A 对例会有什么要求？";
    expect(await recallText(fx.B, q, "run-s7-meet-pre")).toContain(MEETING);
    const answer = await turnWith(fx.B, "run-s7-meet", ["clm-s7-meeting"], `你说过：${MEETING}。`);
    const out = await correctCitation(deps, { userId: "u-owner", orgId: ORG_ID, threadId: fx.B, messageId: answer, claimId: "clm-s7-meeting", kind: "expired" });
    expect(out).toEqual({ outcome: "expired", newClaimId: null });
    expect(await recallText(fx.B, q, "run-s7-meet-next")).not.toContain(MEETING);
    const [row] = await sqlRows<{ revocation_reason: string }>("SELECT revocation_reason FROM claims WHERE id = 'clm-s7-meeting'");
    expect(row!.revocation_reason).toBe("user_citation_expired");
  });
});

describe("S7：纠正率 = 纠正 / 被引用", () => {
  it("按同一个对账判据复算被引用次数；纠正按种类计数；只算本人的", async () => {
    const citedRuns = await sqlRows<{ n: string }>(
      "SELECT count(*) AS n FROM kg_citation_corrections WHERE org_id = $1 AND user_id = 'u-owner'", [ORG]);
    expect(citedRuns[0]!.n).toBe("3");
    const m = await getCitationMetrics(deps, { userId: "u-owner", orgId: ORG_ID });
    // 本人提问的回答里被引用过的：recon(1) + authz(1) + notcited(1) + badreq(1) + inv(1) + lang(1) + meet(1) = 7；none 那一轮 0
    expect(m.citedUses).toBe(7);
    expect(m.corrections).toEqual({ wrong: 2, expired: 1 });
    expect(m.correctionRate).toBeCloseTo(3 / 7, 4);
    expect(m.windowDays).toBe(30);
    // 别人：没有纠正、没有被引用（u-member 那一轮的引用不算到 u-owner 头上，反之亦然）
    const other = await getCitationMetrics(deps, { userId: "u-member", orgId: ORG_ID });
    expect(other.corrections).toEqual({ wrong: 0, expired: 0 });
    expect(other.citedUses).toBe(1);
    expect(other.correctionRate).toBe(0);
  });
});
