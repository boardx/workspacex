/**
 * Issue #4307（S6 #4363 顺带修）—— 取代收「随旧决定一起转 superseded 的个人副本」时，只沿**活的** derived_from 边。
 *
 * 复现（先红后绿）：
 *   1. A1、T 两个个人对话里各说一次「我决定关注 211 高校」⇒ #4283 自动记入个人空间，合并成一份副本 P（两个来源）。
 *   2. 在 T 的反馈条上「撤销」（undoAutoPersonalCopy）⇒ P 只摘掉 T 这个来源（detached：P→T 的边失效），P 靠 A1 继续活着。
 *   3. T 里说「改成关注 985 高校吧」，新决定只取代 T 里那条旧决定（`kg_apply_supersedes`，olders = [T 的 211]）。
 *      ——走真实的领域判定时 P 自己也会作为「个人空间的旧决定」被点名（说法相同），缺陷被遮住；
 *      可达的形态是规划只点名会话那条（例如个人空间那份的说法已被改过），所以这里直接把规划交给数据库函数。
 *   修之前：P 沿那条**已失效**的边被一起转成 superseded（decision_changed）。修之后：P 不动（F07 活来源规则：
 *   被摘掉的来源不再支撑它，也就不该拖着它被取代）。
 *   对照：同样的步骤不做第 2 步（边仍活着）⇒ P 照旧一起被取代（本来的规则没变）。
 *   撤销对称：撤销那次取代只恢复快照里的（T 的 211），P 从头到尾不被碰到。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runExtractionTick } from "../../src/application/knowledge-graph/extract-message-knowledge";
import { applyOntologyBatch } from "../../src/application/knowledge-graph/apply-ontology-batch";
import { newKgId } from "../../src/application/knowledge-graph/ids";
import { buildExtractionBatch, parseExtraction } from "../../src/domain/knowledge-graph/extraction";
import { toOrgId } from "../../src/domain/org-id";
import { PgOntologyStore } from "../../src/infrastructure/knowledge-graph/pg-ontology-store";
import { addChatMessage, addChatThread } from "../support/chat-db";
import { addOrgMember, asOwner, resetOrgs, seedOrg } from "../support/db";
import { client, startApp, type Client, type E2eApp, type ThreadKnowledgeBody } from "./kg-e2e-fixtures";
import { enableExtraction, extractionDeps, loopbackModel } from "./kg-extraction-fixtures";

const ORG = "org-kg-i4307-active";
const USER_A = "u-i4307-a";
const A1 = "thr-i4307-a1";
const T = "thr-i4307-t";
const A2 = "thr-i4307-a2";
const T2 = "thr-i4307-t2";
const OLD = "我决定关注 211 高校";
const NEW = "改成关注 985 高校";

const decisionReply = (statement: string) => JSON.stringify({
  entities: [],
  claims: [{ statement, kind: "decision", confidence: 0.9, about: [], decidedBy: null, quote: statement, timeExpr: null }],
});

let e: E2eApp;
let a: Client;

async function settle(): Promise<void> {
  const deps = extractionDeps(e.db, loopbackModel([[OLD, decisionReply(OLD)]]).model, ORG);
  for (let i = 0; i < 50; i += 1) {
    const r = await runExtractionTick(deps);
    expect(r.failed).toBe(0);
    if (r.processed === 0) break;
  }
}

async function sessionClaim(threadId: string, statement: string) {
  const k = await a.get<ThreadKnowledgeBody>(`/knowledge-graph/threads/${threadId}`);
  expect(k.status).toBe(200);
  const c = k.body.claims.find((x) => x.statement === statement);
  expect(c, `${threadId} 里应有「${statement}」`).toBeDefined();
  return c!;
}

const row = async (id: string) => (await asOwner(async (c) => (await c.query<{ status: string; revoked: boolean; reason: string | null }>(
  "SELECT status, revoked_at IS NOT NULL AS revoked, revocation_reason AS reason FROM claims WHERE org_id = $1 AND id = $2", [ORG, id])).rows))[0]!;

const personalCopyOf = async (sourceId: string) => (await asOwner(async (c) => (await c.query<{ id: string; edge_status: string }>(
  `SELECT d.src_id AS id, d.status AS edge_status FROM ontology_edges d
    WHERE d.org_id = $1 AND d.relation = 'derived_from' AND d.dst_kind = 'claim' AND d.dst_id = $2`, [ORG, sourceId])).rows))[0];

/** T 里一条新消息「改成关注 985 高校吧」：只抽取、不跑取代判定（规划由测试直接交给数据库函数）。 */
async function newerDecision(threadId: string, messageId: string): Promise<string> {
  await addChatMessage({ orgId: ORG, id: messageId, threadId, body: `${NEW}吧`, authorId: USER_A });
  // 这条消息不交给后台抽取（否则会连同领域判定一起跑）：出队，由下面手动抽取
  await asOwner((c) => c.query("DELETE FROM kg_extraction_queue WHERE org_id = $1 AND message_id = $2", [ORG, messageId]));
  const batch = buildExtractionBatch({
    threadId, messageId, messageBody: `${NEW}吧`, result: parseExtraction(JSON.parse(decisionReply(NEW))), known: [], newId: newKgId,
  })!;
  const out = await applyOntologyBatch(new PgOntologyStore(e.db), toOrgId(ORG), null, batch);
  expect(out.outcome).toBe("accepted");
  return batch.claims[0]!.id;
}

