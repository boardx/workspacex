/**
 * Phase 18 F11 —— 晋升到个人空间（uc-18-4 R3 / R4 E1–E5 / R5 / R7），真实数据库。
 *
 * 知识由 F06 抽取流水线真实产生；晋升经 promoteToPersonal → kg_promote_claim 落表。
 * 覆盖：AI 记下的也能晋升（U-3：点按钮即确认）、复制 + derived_from 连回原结论（R7-1）、
 * 完全相同 ⇒ 自动合并、相近 ⇒ 让人选合并 / 并存、冲突态 / 证据没了逐条拒绝、逐条部分成功、
 * 非个人线程 / 非所有者 / 超批量整批拒绝。
 */
import { BadRequestException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyHumanAction } from "../../src/application/knowledge-graph/apply-human-action";
import { runExtractionTick } from "../../src/application/knowledge-graph/extract-message-knowledge";
import { newKgId } from "../../src/application/knowledge-graph/ids";
import { promoteToPersonal, type PromotionDeps } from "../../src/application/knowledge-graph/promote-to-personal";
import { getThreadKnowledge } from "../../src/application/knowledge-graph/read-thread-knowledge";
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
import { addOrgMember, addProjectMember, asOwner, ensureDatabase, migrateOnce, resetOrgs, seedOrg } from "../support/db";
import { extractionDeps, loopbackModel } from "./kg-extraction-fixtures";

const ORG = "org-kg-f11-promote";
const ORG_ID = toOrgId(ORG);
const MINE = "thr-kg-f11-mine";
const MINE2 = "thr-kg-f11-mine2";
const SHARED = "thr-kg-f11-shared";
const THEIRS = "thr-kg-f11-theirs";
let db: PgDatabase;
let deps: PromotionDeps;
let ctl: KnowledgeGraphController;
const owner = { userId: "u-owner", orgId: ORG_ID };

const claim = (statement: string, kind: string, about: string[], extra: object = {}) =>
  ({ statement, kind, confidence: 0.8, about, decidedBy: null, quote: statement, ...extra });

const FIRST = JSON.stringify({
  entities: [{ name: "v2", kind: "product", aliases: [] }, { name: "老张", kind: "person", aliases: [] }, { name: "张三", kind: "person", aliases: [] }],
  claims: [
    claim("v2 下周一上线", "decision", ["v2"], { decidedBy: "张三" }),
    claim("v2 下周三上线", "decision", ["v2"]),
    claim("老张负责测试", "fact", ["老张"]),
    claim("测试环境不稳定", "risk", ["v2"]),
    claim("预算已经批了", "fact", []),
  ],
});
const SECOND = JSON.stringify({
  entities: [{ name: "老张", kind: "person", aliases: [] }, { name: "V2", kind: "product", aliases: [] }],
  claims: [
    claim("老张负责测试", "fact", ["老张"]),
    claim("测试环境很不稳定", "risk", ["V2"]),
    claim("测试环境也不稳定", "risk", ["V2"]),
  ],
});

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  await resetOrgs(ORG);
  const fx = await seedOrg({ orgId: ORG, projectId: `${ORG}-p` });
  for (const u of ["u-owner", "u-member"]) {
    await addOrgMember(ORG, u, "consultant", fx.teams.energy!);
    await addProjectMember(ORG, `${ORG}-p`, u, "facilitator", null);
  }
  await addChatThread({ orgId: ORG, id: MINE, projectId: null, visibilityScope: "private", createdBy: "u-owner" });
  await addChatThread({ orgId: ORG, id: MINE2, projectId: null, visibilityScope: "private", createdBy: "u-owner" });
  await addChatThread({ orgId: ORG, id: SHARED, projectId: `${ORG}-p`, visibilityScope: "plenary", createdBy: "u-owner" });
  await addChatThread({ orgId: ORG, id: THEIRS, projectId: null, visibilityScope: "private", createdBy: "u-member" });
  db = new PgDatabase(appConfig());
  deps = {
    repo: new PgIdentityRepository(db), ids: new CountingDecisionIdFactory(), chat: new PgChatRepository(db),
    knowledge: new PgKnowledgeRead(db), promotion: new PgPromotion(db), newId: newKgId,
  };
  ctl = new KnowledgeGraphController(deps.repo, deps.ids, deps.chat, deps.knowledge, new PgHumanAction(db), deps.promotion);
  const { model } = loopbackModel([["上线", FIRST], ["很不稳定", SECOND]]);
  const body = "v2 下周一上线；也有人说 v2 下周三上线。老张负责测试，测试环境不稳定，预算已经批了。";
  for (const t of [MINE, SHARED, THEIRS]) await addChatMessage({ orgId: ORG, id: `m-${t}`, threadId: t, body, authorId: t === THEIRS ? "u-member" : "u-owner" });
  await addChatMessage({ orgId: ORG, id: `m-${MINE2}`, threadId: MINE2, body: "老张负责测试。测试环境很不稳定，测试环境也不稳定。", authorId: "u-owner" });
  await runExtractionTick(extractionDeps(db, model, ORG));
});
afterAll(async () => { await db.close(); });

