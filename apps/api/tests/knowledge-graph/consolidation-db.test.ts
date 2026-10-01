// @global-scope-fixture table:embedding_models: 本文件只登记一个只属于它的 3 维模型 `kg-s8-test@v1`（登记是幂等的 ON CONFLICT DO NOTHING，重跑收敛到同一行），别的文件不读这个名字；它的向量行都在本文件自己的 org 里，随 resetOrgs 清掉。
/**
 * S8（#4365）—— 记忆整合，真实数据库：个人记忆由 F06 抽取 + #4283/#4343 自动记入真实产生（回环模型按消息内容回固定 JSON），
 * 然后整合一次：
 *   - 两条同义的偏好（S9 向量 + 字面）⇒ 合成一条，**两条的来源都在保留的那条上**；
 *   - 「项目A」与「项目 A」两个实体 ⇒ 合成一个（边改指向、别名并入）；
 *   - 「预算 50 万」对「预算 60 万」⇒ 开一张 F16 冲突卡（挂在说 60 万那一轮下面），**不裁决**；
 * 每一处都能撤销（原值复原、卡撤回、审计留痕），前提变了的那一处记 undo_skipped + 原因；只有本人看得到、撤得动。
 * 以及 SLO 的「卡住的租约」数据库现数与平台 SLO 接口的形状。
 */
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { knowledgeGraph as KG } from "@repo/contracts";
import { applyHumanAction, type HumanActionDeps } from "../../src/application/knowledge-graph/apply-human-action";
import {
  consolidateUser, listMyConsolidationRuns, runConsolidationPass, undoMyConsolidationRun,
} from "../../src/application/knowledge-graph/consolidate-memory";
import { runExtractionTick, type ExtractionDeps } from "../../src/application/knowledge-graph/extract-message-knowledge";
import { ExtractionSloRecorder } from "../../src/application/knowledge-graph/extraction-slo-recorder";
import { newKgId } from "../../src/application/knowledge-graph/ids";
import { getPersonalKnowledge } from "../../src/application/knowledge-graph/read-personal-knowledge";
import { getThreadKnowledge, getTurnMemory } from "../../src/application/knowledge-graph/read-thread-knowledge";
import { KgConsolidationError, type KgConsolidationPort } from "../../src/application/knowledge-graph/s8-ports";
import { EXTRACTION_SLO_DEFAULTS } from "../../src/domain/knowledge-graph/extraction-slo";
import { toOrgId } from "../../src/domain/org-id";
import { PgChatRepository } from "../../src/infrastructure/chat/pg-chat-repository";
import { appConfig } from "../../src/infrastructure/db/pg-config";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { CountingDecisionIdFactory } from "../../src/infrastructure/identity/in-memory-session-store";
import { PgIdentityRepository } from "../../src/infrastructure/identity/pg-identity-repository";
import { PgHumanAction } from "../../src/infrastructure/knowledge-graph/pg-human-action";
import { PgKgConsolidation, PgKgExtractionSloCounts } from "../../src/infrastructure/knowledge-graph/pg-kg-consolidation";
import { PgKnowledgeRead } from "../../src/infrastructure/knowledge-graph/pg-knowledge-read";
import { PlatformMemoryOpsController } from "../../src/interface/controllers/platform-memory-ops.controller";
import { addChatMessage, addChatThread } from "../support/chat-db";
import { addOrgMember, asOwner, ensureDatabase, migrateOnce, resetOrgs, seedOrg } from "../support/db";
import { enableExtraction, extractionDeps, loopbackModel, silentLogger } from "./kg-extraction-fixtures";

const ORG = "org-kg-s8-consolidation";
const ORG_ID = toOrgId(ORG);
const ME = "u-s8-me";
const OTHER = "u-s8-other";
const T = {
  budget50: "thr-s8-b50", budget60: "thr-s8-b60", pref1: "thr-s8-p1", pref2: "thr-s8-p2", slo: "thr-s8-slo",
  b10: "thr-s8-b10", b20: "thr-s8-b20", h1: "thr-s8-h1", h2: "thr-s8-h2",
};
const EMB = { model: "kg-s8-test", modelVersion: "v1" };

