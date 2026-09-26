/**
 * Phase 18 F06 —— 抽取 Agent：消息 → 实体 / 结论 / 关系 / 证据，经执行器入图。
 *
 * uc-18-1 V1：「张三决定下周一上线 v2」⇒ 本会话出现实体「张三」「v2」与一条 decision 结论，
 * 结论挂着回指该消息的证据；纯寒暄不产生候选也不报错。模型用回环实现（按消息内容回固定 JSON），
 * 队列 / 数据源 / 执行器全是真实实现、真实数据库。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runExtractionTick } from "../../src/application/knowledge-graph/extract-message-knowledge";
import { parseExtraction } from "../../src/domain/knowledge-graph/extraction";
import { appConfig } from "../../src/infrastructure/db/pg-config";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { readKgExtractionModelConfig } from "../../src/infrastructure/knowledge-graph/kg-extraction-model-config";
import { PgKgExtraction } from "../../src/infrastructure/knowledge-graph/pg-kg-extraction";
import { toBatchPayload } from "../../src/infrastructure/knowledge-graph/pg-ontology-store";
import { toOrgId } from "../../src/domain/org-id";
import { addChatMessage, addChatThread } from "../support/chat-db";
import { asApp, asOwner } from "../support/db";
import { ZHANG_DECIDES, extractionDeps, loopbackModel, seedThread } from "./kg-extraction-fixtures";

const ORG = "org-kg-f06-extract";
const T1 = "thr-kg-f06-1";
const T2 = "thr-kg-f06-2";
let db: PgDatabase;

beforeAll(async () => {
  await seedThread(ORG, [T1, T2]);
  db = new PgDatabase(appConfig());
});
afterAll(async () => { await db.close(); });

const q = <R extends Record<string, unknown>>(sql: string, params: unknown[] = []) =>
  asApp(ORG, (c) => c.query<R>(sql, params)).then((r) => r.rows);

describe("F06: 抽取 Agent", () => {
  it("消息落库即排队（触发器，同一事务）；原始转录不排队", async () => {
    await addChatMessage({ orgId: ORG, id: "m-queue-1", threadId: T1, body: "随便说点什么", authorId: "u-owner" });
    await addChatMessage({ orgId: ORG, id: "m-queue-raw", threadId: T1, body: "转录片段", authorId: "u-owner", rawTranscript: true });
    const rows = await q<{ message_id: string }>("SELECT message_id FROM kg_extraction_queue WHERE message_id LIKE 'm-queue-%' ORDER BY 1");
    expect(rows.map((r) => r.message_id)).toEqual(["m-queue-1"]);
    await runExtractionTick(extractionDeps(db, loopbackModel([]).model, ORG));  // 清掉
  });

  it("「张三决定下周一上线 v2」⇒ 张三（人物）、v2（产品）、一条 decision 结论，证据回指这条消息", async () => {
    const { model, calls } = loopbackModel([["张三决定", ZHANG_DECIDES]]);
    await addChatMessage({ orgId: ORG, id: "m-zhang", threadId: T1, body: "那就这样，张三决定下周一上线 v2。", authorId: "u-owner" });
    const r = await runExtractionTick(extractionDeps(db, model, ORG));
    expect(r).toMatchObject({ written: 1, failed: 0 });
    expect(calls.at(-1)!.system).toContain("知识抽取器");
    expect(calls.at(-1)!.threadId).toBeUndefined();  // 独立调用，不写进会话历史

    const objects = await q<{ name: string; object_kind: string; created_by: string }>(
      "SELECT name, object_kind, created_by FROM ontology_objects WHERE scope_id = $1 ORDER BY name", [T1]);
    expect(objects).toEqual([
      { name: "v2", object_kind: "product", created_by: "model" },
      { name: "张三", object_kind: "person", created_by: "model" },
    ]);
    const [claim] = await q<{ id: string; claim_kind: string; status: string; statement: string }>(
      "SELECT id, claim_kind, status, statement FROM claims WHERE scope_id = $1", [T1]);
    expect(claim).toMatchObject({ claim_kind: "decision", status: "proposed", statement: "张三决定下周一上线 v2" });
    const ev = await q("SELECT message_id, stance, excerpt FROM claim_message_evidence WHERE claim_id = $1", [claim!.id]);
    expect(ev).toEqual([{ message_id: "m-zhang", stance: "supporting", excerpt: "张三决定下周一上线 v2" }]);
    const edges = await q<{ relation: string; name: string }>(
      `SELECT e.relation, o.name FROM ontology_edges e JOIN ontology_objects o ON o.id = e.dst_id
        WHERE e.src_id = $1 ORDER BY e.relation`, [claim!.id]);
    expect(edges).toEqual([{ relation: "about", name: "v2" }, { relation: "decided_by", name: "张三" }]);
    expect(await q("SELECT 1 FROM kg_extraction_queue WHERE message_id = 'm-zhang'")).toHaveLength(0);
    const audit = await q("SELECT outcome, actor_kind, source_ref FROM ontology_actions WHERE source_ref = 'm-zhang'");
    expect(audit).toEqual([{ outcome: "accepted", actor_kind: "model", source_ref: "m-zhang" }]);
  });

  it("纯寒暄：不产生候选、不报错、出队", async () => {
    const before = await q("SELECT 1 FROM ontology_objects WHERE scope_id = $1", [T2]);
    await addChatMessage({ orgId: ORG, id: "m-hello", threadId: T2, body: "你好呀，辛苦了！", authorId: "u-owner" });
    const r = await runExtractionTick(extractionDeps(db, loopbackModel([]).model, ORG));
    expect(r).toMatchObject({ written: 0, failed: 0 });
    expect(await q("SELECT 1 FROM ontology_objects WHERE scope_id = $1", [T2])).toHaveLength(before.length);
    expect(await q("SELECT 1 FROM kg_extraction_queue WHERE message_id = 'm-hello'")).toHaveLength(0);
  });

  it("模型回了解析不出的东西：当作没有可记的，不重试", async () => {
    await addChatMessage({ orgId: ORG, id: "m-garbage", threadId: T2, body: "乱码测试 xyz", authorId: "u-owner" });
    const r = await runExtractionTick(extractionDeps(db, loopbackModel([["乱码测试", "抱歉我不太明白"]]).model, ORG));
    expect(r).toMatchObject({ written: 0, failed: 0 });
    expect(await q("SELECT 1 FROM kg_extraction_queue WHERE message_id = 'm-garbage'")).toHaveLength(0);
  });

  it("模型调用失败：任务保留、记原因、稍后重试；三次后不再认领", async () => {
    await addChatMessage({ orgId: ORG, id: "m-fail", threadId: T2, body: "模型会挂的消息", authorId: "u-owner" });
    const deps = extractionDeps(db, loopbackModel([["模型会挂", new Error("provider down")]]).model, ORG);
    expect(await runExtractionTick(deps)).toMatchObject({ failed: 1 });
    const [row] = await q<{ attempts: number; last_error: string; locked_at: Date | null; backoff: boolean }>(
      "SELECT attempts, last_error, locked_at, next_attempt_at > now() + interval '20 seconds' AS backoff FROM kg_extraction_queue WHERE message_id = 'm-fail'");
    expect(row).toMatchObject({ attempts: 1, last_error: "provider down", locked_at: null, backoff: true });
    // 退避期内不会被再次认领（三次机会不会挤在连续的轮询里用光）
    expect(await runExtractionTick(deps)).toMatchObject({ processed: 0 });
    const due = () => asOwner((c) => c.query("UPDATE kg_extraction_queue SET next_attempt_at = now() WHERE message_id = 'm-fail'"));
    await due();
    await runExtractionTick(deps);
    await due();
    await runExtractionTick(deps);
    await due();
    expect(await runExtractionTick(deps)).toMatchObject({ processed: 0 });
    expect((await q<{ attempts: number }>("SELECT attempts FROM kg_extraction_queue WHERE message_id = 'm-fail'"))[0]!.attempts).toBe(3);
  });

  it("消息证据只能来自同一个会话（跨会话的「证据」被执行器拒绝）", async () => {
    const payload = {
      actionId: "act-f06-cross", scope: { kind: "chat_session" as const, id: T2 }, actor: { kind: "model" as const, id: "kg" },
      actionType: "extract", sourceRef: null, pipelineVersion: null, objects: [], edges: [],
      claims: [{ id: "clm-f06-cross", claimKind: "fact" as const, statement: "x", status: "proposed" as const, confidence: 0.5,
        evidence: [{ messageId: "m-zhang", stance: "supporting" as const, excerpt: "x" }] }],
    };
    await expect(asApp(ORG, (c) => c.query("SELECT kg_apply_batch($1::jsonb)", [JSON.stringify(toBatchPayload(payload))])))
      .rejects.toThrow(/KG_EVIDENCE_NOT_FOUND/);
  });

  it("app_rw 不能直接写消息证据（只经执行器）", async () => {
    await expect(asApp(ORG, (c) => c.query(
      "INSERT INTO claim_message_evidence (claim_id, org_id, message_id, stance) VALUES ('x', $1, 'm-zhang', 'supporting')", [ORG],
    ))).rejects.toThrow(/permission denied/);
  });
});

describe("F06: 解析容错", () => {
  it("枚举外的类型、空名字、空结论逐项丢弃，其余保留；置信度夹到 [0,1]", () => {
    const r = parseExtraction({
      entities: [{ name: "张三", kind: "person" }, { name: "", kind: "person" }, { name: "火星", kind: "planet" }],
      claims: [
        { statement: "张三负责 v2", kind: "fact", confidence: 7, about: ["张三"] },
        { statement: "", kind: "fact" },
        { statement: "奇怪的", kind: "rumor" },
      ],
    });
    expect(r.entities.map((e) => e.name)).toEqual(["张三"]);
    expect(r.claims).toEqual([{ statement: "张三负责 v2", kind: "fact", confidence: 1, about: ["张三"], decidedBy: null, quote: "" }]);
    expect(parseExtraction("not an object")).toEqual({ entities: [], claims: [] });
  });
});

describe("F06: 开关", () => {
  /**
   * 用户直接交办更正（2026-09-25）：`enabled` 现在只回答「配置了模型 provider 没有」，
   * `KG_EXTRACTION_ENABLED` 已彻底退休——不管设不设、设成什么，都不再影响这个位。
   * 「要不要跑」搬到了 `KgDeploymentExtractionSettingsPort`（落库，见该端口 + 迁移
   * 20260925120000），不再是这个函数的职责。
   */
  it("只看配置了模型 provider 没有；KG_EXTRACTION_ENABLED 不再被读，设不设都不影响结果", () => {
    expect(readKgExtractionModelConfig({ KERNEL_MODEL_PROVIDER: "dashscope" }).enabled).toBe(true);
    expect(readKgExtractionModelConfig({ KERNEL_MODEL_PROVIDER: "dashscope", KG_EXTRACTION_ENABLED: "1" }).enabled).toBe(true);
    expect(readKgExtractionModelConfig({ KERNEL_MODEL_PROVIDER: "dashscope", KG_EXTRACTION_ENABLED: "0" }).enabled).toBe(true);
    expect(readKgExtractionModelConfig({}).enabled).toBe(false);
    expect(readKgExtractionModelConfig({ KG_EXTRACTION_ENABLED: "1" }).enabled).toBe(false);
    expect(readKgExtractionModelConfig({ KERNEL_MODEL_PROVIDER: "x", KERNEL_KG_EXTRACTION_MODEL_ID: "qwen-plus" }).modelId).toBe("qwen-plus");
  });
});

