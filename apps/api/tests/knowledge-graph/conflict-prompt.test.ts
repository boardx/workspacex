/**
 * Phase 18 F16 —— 矛盾提醒（uc-18-6 D，V3 / V4；uc-18-1 A3；I-18 / I-19），真实数据库。
 *
 * 知识由 F06 抽取流水线真实产生（回环模型按消息内容回固定 JSON）；矛盾在同一个抽取任务里判出、开卡；
 * 卡从 getTurnMemory 读（回答下方用户看到的就是它）；三个出口经 applyHumanAction{resolveConflict} → kg_resolve_conflict。
 * 应用层挡在前面的守卫（所有者、可见性），这里另外直接调数据库函数再验一遍。
 */
import { readFileSync } from "node:fs";
import { ForbiddenException } from "@nestjs/common";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyHumanAction, type HumanActionDeps } from "../../src/application/knowledge-graph/apply-human-action";
import { drainConflictCloses } from "../../src/application/knowledge-graph/detect-conflicts";
import { runExtractionTick, type ExtractionDeps } from "../../src/application/knowledge-graph/extract-message-knowledge";
import { newKgId } from "../../src/application/knowledge-graph/ids";
import { promoteToPersonal } from "../../src/application/knowledge-graph/promote-to-personal";
import { getThreadKnowledge, getTurnMemory } from "../../src/application/knowledge-graph/read-thread-knowledge";
import { findConflicts, isConflict, normalizeNumber, type ConfirmedClaim, type FreshClaim } from "../../src/domain/knowledge-graph/conflict";
import { toOrgId } from "../../src/domain/org-id";
import { PgChatRepository } from "../../src/infrastructure/chat/pg-chat-repository";
import { appConfig, migrationConfig } from "../../src/infrastructure/db/pg-config";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { CountingDecisionIdFactory } from "../../src/infrastructure/identity/in-memory-session-store";
import { PgIdentityRepository } from "../../src/infrastructure/identity/pg-identity-repository";
import { PgHumanAction } from "../../src/infrastructure/knowledge-graph/pg-human-action";
import { PgKgConflict } from "../../src/infrastructure/knowledge-graph/pg-kg-conflict";
import { PgKnowledgeRead } from "../../src/infrastructure/knowledge-graph/pg-knowledge-read";
import { PgPromotion } from "../../src/infrastructure/knowledge-graph/pg-promotion";
import { KnowledgeGraphController } from "../../src/interface/controllers/knowledge-graph.controller";
import { addChatMessage, addChatThread } from "../support/chat-db";
import { addOrgMember, addProjectMember, asApp, asOwner, ensureDatabase, migrateOnce, resetOrgs, seedOrg } from "../support/db";
import { enableExtraction, extractionDeps, loopbackModel, silentLogger } from "./kg-extraction-fixtures";

const ORG = "org-kg-f16-conflict";
const ORG_ID = toOrgId(ORG);
const T = {
  keepNew: "thr-f16-keepnew", keepBoth: "thr-f16-keepboth", ignore: "thr-f16-ignore", neg: "thr-f16-neg",
  multi: "thr-f16-multi", guard: "thr-f16-guard", guard2: "thr-f16-guard2", race: "thr-f16-race",
  shared: "thr-f16-shared", p1: "thr-f16-p1", p2: "thr-f16-p2", sharedP: "thr-f16-shared-p",
  fNewer: "thr-f16-forget-newer", fOlder: "thr-f16-forget-older", rNewer: "thr-f16-revise-newer", rOlder: "thr-f16-revise-older",
  del: "thr-f16-delete", chain: "thr-f16-chain", two: "thr-f16-two", l1a: "thr-f16-l1a", l1b: "thr-f16-l1b",
  qa: "thr-f16-qa", qb: "thr-f16-qb", ra: "thr-f16-ra", rb: "thr-f16-rb", rc: "thr-f16-rc", sa: "thr-f16-sa", sb: "thr-f16-sb",
  ta: "thr-f16-ta", tb: "thr-f16-tb", pa: "thr-f16-poison-a", pb: "thr-f16-poison-b", held: "thr-f16-held", stale: "thr-f16-stale", mc: "thr-f16-marked",
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
  ["项目A 定在 9/28 上线", reply("项目A", ["项目A 9/28 上线", "decision"])],
  ...["Q", "R", "S", "T"].flatMap((x) => [
    [`项目${x} 定在 9/29 发布`, reply(`项目${x}`, [`项目${x} 9/29 发布`, "decision"])],
    [`项目${x} 发布改到 10/1`, reply(`项目${x}`, [`项目${x} 发布改到 10/1`, "decision"])],
    [`项目${x} 发布改到 10/5`, reply(`项目${x}`, [`项目${x} 发布改到 10/5`, "decision"])],
  ] as [string, string][]),
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
  for (const id of [T.keepNew, T.keepBoth, T.ignore, T.neg, T.multi, T.guard, T.guard2, T.race, T.p1, T.p2,
    T.fNewer, T.fOlder, T.rNewer, T.rOlder, T.del, T.chain, T.two, T.l1a, T.l1b, T.qa, T.qb, T.ra, T.rb, T.rc, T.sa, T.sb, T.ta, T.tb, T.pa, T.pb, T.held, T.stale, T.mc]) {
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

  it("数值按值比：前导零不算不同（10/01 = 10/1、09.29 = 9.29），小数点后的零照算（1.05 ≠ 1.5）", () => {
    const o = old("项目A 10/1 上线");
    expect(isConflict(fresh("项目A 上线改到 10/01"), o)).toBe(false);
    expect(isConflict(fresh("项目A 上线定在 09.29"), old("项目A 9.29 上线"))).toBe(false);
    expect(isConflict(fresh("项目A 上线改到 10/02"), o)).toBe(true);
    expect(normalizeNumber("10/01")).toBe("10/1");
    expect(normalizeNumber("09.29")).toBe("9.29");
    expect(normalizeNumber("1.05")).toBe("1.05");
    expect(normalizeNumber("007")).toBe("7");
    expect(normalizeNumber("0")).toBe("0");
    expect(isConflict(fresh("项目A 系数改为 1.5"), old("项目A 系数 1.05"))).toBe(true);
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
    // 处理过（两条都留）的卡不能再处理一次
    await expect(resolve(T.keepBoth, prompt.promptId, "keep_new")).rejects.toMatchObject({ code: "KG_PROMPT_NOT_FOUND" });
    expect(await row(older.id)).toMatchObject({ status: "accepted", revoked: false });

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
    // 被忽略的卡不能再处理一次（它不再出现在回答下面，旧 id 也不行）
    await expect(resolve(T.ignore, prompt.promptId, "keep_new")).rejects.toMatchObject({ code: "KG_PROMPT_NOT_FOUND" });
    expect(await row(older.id)).toMatchObject({ status: "contested", revoked: false });

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

    const res = await resolve(T.p2, t.prompt.conflict.promptId, "keep_new");
    const [resolveAudit] = await sql<{ payload: unknown }>("SELECT payload FROM ontology_actions WHERE id = $1 AND scope_kind = 'chat_session'", [res.actionId]);
    expect(JSON.stringify(resolveAudit!.payload)).not.toContain(olderId);
    expect(await sql("SELECT 1 FROM ontology_actions WHERE id = $1 AND scope_kind = 'personal' AND scope_id = 'u-owner'", [`${res.actionId}-l1`])).toHaveLength(1);
    expect(await row(olderId)).toMatchObject({ status: "superseded", revoked: true, revocation_reason: "conflict_keep_new" });
    const newer = t.prompt.conflict.newerClaim.id;
    expect(await row(newer)).toMatchObject({ status: "accepted", supersedes_claim_id: null });
    const [l1] = await sql<{ id: string; status: string; supersedes_claim_id: string }>(
      `SELECT c.id, c.status, c.supersedes_claim_id FROM claims c JOIN ontology_edges d ON d.src_id = c.id AND d.relation = 'derived_from' AND d.dst_id = $1
        WHERE c.scope_kind = 'personal' AND c.scope_id = 'u-owner'`, [newer]);
    expect(l1).toMatchObject({ status: "accepted", supersedes_claim_id: olderId });
  });
});