const read = (threadId = MINE) => getThreadKnowledge(deps, { ...owner, threadId });
const claimId = async (statement: string, threadId = MINE) => {
  const c = (await read(threadId)).claims.find((x) => x.statement === statement);
  if (c === undefined) throw new Error(`no claim ${statement} in ${threadId}`);
  return c.id;
};
const promote = (threadId: string, claimIds: string[], choices?: { claimId: string; choice: "merge" | "coexist" }[], userId = "u-owner") =>
  promoteToPersonal(deps, { userId, orgId: ORG_ID, threadId, claimIds, ...(choices ? { choices } : {}) });
const sql = <T>(q: string, params: unknown[] = []) => asOwner(async (c) => (await c.query(q, params)).rows as T[]);

describe("F11: 记到我的长期记忆", () => {
  it("AI 记下的也能晋升：原结论变「你确认过」，L1 复制一条 + derived_from 连回原结论，证据与实体跟过去", async () => {
    const src = await claimId("老张负责测试");
    const { results } = await promote(MINE, [src]);
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ claimId: src, outcome: "promoted" });
    const pid = (results[0] as { personalClaimId: string }).personalClaimId;

    expect((await read()).claims.find((c) => c.id === src)).toMatchObject({ status: "accepted", triState: "confirmed", reviewedBy: "u-owner" });
    const [l1] = await sql<{ statement: string; scope_kind: string; scope_id: string; status: string; created_by: string }>(
      "SELECT statement, scope_kind, scope_id, status, created_by FROM claims WHERE id = $1", [pid]);
    expect(l1).toEqual({ statement: "老张负责测试", scope_kind: "personal", scope_id: "u-owner", status: "accepted", created_by: "human" });
    // 复制不是移动：L0 原行作用域不变
    expect(await sql("SELECT scope_kind, scope_id FROM claims WHERE id = $1", [src])).toEqual([{ scope_kind: "chat_session", scope_id: MINE }]);
    expect(await sql("SELECT 1 FROM ontology_edges WHERE src_id = $1 AND dst_id = $2 AND relation = 'derived_from'", [pid, src])).toHaveLength(1);
    expect(await sql("SELECT message_id FROM claim_message_evidence WHERE claim_id = $1", [pid])).toEqual([{ message_id: `m-${MINE}` }]);
    expect(await sql("SELECT o.name FROM ontology_edges e JOIN ontology_objects o ON o.id = e.dst_id WHERE e.src_id = $1 AND o.scope_kind = 'personal'", [pid]))
      .toEqual([{ name: "老张" }]);
    const [act] = await sql<{ action_type: string; actor_kind: string; actor_id: string; scope_kind: string }>(
      "SELECT action_type, actor_kind, actor_id, scope_kind FROM ontology_actions WHERE payload->'claims'->1->>'id' = $1", [pid]);
    expect(act).toEqual({ action_type: "promoteToPersonal", actor_kind: "human", actor_id: "u-owner", scope_kind: "personal" });
  });

  it("另一个会话里一模一样的结论 ⇒ 自动合并到已有那条（证据追加，不再复制一份）", async () => {
    const first = await sql<{ id: string }>(`SELECT id FROM claims WHERE org_id = '${ORG}' AND scope_kind = 'personal' AND scope_id = 'u-owner' AND statement = '老张负责测试'`);
    expect(first).toHaveLength(1);
    const src = await claimId("老张负责测试", MINE2);
    const { results } = await promote(MINE2, [src]);
    expect(results[0]).toEqual({ claimId: src, outcome: "merged_into_existing", personalClaimId: first[0]!.id });
    expect(await sql(`SELECT id FROM claims WHERE org_id = '${ORG}' AND scope_kind = 'personal' AND scope_id = 'u-owner' AND statement = '老张负责测试'`)).toHaveLength(1);
    expect((await sql<{ message_id: string }>("SELECT message_id FROM claim_message_evidence WHERE claim_id = $1 ORDER BY message_id", [first[0]!.id])).map((r) => r.message_id))
      .toEqual([`m-${MINE2}`, `m-${MINE}`].sort());
    expect(await sql("SELECT 1 FROM ontology_edges WHERE src_id = $1 AND dst_id = $2 AND relation = 'derived_from'", [first[0]!.id, src])).toHaveLength(1);
  });

  it("相近但不相同 ⇒ needs_choice（什么都不写）；人选「合并」/「并存」后照办", async () => {
    const base = await claimId("测试环境不稳定");
    const [baseResult] = (await promote(MINE, [base])).results;
    const existing = (baseResult as { personalClaimId: string }).personalClaimId;
    const very = await claimId("测试环境很不稳定", MINE2);
    const also = await claimId("测试环境也不稳定", MINE2);
    const before = await sql(`SELECT id FROM claims WHERE org_id = '${ORG}' AND scope_kind = 'personal'`);

    const ask = await promote(MINE2, [very, also]);
    expect(ask.results).toEqual([
      { claimId: very, outcome: "needs_choice", existingPersonalClaimId: existing },
      { claimId: also, outcome: "needs_choice", existingPersonalClaimId: existing },
    ]);
    expect(await sql(`SELECT id FROM claims WHERE org_id = '${ORG}' AND scope_kind = 'personal'`)).toEqual(before);

    const done = await promote(MINE2, [very, also], [{ claimId: very, choice: "merge" }, { claimId: also, choice: "coexist" }]);
    expect(done.results[0]).toEqual({ claimId: very, outcome: "merged_into_existing", personalClaimId: existing });
    expect(done.results[1]).toMatchObject({ claimId: also, outcome: "coexisting" });
    const coexist = (done.results[1] as { personalClaimId: string }).personalClaimId;
    expect(coexist).not.toBe(existing);
    // 实体解析：「V2」与已有的个人实体「v2」同名同类型（不分大小写）⇒ 复用，不新建
    expect(await sql(`SELECT id FROM ontology_objects WHERE org_id = '${ORG}' AND scope_kind = 'personal' AND lower(name) = 'v2'`)).toHaveLength(1);
  });

  it("逐条部分成功：冲突态 ⇒ KG_CONTESTED_NEEDS_RESOLUTION，证据没了 ⇒ KG_EVIDENCE_REVOKED，不存在 ⇒ KG_CLAIM_NOT_FOUND，其余照常晋升", async () => {
    const a = await claimId("v2 下周一上线");
    const b = await claimId("v2 下周三上线");
    const k = await read();
    await applyHumanAction({ ...deps, actions: new PgHumanAction(db) }, { ...owner, threadId: MINE, basedOnRevision: k.revision, action: { type: "markContested", claimIds: [a, b] } });
    const budget = await claimId("预算已经批了");
    await sql("DELETE FROM claim_message_evidence WHERE claim_id = $1", [budget]);
    const shared = await claimId("预算已经批了", SHARED);  // 别的会话的结论：不属于这个线程

    const { results } = await promote(MINE, [a, budget, "no-such-claim", shared, b]);
    expect(results).toEqual([
      { claimId: a, outcome: "rejected", code: "KG_CONTESTED_NEEDS_RESOLUTION" },
      { claimId: budget, outcome: "rejected", code: "KG_EVIDENCE_REVOKED" },
      { claimId: "no-such-claim", outcome: "rejected", code: "KG_CLAIM_NOT_FOUND" },
      { claimId: shared, outcome: "rejected", code: "KG_CLAIM_NOT_FOUND" },
      { claimId: b, outcome: "rejected", code: "KG_CONTESTED_NEEDS_RESOLUTION" },
    ]);
    expect(await sql(`SELECT 1 FROM claims WHERE org_id = '${ORG}' AND scope_kind = 'personal' AND statement IN ('v2 下周一上线', '预算已经批了')`)).toHaveLength(0);
  });

  it("非个人线程 ⇒ KG_SCOPE_NOT_PERSONAL（HTTP 403）", async () => {
    const c = await claimId("老张负责测试", SHARED);
    await expect(promote(SHARED, [c])).rejects.toMatchObject({ code: "KG_SCOPE_NOT_PERSONAL" });
    await expect(ctl.promote({ userId: "u-owner", orgId: ORG } as never, SHARED, { claimIds: [c] })).rejects.toBeInstanceOf(ForbiddenException);
    expect(await sql("SELECT 1 FROM ontology_edges WHERE dst_id = $1 AND relation = 'derived_from'", [c])).toHaveLength(0);
  });

  it("别人的个人线程：看不见 ⇒ 与不存在同一个出口（404）；绕过应用层直接调执行器 ⇒ KG_NOT_OWNER", async () => {
    await expect(promote(THEIRS, ["whatever"])).rejects.toMatchObject({ code: "KG_THREAD_NOT_FOUND" });
    await expect(ctl.promote({ userId: "u-owner", orgId: ORG } as never, THEIRS, { claimIds: ["whatever"] })).rejects.toBeInstanceOf(NotFoundException);
    const [theirs] = await sql<{ id: string }>("SELECT id FROM claims WHERE scope_kind = 'chat_session' AND scope_id = $1 LIMIT 1", [THEIRS]);
    await expect(deps.promotion.promote(ORG_ID, "u-owner", { actionId: newKgId("act"), threadId: THEIRS, claimId: theirs!.id, mode: "new" }))
      .rejects.toMatchObject({ code: "KG_NOT_OWNER" });
  });

  it("一次超过 50 条 ⇒ KG_PROMOTE_BATCH_TOO_LARGE（HTTP 400），什么都不写", async () => {
    const ids = Array.from({ length: 51 }, (_, i) => `c-${i}`);
    await expect(promote(MINE, ids)).rejects.toMatchObject({ code: "KG_PROMOTE_BATCH_TOO_LARGE" });
    // 入参校验在进入应用层之前同步抛出
    expect(() => ctl.promote({ userId: "u-owner", orgId: ORG } as never, MINE, { claimIds: ids })).toThrow(BadRequestException);
  });
});
