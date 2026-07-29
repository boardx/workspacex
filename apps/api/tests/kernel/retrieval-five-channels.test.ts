import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { contextPack as CP, omissionReason as OR } from "@repo/contracts";
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
import {
  IdentityRerank,
  TableEmbedding,
  addClaim,
  addEdge,
  addEmbedding,
  indexSegment,
  registerEmbeddingModel,
} from "../support/retrieval-fixtures";
import { appConfig } from "../../src/infrastructure/db/pg-config";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { PgIdentityRepository } from "../../src/infrastructure/identity/pg-identity-repository";
import { CountingDecisionIdFactory } from "../../src/infrastructure/identity/in-memory-session-store";
import { PgSegmentRetriever } from "../../src/infrastructure/retrieval/pg-segment-retriever";
import {
  RetrievalUnavailableError,
  retrieveCandidates,
  type RetrieveDeps,
} from "../../src/application/retrieval/retrieve-candidates";
import {
  RETRIEVAL_CHANNELS,
  analyzeQuery,
  applyWeightOverrides,
  planChannels,
} from "../../src/domain/retrieval/channel-plan";
import { applyRerank, fuse } from "../../src/domain/retrieval/rrf";
import {
  allocateChannelQuota,
  applyChannelBudget,
  assertQuotaSumWithinBudget,
} from "../../src/domain/retrieval/channel-budget";
import { toOrgId } from "../../src/domain/org-id";
import { disclose, guard } from "../../src/application/security/permission-filter";
import { PROPAGATION_PATHS } from "../../src/domain/identity/propagation-paths";
import { propagationPathFor, type SegmentRetriever } from "../../src/application/retrieval/ports";

/**
 * F10 -- five-way query-planned recall, permission-filtered, RRF-fused, reranked.
 *
 * The claim under test is not "a retrieval function exists". It is five separate claims that
 * each have their own way of being quietly false:
 *
 *   1. the plan VARIES with the query (a constant plan is not a plan)
 *   2. all five channels can actually reach a document (a channel wired to nothing returns []
 *      forever and looks like "no matches")
 *   3. the permission filter runs INSIDE recall, on the registered propagation paths
 *   4. what does not come back is EXPLAINED (`omissions[]`), except personal private notes,
 *      which must not even be named (I-8)
 *   5. the N-3 budget rules hold without knowing the N-3 numbers
 *
 * Every gate below has a counter-proof: an arrangement in which it must go the other way. A
 * filter that denies everything, a planner that returns nothing, a builder that emits an
 * omission for every candidate -- each would pass a one-sided assertion and be useless.
 */

const ORG = "org-f10-five";
const OTHER = "org-f10-five-other";
const PROJECT = "proj-f10-five";
const MODEL = { model: "fixture-embed", modelVersion: "1" };

let db: PgDatabase;
let retriever: PgSegmentRetriever;
let deps: RetrieveDeps;
let fx: Awaited<ReturnType<typeof seedOrg>>;

/** Four dimensions, fixture data. See `TableEmbedding` for why this is not a hash. */
const EMB = {
  budget: [1, 0, 0, 0],
  schedule: [0, 1, 0, 0],
  query维护成本: [0.95, 0.1, 0, 0],
} as const;

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  db = new PgDatabase(appConfig());
  retriever = new PgSegmentRetriever(db);
  deps = {
    repo: new PgIdentityRepository(db),
    ids: new CountingDecisionIdFactory(),
    retriever,
    embeddings: new TableEmbedding(MODEL.model, MODEL.modelVersion, {
      "维护成本": EMB.query维护成本,
      "预算": EMB.budget,
      "谁决定了预算": EMB.budget,
      "上个月的访谈": EMB.budget,
      "预算 与 排期": EMB.budget,
    }),
    rerank: new IdentityRerank(),
  };
  await registerEmbeddingModel(MODEL.model, MODEL.modelVersion, 4);
});

afterAll(async () => {
  await db.close();
});