/* ── B1：一对里有一条在别处变了 ⇒ 冲突结束（R7-2「直到其中一条被改」） ─────────────── */

describe("F16: 一对里有一条在别处变了 ⇒ 冲突结束，另一条可以重新确认", () => {
  const confirmable = async (threadId: string, claimId: string) => {
    await act(threadId, { type: "confirmClaim", claimId });
    expect((await read(threadId)).claims.find((c) => c.id === claimId)).toMatchObject({ status: "accepted", triState: "confirmed" });
    expect((await read(threadId)).claims.filter((c) => c.triState === "conflict")).toEqual([]);
  };
  const closedByChange = async (threadId: string, promptId: string) => {
    expect((await promptsOf(threadId)).find((p) => p.id === promptId)!.status).toBe("closed_by_change");
    expect(await sql("SELECT actor_kind, action_type, scope_kind FROM ontology_actions WHERE id = $1", [`kgclose-${promptId}`]))
      .toEqual([{ actor_kind: "system", action_type: "closeConflict", scope_kind: "chat_session" }]);
    await expect(resolve(threadId, promptId, "keep_both")).rejects.toMatchObject({ code: "KG_PROMPT_NOT_FOUND" });
  };

  it("忘掉新的那条 ⇒ 卡结束、旧条回到「你确认过」；返回的版本号把连带的结束动作算进去", async () => {
    const { older, newer, ans, prompt } = await conflictIn(T.fNewer);
    const out = await act(T.fNewer, { type: "revokeClaim", claimId: newer.id });
    expect(out.revision).toBe((await read(T.fNewer)).revision);
    await closedByChange(T.fNewer, prompt.promptId);
    expect((await turn(T.fNewer, ans)).prompt).toBeNull();
    expect(await row(older.id)).toMatchObject({ status: "accepted" });
    await confirmable(T.fNewer, older.id);
  });

  it("忘掉旧的那条 ⇒ 新条回到「AI 记下的」，可以确认", async () => {
    const { older, newer, prompt } = await conflictIn(T.fOlder);
    await act(T.fOlder, { type: "revokeClaim", claimId: older.id });
    await closedByChange(T.fOlder, prompt.promptId);
    expect((await read(T.fOlder)).claims.find((c) => c.id === newer.id)).toMatchObject({ status: "proposed", triState: "pending" });
    await confirmable(T.fOlder, newer.id);
  });

  it("改写新的那条 ⇒ 旧条回到「你确认过」；改写旧的那条 ⇒ 新条可以确认", async () => {
    const a = await conflictIn(T.rNewer);
    await act(T.rNewer, { type: "reviseClaim", claimId: a.newer.id, statement: "项目A 上线也许改到 10/1" });
    await closedByChange(T.rNewer, a.prompt.promptId);
    expect(await row(a.older.id)).toMatchObject({ status: "accepted" });
    await confirmable(T.rNewer, a.older.id);

    const b = await conflictIn(T.rOlder);
    await act(T.rOlder, { type: "reviseClaim", claimId: b.older.id, statement: "项目A 9/29 上线（旧计划）" });
    await closedByChange(T.rOlder, b.prompt.promptId);
    await confirmable(T.rOlder, b.newer.id);
  });

  it("原话被删（F07）⇒ 新条失效、卡结束（行留着，message_id 置空），旧条回到「你确认过」", async () => {
    const { older, newer, prompt } = await conflictIn(T.del);
    const [said] = await sql<{ message_id: string }>("SELECT message_id FROM kg_conflict_prompts WHERE id = $1", [prompt.promptId]);
    await asApp(ORG, (c) => c.query("DELETE FROM chat_messages WHERE id = $1", [said!.message_id]));
    expect(await row(newer.id)).toMatchObject({ revoked: true });
    expect(await sql("SELECT status, message_id FROM kg_conflict_prompts WHERE id = $1", [prompt.promptId]))
      .toEqual([{ status: "closed_by_change", message_id: null }]);
    await closedByChange(T.del, prompt.promptId);
    expect(await row(older.id)).toMatchObject({ status: "accepted" });
    await confirmable(T.del, older.id);
  });

  it("新条同时和两条旧的冲突：只结束一对时它仍在冲突里；两对都结束了才放回来", async () => {
    // 两条都先说、再一起确认（先确认一条再说另一条，第二条就会和第一条冲突）
    await say(T.two, "项目A 定在 9/29 上线");
    await say(T.two, "项目A 定在 9/28 上线");
    await act(T.two, { type: "confirmClaim", claimId: (await claimBy(T.two, "项目A 9/29 上线")).id });
    await act(T.two, { type: "confirmClaim", claimId: (await claimBy(T.two, "项目A 9/28 上线")).id });
    await say(T.two, "项目A 上线改到 10/1");
    const newer = await claimBy(T.two, "项目A 上线改到 10/1");
    const prompts = await promptsOf(T.two);
    expect(prompts.map((p) => p.newer_claim_id)).toEqual([newer.id, newer.id]);
    await act(T.two, { type: "revokeClaim", claimId: prompts[0]!.older_claim_id });
    expect((await row(newer.id)).status).toBe("contested");
    expect((await promptsOf(T.two)).map((p) => p.status)).toEqual(["closed_by_change", "open"]);
    await act(T.two, { type: "revokeClaim", claimId: prompts[1]!.older_claim_id });
    expect((await row(newer.id)).status).toBe("proposed");
    await confirmable(T.two, newer.id);
  });

  it("共用旧条：先忽略「10/1」，再对「10/5」以新的为准 ⇒ 忽略的那张也结束，「10/1」回到「AI 记下的」、可以确认", async () => {
    const first = await conflictIn(T.chain);
    await resolve(T.chain, first.prompt.promptId, "ignore");
    await say(T.chain, "项目A 上线改到 10/5");
    const ans = await answer(T.chain);
    const t = await turn(T.chain, ans);
    if (t.prompt?.type !== "conflict") throw new Error("expected a second card");
    expect(t.prompt.conflict.olderClaim.id).toBe(first.older.id);
    // 直调数据库函数：它自己返回的版本号也要把连带结束的那张卡算进去（不只靠应用层重数）
    const before = (await read(T.chain)).revision;
    const out = await asApp(ORG, async (c) => {
      await c.query("SELECT set_config('app.current_user_id', 'u-owner', true)");
      return (await c.query<{ r: { revision: number } }>("SELECT kg_resolve_conflict($1::jsonb) AS r", [JSON.stringify({
        action_id: newKgId("act"), thread_id: T.chain, based_on_revision: before,
        action: { type: "resolveConflict", promptId: t.prompt!.type === "conflict" ? t.prompt!.conflict.promptId : "", resolution: "keep_new" },
      })])).rows[0]!.r;
    });
    expect(Number(out.revision)).toBe((await read(T.chain)).revision);
    expect(Number(out.revision)).toBe(before + 2);
    await closedByChange(T.chain, first.prompt.promptId);
    expect((await read(T.chain)).claims.find((c) => c.id === first.newer.id)).toMatchObject({ status: "proposed", triState: "pending" });
    await confirmable(T.chain, first.newer.id);
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
      await expect(asApp(ORG, (c) => c.query("SELECT kg_open_conflicts($1::jsonb)", [JSON.stringify({
        action_id: newKgId("act"), thread_id: T.guard, message_id: p!.id, pairs: [],
      })]))).rejects.toThrow(/KG_ORG_FROZEN/);
    } finally {
      await asOwner((q) => q.query("UPDATE organizations SET status = 'active', disabled_at = NULL, retention_until = NULL WHERE id = $1", [ORG]));
    }
    expect((await promptsOf(T.guard))[0]!.status).toBe("open");
    expect(await row(p!.older_claim_id)).toMatchObject({ status: "contested" });
  });

  it("一对里有一条已经被忘掉 ⇒ 卡不再出现、点它 ⇒ KG_PROMPT_NOT_FOUND；冲突随之结束，另一条回到「你确认过」", async () => {
    const [p] = await promptsOf(T.guard);
    await act(T.guard, { type: "revokeClaim", claimId: p!.newer_claim_id });
    const ans = (await sql<{ id: string }>("SELECT id FROM chat_messages WHERE thread_id = $1 AND author_kind = 'agent' ORDER BY created_at DESC LIMIT 1", [T.guard]))[0]!.id;
    expect((await turn(T.guard, ans)).prompt).toBeNull();
    await expect(resolve(T.guard, p!.id, "keep_both")).rejects.toMatchObject({ code: "KG_PROMPT_NOT_FOUND" });
    expect(await row(p!.older_claim_id)).toMatchObject({ status: "accepted" });
    expect((await promptsOf(T.guard))[0]!.status).toBe("closed_by_change");
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
    // 同生产路径（PgKgConflict）：先以会话所有者身份声明 app.current_user_id；declare = false ⇒ 不声明
    const asOwnerOf = async (c: pg.Client, threadId: string, declare: boolean) => {
      if (declare) await c.query("SELECT set_config('app.current_user_id', coalesce(kg_thread_owner($1), ''), true)", [threadId]);
    };
    const open = (pairs: { newer: string; older: string }[], messageId: string, threadId: string, declare = true) => asApp(ORG, async (c) => {
      await asOwnerOf(c, threadId, declare);
      return (await c.query<{ n: number }>("SELECT kg_open_conflicts($1::jsonb) AS n", [JSON.stringify({ action_id: newKgId("act"), thread_id: threadId, message_id: messageId, pairs })])).rows[0]!.n;
    });
    const candidates = (messageId: string, threadId = T.guard2, declare = true) => asApp(ORG, async (c) => {
      await asOwnerOf(c, threadId, declare);
      return (await c.query<{ c: unknown }>("SELECT kg_conflict_candidates($1, $2) AS c", [threadId, messageId])).rows[0]!.c as
        { fresh: { id: string }[]; confirmed: { id: string; scope: string }[] };
    });

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

    // I-14 默认关：没以所有者身份声明 ⇒ 候选里没有任何个人空间的结论，开卡函数也不拿个人空间来比
    expect((await candidates(m3, T.guard2, false)).confirmed.map((c) => c.scope)).not.toContain("personal");
    expect((await candidates(m3, T.guard2, false)).confirmed.map((c) => c.id)).toContain(older.id);
    expect(await open([{ newer: otherMessageFresh.id, older: mine!.id }], m3, T.guard2, false)).toBe(0);
    expect((await row(mine!.id)).status).toBe("accepted");
    // 对照：声明了所有者、同一对（范围合法，规则由应用层判）⇒ 开得出来
    expect(await open([{ newer: otherMessageFresh.id, older: mine!.id }], m3, T.guard2)).toBe(1);
  });

  it("「标冲突」手工标过、但没人确认过的结论不算「你确认过」：不进候选、开卡函数也不收", async () => {
    await say(T.mc, "项目A 定在 9/29 上线");
    await say(T.mc, "项目A 上线改到 10/1");
    const nine = await claimBy(T.mc, "项目A 9/29 上线");
    await act(T.mc, { type: "markContested", claimIds: [nine.id, (await claimBy(T.mc, "项目A 上线改到 10/1")).id] });
    const m = await say(T.mc, "项目A 上线改到 10/5");
    const fresh = await claimBy(T.mc, "项目A 上线改到 10/5");
    expect(await promptsOf(T.mc)).toEqual([]);
    expect(fresh.status).toBe("proposed");
    const n = await asApp(ORG, async (c) => (await c.query<{ n: number }>("SELECT kg_open_conflicts($1::jsonb) AS n",
      [JSON.stringify({ action_id: newKgId("act"), thread_id: T.mc, message_id: m, pairs: [{ newer: fresh.id, older: nine.id }] })])).rows[0]!.n);
    expect(n).toBe(0);
    expect((await row(fresh.id)).status).toBe("proposed");
  });

  it("并发（真的同时）：第一个处理还没提交，第二个在会话锁上等；提交后第二个看到版本号变了 ⇒ KG_REVISION_CHANGED", async () => {
    const { prompt } = await conflictIn(T.held);
    const k = await read(T.held);
    const payload = (resolution: string) => JSON.stringify({
      action_id: newKgId("act"), thread_id: T.held, based_on_revision: k.revision,
      action: { type: "resolveConflict", promptId: prompt.promptId, resolution },
    });
    const a = new pg.Client(appConfig());
    const b = new pg.Client(appConfig());
    await a.connect();
    await b.connect();
    try {
      for (const c of [a, b]) {
        await c.query("BEGIN");
        await c.query("SELECT set_config('app.current_org', $1, true), set_config('app.current_user_id', 'u-owner', true)", [ORG]);
      }
      await a.query("SELECT kg_resolve_conflict($1::jsonb)", [payload("ignore")]);
      let settled = false;
      const second = b.query("SELECT kg_resolve_conflict($1::jsonb)", [payload("keep_new")]).finally(() => { settled = true; });
      second.catch(() => undefined);
      await new Promise((r) => setTimeout(r, 300));
      expect(settled).toBe(false);
      await a.query("COMMIT");
      await expect(second).rejects.toThrow(/KG_REVISION_CHANGED/);
      await b.query("ROLLBACK");
    } finally {
      await a.end();
      await b.end();
    }
    expect((await promptsOf(T.held))[0]!.status).toBe("ignored");
  });

  it("开卡与处理都先拿会话锁，再锁行、再读判（静态守卫：锁不能被挪到判定之后或删掉）", () => {
    const sqlText = readFileSync(new URL("../../migrations/20260924290000_kg_f16_conflict_prompts.sql", import.meta.url), "utf8");
    const body = (fn: string) => {
      const start = sqlText.indexOf(`CREATE OR REPLACE FUNCTION ${fn}(`);
      return sqlText.slice(start, sqlText.indexOf("\n$$;", start));
    };
    const lock = "pg_advisory_xact_lock(hashtext('kg_scope:' || v_org || '|chat_session|' || v_thread))";
    for (const fn of ["kg_open_conflicts", "kg_resolve_conflict"]) {
      const b = body(fn);
      expect(b.indexOf(lock), fn).toBeGreaterThan(0);
      expect(b.indexOf(lock), fn).toBeLessThan(b.indexOf("FOR UPDATE"));
    }
    const r = body("kg_resolve_conflict");
    expect(r.indexOf(lock)).toBeLessThan(r.indexOf("SELECT count(*) INTO v_rev"));
    expect(r.indexOf(lock)).toBeLessThan(r.indexOf("|personal|"));
    // 结束冲突的触发器从不等：只有 try 锁、行锁一律 NOWAIT；它调的收尾函数自己不拿锁
    const trig = body("kg_conflict_close_on_change");
    expect(trig).toMatch(/pg_try_advisory_xact_lock\(v_keys\.thread_key\)/);
    expect(trig).not.toMatch(/\bpg_advisory_xact_lock\(/);
    expect(trig.match(/FOR UPDATE(?! NOWAIT)/g)).toBeNull();
    expect(trig.match(/FOR UPDATE NOWAIT/g)).toHaveLength(2);
    expect(trig).toMatch(/EXCEPTION WHEN lock_not_available/);
    expect(trig).toMatch(/INSERT INTO public\.kg_conflict_close_queue/);
    // 队列表不许有外键：外键检查会在被引用行上等（D2 经由外键又回来——复审第 3 轮）
    const queueDdl = sqlText.slice(sqlText.indexOf("CREATE TABLE IF NOT EXISTS kg_conflict_close_queue"));
    expect(queueDdl.slice(0, queueDdl.indexOf(");"))).not.toMatch(/REFERENCES/i);
    const locked = body("kg_conflict_close_locked");
    expect(locked).not.toMatch(/advisory|FOR UPDATE|FOR SHARE/);
    // 排空按正常顺序等：会话锁 → 个人空间锁 → 行
    const d = body("kg_conflict_close_drain");
    const at = (x: string) => d.indexOf(x);
    expect(at("pg_advisory_xact_lock(v_keys.thread_key)")).toBeGreaterThan(0);
    expect(at("pg_advisory_xact_lock(v_keys.thread_key)")).toBeLessThan(at("pg_advisory_xact_lock(v_keys.personal_key)"));
    expect(at("pg_advisory_xact_lock(v_keys.personal_key)")).toBeLessThan(at("FOR UPDATE"));
  });

  it("读卡时两条都得还活着（不只靠触发器）：绕过触发器把一条失效 ⇒ 这一轮不出卡", async () => {
    const { older, newer, ans, prompt } = await conflictIn(T.stale);
    const bypass = (id: string, dead: boolean) => asOwner(async (c) => {
      await c.query("SET session_replication_role = replica");
      await c.query(dead
        ? "UPDATE claims SET status = 'superseded', revoked_at = now() WHERE id = $1"
        : "UPDATE claims SET status = 'contested', revoked_at = NULL WHERE id = $1", [id]);
    });
    await bypass(older.id, true);
    expect((await turn(T.stale, ans)).prompt).toBeNull();
    // 处理函数同样自己再判一次两条都活着（卡此刻仍是 open）
    await expect(resolve(T.stale, prompt.promptId, "keep_both")).rejects.toMatchObject({ code: "KG_PROMPT_NOT_FOUND" });
    await bypass(older.id, false);
    expect((await turn(T.stale, ans)).prompt?.type).toBe("conflict");
    await bypass(newer.id, true);
    expect((await turn(T.stale, ans)).prompt).toBeNull();
  });
});

