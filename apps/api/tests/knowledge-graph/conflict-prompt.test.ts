/**
 * Phase 18 F16 —— 矛盾提醒（uc-18-6 D，V3 / V4；uc-18-1 A3；I-18 / I-19），真实数据库。
 *
 * 知识由 F06 抽取流水线真实产生（回环模型按消息内容回固定 JSON）；矛盾在同一个抽取任务里判出、开卡；
 * 卡从 getTurnMemory 读（回答下方用户看到的就是它）；三个出口经 applyHumanAction{resolveConflict} → kg_resolve_conflict。
 * 应用层挡在前面的守卫（所有者、可见性），这里另外直接调数据库函数再验一遍。
 */
import { readFileSync } from "node:fs";
import { ForbiddenException } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyHumanAction, type HumanActionDeps } from "../../src/application/knowledge-graph/apply-human-action";
import { runExtractionTick, type ExtractionDeps } from "../../src/application/knowledge-graph/extract-message-knowledge";
import { newKgId } from "../../src/application/knowledge-graph/ids";
import { promoteToPersonal } from "../../src/application/knowledge-graph/promote-to-personal";
import { getThreadKnowledge, getTurnMemory } from "../../src/application/knowledge-graph/read-thread-knowledge";
import { findConflicts, isConflict, type ConfirmedClaim, type FreshClaim } from "../../src/domain/knowledge-graph/conflict";
import { toOrgId } from "../../src/domain/org-id";
import { PgChatRepository } from "../../src/infrastructure/chat/pg-chat-repository";
import { appConfig } from "../../src/infrastructure/db/pg-config";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { CountingDecisionIdFactory } from "../../src/infrastructure/identity/in-memory-session-store";
import { PgIdentityRepository } from "../../src/infrastructure/identity/pg-identity-repository";
import { PgHumanAction } from "../../src/infrastructure/knowledge-graph/pg-human-action";
import { PgKnowledgeRead } from "../../src/infrastructure/knowledge-graph/pg-knowledge-read";
import { PgPromotion } from "../../src/infrastructure/knowledge-graph/pg-promotion";
import { KnowledgeGraphController } from "../../src/interface/controllers/knowledge-graph.controller";
import { addChatMessage, addChatThread } from "../support/chat-db";
import { addOrgMember, addProjectMember, asApp, asOwner, ensureDatabase, migrateOnce, resetOrgs, seedOrg } from "../support/db";
import { enableExtraction, extractionDeps, loopbackModel } from "./kg-extraction-fixtures";

const ORG = "org-kg-f16-conflict";
const ORG_ID = toOrgId(ORG);
const T = {
  keepNew: "thr-f16-keepnew", keepBoth: "thr-f16-keepboth", ignore: "thr-f16-ignore", neg: "thr-f16-neg",
  multi: "thr-f16-multi", guard: "thr-f16-guard", guard2: "thr-f16-guard2", race: "thr-f16-race",
  shared: "thr-f16-shared", p1: "thr-f16-p1", p2: "thr-f16-p2", sharedP: "thr-f16-shared-p",
};

const reply = (entity: string, ...claims: (readonly [string, "decision" | "fact"])[]) => JSON.stringify({
  entities: [{ name: entity, kind: "project", aliases: [] }],
  claims: claims.map(([statement, kind]) => ({ statement, kind, confidence: 0.9, about: [entity], decidedBy: null, quote: statement })),
});
const MODEL = loopbackModel([
  ["上线改到 10/1，预算改为 60 万", reply("项目A", ["项目A 上线改到 10/1", "decision"], ["项目A 预算改为 60 万", "decision"])],
  ["项目A 定在 9/29 上线", reply("项目A", ["项目A 9/29 上线", "decision"])],
  ["项目A 上线改到 10/1", reply("项目A", ["项目A 上线改到 10/1", "decision"])],
  ["项目A 上线改到 10/5", reply("项目A", ["项目A 上线改到 10/5", "decision"])],
  ["项目A 预算定为 50 万", reply("项目A", ["项目A 预算定为 50 万", "decision"])],
  ["项目P 定在 9/29 发布", reply("项目P", ["项目P 9/29 发布", "decision"])],
  ["项目P 发布改到 10/1", reply("项目P", ["项目P 发布改到 10/1", "decision"])],
]);