beforeEach(async () => {
  await resetOrgs(ORG, OTHER);
  fx = await seedOrg({ orgId: ORG, projectId: PROJECT });
  await addOrgMember(ORG, "u-energy", "consultant", fx.teams.energy!);
  await addOrgMember(ORG, "u-platform", "consultant", fx.teams.platform!);
  await addProjectMember(ORG, PROJECT, "u-energy", "facilitator", null);
  await addProjectMember(ORG, PROJECT, "u-platform", "facilitator", null);
});

const run = (userId: string, query: string, over: Partial<Parameters<typeof retrieveCandidates>[1]> = {}) =>
  retrieveCandidates(deps, {
    userId,
    orgId: toOrgId(ORG),
    projectId: PROJECT,
    task: "answer",
    query,
    timeRange: null,
    limit: 20,
    ...over,
  });

/* ─────────────────────────── 1. the plan varies with the query ─────────────────────────── */

describe("query-planned: the plan is a function of the query, not a constant", () => {
  it("two different queries plan different channel sets", () => {
    const lookup = planChannels("search", analyzeQuery("#4471"));
    const decision = planChannels("decision-support", analyzeQuery("谁决定了预算，为什么"));

    const setOf = (p: readonly { channel: string }[]) => p.map((x) => x.channel).sort();
    expect(setOf(lookup)).not.toEqual(setOf(decision));
    // Named, not just "different": a planner that varied at random would pass a bare
    // inequality check while planning nonsense.
    expect(setOf(lookup)).toEqual(["fts"]);
    expect(setOf(decision)).toEqual(["claim", "fts", "graph", "vector"]);
  });

  it("a plan is never all five by default -- 'not always all five' is the claim", () => {
    const all = planChannels("answer", analyzeQuery("维护成本"));
    expect(all.map((p) => p.channel)).toEqual(["fts", "vector", "claim"]);
    expect(all.map((p) => p.channel)).not.toContain("graph");
    expect(all.map((p) => p.channel)).not.toContain("metadata");
    // ...and the metadata channel joins when the query actually constrains metadata.
    const timed = planChannels("answer", analyzeQuery("上个月的访谈说了什么"));
    expect(timed.map((p) => p.channel)).toContain("metadata");
  });

  it("`fts` is in every plan -- it cannot be planned away (V11)", () => {
    // Over a corpus of shapes rather than one example: the regression this guards against is
    // "the paraphrase-looking query dropped FTS", which one hand-picked query cannot catch.
    const shapes = [
      "#4471", "维护成本", "\"证据链比预算更紧缺\"", "上个月能源组做的访谈",
      "谁决定了预算", "ISO 27001", "how do we reduce churn",
    ];
    for (const task of CP.QueryTask.options) {
      for (const q of shapes) {
        expect(planChannels(task, analyzeQuery(q)).map((p) => p.channel), `${task} / ${q}`)
          .toContain("fts");
      }
    }
  });

  it("every planned channel has a positive weight -- a zero-weight channel is a lie", () => {
    for (const task of CP.QueryTask.options) {
      for (const p of planChannels(task, analyzeQuery("谁决定了上个月能源组访谈的预算"))) {
        expect(p.weight, `${task}/${p.channel}`).toBeGreaterThan(0);
        expect(p.why.length).toBeGreaterThan(10);
      }
    }
  });

  it("A3 weight overrides are recorded, not applied silently", () => {
    const base = planChannels("answer", analyzeQuery("维护成本"));
    const adjusted = applyWeightOverrides(base, { vector: 9 });
    const v = adjusted.find((p) => p.channel === "vector")!;
    expect(v.weight).toBe(9);
    expect(v.why).toContain("overridden");
    // Counter-proof: an override equal to the current weight is not an adjustment, and must
    // not leave a trace claiming the user changed something.
    const noop = applyWeightOverrides(base, { vector: base.find((p) => p.channel === "vector")!.weight });
    expect(noop.find((p) => p.channel === "vector")!.why).not.toContain("overridden");
  });
});

/* ─────────────────────── 2. all five channels reach a document ─────────────────────────── */

