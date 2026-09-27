/**
 * issue #4360 / #4362（S5）—— 「关于我」画像层与新会话开场简报，走真实路径（kg-e2e-fixtures.ts：完整应用、真抽取 tick、
 * 生产同款召回与读接口、真 HTTP）。抽取模型与挂目标模型用本文件自己的回环（按原话 / 按决定原文回 JSON）。
 *
 *   - 挂目标：模型高把握 ⇒ 系统挂上（serves_goal，created_by model）；低把握 ⇒ 不挂；本人可以手动挂 / 摘，别人动不了；
 *   - 画像摘要：本人个人对话里每轮带上「约束与身份」等画像条目（打分与强制召回都带不上的那种）；项目会话、别人的会话不带；
 *   - 开场简报：没有记忆 ⇒ 空；只有本人个人空间（不含项目会话的待办、不含别人的）；续上的首问发出去，这一轮的引用正是那一条；
 *     关掉会记住（只对本人）；埋点只记本人；
 *   - 级联：改写目标 ⇒ 挂在它下面的决定跟着走、旧说法不再被召回；忘掉目标 ⇒ 挂接一起失效、简报与召回都不再有它。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { knowledgeGraph as KG } from "@repo/contracts";
import type { z } from "zod";
import { runExtractionTick } from "../../src/application/knowledge-graph/extract-message-knowledge";
import type { ModelCallPort } from "../../src/application/agent-run/ports";
import type { LogFields } from "../../src/application/ports/logger.port";
import { ModelGoalLinker } from "../../src/infrastructure/knowledge-graph/model-goal-linker";
import { PgKgProfile } from "../../src/infrastructure/knowledge-graph/pg-kg-profile";
import { addChatMessage, addChatThread } from "../support/chat-db";
import { addOrgMember, addProjectMember, asApp, asOwner, resetOrgs, seedOrg } from "../support/db";
import {
  client, memoryPath, projectGraph, publishAgent, startApp, turn,
  type Client, type E2eApp, type TurnMemoryBody,
} from "./kg-e2e-fixtures";
import { enableExtraction, extractionDeps, loopbackModel } from "./kg-extraction-fixtures";

const ORG = "org-kg-s5-profile";
const PROJECT = `${ORG}-p`;
const USER_A = "u-s5-a";
const USER_B = "u-s5-b";
const USER_C = "u-s5-c";
const AGENT = "agent-s5";
const A1 = "thr-s5-a1";
const A2 = "thr-s5-a2";
const A3 = "thr-s5-a3";
const B1 = "thr-s5-b1";
const P1 = "thr-s5-p1";

const GOAL = "我的目标是探索未来教育";
const GOAL_REVISED = "我的目标是探索未来教育与 AI 的结合";
const DECIDE_HIGH = "我决定先调研三所实验学校";
const DECIDE_LOW = "我决定周末整理书架";
const IDENTITY = "我是一名中学语文老师";
const TODO = "下周约王老师聊课程设计";
const PROJECT_TODO = "整理项目客户名单";
const B_GOAL = "我的目标是成为数据科学家";

const reply = (statement: string, kind: KG.KgClaimKind) => JSON.stringify({
  entities: [], claims: [{ statement, kind, confidence: 0.9, about: [], decidedBy: null, quote: statement }],
});

/** 挂目标回环：按决定原文回提议（高把握 / 低把握各一条）。 */
const linkModel: ModelCallPort = {
  complete: async (input) => ({
    text: input.user.includes(DECIDE_HIGH) ? '{"goal":"g1","confidence":0.92}'
      : input.user.includes(DECIDE_LOW) ? '{"goal":"g1","confidence":0.4}' : '{"goal":null,"confidence":0}',
  }),
};

let e: E2eApp;
let a: Client;
let b: Client;
let c: Client;
const logs: { msg: string; fields: LogFields }[] = [];