let db: PgDatabase;
let deps: HumanActionDeps;
let xdeps: ExtractionDeps;
let ctl: KnowledgeGraphController;
let seq = 0;

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  await resetOrgs(ORG);
  const fx = await seedOrg({ orgId: ORG, projectId: `${ORG}-p` });
  await enableExtraction();
  for (const u of ["u-owner", "u-member"]) {
    await addOrgMember(ORG, u, "consultant", fx.teams.energy!);
    await addProjectMember(ORG, `${ORG}-p`, u, "facilitator", null);
  }
  for (const id of [T.keepNew, T.keepBoth, T.ignore, T.neg, T.multi, T.guard, T.guard2, T.race, T.p1, T.p2]) {
    await addChatThread({ orgId: ORG, id, projectId: null, visibilityScope: "private", createdBy: "u-owner" });
  }
  for (const id of [T.shared, T.sharedP]) {
    await addChatThread({ orgId: ORG, id, projectId: `${ORG}-p`, visibilityScope: "plenary", createdBy: "u-owner" });
  }
  db = new PgDatabase(appConfig());
  deps = {
    repo: new PgIdentityRepository(db), ids: new CountingDecisionIdFactory(), chat: new PgChatRepository(db),
    knowledge: new PgKnowledgeRead(db), actions: new PgHumanAction(db), newId: newKgId,
  };
  ctl = new KnowledgeGraphController(deps.repo, deps.ids, deps.chat, deps.knowledge, deps.actions, new PgPromotion(db));
  xdeps = extractionDeps(db, MODEL.model, ORG);
});
afterAll(async () => { await db.close(); });

/* ── 夹具 ─────────────────────────────────────────────────────────── */

const sql = <T>(q: string, params: unknown[] = []) => asOwner(async (c) => (await c.query(q, params)).rows as T[]);
/** 一条消息落库 → 抽取 worker 跑一轮（真实队列、真实执行器、真实矛盾判定）。 */
async function say(threadId: string, body: string, opts: { author?: string; agent?: boolean } = {}): Promise<string> {
  const id = `m-f16-${String(++seq)}`;
  await addChatMessage({
    orgId: ORG, id, threadId, body, authorId: opts.agent ? "agent-1" : (opts.author ?? "u-owner"),
    ...(opts.agent ? { authorKind: "agent" as const, agentId: "agent-1" } : {}),
  });
  await runExtractionTick(xdeps);
  return id;
}
/** 助手的回答（一轮 = 回答 + 它前面那条用户消息）。 */
const answer = (threadId: string) => say(threadId, "好的，我记下了。", { agent: true });
const read = (threadId: string, userId = "u-owner") => getThreadKnowledge(deps, { userId, orgId: ORG_ID, threadId });
const claimBy = async (threadId: string, statement: string) => {
  const c = (await read(threadId)).claims.find((x) => x.statement === statement);
  if (c === undefined) throw new Error(`no live claim「${statement}」in ${threadId}`);
  return c;
};
const act = async (threadId: string, action: Parameters<typeof applyHumanAction>[1]["action"], userId = "u-owner") => {
  const k = await read(threadId, "u-owner");
  return applyHumanAction(deps, { userId, orgId: ORG_ID, threadId, basedOnRevision: k.revision, action });
};
const turn = (threadId: string, messageId: string, userId = "u-owner") =>
  getTurnMemory(deps, { userId, orgId: ORG_ID, threadId, messageId });
const promptsOf = (threadId: string) => sql<{ id: string; status: string; rank: number; newer_claim_id: string; older_claim_id: string; newer_condition: string | null; older_condition: string | null }>(
  "SELECT id, status, rank, newer_claim_id, older_claim_id, newer_condition, older_condition FROM kg_conflict_prompts WHERE org_id = $1 AND thread_id = $2 ORDER BY created_at, rank",
  [ORG, threadId]);
const row = async (claimId: string) => (await sql<{ status: string; revoked: boolean; revocation_reason: string | null; reviewed_by: string | null; supersedes_claim_id: string | null }>(
  "SELECT status, revoked_at IS NOT NULL AS revoked, revocation_reason, reviewed_by, supersedes_claim_id FROM claims WHERE id = $1", [claimId]))[0]!;
/** 确认过「9/29」、再说「10/1」：返回旧条、新条、这一轮的回答 id 与那张卡。 */
async function conflictIn(threadId: string) {
  await say(threadId, "项目A 定在 9/29 上线");
  const older = await claimBy(threadId, "项目A 9/29 上线");
  await act(threadId, { type: "confirmClaim", claimId: older.id });
  await say(threadId, "项目A 上线改到 10/1");
  const ans = await answer(threadId);
  const newer = await claimBy(threadId, "项目A 上线改到 10/1");
  const t = await turn(threadId, ans);
  if (t.prompt?.type !== "conflict") throw new Error(`no conflict card in ${threadId}`);
  return { older, newer, ans, prompt: t.prompt.conflict };
}
const resolve = (threadId: string, promptId: string, resolution: "keep_new" | "keep_both" | "ignore", conditions?: { newer: string; older: string }) =>
  act(threadId, { type: "resolveConflict", promptId, resolution, ...(conditions ? { conditions } : {}) });

/* ── 判定规则（纯函数） ───────────────────────────────────────────── */