describe("all five channels are wired to something real", () => {
  beforeEach(async () => {
    await indexSegment({
      orgId: ORG, segmentId: "s-fts", artifactId: "a-fts", projectId: PROJECT,
      content: "受访者原话：证据链比预算更紧缺。编号 ISO 27001。",
      method: "访谈", cohort: "能源组", occurredAt: "2026-06-15T00:00:00Z",
    });
    await indexSegment({
      orgId: ORG, segmentId: "s-vec", artifactId: "a-vec", projectId: PROJECT,
      content: "长期持有的开销比一次性投入更值得关注。",
    });
    await indexSegment({
      orgId: ORG, segmentId: "s-graph", artifactId: "a-graph", projectId: PROJECT,
      content: "决策记录：由能源组组长拍板。",
    });
    await indexSegment({
      orgId: ORG, segmentId: "s-claim", artifactId: "a-claim", projectId: PROJECT,
      content: "支持证据：三位受访者提到同一件事。",
    });
    await addEmbedding({ orgId: ORG, segmentId: "s-vec", ...MODEL, vector: EMB.budget });
    await addEdge({
      orgId: ORG, id: "e1",
      src: { kind: "decision", id: "d-1" }, dst: { kind: "segment", id: "s-graph" },
      relation: "evidenced-by",
    });
    await addClaim({
      orgId: ORG, id: "c-1", projectId: PROJECT, statement: "预算 是主要约束", status: "accepted",
      supporting: ["s-claim"],
    });
  });

  it("each channel returns at least one row on its own terms", async () => {
    const q = {
      orgId: toOrgId(ORG), projectId: PROJECT, query: "预算", timeRange: null, limit: 10,
    };
    const reached: Record<string, number> = {
      fts: (await retriever.fts({ ...q, query: "证据链" })).length,
      vector: (await retriever.vector(q, EMB.budget, MODEL)).length,
      graph: (await retriever.graph(q, [{ kind: "decision", id: "d-1" }])).length,
      metadata: (await retriever.metadata({ ...q, query: "能源组的访谈" })).length,
      claim: (await retriever.claim({ ...q, query: "预算" })).candidates.length,
    };
    // Every channel, named. A single "some channel returned rows" assertion is exactly how
    // four working channels hide one that is wired to nothing.
    for (const c of RETRIEVAL_CHANNELS) {
      expect(reached[c], `channel ${c} reached nothing -- it is wired to nothing`).toBeGreaterThan(0);
    }
  });

  it("counter-proof: with the corpus emptied, every channel returns nothing", async () => {
    // Without this, the assertions above could be satisfied by channels that return the whole
    // table regardless of the query.
    await asApp(ORG, (c) => c.query("DELETE FROM segment_text WHERE org_id = $1", [ORG]));
    const q = { orgId: toOrgId(ORG), projectId: PROJECT, query: "预算", timeRange: null, limit: 10 };
    expect((await retriever.fts({ ...q, query: "证据链" })).length).toBe(0);
    expect((await retriever.vector(q, EMB.budget, MODEL)).length).toBe(0);
    expect((await retriever.graph(q, [{ kind: "decision", id: "d-1" }])).length).toBe(0);
    expect((await retriever.metadata({ ...q, query: "能源组的访谈" })).length).toBe(0);
    expect((await retriever.claim({ ...q, query: "预算" })).candidates.length).toBe(0);
  });

  it("the graph channel gives every hit the same score -- a fixed bonus, never a verdict", async () => {
    const rows = await retriever.graph(
      { orgId: toOrgId(ORG), projectId: PROJECT, query: "x", timeRange: null, limit: 10 },
      [{ kind: "decision", id: "d-1" }],
    );
    expect(rows.length).toBeGreaterThan(0);
    // Asserted through the ranking, since the payload is (correctly) unreachable here: the plan
    // pins the graph weight to the fixed bonus and nothing per-edge can change it.
    const planned = planChannels("decision-support", analyzeQuery("谁决定了预算"));
    expect(planned.find((p) => p.channel === "graph")!.weight).toBe(0.5);
  });

  it("graph traversal stops at depth 2 -- an uncapped walk is graph-first by accident", async () => {
    await indexSegment({
      orgId: ORG, segmentId: "s-far", artifactId: "a-far", projectId: PROJECT, content: "远端",
    });
    await addEdge({ orgId: ORG, id: "e2", src: { kind: "segment", id: "s-graph" }, dst: { kind: "person", id: "p-1" }, relation: "mentions" });
    await addEdge({ orgId: ORG, id: "e3", src: { kind: "person", id: "p-1" }, dst: { kind: "project", id: "pr-1" }, relation: "member-of" });
    await addEdge({ orgId: ORG, id: "e4", src: { kind: "project", id: "pr-1" }, dst: { kind: "segment", id: "s-far" }, relation: "has" });

    const rows = await retriever.graph(
      { orgId: toOrgId(ORG), projectId: PROJECT, query: "x", timeRange: null, limit: 50 },
      [{ kind: "decision", id: "d-1" }],
    );
    const ids = rows.map((r) => r.ref.id);
    expect(ids).toContain("s-graph"); // depth 1
    expect(ids).not.toContain("s-far"); // depth 4
  });
});

