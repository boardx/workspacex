/**
 * issue #4278 —— 晋升到个人空间的「决定」，在新会话的无关轮次里也要被强制召回（#4186 的决定类强制召回扩到 L1）。
 *
 * 走真实召回路径（kg-e2e-fixtures.ts 文件头：完整应用、真受理、真抽取 tick、生产同款 PgKnowledgeRecall、真写回、
 * 真 GET memory）：
 *   - 用户 A 在个人会话 A1 说「我决定关注 211 高校」→ 确认 → 存入个人空间；
 *   - 用户 B（同组织）在自己的个人会话 B1 说「我决定关注 985 高校」→ 确认 → 存入**他自己的**个人空间；
 *   - 用户 A 在另一个个人会话 A3 说「我决定改用周报模板 B」，**不**晋升（F15 跨会话结论）；
 *   - 用户 A 开新会话 A2 说「开始写报告吧」（与三条都没有字面关系）：
 *       本人个人空间的决定经 `claim` 通道进了模型上下文、标「来自个人空间知识」、turn memory 里 scope=personal、
 *       score 有限；B 的个人空间决定**不**进来（可见面与 F12 的 L1 同一套判定）；A3 那条跨会话未晋升的也不强制。
 *   - 对称：B 开新会话，只拿到自己的，不拿到 A 的。
 *   - 反证（评审补充）：A 把晋升的那条决定忘掉（在原会话里撤销来源，级联撤销个人空间副本）以后，再开新会话说无关的话，
 *     **不**再强制带上。（项目会话是否带个人记忆是 usecases.md 里 #4278 条目的待签核问题 (c)，按协调方指示这里不钉现状。）
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { knowledgeGraph as KG } from "@repo/contracts";
import { runExtractionTick } from "../../src/application/knowledge-graph/extract-message-knowledge";
import { addChatMessage, addChatThread } from "../support/chat-db";
import { addOrgMember, asOwner, resetOrgs, seedOrg } from "../support/db";
import {
  client, memoryPath, projectGraph, publishAgent, startApp, turn,
  type Client, type E2eApp, type ThreadKnowledgeBody, type TurnMemoryBody,
} from "./kg-e2e-fixtures";
import { enableExtraction, extractionDeps, loopbackModel } from "./kg-extraction-fixtures";

const ORG = "org-kg-i4278-personal-decision";
const USER_A = "u-i4278-a";
const USER_B = "u-i4278-b";
const AGENT = "agent-i4278";
const A1 = "thr-i4278-a1";
const A2 = "thr-i4278-a2";
const A3 = "thr-i4278-a3";
const B1 = "thr-i4278-b1";
const B2 = "thr-i4278-b2";
const A4 = "thr-i4278-a4";

const A_DECISION = "我决定关注 211 高校";
const B_DECISION = "我决定关注 985 高校";
const A_CROSS = "我决定改用周报模板 B";
const UNRELATED = "开始写报告吧";

const decisionReply = (statement: string) => JSON.stringify({
  entities: [],
  claims: [{ statement, kind: "decision", confidence: 0.9, about: [], decidedBy: null, quote: statement }],
});

let e: E2eApp;
let a: Client;
let b: Client;

async function settle(): Promise<void> {
  const { model } = loopbackModel([
    [A_DECISION, decisionReply(A_DECISION)], [B_DECISION, decisionReply(B_DECISION)], [A_CROSS, decisionReply(A_CROSS)],
  ]);
  const deps = extractionDeps(e.db, model, ORG);
  for (let i = 0; i < 50; i += 1) {
    const r = await runExtractionTick(deps);
    expect(r.failed).toBe(0);
    if (r.processed === 0) break;
  }
  await projectGraph(e);
}

/** 会话里唯一那条结论：确认 → 存入本人个人空间，返回个人空间副本的 id。 */
async function confirmAndPromote(api: Client, threadId: string, statement: string): Promise<string> {
  const k = await api.get<ThreadKnowledgeBody>(`/knowledge-graph/threads/${threadId}`);
  expect(k.status, JSON.stringify(k.body)).toBe(200);
  const c = k.body.claims.find((x) => x.statement === statement);
  expect(c, `会话 ${threadId} 里应抽出「${statement}」`).toBeDefined();
  const confirm = await api.post(`/knowledge-graph/threads/${threadId}/actions`, {
    basedOnRevision: k.body.revision, action: { type: "confirmClaims", claimIds: [c!.id] },
  });
  expect(confirm.status, JSON.stringify(confirm.body)).toBe(200);
  const promoted = await api.post<{ results: Array<{ claimId: string; personalClaimId?: string }> }>(
    `/knowledge-graph/threads/${threadId}/promote`, { claimIds: [c!.id] });
  expect(promoted.status, JSON.stringify(promoted.body)).toBe(200);
  const personal = promoted.body.results[0]?.personalClaimId;
  expect(personal).toEqual(expect.any(String));
  return personal!;
}