describe("F16: 死锁（40P01）重来一次，再不行给人话，不是 500", () => {
  const deadlock = () => Object.assign(new Error("deadlock detected"), { code: "40P01" });
  /** 只替换 withTenant：前 n 次抛 40P01，之后照常返回（回的是动作函数与重数版本号的行）。 */
  function flakyDb(failures: number) {
    let calls = 0;
    const db = {
      withTenant: async <T>(_org: unknown, fn: (s: { query: (q: string) => Promise<{ rows: unknown[] }> }) => Promise<T>) => {
        calls += 1;
        if (calls <= failures) throw deadlock();
        return fn({ query: async (q: string) => ({ rows: [q.includes("kg_thread_revision") ? { n: "8" } : { r: { revision: 7, action_id: "act-x" } }] }) });
      },
    };
    return { db: db as never, calls: () => calls };
  }
  const input = { actionId: "act-x", threadId: "t", basedOnRevision: 6, action: { type: "confirmClaim" as const, claimId: "c" } };

  it("第一次死锁 ⇒ 整个事务重跑一次，成功", async () => {
    const f = flakyDb(1);
    await expect(new PgHumanAction(f.db).apply(ORG_ID, "u-owner", input)).resolves.toEqual({ revision: 8, actionId: "act-x" });
    expect(f.calls()).toBe(2);
  });

  it("连着两次死锁 ⇒ KG_REVISION_CHANGED（界面：内容已变化，请再操作一次），不再重试", async () => {
    const f = flakyDb(2);
    await expect(new PgHumanAction(f.db).apply(ORG_ID, "u-owner", input)).rejects.toMatchObject({ code: "KG_REVISION_CHANGED" });
    expect(f.calls()).toBe(2);
  });

  it("判矛盾的读写口同样重来一次；别的错误不重试", async () => {
    const f = flakyDb(1);
    await expect(new PgKgConflict(f.db).drainCloseOne(ORG_ID)).resolves.toBe(false);
    expect(f.calls()).toBe(2);
    let calls = 0;
    const boom = { withTenant: async () => { calls += 1; throw new Error("boom"); } } as never;
    await expect(new PgKgConflict(boom).drainCloseOne(ORG_ID)).rejects.toThrow("boom");
    expect(calls).toBe(1);
  });
});