/* ───────────────── 3. the permission filter runs inside recall ─────────────────────────── */

describe("permission travels with the recall, on the registered paths (X-1 / R7)", () => {
  beforeEach(async () => {
    await indexSegment({
      orgId: ORG, segmentId: "s-open", artifactId: "a-open", projectId: PROJECT,
      content: "公开材料：预算 讨论纪要。",
    });
    await indexSegment({
      orgId: ORG, segmentId: "s-team", artifactId: "a-team", projectId: PROJECT,
      content: "受限材料：预算 的内部口径。",
    });
    await addEmbedding({ orgId: ORG, segmentId: "s-open", ...MODEL, vector: EMB.budget });
    await addEmbedding({ orgId: ORG, segmentId: "s-team", ...MODEL, vector: EMB.budget });
    await addBinding({
      orgId: ORG, subject: { kind: "team", id: fx.teams.energy! },
      object: { kind: "artifact", id: "a-team" }, scope: "team-only", ownerTeamId: fx.teams.energy!,
    });
  });

  it("someone outside the owning team gets the open row and an `unauthorized` omission", async () => {
    const out = await run("u-platform", "预算");
    expect(out.ranked.map((r) => r.row.segmentId)).toEqual(["s-open"]);
    expect(out.omissions).toEqual([
      {
        ref: "s-team",
        reason: "unauthorized",
        compliance: true,
        explain: OR.omissionExplain("unauthorized"),
      },
    ]);
    // The withheld row's content never travels, in any shape.
    expect(JSON.stringify(out)).not.toContain("内部口径");
  });

  it("counter-proof: someone INSIDE the owning team gets both and no omission", async () => {
    // A filter that denied everything would pass the test above and be worthless.
    const out = await run("u-energy", "预算");
    expect(out.ranked.map((r) => r.row.segmentId).sort()).toEqual(["s-open", "s-team"]);
    expect(out.omissions).toEqual([]);
  });

  it("each candidate's decision id comes from a judgement made for THIS requester (I-11)", async () => {
    // "Non-empty" is not the property. `"dec-1"` is non-empty and answers nothing. What is
    // asserted is that the ids are MINTED per judgement: two requesters over the same corpus
    // must not share one, and no candidate may reuse another's.
    const a = await run("u-energy", "预算");
    const b = await run("u-energy", "预算");
    const idsA = a.ranked.map((r) => r.permissionDecisionId);
    expect(idsA.length).toBeGreaterThan(0);
    for (const id of idsA) expect(id).not.toBe("");
    expect(new Set(idsA).size, "two candidates shared one decision").toBe(idsA.length);
    // A second run judges again: an id reused across runs would mean a cached verdict was
    // handed back without a decision, which is the sixth propagation path's failure mode.
    expect(idsA.some((id) => b.ranked.some((r) => r.permissionDecisionId === id))).toBe(false);
  });

  it("the vector channel is judged on `embedding-similarity`, the rest on `retrieval`", async () => {
    // Both are registered to F10 in PROPAGATION_PATHS, and they are not interchangeable
    // labels: R7 lists them separately because a document surfaced by vector similarity was
    // not surfaced by anything the user typed. Routing everything down `retrieval` would leave
    // a registered path with no traffic while the coverage claim was made on its behalf.
    expect(propagationPathFor("vector")).toBe("embedding-similarity");
    for (const c of RETRIEVAL_CHANNELS.filter((x) => x !== "vector")) {
      expect(propagationPathFor(c)).toBe("retrieval");
    }
    const registered = PROPAGATION_PATHS.map((p) => p.id);
    expect(registered).toContain("retrieval");
    expect(registered).toContain("embedding-similarity");
    // ...and an unregistered path cannot be used at all -- the guard throws rather than
    // judging, because a path outside the enumeration is a programming error, not a verdict.
    await expect(
      disclose(deps, {
        userId: "u-energy", orgId: toOrgId(ORG), projectId: PROJECT, action: "read.allHands",
        path: "sneaky-side-door" as never,
        items: [guard({ kind: "segment", id: "x" }, { any: 1 })],
      }),
    ).rejects.toThrow(/unknown propagation path/);
  });

  it("another tenant's rows are invisible even with the same segment ids in play", async () => {
    const other = await seedOrg({ orgId: OTHER, projectId: `${OTHER}-p` });
    await addOrgMember(OTHER, "u-energy", "consultant", other.teams.energy!);
    await indexSegment({
      orgId: OTHER, segmentId: "s-other", artifactId: "a-other", projectId: `${OTHER}-p`,
      content: "别的租户的 预算 材料。",
    });
    const out = await run("u-energy", "预算");
    expect(out.ranked.map((r) => r.row.segmentId)).not.toContain("s-other");
    expect(out.omissions.map((o) => o.ref)).not.toContain("s-other");
  });
});