const decision = (entity: string, statement: string) => JSON.stringify({
  entities: [{ name: entity, kind: "project", aliases: [] }],
  claims: [{ statement, kind: "decision", confidence: 0.9, about: [entity], decidedBy: null, quote: statement }],
});
const preference = (statement: string) => JSON.stringify({
  entities: [], claims: [{ statement, kind: "preference", confidence: 0.9, about: [], decidedBy: null, quote: statement }],
});
const PREF_OLD = "我更喜欢简洁的回答";
const PREF_NEW = "我更喜欢简洁一点的回答";
const HABIT_OLD = "我习惯早上开会";
const HABIT_NEW = "我习惯在早上开会";
const MODEL = loopbackModel([
  ["项目B 预算定为 20 万", decision("项目B", "项目B 预算定为 20 万")],
  ["项目B 预算定为 10 万", decision("项目B", "项目B 预算定为 10 万")],
  [HABIT_NEW, preference(HABIT_NEW)],
  [HABIT_OLD, preference(HABIT_OLD)],
  ["项目 A 预算定为 60 万", decision("项目 A", "项目 A 预算定为 60 万")],
  ["项目A 预算定为 50 万", decision("项目A", "项目A 预算定为 50 万")],
  [PREF_NEW, preference(PREF_NEW)],
  [PREF_OLD, preference(PREF_OLD)],
]);

let db: PgDatabase;
let xdeps: ExtractionDeps;
let hdeps: HumanActionDeps;
let port: PgKgConsolidation;
let seq = 0;
const answers: Record<string, string> = {};

const sql = <R>(q: string, params: unknown[] = []) => asOwner(async (c: pg.Client) => (await c.query(q, params)).rows as R[]);
async function say(threadId: string, body: string, opts: { agent?: boolean } = {}): Promise<string> {
  const id = `m-s8-${String(++seq)}`;
  await addChatMessage({
    orgId: ORG, id, threadId, body, authorId: opts.agent ? "agent-1" : ME,
    ...(opts.agent ? { authorKind: "agent" as const, agentId: "agent-1" } : {}),
  });
  await runExtractionTick(xdeps);
  return id;
}
const readDeps = () => ({ repo: hdeps.repo, ids: hdeps.ids, chat: hdeps.chat, knowledge: hdeps.knowledge });
const personal = (userId = ME) => getPersonalKnowledge(readDeps(), { userId, orgId: ORG_ID });
const cdeps = () => ({ consolidation: port, logger: silentLogger, newRunId: () => newKgId("csl") });
const udeps = () => ({ ...readDeps(), consolidation: port, newActionId: () => newKgId("act") });
const liveByStatement = async (statement: string) => (await personal()).claims.filter((c) => c.statement === statement);
const claimRow = async (id: string) => (await sql<{ status: string; revoked: boolean; revocation_reason: string | null }>(
  "SELECT status, revoked_at IS NOT NULL AS revoked, revocation_reason FROM claims WHERE id = $1", [id]))[0]!;
const evidenceOf = async (id: string) => (await sql<{ message_id: string; stance: string }>(
  "SELECT message_id, stance FROM claim_message_evidence WHERE claim_id = $1 ORDER BY message_id, stance", [id]));