async function settle(): Promise<void> {
  const { model } = loopbackModel([
    [GOAL, reply(GOAL, "goal")], [DECIDE_HIGH, reply(DECIDE_HIGH, "decision")], [DECIDE_LOW, reply(DECIDE_LOW, "decision")],
    [IDENTITY, reply(IDENTITY, "fact")], ["约王老师", reply(TODO, "todo")], [PROJECT_TODO, reply(PROJECT_TODO, "todo")],
    [B_GOAL, reply(B_GOAL, "goal")],
  ]);
  const logger = { info: (msg: string, fields: LogFields) => { logs.push({ msg, fields }); }, error: () => undefined };
  const deps = {
    ...extractionDeps(e.db, model, ORG), logger,
    goalLinks: { goalLinks: new PgKgProfile(e.db), proposer: new ModelGoalLinker(linkModel, { enabled: true, provider: "p", modelId: "m" }, logger) },
  };
  for (let i = 0; i < 50; i += 1) {
    const r = await runExtractionTick(deps);
    expect(r.failed).toBe(0);
    if (r.processed === 0) break;
  }
  await projectGraph(e);
}

const q = <T>(sql: string, params: unknown[]) => asOwner(async (x) => (await x.query<T & Record<string, unknown>>(sql, params)).rows);
async function sessionClaimId(threadId: string, statement: string): Promise<string> {
  const rows = await q<{ id: string }>("SELECT id FROM claims WHERE org_id = $1 AND scope_kind = 'chat_session' AND scope_id = $2 AND statement = $3", [ORG, threadId, statement]);
  expect(rows, `会话 ${threadId} 里应抽出「${statement}」`).toHaveLength(1);
  return rows[0]!.id;
}
async function livePersonal(statement: string): Promise<string | null> {
  const rows = await q<{ id: string }>(
    "SELECT id FROM claims WHERE org_id = $1 AND scope_kind = 'personal' AND scope_id = $2 AND statement = $3 AND revoked_at IS NULL AND status <> 'superseded'",
    [ORG, USER_A, statement]);
  return rows[0]?.id ?? null;
}
async function activeGoalOf(claimId: string): Promise<{ dst_id: string; created_by: string }[]> {
  return q<{ dst_id: string; created_by: string }>(
    "SELECT dst_id, created_by FROM ontology_edges WHERE org_id = $1 AND src_id = $2 AND relation = 'serves_goal' AND status = 'active'", [ORG, claimId]);
}
/** client() 只有 get / post；设置类接口是 PUT。 */
async function put<T>(userId: string, path: string, body: unknown): Promise<{ status: number; body: T }> {
  const res = await fetch(`${e.base}${path}`, {
    method: "PUT", headers: { "x-kernel-test-principal": `${userId}:${ORG}`, "content-type": "application/json" }, body: JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: (text.length > 0 ? JSON.parse(text) : null) as T };
}
const briefing = async (api: Client) => {
  const r = await api.get<KG.KgSessionBriefing>("/knowledge-graph/briefing");
  expect(r.status).toBe(200);
  expect(KG.KgSessionBriefing.safeParse(r.body).success).toBe(true);
  return r.body;
};

beforeAll(async () => {
  e = await startApp();
  await resetOrgs(ORG);
  await seedOrg({ orgId: ORG, projectId: PROJECT });
  await enableExtraction(ORG);
  for (const u of [USER_A, USER_B, USER_C]) await addOrgMember(ORG, u, "consultant", null);
  for (const u of [USER_A, USER_B]) await addProjectMember(ORG, PROJECT, u, "facilitator", null);
  await publishAgent(ORG, AGENT, USER_A);
  for (const id of [A1, A2, A3]) await addChatThread({ orgId: ORG, id, projectId: null, visibilityScope: "private", createdBy: USER_A, title: id });
  await addChatThread({ orgId: ORG, id: B1, projectId: null, visibilityScope: "private", createdBy: USER_B, title: B1 });
  await addChatThread({ orgId: ORG, id: P1, projectId: PROJECT, visibilityScope: "plenary", createdBy: USER_A, title: "项目群聊" });
  a = client(e, USER_A, ORG);
  b = client(e, USER_B, ORG);
  c = client(e, USER_C, ORG);

  await addChatMessage({ orgId: ORG, id: "m-s5-goal", threadId: A1, body: GOAL, authorId: USER_A });
  await settle();
  await addChatMessage({ orgId: ORG, id: "m-s5-high", threadId: A1, body: `${DECIDE_HIGH}。`, authorId: USER_A });
  await addChatMessage({ orgId: ORG, id: "m-s5-low", threadId: A1, body: `${DECIDE_LOW}。`, authorId: USER_A });
  await addChatMessage({ orgId: ORG, id: "m-s5-id", threadId: A1, body: `${IDENTITY}。`, authorId: USER_A });
  await addChatMessage({ orgId: ORG, id: "m-s5-todo", threadId: A1, body: "下周要约王老师聊一下课程设计。", authorId: USER_A });
  await addChatMessage({ orgId: ORG, id: "m-s5-ptodo", threadId: P1, body: `${PROJECT_TODO}。`, authorId: USER_A });
  await addChatMessage({ orgId: ORG, id: "m-s5-bgoal", threadId: B1, body: B_GOAL, authorId: USER_B });
  await settle();
}, 240_000);

afterAll(async () => {
  await e?.app.close();
});

describe("issue #4360: 目标 → 决定 / 待办的挂接", () => {
  it("模型高把握 ⇒ 新记下的决定由系统挂到本人的目标下；低把握 ⇒ 不挂（留日志）", async () => {
    const goal = (await livePersonal(GOAL))!;
    const high = (await livePersonal(DECIDE_HIGH))!;
    const low = (await livePersonal(DECIDE_LOW))!;
    expect([goal, high, low].every((x) => x !== null)).toBe(true);
    expect(await activeGoalOf(high)).toEqual([{ dst_id: goal, created_by: "model" }]);
    expect(await activeGoalOf(low)).toEqual([]);
    expect(logs.find((l) => l.msg === "kg goal link not applied" && l.fields.claimId === low)?.fields.reason).toBe("low_confidence");
    const personal = await a.get<z.infer<typeof KG.knowledgeGraph.getPersonalKnowledge.out>>("/knowledge-graph/personal");
    expect(personal.status).toBe(200);
    expect(KG.knowledgeGraph.getPersonalKnowledge.out.safeParse(personal.body).success).toBe(true);
    expect(personal.body.edges.filter((x) => x.relation === "serves_goal").map((x) => [x.src.id, x.dst.id])).toEqual([[high, goal]]);
  });

  it("本人可以手动挂 / 摘；别人碰不到（同一个 404），挂到不是目标的条目上也不行", async () => {
    const goal = (await livePersonal(GOAL))!;
    const low = (await livePersonal(DECIDE_LOW))!;
    const path = `/knowledge-graph/personal/claims/${low}/goal`;
    expect((await put(USER_B, path, { goalClaimId: goal })).status).toBe(404);
    expect((await put(USER_A, path, { goalClaimId: low })).status).toBe(404);
    const r = await put<{ claimId: string; goalClaimId: string | null }>(USER_A, path, { goalClaimId: goal });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ claimId: low, goalClaimId: goal });
    expect(await activeGoalOf(low)).toEqual([{ dst_id: goal, created_by: "human" }]);
    expect((await put(USER_A, path, { goalClaimId: null })).status).toBe(200);
    expect(await activeGoalOf(low)).toEqual([]);
  });
});

