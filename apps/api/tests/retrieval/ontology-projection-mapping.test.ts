import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ontologyProjection } from "@repo/contracts";
import {
  buildProjectionEdges,
  defectsFixedBy,
  parseCommitLog,
  prNumberOf,
} from "../../scripts/lib/dev-process-projection";

const MIGRATION = fileURLToPath(
  new URL("../../migrations/20260924160000_d12_ontology_dev_process_projection.sql", import.meta.url),
);

const log = [
  "aaaaaaa1\x1ffeat(x): add thing (#10)\x1fCloses #5\n\x1e",
  "\nbbbbbbb2\x1ffix(api): crash on empty (#11)\x1fFixes #6\nCloses #7\n\x1e",
  "\ncccccc3\x1fchore: local only\x1fFixes #8\x1e",
].join("");

describe("D12 dev-process projection mapping", () => {
  it("parses commits, PR numbers and defects", () => {
    const commits = parseCommitLog(log);
    expect(commits.map((c) => c.sha)).toEqual(["aaaaaaa1", "bbbbbbb2", "cccccc3"]);
    expect(commits.map(prNumberOf)).toEqual([10, 11, null]);
    // feat 的 Closes 是 feature issue，不是缺陷
    expect(commits.map(defectsFixedBy)).toEqual([[], [6, 7], []]);
  });

  it("builds deterministic, idempotent edges and never invents customer instances", () => {
    const snap = {
      commits: parseCommitLog(log),
      releases: [{ tag: "v1.0.0", commitShas: ["aaaaaaa1", "bbbbbbb2", "cccccc3"] }],
      features: [
        { phase: "phase-01", id: "F1", status: "passing", evidence: "vitest ok" },
        { phase: "phase-01", id: "F2", status: "in_progress", evidence: "wip" },
        { phase: "phase-01", id: "F3", status: "passing", evidence: "" },
      ],
    };
    const a = buildProjectionEdges("org-platform", snap);
    expect(buildProjectionEdges("org-platform", snap)).toEqual(a);
    for (const e of a) expect(() => ontologyProjection.ProjectionEdge.parse(e)).not.toThrow();
    const triples = a.map((e) => `${e.src.kind}:${e.src.id} -${e.relation}-> ${e.dst.kind}:${e.dst.id}`).sort();
    expect(triples).toEqual([
      "feature:phase-01/F1 -verified_by-> evidence:phase-01/F1#evidence",
      "pull_request:11 -fixes-> defect:6",
      "pull_request:11 -fixes-> defect:7",
      "release:v1.0.0 -contains-> pull_request:10",
      "release:v1.0.0 -contains-> pull_request:11",
    ]);
    expect(a.every((e) => e.projectionSource === "repo")).toBe(true);
    expect(a.some((e) => e.src.kind === "customer_instance" || e.dst.kind === "customer_instance")).toBe(false);
    expect(buildProjectionEdges("org-other", snap)[0]!.id).not.toBe(a[0]!.id);
  });

  it("migration CHECK kind list equals the contract's OntologyNodeKind (single source)", () => {
    const sql = readFileSync(MIGRATION, "utf8");
    for (const col of ["src_kind", "dst_kind"]) {
      const m = new RegExp(`ontology_edges_${col}_check CHECK \\(${col} IN \\(([^)]*)\\)`).exec(sql);
      expect(m, col).not.toBeNull();
      const kinds = [...m![1]!.matchAll(/'([a-z_]+)'/g)].map((x) => x[1]).sort();
      expect(kinds).toEqual([...ontologyProjection.OntologyNodeKind.options].sort());
    }
  });
});