const turnConflict = async (threadId: string) => {
  const t = await getTurnMemory(readDeps(), { userId: ME, orgId: ORG_ID, threadId, messageId: answers[threadId]! });
  return t.prompt?.type === "conflict" ? t.prompt.conflict : null;
};

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  await resetOrgs(ORG);
  const fx = await seedOrg({ orgId: ORG, projectId: `${ORG}-p` });
  await enableExtraction(ORG);
  for (const u of [ME, OTHER]) await addOrgMember(ORG, u, "consultant", fx.teams.energy!);
  for (const id of Object.values(T)) await addChatThread({ orgId: ORG, id, projectId: null, visibilityScope: "private", createdBy: ME });
  db = new PgDatabase(appConfig());
  hdeps = {
    repo: new PgIdentityRepository(db), ids: new CountingDecisionIdFactory(), chat: new PgChatRepository(db),
    knowledge: new PgKnowledgeRead(db, true), actions: new PgHumanAction(db), newId: newKgId,
  };
  xdeps = extractionDeps(db, MODEL.model, ORG);
  port = new PgKgConsolidation(db);

  // 四条话，各在本人的一个个人对话里说；每条后面跟一轮回答（冲突卡挂在「一轮」上）。
  for (const [threadId, body] of [
    [T.budget50, "项目A 预算定为 50 万"], [T.pref1, PREF_OLD], [T.budget60, "项目 A 预算定为 60 万"], [T.pref2, PREF_NEW],
  ] as const) {
    await say(threadId, body);
    answers[threadId] = await say(threadId, "好的，我记下了。", { agent: true });
  }
  // S9 的向量：两条偏好的个人副本各一条，余弦 0.96（嵌入服务在测试里不跑，直接按登记的模型写向量）。
  await sql("INSERT INTO embedding_models (model, model_version, dims) VALUES ($1, $2, 3) ON CONFLICT DO NOTHING", [EMB.model, EMB.modelVersion]);
  const vec: Record<string, string> = { [PREF_OLD]: "[1,0,0]", [PREF_NEW]: "[0.96,0.28,0]" };
  for (const [statement, v] of Object.entries(vec)) {
    const [c] = await sql<{ id: string }>(
      "SELECT id FROM claims WHERE org_id = $1 AND scope_kind = 'personal' AND scope_id = $2 AND statement = $3 AND revoked_at IS NULL", [ORG, ME, statement]);
    await sql(
      `INSERT INTO object_embeddings (org_id, target_kind, target_id, model, model_version, embedding)
       VALUES ($1, 'claim', $2, $3, $4, $5::vector) ON CONFLICT DO NOTHING`, [ORG, c!.id, EMB.model, EMB.modelVersion, v]);
  }
}, 300_000);

afterAll(async () => {
  await sql("SELECT kg_consolidation_set_enabled(false)");
  await db.close();
});

describe("#4365 整合前的前提（由真实抽取 + 自动记入产生）", () => {
  it("个人空间里：两条同义偏好各一条、两个写法不同的「项目A」、两条预算决定——都活着，没有冲突", async () => {
    const p = await personal();
    expect(p.claims.map((c) => c.statement).sort()).toEqual([PREF_OLD, PREF_NEW, "项目 A 预算定为 60 万", "项目A 预算定为 50 万"].sort());
    expect(p.objects.map((o) => o.name).sort()).toEqual(["项目 A", "项目A"]);
    expect(await turnConflict(T.budget60)).toBeNull();
  });

  it("开关默认关：pass 不跑（KG_CONSOLIDATION_DISABLED），也不在库里留任何运行", async () => {
    expect(await port.getEnabled()).toBe(false);
    await expect(runConsolidationPass(cdeps())).rejects.toMatchObject({ code: "KG_CONSOLIDATION_DISABLED" });
    expect(await sql("SELECT 1 FROM kg_consolidation_runs WHERE org_id = $1", [ORG])).toEqual([]);
  });

  it("开关打开后，本人出现在待整合名单里（只回 id）", async () => {
    expect(await port.setEnabled(true)).toBe(true);
    const pending = await port.pendingUsers(10_000);
    expect(pending).toContainEqual({ orgId: ORG_ID, userId: ME });
  });
});

