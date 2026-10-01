/**
 * Issue #4302 review（第 9 轮）—— 大脑页「忘掉这条」在确认过、且有一个来源已被摘掉（#4283 撤销 = detached）的长期记忆上：
 *
 *   A1、B1 两个个人对话都说「我决定用 React 做前端」⇒ 自动记入一条长期记忆（两个来源）；
 *   B1 上撤销自动记入 ⇒ detached：B1 → 那份的 derived_from 边失效，B1 的对话结论仍活着；
 *   A1 上「记到我的长期记忆」⇒ merged_into_existing，转「你确认过的」；
 *   大脑页「忘掉这条」⇒ 只剩 A1 一个来源 ⇒ 在 A1 上 revokeClaim（界面同一个动作）。
 *
 * 修复前：F07 级联数来源时不看 derived_from 边的状态，被摘掉的 B1 仍算「活来源」⇒ 长期记忆那份永远留着，
 * 而 A1 的对话结论已被忘掉，界面报成功（review 复现）。修复后（20260927100000_kg_f07_active_sources_only.sql）：
 * 只数**活的** derived_from 边，被摘掉的来源不再撑着副本 ⇒ 长期记忆那份一起失效；B1 的对话结论不动。
 *
 * 第二段（非阻塞项）：改口取代里的「新决定」后来被忘掉、长期记忆那份靠别的来源还活着时，
 * 大脑页不再给「撤销取代」（`replaced.undo` 为 null 或整行不出现），不会把人引向一次注定被拒的撤销。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { knowledgeGraph as KG } from "@repo/contracts";
import { runExtractionTick } from "../../src/application/knowledge-graph/extract-message-knowledge";
import { addChatMessage, addChatThread } from "../support/chat-db";
import { addOrgMember, addProjectMember, asOwner, resetOrgs, seedOrg } from "../support/db";
import { client, projectGraph, startApp, type Client, type E2eApp, type ThreadKnowledgeBody } from "./kg-e2e-fixtures";
import { enableExtraction, extractionDeps, loopbackModel } from "./kg-extraction-fixtures";

const ORG = "org-kg-i4302-detached";
const PROJECT = `${ORG}-p`;
const USER_A = "u-i4302d-a";
const A1 = "thr-i4302d-a1";
const B1 = "thr-i4302d-b1";
const C1 = "thr-i4302d-c1";
const D1 = "thr-i4302d-d1";
const E1 = "thr-i4302d-e1";

const FRONT = "我决定用 React 做前端";
const OLD = "我决定关注 211 高校";
const NEW = "改成关注 985 高校";

const decisionReply = (statement: string) => JSON.stringify({
  entities: [],
  claims: [{ statement, kind: "decision", confidence: 0.9, about: [], decidedBy: null, quote: statement }],
});
const MODEL = () => loopbackModel([[FRONT, decisionReply(FRONT)], [OLD, decisionReply(OLD)], [NEW, decisionReply(NEW)]]).model;

type Personal = import("zod").infer<typeof KG.knowledgeGraph.getPersonalKnowledge.out>;
type Overview = import("zod").infer<typeof KG.knowledgeGraph.getBrainOverview.out>;

let e: E2eApp;
let a: Client;

async function settle(): Promise<void> {
  const deps = extractionDeps(e.db, MODEL(), ORG);
  for (let i = 0; i < 50; i += 1) {
    const r = await runExtractionTick(deps);
    expect(r.failed).toBe(0);
    if (r.processed === 0) break;
  }
  await projectGraph(e);
}
async function personal(): Promise<Personal> {
  const r = await a.get<Personal>("/knowledge-graph/personal");
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return r.body;
}
async function overview(): Promise<Overview> {
  const r = await a.get<Overview>("/knowledge-graph/me/overview");
  expect(r.status).toBe(200);
  return r.body;
}
async function thread(threadId: string) {
  const k = await a.get<ThreadKnowledgeBody>(`/knowledge-graph/threads/${threadId}`);
  expect(k.status, JSON.stringify(k.body)).toBe(200);
  return k.body;
}
async function actOn(threadId: string, action: unknown) {
  const { revision } = await thread(threadId);
  return a.post<{ revision: number }>(`/knowledge-graph/threads/${threadId}/actions`, { basedOnRevision: revision, action });
}
const sessionClaim = async (threadId: string, statement: string) => (await thread(threadId)).claims.find((c) => c.statement === statement);

/** 与 apps/web/lib/brain-view.ts `forgetPlan` + brain-memory-actions.ts `forgetFromBrain` 同一套映射（界面发的就是这些请求）。 */
async function forgetOnBrain(personalClaimId: string): Promise<void> {
  const claim = (await personal()).claims.find((c) => c.id === personalClaimId)!;
  const origins = (await overview()).personalOrigins.filter((o) => o.personalClaimId === personalClaimId);
  expect(origins.length).toBeGreaterThan(0);
  for (const o of origins) {
    const r = o.autoCopied && claim.triState === "pending"
      ? await a.post(`/knowledge-graph/threads/${o.threadId}/claims/${o.sourceClaimId}/personal-copy/undo`, {})
      : await actOn(o.threadId, { type: "revokeClaim", claimId: o.sourceClaimId });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
  }
}