describe("F16: 判定用的读写口只调两个数据库函数", () => {
  it("pg-kg-conflict.ts 不写表名 SQL、不出租户上下文：候选范围与复核都在 kg_conflict_candidates / kg_open_conflicts 里", () => {
    const code = readFileSync(new URL("../../src/infrastructure/knowledge-graph/pg-kg-conflict.ts", import.meta.url), "utf8")
      .replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
    expect([...code.matchAll(/"(SELECT [^"]*)"/g)].map((m) => m[1])).toEqual([
      "SELECT set_config('app.current_user_id', coalesce(kg_thread_owner($1), ''), true)",
      "SELECT kg_conflict_candidates($1, $2) AS c", "SELECT kg_open_conflicts($1::jsonb) AS n",
      "SELECT kg_conflict_close_pending_orgs() AS org", "SELECT kg_conflict_close_drain() AS done",
    ]);
    expect(code).not.toMatch(/\b(?:FROM|JOIN|UPDATE|INTO)\s+[a-z_]+/i);
    // 出租户上下文只有一处：取「队列里有活的 org」（只回 id）
    const outside = [...code.matchAll(/withoutTenant\(([\s\S]*?)\)\);/g)].map((m) => m[1]!);
    expect(outside).toHaveLength(1);
    expect(outside[0]).toMatch(/kg_conflict_close_pending_orgs\(\)/);
  });
});

