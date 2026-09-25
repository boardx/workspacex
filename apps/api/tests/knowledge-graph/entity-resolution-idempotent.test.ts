/**
 * Phase 18 F06 —— 实体解析与幂等（uc-18-1 V2 / S3）。
 *
 * - 同一条消息被触发三次：实体 / 结论 / 边的行数不变（幂等键 = 消息 id + 流水线版本）。
 * - 后一条消息用别名「老张」提到同一个人：解析到同一个实体，不新建。
 * - 另一个会话里的「张三」是另一个实体（作用域不同，I-1）。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runExtractionTick } from "../../src/application/knowledge-graph/extract-message-knowledge";
import { normalizeName, resolveEntity } from "../../src/domain/knowledge-graph/extraction";
import { appConfig } from "../../src/infrastructure/db/pg-config";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { addChatMessage } from "../support/chat-db";
import { asApp, asOwner } from "../support/db";
import { ZHANG_DECIDES, extractionDeps, loopbackModel, seedThread } from "./kg-extraction-fixtures";

const ORG = "org-kg-f06-resolve";
const T1 = "thr-kg-f06r-1";
const T2 = "thr-kg-f06r-2";
let db: PgDatabase;

const LAOZHANG_RISK = JSON.stringify({
  entities: [{ name: "老张", kind: "person", aliases: [] }],
  claims: [{ statement: "张三担心下周一上线时间太紧", kind: "risk", confidence: 0.7, about: ["老张"], decidedBy: null, quote: "老张担心时间太紧" }],
});

beforeAll(async () => {
  await seedThread(ORG, [T1, T2]);
  db = new PgDatabase(appConfig());
});
afterAll(async () => { await db.close(); });

const counts = () => asApp(ORG, async (c) => {
  const n = async (sql: string) => Number((await c.query<{ n: string }>(sql, [ORG])).rows[0]!.n);
  return {
    objects: await n("SELECT count(*)::text AS n FROM ontology_objects WHERE org_id = $1"),
    claims: await n("SELECT count(*)::text AS n FROM claims WHERE org_id = $1 AND scope_kind IS NOT NULL"),
    edges: await n("SELECT count(*)::text AS n FROM ontology_edges WHERE org_id = $1 AND scope_kind IS NOT NULL"),
    evidence: await n("SELECT count(*)::text AS n FROM claim_message_evidence WHERE org_id = $1"),
  };
});

const reenqueue = (messageId: string, threadId: string) =>
  asOwner((c) => c.query(
    "INSERT INTO kg_extraction_queue (message_id, org_id, thread_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING",
    [messageId, ORG, threadId],
  ));

describe("F06: 实体解析 + 幂等", () => {
  const { model } = loopbackModel([["张三决定", ZHANG_DECIDES], ["老张担心", LAOZHANG_RISK]]);

  it("同一条消息触发三次，行数差为 0", async () => {
    await addChatMessage({ orgId: ORG, id: "m-r-1", threadId: T1, body: "张三决定下周一上线 v2", authorId: "u-owner" });
    await runExtractionTick(extractionDeps(db, model, ORG));
    const first = await counts();
    expect(first).toEqual({ objects: 2, claims: 1, edges: 2, evidence: 1 });
    for (let i = 0; i < 2; i += 1) {
      await reenqueue("m-r-1", T1);
      await runExtractionTick(extractionDeps(db, model, ORG));
    }
    expect(await counts()).toEqual(first);
  });

  it("后一条消息用别名「老张」：解析到同一个「张三」，只新增结论与边", async () => {
    await addChatMessage({ orgId: ORG, id: "m-r-2", threadId: T1, body: "不过老张担心时间太紧", authorId: "u-owner" });
    await runExtractionTick(extractionDeps(db, model, ORG));
    const people = await asApp(ORG, (c) => c.query<{ id: string }>(
      "SELECT id FROM ontology_objects WHERE scope_id = $1 AND object_kind = 'person'", [T1]));
    expect(people.rows).toHaveLength(1);
    const risk = await asApp(ORG, (c) => c.query<{ dst_id: string }>(
      `SELECT e.dst_id FROM claims c JOIN ontology_edges e ON e.src_id = c.id WHERE c.scope_id = $1 AND c.claim_kind = 'risk'`, [T1]));
    expect(risk.rows.map((r) => r.dst_id)).toEqual([people.rows[0]!.id]);
  });

  it("另一个会话里的「张三」是另一个实体（作用域不同）", async () => {
    await addChatMessage({ orgId: ORG, id: "m-r-3", threadId: T2, body: "张三决定下周一上线 v2", authorId: "u-owner" });
    await runExtractionTick(extractionDeps(db, model, ORG));
    const r = await asApp(ORG, (c) => c.query<{ scope_id: string }>(
      "SELECT scope_id FROM ontology_objects WHERE name = '张三' ORDER BY scope_id"));
    expect(r.rows.map((x) => x.scope_id)).toEqual([T1, T2]);
  });

  it("名字归一：全角 / 大小写 / 多余空白视为同名", () => {
    expect(normalizeName("  Ｖ2  ")).toBe(normalizeName("v2"));
    const known = [{ id: "o1", name: "Acme Corp", aliases: [], kind: "organization" as const }];
    expect(resolveEntity({ name: "acme  corp", kind: "product", aliases: [] }, known)?.id).toBe("o1");
    expect(resolveEntity({ name: "Globex", kind: "organization", aliases: [] }, known)).toBeNull();
  });
});
