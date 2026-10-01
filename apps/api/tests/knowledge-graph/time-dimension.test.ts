/**
 * Issue #4363（S6）—— 记忆的时间维度，走真实路径（完整应用、真抽取 tick、生产同款 PgKnowledgeRecall、真 HTTP）：
 *
 *   - 抽取认出时间说法（「这周」「到年底」「下个月之前」）⇒ 结论带有效期（待办带截止）。
 *   - **过期的不召回**：十天前说的「这周我在上海出差」在新对话里不再被当成背景；同时说的长期事实照常召回。
 *     本人的决定（#4283 自动记入长期记忆）带着有效期进长期记忆（副本继承来源的有效期）——过期后不再被每轮强制带上，
 *     但大脑页（/knowledge-graph/personal）照样列出，标「已过期」（expired = true）。
 *   - **待办状态**：新记下的待办是「还没做」（open）并带截止；只有所有者能改（别人 = 不存在，404）；
 *     同一件待办在对话与长期记忆里各一份时一起改；「不做了」的不再召回。
 *   - **迁移回填**：迁移之前记下的待办（todo_state 为空）由迁移里的回填语句补成 open。
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { knowledgeGraph as KG } from "@repo/contracts";
import { runExtractionTick } from "../../src/application/knowledge-graph/extract-message-knowledge";
import { recallThreadKnowledge } from "../../src/application/knowledge-graph/recall-knowledge";
import { toOrgId } from "../../src/domain/org-id";
import { addChatMessage, addChatThread } from "../support/chat-db";
import { addOrgMember, asOwner, resetOrgs, seedOrg } from "../support/db";
import { client, startApp, type Client, type E2eApp, type ThreadKnowledgeBody } from "./kg-e2e-fixtures";
import { enableExtraction, extractionDeps, loopbackModel } from "./kg-extraction-fixtures";

const ORG = "org-kg-i4363-time";
const USER_A = "u-i4363-a";
const USER_B = "u-i4363-b";
const P1 = "thr-i4363-p1";
const P2 = "thr-i4363-p2";
const P3 = "thr-i4363-p3";
const P4 = "thr-i4363-p4";

const TRIP_OLD = "这周我在上海出差";
const WORK = "到年底我在北京工作";
const DEC_OLD = "这周先关注 211 高校";
const TODO = "下个月之前交报告";
const TODO2 = "这周交月度总结";
const STAY = "到年底我住在杭州";

const reply = (statement: string, kind: string, timeExpr: string | null) => JSON.stringify({
  entities: [],
  claims: [{ statement, kind, confidence: 0.9, about: [], decidedBy: null, quote: statement, timeExpr }],
});
const MODEL = () => loopbackModel([
  [TRIP_OLD, reply(TRIP_OLD, "fact", "这周")],
  [WORK, reply(WORK, "fact", "到年底")],
  [DEC_OLD, reply("我决定这周先关注 211 高校", "decision", "这周")],
  [TODO, reply(TODO, "todo", "下个月之前")],
  [TODO2, reply(TODO2, "todo", "这周")],
  [STAY, reply(STAY, "fact", "到年底")],
]).model;

type Personal = import("zod").infer<typeof KG.knowledgeGraph.getPersonalKnowledge.out>;

let e: E2eApp;
let a: Client;
let b: Client;

async function settle(): Promise<void> {
  const deps = extractionDeps(e.db, MODEL(), ORG);
  for (let i = 0; i < 50; i += 1) {
    const r = await runExtractionTick(deps);
    expect(r.failed).toBe(0);
    if (r.processed === 0) break;
  }
}

/** 说一句话；`daysAgo` > 0 ⇒ 把这条消息的时间挪到那么多天以前（「这周」按说话那天算）。 */
async function say(id: string, threadId: string, body: string, daysAgo = 0): Promise<void> {
  await addChatMessage({ orgId: ORG, id, threadId, body, authorId: USER_A });
  if (daysAgo > 0) {
    await asOwner((c) => c.query(
      `UPDATE chat_messages SET created_at = now() - make_interval(days => $3) WHERE org_id = $1 AND id = $2`, [ORG, id, daysAgo]));
  }
  await settle();
}

