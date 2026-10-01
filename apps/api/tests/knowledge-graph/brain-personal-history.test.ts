/**
 * Issue #4302 —— 大脑页（/brain）如实显示跨会话的长期记忆（人类决定 2026-09-26）：
 *   - 活着的每条带「来自你 {M/D} 的对话」的时间（`KgPersonalClaimOrigin.saidAt`）；
 *   - 被改口取代的旧记忆折叠在取代它的那条下面（`getPersonalKnowledge.replaced`，新的一支投影，活记忆口径不变）；
 *   - 忘掉 / 撤回的不显示；只读查看者本人的个人空间，别人拿到的是空（或整体拒绝）；
 *   - 大脑页上的两个写动作都复用既有动作，走界面同一条路：
 *       「撤销取代」= 在 `replaced.undo.threadId` 上 `applyHumanAction{undoSupersede, noticeId}`（#4290）；
 *       「忘掉这条」= 仍是「AI 记下的」且来源自动记下（`autoCopied`）⇒ `undoAutoPersonalCopy`（#4283）；
 *                     其余（确认过 / 手动记下的）⇒ 在来源对话上 `applyHumanAction{revokeClaim}`（F07 级联）。
 *
 * 走真实路径（kg-e2e-fixtures.ts：完整应用、真抽取 tick（含 #4290 判取代 + #4283 自动记入）、真 HTTP）。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { knowledgeGraph as KG } from "@repo/contracts";
import { runExtractionTick } from "../../src/application/knowledge-graph/extract-message-knowledge";
import { addChatMessage, addChatThread } from "../support/chat-db";
import { addOrgMember, addProjectMember, asOwner, resetOrgs, seedOrg } from "../support/db";
import { client, projectGraph, startApp, type Client, type E2eApp, type ThreadKnowledgeBody } from "./kg-e2e-fixtures";
import { enableExtraction, extractionDeps, loopbackModel } from "./kg-extraction-fixtures";

const ORG = "org-kg-i4302-brain";
const PROJECT = `${ORG}-p`;
const USER_A = "u-i4302-a";
const USER_B = "u-i4302-b";
const A1 = "thr-i4302-a1";
const B1 = "thr-i4302-b1";
const C1 = "thr-i4302-c1";

const OLD = "我决定关注 211 高校";
const NEW = "改成关注 985 高校";
const FRONT = "我决定用 React 做前端";

const decisionReply = (statement: string) => JSON.stringify({
  entities: [],
  claims: [{ statement, kind: "decision", confidence: 0.9, about: [], decidedBy: null, quote: statement }],
});
const MODEL = () => loopbackModel([[OLD, decisionReply(OLD)], [NEW, decisionReply(NEW)], [FRONT, decisionReply(FRONT)]]).model;

type Personal = import("zod").infer<typeof KG.knowledgeGraph.getPersonalKnowledge.out>;
type Overview = import("zod").infer<typeof KG.knowledgeGraph.getBrainOverview.out>;

let e: E2eApp;
let a: Client;
let b: Client;
const ids: { p211?: string; p985?: string; s985?: string; noticeId?: string; pFront?: string } = {};

async function settle(): Promise<void> {
  const deps = extractionDeps(e.db, MODEL(), ORG);
  for (let i = 0; i < 50; i += 1) {
    const r = await runExtractionTick(deps);
    expect(r.failed).toBe(0);
    if (r.processed === 0) break;
  }
  await projectGraph(e);
}

async function personal(api: Client = a): Promise<Personal> {
  const r = await api.get<Personal>("/knowledge-graph/personal");
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  const parsed = KG.knowledgeGraph.getPersonalKnowledge.out.safeParse(r.body);
  expect(parsed.success, parsed.success ? "" : JSON.stringify(parsed.error.issues)).toBe(true);
  return r.body;
}
async function overview(api: Client = a): Promise<Overview> {
  const r = await api.get<Overview>("/knowledge-graph/me/overview");
  expect(r.status).toBe(200);
  const parsed = KG.knowledgeGraph.getBrainOverview.out.safeParse(r.body);
  expect(parsed.success, parsed.success ? "" : JSON.stringify(parsed.error.issues)).toBe(true);
  return r.body;
}
async function thread(threadId: string, api: Client = a) {
  const k = await api.get<ThreadKnowledgeBody>(`/knowledge-graph/threads/${threadId}`);
  expect(k.status, JSON.stringify(k.body)).toBe(200);
  return k.body;
}
/** 界面的做法：先读那个对话的最新版本号，再在它上面做动作。 */
async function actOn(threadId: string, action: unknown, api: Client = a) {
  const { revision } = await thread(threadId, api);
  return api.post<{ revision: number }>(`/knowledge-graph/threads/${threadId}/actions`, { basedOnRevision: revision, action });
}
const firstSaid = async (threadId: string) => (await asOwner(async (c) => (await c.query<{ at: Date }>(
  "SELECT min(created_at) AS at FROM chat_messages WHERE org_id = $1 AND thread_id = $2", [ORG, threadId])).rows))[0]!.at.toISOString();