/* ─────────────────── 4. what does not come back is explained (or unnameable) ───────────── */

describe("被丢弃不等于不存在 -- and the one case where naming it is the leak", () => {
  it("a revoked segment is permanently excluded AND explained as `withdrawn` (R3 排除)", async () => {
    await indexSegment({
      orgId: ORG, segmentId: "s-gone", artifactId: "a-gone", projectId: PROJECT,
      content: "已撤销的 预算 结论。", lifecycle: "revoked",
    });
    const out = await run("u-energy", "预算");
    expect(out.ranked.map((r) => r.row.segmentId)).not.toContain("s-gone");
    const om = out.omissions.find((o) => o.ref === "s-gone");
    expect(om?.reason).toBe("withdrawn");
    expect(om?.compliance).toBe(true); // I-4: never folded away
  });

  it("a personal PRIVATE note is in neither items nor omissions -- I-8, not even its existence", async () => {
    await indexSegment({
      orgId: ORG, segmentId: "s-note", artifactId: "a-note", projectId: null,
      content: "我的私人笔记：预算 我觉得不靠谱。", layer: "personal", private: true,
    });
    const out = await run("u-energy", "预算");
    expect(out.ranked.map((r) => r.row.segmentId)).not.toContain("s-note");
    // The half that a "filter it out afterwards" implementation gets wrong, and the reason
    // the exclusion is a SQL predicate: an omission record leaks that the note exists.
    expect(out.omissions.map((o) => o.ref)).not.toContain("s-note");
  });

  it("counter-proof: the same note RAISED to the project layer is retrievable", async () => {
    // Without this, "personal notes are excluded" would be satisfied by an implementation that
    // excludes everything personal, including what the owner deliberately shared (R3 step 2).
    await indexSegment({
      orgId: ORG, segmentId: "s-shared", artifactId: "a-shared", projectId: null,
      content: "我升到项目层的判断：预算 是主要约束。", layer: "personal", private: false,
    });
    const out = await run("u-energy", "预算");
    expect(out.ranked.map((r) => r.row.segmentId)).toContain("s-shared");
  });

  it("an out-of-scope segment is downweighted and kept, not excluded (R3 降权)", async () => {
    await indexSegment({
      orgId: ORG, segmentId: "s-cross", artifactId: "a-cross", projectId: PROJECT,
      content: "跨范围的 预算 参考。", inScope: false,
    });
    const out = await run("u-energy", "预算");
    const c = out.ranked.find((r) => r.row.segmentId === "s-cross");
    expect(c, "an applicability mismatch must not exclude").toBeDefined();
    expect(c!.retrievalReasons).toContain("downweight");
    expect(c!.retrievalReasons).toContain("recall");
  });

  it("a contested claim's opposing evidence survives untouched (R7 / I-12)", async () => {
    await indexSegment({ orgId: ORG, segmentId: "s-for", artifactId: "a-for", projectId: PROJECT, content: "支持：预算 够用。" });
    await indexSegment({ orgId: ORG, segmentId: "s-against", artifactId: "a-against", projectId: PROJECT, content: "反对：预算 不够。" });
    await addClaim({
      orgId: ORG, id: "c-x", projectId: PROJECT, statement: "预算 够用", status: "contested",
      supporting: ["s-for"], contradicting: ["s-against"],
    });
    const out = await run("u-energy", "预算");
    const claim = out.claims.find((c) => c.statement === "预算 够用")!;
    expect(claim.contradictingSegmentIds).toEqual(["s-against"]);
    // Both sides marked `paired`: the engine injects the pair and does not choose (R3 成对).
    for (const id of ["s-for", "s-against"]) {
      expect(out.ranked.find((r) => r.row.segmentId === id)?.retrievalReasons).toContain("paired");
    }
  });

  it("contradicting ids are NOT narrowed to what the requester may read", async () => {
    // The most natural-looking way to break I-12 is to tidy away references to segments that
    // did not survive the permission filter. It reads as removing dangling pointers.
    await indexSegment({ orgId: ORG, segmentId: "s-for2", artifactId: "a-for2", projectId: PROJECT, content: "支持：预算 够用。" });
    await indexSegment({ orgId: ORG, segmentId: "s-secret", artifactId: "a-secret", projectId: PROJECT, content: "反对：预算 不够（受限）。" });
    await addBinding({
      orgId: ORG, subject: { kind: "team", id: fx.teams.energy! },
      object: { kind: "artifact", id: "a-secret" }, scope: "team-only", ownerTeamId: fx.teams.energy!,
    });
    await addClaim({
      orgId: ORG, id: "c-y", projectId: PROJECT, statement: "预算 够用 吗", status: "contested",
      supporting: ["s-for2"], contradicting: ["s-secret"],
    });

    const out = await run("u-platform", "预算");
    const claim = out.claims.find((c) => c.statement === "预算 够用 吗")!;
    expect(claim.contradictingSegmentIds).toEqual(["s-secret"]);
    // ...and the TEXT still does not travel. The id is a reference; permission governs content.
    expect(JSON.stringify(out.ranked)).not.toContain("受限");
    expect(out.omissions.map((o) => o.ref)).toContain("s-secret");
  });
});