/* ── 跨会话：结束冲突的触发器不等锁（复审 B1：D1 / D2 两条死锁路径） ─────────────── */

describe("F16: 结束冲突不会跨会话死锁——拿不到锁就放进队列，worker 按正常顺序补上", () => {
  const promote = (threadId: string, claimId: string) => promoteToPersonal(
    { ...deps, promotion: new PgPromotion(db), newId: newKgId }, { userId: "u-owner", orgId: ORG_ID, threadId, claimIds: [claimId] });
  const key = (kind: "chat_session" | "personal", id: string) => `kg_scope:${ORG}|${kind}|${id}`;
  async function tx(): Promise<pg.Client> {
    const c = new pg.Client(appConfig());
    await c.connect();
    await c.query("BEGIN");
    await c.query("SELECT set_config('app.current_org', $1, true), set_config('app.current_user_id', 'u-owner', true)", [ORG]);
    return c;
  }
  /** 在 ms 毫秒内必须返回：触发器若在等锁，这里会超时失败，而不是整个测试挂住。 */
  const within = <T>(p: Promise<T>, ms: number) => Promise.race([
    p, new Promise<never>((_r, reject) => setTimeout(() => reject(new Error(`still waiting after ${String(ms)}ms`)), ms)),
  ]);
  const resolvePayload = (threadId: string, rev: number, promptId: string, resolution: string) => JSON.stringify({
    action_id: newKgId("act"), thread_id: threadId, based_on_revision: rev, action: { type: "resolveConflict", promptId, resolution },
  });
  const queued = (c: pg.Client, promptId: string) =>
    c.query<{ n: number }>("SELECT count(*)::int AS n FROM kg_conflict_close_queue WHERE prompt_id = $1", [promptId]).then((r) => r.rows[0]!.n);
  const confirmable = async (threadId: string, claimId: string) => {
    await act(threadId, { type: "confirmClaim", claimId });
    expect((await read(threadId)).claims.find((c) => c.id === claimId)).toMatchObject({ status: "accepted", triState: "confirmed" });
  };

  it("D2：甲在会话 A 忘掉一条（F07 级联让它的长期记忆副本 P 失效），乙已拿着会话 B 的锁、随后要锁 P ⇒ 两边都走完，没有死锁", async () => {
    await say(T.qa, "项目Q 定在 9/29 发布");
    const s1 = await claimBy(T.qa, "项目Q 9/29 发布");
    expect((await promote(T.qa, s1.id)).results[0]?.outcome).toBe("promoted");
    await say(T.qb, "项目Q 发布改到 10/1");
    const [pb] = await promptsOf(T.qb);
    expect(await sql("SELECT scope_kind FROM claims WHERE id = $1", [pb!.older_claim_id])).toEqual([{ scope_kind: "personal" }]);
    const kA = (await read(T.qa)).revision;
    const kB = (await read(T.qb)).revision;
    const a = await tx();
    const b = await tx();
    try {
      await b.query("SELECT pg_advisory_xact_lock(hashtext($1)), pg_advisory_xact_lock(hashtext($2))", [key("chat_session", T.qb), key("personal", "u-owner")]);
      const started = Date.now();
      await within(a.query("SELECT kg_apply_human_action($1::jsonb)", [JSON.stringify({
        action_id: newKgId("act"), thread_id: T.qa, based_on_revision: kA, action: { type: "revokeClaim", claimId: s1.id },
      })]), 3_000);
      expect(Date.now() - started).toBeLessThan(3_000);
      expect(await queued(a, pb!.id)).toBe(1);                 // 拿不到会话 B 的锁 ⇒ 放进队列
      const second = b.query("SELECT kg_resolve_conflict($1::jsonb)", [resolvePayload(T.qb, kB, pb!.id, "keep_both")]);
      second.catch(() => undefined);
      await new Promise((r) => setTimeout(r, 200));
      await a.query("COMMIT");
      await expect(second).rejects.toThrow(/KG_PROMPT_NOT_FOUND/); // P 已失效——干净的「卡不在了」，不是 deadlock detected
      await b.query("ROLLBACK");
    } finally {
      await a.end();
      await b.end();
    }
    expect((await promptsOf(T.qb))[0]!.status).toBe("open");   // 还没排空
    while ((await asApp(ORG, (c) => c.query<{ done: boolean }>("SELECT kg_conflict_close_drain() AS done"))).rows[0]!.done) { /* 排空 */ }
    expect((await promptsOf(T.qb))[0]!.status).toBe("closed_by_change");
    expect(await sql("SELECT 1 FROM kg_conflict_close_queue WHERE prompt_id = $1", [pb!.id])).toEqual([]);
    expect((await row(pb!.newer_claim_id)).status).toBe("proposed");
    await confirmable(T.qb, pb!.newer_claim_id);
  });

  it("D1：甲对会话 B 的卡「以新的为准」（取代共用的旧条 P），乙拿着会话 C 的锁、随后处理会话 C 的卡 ⇒ 两边都走完；worker 排空后 C 的新条可以确认", async () => {
    await say(T.ra, "项目R 定在 9/29 发布");
    expect((await promote(T.ra, (await claimBy(T.ra, "项目R 9/29 发布")).id)).results[0]?.outcome).toBe("promoted");
    await say(T.rb, "项目R 发布改到 10/1");
    await say(T.rc, "项目R 发布改到 10/5");
    const [pbb] = await promptsOf(T.rb);
    const [pcc] = await promptsOf(T.rc);
    expect(pbb!.older_claim_id).toBe(pcc!.older_claim_id);
    const kB = (await read(T.rb)).revision;
    const kC = (await read(T.rc)).revision;
    const a = await tx();
    const b = await tx();
    try {
      await b.query("SELECT pg_advisory_xact_lock(hashtext($1))", [key("chat_session", T.rc)]);
      await within(a.query("SELECT kg_resolve_conflict($1::jsonb)", [resolvePayload(T.rb, kB, pbb!.id, "keep_new")]), 3_000);
      expect(await queued(a, pcc!.id)).toBe(1);
      const second = b.query("SELECT kg_resolve_conflict($1::jsonb)", [resolvePayload(T.rc, kC, pcc!.id, "keep_both")]);
      second.catch(() => undefined);
      await new Promise((r) => setTimeout(r, 200));
      await a.query("COMMIT");
      await expect(second).rejects.toThrow(/KG_PROMPT_NOT_FOUND/);
      await b.query("ROLLBACK");
    } finally {
      await a.end();
      await b.end();
    }
    expect((await promptsOf(T.rb))[0]!.status).toBe("kept_new");
    // 走生产的排空路径（worker 每一轮调的就是它）
    expect(await drainConflictCloses({ conflicts: new PgKgConflict(db), logger: silentLogger })).toBeGreaterThanOrEqual(1);
    expect((await promptsOf(T.rc))[0]!.status).toBe("closed_by_change");
    expect((await row(pcc!.newer_claim_id)).status).toBe("proposed");
    await confirmable(T.rc, pcc!.newer_claim_id);
    // 排空可重复：再跑一轮什么都不做
    expect(await drainConflictCloses({ conflicts: new PgKgConflict(db), logger: silentLogger })).toBe(0);
  });

  it("另一个事务正拿着那张卡这一行（排空 / 处理的前半段）⇒ 触发器入队不等，立刻返回；对方随后锁那条结论也不死锁", async () => {
    await say(T.ta, "项目T 定在 9/29 发布");
    const s1 = await claimBy(T.ta, "项目T 9/29 发布");
    expect((await promote(T.ta, s1.id)).results[0]?.outcome).toBe("promoted");
    await say(T.tb, "项目T 发布改到 10/1");
    const [pt] = await promptsOf(T.tb);
    const kA = (await read(T.ta)).revision;
    const a = await tx();
    // 乙：与 kg_conflict_close_drain / kg_resolve_conflict 的前半段一样——会话锁、个人空间锁、卡这一行、新条这一行
    const b = new pg.Client(migrationConfig());
    await b.connect();
    try {
      await b.query("BEGIN");
      await b.query("SELECT pg_advisory_xact_lock(hashtext($1)), pg_advisory_xact_lock(hashtext($2))", [key("chat_session", T.tb), key("personal", "u-owner")]);
      await b.query("SELECT 1 FROM kg_conflict_prompts WHERE id = $1 FOR UPDATE", [pt!.id]);
      await b.query("SELECT 1 FROM claims WHERE id = $1 FOR UPDATE", [pt!.newer_claim_id]);
      const started = Date.now();
      await within(a.query("SELECT kg_apply_human_action($1::jsonb)", [JSON.stringify({
        action_id: newKgId("act"), thread_id: T.ta, based_on_revision: kA, action: { type: "revokeClaim", claimId: s1.id },
      })]), 2_000);
      expect(Date.now() - started).toBeLessThan(2_000);
      expect(await queued(a, pt!.id)).toBe(1);
      // 乙接着锁 P（旧条，甲已持有）⇒ 等甲；甲提交后乙拿到——没有环
      const lockOlder = b.query("SELECT 1 FROM claims WHERE id = $1 FOR UPDATE", [pt!.older_claim_id]);
      lockOlder.catch(() => undefined);
      await new Promise((r) => setTimeout(r, 200));
      await a.query("COMMIT");
      await expect(lockOlder).resolves.toBeDefined();
      await b.query("COMMIT");
    } finally {
      await a.end();
      await b.end();
    }
    expect(await drainConflictCloses({ conflicts: new PgKgConflict(db), logger: silentLogger })).toBeGreaterThanOrEqual(1);
    expect((await promptsOf(T.tb))[0]!.status).toBe("closed_by_change");
    await confirmable(T.tb, pt!.newer_claim_id);
  });

  it("排空失败的一行（这里：等锁超时）往后推，不挡住同一 org 后面的行；到期后再处理", async () => {
    const first = await conflictIn(T.pa);
    const second = await conflictIn(T.pb);
    // 两张卡的新条都失效了，但绕过触发器（replica）——让它们只经队列结束
    await asOwner(async (c) => {
      await c.query("SET session_replication_role = replica");
      await c.query("UPDATE claims SET status = 'superseded', revoked_at = now() WHERE id = ANY($1)", [[first.newer.id, second.newer.id]]);
      await c.query("INSERT INTO kg_conflict_close_queue (org_id, prompt_id) VALUES ($1, $2), ($1, $3)", [ORG, first.prompt.promptId, second.prompt.promptId]);
    });
    const drainOne = () => asApp(ORG, async (c) => (await c.query<{ done: boolean }>("SELECT kg_conflict_close_drain() AS done")).rows[0]!.done);
    const qrow = (promptId: string) => sql<{ attempts: number; due: boolean; last_error: string | null }>(
      "SELECT attempts, not_before <= now() AS due, last_error FROM kg_conflict_close_queue WHERE prompt_id = $1", [promptId]);
    const holder = new pg.Client(migrationConfig());
    await holder.connect();
    try {
      await holder.query("BEGIN");
      await holder.query("SELECT pg_advisory_xact_lock(hashtext($1))", [key("chat_session", T.pa)]);
      expect(await drainOne()).toBe(true);                       // 队首（第一张）等锁超时 ⇒ 记失败、往后推
      expect(await qrow(first.prompt.promptId)).toEqual([{ attempts: 1, due: false, last_error: expect.any(String) }]);
      // 连败很多次（例：第 25 次）：退避封顶一天，不溢出、不抛错（否则这行会一直挡住同一 org 后面的行）
      await asOwner((c) => c.query("UPDATE kg_conflict_close_queue SET attempts = 25, not_before = now() WHERE prompt_id = $1", [first.prompt.promptId]));
      expect(await drainOne()).toBe(true);
      const [capped] = await sql<{ attempts: number; hours: number }>(
        "SELECT attempts, extract(epoch FROM (not_before - now())) / 3600 AS hours FROM kg_conflict_close_queue WHERE prompt_id = $1", [first.prompt.promptId]);
      expect(capped!.attempts).toBe(26);
      expect(Number(capped!.hours)).toBeGreaterThan(23);
      expect(Number(capped!.hours)).toBeLessThanOrEqual(24);
      expect(await drainOne()).toBe(true);                       // 后面那张照样处理
      expect((await promptsOf(T.pb))[0]!.status).toBe("closed_by_change");
      expect(await row(second.older.id)).toMatchObject({ status: "accepted" });
      expect(await drainOne()).toBe(false);                      // 失败的那行还没到期
      expect((await promptsOf(T.pa))[0]!.status).toBe("open");
    } finally {
      await holder.query("ROLLBACK").catch(() => undefined);
      await holder.end();
    }
    await asOwner((c) => c.query("UPDATE kg_conflict_close_queue SET not_before = now() WHERE prompt_id = $1", [first.prompt.promptId]));
    expect(await drainOne()).toBe(true);
    expect((await promptsOf(T.pa))[0]!.status).toBe("closed_by_change");
    expect(await qrow(first.prompt.promptId)).toEqual([]);
    expect(await row(first.older.id)).toMatchObject({ status: "accepted" });
  });

  it("锁都拿得到时当场结束（不进队列）；会话作用域的审计不带个人空间的 id，个人空间那条记在个人空间", async () => {
    await say(T.sa, "项目S 定在 9/29 发布");
    expect((await promote(T.sa, (await claimBy(T.sa, "项目S 9/29 发布")).id)).results[0]?.outcome).toBe("promoted");
    await say(T.sb, "项目S 发布改到 10/1");
    const [ps] = await promptsOf(T.sb);
    await act(T.sb, { type: "revokeClaim", claimId: ps!.newer_claim_id });
    expect((await promptsOf(T.sb))[0]!.status).toBe("closed_by_change");
    expect(await sql("SELECT 1 FROM kg_conflict_close_queue WHERE prompt_id = $1", [ps!.id])).toEqual([]);
    expect(await row(ps!.older_claim_id)).toMatchObject({ status: "accepted" });
    const [session] = await sql<{ payload: unknown }>("SELECT payload FROM ontology_actions WHERE id = $1 AND scope_kind = 'chat_session'", [`kgclose-${ps!.id}`]);
    expect(JSON.stringify(session!.payload)).not.toContain(ps!.older_claim_id);
    expect(JSON.stringify(session!.payload)).toContain(ps!.newer_claim_id);
    const [personal] = await sql<{ payload: unknown }>("SELECT payload FROM ontology_actions WHERE id = $1 AND scope_kind = 'personal' AND scope_id = 'u-owner'", [`kgclose-${ps!.id}-l1`]);
    expect(JSON.stringify(personal!.payload)).toContain(ps!.older_claim_id);
  });
});

