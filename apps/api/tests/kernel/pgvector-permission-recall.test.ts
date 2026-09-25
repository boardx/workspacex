import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { thresholds as TH } from "@repo/contracts";
import {
  addBinding,
  addOrgMember,
  addProjectMember,
  asApp,
  asOwner,
  ensureDatabase,
  migrateOnce,
  resetOrgs,
  seedOrg,
} from "../support/db";
import { addEmbedding, indexSegment, registerEmbeddingModel } from "../support/retrieval-fixtures";
import { appConfig } from "../../src/infrastructure/db/pg-config";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { PgIdentityRepository } from "../../src/infrastructure/identity/pg-identity-repository";
import { CountingDecisionIdFactory } from "../../src/infrastructure/identity/in-memory-session-store";
import { PgSegmentRetriever } from "../../src/infrastructure/retrieval/pg-segment-retriever";
import { disclose } from "../../src/application/security/permission-filter";
import { propagationPathFor, type CandidateRow } from "../../src/application/retrieval/ports";
import {
  assertNoEntitledRecallLoss,
  compareRecall,
  judgeRecall,
  recall,
  EntitledRecallLossError,
} from "../../src/domain/retrieval/recall";
import { toOrgId } from "../../src/domain/org-id";

/**
 * F10 / UC-0.2 R12 V12 -- the permission-filtered pgvector recall test set.
 *
 * R9 names the failure precisely: an approximate index recalls top-k FIRST and the permission /
 * tenant / project predicate filters SECOND, so an entitled document can be pushed out of the
 * candidate window. The user is then told the material does not exist. No error, no log line,
 * and the report is "the AI didn't see the file I uploaded". R9 calls this more dangerous than
 * an error, and says the recall test set is the channel's shipping gate, "不可用『人工看着还行』
 * 代替".
 *
 * ## ⚠ What this file can and cannot judge -- read this before trusting a green run
 *
 * **Judgeable, and judged here:** whether the permission filter loses a document the requester
 * is entitled to. Two arms, same query, same embeddings: one reading the index directly (RLS
 * only), one through `disclose()`. Every entitled document in arm 1 must be in arm 2. No
 * threshold is needed, and this is the sentence F10's acceptance is written in.
 *
 * **Judged elsewhere, at scale:** whether the channel's absolute recall clears the shipping bar.
 * `THRESHOLDS.vectorRecallBaseline` was `{ known: false }` here (and `judgeRecall()` was asserted
 * to throw) until phase-18 S0-4 gave the number. This twelve-row set is too small to measure a
 * rate on; the rate is gated by `tests/retrieval/kg-hnsw-permission-recall.test.ts` (F05) over
 * thousands of rows through the HNSW index. What this file keeps asserting is that the number
 * lives only in the registry.
 *
 * **Re-armed (F05):** this file used to assert the ABSENCE of an ANN index, so that the day
 * one appeared it would go red instead of measuring a configuration that no longer held. That
 * day is phase-18 F05: every registered model now gets a partial HNSW expression index
 * (migration `20260924270000_kg_f05_hnsw_vector_index.sql`) and the vector channel reads
 * through it. The last block now asserts the index's PRESENCE and shape, and points at the F05
 * gate for the ANN-then-filter failure itself.
 */

const ORG = "org-f10-recall";
const PROJECT = "proj-f10-recall";
const MODEL = { model: "fixture-embed", modelVersion: "1" };

/**
 * The query set. Small and hand-built, and labelled as such.
 *
 * ⚠ It is NOT a corpus-scale evaluation and nothing here pretends it is. A real recall
 * evaluation needs a labelled query set over real material, which nobody has produced. What
 * this set does is exercise the shape the failure takes: entitled and non-entitled documents
 * adjacent in the same embedding neighbourhood, so that filtering has something to get wrong.
 */
const QUERIES = [
  { name: "budget", vector: [1, 0, 0, 0] },
  { name: "schedule", vector: [0, 1, 0, 0] },
  { name: "risk", vector: [0, 0, 1, 0] },
] as const;