beforeAll(async () => {
  e = await startApp();
  await resetOrgs(ORG);
  const fx = await seedOrg({ orgId: ORG, projectId: PROJECT });
  await enableExtraction(ORG);
  await addOrgMember(ORG, USER_A, "consultant", fx.teams.energy!);
  await addProjectMember(ORG, PROJECT, USER_A, "facilitator", null);
  for (const id of [A1, B1, C1, D1, E1]) {
    await addChatThread({ orgId: ORG, id, projectId: null, visibilityScope: "private", createdBy: USER_A, title: id });
  }
  a = client(e, USER_A, ORG);
}, 180_000);

afterAll(async () => {
  await e?.app.close();
});

describe("issue #4302 review: 被摘掉的来源不再撑着长期记忆（F07 只数活的 derived_from 边）", () => {
  it("A1 + B1 → 一条两个来源；B1 撤销（detached）；A1 确认；大脑页忘掉 ⇒ 长期记忆那份真的没了，B1 的对话结论不动", async () => {
    await addChatMessage({ orgId: ORG, id: "m-i4302d-a1", threadId: A1, body: `${FRONT}。`, authorId: USER_A });
    await addChatMessage({ orgId: ORG, id: "m-i4302d-b1", threadId: B1, body: `${FRONT}。`, authorId: USER_A });
    await settle();
    const p0 = await personal();
    const front = p0.claims.find((c) => c.statement === FRONT)!;
    expect(front.triState).toBe("pending");
    expect((await overview()).personalOrigins.filter((o) => o.personalClaimId === front.id).map((o) => o.threadId).sort())
      .toEqual([A1, B1].sort());

    const b1 = (await sessionClaim(B1, FRONT))!;
    const detached = await a.post<{ outcome: string }>(`/knowledge-graph/threads/${B1}/claims/${b1.id}/personal-copy/undo`, {});
    expect(detached.status, JSON.stringify(detached.body)).toBe(200);
    expect(detached.body.outcome).toBe("detached");

    const a1 = (await sessionClaim(A1, FRONT))!;
    const promoted = await a.post<{ results: { outcome: string }[] }>(`/knowledge-graph/threads/${A1}/promote`, { claimIds: [a1.id] });
    expect(promoted.status, JSON.stringify(promoted.body)).toBe(200);
    expect(JSON.stringify(promoted.body)).toContain("merged_into_existing");
    expect((await personal()).claims.find((c) => c.id === front.id)!.triState).toBe("confirmed");
    expect((await overview()).personalOrigins.filter((o) => o.personalClaimId === front.id).map((o) => o.threadId)).toEqual([A1]);

    await forgetOnBrain(front.id);

    // 长期记忆里那份不再活着（修复前：仍是 confirmed，来源为空，按钮消失——review 的复现）
    const p = await personal();
    expect(p.claims.map((c) => c.id)).not.toContain(front.id);
    const [row] = await asOwner(async (c) => (await c.query<{ revoked_at: Date | null; revocation_reason: string | null }>(
      "SELECT revoked_at, revocation_reason FROM claims WHERE org_id = $1 AND id = $2", [ORG, front.id])).rows);
    expect(row!.revoked_at).not.toBeNull();
    expect(row!.revocation_reason).toBe("user_revoked");
    // 被摘掉的来源（B1 的对话结论）不动；A1 那条按「忘掉这条」的说明一起忘掉
    expect(await sessionClaim(B1, FRONT)).toBeDefined();
    expect(await sessionClaim(A1, FRONT)).toBeUndefined();
  }, 180_000);

  it("改口取代里的新决定被忘掉、长期记忆那份靠别的来源还活着 ⇒ 不再给「撤销取代」", async () => {
    await addChatMessage({ orgId: ORG, id: "m-i4302d-c1", threadId: C1, body: `${OLD}。`, authorId: USER_A });
    await settle();
    await addChatMessage({ orgId: ORG, id: "m-i4302d-d1", threadId: D1, body: `${NEW}吧`, authorId: USER_A });
    await settle();
    await addChatMessage({ orgId: ORG, id: "m-i4302d-e1", threadId: E1, body: `${NEW}吧`, authorId: USER_A });
    await settle();
    const p0 = await personal();
    const p985 = p0.claims.find((c) => c.statement === NEW)!;
    expect(p0.replaced).toEqual([expect.objectContaining({ byClaimId: p985.id, undo: expect.objectContaining({ threadId: D1 }) })]);

    // D1 上忘掉那条新决定（对话「记忆」页签的忘掉）；长期记忆那份还有 E1 这个活来源
    const d1 = (await sessionClaim(D1, NEW))!;
    const forget = await actOn(D1, { type: "revokeClaim", claimId: d1.id });
    expect(forget.status, JSON.stringify(forget.body)).toBe(200);
    const p = await personal();
    expect(p.claims.map((c) => c.id)).toContain(p985.id);
    expect(p.replaced.filter((r) => r.undo !== null)).toEqual([]);
  }, 180_000);
});