describe("F06 评审补强", () => {
  it("认领严格不超过 limit（统计信息过期 / 队列刚被清空后也一样）", async () => {
    await runExtractionTick(extractionDeps(db, loopbackModel([]).model, ORG));  // 清空本 org 队列
    await asOwner((c) => c.query("VACUUM ANALYZE kg_extraction_queue"));
    for (let i = 0; i < 40; i += 1) {
      await addChatMessage({ orgId: ORG, id: `m-bulk-${i}`, threadId: T2, body: `批量消息 ${i}`, authorId: "u-owner" });
    }
    const pg = new PgKgExtraction(db);
    expect((await pg.claim(toOrgId(ORG), 5)).length).toBe(5);
    await runExtractionTick(extractionDeps(db, loopbackModel([]).model, ORG));
    await asOwner((c) => c.query("UPDATE kg_extraction_queue SET locked_at = NULL WHERE org_id = $1", [ORG]));
    while ((await runExtractionTick(extractionDeps(db, loopbackModel([]).model, ORG))).processed > 0) { /* 排空 */ }
  });

  it("原话截断按字符：emoji 正好在第 280 个字符处，也能正常入图", async () => {
    const body = `${"x".repeat(279)}😀张三决定上线`;
    await addChatMessage({ orgId: ORG, id: "m-emoji", threadId: T2, body, authorId: "u-owner" });
    const reply = JSON.stringify({ entities: [], claims: [{ statement: "张三决定上线", kind: "decision", confidence: 0.5, about: [], decidedBy: null, quote: "不在原文里的摘录" }] });
    const r = await runExtractionTick(extractionDeps(db, loopbackModel([["张三决定上线", reply]]).model, ORG));
    expect(r).toMatchObject({ written: 1, failed: 0 });
    const [ev] = await q<{ excerpt: string }>("SELECT excerpt FROM claim_message_evidence WHERE message_id = 'm-emoji'");
    expect(Array.from(ev!.excerpt)).toHaveLength(280);
    expect(ev!.excerpt.endsWith("😀")).toBe(true);
  });

  it("抽取关着时不排队；消息自带更窄的可见范围时不排队", async () => {
    // 开关是全库的：在一个事务里关、插、查、回滚，并行跑的其他测试文件看不到「关着」的那一刻。
    const queuedWhileOff = await asOwner(async (c) => {
      await c.query("BEGIN");
      try {
        await c.query("UPDATE kg_extraction_state SET enabled = false");
        await c.query("SELECT set_config('app.current_org', $1, true)", [ORG]);
        await c.query(
          "INSERT INTO chat_messages (id, org_id, thread_id, author_kind, author_id, body) VALUES ('m-off', $1, $2, 'human', 'u-owner', '关着时说的话')",
          [ORG, T2],
        );
        return (await c.query("SELECT 1 FROM kg_extraction_queue WHERE message_id = 'm-off'")).rowCount;
      } finally {
        await c.query("ROLLBACK");
      }
    });
    expect(queuedWhileOff).toBe(0);
    await addChatMessage({ orgId: ORG, id: "m-narrow", threadId: T2, body: "只给组内看的话", authorId: "u-owner", visibilityScope: "member-private" });
    // 只有不换行空格 / 零宽空格 / BOM 的消息也算空白
    await addChatMessage({ orgId: ORG, id: "m-blank", threadId: T2, body: "\u00a0\u200b \ufeff\u3000\n", authorId: "u-owner" });
    expect(await q("SELECT 1 FROM kg_extraction_queue WHERE message_id IN ('m-narrow', 'm-blank')")).toHaveLength(0);
  });

  it("个人空间的消息证据只能来自本人的会话；摘录不是原话时由数据库换成原话", async () => {
    await addChatThread({ orgId: ORG, id: "thr-kg-f06-other", projectId: null, visibilityScope: "private", createdBy: "u-other" });
    await addChatMessage({ orgId: ORG, id: "m-others", threadId: "thr-kg-f06-other", body: "别人的私话", authorId: "u-other" });
    const batch = (messageId: string, excerpt: string, id: string) => ({
      actionId: `act-${id}`, scope: { kind: "personal" as const, id: "u-owner" }, actor: { kind: "human" as const, id: "u-owner" },
      actionType: "remember", sourceRef: null, pipelineVersion: null, objects: [], edges: [],
      claims: [{ id: `clm-${id}`, claimKind: "fact" as const, statement: "x", status: "accepted" as const, confidence: 1,
        evidence: [{ messageId, stance: "supporting" as const, excerpt }] }],
    });
    const asOwnerUser = (b: ReturnType<typeof batch>) => asApp(ORG, async (c) => {
      await c.query("SELECT set_config('app.current_user_id', 'u-owner', true)");
      return c.query("SELECT kg_apply_batch($1::jsonb)", [JSON.stringify(toBatchPayload(b))]);
    });
    await expect(asOwnerUser(batch("m-others", "别人的私话", "p1"))).rejects.toThrow(/KG_EVIDENCE_NOT_FOUND/);
    await asOwnerUser(batch("m-zhang", "我编的原话", "p2"));
    const ev = await asApp(ORG, async (c) => {
      await c.query("SELECT set_config('app.current_user_id', 'u-owner', true)");
      return c.query<{ excerpt: string }>("SELECT excerpt FROM claim_message_evidence WHERE claim_id = 'clm-p2'");
    });
    expect(ev.rows[0]!.excerpt).toBe("那就这样，张三决定下周一上线 v2。");
  });
});