describe("issue #4360: 画像摘要每轮带上（只进本人的个人对话）", () => {
  it("把「我是一名中学语文老师」记进长期记忆后，新个人对话里一句无关的话也带上它（claim 通道、引用指回它）", async () => {
    const src = await sessionClaimId(A1, IDENTITY);
    const p = await a.post<{ results: Array<{ outcome: string }> }>(`/knowledge-graph/threads/${A1}/promote`, { claimIds: [src] });
    expect(p.status).toBe(200);
    expect(p.body.results[0]!.outcome).toBe("promoted");
    const t = await turn(e, a, ORG, A2, "今天天气如何", AGENT);
    expect(t.memory).toContain(IDENTITY);
    const mem = await a.get<TurnMemoryBody>(memoryPath(A2, t.answerId));
    expect(mem.body.recalled.find((m) => m.statement === IDENTITY)).toMatchObject({ scope: "personal", channels: ["claim"] });
  }, 120_000);

  it("项目会话里不带画像摘要；别人的会话里没有 A 的任何画像", async () => {
    const tp = await turn(e, a, ORG, P1, "今天天气如何", AGENT);
    expect(tp.memory ?? "").not.toContain(IDENTITY);
    const tb = await turn(e, b, ORG, B1, "今天天气如何", AGENT);
    for (const s of [IDENTITY, GOAL, DECIDE_HIGH, TODO]) expect(tb.memory ?? "").not.toContain(s);
    expect(tb.memory).toContain(B_GOAL);
  }, 120_000);
});