let db: PgDatabase;
let retriever: PgSegmentRetriever;
let deps: { repo: PgIdentityRepository; ids: CountingDecisionIdFactory };
let fx: Awaited<ReturnType<typeof seedOrg>>;

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  db = new PgDatabase(appConfig());
  retriever = new PgSegmentRetriever(db);
  deps = { repo: new PgIdentityRepository(db), ids: new CountingDecisionIdFactory() };
  await registerEmbeddingModel(MODEL.model, MODEL.modelVersion, 4);
});

afterAll(async () => {
  await db.close();
});

/**
 * Twelve segments in three neighbourhoods, four of them team-restricted.
 *
 * The restricted ones sit NEXT TO the entitled ones in the vector space on purpose. Scattering
 * them would make the filter's job trivial and the measurement meaningless: the whole risk is
 * that a restricted neighbour displaces an entitled document from the window.
 */
const CORPUS = [
  { id: "r-b1", vec: [1, 0.02, 0, 0], team: false, text: "预算 讨论一" },
  { id: "r-b2", vec: [0.99, 0.05, 0, 0], team: true, text: "受限的 预算 口径" },
  { id: "r-b3", vec: [0.98, 0.03, 0, 0], team: false, text: "预算 讨论二" },
  { id: "r-b4", vec: [0.97, 0.08, 0, 0], team: true, text: "受限的 预算 附件" },
  { id: "r-s1", vec: [0.02, 1, 0, 0], team: false, text: "排期 讨论一" },
  { id: "r-s2", vec: [0.04, 0.99, 0, 0], team: true, text: "受限的 排期 说明" },
  { id: "r-s3", vec: [0.01, 0.98, 0, 0], team: false, text: "排期 讨论二" },
  { id: "r-s4", vec: [0.06, 0.97, 0, 0], team: false, text: "排期 讨论三" },
  { id: "r-k1", vec: [0, 0.02, 1, 0], team: false, text: "风险 记录一" },
  { id: "r-k2", vec: [0, 0.03, 0.99, 0], team: true, text: "受限的 风险 记录" },
  { id: "r-k3", vec: [0, 0.01, 0.98, 0], team: false, text: "风险 记录二" },
  { id: "r-k4", vec: [0, 0.05, 0.97, 0], team: false, text: "风险 记录三" },
] as const;

beforeEach(async () => {
  await resetOrgs(ORG);
  fx = await seedOrg({ orgId: ORG, projectId: PROJECT });
  await addOrgMember(ORG, "u-in", "consultant", fx.teams.energy!);
  await addOrgMember(ORG, "u-out", "consultant", fx.teams.platform!);
  await addProjectMember(ORG, PROJECT, "u-in", "facilitator", null);
  await addProjectMember(ORG, PROJECT, "u-out", "facilitator", null);

  for (const c of CORPUS) {
    await indexSegment({
      orgId: ORG, segmentId: c.id, artifactId: `art-${c.id}`, projectId: PROJECT, content: c.text,
    });
    await addEmbedding({ orgId: ORG, segmentId: c.id, ...MODEL, vector: c.vec });
    if (c.team) {
      await addBinding({
        orgId: ORG, subject: { kind: "team", id: fx.teams.energy! },
        object: { kind: "artifact", id: `art-${c.id}` },
        scope: "team-only", ownerTeamId: fx.teams.energy!,
      });
    }
  }
});

/**
 * Arm 1: the index, with NO permission decision applied.
 *
 * `Guarded.ref` is public -- the ids travel, the content does not -- so the unfiltered arm can
 * be read without ever unwrapping a payload. That is the honest way to measure "what would
 * have come back", and it is also why the guard's shape allows planning work without
 * disclosure.
 */
async function unfilteredArm(vector: readonly number[], limit: number): Promise<string[]> {
  const rows = await retriever.vector(
    { orgId: toOrgId(ORG), projectId: PROJECT, query: "", timeRange: null, limit },
    vector,
    MODEL,
  );
  return rows.map((r) => r.ref.id);
}

/** Arm 2: the same query, through the permission filter, on the `embedding-similarity` path. */
async function filteredArm(userId: string, vector: readonly number[], limit: number): Promise<string[]> {
  const rows = await retriever.vector(
    { orgId: toOrgId(ORG), projectId: PROJECT, query: "", timeRange: null, limit },
    vector,
    MODEL,
  );
  const d = await disclose<CandidateRow>(deps, {
    userId,
    orgId: toOrgId(ORG),
    projectId: PROJECT,
    action: "read.allHands",
    path: propagationPathFor("vector"),
    items: rows,
  });
  return d.visible.map((v) => v.ref.id);
}