describe("F16: 判定规则（同一件事、同一指标、说了不同的数）", () => {
  const fresh = (statement: string, over: Partial<FreshClaim> = {}): FreshClaim =>
    ({ id: "n", kind: "decision", statement, confidence: 0.9, about: ["项目A"], ...over });
  const old = (statement: string, over: Partial<ConfirmedClaim> = {}): ConfirmedClaim =>
    ({ id: "o", kind: "decision", statement, about: ["项目A"], scope: "chat_session", confirmedAt: "2026-09-20T00:00:00Z", ...over });

  it("日期改了 ⇒ 冲突；全角数字、空白差异照样认", () => {
    expect(isConflict(fresh("项目A 上线改到 10/1"), old("项目A 9/29 上线"))).toBe(true);
    expect(isConflict(fresh("项目A 上线改到 １０/１"), old("项目A 9/29 上线"))).toBe(true);
  });

  it("任一条件不满足 ⇒ 不算（宁可漏，不可误）", () => {
    const o = old("项目A 9/29 上线");
    expect(isConflict(fresh("项目A 上线改到 10/1", { kind: "fact" }), o)).toBe(false);          // 类型不同
    expect(isConflict(fresh("项目A 上线改到 10/1", { kind: "risk" }), old("项目A 9/29 上线", { kind: "risk" }))).toBe(false);  // 风险可并存
    expect(isConflict(fresh("项目B 上线改到 10/1", { about: ["项目B"] }), o)).toBe(false);     // 不是同一件事
    expect(isConflict(fresh("项目A 上线改到 10/1", { about: ["项目A", "张三"] }), o)).toBe(false);  // 实体集合不同
    expect(isConflict(fresh("项目A 上线改到 10/1", { about: [] }), old("项目A 9/29 上线", { about: [] }))).toBe(false);  // 没有实体
    expect(isConflict(fresh("项目A 预算改为 60 万"), o)).toBe(false);                              // 不同指标
    expect(isConflict(fresh("项目A 上线推迟了"), o)).toBe(false);                                   // 新的没有数值
    expect(isConflict(fresh("项目A 9/29 上线，预计 3 天"), o)).toBe(false);                        // 只是补了一个数
    expect(isConflict(fresh("项目A 9/29 上线"), o)).toBe(false);                                    // 同一句
  });

  it("实体名里的数字不算数值（v2 的 2）", () => {
    const f = fresh("v2 上线时间确认", { about: ["v2"] });
    expect(isConflict(f, old("v3 上线时间确认", { about: ["v2"] }))).toBe(false);
  });

  it("排序：本会话的先于个人空间的，同层确认得越近越先", () => {
    const pairs = findConflicts(
      [fresh("项目A 上线改到 10/1", { id: "n1" })],
      [
        old("项目A 9/29 上线", { id: "p-old", scope: "personal", confirmedAt: "2026-09-23T00:00:00Z" }),
        old("项目A 9/28 上线", { id: "c-early", confirmedAt: "2026-09-10T00:00:00Z" }),
        old("项目A 9/27 上线", { id: "c-late", confirmedAt: "2026-09-21T00:00:00Z" }),
      ],
    );
    expect(pairs.map((p) => p.olderClaimId)).toEqual(["c-late", "c-early", "p-old"]);
  });
});

/* ── V3 / 三个出口 ───────────────────────────────────────────────── */