describe("issue #4362: 新会话开场简报", () => {
  it("没有任何记忆的人 ⇒ 空（界面不显示）", async () => {
    expect(await briefing(c)).toEqual({ dismissed: false, items: [] });
  });

  it("A：最近的目标与决定（决定带挂着的目标）、本人个人对话里的待办；不含项目会话的待办、不含别人的", async () => {
    const goal = (await livePersonal(GOAL))!;
    const high = (await livePersonal(DECIDE_HIGH))!;
    const body = await briefing(a);
    const text = JSON.stringify(body);
    expect(text).not.toContain(PROJECT_TODO);
    expect(text).not.toContain(B_GOAL);
    const byCite = new Map(body.items.map((i) => [i.cite.claimId, i]));
    expect(byCite.get(goal)).toMatchObject({ section: "recent", kind: "goal", statement: GOAL });
    expect(byCite.get(high)).toMatchObject({ section: "recent", kind: "decision", goal: { claimId: goal, statement: GOAL } });
    const todo = body.items.find((i) => i.section === "open_todos")!;
    expect(todo).toMatchObject({ kind: "todo", statement: TODO, cite: { claimId: await sessionClaimId(A1, TODO), scope: "chat_session", threadId: A1 } });
    for (const i of body.items) expect(i.resumePrompt).toContain(i.statement);
    const bText = JSON.stringify(await briefing(b));
    for (const s of [GOAL, DECIDE_HIGH, TODO, IDENTITY]) expect(bText).not.toContain(s);
  });

  it("还开着的「可能改口」卡进「还没定下来的」；卡处理掉之后就不在了", async () => {
    const newer = await sessionClaimId(A1, DECIDE_LOW);
    const older = await sessionClaimId(A1, DECIDE_HIGH);
    await asOwner((x) => x.query(
      `INSERT INTO kg_conflict_prompts (id, org_id, thread_id, message_id, newer_claim_id, older_claim_id, newer_key, rank, status, detected_by_action_id, kind)
       VALUES ('cp-s5', $1, $2, 'm-s5-low', $3, $4, 'k', 0, 'open', 'act-s5', 'possible_change')`, [ORG, A1, newer, older]));
    const card = (await briefing(a)).items.find((i) => i.section === "unresolved");
    expect(card).toMatchObject({ itemId: "unresolved:cp-s5", cardKind: "possible_change", statement: DECIDE_LOW, counterpart: { claimId: older, statement: DECIDE_HIGH }, cite: { claimId: newer, threadId: A1 } });
    expect(JSON.stringify(await briefing(b))).not.toContain("cp-s5");
    await asOwner((x) => x.query("UPDATE kg_conflict_prompts SET status = 'kept_both', resolved_at = now() WHERE id = 'cp-s5'"));
    expect((await briefing(a)).items.some((i) => i.section === "unresolved")).toBe(false);
  });

  it("续上：把待办的首问在新对话里发出去 ⇒ 回答用到它，这一轮的引用正是简报引用的那一条", async () => {
    const todo = (await briefing(a)).items.find((i) => i.section === "open_todos")!;
    const t = await turn(e, a, ORG, A3, todo.resumePrompt, AGENT);
    expect(t.answer).toContain(TODO);
    const mem = await a.get<TurnMemoryBody>(memoryPath(A3, t.answerId));
    expect(mem.body.recalled.map((m) => m.claimId)).toContain(todo.cite.claimId);
  }, 120_000);

  it("关掉会记住（只对本人）；重新打开又有；埋点只记本人自己的", async () => {
    expect((await put(USER_A, "/knowledge-graph/briefing/preference", { dismissed: true })).body).toEqual({ dismissed: true });
    expect(await briefing(a)).toEqual({ dismissed: true, items: [] });
    expect((await briefing(b)).dismissed).toBe(false);
    expect((await put(USER_A, "/knowledge-graph/briefing/preference", { dismissed: false })).body).toEqual({ dismissed: false });
    expect((await briefing(a)).items.length).toBeGreaterThan(0);

    for (const event of ["shown", "accepted", "dismissed"] as const) {
      const r = await a.post("/knowledge-graph/briefing/events", { event, itemIds: ["recent:x"] });
      expect(r.status).toBe(200);
    }
    expect((await a.post("/knowledge-graph/briefing/events", { event: "clicked", itemIds: [] })).status).toBe(400);
    const own = await q<{ user_id: string; event: string }>("SELECT user_id, event FROM kg_briefing_events WHERE org_id = $1 ORDER BY id", [ORG]);
    expect(own.map((r) => [r.user_id, r.event])).toEqual([[USER_A, "shown"], [USER_A, "accepted"], [USER_A, "dismissed"]]);
    // RLS：B 的会话里读不到 A 的埋点与偏好。
    const seenByB = await asApp(ORG, async (x) => {
      await x.query("SELECT set_config('app.current_user_id', $1, false)", [USER_B]);
      const ev = await x.query("SELECT 1 FROM kg_briefing_events");
      const pr = await x.query("SELECT 1 FROM kg_briefing_preferences");
      return ev.rowCount! + pr.rowCount!;
    });
    expect(seenByB).toBe(0);
  });
});

