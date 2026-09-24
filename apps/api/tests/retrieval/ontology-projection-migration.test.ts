import { beforeAll, describe, expect, it } from "vitest";
import { applyProjection } from "../../scripts/sync-dev-process-projection";
import { buildProjectionEdges } from "../../scripts/lib/dev-process-projection";
import { asApp, asOwner, ensureDatabase, migrateOnce, resetOrgs, seedOrg } from "../support/db";

const ORG = "org-d12-projection";

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  await resetOrgs(ORG);
  await seedOrg({ orgId: ORG, projectId: "proj-d12-projection" });
}, 120_000);

describe("D12 ontology projection migration", () => {
  it("accepts the new kinds, syncs idempotently, and keeps projection rows read-only for the app", async () => {
    const edges = buildProjectionEdges(ORG, {
      commits: [{ sha: "abcdef1", subject: "fix: x (#2)", body: "Fixes #1" }],
      releases: [{ tag: "v0.1.0", commitShas: ["abcdef1"] }],
      features: [],
    });
    expect(edges).toHaveLength(2);
    expect(await asOwner((c) => applyProjection(c, ORG, edges))).toEqual({ upserted: 2, removed: 0 });
    expect(await asOwner((c) => applyProjection(c, ORG, edges))).toEqual({ upserted: 0, removed: 0 });
    expect(await asOwner((c) => applyProjection(c, ORG, edges.slice(0, 1)))).toEqual({ upserted: 0, removed: 1 });

    await asApp(ORG, async (c) => {
      const rows = await c.query("SELECT projection_source FROM ontology_edges WHERE org_id = $1", [ORG]);
      expect(rows.rows).toEqual([{ projection_source: "repo" }]);
    });
    await expect(
      asApp(ORG, (c) => c.query("DELETE FROM ontology_edges WHERE org_id = $1", [ORG])),
    ).rejects.toThrow(/read-only/);
    await expect(
      asApp(ORG, (c) =>
        c.query(
          `INSERT INTO ontology_edges (id, org_id, src_kind, src_id, dst_kind, dst_id, relation, projection_source)
           VALUES ('d12-forged', $1, 'release', 'v9', 'pull_request', '9', 'contains', 'repo')`,
          [ORG],
        ),
      ),
    ).rejects.toThrow(/read-only/);
    // a non-projection edge using a new kind is fine for the product
    await asApp(ORG, (c) =>
      c.query(
        `INSERT INTO ontology_edges (id, org_id, src_kind, src_id, dst_kind, dst_id, relation)
         VALUES ('d12-manual', $1, 'customer_instance', 'ci-1', 'release', 'v0.1.0', 'running')`,
        [ORG],
      ),
    );
    await expect(
      asApp(ORG, (c) =>
        c.query(
          `INSERT INTO ontology_edges (id, org_id, src_kind, src_id, dst_kind, dst_id, relation)
           VALUES ('d12-bad', $1, 'spaceship', 'x', 'release', 'y', 'r')`,
          [ORG],
        ),
      ),
    ).rejects.toThrow(/ontology_edges_src_kind_check/);
    // org delete cascades through the read-only trigger
    await resetOrgs(ORG);
    const left = await asOwner((c) => c.query("SELECT count(*)::int AS n FROM ontology_edges WHERE org_id = $1", [ORG]));
    expect(left.rows[0].n).toBe(0);
  });
});