describe("F16: 当轮出卡（V3）", () => {
  it("确认过「9/29」再说「10/1」⇒ 两条转「有矛盾」、旧条多一条反对证据、这一轮回答下出一张卡", async () => {
    const { older, newer, prompt } = await conflictIn(T.keepNew);
    const [nineTwentyNine] = await sql<{ at: Date }>(
      "SELECT min(m.created_at) AS at FROM claim_message_evidence e JOIN chat_messages m ON m.id = e.message_id WHERE e.claim_id = $1 AND e.stance = 'supporting'", [older.id]);
    expect(prompt).toEqual({
      promptId: expect.any(String),
      newerClaim: { id: newer.id, statement: "项目A 上线改到 10/1" },
      olderClaim: { id: older.id, statement: "项目A 9/29 上线", saidAt: nineTwentyNine!.at.toISOString() },
    });
    const k = await read(T.keepNew);
    for (const id of [older.id, newer.id]) expect(k.claims.find((c) => c.id === id)).toMatchObject({ status: "contested", triState: "conflict" });
    expect(k.claims.find((c) => c.id === older.id)!.contradictingCount).toBe(1);
    const [audit] = await sql<{ actor_kind: string; action_type: string; scope_kind: string }>(
      "SELECT actor_kind, action_type, scope_kind FROM ontology_actions a JOIN kg_conflict_prompts p ON p.detected_by_action_id = a.id WHERE p.id = $1", [prompt.promptId]);
    expect(audit).toEqual({ actor_kind: "system", action_type: "detectConflict", scope_kind: "chat_session" });
  });

  it("卡挂在「那一轮」：前一轮的回答下没有它", async () => {
    await say(T.guard, "项目A 定在 9/29 上线");
    const firstAnswer = await answer(T.guard);
    await act(T.guard, { type: "confirmClaim", claimId: (await claimBy(T.guard, "项目A 9/29 上线")).id });
    await say(T.guard, "项目A 上线改到 10/1");
    const secondAnswer = await answer(T.guard);
    expect((await turn(T.guard, firstAnswer)).prompt).toBeNull();
    expect((await turn(T.guard, secondAnswer)).prompt?.type).toBe("conflict");
  });

  it("以新的为准 ⇒ 旧条 superseded（撤出面板，行与原因留着），新条「你确认过」且 supersedes 旧条；卡消失；审计一条人的动作", async () => {
    const [p] = await promptsOf(T.keepNew);
    const before = (await read(T.keepNew)).revision;
    const out = await resolve(T.keepNew, p!.id, "keep_new");
    expect(out.revision).toBe(before + 1);
    expect(await row(p!.older_claim_id)).toMatchObject({ status: "superseded", revoked: true, revocation_reason: "conflict_keep_new" });
    expect(await row(p!.newer_claim_id)).toMatchObject({ status: "accepted", reviewed_by: "u-owner", supersedes_claim_id: p!.older_claim_id });
    const k = await read(T.keepNew);
    expect(k.claims.some((c) => c.id === p!.older_claim_id)).toBe(false);
    expect(k.claims.find((c) => c.id === p!.newer_claim_id)).toMatchObject({ triState: "confirmed" });
    expect((await promptsOf(T.keepNew))[0]!.status).toBe("kept_new");
    const ans = (await sql<{ id: string }>("SELECT id FROM chat_messages WHERE thread_id = $1 AND author_kind = 'agent' ORDER BY created_at DESC LIMIT 1", [T.keepNew]))[0]!.id;
    expect((await turn(T.keepNew, ans)).prompt).toBeNull();
    expect(await sql("SELECT actor_kind, actor_id, action_type FROM ontology_actions WHERE id = $1", [out.actionId]))
      .toEqual([{ actor_kind: "human", actor_id: "u-owner", action_type: "resolveConflict" }]);
    // 旧条不在长期记忆里 ⇒ 不替你往长期记忆里记新的
    expect(await sql("SELECT 1 FROM claims WHERE org_id = $1 AND scope_kind = 'personal' AND statement = '项目A 上线改到 10/1'", [ORG])).toHaveLength(0);
  });

  it("处理过的卡再点 ⇒ KG_PROMPT_NOT_FOUND，什么都不变", async () => {
    const [p] = await promptsOf(T.keepNew);
    const rev = (await read(T.keepNew)).revision;
    await expect(resolve(T.keepNew, p!.id, "ignore")).rejects.toMatchObject({ code: "KG_PROMPT_NOT_FOUND" });
    expect((await read(T.keepNew)).revision).toBe(rev);
    expect((await promptsOf(T.keepNew))[0]!.status).toBe("kept_new");
  });

  it("两条都留 ⇒ 都「你确认过」、各记一句适用条件、冲突结束；同样的话再说一遍不再出卡", async () => {
    const { older, newer, prompt, ans: first } = await conflictIn(T.keepBoth);
    await resolve(T.keepBoth, prompt.promptId, "keep_both", { newer: " 迁移演练通过后 ", older: "演练没过就按原计划" });
    expect((await turn(T.keepBoth, first)).prompt).toBeNull();
    expect(await row(older.id)).toMatchObject({ status: "accepted", revoked: false, reviewed_by: "u-owner" });
    expect(await row(newer.id)).toMatchObject({ status: "accepted", reviewed_by: "u-owner", supersedes_claim_id: null });
    expect((await promptsOf(T.keepBoth))[0]).toMatchObject({ status: "kept_both", newer_condition: "迁移演练通过后", older_condition: "演练没过就按原计划" });

    await say(T.keepBoth, "项目A 上线改到 10/1");
    const ans = await answer(T.keepBoth);
    expect((await turn(T.keepBoth, ans)).prompt).toBeNull();
    expect(await promptsOf(T.keepBoth)).toHaveLength(1);
    const again = (await read(T.keepBoth)).claims.filter((c) => c.statement === "项目A 上线改到 10/1" && c.id !== newer.id);
    expect(again.map((c) => c.status)).toEqual(["proposed"]);
  });

  it("忽略（V4）⇒ 两条保持「有矛盾」、卡消失；再提一次 10/1 不再出卡；换成 10/5 是新的一对，照样提醒", async () => {
    const { older, newer, prompt, ans: first } = await conflictIn(T.ignore);
    await resolve(T.ignore, prompt.promptId, "ignore");
    expect((await turn(T.ignore, first)).prompt).toBeNull();
    expect(await row(older.id)).toMatchObject({ status: "contested" });
    expect(await row(newer.id)).toMatchObject({ status: "contested" });
    expect((await promptsOf(T.ignore))[0]!.status).toBe("ignored");

    await say(T.ignore, "项目A 上线改到 10/1");
    const again = await answer(T.ignore);
    expect((await turn(T.ignore, again)).prompt).toBeNull();
    expect(await promptsOf(T.ignore)).toHaveLength(1);
    expect((await read(T.ignore)).claims.filter((c) => c.statement === "项目A 上线改到 10/1").map((c) => c.status).sort())
      .toEqual(["contested", "proposed"]);

    await say(T.ignore, "项目A 上线改到 10/5");
    const other = await answer(T.ignore);
    const t = await turn(T.ignore, other);
    expect(t.prompt?.type === "conflict" ? t.prompt.conflict.newerClaim.statement : null).toBe("项目A 上线改到 10/5");
    expect(t.prompt?.type === "conflict" ? t.prompt.conflict.olderClaim.id : null).toBe(older.id);
  });
});

