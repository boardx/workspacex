/**
 * 第二批 10 轮（epic #4359）的**协调者验收**：北极星「用户在新会话里，不用重复自己已经说过的背景」。
 *
 * 这不是某一轮的单测，而是把已合入的几轮串成一条用户旅程、在生产同款路径上跑（kg-e2e-fixtures.ts：完整应用、
 * 真抽取 tick、真召回、真 HTTP）。每合入一轮，就在这里补一段它贡献的那一截旅程：
 *
 *   S3 #4343  A 在一个会话里说出目标 / 偏好 / 决定 ⇒ 之后**两个互不相关的新会话**都自动带上这三条（不用 A 重说）；
 *   S1 #4350  模型回了解析不出的东西 ⇒ 不再静默当「没有可记的」：重试 3 次后，会话记忆面板的读接口报「失败」；
 *   S9 #4366  别的账号碰 A 的个人记忆 ⇒ 404，且与「不存在」逐字节一致（人类决定 2026-09-27），B 的轮次也不带 A 的背景。
 *   S10 #4367 A 把那条决定「分享到项目…」⇒ 同项目的 B 在项目会话里提问时用得上，且标明由 A 分享；A 撤回分享 ⇒ B 的下一轮不再有。
 *             B 自己的个人空间始终没有 A 的东西（分享的是项目里的派生副本，不是把 A 的个人记忆开放给 B）。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { knowledgeGraph as KG } from "@repo/contracts";
import { runExtractionTick } from "../../src/application/knowledge-graph/extract-message-knowledge";
import { addChatMessage, addChatThread } from "../support/chat-db";
import { addCredential, addOrgMember, addProjectMember, asOwner, resetOrgs, seedOrg } from "../support/db";
import {
  client, memoryPath, projectGraph, publishAgent, startApp, turn,
  type Client, type E2eApp, type TurnMemoryBody,
} from "./kg-e2e-fixtures";
import { enableExtraction, extractionDeps, loopbackModel } from "./kg-extraction-fixtures";

const ORG = "org-kg-b2-accept";
const PROJECT = `${ORG}-p`;
const USER_A = "u-b2-a";
const USER_B = "u-b2-b";
const AGENT = "agent-b2";
const A_SAY = "thr-b2-a-say";
const A_NEW1 = "thr-b2-a-new1";
const A_NEW2 = "thr-b2-a-new2";
const A_BROKEN = "thr-b2-a-broken";
const B_OWN = "thr-b2-b-own";
const PROJECT_T = "thr-b2-project";
const A_NAME = "王老师";

const GOAL = "我的目标是探索未来教育";
const PREF = "我更喜欢简洁的回答";
const DECISION = "我决定先做小学数学的试点";
const GARBAGE_TRIGGER = "这句话会让抽取模型回一段不是 JSON 的东西";

const claim = (statement: string, kind: KG.KgClaimKind) =>
  ({ statement, kind, confidence: 0.9, about: [], decidedBy: null, quote: statement });
const reply = (...claims: ReturnType<typeof claim>[]) => JSON.stringify({ entities: [], claims });

let e: E2eApp;
let a: Client;
let b: Client;

async function drain(): Promise<void> {
  const { model } = loopbackModel([
    [GOAL, reply(claim(GOAL, "goal"))],
    [PREF, reply(claim(PREF, "preference"))],
    [DECISION, reply(claim(DECISION, "decision"))],
    [GARBAGE_TRIGGER, "好的，我看了一下，这里没什么需要特别记录的。"],
  ]);
  const deps = { ...extractionDeps(e.db, model, ORG), logger: { info: () => undefined, error: () => undefined } };
  for (let i = 0; i < 50; i += 1) {
    const r = await runExtractionTick(deps);
    if (r.processed === 0) break;
  }
  await projectGraph(e);
}

const personalStatements = async (api: Client) =>
  (await api.get<{ claims: Array<{ statement: string; kind: string }> }>("/knowledge-graph/personal")).body.claims;

beforeAll(async () => {
  e = await startApp();
  await resetOrgs(ORG);
  await seedOrg({ orgId: ORG, projectId: PROJECT });
  await enableExtraction(ORG);
  await addOrgMember(ORG, USER_A, "consultant", null);
  await addOrgMember(ORG, USER_B, "consultant", null);
  await asOwner((c) => c.query("DELETE FROM credentials WHERE user_id LIKE 'u-b2-%'"));
  await addCredential(USER_A, `${USER_A}@b2.test`, A_NAME);
  await addProjectMember(ORG, PROJECT, USER_A, "member", null);
  await addProjectMember(ORG, PROJECT, USER_B, "member", null);
  await publishAgent(ORG, AGENT, USER_A);
  for (const id of [A_SAY, A_NEW1, A_NEW2, A_BROKEN]) {
    await addChatThread({ orgId: ORG, id, projectId: null, visibilityScope: "private", createdBy: USER_A, title: id });
  }
  await addChatThread({ orgId: ORG, id: PROJECT_T, projectId: PROJECT, visibilityScope: "plenary", createdBy: USER_B, title: PROJECT_T });
  await addChatThread({ orgId: ORG, id: B_OWN, projectId: null, visibilityScope: "private", createdBy: USER_B, title: B_OWN });
  a = client(e, USER_A, ORG);
  b = client(e, USER_B, ORG);

  // A 只在一个会话里、只说一次
  await addChatMessage({ orgId: ORG, id: "m-b2-goal", threadId: A_SAY, body: GOAL, authorId: USER_A });
  await addChatMessage({ orgId: ORG, id: "m-b2-pref", threadId: A_SAY, body: `${PREF}。`, authorId: USER_A });
  await addChatMessage({ orgId: ORG, id: "m-b2-decision", threadId: A_SAY, body: `${DECISION}。`, authorId: USER_A });
  await addChatMessage({ orgId: ORG, id: "m-b2-garbage", threadId: A_BROKEN, body: GARBAGE_TRIGGER, authorId: USER_A });
  await drain();
}, 600_000);

afterAll(async () => {
  await e?.app.close();
});

describe("第二批验收 · 北极星：新会话里不用重复已经说过的背景", () => {
  it("S3：目标 / 偏好 / 决定说一次，就都在 A 的个人空间里（带类型）", async () => {
    const mine = await personalStatements(a);
    expect(mine).toEqual(expect.arrayContaining([
      expect.objectContaining({ statement: GOAL, kind: "goal" }),
      expect.objectContaining({ statement: PREF, kind: "preference" }),
      expect.objectContaining({ statement: DECISION, kind: "decision" }),
    ]));
  });

  it.each([
    [A_NEW1, "帮我规划一下下周要做的事"],
    [A_NEW2, "给我推荐几本书"],
  ])("S3：A 在互不相关的新会话 %s 里问「%s」⇒ 三条背景都自动带上，不用重说", async (threadId, question) => {
    const t = await turn(e, a, ORG, threadId, question, AGENT);
    for (const s of [GOAL, PREF, DECISION]) expect(t.memory, `新会话应自动带上「${s}」`).toContain(s);
    const mem = await a.get<TurnMemoryBody>(memoryPath(threadId, t.answerId));
    expect(mem.status).toBe(200);
    const byStatement = new Map(mem.body.recalled.map((m) => [m.statement, m]));
    expect(byStatement.get(GOAL)).toMatchObject({ scope: "personal", kind: "goal" });
    expect(byStatement.get(PREF)).toMatchObject({ scope: "personal", kind: "preference" });
    expect(byStatement.get(DECISION)).toMatchObject({ scope: "personal", kind: "decision" });
  }, 120_000);

  it("S9 / E9.c2：B 的轮次不带 A 的背景；B 碰 A 的个人记忆 ⇒ 404，与不存在逐字节一致（除 traceId）", async () => {
    const t = await turn(e, b, ORG, B_OWN, "帮我规划一下下周要做的事", AGENT);
    for (const s of [GOAL, PREF, DECISION]) expect(t.memory ?? "").not.toContain(s);
    expect((await personalStatements(b)).map((c) => c.statement)).not.toEqual(expect.arrayContaining([GOAL]));

    const [row] = await asOwner(async (c) => (await c.query<{ id: string }>(
      "SELECT id FROM claims WHERE org_id = $1 AND scope_kind = 'personal' AND scope_id = $2 AND statement = $3",
      [ORG, USER_A, GOAL])).rows);
    expect(row, "A 的目标应在个人空间里").toBeDefined();
    const got = await b.get<Record<string, unknown>>(`/knowledge-graph/claims/${row!.id}/sources`);
    const missing = await b.get<Record<string, unknown>>("/knowledge-graph/claims/clm_b2_does_not_exist/sources");
    const strip = (x: Record<string, unknown> | null) => { const { traceId: _t, ...rest } = x ?? {}; return rest; };
    expect(got.status).toBe(404);
    expect(missing.status).toBe(404);
    expect(strip(got.body)).toEqual(strip(missing.body));
    expect(JSON.stringify(got.body)).not.toContain(GOAL);
    expect(JSON.stringify(got.body)).not.toContain(row!.id);
  }, 120_000);

  it("S1：模型回了解析不出的东西 ⇒ 重试 3 次后，会话记忆读接口报「失败」，不是「已整理到最新」", async () => {
    const [q0] = await asOwner(async (c) => (await c.query<{ attempts: number; last_error: string | null }>(
      "SELECT attempts, last_error FROM kg_extraction_queue WHERE message_id = 'm-b2-garbage'")).rows);
    expect(q0, "解析不出 ⇒ 任务留在队列里走重试，而不是当「空」删掉").toBeDefined();
    expect(q0!.attempts).toBe(1);
    expect(q0!.last_error ?? "").not.toContain("没什么需要特别记录");  // 不存模型原文
    for (let i = 0; i < 2; i += 1) {
      await asOwner((c) => c.query("UPDATE kg_extraction_queue SET next_attempt_at = now() WHERE message_id = 'm-b2-garbage'"));
      await drain();
    }
    const k = await a.get<{ ingestion: { queued: number; running: number; failed: number } }>(`/knowledge-graph/threads/${A_BROKEN}`);
    expect(k.status).toBe(200);
    expect(k.body.ingestion).toMatchObject({ failed: 1, running: 0 });
  }, 120_000);

  it("S10：A 把决定分享到项目 ⇒ B 在项目会话里用得上并标明由 A 分享；A 撤回分享 ⇒ B 下一轮不再有；B 的个人空间始终没有", async () => {
    const [row] = await asOwner(async (c) => (await c.query<{ id: string }>(
      "SELECT id FROM claims WHERE org_id = $1 AND scope_kind = 'personal' AND scope_id = $2 AND statement = $3",
      [ORG, USER_A, DECISION])).rows);
    expect(row, "A 的决定应在个人空间里").toBeDefined();
    const personalPath = `/knowledge-graph/personal/claims/${row!.id}`;

    // B 不能替 A 分享（A 的个人结论对 B 就是不存在）
    expect((await b.get(`${personalPath}/share-targets`)).status).toBe(404);
    expect((await b.post(`${personalPath}/share`, { projectId: PROJECT })).status).toBe(404);

    const targets = await a.get<{ targets: Array<{ projectId: string; sharedClaimId: string | null }> }>(`${personalPath}/share-targets`);
    expect(targets.status, JSON.stringify(targets.body)).toBe(200);
    expect(targets.body.targets.map((t) => t.projectId)).toContain(PROJECT);
    const shared = await a.post<{ projectClaimId: string; outcome: string }>(`${personalPath}/share`, { projectId: PROJECT });
    expect(shared.status, JSON.stringify(shared.body)).toBe(200);
    expect(shared.body.outcome).toBe("shared");

    const ask = "小学数学的试点要准备些什么？";
    const t1 = await turn(e, b, ORG, PROJECT_T, ask, AGENT);
    expect(t1.memory, "B 在项目会话里应用得上 A 分享的决定").toContain(DECISION);
    expect(t1.memory).toContain(`由 ${A_NAME} 分享自个人记忆`);
    const mem = await b.get<{ recalled: Array<{ claimId: string; statement: string; scope: string; sharedByName?: string | null }> }>(
      memoryPath(PROJECT_T, t1.answerId));
    expect(mem.status).toBe(200);
    expect(mem.body.recalled.find((m) => m.statement === DECISION))
      .toMatchObject({ claimId: shared.body.projectClaimId, scope: "project", sharedByName: A_NAME });
    // 分享的是项目副本：B 的个人空间、B 自己的个人会话都不因此多出 A 的东西
    expect((await personalStatements(b)).map((c) => c.statement)).not.toContain(DECISION);
    const own = await turn(e, b, ORG, B_OWN, ask, AGENT);
    expect(own.memory ?? "").not.toContain(DECISION);

    const un = await a.post(`${personalPath}/unshare`, { projectId: PROJECT });
    expect(un.status, JSON.stringify(un.body)).toBe(200);
    const t2 = await turn(e, b, ORG, PROJECT_T, ask, AGENT);
    expect(t2.memory ?? "", "撤回分享后 B 的下一轮不应再带上").not.toContain(DECISION);
    // A 的个人原件不受分享 / 撤回影响
    expect((await personalStatements(a)).map((c) => c.statement)).toContain(DECISION);
  }, 180_000);
});