/* ───────────────────────── 5. fusion and rerank properties ─────────────────────────────── */

describe("RRF fusion and rerank", () => {
  it("a document reached by two channels outranks one reached by a single channel at the same rank", () => {
    const fused = fuse([
      { channel: "fts", weight: 1, ids: ["a", "b"] },
      { channel: "vector", weight: 1, ids: ["b", "a"] },
      { channel: "graph", weight: 0.5, ids: ["b"] },
    ]);
    expect(fused[0]!.id).toBe("b");
    expect(fused[0]!.channels).toEqual(["fts", "vector", "graph"]);
    expect(fused[0]!.ranks).toEqual({ fts: 2, vector: 1, graph: 1 });
  });

  it("ties break deterministically -- replay stability (I-5) with no retrieval involved", () => {
    const once = fuse([{ channel: "fts", weight: 1, ids: ["z", "a"] }, { channel: "vector", weight: 1, ids: ["a", "z"] }]);
    const twice = fuse([{ channel: "vector", weight: 1, ids: ["a", "z"] }, { channel: "fts", weight: 1, ids: ["z", "a"] }]);
    expect(once.map((f) => f.id)).toEqual(twice.map((f) => f.id));
  });

  it("a duplicate row from one channel does not double-count it", () => {
    const single = fuse([{ channel: "fts", weight: 1, ids: ["a"] }]);
    const doubled = fuse([{ channel: "fts", weight: 1, ids: ["a", "a"] }]);
    expect(doubled[0]!.score).toBe(single[0]!.score);
    expect(doubled[0]!.channels).toEqual(["fts"]);
  });

  it("a reranker may reorder but never drop", () => {
    const fused = fuse([{ channel: "fts", weight: 1, ids: ["a", "b", "c"] }]);
    // Judge mentions one document; the rest keep their fused order behind it.
    expect(applyRerank(fused, ["c"]).map((f) => f.id)).toEqual(["c", "a", "b"]);
  });

  it("a reranker that invents a document is refused, loudly", () => {
    const fused = fuse([{ channel: "fts", weight: 1, ids: ["a"] }]);
    expect(() => applyRerank(fused, ["a", "ghost"])).toThrow(/not in the fused candidate set/);
  });
});