describe("F16: 不该出卡的时候不出", () => {
  it("旧条没人确认过 / 不同指标 / 助手自己说的 ⇒ 不出卡、不转冲突", async () => {
    await say(T.neg, "项目A 定在 9/29 上线");
    await say(T.neg, "项目A 上线改到 10/1");
    const a1 = await answer(T.neg);
    expect((await turn(T.neg, a1)).prompt).toBeNull();
    const nine = await claimBy(T.neg, "项目A 9/29 上线");
    await act(T.neg, { type: "confirmClaim", claimId: nine.id });
    await say(T.neg, "项目A 预算定为 50 万");
    const a2 = await answer(T.neg);
    expect((await turn(T.neg, a2)).prompt).toBeNull();
    await say(T.neg, "项目A 上线改到 10/5", { agent: true });
    expect(await promptsOf(T.neg)).toEqual([]);
    expect((await read(T.neg)).claims.filter((c) => c.status === "contested")).toEqual([]);
  });

  it("项目（共享）线程里说的，不拿所有者的个人空间来比", async () => {
    await say(T.p1, "项目P 定在 9/29 发布");
    const src = await claimBy(T.p1, "项目P 9/29 发布");
    const out = await promoteToPersonal({ ...deps, promotion: new PgPromotion(db), newId: newKgId }, { userId: "u-owner", orgId: ORG_ID, threadId: T.p1, claimIds: [src.id] });
    expect(out.results[0]?.outcome).toBe("promoted");
    await say(T.sharedP, "项目P 发布改到 10/1");
    const a = await answer(T.sharedP);
    expect((await turn(T.sharedP, a)).prompt).toBeNull();
    expect((await claimBy(T.sharedP, "项目P 发布改到 10/1")).status).toBe("proposed");
  });
});

describe("F16: 一轮至多一张（I-18 / R4 E3）", () => {
  it("一句话里两处冲突 ⇒ 两对都转「有矛盾」、开两张，但这一轮只出最要紧的一张（最近确认的那处）", async () => {
    await say(T.multi, "项目A 定在 9/29 上线");
    await act(T.multi, { type: "confirmClaim", claimId: (await claimBy(T.multi, "项目A 9/29 上线")).id });
    await say(T.multi, "项目A 预算定为 50 万");
    await act(T.multi, { type: "confirmClaim", claimId: (await claimBy(T.multi, "项目A 预算定为 50 万")).id });
    await say(T.multi, "项目A 上线改到 10/1，预算改为 60 万");
    const a = await answer(T.multi);
    const prompts = await promptsOf(T.multi);
    expect(prompts.map((p) => p.rank)).toEqual([0, 1]);
    expect((await read(T.multi)).claims.filter((c) => c.status === "contested")).toHaveLength(4);
    const t = await turn(T.multi, a);
    expect(t.prompt?.type === "conflict" ? t.prompt.conflict.promptId : null).toBe(prompts[0]!.id);
    expect(t.prompt?.type === "conflict" ? t.prompt.conflict.olderClaim.statement : null).toBe("项目A 预算定为 50 万");
  });
});