describe("#4365 整合一次 + 撤销", () => {
  let runId = "";
  let keepPref = "";
  let mergedPref = "";

  it("合并同义偏好（来源全保留）、实体合一、矛盾开卡（不裁决）", async () => {
    const [older] = await liveByStatement(PREF_OLD);
    const [newer] = await liveByStatement(PREF_NEW);
    const evBefore = [...await evidenceOf(older!.id), ...await evidenceOf(newer!.id)];
    const r = await consolidateUser(cdeps(), { orgId: ORG_ID, userId: ME });
    runId = r.runId;
    expect(r).toMatchObject({ claimMerges: 1, entityMerges: 1, conflicts: 1, conflictsUnsurfaced: 0 });

    const p = await personal();
    // 偏好只剩一条：保留最早的那条；另一条软失效（行还在，原因可查）
    keepPref = older!.id;
    mergedPref = newer!.id;
    expect(p.claims.filter((c) => c.kind === "preference").map((c) => c.id)).toEqual([keepPref]);
    expect(await claimRow(mergedPref)).toEqual({ status: "superseded", revoked: true, revocation_reason: "consolidated_duplicate" });
    // 两条的消息证据都在保留的那条上；两条会话结论都是它的 derived_from 来源
    expect((await evidenceOf(keepPref)).map((e) => e.message_id).sort()).toEqual(evBefore.map((e) => e.message_id).sort());
    const sources = await sql<{ dst_id: string }>(
      "SELECT dst_id FROM ontology_edges WHERE src_id = $1 AND relation = 'derived_from' AND status = 'active'", [keepPref]);
    expect(sources).toHaveLength(2);

    // 实体合一：只剩「项目A」，「项目 A」成了别名；两条预算决定都指向它
    expect(p.objects.map((o) => [o.name, o.aliases])).toEqual([["项目A", ["项目 A"]]]);

    // 矛盾：两条决定都活着；卡的一对是「说 60 万那个对话里的会话结论 ↔ 旧的个人记忆（50 万）」，与 F16 自己开的卡同构——
    // 这两条转「有矛盾」，60 万的个人副本不动（人在卡上选了之后按 F16 的出口处理）
    const decisions = new Map(p.claims.filter((c) => c.kind === "decision").map((c) => [c.statement, c.status]));
    expect(Object.fromEntries(decisions)).toEqual({ "项目A 预算定为 50 万": "contested", "项目 A 预算定为 60 万": "proposed" });
    const card = await turnConflict(T.budget60);
    expect(card).toMatchObject({ kind: "conflict", newerClaim: { statement: "项目 A 预算定为 60 万" }, olderClaim: { statement: "项目A 预算定为 50 万" } });

    // 审计：本人个人空间留了 consolidateMemory；运行与三处改动都在
    const acts = await sql<{ action_type: string; actor_id: string }>(
      "SELECT action_type, actor_id FROM ontology_actions WHERE org_id = $1 AND scope_kind = 'personal' AND scope_id = $2 AND payload->>'run_id' = $3",
      [ORG, ME, runId]);
    expect(acts.map((a) => a.action_type)).toEqual(expect.arrayContaining(["consolidateMemory"]));
    expect(acts.every((a) => a.actor_id === "kg-consolidator")).toBe(true);
  });

  it("本人的整合记录：一条运行、三处改动、两边的文字；别人看不到", async () => {
    const runs = await listMyConsolidationRuns(udeps(), { userId: ME, orgId: ORG_ID }, KG.KG_CONSOLIDATION_RUNS_LIMIT);
    expect(KG.knowledgeGraph.listMyConsolidationRuns.out.safeParse({ runs }).success).toBe(true);
    expect(runs).toHaveLength(1);
    expect(runs[0]!.changes.map((c) => [c.kind, c.kept.text, c.other.text, c.state])).toEqual([
      ["entity_merge", "项目A", "项目 A", "applied"],
      ["claim_merge", PREF_OLD, PREF_NEW, "applied"],
      ["conflict_opened", "项目A 预算定为 50 万", "项目 A 预算定为 60 万", "applied"],
    ]);
    expect(await listMyConsolidationRuns(udeps(), { userId: OTHER, orgId: ORG_ID }, KG.KG_CONSOLIDATION_RUNS_LIMIT)).toEqual([]);
  });

  it("别人撤不动（同一个 NOT_FOUND，不泄露存在性）；数据库函数没声明本人也拒", async () => {
    await expect(undoMyConsolidationRun(udeps(), { userId: OTHER, orgId: ORG_ID }, runId))
      .rejects.toMatchObject({ code: "KG_CONSOLIDATION_RUN_NOT_FOUND" });
    await expect(db.withTenant(ORG_ID, (s) => s.query("SELECT kg_consolidation_candidates($1, 10)", [ME])))
      .rejects.toThrow(/KG_NOT_OWNER/);
  });

  it("撤销：偏好恢复成两条（各自的来源各归各）、实体拆回、卡撤回、状态复原；审计留人的动作", async () => {
    const run = await undoMyConsolidationRun(udeps(), { userId: ME, orgId: ORG_ID }, runId);
    expect(run.state).toBe("undone");
    expect(run.changes.map((c) => c.state)).toEqual(["undone", "undone", "undone"]);

    const p = await personal();
    expect(p.claims.filter((c) => c.kind === "preference").map((c) => c.statement).sort()).toEqual([PREF_OLD, PREF_NEW].sort());
    expect(await claimRow(mergedPref)).toMatchObject({ revoked: false, revocation_reason: null });
    expect(await evidenceOf(keepPref)).toHaveLength(1);
    expect(await evidenceOf(mergedPref)).toHaveLength(1);
    expect(p.objects.map((o) => [o.name, o.aliases]).sort()).toEqual([["项目 A", []], ["项目A", []]]);
    expect(p.claims.filter((c) => c.kind === "decision").map((c) => c.status)).toEqual(["proposed", "proposed"]);
    expect(await turnConflict(T.budget60)).toBeNull();
    const [contra] = await sql<{ n: number }>(
      "SELECT count(*)::int AS n FROM claim_message_evidence WHERE org_id = $1 AND stance = 'contradicting'", [ORG]);
    expect(contra!.n).toBe(0);
    const acts = await sql<{ actor_kind: string; actor_id: string }>(
      "SELECT actor_kind, actor_id FROM ontology_actions WHERE org_id = $1 AND action_type = 'undoConsolidation' AND payload->>'run_id' = $2", [ORG, runId]);
    expect(acts).toEqual([{ actor_kind: "human", actor_id: ME }]);
  });

  it("撤销过的再撤 ⇒ NOT_FOUND，什么都不变", async () => {
    await expect(undoMyConsolidationRun(udeps(), { userId: ME, orgId: ORG_ID }, runId))
      .rejects.toBeInstanceOf(KgConsolidationError);
  });

  it("#4491 H1：撤销要粘住——撤销后再跑一轮整合（updated_at 前进，人又被选中）⇒ 0 处合并、0 张卡", async () => {
    expect(await port.pendingUsers(10_000)).toContainEqual({ orgId: ORG_ID, userId: ME });
    const pass = await runConsolidationPass(cdeps(), 10_000);
    expect(pass).toMatchObject({ claimMerges: 0, entityMerges: 0, conflicts: 0, failedUsers: 0 });
    const p = await personal();
    expect(p.claims.filter((c) => c.kind === "preference").map((c) => c.statement).sort()).toEqual([PREF_OLD, PREF_NEW].sort());
    expect(p.objects.map((o) => o.name).sort()).toEqual(["项目 A", "项目A"]);
    expect(await turnConflict(T.budget60)).toBeNull();
  });

  it("新的一对矛盾照常开卡；人先在卡上选了「两条都留」再撤销 ⇒ 卡那一处 undo_skipped（写明原因），再撤 ⇒ NOT_FOUND", async () => {
    await say(T.b10, "项目B 预算定为 10 万");
    answers[T.b10] = await say(T.b10, "好的，我记下了。", { agent: true });
    await say(T.b20, "项目B 预算定为 20 万");
    answers[T.b20] = await say(T.b20, "好的，我记下了。", { agent: true });
    const r = await consolidateUser(cdeps(), { orgId: ORG_ID, userId: ME });
    expect(r).toMatchObject({ claimMerges: 0, entityMerges: 0, conflicts: 1 });
    const card = await turnConflict(T.b20);
    expect(card?.newerClaim.statement).toBe("项目B 预算定为 20 万");
    const k = await getThreadKnowledge(readDeps(), { userId: ME, orgId: ORG_ID, threadId: T.b20 });
    await applyHumanAction(hdeps, {
      userId: ME, orgId: ORG_ID, threadId: T.b20, basedOnRevision: k.revision,
      action: { type: "resolveConflict", promptId: card!.promptId, resolution: "keep_both" },
    });
    const run = await undoMyConsolidationRun(udeps(), { userId: ME, orgId: ORG_ID }, r.runId);
    expect(run.state).toBe("partially_undone");
    expect(run.changes.map((c) => [c.kind, c.state])).toEqual([["conflict_opened", "undo_skipped"]]);
    expect(run.changes[0]!.undoNote).toContain("已经处理过");
    // 人的裁决留着：旧的那条「你确认过」（keep_both），没有被撤销拨回
    const decisions = new Map((await personal()).claims.filter((c) => c.kind === "decision").map((c) => [c.statement, c.status]));
    expect(decisions.get("项目B 预算定为 10 万")).toBe("accepted");
    await expect(undoMyConsolidationRun(udeps(), { userId: ME, orgId: ORG_ID }, r.runId))
      .rejects.toMatchObject({ code: "KG_CONSOLIDATION_RUN_NOT_FOUND" });
  });
});