/** What a requester is entitled to see, computed from the fixture rather than from the query. */
function entitledFor(userId: string): string[] {
  return CORPUS.filter((c) => !c.team || userId === "u-in").map((c) => c.id);
}

describe("V12: the permission filter costs no entitled document", () => {
  it("across the whole query set, at full window", async () => {
    for (const q of QUERIES) {
      for (const user of ["u-in", "u-out"]) {
        const c = compareRecall({
          entitled: entitledFor(user).filter((id) => CORPUS.some((x) => x.id === id)),
          unfilteredHits: await unfilteredArm(q.vector, CORPUS.length),
          filteredHits: await filteredArm(user, q.vector, CORPUS.length),
        });
        // The sentence F10 is accepted on: no "有权访问却召不回".
        expect(c.lostWhileEntitled, `${q.name} / ${user}`).toEqual([]);
        expect(() => assertNoEntitledRecallLoss(c)).not.toThrow();
      }
    }
  });

  it("...and at a narrow window, where a restricted neighbour could displace an entitled row", async () => {
    // The window is where the R9 failure lives. With k = 3 in a neighbourhood whose top four
    // include two restricted documents, a post-filter implementation returns one row and the
    // user concludes the material is not there.
    for (const q of QUERIES) {
      const c = compareRecall({
        entitled: entitledFor("u-out"),
        unfilteredHits: await unfilteredArm(q.vector, 3),
        filteredHits: await filteredArm("u-out", q.vector, 3),
      });
      expect(c.lostWhileEntitled, `${q.name} at k=3`).toEqual([]);
    }
  });

  it("counter-proof: the harness DOES report a loss when one is injected", async () => {
    // Without this, `lostWhileEntitled` being empty would be equally consistent with a
    // comparison that can never report anything -- which is how a recall suite passes while
    // measuring nothing. Nine such gates have been found in this repo already.
    const c = compareRecall({
      entitled: ["r-b1", "r-b3"],
      unfilteredHits: ["r-b1", "r-b3"],
      filteredHits: ["r-b1"],
    });
    expect(c.lostWhileEntitled).toEqual(["r-b3"]);
    expect(() => assertNoEntitledRecallLoss(c)).toThrow(EntitledRecallLossError);
  });

  it("counter-proof: the restricted rows really are being withheld", async () => {
    // The assertions above would also pass if the permission filter did nothing at all, which
    // is the other way "no loss" becomes true for the wrong reason.
    const out = await filteredArm("u-out", QUERIES[0].vector, CORPUS.length);
    expect(out).not.toContain("r-b2");
    expect(out).not.toContain("r-b4");
    const inTeam = await filteredArm("u-in", QUERIES[0].vector, CORPUS.length);
    expect(inTeam).toContain("r-b2"); // restriction, not paralysis
  });

  it("the two arms differ exactly by the restricted rows, and by nothing else", async () => {
    const un = await unfilteredArm(QUERIES[0].vector, CORPUS.length);
    const fil = await filteredArm("u-out", QUERIES[0].vector, CORPUS.length);
    const removed = un.filter((id) => !fil.includes(id)).sort();
    expect(removed).toEqual(CORPUS.filter((c) => c.team).map((c) => c.id).sort());
  });
});

describe("recall measurement itself", () => {
  it("recall over an empty ground truth is undefined, not 1", () => {
    // Returning 1 is how an empty fixture reports a perfect score -- the single most common
    // way a recall suite becomes decorative.
    expect(recall(["a"], [])).toBeNull();
    expect(recall([], ["a"])).toBe(0);
    expect(recall(["a", "b"], ["a", "b"])).toBe(1);
    expect(recall(["a"], ["a", "b"])).toBe(0.5);
  });

  it("the measured recall of the filtered arm is a real number over a non-empty ground truth", async () => {
    const c = compareRecall({
      entitled: entitledFor("u-out"),
      unfilteredHits: await unfilteredArm(QUERIES[0].vector, CORPUS.length),
      filteredHits: await filteredArm("u-out", QUERIES[0].vector, CORPUS.length),
    });
    // Guards the whole file from passing on an empty corpus.
    expect(c.filtered).not.toBeNull();
    expect(c.unfiltered).not.toBeNull();
    expect(entitledFor("u-out").length).toBeGreaterThan(0);
  });
});