describe("issue #4360: 改写 / 忘掉会级联", () => {
  it("改写目标 ⇒ 新说法「你确认过」、旧的折叠为「取代了」；挂在它下面的决定跟着走；下一轮召回用新说法", async () => {
    const goal = (await livePersonal(GOAL))!;
    const high = (await livePersonal(DECIDE_HIGH))!;
    expect((await b.post(`/knowledge-graph/personal/claims/${goal}/revise`, { statement: "别人改的" })).status).toBe(404);
    const r = await a.post<{ claimId: string }>(`/knowledge-graph/personal/claims/${goal}/revise`, { statement: GOAL_REVISED });
    expect(r.status).toBe(200);
    const fresh = r.body.claimId;
    expect(await livePersonal(GOAL)).toBeNull();
    expect(await livePersonal(GOAL_REVISED)).toBe(fresh);
    expect(await activeGoalOf(high)).toEqual([{ dst_id: fresh, created_by: "model" }]);
    const personal = await a.get<{ claims: Array<{ id: string; triState: string }>; replaced: Array<{ byClaimId: string; replaces: { statement: string } }> }>("/knowledge-graph/personal");
    expect(personal.body.claims.find((x) => x.id === fresh)?.triState).toBe("confirmed");
    expect(personal.body.replaced).toContainEqual(expect.objectContaining({ byClaimId: fresh, replaces: expect.objectContaining({ statement: GOAL }) }));
    const overview = await a.get<{ personalOrigins: Array<{ personalClaimId: string; threadId: string }> }>("/knowledge-graph/me/overview");
    expect(overview.body.personalOrigins.find((o) => o.personalClaimId === fresh)?.threadId).toBe(A1);
    const t = await turn(e, a, ORG, A2, "帮我规划一下", AGENT);
    expect(t.memory).toContain(GOAL_REVISED);
    expect(t.memory).not.toMatch(new RegExp(`${GOAL}（`));
  }, 120_000);

  it("忘掉目标（/brain 的既有动作：在来源对话里忘掉原话）⇒ 长期记忆里那条失效、挂接一起失效；简报与召回都不再有它", async () => {
    const goal = (await livePersonal(GOAL_REVISED))!;
    const high = (await livePersonal(DECIDE_HIGH))!;
    const src = await sessionClaimId(A1, GOAL);
    const k = await a.get<{ revision: number }>(`/knowledge-graph/threads/${A1}`);
    const r = await a.post(`/knowledge-graph/threads/${A1}/actions`, { basedOnRevision: k.body.revision, action: { type: "revokeClaim", claimId: src } });
    expect(r.status).toBe(200);
    expect(await livePersonal(GOAL_REVISED)).toBeNull();
    expect(await activeGoalOf(high)).toEqual([]);
    const body = await briefing(a);
    expect(body.items.some((i) => i.cite.claimId === goal)).toBe(false);
    expect(body.items.find((i) => i.cite.claimId === high)?.goal).toBeNull();
    const t = await turn(e, a, ORG, A2, "帮我规划一下", AGENT);
    expect(t.memory ?? "").not.toContain(GOAL_REVISED);
  }, 120_000);
});