async function thread(threadId: string, api: Client = a): Promise<Omit<ThreadKnowledgeBody, "claims"> & { claims: KG.KgClaim[] }> {
  const k = await api.get<Omit<ThreadKnowledgeBody, "claims"> & { claims: KG.KgClaim[] }>(`/knowledge-graph/threads/${threadId}`);
  expect(k.status, JSON.stringify(k.body)).toBe(200);
  const parsed = KG.knowledgeGraph.getThreadKnowledge.out.safeParse(k.body);
  expect(parsed.success, parsed.success ? "" : JSON.stringify(parsed.error.issues)).toBe(true);
  return k.body;
}
async function personal(): Promise<Personal> {
  const r = await a.get<Personal>("/knowledge-graph/personal");
  expect(r.status).toBe(200);
  const parsed = KG.knowledgeGraph.getPersonalKnowledge.out.safeParse(r.body);
  expect(parsed.success, parsed.success ? "" : JSON.stringify(parsed.error.issues)).toBe(true);
  return r.body;
}
const recalled = async (threadId: string, query: string) =>
  (await recallThreadKnowledge(e.recall, { orgId: toOrgId(ORG), userId: USER_A, threadId, query }, () => undefined))
    .items.map((i) => i.claim.statement);
const setTodo = (api: Client, claimId: string, status: string) =>
  api.post<{ claimId: string; status: string; claimIds: string[] }>(`/knowledge-graph/claims/${claimId}/todo-status`, { status });

beforeAll(async () => {
  e = await startApp();
  await resetOrgs(ORG);
  const fx = await seedOrg({ orgId: ORG, projectId: `${ORG}-p` });
  await enableExtraction(ORG);
  for (const u of [USER_A, USER_B]) await addOrgMember(ORG, u, "consultant", fx.teams.energy!);
  for (const id of [P1, P2, P3, P4]) {
    await addChatThread({ orgId: ORG, id, projectId: null, visibilityScope: "private", createdBy: USER_A, title: id });
  }
  a = client(e, USER_A, ORG);
  b = client(e, USER_B, ORG);
}, 180_000);

afterAll(async () => {
  await e?.app.close();
});

describe("issue #4363：有效期——过期的不召回，但大脑页查得到", () => {
  it("抽取把「这周」「到年底」换算成有效期（按说话那天）", async () => {
    await say("m-i4363-trip", P1, `${TRIP_OLD}。`, 10);
    await say("m-i4363-work", P1, `${WORK}。`);
    const k = await thread(P1);
    const trip = k.claims.find((c) => c.statement === TRIP_OLD)!;
    const work = k.claims.find((c) => c.statement === WORK)!;
    expect(trip).toMatchObject({ expired: true, validUntil: expect.any(String), todoStatus: null });
    expect(Date.parse(trip.validUntil!)).toBeLessThan(Date.now());
    expect(work).toMatchObject({ expired: false });
    expect(new Date(work.validUntil!).getUTCMonth()).toBe(11); // 次年 1/1 00:00 北京时间 = 12/31 16:00Z
  }, 180_000);

  it("新对话里问「我在哪里出差 / 工作」：过期的那条不召回，没过期的照常", async () => {
    const got = await recalled(P2, "我在哪里出差，我在哪里工作");
    expect(got).toContain(WORK);
    expect(got).not.toContain(TRIP_OLD);
  }, 60_000);

  it("本人的决定带着有效期记进长期记忆；过期后不再被每轮强制带上，大脑页仍列出并标已过期", async () => {
    await say("m-i4363-dec", P1, `${DEC_OLD}。`, 10);
    const p = await personal();
    const dec = p.claims.find((c) => c.statement === "我决定这周先关注 211 高校");
    expect(dec, JSON.stringify(p.claims)).toBeDefined();
    // 副本继承来源的有效期（修之前：副本没有有效期 ⇒ 永不过期，每个新对话都被强制带上）
    expect(dec).toMatchObject({ expired: true, validUntil: expect.any(String) });
    expect(await recalled(P3, "开始写报告吧")).not.toContain("我决定这周先关注 211 高校");
  }, 180_000);
});

