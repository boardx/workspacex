import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { addOrgMember, addProjectMember, asOwner, ensureDatabase, migrateOnce, resetOrgs, seedOrg } from "../support/db";
import {
  IdentityRerank,
  TableEmbedding,
  addEmbedding,
  indexSegment,
  registerEmbeddingModel,
} from "../support/retrieval-fixtures";
import { appConfig } from "../../src/infrastructure/db/pg-config";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { PgIdentityRepository } from "../../src/infrastructure/identity/pg-identity-repository";
import { CountingDecisionIdFactory } from "../../src/infrastructure/identity/in-memory-session-store";
import { PgSegmentRetriever } from "../../src/infrastructure/retrieval/pg-segment-retriever";
import { retrieveCandidates, type RetrieveDeps } from "../../src/application/retrieval/retrieve-candidates";
import { toOrgId } from "../../src/domain/org-id";

/**
 * F10 / UC-0.2 R12 V11 -- "FTS is a first-class channel, not an optional one".
 *
 * ## What makes this assertable rather than a slogan
 *
 * The claim has a specific failure: a hybrid system that leans on the vector channel returns
 * *something* for every query, so nothing looks broken, and the query it silently answers
 * badly is the exact-quote one -- "what did the client actually say, word for word", "find
 * ISO 27001", "who is 王工". Neither embeddings nor a graph is good at exact matching, and the
 * result is not an error, it is a plausible neighbour.
 *
 * So the test is two-armed and both arms matter:
 *
 *   * an exact query must hit, AND `channels` on the hit must contain `fts` -- a hit that
 *     arrived only through the vector channel would satisfy "the result is non-empty" while
 *     the property under test is false.
 *   * a paraphrase (no lexical overlap at all) must hit through `vector` -- otherwise "FTS
 *     matters" could be satisfied by a system with only an FTS channel, which is the other
 *     way the hybrid claim goes false.
 *
 * Neither result may be empty (V11 says so in as many words).
 *
 * ## Chinese segmentation is the thing being exercised, not assumed
 *
 * The tokenizer is bigram-based (migration 0009) because no segmenter extension ships in the
 * base image. That choice is invisible in a test written in English, so the fixtures are
 * Chinese, English and mixed, and the mixed one is the point: a scheme that handles each
 * script by switching between them fails on the sentence that contains both.
 */

const ORG = "org-f10-fts";
const PROJECT = "proj-f10-fts";
const MODEL = { model: "fixture-embed", modelVersion: "1" };

/** Fixture vectors. The paraphrase sits next to the document it paraphrases; nothing else does. */
const V = {
  maintenance: [1, 0, 0, 0],
  paraphrase: [0.98, 0.2, 0, 0],
  unrelated: [0, 0, 1, 0],
} as const;

let db: PgDatabase;
let deps: RetrieveDeps;

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  db = new PgDatabase(appConfig());
  deps = {
    repo: new PgIdentityRepository(db),
    ids: new CountingDecisionIdFactory(),
    retriever: new PgSegmentRetriever(db),
    embeddings: new TableEmbedding(MODEL.model, MODEL.modelVersion, {
      "长期持有的开销": V.paraphrase,
      "证据链比预算更紧缺": V.maintenance,
      "\"证据链比预算更紧缺\"": V.maintenance,
      "ISO 27001": V.unrelated,
      "王工": V.unrelated,
      "SLA 承诺": V.unrelated,
    }),
    rerank: new IdentityRerank(),
  };
  await registerEmbeddingModel(MODEL.model, MODEL.modelVersion, 4);
});

afterAll(async () => {
  await db.close();
});