describe("F16: 长期记忆里的旧说法", () => {
  it("个人线程里与自己长期记忆冲突 ⇒ 出卡（旧条是个人空间那条）；以新的为准 ⇒ 长期记忆里旧的失效、记进新的", async () => {
    await say(T.p2, "项目P 发布改到 10/1");
    const a = await answer(T.p2);
    const t = await turn(T.p2, a);
    if (t.prompt?.type !== "conflict") throw new Error("expected a conflict card");
    const olderId = t.prompt.conflict.olderClaim.id;
    const [older] = await sql<{ scope_kind: string; statement: string }>("SELECT scope_kind, statement FROM claims WHERE id = $1", [olderId]);
    expect(older).toEqual({ scope_kind: "personal", statement: "项目P 9/29 发布" });
    // 会话里的审计不带个人空间的 id；个人空间那条的变化记在个人空间
    const audits = await sql<{ scope_kind: string; payload: unknown }>(
      "SELECT a.scope_kind, a.payload FROM ontology_actions a WHERE a.action_type = 'detectConflict' AND a.source_ref = (SELECT message_id FROM kg_conflict_prompts WHERE id = $1)", [t.prompt.conflict.promptId]);
    expect(audits.map((x) => x.scope_kind).sort()).toEqual(["chat_session", "personal"]);
    expect(JSON.stringify(audits.find((x) => x.scope_kind === "chat_session")!.payload)).not.toContain(olderId);
    // 别人读不到这张卡（RLS 跟随两条结论）
    const seen = (user: string) => asApp(ORG, async (c) => {
      await c.query("SELECT set_config('app.current_user_id', $1, true)", [user]);
      return (await c.query("SELECT id FROM kg_conflict_prompts WHERE id = $1", [t.prompt!.type === "conflict" ? t.prompt!.conflict.promptId : ""])).rowCount;
    });
    expect(await seen("u-member")).toBe(0);
    expect(await seen("u-owner")).toBe(1);

    await resolve(T.p2, t.prompt.conflict.promptId, "keep_new");
    expect(await row(olderId)).toMatchObject({ status: "superseded", revoked: true, revocation_reason: "conflict_keep_new" });
    const newer = t.prompt.conflict.newerClaim.id;
    expect(await row(newer)).toMatchObject({ status: "accepted", supersedes_claim_id: null });
    const [l1] = await sql<{ id: string; status: string; supersedes_claim_id: string }>(
      `SELECT c.id, c.status, c.supersedes_claim_id FROM claims c JOIN ontology_edges d ON d.src_id = c.id AND d.relation = 'derived_from' AND d.dst_id = $1
        WHERE c.scope_kind = 'personal' AND c.scope_id = 'u-owner'`, [newer]);
    expect(l1).toMatchObject({ status: "accepted", supersedes_claim_id: olderId });
  });
});

/* ── 守卫 ─────────────────────────────────────────────────────────── */

