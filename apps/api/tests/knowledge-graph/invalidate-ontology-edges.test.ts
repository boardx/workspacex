/**
 * Phase 18 F07 —— files 束出站端口 `invalidateOntologyEdges` 的真实现（uc-18-5 R3 ① / R7-3），真实数据库 + 真 AGE。
 *
 * 删除一个附件版本 ⇒ 以它的片段为端点的边软失效（行保留、status=invalidated），返回 invalidatedEdgeIds；
 * 只由这些片段支撑的结论失效（source_deleted）；还有别的证据的结论保留、证据数减一；AGE 随后跟上。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyOntologyBatch } from "../../src/application/knowledge-graph/apply-ontology-batch";
import { projectPendingGraph } from "../../src/application/knowledge-graph/project-pending-graph";
import { toOrgId } from "../../src/domain/org-id";
import { appConfig } from "../../src/infrastructure/db/pg-config";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { PgCascadeInvalidationRepository } from "../../src/infrastructure/files/pg-deletion-repository";
import { graphParity } from "../../src/infrastructure/knowledge-graph/kg-graph-rebuild";
import { PgGraphProjection } from "../../src/infrastructure/knowledge-graph/pg-graph-projection";
import { PgOntologyStore } from "../../src/infrastructure/knowledge-graph/pg-ontology-store";
import { addSegment, asApp, asOwner } from "../support/db";
import { silentLogger } from "./kg-extraction-fixtures";
import { modelBatch, seedKgOrg } from "./kg-fixtures";

const ORG = "org-kg-f07-edges";
const ART = `${ORG}-art`;
const V1 = `${ORG}-art-v1`;
const OTHER_SEG = `${ORG}-other-seg`;
let db: PgDatabase;
let cascade: PgCascadeInvalidationRepository;
let segs: [string, string];
const q = <T>(sql: string, params: unknown[] = []) => asOwner(async (c) => (await c.query(sql, params)).rows as T[]);

beforeAll(async () => {
  ({ segments: segs } = await seedKgOrg(ORG));
  await addSegment({ orgId: ORG, segmentId: OTHER_SEG, artifactId: `${ORG}-art2`, versionId: `${ORG}-art2-v1`, ordinal: 0 });
  db = new PgDatabase(appConfig());
  cascade = new PgCascadeInvalidationRepository(db);
  const store = new PgOntologyStore(db);
  // 只由被删附件支撑的结论
  await applyOntologyBatch(store, toOrgId(ORG), null, modelBatch(ORG, segs[0], { actionId: "act-only", claims: [{
    id: "clm-only", claimKind: "decision", statement: "张三决定 9/29 上线", status: "proposed", confidence: 0.8,
    evidence: [{ segmentId: segs[0], stance: "supporting" }, { segmentId: segs[1], stance: "supporting" }],
  }], objects: [{ id: "obj-zs", objectKind: "person", name: "张三", aliases: [] }],
  edges: [{ id: "edg-only", srcKind: "claim", srcId: "clm-only", dstKind: "object", dstId: "obj-zs", relation: "decided_by" }] }));
  // 两个来源：被删附件 + 另一个附件
  await applyOntologyBatch(store, toOrgId(ORG), null, modelBatch(ORG, segs[0], { actionId: "act-both", claims: [{
    id: "clm-both", claimKind: "fact", statement: "张三负责发布", status: "proposed", confidence: 0.8,
    evidence: [{ segmentId: segs[0], stance: "supporting" }, { segmentId: OTHER_SEG, stance: "supporting" }],
  }], objects: [], edges: [{ id: "edg-both", srcKind: "claim", srcId: "clm-both", dstKind: "object", dstId: "obj-zs", relation: "about" }] }));
  // 以片段为端点的边（F45 原来按片段硬删的那种）
  await asApp(ORG, (c) => c.query(
    "INSERT INTO ontology_edges (id, org_id, src_kind, src_id, dst_kind, dst_id, relation) VALUES ('edg-seg', $1, 'segment', $2, 'project', $3, 'evidence')",
    [ORG, segs[0], `${ORG}-p`]));
  await projectPendingGraph(new PgGraphProjection(db), silentLogger);
});
afterAll(async () => { await db.close(); });

describe("F07: invalidateOntologyEdges 真实现", () => {
  it("返回以被删片段为端点的边，且是软失效（行还在，status=invalidated）", async () => {
    const out = await cascade.invalidateOntologyEdges(toOrgId(ORG), { artifactId: ART, versionIds: [V1] });
    expect(out.invalidatedEdgeIds).toContain("edg-seg");
    expect(await q("SELECT status FROM ontology_edges WHERE id = 'edg-seg'")).toEqual([{ status: "invalidated" }]);
  });

  it("只由被删附件支撑的结论失效（superseded + revoked_at + source_deleted），连着它的边也软失效", async () => {
    expect(await q("SELECT status, revocation_reason, revoked_at IS NOT NULL AS revoked FROM claims WHERE id = 'clm-only'"))
      .toEqual([{ status: "superseded", revocation_reason: "source_deleted", revoked: true }]);
    expect(await q("SELECT status FROM ontology_edges WHERE id = 'edg-only'")).toEqual([{ status: "invalidated" }]);
  });

  it("还有别的证据的结论保留，证据数由 2 变 1，它的边仍然有效", async () => {
    expect(await q("SELECT status, revoked_at FROM claims WHERE id = 'clm-both'")).toEqual([{ status: "proposed", revoked_at: null }]);
    expect(await q("SELECT segment_id FROM claim_segments WHERE claim_id = 'clm-both'")).toEqual([{ segment_id: OTHER_SEG }]);
    expect(await q("SELECT status FROM ontology_edges WHERE id = 'edg-both'")).toEqual([{ status: "active" }]);
  });

  it("幂等：同参再调一次，返回同一组 id，不再改动任何行", async () => {
    const before = await q("SELECT id, status, invalidated_at FROM ontology_edges WHERE org_id = $1 ORDER BY id", [ORG]);
    const a = await cascade.invalidateOntologyEdges(toOrgId(ORG), { artifactId: ART, versionIds: [V1] });
    const b = await cascade.invalidateOntologyEdges(toOrgId(ORG), { artifactId: ART, versionIds: [V1] });
    expect(a).toEqual(b);
    expect(await q("SELECT id, status, invalidated_at FROM ontology_edges WHERE org_id = $1 ORDER BY id", [ORG])).toEqual(before);
  });

  it("AGE 跟上：投影之后图与 canonical 逐行一致，失效的结论与边不在图里", async () => {
    await projectPendingGraph(new PgGraphProjection(db), silentLogger);
    const { parity, graph } = await asOwner(async (c) => {
      await c.query("BEGIN");
      try {
        const parity = await graphParity(c, ORG);
        const graph = (await c.query<{ x: string }>("SELECT x FROM kg_graph_snapshot() AS x")).rows.map((r) => r.x);
        return { parity, graph };
      } finally { await c.query("COMMIT"); }
    });
    expect(parity).toEqual({ missingInGraph: [], extraInGraph: [] });
    expect(graph.some((x) => x.includes("clm-only") || x.includes("edg-only"))).toBe(false);
    expect(graph.some((x) => x.includes("clm-both"))).toBe(true);
  });
});