beforeEach(async () => {
  await resetOrgs(ORG);
  const fx = await seedOrg({ orgId: ORG, projectId: PROJECT });
  await addOrgMember(ORG, "u-r", "consultant", fx.teams.energy!);
  await addProjectMember(ORG, PROJECT, "u-r", "facilitator", null);

  await indexSegment({
    orgId: ORG, segmentId: "s-quote", artifactId: "a-quote", projectId: PROJECT,
    content: "受访者原话：证据链比预算更紧缺，这是我们最头疼的地方。",
    sourceType: "interview",
  });
  await indexSegment({
    orgId: ORG, segmentId: "s-code", artifactId: "a-code", projectId: PROJECT,
    content: "合规基线参照 ISO 27001 与 SOC 2 Type II 的控制项清单。",
    sourceType: "file",
  });
  await indexSegment({
    orgId: ORG, segmentId: "s-name", artifactId: "a-name", projectId: PROJECT,
    content: "现场由 王工 负责设备接入，SLA 承诺 99.9% 可用性。",
    sourceType: "workshop",
  });
  await indexSegment({
    orgId: ORG, segmentId: "s-para", artifactId: "a-para", projectId: PROJECT,
    // Deliberately shares NO token with "长期持有的开销": no character bigram overlaps, so FTS
    // cannot reach it and only the vector channel can. That is what makes the second arm real.
    content: "维保与备件的年度支出远高于一次性采购价。",
    sourceType: "deep-research",
  });
  await addEmbedding({ orgId: ORG, segmentId: "s-para", ...MODEL, vector: V.maintenance });
  await addEmbedding({ orgId: ORG, segmentId: "s-quote", ...MODEL, vector: V.unrelated });
});

const run = (query: string, task: "search" | "answer" = "answer") =>
  retrieveCandidates(deps, {
    userId: "u-r", orgId: toOrgId(ORG), projectId: PROJECT, task,
    query, timeRange: null, limit: 20,
  });

describe("V11 arm 1 -- an exact query hits, and it hits THROUGH fts", () => {
  it("a verbatim quotation", async () => {
    const out = await run("证据链比预算更紧缺");
    const hit = out.ranked.find((r) => r.row.segmentId === "s-quote");
    expect(hit, "the exact quotation was not retrieved at all").toBeDefined();
    // The property. A hit is not enough -- it has to have come through the FTS channel.
    expect(hit!.channels).toContain("fts");
    expect(out.ranked.length).toBeGreaterThan(0);
  });

  it("a reference number", async () => {
    const out = await run("ISO 27001");
    const hit = out.ranked.find((r) => r.row.segmentId === "s-code");
    expect(hit).toBeDefined();
    expect(hit!.channels).toContain("fts");
  });

  it("a person's name", async () => {
    const out = await run("王工");
    const hit = out.ranked.find((r) => r.row.segmentId === "s-name");
    expect(hit).toBeDefined();
    expect(hit!.channels).toContain("fts");
  });

  it("a mixed CN/EN query reaches a mixed CN/EN document", async () => {
    // The case a per-script strategy fails on: one query, both scripts, one index -- the Latin
    // token comes from `simple` and the CJK one from the bigram pass, and the AND is satisfied
    // only if BOTH passes reached the same document.
    const out = await run("SLA 承诺");
    const hit = out.ranked.find((r) => r.row.segmentId === "s-name");
    expect(hit, "mixed-script retrieval failed").toBeDefined();
    expect(hit!.channels).toContain("fts");
  });

  it("counter-proof: a query with no lexical overlap does NOT reach it through fts", async () => {
    // Without this, "fts is in channels" could be satisfied by an FTS channel that returns the
    // whole corpus for every query -- which would also make every assertion above pass.
    const out = await run("长期持有的开销");
    const viaFts = out.ranked.filter((r) => r.channels.includes("fts")).map((r) => r.row.segmentId);
    expect(viaFts).not.toContain("s-para");
    expect(viaFts).not.toContain("s-quote");
  });
});