const ids: { aPersonal?: string; bPersonal?: string } = {};

beforeAll(async () => {
  e = await startApp();
  await resetOrgs(ORG);
  await seedOrg({ orgId: ORG, projectId: `${ORG}-p` });
  await enableExtraction(ORG);
  await addOrgMember(ORG, USER_A, "consultant", null);
  await addOrgMember(ORG, USER_B, "consultant", null);
  await publishAgent(ORG, AGENT, USER_A);
  for (const [id, owner] of [[A1, USER_A], [A2, USER_A], [A3, USER_A], [A4, USER_A], [B1, USER_B], [B2, USER_B]] as const) {
    await addChatThread({ orgId: ORG, id, projectId: null, visibilityScope: "private", createdBy: owner, title: id });
  }
  a = client(e, USER_A, ORG);
  b = client(e, USER_B, ORG);
}, 180_000);

afterAll(async () => {
  await e?.app.close();
});

describe("issue #4278: 本人个人空间的决定在新会话无关轮次里被强制召回，别人的不会", () => {
  it("A、B 各自说出决定并存入各自的个人空间；A 另有一条跨会话未晋升的决定", async () => {
    await addChatMessage({ orgId: ORG, id: "m-i4278-a1", threadId: A1, body: `${A_DECISION}。`, authorId: USER_A });
    await addChatMessage({ orgId: ORG, id: "m-i4278-b1", threadId: B1, body: `${B_DECISION}。`, authorId: USER_B });
    await addChatMessage({ orgId: ORG, id: "m-i4278-a3", threadId: A3, body: `${A_CROSS}。`, authorId: USER_A });
    await settle();
    ids.aPersonal = await confirmAndPromote(a, A1, A_DECISION);
    ids.bPersonal = await confirmAndPromote(b, B1, B_DECISION);
    await projectGraph(e);
    // 反证不空：B 的个人空间决定确实存在、是活的（不是因为不存在才没被召回）
    const rows = await asOwner(async (c) => (await c.query<{ id: string; scope_id: string }>(
      `SELECT id, scope_id FROM claims WHERE org_id = $1 AND scope_kind = 'personal' AND revoked_at IS NULL AND status <> 'superseded'`,
      [ORG])).rows);
    expect(rows).toEqual(expect.arrayContaining([
      { id: ids.aPersonal, scope_id: USER_A }, { id: ids.bPersonal, scope_id: USER_B },
    ]));
  }, 120_000);

  it("A 开新会话说「开始写报告吧」：本人个人空间的决定进了上下文、标来自个人空间；B 的与跨会话未晋升的都不进", async () => {
    const t = await turn(e, a, ORG, A2, UNRELATED, AGENT);
    expect(t.memory).not.toBeNull();
    expect(t.memory).toMatch(new RegExp(`- \\[你确认过\\] ${A_DECISION}（来自个人空间知识`));
    expect(t.memory).not.toContain(B_DECISION);
    expect(t.memory).not.toContain(A_CROSS);
    expect(t.answer).toContain(A_DECISION);
    expect(t.answer).not.toContain(B_DECISION);

    const r = await a.get<TurnMemoryBody>(memoryPath(A2, t.answerId));
    expect(r.status).toBe(200);
    const parsed = KG.knowledgeGraph.getTurnMemory.out.safeParse(r.body);
    expect(parsed.success, parsed.success ? "" : JSON.stringify(parsed.error.issues)).toBe(true);
    expect(r.body.recalled.map((m) => m.claimId)).toEqual([ids.aPersonal]);
    const hit = r.body.recalled[0]!;
    expect(hit).toMatchObject({ statement: A_DECISION, scope: "personal", triState: "confirmed", channels: ["claim"], graphPath: null });
    expect(Number.isFinite(parsed.success ? parsed.data.recalled[0]!.score : NaN)).toBe(true);
    // 库里落的就是有限分数（jsonb 不能有 Infinity → null）
    const [stored] = await asOwner(async (c) => (await c.query<{ items: Array<{ claimId: string; score: unknown }> }>(
      "SELECT items FROM kg_turn_recalls WHERE org_id = $1 AND run_id = $2", [ORG, t.runId])).rows);
    expect(stored!.items).toEqual([expect.objectContaining({ claimId: ids.aPersonal, score: 0 })]);
    expect(stored!.items.some((i) => i.claimId === ids.bPersonal)).toBe(false);
  }, 120_000);

  it("对称：B 开新会话说同样的话，只拿到自己个人空间的决定，拿不到 A 的", async () => {
    const t = await turn(e, b, ORG, B2, UNRELATED, AGENT);
    expect(t.memory).toContain(B_DECISION);
    expect(t.memory).not.toContain(A_DECISION);
    expect(t.memory).not.toContain(A_CROSS);
    const r = await b.get<TurnMemoryBody>(memoryPath(B2, t.answerId));
    expect(r.status).toBe(200);
    expect(r.body.recalled.map((m) => [m.claimId, m.scope, m.channels])).toEqual([[ids.bPersonal, "personal", ["claim"]]]);
  }, 120_000);

  it("反证：A 忘掉晋升的决定以后，新会话的无关轮次不再强制带上（turn memory / kg_turn_recalls 都没有）", async () => {
    const k = await a.get<ThreadKnowledgeBody>(`/knowledge-graph/threads/${A1}`);
    expect(k.status).toBe(200);
    const src = k.body.claims.find((c) => c.statement === A_DECISION);
    expect(src, "A1 里应还有那条决定的原结论").toBeDefined();
    const revoke = await a.post(`/knowledge-graph/threads/${A1}/actions`, {
      basedOnRevision: k.body.revision, action: { type: "revokeClaim", claimId: src!.id },
    });
    expect(revoke.status, JSON.stringify(revoke.body)).toBe(200);
    // 级联：个人空间副本（derived_from 唯一来源已失效）一并失效——撤销的就是晋升的那条
    const [row] = await asOwner(async (c) => (await c.query<{ revoked: boolean }>(
      "SELECT revoked_at IS NOT NULL AS revoked FROM claims WHERE org_id = $1 AND id = $2", [ORG, ids.aPersonal])).rows);
    expect(row).toEqual({ revoked: true });

    const t = await turn(e, a, ORG, A4, UNRELATED, AGENT);
    expect(t.memory ?? "").not.toContain(A_DECISION);
    expect(t.answer).not.toContain(A_DECISION);
    const r = await a.get<TurnMemoryBody>(memoryPath(A4, t.answerId));
    expect(r.status).toBe(200);
    expect(r.body.recalled.map((m) => m.claimId)).not.toContain(ids.aPersonal);
    expect(r.body.recalled.map((m) => m.statement)).not.toContain(A_DECISION);
    const stored = await asOwner(async (c) => (await c.query<{ items: Array<{ claimId: string }> }>(
      "SELECT items FROM kg_turn_recalls WHERE org_id = $1 AND run_id = $2", [ORG, t.runId])).rows);
    expect(stored.flatMap((x) => x.items).map((i) => i.claimId)).not.toContain(ids.aPersonal);
  }, 120_000);
});