async function supersede(threadId: string, messageId: string, newer: string, older: string): Promise<number> {
  return e.db.withTenant(toOrgId(ORG), async (s) => {
    await s.query("SELECT set_config('app.current_user_id', $1, true)", [USER_A]);
    const r = await s.query<{ n: number }>("SELECT kg_apply_supersedes($1::jsonb) AS n", [JSON.stringify({
      action_id: newKgId("act"), thread_id: threadId, message_id: messageId, supersedes: [{ newer, olders: [older] }], prompts: [],
    })]);
    return r.rows[0]!.n;
  });
}

const ids: { oT?: string; p?: string; oT2?: string; p2?: string } = {};

beforeAll(async () => {
  e = await startApp();
  await resetOrgs(ORG);
  const fx = await seedOrg({ orgId: ORG, projectId: `${ORG}-p` });
  await enableExtraction(ORG);
  await addOrgMember(ORG, USER_A, "consultant", fx.teams.energy!);
  for (const id of [A1, T, A2, T2]) {
    await addChatThread({ orgId: ORG, id, projectId: null, visibilityScope: "private", createdBy: USER_A, title: id });
  }
  a = client(e, USER_A, ORG);
  // 两组各两个对话说同一句话 ⇒ 各自合并成一份两个来源的个人副本（先全部抽完，后面不再跑后台抽取）
  for (const [id, thread] of [["m-i4307-a1", A1], ["m-i4307-t", T], ["m-i4307-a2", A2], ["m-i4307-t2", T2]] as const) {
    await addChatMessage({ orgId: ORG, id, threadId: thread, body: `${OLD}。`, authorId: USER_A });
    await settle();
  }
  ids.oT = (await sessionClaim(T, OLD)).id;
  ids.oT2 = (await sessionClaim(T2, OLD)).id;
  ids.p = (await personalCopyOf(ids.oT))!.id;
  ids.p2 = (await personalCopyOf(ids.oT2))!.id;
  expect(ids.p).toBe((await personalCopyOf((await sessionClaim(A1, OLD)).id))!.id);
}, 240_000);

afterAll(async () => {
  await e?.app.close();
});

describe("#4307：取代只沿活的 derived_from 边收个人副本", () => {
  it("被摘掉来源（detached）的副本不随会话里的旧决定一起被取代；撤销那次取代也不碰它", async () => {
    const undo = await a.post<{ outcome: string; personalClaimId: string }>(`/knowledge-graph/threads/${T}/claims/${ids.oT}/personal-copy/undo`, {});
    expect(undo.status, JSON.stringify(undo.body)).toBe(200);
    expect(undo.body).toEqual({ personalClaimId: ids.p, outcome: "detached" });
    expect((await personalCopyOf(ids.oT!))!.edge_status).toBe("invalidated");

    const newer = await newerDecision(T, "m-i4307-t-new");
    expect(await supersede(T, "m-i4307-t-new", newer, ids.oT!)).toBe(1);
    expect(await row(ids.oT!)).toEqual({ status: "superseded", revoked: true, reason: "decision_changed" });
    // 修之前：{ status: superseded, revoked: true, reason: decision_changed }
    expect(await row(ids.p!)).toEqual({ status: "proposed", revoked: false, reason: null });

    // 撤销对称：快照里只有 T 的旧决定
    const [notice] = await asOwner(async (c) => (await c.query<{ id: string; restore: { claims: { id: string }[] } }>(
      "SELECT id, restore FROM kg_supersede_notices WHERE org_id = $1 AND thread_id = $2", [ORG, T])).rows);
    expect(notice!.restore.claims.map((c) => c.id)).toEqual([ids.oT]);
    const k = await a.get<ThreadKnowledgeBody>(`/knowledge-graph/threads/${T}`);
    const back = await a.post(`/knowledge-graph/threads/${T}/actions`, {
      basedOnRevision: k.body.revision, action: { type: "undoSupersede", noticeId: notice!.id },
    });
    expect(back.status, JSON.stringify(back.body)).toBe(200);
    expect(await row(ids.oT!)).toEqual({ status: "proposed", revoked: false, reason: null });
    expect(await row(ids.p!)).toEqual({ status: "proposed", revoked: false, reason: null });
  }, 180_000);

  it("对照：边还活着 ⇒ 副本照旧随旧决定一起被取代（原规则不变）", async () => {
    expect((await personalCopyOf(ids.oT2!))!.edge_status).toBe("active");
    const newer = await newerDecision(T2, "m-i4307-t2-new");
    expect(await supersede(T2, "m-i4307-t2-new", newer, ids.oT2!)).toBe(1);
    expect(await row(ids.oT2!)).toEqual({ status: "superseded", revoked: true, reason: "decision_changed" });
    expect(await row(ids.p2!)).toEqual({ status: "superseded", revoked: true, reason: "decision_changed" });
  }, 180_000);
});