describe("the shipping bar -- N-2, resolved by phase-18 S0-4", () => {
  it("`vectorRecallBaseline` is resolved in the registry, with a source that names the decision", () => {
    const t = TH.THRESHOLDS.vectorRecallBaseline;
    expect(t.known).toBe(true);
    if (!t.known) return;
    expect(t.source).toContain("S0-4");
    expect(t.rule).toContain("不得静默放行");
    expect(TH.pendingThresholds().map((p) => p.name)).not.toContain("vectorRecallBaseline");
  });

  it("judging compares against the REGISTRY value -- below fails, at-or-above passes, no measurement is refused", async () => {
    const baseline = TH.requireValue<number>(TH.THRESHOLDS.vectorRecallBaseline, "vectorRecallBaseline");
    expect(judgeRecall(baseline)).toEqual({ pass: true, baseline });
    expect(judgeRecall(1)).toEqual({ pass: true, baseline });
    // Below the bar is a FAIL verdict, not an exception to be caught and ignored.
    expect(judgeRecall(baseline - 0.01).pass).toBe(false);
    expect(judgeRecall(0).pass).toBe(false);
    // "No measurement" is never a verdict: recall over an empty ground truth is null, and
    // coercions of it must not reach the comparison.
    expect(() => judgeRecall(Number.NaN)).toThrow(RangeError);
    expect(() => judgeRecall(1.5)).toThrow(RangeError);

    // The twelve-row set here is real input to the judge -- not a rate worth shipping on (see
    // the header), but it must at least be a measurement the judge accepts.
    const c = compareRecall({
      entitled: entitledFor("u-out"),
      unfilteredHits: await unfilteredArm(QUERIES[0].vector, CORPUS.length),
      filteredHits: await filteredArm("u-out", QUERIES[0].vector, CORPUS.length),
    });
    expect(judgeRecall(c.filtered!).pass).toBe(true);
  });

  it("un-resolving the entry restores the throw -- the registry is the only source", () => {
    // Counter-proof for the resolution itself: `requireValue` still refuses a pending entry, so
    // setting the registry back to `known: false` cannot quietly keep a pass alive.
    expect(() =>
      TH.requireValue<number>(
        { known: false, rule: "counter-proof rule text, long enough", owner: "产品", blocksWhat: "x", ref: "y" },
        "vectorRecallBaseline",
      ),
    ).toThrow(/尚未裁决/);
  });

  it("no business code has quietly written a recall baseline in", () => {
    // `packages/contracts/tests/pending-thresholds.test.ts` runs this scan over the web and
    // contracts trees. The API tree was not in its walk, and F10 is the first feature with a
    // reason to hardcode this number, so the scan is applied here too.
    //
    // ⚠ Its pattern there is `recall [><=] 0.N`, and a counter-proof showed that is too narrow:
    // injecting `const baseline = 0.8;` into `judgeRecall` did NOT trip it. The likeliest shape
    // of the incident is an ASSIGNMENT, not a comparison. Both are matched here, and the
    // divergence is reported as a contracts-side defect rather than fixed in two places.
    const PATTERNS = [
      /\brecall\s*[><=]+\s*0?\.\d+/i,
      /\b(?:baseline|threshold|recall\w*)\s*(?::\s*number\s*)?=\s*0?\.\d+/i,
    ];
    const hits: string[] = [];
    const walk = (dir: string): void => {
      for (const n of readdirSync(dir)) {
        if (n === "node_modules" || n.startsWith(".")) continue;
        const p = join(dir, n);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.ts$/.test(n)) {
          readFileSync(p, "utf8").split("\n").forEach((line, i) => {
            if (/^\s*(\*|\/\/|\/\*)/.test(line)) return;
            if (PATTERNS.some((re) => re.test(line))) hits.push(`${p}:${i + 1}  ${line.trim()}`);
          });
        }
      }
    };
    walk(join(__dirname, "..", "..", "src"));
    expect(hits, "a recall baseline was hardcoded -- it must come from THRESHOLDS").toEqual([]);

    // The scan is not vacuous: it does fire on the shape it is looking for.
    expect(PATTERNS.some((re) => re.test("  const baseline = 0.8;"))).toBe(true);
    expect(PATTERNS.some((re) => re.test("  if (recall >= 0.85) ship();"))).toBe(true);
    expect(PATTERNS.some((re) => re.test("  const tokenBudget = 120000;"))).toBe(false);
  });
});