describe("issue #4363：待办状态（只有所有者能改）", () => {
  const ids: { todo?: string; copy?: string } = {};

  it("新记下的待办是「还没做」，带截止（下个月之前 ⇒ 下月 1 日）", async () => {
    await say("m-i4363-todo", P1, `${TODO}。`);
    const t = (await thread(P1)).claims.find((c) => c.statement === TODO)!;
    ids.todo = t.id;
    expect(t).toMatchObject({ kind: "todo", todoStatus: "open", expired: false, validUntil: null });
    expect(new Date(Date.parse(t.dueAt!) + 8 * 3600_000).getUTCDate()).toBe(1); // 北京时间下月 1 日 00:00
  }, 180_000);

  it("别人改：404（同不存在）；非法状态：400；所有者改成「做完了」：面板里就是做完了，会话版本前进", async () => {
    const before = await thread(P1);
    const other = await setTodo(b, ids.todo!, "done");
    expect(other.status).toBe(404);
    expect(other.body).toMatchObject({ reasonCode: "KG_CLAIM_NOT_FOUND" });
    expect((await setTodo(a, "clm-does-not-exist", "done")).status).toBe(404);
    expect((await setTodo(a, ids.todo!, "finished")).status).toBe(400);
    const own = await setTodo(a, ids.todo!, "done");
    expect(own.status, JSON.stringify(own.body)).toBe(200);
    expect(KG.knowledgeGraph.setTodoStatus.out.parse(own.body)).toEqual({ claimId: ids.todo, status: "done", claimIds: [ids.todo] });
    const after = await thread(P1);
    expect(after.claims.find((c) => c.id === ids.todo)!.todoStatus).toBe("done");
    expect(after.revision).toBeGreaterThan(before.revision);
    // 不是待办的结论：同一个 404
    const fact = after.claims.find((c) => c.statement === WORK)!;
    expect((await setTodo(a, fact.id, "done")).status).toBe(404);
  }, 120_000);

  it("记到长期记忆的那份继承状态；在长期记忆里改「不做了」⇒ 对话里那份一起改，且不再被召回", async () => {
    const k = await thread(P1);
    expect((await a.post(`/knowledge-graph/threads/${P1}/actions`, {
      basedOnRevision: k.revision, action: { type: "confirmClaims", claimIds: [ids.todo] },
    })).status).toBe(200);
    const promoted = await a.post<{ results: Array<{ personalClaimId?: string }> }>(`/knowledge-graph/threads/${P1}/promote`, { claimIds: [ids.todo] });
    expect(promoted.status, JSON.stringify(promoted.body)).toBe(200);
    ids.copy = promoted.body.results[0]!.personalClaimId!;
    const copy = (await personal()).claims.find((c) => c.id === ids.copy)!;
    expect(copy).toMatchObject({ todoStatus: "done", dueAt: expect.any(String) });

    expect(await recalled(P2, "交报告的事")).toContain(TODO);
    const r = await setTodo(a, ids.copy, "dropped");
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect([...r.body.claimIds].sort()).toEqual([ids.todo, ids.copy].sort());
    expect((await thread(P1)).claims.find((c) => c.id === ids.todo)!.todoStatus).toBe("dropped");
    expect(await recalled(P2, "交报告的事")).not.toContain(TODO);
    // 审计：对话与长期记忆各一条人的动作
    const audit = await asOwner(async (c) => (await c.query<{ scope_kind: string; actor_kind: string }>(
      `SELECT scope_kind, actor_kind FROM ontology_actions WHERE org_id = $1 AND action_type = 'setTodoStatus' ORDER BY created_at, id`, [ORG])).rows);
    expect(audit).toEqual(expect.arrayContaining([
      { scope_kind: "chat_session", actor_kind: "human" }, { scope_kind: "personal", actor_kind: "human" },
    ]));
  }, 180_000);
});