/* 放在最后：它往所有者的长期记忆里写了「项目A …」，前面各个个人线程的判定会拿它来比。 */
describe("F16: 以新的为准时，长期记忆里旧说法的副本一起失效（哪怕它还有别的来源）", () => {
  it("旧条的 L1 副本合并过两个会话的来源 ⇒ 以新的为准后副本也失效，长期记忆里只剩新说法", async () => {
    const promote = (threadId: string, claimId: string) => promoteToPersonal(
      { ...deps, promotion: new PgPromotion(db), newId: newKgId }, { userId: "u-owner", orgId: ORG_ID, threadId, claimIds: [claimId] });
    await say(T.l1b, "项目A 定在 9/29 上线");
    expect((await promote(T.l1b, (await claimBy(T.l1b, "项目A 9/29 上线")).id)).results[0]?.outcome).toBe("promoted");
    await say(T.l1a, "项目A 定在 9/29 上线");
    const src = await claimBy(T.l1a, "项目A 9/29 上线");
    expect((await promote(T.l1a, src.id)).results[0]?.outcome).toBe("merged_into_existing");
    const [copy] = await sql<{ id: string }>(
      "SELECT id FROM claims WHERE org_id = $1 AND scope_kind = 'personal' AND scope_id = 'u-owner' AND statement = '项目A 9/29 上线' AND revoked_at IS NULL", [ORG]);
    await say(T.l1a, "项目A 上线改到 10/1");
    const ans = await answer(T.l1a);
    const t = await turn(T.l1a, ans);
    if (t.prompt?.type !== "conflict") throw new Error("expected a card");
    expect(t.prompt.conflict.olderClaim.id).toBe(src.id);   // 会话里的原条，不是它的 L1 副本
    await resolve(T.l1a, t.prompt.conflict.promptId, "keep_new");
    expect(await row(copy!.id)).toMatchObject({ status: "superseded", revoked: true, revocation_reason: "conflict_keep_new" });
    const live = await sql<{ statement: string }>(
      "SELECT statement FROM claims WHERE org_id = $1 AND scope_kind = 'personal' AND scope_id = 'u-owner' AND statement LIKE '项目A%' AND revoked_at IS NULL", [ORG]);
    expect(live.map((x) => x.statement)).toEqual(["项目A 上线改到 10/1"]);
  });
});
