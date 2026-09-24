/**
 * Phase 18 F03 —— 执行器不变量，逐条从**绕过应用层**的方向打：
 * 数据库那一半必须自己挡住，不能指望调用方先跑过 `validateOntologyBatch`。
 *
 * - I-3 模型不直写：app_rw 直接 INSERT / UPDATE 带作用域的结论、边、证据 ⇒ KG_WRITE_OUTSIDE_EXECUTOR
 * - I-4 模型最高 proposed ⇒ KG_ACTOR_NOT_HUMAN
 * - I-5 必须挂证据 ⇒ KG_EVIDENCE_REQUIRED
 * - I-1 作用域白名单 ⇒ project / org / platform 返回 KG_SCOPE_NOT_ENABLED
 * - I-14 个人空间只有本人能写 ⇒ KG_NOT_OWNER
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { knowledgeGraph as KG } from "@repo/contracts";
import { applyOntologyBatch } from "../../src/application/knowledge-graph/apply-ontology-batch";
import { ENABLED_KG_SCOPES, validateOntologyBatch } from "../../src/domain/knowledge-graph/ontology-batch";
import { toOrgId } from "../../src/domain/org-id";
import { appConfig } from "../../src/infrastructure/db/pg-config";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { PgOntologyStore, toBatchPayload } from "../../src/infrastructure/knowledge-graph/pg-ontology-store";
import { asApp, asOwner } from "../support/db";
import { modelBatch, seedKgOrg } from "./kg-fixtures";

const ORG = "org-kg-f03-inv";
let seg: string;
let db: PgDatabase;

beforeAll(async () => {
  ({ segments: [seg] } = await seedKgOrg(ORG));
  db = new PgDatabase(appConfig());
});
afterAll(async () => { await db.close(); });

/** 直接调数据库函数，完全跳过应用层校验。 */
const rawApply = (batch: ReturnType<typeof modelBatch>, user: string | null = null) =>
  asApp(ORG, async (c) => {
    if (user !== null) await c.query("SELECT set_config('app.current_user_id', $1, true)", [user]);
    return c.query("SELECT kg_apply_batch($1::jsonb) AS r", [JSON.stringify(toBatchPayload(batch))]);
  });

describe("F03 I-3：绕过执行器的直写被拒", () => {
  it("app_rw 直接 INSERT 带作用域的结论 ⇒ KG_WRITE_OUTSIDE_EXECUTOR", async () => {
    await expect(asApp(ORG, (c) => c.query(
      `INSERT INTO claims (id, org_id, statement, status, tsv, created_by, scope_kind, scope_id, claim_kind)
       VALUES ('c-direct', $1, '模型直写', 'accepted', ''::tsvector, 'model', 'chat_session', 't-1', 'fact')`, [ORG],
    ))).rejects.toThrow(/KG_WRITE_OUTSIDE_EXECUTOR/);
  });

  it("app_rw 直接 INSERT 带作用域的边 ⇒ 拒", async () => {
    await expect(asApp(ORG, (c) => c.query(
      `INSERT INTO ontology_edges (id, org_id, src_kind, src_id, dst_kind, dst_id, relation, created_by, scope_kind, scope_id)
       VALUES ('e-direct', $1, 'claim', 'x', 'object', 'y', 'about', 'model', 'chat_session', 't-1')`, [ORG],
    ))).rejects.toThrow(/KG_WRITE_OUTSIDE_EXECUTOR/);
  });

  it("执行器写入的 proposed 结论：app_rw 不能直接 UPDATE 成 accepted，也不能再挂证据", async () => {
    const b = modelBatch(ORG, seg);
    await rawApply(b);
    const id = b.claims[0]!.id;
    await expect(asApp(ORG, (c) => c.query("UPDATE claims SET status = 'accepted' WHERE id = $1", [id])))
      .rejects.toThrow(/KG_WRITE_OUTSIDE_EXECUTOR/);
    await expect(asApp(ORG, (c) => c.query(
      "INSERT INTO claim_segments (claim_id, org_id, segment_id, stance) VALUES ($1, $2, $3, 'contradicting')", [id, ORG, seg],
    ))).rejects.toThrow(/KG_WRITE_OUTSIDE_EXECUTOR/);
    const row = await asApp(ORG, (c) => c.query("SELECT status FROM claims WHERE id = $1", [id]));
    expect(row.rows[0]).toEqual({ status: "proposed" });
  });

  it("没有作用域、但标成模型产出的结论：app_rw 直写同样被拒（I-3 按 created_by 判，不只按作用域）", async () => {
    await expect(asApp(ORG, (c) => c.query(
      `INSERT INTO claims (id, org_id, statement, status, tsv, created_by, reviewed_by)
       VALUES ('c-direct-unscoped', $1, '模型直写', 'accepted', ''::tsvector, 'model', 'fake')`, [ORG],
    ))).rejects.toThrow(/KG_WRITE_OUTSIDE_EXECUTOR/);
  });

  it("把执行器写的结论「洗白」（清空作用域再改状态）⇒ 拒（I-8 作用域不变）", async () => {
    const b = modelBatch(ORG, seg);
    await rawApply(b);
    await expect(asApp(ORG, (c) => c.query(
      "UPDATE claims SET scope_kind = NULL, scope_id = NULL, status = 'accepted' WHERE id = $1", [b.claims[0]!.id],
    ))).rejects.toThrow(/KG_WRITE_OUTSIDE_EXECUTOR/);
  });

  it("不带作用域的旧结论（检索夹具、phase-01 的写入路径）不受影响", async () => {
    await asApp(ORG, (c) => c.query(
      `INSERT INTO claims (id, org_id, statement, status, tsv) VALUES ('c-legacy-f03', $1, '旧路径', 'proposed', ''::tsvector)`, [ORG],
    ));
    const row = await asApp(ORG, (c) => c.query("SELECT id FROM claims WHERE id = 'c-legacy-f03'"));
    expect(row.rows).toHaveLength(1);
  });
});