/* ─────────────────────── dependency failure blocks, never degrades ─────────────────────── */

describe("a channel failure blocks the assembly (E3 / V6)", () => {
  it("raises RETRIEVAL_UNAVAILABLE rather than returning four channels' worth", async () => {
    await indexSegment({
      orgId: ORG, segmentId: "s-ok", artifactId: "a-ok", projectId: PROJECT, content: "预算 材料。",
    });
    const broken: SegmentRetriever = {
      ...retriever,
      fts: retriever.fts.bind(retriever),
      vector: async () => { throw new Error("pgvector down"); },
      graph: retriever.graph.bind(retriever),
      metadata: retriever.metadata.bind(retriever),
      claim: retriever.claim.bind(retriever),
    };
    await expect(
      retrieveCandidates({ ...deps, retriever: broken }, {
        userId: "u-energy", orgId: toOrgId(ORG), projectId: PROJECT, task: "answer",
        query: "维护成本", timeRange: null, limit: 10,
      }),
    ).rejects.toThrow(RetrievalUnavailableError);
  });

  it("the error carries the contract's reason code, not a message somebody parses", async () => {
    const e = new RetrievalUnavailableError("vector", new Error("x"));
    expect(e.reason).toBe("RETRIEVAL_UNAVAILABLE");
    expect(CP.ContextPackReason.options).toContain(e.reason);
  });
});

/* ───────────────── 6. the N-3 budget rules, without the N-3 numbers ────────────────────── */

describe("token budget across the five channels (threshold N-3, values undecided)", () => {
  it("the quotas sum to no more than the total budget", () => {
    const a = allocateChannelQuota(1000, [...RETRIEVAL_CHANNELS]);
    expect(a.quotas.reduce((n, q) => n + q.tokens, 0)).toBeLessThanOrEqual(1000);
    // ...and the allocation says out loud that it is not a decided policy.
    expect(a.provisional).toBe(true);
    expect(a.source).toContain("N-3");
  });

  it("an over-allocation is refused rather than producing an unpredicted truncation", () => {
    expect(() =>
      assertQuotaSumWithinBudget([{ channel: "fts", tokens: 600 }, { channel: "vector", tokens: 600 }], 1000),
    ).toThrow(/N-3/);
  });

  it("every truncated candidate produces its OWN `budget` omission", () => {
    const a = allocateChannelQuota(100, ["fts"]);
    const out = applyChannelBudget(
      [
        { segmentId: "s1", channel: "fts", tokens: 60 },
        { segmentId: "s2", channel: "fts", tokens: 60 },
        { segmentId: "s3", channel: "fts", tokens: 60 },
      ],
      a,
    );
    expect(out.kept.map((k) => k.segmentId)).toEqual(["s1"]);
    // Per document, not one note per channel: "why is THIS not here" is the question asked.
    expect(out.omissions.map((o) => o.ref)).toEqual(["s2", "s3"]);
    expect(out.omissions.every((o) => o.reason === "budget")).toBe(true);
    expect(out.omissions.every((o) => o.compliance === OR.isComplianceOmission("budget"))).toBe(true);
  });

  it("counter-proof: nothing truncated means no omissions at all", () => {
    const out = applyChannelBudget(
      [{ segmentId: "s1", channel: "fts", tokens: 10 }],
      allocateChannelQuota(100, ["fts"]),
    );
    expect(out.omissions).toEqual([]);
    expect(out.kept).toHaveLength(1);
  });

  it("a manually pinned item that does not fit is an ERROR, not a quiet discard (E2)", () => {
    const out = applyChannelBudget(
      [{ segmentId: "s-manual", channel: "fts", tokens: 999, manual: true }],
      allocateChannelQuota(100, ["fts"]),
    );
    expect(out.manualOverflow.map((m) => m.segmentId)).toEqual(["s-manual"]);
    // Specifically NOT reported as a budget omission -- that is the silent version E2 forbids.
    expect(out.omissions).toEqual([]);
  });
});