describe("issue #4363 review（#4492）：改写一条结论不丢时间字段", () => {
  it("做完了、带截止的待办改个说法：新条仍是「做完了」、截止不变；带「到年底」有效期的事实改写后有效期不变", async () => {
    await say("m-i4363-todo2", P4, `${TODO2}。`);
    await say("m-i4363-stay", P4, `${STAY}。`);
    let k = await thread(P4);
    const todo = k.claims.find((c) => c.statement === TODO2)!;
    const stay = k.claims.find((c) => c.statement === STAY)!;
    expect(todo).toMatchObject({ todoStatus: "open", dueAt: expect.any(String) });
    expect(stay).toMatchObject({ validUntil: expect.any(String), expired: false });
    expect((await setTodo(a, todo.id, "done")).status).toBe(200);

    const revise = async (claimId: string, statement: string) => {
      const { revision } = await thread(P4);
      const r = await a.post(`/knowledge-graph/threads/${P4}/actions`, { basedOnRevision: revision, action: { type: "reviseClaim", claimId, statement } });
      expect(r.status, JSON.stringify(r.body)).toBe(200);
    };
    await revise(todo.id, "这周交月度总结（含附录）");
    await revise(stay.id, "到年底我一直住在杭州");
    k = await thread(P4);
    const todo2 = k.claims.find((c) => c.statement === "这周交月度总结（含附录）")!;
    const stay2 = k.claims.find((c) => c.statement === "到年底我一直住在杭州")!;
    expect(k.claims.map((c) => c.id)).not.toContain(todo.id);
    // 修之前：todoStatus = "open"、dueAt = null；validUntil = null
    expect(todo2).toMatchObject({ kind: "todo", todoStatus: "done", dueAt: todo.dueAt, supersedesClaimId: todo.id });
    expect(stay2).toMatchObject({ validUntil: stay.validUntil, expired: false, supersedesClaimId: stay.id });
    const [row] = await asOwner(async (c) => (await c.query<{ same: boolean }>(
      "SELECT n.valid_from = o.valid_from AS same FROM claims n JOIN claims o ON o.id = n.supersedes_claim_id WHERE n.org_id = $1 AND n.id = $2",
      [ORG, stay2.id])).rows);
    expect(row!.same).toBe(true);
  }, 180_000);
});

describe("issue #4363：迁移回填", () => {
  it("迁移之前记下的待办（todo_state 为空）由迁移里的回填语句补成 open；非待办不动", async () => {
    const sql = readFileSync(fileURLToPath(new URL("../../migrations/20260928170000_kg_s6_time_dimension.sql", import.meta.url)), "utf8");
    const backfill = /^UPDATE claims SET todo_state = 'open' WHERE [^;]+;/m.exec(sql)?.[0];
    expect(backfill).toBeDefined();
    const legacy = "clm-i4363-legacy-todo";
    await asOwner(async (c) => {
      await c.query("BEGIN");
      // 模拟迁移之前的行：那时还没有默认值触发器
      await c.query("SET LOCAL session_replication_role = replica");
      await c.query(
        `INSERT INTO claims (id, org_id, statement, status, tsv, claim_kind, confidence, created_by, scope_kind, scope_id, valid_from)
         VALUES ($1, $2, '周五前整理会议纪要', 'proposed', to_tsvector('simple', '周五前整理会议纪要'), 'todo', 0.8, 'model', 'chat_session', $3, now())`,
        [legacy, ORG, P3]);
      await c.query("COMMIT");
    });
    const status = async () => (await asOwner(async (c) => (await c.query<{ todo_state: string | null }>(
      "SELECT todo_state FROM claims WHERE org_id = $1 AND id = $2", [ORG, legacy])).rows))[0]!.todo_state;
    expect(await status()).toBeNull();
    await asOwner((c) => c.query(backfill!));
    expect(await status()).toBe("open");
    const facts = await asOwner(async (c) => (await c.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM claims WHERE org_id = $1 AND claim_kind <> 'todo' AND todo_state IS NOT NULL", [ORG])).rows);
    expect(facts[0]!.n).toBe(0);
  }, 60_000);
});