describe("F16: 守卫", () => {
  it("非所有者：看得到只读的卡（共享线程），点不动 ⇒ KG_NOT_OWNER（HTTP 403）；绕过应用层直调数据库同样拒", async () => {
    const { prompt, ans } = await conflictIn(T.shared);
    const seen = await turn(T.shared, ans, "u-member");
    expect(seen.prompt?.type === "conflict" ? seen.prompt.conflict.promptId : null).toBe(prompt.promptId);
    const k = await read(T.shared);
    const action = { type: "resolveConflict" as const, promptId: prompt.promptId, resolution: "ignore" as const };
    await expect(applyHumanAction(deps, { userId: "u-member", orgId: ORG_ID, threadId: T.shared, basedOnRevision: k.revision, action }))
      .rejects.toMatchObject({ code: "KG_NOT_OWNER" });
    await expect(ctl.humanAction({ userId: "u-member", orgId: ORG } as never, T.shared, { basedOnRevision: k.revision, action }))
      .rejects.toBeInstanceOf(ForbiddenException);
    await expect(asApp(ORG, async (c) => {
      await c.query("SELECT set_config('app.current_user_id', 'u-member', true)");
      return c.query("SELECT kg_resolve_conflict($1::jsonb)", [JSON.stringify({ action_id: newKgId("act"), thread_id: T.shared, based_on_revision: k.revision, action })]);
    })).rejects.toThrow(/KG_NOT_OWNER/);
    expect((await promptsOf(T.shared))[0]!.status).toBe("open");
  });

  it("拿旧版本号 ⇒ KG_REVISION_CHANGED；别的会话的卡 ⇒ KG_PROMPT_NOT_FOUND；冻结的 org ⇒ KG_ORG_FROZEN；卡都还开着", async () => {
    const [p] = await promptsOf(T.guard);
    const k = await read(T.guard);
    const action = { type: "resolveConflict" as const, promptId: p!.id, resolution: "keep_new" as const };
    await expect(applyHumanAction(deps, { userId: "u-owner", orgId: ORG_ID, threadId: T.guard, basedOnRevision: k.revision - 1, action }))
      .rejects.toMatchObject({ code: "KG_REVISION_CHANGED" });
    const k2 = await read(T.guard2);
    await expect(applyHumanAction(deps, { userId: "u-owner", orgId: ORG_ID, threadId: T.guard2, basedOnRevision: k2.revision, action }))
      .rejects.toMatchObject({ code: "KG_PROMPT_NOT_FOUND" });
    await expect(resolve(T.guard, "no-such-prompt", "ignore")).rejects.toMatchObject({ code: "KG_PROMPT_NOT_FOUND" });
    await asOwner((q) => q.query("UPDATE organizations SET status = 'disabled', disabled_at = now(), retention_until = now() + interval '30 days' WHERE id = $1", [ORG]));
    try {
      await expect(asApp(ORG, async (c) => {
        await c.query("SELECT set_config('app.current_user_id', 'u-owner', true)");
        return c.query("SELECT kg_resolve_conflict($1::jsonb)", [JSON.stringify({ action_id: newKgId("act"), thread_id: T.guard, based_on_revision: k.revision, action })]);
      })).rejects.toThrow(/KG_ORG_FROZEN/);
    } finally {
      await asOwner((q) => q.query("UPDATE organizations SET status = 'active', disabled_at = NULL, retention_until = NULL WHERE id = $1", [ORG]));
    }
    expect((await promptsOf(T.guard))[0]!.status).toBe("open");
    expect(await row(p!.older_claim_id)).toMatchObject({ status: "contested" });
  });

  it("一对里有一条已经被忘掉 ⇒ 卡不再出现，点它 ⇒ KG_PROMPT_NOT_FOUND", async () => {
    const [p] = await promptsOf(T.guard);
    await act(T.guard, { type: "revokeClaim", claimId: p!.newer_claim_id });
    const ans = (await sql<{ id: string }>("SELECT id FROM chat_messages WHERE thread_id = $1 AND author_kind = 'agent' ORDER BY created_at DESC LIMIT 1", [T.guard]))[0]!.id;
    expect((await turn(T.guard, ans)).prompt).toBeNull();
    await expect(resolve(T.guard, p!.id, "keep_both")).rejects.toMatchObject({ code: "KG_PROMPT_NOT_FOUND" });
    expect(await row(p!.older_claim_id)).toMatchObject({ status: "contested" });
  });

  it("并发：两个标签页同时处理同一张卡 ⇒ 恰好一个成功，另一个 KG_REVISION_CHANGED；卡的结局与成功的那个一致", async () => {
    const { prompt, older } = await conflictIn(T.race);
    const k = await read(T.race);
    const go = (resolution: "keep_new" | "ignore") => applyHumanAction(deps, {
      userId: "u-owner", orgId: ORG_ID, threadId: T.race, basedOnRevision: k.revision,
      action: { type: "resolveConflict", promptId: prompt.promptId, resolution },
    });
    const results = await Promise.allSettled([go("keep_new"), go("ignore")]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const lost = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(lost.reason).toMatchObject({ code: "KG_REVISION_CHANGED" });
    const status = (await promptsOf(T.race))[0]!.status;
    expect(status).toBe(results[0]!.status === "fulfilled" ? "kept_new" : "ignored");
    expect((await row(older.id)).status).toBe(status === "kept_new" ? "superseded" : "contested");
  });

  it("开卡函数复核每一对：旧条没人确认过 / 在别的会话 / 是不该拿来比的个人空间，新条不是这条消息抽的 ⇒ 一张不开、状态不变", async () => {
    await say(T.guard2, "项目A 定在 9/29 上线");
    const older = await claimBy(T.guard2, "项目A 9/29 上线");
    const m = await say(T.guard2, "项目A 上线改到 10/1");
    const fresh = await claimBy(T.guard2, "项目A 上线改到 10/1");
    const m3 = await say(T.guard2, "项目A 上线改到 10/5");
    const otherMessageFresh = await claimBy(T.guard2, "项目A 上线改到 10/5");
    const [kb] = await promptsOf(T.keepBoth);
    const foreignOlder = kb!.older_claim_id;   // 别的会话里确认过的
    const foreignNewer = kb!.newer_claim_id;   // 别的会话、别的消息抽出的
    const open = (pairs: { newer: string; older: string }[], messageId: string, threadId: string) => asApp(ORG, async (c) =>
      (await c.query<{ n: number }>("SELECT kg_open_conflicts($1::jsonb) AS n", [JSON.stringify({ action_id: newKgId("act"), thread_id: threadId, message_id: messageId, pairs })])).rows[0]!.n);
    const candidates = (messageId: string, threadId = T.guard2) =>
      asApp(ORG, async (c) => (await c.query<{ c: unknown }>("SELECT kg_conflict_candidates($1, $2) AS c", [threadId, messageId])).rows[0]!.c as
        { fresh: { id: string }[]; confirmed: { id: string; scope: string }[] });

    // 旧条没人确认过 / 在别的会话；新条等于旧条
    expect(await open([
      { newer: fresh.id, older: older.id }, { newer: fresh.id, older: foreignOlder }, { newer: fresh.id, older: fresh.id },
    ], m, T.guard2)).toBe(0);
    expect((await candidates(m)).confirmed.map((c) => c.id)).not.toContain(older.id);
    await act(T.guard2, { type: "confirmClaim", claimId: older.id });
    // 旧条合法了，新条不是这条消息抽出来的（本会话别的消息 / 别的会话）
    expect(await open([{ newer: otherMessageFresh.id, older: older.id }, { newer: foreignNewer, older: older.id }], m, T.guard2)).toBe(0);
    expect(await promptsOf(T.guard2)).toEqual([]);
    for (const id of [older.id, fresh.id, otherMessageFresh.id, foreignOlder]) expect((await row(id)).status).not.toBe("contested");

    // 正常候选：本条消息的新条 + 本会话确认过的 + 本人长期记忆
    const [mine] = await sql<{ id: string }>(
      "SELECT id FROM claims WHERE org_id = $1 AND scope_kind = 'personal' AND scope_id = 'u-owner' AND revoked_at IS NULL AND statement = '项目P 发布改到 10/1'", [ORG]);
    const ok = await candidates(m);
    expect(ok.fresh.map((f) => f.id)).toEqual([fresh.id]);
    expect(ok.confirmed.map((c) => c.id)).toEqual(expect.arrayContaining([older.id, mine!.id]));
    expect((await candidates(m3)).fresh.map((f) => f.id)).toEqual([otherMessageFresh.id]);
    // 对照：同样的调用、合法的一对 ⇒ 开得出来（上面的 0 是复核挡的，不是函数什么都不做）
    expect(await open([{ newer: fresh.id, older: older.id }], m, T.guard2)).toBe(1);

    // 所有者的长期记忆：只在个人线程、所有者本人说的话里拿来比
    const sharedMsg = (await sql<{ id: string }>("SELECT id FROM chat_messages WHERE thread_id = $1 AND author_kind = 'human' LIMIT 1", [T.sharedP]))[0]!.id;
    const sharedFresh = await claimBy(T.sharedP, "项目P 发布改到 10/1");
    expect(await open([{ newer: sharedFresh.id, older: mine!.id }], sharedMsg, T.sharedP)).toBe(0);
    const memberMsg = await say(T.guard2, "项目P 发布改到 10/1", { author: "u-member" });
    const memberFresh = await claimBy(T.guard2, "项目P 发布改到 10/1");
    expect((await candidates(memberMsg)).confirmed.map((c) => c.scope)).not.toContain("personal");
    expect(await open([{ newer: memberFresh.id, older: mine!.id }], memberMsg, T.guard2)).toBe(0);
    // 别人的个人线程：那里的「本人」是别人，所有者的长期记忆不在范围里
    await addChatThread({ orgId: ORG, id: "thr-f16-theirs", projectId: null, visibilityScope: "private", createdBy: "u-member" });
    const theirMsg = await say("thr-f16-theirs", "项目P 发布改到 10/1", { author: "u-member" });
    const theirFresh = (await sql<{ id: string }>("SELECT id FROM claims WHERE scope_kind = 'chat_session' AND scope_id = 'thr-f16-theirs'"))[0]!.id;
    expect(await open([{ newer: theirFresh, older: mine!.id }], theirMsg, "thr-f16-theirs")).toBe(0);
    expect((await row(mine!.id)).status).toBe("accepted");

    // 助手的消息、消息与会话对不上 ⇒ 什么都不开，候选也是空的
    const ans = await answer(T.guard2);
    expect(await open([{ newer: otherMessageFresh.id, older: older.id }], ans, T.guard2)).toBe(0);
    expect(await open([{ newer: otherMessageFresh.id, older: older.id }], m3, T.keepBoth)).toBe(0);
    expect(await candidates(ans)).toEqual({ fresh: [], confirmed: [] });
    expect(await candidates(m3, T.keepBoth)).toEqual({ fresh: [], confirmed: [] });
  });
});

describe("F16: 判定用的读写口只调两个数据库函数", () => {
  it("pg-kg-conflict.ts 不写表名 SQL、不出租户上下文：候选范围与复核都在 kg_conflict_candidates / kg_open_conflicts 里", () => {
    const code = readFileSync(new URL("../../src/infrastructure/knowledge-graph/pg-kg-conflict.ts", import.meta.url), "utf8")
      .replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
    expect([...code.matchAll(/"(SELECT [^"]*)"/g)].map((m) => m[1])).toEqual([
      "SELECT kg_conflict_candidates($1, $2) AS c", "SELECT kg_open_conflicts($1::jsonb) AS n",
    ]);
    expect(code).not.toMatch(/\b(?:FROM|JOIN|UPDATE|INTO)\s+[a-z_]+/i);
    expect(code).not.toMatch(/withoutTenant/);
  });
});
