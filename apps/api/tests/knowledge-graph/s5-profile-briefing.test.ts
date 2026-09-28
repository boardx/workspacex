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
import { toOrgId } from "../../src/domain/org-id";
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
}, 600_000);

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

/*
 * #4494 review（S6 #4363 落地之后）：
 *   B1 —— 简报与挂目标只用「还算数」的：做完 / 不做了的待办、过期的结论不是「未了事项」，过期的目标不能再挂；
 *   M1 —— 改写个人空间里的待办不改它的状态（复制 derived_from 会触发 S6 的 kg_copy_inherits_time，不能让它把 done 改回 open）；
 *   M2 —— 改写分享到过项目的一条 ⇒ 项目里那份撤回（personal_source_revoked），不跟到新的一条上（人类决定 2026-09-28）。
 * 用一个新成员 D，免得和上面 A 的状态搅在一起。
 */
describe("#4494 review: S6 时间维度 × 开场简报 / 挂目标 / 改写", () => {
  const USER_D = "u-s5-d";
  const D1 = "thr-s5-d1";
  const D_GOAL = "我的目标是写完一本教学随笔";
  const D_DEC = "我决定先写第一章";
  const D_DEC2 = "我决定每周写两千字";
  const D_SHARE = "我决定语文课每周加一节阅读课";
  const D_T1 = "周五前交读书报告";
  const D_T2 = "明天给家长发通知";
  const D_T3 = "下周整理教案目录";
  const D_T5 = "月底前读完给教师的建议";
  const D_T5_REVISED = "月底前读完苏霍姆林斯基的给教师的建议";
  let d: Client;

  const chatId = async (statement: string) => {
    const rows = await q<{ id: string }>("SELECT id FROM claims WHERE org_id = $1 AND scope_kind = 'chat_session' AND scope_id = $2 AND statement = $3", [ORG, D1, statement]);
    expect(rows, `D1 里应抽出「${statement}」`).toHaveLength(1);
    return rows[0]!.id;
  };
  const personalId = async (statement: string) => {
    const rows = await q<{ id: string }>(
      "SELECT id FROM claims WHERE org_id = $1 AND scope_kind = 'personal' AND scope_id = $2 AND statement = $3 AND revoked_at IS NULL AND status <> 'superseded'",
      [ORG, USER_D, statement]);
    return rows[0]?.id ?? null;
  };
  /** 把一条结论改成「已过期」：有效期窗口整个落在过去（S6：valid_to 已过 ⇒ 过期）。 */
  const expire = (id: string) => asOwner((x) => x.query(
    "UPDATE claims SET valid_from = now() - interval '2 days', valid_to = now() - interval '1 day' WHERE org_id = $1 AND id = $2", [ORG, id]));
  const setTodo = async (id: string, status: KG.KgTodoStatus) => {
    const r = await d.post(`/knowledge-graph/claims/${id}/todo-status`, { status });
    expect(r.status).toBe(200);
  };
  const statements = async () => (await briefing(d)).items.map((i) => i.statement);

  beforeAll(async () => {
    await addOrgMember(ORG, USER_D, "consultant", null);
    await addProjectMember(ORG, PROJECT, USER_D, "facilitator", null);
    await addChatThread({ orgId: ORG, id: D1, projectId: null, visibilityScope: "private", createdBy: USER_D, title: D1 });
    d = client(e, USER_D, ORG);
    const bodies: Array<[string, string]> = [
      ["m-s5-d-goal", D_GOAL], ["m-s5-d-dec", `${D_DEC}。`], ["m-s5-d-dec2", `${D_DEC2}。`], ["m-s5-d-share", `${D_SHARE}。`],
      ["m-s5-d-t1", `${D_T1}。`], ["m-s5-d-t2", `${D_T2}。`], ["m-s5-d-t3", `${D_T3}。`], ["m-s5-d-t5", `${D_T5}。`],
    ];
    for (const [id, body] of bodies) await addChatMessage({ orgId: ORG, id, threadId: D1, body, authorId: USER_D });
    const { model } = loopbackModel([
      [D_GOAL, reply(D_GOAL, "goal")], [D_DEC2, reply(D_DEC2, "decision")], [D_DEC, reply(D_DEC, "decision")],
      [D_SHARE, reply(D_SHARE, "decision")],
      [D_T1, reply(D_T1, "todo")], [D_T2, reply(D_T2, "todo")], [D_T3, reply(D_T3, "todo")], [D_T5, reply(D_T5, "todo")],
    ]);
    const quiet = { info: () => undefined, error: () => undefined };
    const deps = {
      ...extractionDeps(e.db, model, ORG), logger: quiet,
      goalLinks: { goalLinks: new PgKgProfile(e.db), proposer: new ModelGoalLinker(linkModel, { enabled: true, provider: "p", modelId: "m" }, quiet) },
    };
    for (let i = 0; i < 50; i += 1) {
      const r = await runExtractionTick(deps);
      expect(r.failed).toBe(0);
      if (r.processed === 0) break;
    }
    await projectGraph(e);
  }, 600_000);

  it("M1：改写一条已做完的待办 ⇒ 新的一条仍是 done（复制来源边不把状态改回来源的 open）", async () => {
    const src = await chatId(D_T5);
    const p = await d.post<{ results: Array<{ outcome: string }> }>(`/knowledge-graph/threads/${D1}/promote`, { claimIds: [src] });
    expect(p.status).toBe(200);
    expect(p.body.results[0]!.outcome).toBe("promoted");
    const mine = (await personalId(D_T5))!;
    await setTodo(mine, "done");
    // 此刻同一件待办的两份都是 done（kg_set_todo_state 一起改调用方管得到的那几份）。来源那份不归本人管时（别人的对话），
    // 两份就会分叉：这里把来源那份置回 open 模拟分叉——这正是 kg_copy_inherits_time 会拿来源状态覆盖新一条的情形。
    await asOwner((x) => x.query("UPDATE claims SET todo_state = 'open' WHERE org_id = $1 AND id = $2", [ORG, src]));
    const r = await d.post<{ claimId: string }>(`/knowledge-graph/personal/claims/${mine}/revise`, { statement: D_T5_REVISED });
    expect(r.status).toBe(200);
    const rows = await q<{ todo_state: string | null; statement: string }>("SELECT todo_state, statement FROM claims WHERE org_id = $1 AND id = $2", [ORG, r.body.claimId]);
    expect(rows).toEqual([{ todo_state: "done", statement: D_T5_REVISED }]);
    // 做完了的不在简报里（B1）。
    expect(await statements()).not.toContain(D_T5_REVISED);
  });

  it("B1：会话里的待办——做完（done）、不做了（dropped）、过期的都不在「未了事项」里", async () => {
    const t1 = await chatId(D_T1);
    const t2 = await chatId(D_T2);
    const t3 = await chatId(D_T3);
    // 「未了事项」一节最多两条、新的在前：此刻是 T3、T2。
    let s = await statements();
    expect(s).toContain(D_T3);
    expect(s).toContain(D_T2);
    await setTodo(t3, "done");
    s = await statements();
    expect(s).not.toContain(D_T3);
    expect(s).toContain(D_T2);
    await setTodo(t2, "dropped");
    s = await statements();
    expect(s).not.toContain(D_T2);
    expect(s).toContain(D_T1);
    await expire(t1);
    expect(await statements()).not.toContain(D_T1);
    expect((await briefing(d)).items.filter((i) => i.section === "open_todos")).toEqual([]);
  });

  it("B1：长期记忆里过期的决定不在「最近」里（让位给下一条还算数的）", async () => {
    // 「最近」里决定最多两条、新的在前：此刻是 D_SHARE、D_DEC2，D_DEC 排不上。
    const dec2 = (await personalId(D_DEC2))!;
    let s = await statements();
    expect(s).toContain(D_DEC2);
    expect(s).not.toContain(D_DEC);
    await expire(dec2);
    s = await statements();
    expect(s).not.toContain(D_DEC2);
    expect(s).toContain(D_DEC);
  });

  it("B1：矛盾 / 可能改口卡——任何一边做完了或过期了，卡就不在「还没定下来的」里", async () => {
    const goalSrc = await chatId(D_GOAL);
    const done = await chatId(D_T3); // 上一条里已标 done
    const live = await chatId(D_DEC2);
    const card = (id: string, newer: string) => asOwner((x) => x.query(
      `INSERT INTO kg_conflict_prompts (id, org_id, thread_id, message_id, newer_claim_id, older_claim_id, newer_key, rank, status, detected_by_action_id, kind)
       VALUES ($1, $2, $3, 'm-s5-d-dec2', $4, $5, $1, 0, 'open', 'act-' || $1, 'possible_change')`, [id, ORG, D1, newer, goalSrc]));
    await card("cp-s5-d-done", done);
    expect((await briefing(d)).items.some((i) => i.section === "unresolved")).toBe(false);
    await card("cp-s5-d-live", live);
    expect((await briefing(d)).items.find((i) => i.section === "unresolved")).toMatchObject({ itemId: "unresolved:cp-s5-d-live" });
    await expire(goalSrc);
    expect((await briefing(d)).items.some((i) => i.section === "unresolved")).toBe(false);
  });

  it("B1：过期的目标不再是挂接候选，也不能再挂", async () => {
    const goal = (await personalId(D_GOAL))!;
    const dec = (await personalId(D_DEC))!;
    const profile = new PgKgProfile(e.db);
    expect((await profile.candidates(toOrgId(ORG), D1, "m-s5-d-dec")).goals.map((g) => g.id)).toContain(goal);
    const path = `/knowledge-graph/personal/claims/${dec}/goal`;
    expect((await put(USER_D, path, { goalClaimId: goal })).status).toBe(200);
    expect((await put(USER_D, path, { goalClaimId: null })).status).toBe(200);
    await expire(goal);
    expect((await profile.candidates(toOrgId(ORG), D1, "m-s5-d-dec")).goals.map((g) => g.id)).not.toContain(goal);
    expect((await put(USER_D, path, { goalClaimId: goal })).status).toBe(404);
    expect(await activeGoalOf(dec)).toEqual([]);
  });

  it("M2（人类决定 2026-09-28）：改写分享到项目的一条 ⇒ 项目里那份撤回（personal_source_revoked），不跟到新的一条上", async () => {
    const mine = (await personalId(D_SHARE))!;
    const s = await d.post<{ projectClaimId: string; outcome: string }>(`/knowledge-graph/personal/claims/${mine}/share`, { projectId: PROJECT });
    expect(s.status).toBe(200);
    expect(s.body.outcome).toBe("shared");
    const copy = s.body.projectClaimId;
    const revised = "我决定语文课每周加两节阅读课";
    const r = await d.post<{ claimId: string }>(`/knowledge-graph/personal/claims/${mine}/revise`, { statement: revised });
    expect(r.status).toBe(200);
    const rows = await q<{ status: string; revoked: boolean; revocation_reason: string | null }>(
      "SELECT status, revoked_at IS NOT NULL AS revoked, revocation_reason FROM claims WHERE org_id = $1 AND id = $2", [ORG, copy]);
    expect(rows).toEqual([{ status: "superseded", revoked: true, revocation_reason: "personal_source_revoked" }]);
    // 新的一条在项目里没有任何副本（不自动重新分享）。
    const followers = await q<{ id: string }>(
      `SELECT pc.id FROM claims pc JOIN ontology_edges e ON e.org_id = pc.org_id AND e.src_kind = 'claim' AND e.src_id = pc.id
        WHERE pc.org_id = $1 AND pc.scope_kind = 'project' AND e.relation = 'derived_from' AND e.dst_kind = 'claim' AND e.dst_id = $2`,
      [ORG, r.body.claimId]);
    expect(followers).toEqual([]);
    // 项目成员的召回里两种说法都没有。
    const t = await turn(e, b, ORG, P1, "语文课阅读课怎么安排", AGENT);
    expect(t.memory ?? "").not.toContain(D_SHARE);
    expect(t.memory ?? "").not.toContain(revised);
  }, 120_000);
});
