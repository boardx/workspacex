/**
 * D4 / D11 纯映射 + 六跳路径走法（无 DB）。DB 半边（迁移 20260924190000 的只读触发器、
 * findSixHopPaths 的递归 CTE）需要隔离库 lane，不在本文件。
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ontologyProjection } from "@repo/contracts";
import { buildProjectionEdges, parseCommitLog } from "../../scripts/lib/dev-process-projection";
import {
  adrKeyOf,
  buildDecisionEdges,
  buildKnowledgeNodes,
  lessonEntries,
} from "../../scripts/lib/knowledge-projection";
import {
  buildCustomerInstanceProjection,
  parseFleetInstances,
} from "../../scripts/lib/customer-instance-projection";
import { walkSixHops, type GraphEdge } from "../../src/domain/retrieval/six-hop-path";

const MIGRATION = fileURLToPath(
  new URL("../../migrations/20260924190000_d4_d11_ontology_nodes_projection.sql", import.meta.url),
);
const ORG = "org-platform";
const INSTANCE = "a".repeat(64);

const SKILL = [
  "# mod-x",
  "## 踩坑与经验（append-only，最新在上）",
  "- <!-- 模板占位 -->",
  "- 2026-09-14：第一条",
  "  续行",
  "- 2026-09-13：第二条",
  "## 知识回流规则",
  "- 不是经验",
].join("\n");

const docs = [
  { path: "docs/adr/ADR-12-thing.md", content: "# ADR-012 Thing\nbody" },
  { path: "docs/adr/0001-record-architecture-decisions.md", content: "# Record\n" },
  { path: "docs/adr/README.md", content: "# index" },
  { path: ".harness/instructions/coding-standards.md", content: "# 编码规范\n..." },
  { path: ".agents/skills/mod-x/SKILL.md", content: SKILL },
  { path: ".agents/skills/mod-_template/SKILL.md", content: SKILL },
];

describe("D4 knowledge projection", () => {
  it("maps ADRs / methodology / lessons deterministically with content-hash ids", () => {
    expect(adrKeyOf("docs/adr/ADR-12-thing.md")).toBe("ADR-012");
    expect(adrKeyOf("docs/adr/README.md")).toBeNull();
    expect(lessonEntries(SKILL)).toEqual(["- 2026-09-14：第一条\n  续行", "- 2026-09-13：第二条"]);

    const a = buildKnowledgeNodes(ORG, docs);
    expect(buildKnowledgeNodes(ORG, docs)).toEqual(a);
    for (const n of a) expect(() => ontologyProjection.ProjectionNode.parse(n)).not.toThrow();
    expect(a.map((n) => `${n.kind}:${n.key.replace(/#.*/, "#")}`).sort()).toEqual([
      "decision:0001-record-architecture-decisions",
      "decision:ADR-012",
      "lesson:mod-x#",
      "lesson:mod-x#",
      "methodology:.harness/instructions/coding-standards.md",
    ]);
    expect(a.every((n) => n.projectionSource === "repo")).toBe(true);
    // 正文改了 → contentHash 变，id 不变
    const b = buildKnowledgeNodes(ORG, [{ path: "docs/adr/ADR-12-thing.md", content: "# ADR-012 Thing\nchanged" }]);
    const adr = a.find((n) => n.key === "ADR-012")!;
    expect(b[0]!.id).toBe(adr.id);
    expect(b[0]!.contentHash).not.toBe(adr.contentHash);
  });

  it("derives decided_by only for ADRs that exist", () => {
    const commits = parseCommitLog("c0ffee1\x1ffeat: per ADR-12 (#20)\x1fsee ADR-999\x1e");
    const edges = buildDecisionEdges(ORG, commits, new Set(["ADR-012"]));
    expect(edges.map((e) => `${e.src.id}->${e.dst.id}`)).toEqual(["20->ADR-012"]);
  });

  it("migration kind CHECKs (edges + nodes) equal the contract", () => {
    const sql = readFileSync(MIGRATION, "utf8");
    const m = /ontology_nodes_kind_check CHECK \(kind IN \(([^)]*)\)/.exec(sql);
    expect(m).not.toBeNull();
    expect([...m![1]!.matchAll(/'([a-z_]+)'/g)].map((x) => x[1]).sort()).toEqual(
      [...ontologyProjection.OntologyNodeKind.options].sort(),
    );
    for (const src of ontologyProjection.ProjectionSource.options) expect(sql).toContain(`'${src}'`);
  });
});

describe("D11 customer instances + six-hop path", () => {
  const fleet = {
    generatedAt: 1,
    instances: [
      { instanceId: INSTANCE, edition: "selfhost", productVersion: "1.0.0", health: "healthy", periodEnd: "2026-09-23", receivedAt: 1, overdue: false, orgName: "ACME secret" },
      { instanceId: "not-a-hash", edition: "selfhost", productVersion: "1.0.0", health: "healthy", periodEnd: "x" },
    ],
  };

  it("keeps only the opaque hash and run facts", () => {
    const rows = parseFleetInstances(fleet);
    expect(rows).toHaveLength(1);
    const { nodes, edges } = buildCustomerInstanceProjection(ORG, rows);
    expect(nodes).toHaveLength(1);
    expect(nodes[0]!.body).not.toContain("ACME");
    expect(JSON.parse(nodes[0]!.body)).toEqual({ edition: "selfhost", productVersion: "1.0.0", health: "healthy", periodEnd: "2026-09-23" });
    expect(nodes[0]!.projectionSource).toBe("telemetry");
    expect(edges.map((e) => `${e.src.kind}:${e.src.id.slice(0, 4)} -${e.relation}-> ${e.dst.kind}:${e.dst.id}`)).toEqual([
      "customer_instance:aaaa -running-> release:v1.0.0",
    ]);
    for (const e of edges) expect(() => ontologyProjection.ProjectionEdge.parse(e)).not.toThrow();
    expect(buildCustomerInstanceProjection(ORG, rows)).toEqual({ nodes, edges });
  });

  it("walks instance → release → PR → defect → decision → evidence over the combined projections", () => {
    const commits = parseCommitLog(
      "f1a0001\x1ffix(api): crash (#11)\x1fFixes #6\nper ADR-012\x1e\nfea0002\x1ffeat: other (#12)\x1f\x1e",
    );
    const repo = [
      ...buildProjectionEdges(ORG, { commits, releases: [{ tag: "v1.0.0", commitShas: ["f1a0001", "fea0002"] }], features: [] }),
      ...buildDecisionEdges(ORG, commits, new Set(["ADR-012"])),
    ];
    const tele = buildCustomerInstanceProjection(ORG, parseFleetInstances(fleet)).edges;
    const evidence = { src_kind: "pull_request", src_id: "11", relation: "verified_by", dst_kind: "evidence", dst_id: "pr-11#ci" };
    const graph: GraphEdge[] = [...repo, ...tele].map((e) => ({
      src_kind: e.src.kind, src_id: e.src.id, relation: e.relation, dst_kind: e.dst.kind, dst_id: e.dst.id,
    }));
    graph.push(evidence);

    const paths = walkSixHops(INSTANCE, graph);
    for (const p of paths) expect(() => ontologyProjection.SixHopPath.parse(p)).not.toThrow();
    expect(paths).toEqual([
      { customerInstance: INSTANCE, release: "v1.0.0", pullRequest: "11", defect: "6", decision: "ADR-012", evidence: "pr-11#ci" },
      { customerInstance: INSTANCE, release: "v1.0.0", pullRequest: "12", defect: null, decision: null, evidence: null },
    ]);
    expect(walkSixHops("b".repeat(64), graph)).toEqual([]);
  });
});
