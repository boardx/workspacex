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
 * **NOT judgeable:** whether the channel's absolute recall clears the shipping bar.
 * `THRESHOLDS.vectorRecallBaseline` is registered `{ known: false }` -- the product has not
 * given the number. `judgeRecall()` therefore throws, and the test below asserts that it
 * throws. That assertion IS the rule ("低于基线即判失败，不得静默放行"): with no baseline there
 * is no pass, and a default would have manufactured one.
 *
 * **NOT exercised at all:** the ANN-index-then-filter behaviour the failure is actually about.
 * There is no HNSW/IVFFlat index, because an ANN index needs a fixed dimension and a dimension
 * is a property of an embedding model that phase-00 has not chosen (migration 0009). The vector
 * channel is an exact scan today, in which the failure mode cannot occur. The last test in this
 * file asserts the index's ABSENCE, so the day one is added, this suite goes red and has to be
 * re-armed rather than continuing to pass while measuring a configuration that no longer holds.
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

describe("⚠ the shipping bar cannot be judged -- N-2 is undecided", () => {
  it("`vectorRecallBaseline` is registered as unknown, with an owner and a stated blockage", () => {
    const t = TH.THRESHOLDS.vectorRecallBaseline;
    expect(t.known).toBe(false);
    expect(t.owner).toBe("产品");
    expect(t.rule).toContain("不得静默放行");
    expect(TH.pendingThresholds().map((p) => p.name)).toContain("vectorRecallBaseline");
  });

  it("judging a measured recall THROWS rather than returning a pass", async () => {
    // This is the rule made executable, not a gap being papered over. With no baseline there is
    // no pass, and a default would have manufactured a measured-looking result -- which this
    // project has already had happen once (an invented sampleSize and a fabricated 口径表 v3).
    const c = compareRecall({
      entitled: entitledFor("u-out"),
      unfilteredHits: await unfilteredArm(QUERIES[0].vector, CORPUS.length),
      filteredHits: await filteredArm("u-out", QUERIES[0].vector, CORPUS.length),
    });
    expect(() => judgeRecall(c.filtered!)).toThrow(/尚未裁决/);
    // The error names who owes the number and what it blocks -- an error that only says
    // "undecided" sends the reader nowhere.
    expect(() => judgeRecall(1)).toThrow(/产品/);
    // ⚠ Even a PERFECT measurement cannot be declared a pass. That is the point: silence would
    // be indistinguishable from having cleared a bar nobody set.
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

describe("⚠ the ANN failure mode is not exercised, and its absence is asserted", () => {
  it("there is no approximate index on the embedding column", async () => {
    // ⚠ This assertion exists to EXPIRE. An HNSW/IVFFlat index is what makes "recall top-k
    // then filter" possible, i.e. what makes R9's silent under-recall real. Until one exists
    // the vector channel is an exact scan and the comparison above cannot fail for that
    // reason -- so stating it here is the difference between "the gate is green" and "the gate
    // is green because the risk is not present yet".
    //
    // When an embedding model is chosen, `embedding` gains a fixed dimension, an ANN index
    // appears, this test goes red, and the recall set has to be re-armed against the real
    // configuration. That is the intended trigger, not a nuisance.
    const idx = await asOwner((c) =>
      c.query<{ indexdef: string }>(
        `SELECT indexdef FROM pg_indexes WHERE tablename = 'segment_embeddings'`,
      ),
    );
    // Non-vacuity first: the query has to be finding indexes at all, or "no ANN index" would
    // be true of a table this query cannot see.
    expect(idx.rows.length, "pg_indexes returned nothing -- this assertion would be vacuous")
      .toBeGreaterThan(0);
    const ann = idx.rows.map((r) => r.indexdef).filter((d) => /USING\s+(hnsw|ivfflat)/i.test(d));
    expect(ann, "an ANN index now exists -- re-arm the recall test set against it (R9/V12)")
      .toEqual([]);
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