describe("F03 I-4 / I-5：数据库一侧自己挡", () => {
  it("模型身份写 accepted / reviewed ⇒ KG_ACTOR_NOT_HUMAN", async () => {
    for (const status of ["accepted", "reviewed"] as const) {
      const b = modelBatch(ORG, seg);
      const bad = { ...b, claims: b.claims.map((c) => ({ ...c, status })) };
      await expect(rawApply(bad)).rejects.toThrow(/KG_ACTOR_NOT_HUMAN/);
    }
  });

  it("system 身份同样只能 proposed", async () => {
    const b = modelBatch(ORG, seg, { actor: { kind: "system", id: "import" } });
    const bad = { ...b, claims: b.claims.map((c) => ({ ...c, status: "accepted" as const })) };
    await expect(rawApply(bad)).rejects.toThrow(/KG_ACTOR_NOT_HUMAN/);
  });

  it("没有 supporting 证据 ⇒ KG_EVIDENCE_REQUIRED（只有 contradicting 也不算）", async () => {
    const b = modelBatch(ORG, seg);
    await expect(rawApply({ ...b, claims: b.claims.map((c) => ({ ...c, evidence: [] })) })).rejects.toThrow(/KG_EVIDENCE_REQUIRED/);
    const b2 = modelBatch(ORG, seg);
    await expect(rawApply({ ...b2, claims: b2.claims.map((c) => ({ ...c, evidence: [{ segmentId: seg, stance: "contradicting" as const }] })) }))
      .rejects.toThrow(/KG_EVIDENCE_REQUIRED/);
  });

  it("证据段不属于本 org ⇒ KG_EVIDENCE_NOT_FOUND", async () => {
    const b = modelBatch(ORG, seg);
    await expect(rawApply({ ...b, claims: b.claims.map((c) => ({ ...c, evidence: [{ segmentId: "seg-other-org", stance: "supporting" as const }] })) }))
      .rejects.toThrow(/KG_EVIDENCE_NOT_FOUND/);
  });
});

describe("F03 SECURITY DEFINER 硬化", () => {
  it("调用方建同名临时表冒充证据段 ⇒ 不生效，仍是 KG_EVIDENCE_NOT_FOUND", async () => {
    const b = modelBatch(ORG, seg);
    const forged = { ...b, claims: b.claims.map((c) => ({ ...c, evidence: [{ segmentId: "seg-forged", stance: "supporting" as const }] })) };
    await expect(asApp(ORG, async (c) => {
      await c.query("CREATE TEMP TABLE segments (id text, org_id text)");
      await c.query("INSERT INTO segments VALUES ('seg-forged', $1)", [ORG]);
      return c.query("SELECT kg_apply_batch($1::jsonb)", [JSON.stringify(toBatchPayload(forged))]);
    })).rejects.toThrow(/KG_EVIDENCE_NOT_FOUND/);
  });
});

describe("F03 I-1 / I-14：作用域", () => {
  it.each(["project", "org", "platform"] as const)("scope=%s ⇒ KG_SCOPE_NOT_ENABLED（数据库与应用层都拒）", async (kind) => {
    const b = modelBatch(ORG, seg, { scope: { kind, id: "x" } });
    await expect(rawApply(b)).rejects.toThrow(/KG_SCOPE_NOT_ENABLED/);
    expect(validateOntologyBatch(b, null)).toMatchObject({ ok: false, code: "KG_SCOPE_NOT_ENABLED" });
  });

  it("应用层的白名单与数据库 kg_scope_enabled 逐项一致（外扩时两处必须一起改）", async () => {
    for (const kind of KG.KgScopeKind.options) {
      const r = await asApp(ORG, (c) => c.query<{ on: boolean }>("SELECT kg_scope_enabled($1) AS on", [kind]));
      expect([kind, r.rows[0]!.on]).toEqual([kind, ENABLED_KG_SCOPES.includes(kind)]);
    }
  });

  it("本人写自己的个人空间 ⇒ 通过；写别人的 ⇒ KG_NOT_OWNER，留痕记在 org 级、不进对方的个人空间", async () => {
    const store = new PgOntologyStore(db);
    const own = modelBatch(ORG, seg, { scope: { kind: "personal", id: "u-1" }, actor: { kind: "human", id: "u-1" }, sourceRef: null, pipelineVersion: null });
    expect((await applyOntologyBatch(store, toOrgId(ORG), "u-1", own)).outcome).toBe("accepted");

    const other = modelBatch(ORG, seg, { scope: { kind: "personal", id: "u-1" }, actor: { kind: "human", id: "u-2" }, sourceRef: null, pipelineVersion: null });
    await expect(rawApply(other, "u-2")).rejects.toThrow(/KG_NOT_OWNER/);
    const out = await applyOntologyBatch(store, toOrgId(ORG), "u-2", other);
    expect(out).toMatchObject({ outcome: "rejected", rejected: { code: "KG_NOT_OWNER" } });
    const audit = await asApp(ORG, (c) => c.query(
      "SELECT scope_kind, scope_id, payload->'attempted_scope' AS attempted FROM ontology_actions WHERE id = $1", [other.actionId],
    ));
    expect(audit.rows[0]).toEqual({ scope_kind: "org", scope_id: ORG, attempted: { kind: "personal", id: "u-1" } });
  });
});