describe("#4491 M1：保留方自己没有支撑证据时不合并；撤销不把保留方的支撑撤空", () => {
  let older = "";
  let newer = "";
  let runId = "";

  beforeAll(async () => {
    await say(T.h1, HABIT_OLD);
    await say(T.h2, HABIT_NEW);
    for (const [statement, v] of [[HABIT_OLD, "[0,1,0]"], [HABIT_NEW, "[0,0.97,0.243]"]] as const) {
      const [c] = await sql<{ id: string }>(
        "SELECT id FROM claims WHERE org_id = $1 AND scope_kind = 'personal' AND scope_id = $2 AND statement = $3 AND revoked_at IS NULL", [ORG, ME, statement]);
      await sql(
        `INSERT INTO object_embeddings (org_id, target_kind, target_id, model, model_version, embedding)
         VALUES ($1, 'claim', $2, $3, $4, $5::vector) ON CONFLICT DO NOTHING`, [ORG, c!.id, EMB.model, EMB.modelVersion, v]);
      if (statement === HABIT_OLD) older = c!.id; else newer = c!.id;
    }
  }, 300_000);

  it("保留方（较早那条）的支撑证据不在了 ⇒ 这一对不合（否则撤销时 F07 会把保留方收掉）", async () => {
    // 模拟「保留方自己没有支撑」：把它的支撑证据改成反对（UPDATE 不触发 F07 的删除触发器，它仍活着）
    await sql("UPDATE claim_message_evidence SET stance = 'contradicting' WHERE claim_id = $1 AND stance = 'supporting'", [older]);
    const r = await consolidateUser(cdeps(), { orgId: ORG_ID, userId: ME });
    expect(r.claimMerges).toBe(0);
    expect((await claimRow(newer)).revoked).toBe(false);
    await sql("UPDATE claim_message_evidence SET stance = 'supporting' WHERE claim_id = $1 AND stance = 'contradicting'", [older]);
  });

  it("有支撑时照常合并；之后保留方自己的原话证据没了，再撤销 ⇒ 复制来的支撑留着，保留方不被 F07 收掉", async () => {
    const r = await consolidateUser(cdeps(), { orgId: ORG_ID, userId: ME });
    expect(r.claimMerges).toBe(1);
    runId = r.runId;
    const own = (await evidenceOf(older)).filter((e) => e.stance === "supporting").map((e) => e.message_id);
    expect(own.length).toBeGreaterThanOrEqual(2);
    const [mine] = await sql<{ message_id: string }>(
      "SELECT e.message_id FROM claim_message_evidence e JOIN chat_messages m ON m.id = e.message_id WHERE e.claim_id = $1 AND m.thread_id = $2", [older, T.h1]);
    await sql("DELETE FROM claim_message_evidence WHERE claim_id = $1 AND message_id = $2", [older, mine!.message_id]);
    expect((await claimRow(older)).revoked).toBe(false);
    const run = await undoMyConsolidationRun(udeps(), { userId: ME, orgId: ORG_ID }, runId);
    expect(run.state).toBe("undone");
    expect(await claimRow(older)).toMatchObject({ revoked: false });
    expect(await claimRow(newer)).toMatchObject({ revoked: false });
  });

  it("#4491 L3：按 id 读回一次较早的整理，不受「最近 N 条」上限影响", async () => {
    const latestOnly = await listMyConsolidationRuns(udeps(), { userId: ME, orgId: ORG_ID }, 1);
    const all = await listMyConsolidationRuns(udeps(), { userId: ME, orgId: ORG_ID }, 20);
    const oldest = all.at(-1)!;
    expect(latestOnly[0]!.runId).not.toBe(oldest.runId);
    const byId = await listMyConsolidationRuns(udeps(), { userId: ME, orgId: ORG_ID }, 1, oldest.runId);
    expect(byId.map((r) => r.runId)).toEqual([oldest.runId]);
  });
});