describe("V11 arm 2 -- a paraphrase hits through the vector channel", () => {
  it("the reworded query reaches the document, and only vector could have done it", async () => {
    const out = await run("长期持有的开销");
    const hit = out.ranked.find((r) => r.row.segmentId === "s-para");
    expect(hit, "the paraphrase was not retrieved -- the vector channel is not doing its job")
      .toBeDefined();
    expect(hit!.channels).toContain("vector");
    // Shares no token with the document, so FTS provably did not contribute this hit.
    expect(hit!.channels).not.toContain("fts");
  });

  it("neither arm returns an empty set -- V11 requires both to be non-empty", async () => {
    const exact = await run("证据链比预算更紧缺");
    const para = await run("长期持有的开销");
    expect(exact.ranked.length).toBeGreaterThan(0);
    expect(para.ranked.length).toBeGreaterThan(0);
  });

  it("counter-proof: an unrelated embedding does not put a document at the top", async () => {
    // The vector channel must be discriminating, not merely present. `s-quote` carries the
    // `unrelated` vector, so the paraphrase query must not rank it first.
    const out = await run("长期持有的开销");
    expect(out.ranked[0]!.row.segmentId).toBe("s-para");
  });
});

describe("the tokenizer itself", () => {
  it("index side and query side use the same function", async () => {
    // A tokenizer applied on only one side is the classic "search finds nothing, nothing
    // errors". Asserted at the database, because that is where the two sides meet.
    const r = await asOwner((c) =>
      c.query<{ hit: boolean }>(
        `SELECT wsx_tsvector('受访者原话：证据链比预算更紧缺。') @@ wsx_tsquery('证据链') AS hit`,
      ),
    );
    expect(r.rows[0]!.hit).toBe(true);
  });

  it("the FTS channel is AND over tokens, so an unrelated extra term rules a document out", async () => {
    // Precision is what makes this the exact-match channel rather than a worse vector channel.
    const r = await asOwner((c) =>
      c.query<{ hit: boolean }>(
        `SELECT wsx_tsvector('受访者原话：证据链比预算更紧缺。') @@ wsx_tsquery('证据链 排期表') AS hit`,
      ),
    );
    expect(r.rows[0]!.hit).toBe(false);
  });

  it("an empty query produces no query at all rather than matching everything", async () => {
    const r = await asOwner((c) =>
      c.query<{ q: string | null }>(`SELECT wsx_tsquery('   ')::text AS q`),
    );
    expect(r.rows[0]!.q).toBeNull();
  });

  it("mixed script tokenizes into both alphabets from one call", async () => {
    const r = await asOwner((c) =>
      c.query<{ v: string }>(`SELECT wsx_tsvector('SLA 承诺 99.9% 可用性')::text AS v`),
    );
    const v = r.rows[0]!.v;
    expect(v).toContain("sla"); // latin, via `simple`
    expect(v).toContain("承诺"); // CJK, via bigrams
    // ...and NOT the whole CJK run as one token: that is the bug that made every Chinese AND
    // query unsatisfiable, found by a failing test rather than by reading the SQL.
    expect(v).not.toContain("'承诺 99'");
  });
});

describe("query planning does not silently drop the exact channel", () => {
  it("a `search` task plans fts only -- and still plans it", async () => {
    const out = await run("ISO 27001", "search");
    expect(out.plan.map((p) => p.channel)).toContain("fts");
    // The identifier-only case: embedding "#4471" has no meaningful neighbourhood, so the
    // vector channel is skipped rather than run and ignored.
    expect(out.plan.map((p) => p.channel)).not.toContain("vector");
  });

  it("an exact-looking query weights fts above its baseline", async () => {
    const out = await run("\"证据链比预算更紧缺\"");
    const fts = out.plan.find((p) => p.channel === "fts")!;
    const plain = (await run("证据链比预算更紧缺")).plan.find((p) => p.channel === "fts")!;
    expect(fts.weight).toBeGreaterThan(plain.weight);
  });

  it("hitCount in the plan is the number that actually came back, per channel", async () => {
    const out = await run("证据链比预算更紧缺");
    const fts = out.plan.find((p) => p.channel === "fts")!;
    const viaFts = out.ranked.filter((r) => r.channels.includes("fts"));
    expect(fts.hitCount).toBe(viaFts.length);
    // Reverse: a plan reporting a hitCount for a channel that returned nothing would make the
    // retrievalPlan a decoration rather than an audit surface.
    const vector = out.plan.find((p) => p.channel === "vector");
    if (vector !== undefined) {
      expect(vector.hitCount).toBe(out.ranked.filter((r) => r.channels.includes("vector")).length);
    }
  });
});