describe("the ANN index (re-armed by phase-18 F05)", () => {
  it("the registered model has exactly one HNSW index per embedding table, at its registered dimension", async () => {
    // This used to assert the index's ABSENCE, so that its arrival would force a re-arm. F05 is
    // that arrival: the ANN-then-filter failure is now real, and it is gated -- at a scale where
    // a rate means something -- by `tests/retrieval/kg-hnsw-permission-recall.test.ts`.
    const idx = await asOwner((c) =>
      c.query<{ tablename: string; indexdef: string }>(
        `SELECT tablename, indexdef FROM pg_indexes
          WHERE tablename IN ('segment_embeddings', 'object_embeddings') AND indexdef ~* 'USING (hnsw|ivfflat)'
            AND indexdef LIKE '%' || $1 || '%' AND indexdef LIKE '%' || $2 || '%'`,
        [`model = '${MODEL.model}'::text`, `model_version = '${MODEL.modelVersion}'::text`],
      ),
    );
    expect(idx.rows.map((r) => r.tablename).sort()).toEqual(["object_embeddings", "segment_embeddings"]);
    for (const r of idx.rows) {
      expect(r.indexdef).toMatch(/USING hnsw \(\(\(?embedding\)?::vector\(4\)\) vector_cosine_ops\)/);
    }
  });

  it("the embedding column has no fixed dimension, and the registry enforces one instead", async () => {
    const col = await asOwner((c) =>
      c.query<{ t: string }>(
        `SELECT format_type(atttypid, atttypmod) AS t FROM pg_attribute
          WHERE attrelid = 'segment_embeddings'::regclass AND attname = 'embedding'`,
      ),
    );
    expect(col.rows[0]!.t).toBe("vector");

    // The invariant that replaces it: a row whose dimension disagrees with its registered
    // model is refused at WRITE time. pgvector's own error would arrive at query time, on the
    // day somebody searches, long after the bad row was written.
    await expect(
      asApp(ORG, (c) =>
        c.query(
          `INSERT INTO segment_embeddings (segment_id, org_id, model, model_version, embedding)
           VALUES ('r-b1', $1, $2, $3, '[1,2]'::vector)
           ON CONFLICT (segment_id, model, model_version) DO UPDATE SET embedding = EXCLUDED.embedding`,
          [ORG, MODEL.model, MODEL.modelVersion],
        ),
      ),
    ).rejects.toThrow(/2 dimensions but model .* is registered with 4/);
  });

  it("an unregistered model cannot have embeddings at all", async () => {
    await expect(
      asApp(ORG, (c) =>
        c.query(
          `INSERT INTO segment_embeddings (segment_id, org_id, model, model_version, embedding)
           VALUES ('r-b1', $1, 'ghost-model', '1', '[1,2,3,4]'::vector)`,
          [ORG],
        ),
      ),
    ).rejects.toThrow(/not registered|foreign key/i);
  });

  it("two models coexist on one segment -- dual-write during a dimension migration", async () => {
    // R9 requires the dimension migration to go through dual-write. A key of (segment_id)
    // alone would make that impossible, and the impossibility would only surface mid-migration.
    await registerEmbeddingModel("fixture-embed", "2", 6);
    await addEmbedding({
      orgId: ORG, segmentId: "r-b1", model: "fixture-embed", modelVersion: "2",
      vector: [1, 0, 0, 0, 0, 0],
    });
    const n = await asApp(ORG, (c) =>
      c.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM segment_embeddings WHERE segment_id = 'r-b1'`,
      ),
    );
    expect(Number(n.rows[0]!.n)).toBe(2);

    // ...and the retrieval reads exactly one of them. A query that silently mixed models would
    // be comparing distances in two different spaces.
    const v1 = await unfilteredArm([1, 0, 0, 0], CORPUS.length);
    expect(v1.filter((id) => id === "r-b1")).toHaveLength(1);
  });
});
