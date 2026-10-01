/**
 * issue #4343（人类决定 2026-09-27）—— 本人说的目标 / 偏好：记下 → 自动记进本人个人空间 → 之后每一轮都带上。
 *
 * 真实现象（devapp）：个人会话里说「我的目标是探索未来教育」，记忆面板 0 条、状态却是「已整理到最新」——结论类型里
 * 没有目标，模型回空，抽取静默结束。这里走真实路径（kg-e2e-fixtures.ts 文件头：完整应用、真抽取 tick、生产同款
 * 召回与读接口、真 HTTP），抽取模型用本文件自己的回环语料（不是冻结的 F15 评测语料）：
 *   - A 个人会话「我的目标是探索未来教育」⇒ 会话里一条 goal ⇒ A 的个人空间里一份「AI 记下的」副本；
 *     反馈条数据源带 kind = goal 与副本 id；
 *   - A 新开个人会话问一句无关的「帮我规划一下」⇒ 这一轮的记忆里有这个目标（scope personal，claim 通道，kind goal）；
 *   - 偏好（「我更喜欢…」）同样；
 *   - 项目会话里说的目标不自动复制；
 *   - B 看不到 A 的目标（个人空间读接口、B 自己的无关轮次都没有）；
 *   - 撤销 ⇒ 副本失效，下一轮不再带上；
 *   - 抽取跑了但没东西可记 ⇒ 留一条「kg extraction empty」日志（带 messageId）并计入 tick.empty，与「没跑」分得开。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { knowledgeGraph as KG } from "@repo/contracts";
import { runExtractionTick } from "../../src/application/knowledge-graph/extract-message-knowledge";
import type { LogFields } from "../../src/application/ports/logger.port";
import { addChatMessage, addChatThread } from "../support/chat-db";
import { addOrgMember, addProjectMember, asOwner, resetOrgs, seedOrg } from "../support/db";
import {
  client, memoryPath, projectGraph, publishAgent, startApp, turn,
  type Client, type E2eApp, type TurnMemoryBody,
} from "./kg-e2e-fixtures";
import { enableExtraction, extractionDeps, loopbackModel } from "./kg-extraction-fixtures";

const ORG = "org-kg-i4343-goal";
const PROJECT = `${ORG}-p`;
const USER_A = "u-i4343-a";
const USER_B = "u-i4343-b";
const AGENT = "agent-i4343";
const A1 = "thr-i4343-a1";
const A2 = "thr-i4343-a2";
const A3 = "thr-i4343-a3";
const B1 = "thr-i4343-b1";
const P1 = "thr-i4343-p1";

const GOAL = "我的目标是探索未来教育";
const PREF = "我更喜欢简洁的回答";
const PROJECT_GOAL = "我的目标是让项目年底前上线";
const UNDO_GOAL = "我希望每天早上先看数据看板";
const NOTHING = "今天天气不错";
const PLAN = "帮我规划一下";

const reply = (statement: string, kind: KG.KgClaimKind) => JSON.stringify({
  entities: [], claims: [{ statement, kind, confidence: 0.9, about: [], decidedBy: null, quote: statement }],
});

let e: E2eApp;
let a: Client;
let b: Client;
const logs: { msg: string; fields: LogFields }[] = [];
const ticks: Awaited<ReturnType<typeof runExtractionTick>>[] = [];

async function settle(): Promise<void> {
  const { model } = loopbackModel([
    [GOAL, reply(GOAL, "goal")], [PREF, reply(PREF, "preference")],
    [PROJECT_GOAL, reply(PROJECT_GOAL, "goal")], [UNDO_GOAL, reply(UNDO_GOAL, "goal")],
  ]);
  const deps = { ...extractionDeps(e.db, model, ORG), logger: { info: (msg: string, fields: LogFields) => { logs.push({ msg, fields }); }, error: () => undefined } };
  for (let i = 0; i < 50; i += 1) {
    const r = await runExtractionTick(deps);
    expect(r.failed).toBe(0);
    ticks.push(r);
    if (r.processed === 0) break;
  }
  await projectGraph(e);
}

async function sessionClaim(threadId: string, statement: string): Promise<{ id: string; claim_kind: string }> {
  const rows = await asOwner(async (c) => (await c.query<{ id: string; claim_kind: string }>(
    "SELECT id, claim_kind FROM claims WHERE org_id = $1 AND scope_kind = 'chat_session' AND scope_id = $2 AND statement = $3",
    [ORG, threadId, statement])).rows);
  expect(rows, `会话 ${threadId} 里应抽出「${statement}」`).toHaveLength(1);
  return rows[0]!;
}
async function personalRows(statement: string) {
  return asOwner(async (c) => (await c.query<{ id: string; scope_id: string; claim_kind: string; status: string; revoked_at: Date | null }>(
    `SELECT id, scope_id, claim_kind, status, revoked_at FROM claims
      WHERE org_id = $1 AND scope_kind = 'personal' AND statement = $2 ORDER BY created_at, id`, [ORG, statement])).rows);
}
const extraction = (api: Client, threadId: string, messageId: string) =>
  api.get<KG.KgMessageExtraction>(`/knowledge-graph/threads/${threadId}/messages/${messageId}/extraction`);
const undoPath = (threadId: string, claimId: string) => `/knowledge-graph/threads/${threadId}/claims/${claimId}/personal-copy/undo`;

beforeAll(async () => {
  e = await startApp();
  await resetOrgs(ORG);
  await seedOrg({ orgId: ORG, projectId: PROJECT });
  await enableExtraction(ORG);
  await addOrgMember(ORG, USER_A, "consultant", null);
  await addOrgMember(ORG, USER_B, "consultant", null);
  for (const u of [USER_A, USER_B]) await addProjectMember(ORG, PROJECT, u, "facilitator", null);
  await publishAgent(ORG, AGENT, USER_A);
  for (const id of [A1, A2, A3]) await addChatThread({ orgId: ORG, id, projectId: null, visibilityScope: "private", createdBy: USER_A, title: id });
  await addChatThread({ orgId: ORG, id: B1, projectId: null, visibilityScope: "private", createdBy: USER_B, title: B1 });
  await addChatThread({ orgId: ORG, id: P1, projectId: PROJECT, visibilityScope: "plenary", createdBy: USER_A, title: "项目群聊" });
  a = client(e, USER_A, ORG);
  b = client(e, USER_B, ORG);

  await addChatMessage({ orgId: ORG, id: "m-i4343-goal", threadId: A1, body: GOAL, authorId: USER_A });
  await addChatMessage({ orgId: ORG, id: "m-i4343-pref", threadId: A1, body: `${PREF}。`, authorId: USER_A });
  await addChatMessage({ orgId: ORG, id: "m-i4343-undo", threadId: A3, body: `${UNDO_GOAL}。`, authorId: USER_A });
  await addChatMessage({ orgId: ORG, id: "m-i4343-proj", threadId: P1, body: `${PROJECT_GOAL}。`, authorId: USER_A });
  await addChatMessage({ orgId: ORG, id: "m-i4343-nothing", threadId: A1, body: NOTHING, authorId: USER_A });
  await settle();
}, 180_000);

afterAll(async () => {
  await e?.app.close();
});

describe("issue #4343: 本人的目标 / 偏好", () => {
  it("「我的目标是探索未来教育」⇒ 会话里一条 goal ⇒ 自动记进 A 的个人空间（AI 记下的）；反馈条数据带 kind 与副本 id", async () => {
    const src = await sessionClaim(A1, GOAL);
    expect(src.claim_kind).toBe("goal");
    const rows = await personalRows(GOAL);
    expect(rows).toEqual([expect.objectContaining({ scope_id: USER_A, claim_kind: "goal", status: "proposed", revoked_at: null })]);
    const ex = await extraction(a, A1, "m-i4343-goal");
    expect(ex.status).toBe(200);
    expect(KG.knowledgeGraph.getMessageExtraction.out.safeParse(ex.body).success).toBe(true);
    expect(ex.body.claims).toEqual([{ claimId: src.id, statement: GOAL, kind: "goal", personalCopyClaimId: rows[0]!.id }]);
    const personal = await a.get<{ claims: Array<{ id: string; kind: string; triState: string }> }>("/knowledge-graph/personal");
    expect(personal.body.claims.find((c) => c.id === rows[0]!.id)).toMatchObject({ kind: "goal", triState: "pending" });
  });

  it("偏好（「我更喜欢简洁的回答」）同样记下并自动记进个人空间", async () => {
    expect((await sessionClaim(A1, PREF)).claim_kind).toBe("preference");
    expect(await personalRows(PREF)).toEqual([expect.objectContaining({ scope_id: USER_A, claim_kind: "preference", status: "proposed" })]);
  });

  it("项目会话里说的目标：会话里照常记下，但不自动进任何人的个人空间", async () => {
    expect((await sessionClaim(P1, PROJECT_GOAL)).claim_kind).toBe("goal");
    expect(await personalRows(PROJECT_GOAL)).toEqual([]);
    const ex = await extraction(a, P1, "m-i4343-proj");
    expect(ex.body.claims.map((c) => [c.kind, c.personalCopyClaimId])).toEqual([["goal", null]]);
  });

  it("抽取跑了但没东西可记 ⇒ 「kg extraction empty」日志带 messageId，并计入 tick.empty（不是静默）", () => {
    const hit = logs.find((l) => l.msg === "kg extraction empty" && l.fields.messageId === "m-i4343-nothing");
    expect(hit?.fields).toMatchObject({ orgId: ORG, threadId: A1, reason: "no_candidates" });
    expect(ticks.reduce((n, t) => n + t.empty, 0)).toBeGreaterThanOrEqual(1);
    for (const t of ticks) expect(t.processed).toBe(t.written + t.empty + t.skipped + t.failed);
  });

  it("A 新开个人会话问一句无关的「帮我规划一下」⇒ 这一轮带上目标与偏好（个人空间，claim 通道，引用带 kind）", async () => {
    const t = await turn(e, a, ORG, A2, PLAN, AGENT);
    expect(t.memory).toMatch(new RegExp(`- \\[AI 记下的\\] ${GOAL}（来自个人空间知识`));
    expect(t.memory).toContain(PREF);
    expect(t.memory).not.toContain(PROJECT_GOAL);
    const mem = await a.get<TurnMemoryBody>(memoryPath(A2, t.answerId));
    expect(mem.status).toBe(200);
    expect(KG.KgTurnMemory.safeParse(mem.body).success).toBe(true);
    expect(mem.body.recalled.find((m) => m.statement === GOAL)).toMatchObject({ scope: "personal", kind: "goal", channels: ["claim"] });
    expect(mem.body.recalled.find((m) => m.statement === PREF)).toMatchObject({ scope: "personal", kind: "preference" });
  }, 120_000);

  it("B 看不到 A 的目标：个人空间读接口没有，B 自己的无关轮次也不带", async () => {
    const personal = await b.get<{ claims: Array<{ statement: string }> }>("/knowledge-graph/personal");
    expect(personal.status).toBe(200);
    expect(personal.body.claims.map((c) => c.statement)).not.toContain(GOAL);
    const t = await turn(e, b, ORG, B1, PLAN, AGENT);
    expect(t.memory ?? "").not.toContain(GOAL);
    expect(t.memory ?? "").not.toContain(PREF);
  }, 120_000);

  it("撤销自动记下的目标 ⇒ 副本失效；下一轮不再带上，没撤的照样带", async () => {
    const src = await sessionClaim(A3, UNDO_GOAL);
    expect(await personalRows(UNDO_GOAL)).toHaveLength(1);
    const r = await a.post<{ personalClaimId: string; outcome: string }>(undoPath(A3, src.id), {});
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.outcome).toBe("revoked");
    expect((await personalRows(UNDO_GOAL))[0]).toMatchObject({ status: "superseded" });
    expect((await personalRows(UNDO_GOAL))[0]!.revoked_at).not.toBeNull();
    const t = await turn(e, a, ORG, A2, PLAN, AGENT);
    expect(t.memory).not.toContain(UNDO_GOAL);
    expect(t.memory).toContain(GOAL);
  }, 120_000);
});
