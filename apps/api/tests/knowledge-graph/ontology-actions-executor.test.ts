/**
 * Phase 18 F03 —— 执行器主路径：一批候选经执行器落表，审计里有 accepted 记录；
 * 被拒的批次不落表，审计里有 rejected 记录和原因；同一源同一版本重复执行不重复写（I-7）。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyOntologyBatch } from "../../src/application/knowledge-graph/apply-ontology-batch";
import { toOrgId } from "../../src/domain/org-id";
import { appConfig } from "../../src/infrastructure/db/pg-config";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { PgOntologyStore } from "../../src/infrastructure/knowledge-graph/pg-ontology-store";
import { asApp } from "../support/db";
import { modelBatch, seedKgOrg } from "./kg-fixtures";

const ORG = "org-kg-f03-exec";
const ORG_ID = toOrgId(ORG);
let db: PgDatabase;
let store: PgOntologyStore;
let seg: string;

beforeAll(async () => {
  ({ segments: [seg] } = await seedKgOrg(ORG));
  db = new PgDatabase(appConfig());
  store = new PgOntologyStore(db);
});
afterAll(async () => { await db.close(); });

const count = (table: string, idLike: string) =>
  asApp(ORG, (c) => c.query<{ n: string }>(`SELECT count(*)::text AS n FROM ${table} WHERE id LIKE $1`, [idLike]))
    .then((r) => Number(r.rows[0]!.n));

const action = (id: string) =>
  asApp(ORG, (c) => c.query<{ outcome: string; reject_code: string | null; reject_reason: string | null; actor_kind: string }>(
    "SELECT outcome, reject_code, reject_reason, actor_kind FROM ontology_actions WHERE id = $1", [id],
  )).then((r) => r.rows[0]);

describe("F03: 执行器主路径", () => {
  it("模型抽取的一批候选落表：实体、proposed 结论 + 证据、边、一条 accepted 审计", async () => {
    const b = modelBatch(ORG, seg);
    const out = await applyOntologyBatch(store, ORG_ID, null, b);
    expect(out).toEqual({ outcome: "accepted", applied: { actionId: b.actionId, deduplicated: false, objects: 1, claims: 1, edges: 1 } });

    const rows = await asApp(ORG, async (c) => ({
      obj: (await c.query("SELECT scope_kind, scope_id, created_by, name, aliases FROM ontology_objects WHERE id = $1", [b.objects[0]!.id])).rows[0],
      claim: (await c.query("SELECT status, created_by, reviewed_by, claim_kind, scope_kind, tsv <> ''::tsvector AS indexed FROM claims WHERE id = $1", [b.claims[0]!.id])).rows[0],
      ev: (await c.query("SELECT segment_id, stance FROM claim_segments WHERE claim_id = $1", [b.claims[0]!.id])).rows,
      edge: (await c.query("SELECT relation, created_by, status FROM ontology_edges WHERE id = $1", [b.edges[0]!.id])).rows[0],
    }));
    expect(rows.obj).toMatchObject({ scope_kind: "chat_session", scope_id: `thread-${ORG}`, created_by: "model", name: "张三", aliases: ["老张"] });
    expect(rows.claim).toMatchObject({ status: "proposed", created_by: "model", reviewed_by: null, claim_kind: "decision", scope_kind: "chat_session", indexed: true });
    expect(rows.ev).toEqual([{ segment_id: seg, stance: "supporting" }]);
    expect(rows.edge).toMatchObject({ relation: "decided_by", created_by: "model", status: "active" });
    expect(await action(b.actionId)).toMatchObject({ outcome: "accepted", reject_code: null, actor_kind: "model" });
  });

  it("I-7 幂等：同一源、同一流水线版本再跑一次，行数不变，返回 deduplicated", async () => {
    const first = modelBatch(ORG, seg);
    await applyOntologyBatch(store, ORG_ID, null, first);
    const again = { ...modelBatch(ORG, seg), sourceRef: first.sourceRef, pipelineVersion: first.pipelineVersion };
    const out = await applyOntologyBatch(store, ORG_ID, null, again);
    expect(out).toEqual({ outcome: "accepted", applied: { actionId: first.actionId, deduplicated: true, objects: 0, claims: 0, edges: 0 } });
    expect(await count("claims", again.claims[0]!.id)).toBe(0);
    expect(await count("ontology_actions", again.actionId)).toBe(0);
  });

  it("流水线版本变了 ⇒ 不算重复，重新处理", async () => {
    const first = modelBatch(ORG, seg);
    await applyOntologyBatch(store, ORG_ID, null, first);
    const v2 = { ...modelBatch(ORG, seg), sourceRef: first.sourceRef, pipelineVersion: "kg-extract@2" };
    const out = await applyOntologyBatch(store, ORG_ID, null, v2);
    expect(out.outcome).toBe("accepted");
    expect(await count("claims", v2.claims[0]!.id)).toBe(1);
  });

  it("被拒的批次：一行都不落，审计里记 rejected + 原因", async () => {
    const b = modelBatch(ORG, seg, { scope: { kind: "project", id: `${ORG}-p` } });
    const out = await applyOntologyBatch(store, ORG_ID, null, b);
    expect(out).toMatchObject({ outcome: "rejected", rejected: { code: "KG_SCOPE_NOT_ENABLED" } });
    expect(await count("ontology_objects", b.objects[0]!.id)).toBe(0);
    expect(await count("claims", b.claims[0]!.id)).toBe(0);
    const a = await action(b.actionId);
    expect(a).toMatchObject({ outcome: "rejected", reject_code: "KG_SCOPE_NOT_ENABLED" });
    expect(a!.reject_reason).toMatch(/project/);
  });

  it("批内任一条不合格 ⇒ 整批不落（同一事务），不会留下半批", async () => {
    const good = modelBatch(ORG, seg);
    const b = { ...good, claims: [...good.claims, { ...good.claims[0]!, id: `${good.claims[0]!.id}-bad`, evidence: [{ segmentId: "seg-does-not-exist", stance: "supporting" as const }] }] };
    const out = await applyOntologyBatch(store, ORG_ID, null, b);
    expect(out).toMatchObject({ outcome: "rejected", rejected: { code: "KG_EVIDENCE_NOT_FOUND" } });
    expect(await count("ontology_objects", good.objects[0]!.id)).toBe(0);
    expect(await count("claims", `${good.claims[0]!.id}%`)).toBe(0);
    expect(await action(b.actionId)).toMatchObject({ outcome: "rejected", reject_code: "KG_EVIDENCE_NOT_FOUND" });
  });

  it("人工动作可以直接写 accepted，reviewed_by 记为本人", async () => {
    const b = modelBatch(ORG, seg, { actor: { kind: "human", id: "u-owner" }, actionType: "remember", sourceRef: null, pipelineVersion: null });
    const human = { ...b, claims: b.claims.map((c) => ({ ...c, status: "accepted" as const })) };
    const out = await applyOntologyBatch(store, ORG_ID, "u-owner", human);
    expect(out.outcome).toBe("accepted");
    const row = await asApp(ORG, (c) => c.query("SELECT status, created_by, reviewed_by FROM claims WHERE id = $1", [human.claims[0]!.id]));
    expect(row.rows[0]).toEqual({ status: "accepted", created_by: "human", reviewed_by: "u-owner" });
  });
});