describe("#4365 抽取 SLO：卡住的租约是数据库现数，平台接口给出三个指标与告警", () => {
  it("一行租约过期未完成 ⇒ stuckLeases ≥ 1；平台接口形状合契约、带告警", async () => {
    const counts = new PgKgExtractionSloCounts(db);
    const before = await counts.counts();
    const id = `m-s8-${String(++seq)}`;
    await addChatMessage({ orgId: ORG, id, threadId: T.slo, body: "项目C 周五交付", authorId: ME });
    // 模拟 worker 认领后崩了：租约早已过期；下一次重试排在一天后（本文件的 tick 不会去认领它）
    await sql(
      "UPDATE kg_extraction_queue SET locked_at = now() - interval '1 hour', attempts = 1, next_attempt_at = now() + interval '1 day' WHERE message_id = $1", [id]);
    const after = await counts.counts();
    expect(after.stuckLeases).toBeGreaterThanOrEqual(before.stuckLeases + 1);

    const recorder = new ExtractionSloRecorder();
    recorder.recordJob(120, "written");
    recorder.recordJob(80, "failed");
    const ctl = new PlatformMemoryOpsController(recorder, counts, EXTRACTION_SLO_DEFAULTS, port, silentLogger as never, null);
    const out = await ctl.extractionSlo({ userId: "platform-op", orgId: ORG_ID });
    expect(KG.knowledgeGraph.getPlatformExtractionSlo.out.safeParse(out).success).toBe(true);
    expect(out).toMatchObject({ processed: 2, modelJobs: 2, failed: 1, p95LatencyMs: 120, failureRate: 0.5 });
    expect(out.stuckLeases).toBeGreaterThanOrEqual(1);
    expect(out.alerts).toContainEqual(expect.objectContaining({ metric: "stuck_leases", threshold: 0 }));
    await sql("DELETE FROM kg_extraction_queue WHERE message_id = $1", [id]);
  });

  it("开关：平台接口读写同一行；关着时「现在整合一次」⇒ 409 KG_CONSOLIDATION_DISABLED", async () => {
    const fake: KgConsolidationPort = Object.assign(Object.create(port) as KgConsolidationPort, { getEnabled: async () => false });
    const ctl = new PlatformMemoryOpsController(new ExtractionSloRecorder(), new PgKgExtractionSloCounts(db), EXTRACTION_SLO_DEFAULTS, fake, silentLogger as never, null);
    await expect(ctl.runNow({ userId: "platform-op", orgId: ORG_ID })).rejects.toMatchObject({ status: 409 });
    const real = new PlatformMemoryOpsController(new ExtractionSloRecorder(), new PgKgExtractionSloCounts(db), EXTRACTION_SLO_DEFAULTS, port, silentLogger as never, null);
    expect(await real.setConsolidation({ userId: "platform-op", orgId: ORG_ID }, { enabled: false })).toEqual({ enabled: false });
    expect(await real.getConsolidation({ userId: "platform-op", orgId: ORG_ID })).toEqual({ enabled: false });
  });
});