beforeAll(async () => {
  e = await startApp();
  await resetOrgs(ORG);
  const fx = await seedOrg({ orgId: ORG, projectId: PROJECT });
  await enableExtraction(ORG);
  for (const u of [USER_A, USER_B]) {
    await addOrgMember(ORG, u, "consultant", fx.teams.energy!);
    await addProjectMember(ORG, PROJECT, u, "facilitator", null);
  }
  for (const id of [A1, B1, C1]) {
    await addChatThread({ orgId: ORG, id, projectId: null, visibilityScope: "private", createdBy: USER_A, title: id });
  }
  a = client(e, USER_A, ORG);
  b = client(e, USER_B, ORG);
}, 180_000);

afterAll(async () => {
  await e?.app.close();
});

describe("issue #4302: 大脑页的长期记忆——时间、折叠的取代历史、忘掉 / 撤销取代", () => {
  it("A1「我决定关注 211 高校」自动记入长期记忆；来源带说出它的时间，标明是自动记下的", async () => {
    await addChatMessage({ orgId: ORG, id: "m-i4302-a1", threadId: A1, body: `${OLD}。`, authorId: USER_A });
    await settle();
    const p = await personal();
    expect(p.claims.map((c) => [c.statement, c.triState])).toEqual([[OLD, "pending"]]);
    ids.p211 = p.claims[0]!.id;
    expect(p.replaced).toEqual([]);
    const o = await overview();
    expect(o.personalOrigins).toEqual([expect.objectContaining({
      personalClaimId: ids.p211, threadId: A1, saidAt: await firstSaid(A1), autoCopied: true,
    })]);
  }, 120_000);

  it("B1「改成关注 985 高校吧」：活记忆只剩 985（口径不变）；211 折叠在 985 下面，带撤销（B1 上那次取代）", async () => {
    await addChatMessage({ orgId: ORG, id: "m-i4302-b1", threadId: B1, body: `${NEW}吧`, authorId: USER_A });
    await settle();
    const p = await personal();
    expect(p.claims.map((c) => c.statement)).toEqual([NEW]);
    ids.p985 = p.claims[0]!.id;
    ids.s985 = (await thread(B1)).claims.find((c) => c.statement === NEW)!.id;
    const [notice] = await asOwner(async (c) => (await c.query<{ id: string }>(
      "SELECT id FROM kg_supersede_notices WHERE org_id = $1 AND thread_id = $2 AND status = 'applied'", [ORG, B1])).rows);
    expect(notice).toBeDefined();
    ids.noticeId = notice!.id;
    expect(p.replaced).toEqual([{
      byClaimId: ids.p985, replaces: { claimId: ids.p211, statement: OLD }, undo: { threadId: B1, noticeId: ids.noticeId },
    }]);
    // 被取代的那条不会出现在活记忆、实体计数或边里（活口径一个字没改）
    expect(JSON.stringify({ claims: p.claims, edges: p.edges })).not.toContain(ids.p211!);
    const o = await overview();
    expect(o.personalOrigins.find((x) => x.personalClaimId === ids.p985)).toMatchObject({
      sourceClaimId: ids.s985, threadId: B1, saidAt: await firstSaid(B1), autoCopied: true,
    });
  }, 120_000);

  it("只读本人：同组织的另一位成员读到的长期记忆是空的，也动不了 A 的撤销", async () => {
    const p = await personal(b);
    expect(p).toMatchObject({ claims: [], replaced: [] });
    expect(JSON.stringify(p)).not.toContain(OLD);
    expect((await overview(b)).personalOrigins).toEqual([]);
    const denied = await b.post(`/knowledge-graph/threads/${B1}/actions`, {
      basedOnRevision: 0, action: { type: "undoSupersede", noticeId: ids.noticeId },
    });
    expect(denied.status).not.toBe(200);
    expect((await personal()).replaced).toHaveLength(1);
    // 不是组织成员：整体拒绝（契约 getPersonalKnowledge.err）
    const stranger = await client(e, "u-i4302-stranger", ORG).get("/knowledge-graph/personal");
    expect(stranger.status).toBe(403);
  }, 60_000);

  it("撤销取代（replaced.undo 给的对话 + noticeId）：211 恢复，两条都在，没有折叠行", async () => {
    const { undo: target } = (await personal()).replaced[0]!;
    expect(target).toEqual({ threadId: B1, noticeId: ids.noticeId });
    const undo = await actOn(target!.threadId, { type: "undoSupersede", noticeId: target!.noticeId });
    expect(undo.status, JSON.stringify(undo.body)).toBe(200);
    const p = await personal();
    expect(p.claims.map((c) => c.statement).sort()).toEqual([NEW, OLD].sort());
    expect(p.claims.find((c) => c.statement === OLD)!.id).toBe(ids.p211);
    expect(p.replaced).toEqual([]);
  }, 60_000);

  it("忘掉 985（仍是「AI 记下的」、自动记下）⇒ undoAutoPersonalCopy：长期记忆里没了，对话里那条还在", async () => {
    const origin = (await overview()).personalOrigins.find((x) => x.personalClaimId === ids.p985)!;
    expect(origin.autoCopied).toBe(true);
    const r = await a.post<{ outcome: string }>(
      `/knowledge-graph/threads/${origin.threadId}/claims/${origin.sourceClaimId}/personal-copy/undo`, {});
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.outcome).toBe("revoked");
    const p = await personal();
    expect(p.claims.map((c) => c.statement)).toEqual([OLD]);
    // 忘掉的不显示（不进活记忆、也不进折叠历史）
    expect(p.replaced).toEqual([]);
    expect(JSON.stringify(p)).not.toContain(NEW);
    expect((await thread(B1)).claims.map((c) => c.statement)).toContain(NEW);
  }, 60_000);

  it("忘掉确认过的一条 ⇒ 在来源对话上 revokeClaim：长期记忆里那份经 F07 级联一起失效，不出现在折叠历史里", async () => {
    await addChatMessage({ orgId: ORG, id: "m-i4302-c1", threadId: C1, body: `${FRONT}。`, authorId: USER_A });
    await settle();
    const c1 = (await thread(C1)).claims.find((c) => c.statement === FRONT)!;
    // 人点「记到我的长期记忆」= 确认（合并进自动记下的那份，转「你确认过的」）
    const promoted = await a.post(`/knowledge-graph/threads/${C1}/promote`, { claimIds: [c1.id] });
    expect(promoted.status, JSON.stringify(promoted.body)).toBe(200);
    const p0 = await personal();
    const front = p0.claims.find((c) => c.statement === FRONT)!;
    expect(front.triState).toBe("confirmed");
    const origin = (await overview()).personalOrigins.find((x) => x.personalClaimId === front.id)!;
    expect(origin).toMatchObject({ threadId: C1, sourceClaimId: c1.id });
    // 自动副本的撤销只撤「AI 记下的」——确认过的它不动（所以这里必须走 revokeClaim）
    const wrong = await a.post(`/knowledge-graph/threads/${C1}/claims/${c1.id}/personal-copy/undo`, {});
    expect(wrong.status).toBe(404);
    const forget = await actOn(C1, { type: "revokeClaim", claimId: origin.sourceClaimId });
    expect(forget.status, JSON.stringify(forget.body)).toBe(200);
    const p = await personal();
    expect(p.claims.map((c) => c.statement)).toEqual([OLD]);
    expect(p.replaced).toEqual([]);
  }, 120_000);
});