/* ──────────────────────── contract parity, in both directions ──────────────────────────── */

describe("the schema, the database and the code agree", () => {
  it("segment_text.source_type is exactly ContextSourceType", async () => {
    const r = await asOwner((c) =>
      c.query<{ def: string }>(
        `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
          WHERE conrelid = 'segment_text'::regclass AND conname LIKE '%source_type%'`,
      ),
    );
    const inDb = [...(r.rows[0]?.def ?? "").matchAll(/'([a-z-]+)'/g)].map((m) => m[1]!).sort();
    expect(inDb).toEqual([...CP.ContextSourceType.options].sort());
  });

  it("claims.status is exactly ClaimStatus", async () => {
    const r = await asOwner((c) =>
      c.query<{ def: string }>(
        `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
          WHERE conrelid = 'claims'::regclass AND conname LIKE '%status%'`,
      ),
    );
    const inDb = [...(r.rows[0]?.def ?? "").matchAll(/'([a-z-]+)'/g)].map((m) => m[1]!).sort();
    expect(inDb).toEqual([...CP.ClaimStatus.options].sort());
  });

  it("the channel list is the contract's, and closedness is what is asserted -- not a count", async () => {
    // E-4's lesson: `toHaveLength(5)` would fail a properly reviewed ADR that adds a sixth.
    // What must hold is that the set matches and that an unregistered value is refused.
    expect([...RETRIEVAL_CHANNELS].sort()).toEqual([...CP.RetrievalChannel.options].sort());
    expect(CP.RetrievalChannel.safeParse("elastic").success).toBe(false);
  });

  it("the emitted retrieval plan validates against the contract, and a drifted one does not", async () => {
    await indexSegment({
      orgId: ORG, segmentId: "s-plan", artifactId: "a-plan", projectId: PROJECT, content: "预算 材料。",
    });
    const out = await run("u-energy", "预算");
    expect(out.plan.length).toBeGreaterThan(0);
    for (const p of out.plan) expect(CP.RetrievalChannelPlan.safeParse(p).success).toBe(true);
    // Reverse assertion: without it, the loop above would pass on an empty plan or against a
    // schema that accepts anything.
    expect(CP.RetrievalChannelPlan.safeParse({ channel: "fts", weight: 1, hitCount: -1 }).success).toBe(false);
    expect(CP.RetrievalChannelPlan.safeParse({ channel: "elastic", weight: 1, hitCount: 0 }).success).toBe(false);
  });

  it("every emitted omission is a legal Omission and every reason is in the closed set", async () => {
    await indexSegment({
      orgId: ORG, segmentId: "s-rev2", artifactId: "a-rev2", projectId: PROJECT,
      content: "撤销的 预算 材料。", lifecycle: "revoked",
    });
    const out = await run("u-energy", "预算");
    expect(out.omissions.length).toBeGreaterThan(0);
    for (const o of out.omissions) {
      expect(CP.Omission.safeParse(o).success).toBe(true);
      expect(OR.OMISSION_REASON_KEYS).toContain(o.reason);
    }
    expect(CP.Omission.safeParse({ ref: "x", reason: "made-up", compliance: false, explain: "y" }).success)
      .toBe(false);
  });
});