describe("F03 评审补强", () => {
  it("冻结的 org：执行器与拒绝留痕都不写（F22），属主身份也一样", async () => {
    const FROZEN = "org-kg-f03-frozen";
    const { segments: [fseg] } = await seedKgOrg(FROZEN);
    await asOwner((c) => c.query("UPDATE organizations SET status = 'disabled', disabled_at = now(), retention_until = now() + interval '30 days' WHERE id = $1", [FROZEN]));
    try {
      const b = modelBatch(FROZEN, fseg);
      await expect(asApp(FROZEN, (c) => c.query("SELECT kg_apply_batch($1::jsonb)", [JSON.stringify(toBatchPayload(b))])))
        .rejects.toThrow(/KG_ORG_FROZEN/);
      await expect(asApp(FROZEN, (c) => c.query("SELECT kg_record_rejected($1::jsonb)", [JSON.stringify({
        action_id: "a-frozen", scope_kind: "chat_session", scope_id: "t", actor_kind: "model", actor_id: "m",
        action_type: "extract", reject_code: "KG_INVALID_BATCH", reject_reason: "x",
      })]))).rejects.toThrow(/KG_ORG_FROZEN/);
      const n = await asOwner((c) => c.query("SELECT 1 FROM ontology_objects WHERE org_id = $1", [FROZEN]));
      expect(n.rows).toHaveLength(0);
    } finally {
      await asOwner((c) => c.query("UPDATE organizations SET status = 'active', disabled_at = NULL, retention_until = NULL WHERE id = $1", [FROZEN]));
    }
  });

  it("I-7 并发：两个同源同版本的任务同时执行，只有一个真正写入", async () => {
    const a = modelBatch(ORG, seg);
    const b = { ...modelBatch(ORG, seg), sourceRef: a.sourceRef, pipelineVersion: a.pipelineVersion };
    const [ra, rb] = await Promise.all([rawApply(a), rawApply(b)]);
    const outs = [ra.rows[0].r, rb.rows[0].r] as { deduplicated: boolean }[];
    expect(outs.filter((o) => !o.deduplicated)).toHaveLength(1);
    const objs = await asApp(ORG, (c) => c.query("SELECT 1 FROM ontology_objects WHERE id = ANY($1)", [[a.objects[0]!.id, b.objects[0]!.id]]));
    expect(objs.rows).toHaveLength(1);
  });

  it("人工动作的执行身份必须是登录用户本人（应用层与数据库都拒）", async () => {
    const b = modelBatch(ORG, seg, { actor: { kind: "human", id: "u-someone-else" }, sourceRef: null, pipelineVersion: null });
    expect(validateOntologyBatch(b, "u-me")).toMatchObject({ ok: false, code: "KG_NOT_OWNER" });
    await expect(rawApply(b, "u-me")).rejects.toThrow(/KG_NOT_OWNER/);
  });

  it("边的端点不存在 ⇒ 拒，整批不落", async () => {
    const b = modelBatch(ORG, seg);
    const bad = { ...b, edges: [{ ...b.edges[0]!, dstId: "obj-does-not-exist" }] };
    await expect(rawApply(bad)).rejects.toThrow(/KG_EDGE_ENDPOINT_NOT_FOUND/);
    const out = await applyOntologyBatch(new PgOntologyStore(db), toOrgId(ORG), null, bad);
    expect(out).toMatchObject({ outcome: "rejected", rejected: { code: "KG_INVALID_BATCH" } });
    const n = await asApp(ORG, (c) => c.query("SELECT 1 FROM claims WHERE id = $1", [b.claims[0]!.id]));
    expect(n.rows).toHaveLength(0);
  });

  it("复用已有实体（同 id）：计数只算真正新写入的", async () => {
    const first = modelBatch(ORG, seg);
    await rawApply(first);
    const again = { ...modelBatch(ORG, seg), objects: first.objects };
    const r = await rawApply({ ...again, edges: [{ ...again.edges[0]!, dstId: first.objects[0]!.id }] });
    expect(r.rows[0].r).toMatchObject({ objects: 0, claims: 1, edges: 1 });
  });
});

