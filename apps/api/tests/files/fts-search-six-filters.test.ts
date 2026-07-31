/**
 * F33 -- two claims, both against real PostgreSQL:
 *
 *   1. `listProjectArtifacts`'s six filters COMPOSE (AND, not "whichever one is set wins" and
 *      not OR): sourceType / agendaSegmentId / timeRange / uploader / confidential /
 *      ingestionState. Each of four "near miss" fixtures satisfies five of the six and fails
 *      exactly one -- if any filter were silently ignored, or if the WHERE clause were OR'd
 *      instead of AND'd, one of them would leak into the result.
 *   2. `searchArtifacts` returns a REAL snippet + anchor for a non-confidential hit (F33 fills
 *      in what F31 always returned null for), and stays fail-closed (filename only, no
 *      snippet/anchor) for a CONFIDENTIAL hit -- T-6's unruled half, taken on the closed
 *      branch (`files.KNOWN_CONTRACT_GAPS.FS4`).
 */
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import {
  addOrgMember, addProjectMember, asApp, ensureDatabase, migrateOnce, resetOrgs, seedOrg,
} from "../support/db";
import { addBrowserArtifact } from "../support/files-db";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { appConfig } from "../../src/infrastructure/db/pg-config";
import { PgArtifactBrowserRepository } from "../../src/infrastructure/files/pg-artifact-browser-repository";
import { ObjectStoreHeadProbe } from "../../src/infrastructure/files/object-store-head-probe";
import { PgIdentityRepository } from "../../src/infrastructure/identity/pg-identity-repository";
import { listProjectArtifacts, searchArtifacts, type BrowseDeps } from "../../src/application/files/browse-artifacts";
import { toOrgId } from "../../src/domain/org-id";
import type { ObjectStore } from "../../src/application/artifact/ports";

const ORG = "org-f33-search";
const PROJECT = "proj-f33-search";

class SeqIds {
  private n = 0;
  next(): string { return `d-${++this.n}`; }
}
const STORE_UP: ObjectStore = {
  async putOnce() {}, async get() { return null; }, async head() { return null; },
};

let db: PgDatabase;
let deps: BrowseDeps;

/** All six filters, satisfied simultaneously only by `f33fs-target`. */
const SIX_FILTERS = {
  sourceType: ["interview"],
  agendaSegmentId: ["seg-target"],
  timeRange: { from: "2020-06-01T00:00:00Z", to: "2020-06-30T23:59:59Z" },
  uploader: { type: "agent" as const, id: "agent-writer" },
  confidential: true,
  ingestionState: ["REVIEW_PENDING"] as const,
};

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  await resetOrgs(ORG);

  await seedOrg({ orgId: ORG, projectId: PROJECT, teamNames: ["energy"] });
  await addOrgMember(ORG, "u-fac", "consultant", `${ORG}-team-energy`);
  await addProjectMember(ORG, PROJECT, "u-fac", "facilitator", null, true);

  const agent = { kind: "agent" as const, id: "agent-writer", runId: "run-1" };
  const human = { kind: "user" as const, id: "u-someone-else" };

  // Satisfies all six.
  await addBrowserArtifact({
    orgId: ORG, id: "f33fs-target", projectId: PROJECT, source: "interview",
    agendaSegmentId: "seg-target", confidential: true, ingestionStatus: "REVIEW_PENDING",
    creator: agent,
  });
  // Fails ONLY sourceType (upload, not interview).
  await addBrowserArtifact({
    orgId: ORG, id: "f33fs-wrong-source", projectId: PROJECT, source: "upload",
    agendaSegmentId: "seg-target", confidential: true, ingestionStatus: "REVIEW_PENDING",
    creator: agent,
  });
  // Fails ONLY agendaSegmentId.
  await addBrowserArtifact({
    orgId: ORG, id: "f33fs-wrong-segment", projectId: PROJECT, source: "interview",
    agendaSegmentId: "seg-other", confidential: true, ingestionStatus: "REVIEW_PENDING",
    creator: agent,
  });
  // Fails ONLY confidential (false, not true).
  await addBrowserArtifact({
    orgId: ORG, id: "f33fs-not-confidential", projectId: PROJECT, source: "interview",
    agendaSegmentId: "seg-target", confidential: false, ingestionStatus: "REVIEW_PENDING",
    creator: agent,
  });
  // Fails ONLY ingestionState (READY, not REVIEW_PENDING).
  await addBrowserArtifact({
    orgId: ORG, id: "f33fs-wrong-state", projectId: PROJECT, source: "interview",
    agendaSegmentId: "seg-target", confidential: true, ingestionStatus: "READY",
    creator: agent,
  });
  // Fails ONLY uploader (a different human, not the agent).
  await addBrowserArtifact({
    orgId: ORG, id: "f33fs-wrong-uploader", projectId: PROJECT, source: "interview",
    agendaSegmentId: "seg-target", confidential: true, ingestionStatus: "REVIEW_PENDING",
    creator: human,
  });
  // Fails ONLY timeRange -- every other dimension matches SIX_FILTERS, but this row is left at
  // `now()` (seeded below, never backdated), outside the 2020 window the other six rows are
  // moved into.
  await addBrowserArtifact({
    orgId: ORG, id: "f33fs-wrong-time", projectId: PROJECT, source: "interview",
    agendaSegmentId: "seg-target", confidential: true, ingestionStatus: "REVIEW_PENDING",
    creator: agent,
  });

  // `created_at` for every row above (EXCEPT `f33fs-wrong-time`) defaults to `now()`, which is
  // NOT inside SIX_FILTERS's 2020 window. Each near-miss must be moved INTO the window too --
  // otherwise dropping its one designated filter would still leave it excluded by `timeRange`,
  // and the "isolates exactly one dimension" property this test exists to check would be false.
  await asApp(ORG, (c) =>
    c.query(
      `UPDATE artifacts SET created_at = '2020-06-15T12:00:00Z'
        WHERE org_id = $1 AND id = ANY($2::text[])`,
      [ORG, [
        "f33fs-target", "f33fs-wrong-source", "f33fs-wrong-segment",
        "f33fs-not-confidential", "f33fs-wrong-state", "f33fs-wrong-uploader",
      ]],
    ),
  );

  // FTS + snippet/anchor fixtures.
  await addBrowserArtifact({
    orgId: ORG, id: "f33fs-open-hit", projectId: PROJECT, title: "open notes",
    confidential: false, text: "a mention of the quarterly roadmap review in plain text",
  });
  await addBrowserArtifact({
    orgId: ORG, id: "f33fs-confidential-hit", projectId: PROJECT, title: "secret notes",
    confidential: true, text: "a mention of the quarterly roadmap review in a confidential file",
  });

  db = new PgDatabase(appConfig());
  deps = {
    repo: new PgIdentityRepository(db),
    ids: new SeqIds(),
    browser: new PgArtifactBrowserRepository(db),
    objectStore: new ObjectStoreHeadProbe(STORE_UP),
  };
});

afterAll(async () => {
  await db?.close();
  await resetOrgs(ORG);
});

describe("六项筛选可组合（AND，不是最后一个赢，也不是 OR）", () => {
  it("all six together select exactly the one row that satisfies all six", async () => {
    const r = await listProjectArtifacts(deps, {
      userId: "u-fac", orgId: toOrgId(ORG), projectId: PROJECT,
      filters: SIX_FILTERS, cursor: null, pageSize: null,
    });
    expect(r.nodes.map((n) => n.artifactId)).toEqual(["f33fs-target"]);
  });

  it("dropping any ONE filter widens the result -- proving that filter was doing work", async () => {
    const widenedBy = async (drop: keyof typeof SIX_FILTERS): Promise<string[]> => {
      const filters = { ...SIX_FILTERS, [drop]: drop === "confidential" ? null : (Array.isArray(SIX_FILTERS[drop]) ? [] : null) };
      const r = await listProjectArtifacts(deps, {
        userId: "u-fac", orgId: toOrgId(ORG), projectId: PROJECT,
        filters: filters as typeof SIX_FILTERS, cursor: null, pageSize: null,
      });
      return r.nodes.map((n) => n.artifactId).sort();
    };

    expect(await widenedBy("sourceType")).toContain("f33fs-wrong-source");
    expect(await widenedBy("agendaSegmentId")).toContain("f33fs-wrong-segment");
    expect(await widenedBy("confidential")).toContain("f33fs-not-confidential");
    expect(await widenedBy("ingestionState")).toContain("f33fs-wrong-state");
    expect(await widenedBy("uploader")).toContain("f33fs-wrong-uploader");
    expect(await widenedBy("timeRange")).toContain("f33fs-wrong-time");
  });

  it("dropping any single filter still excludes the near-misses of the OTHER five dimensions", async () => {
    // Each near-miss fixture was moved into the 2020 window (or, for `f33fs-wrong-time`, left
    // outside it) so it fails EXACTLY one dimension. Widening `sourceType` alone must not also
    // surface `f33fs-wrong-segment` (a different dimension) -- if it did, the filters would not
    // be independent AND-clauses, they would be sharing some accidental OR.
    const widenedBySourceType = await listProjectArtifacts(deps, {
      userId: "u-fac", orgId: toOrgId(ORG), projectId: PROJECT,
      filters: { ...SIX_FILTERS, sourceType: [] }, cursor: null, pageSize: null,
    });
    const ids = widenedBySourceType.nodes.map((n) => n.artifactId).sort();
    expect(ids).toEqual(["f33fs-target", "f33fs-wrong-source"]);
  });
});

describe("FTS 命中带真实片段与锚点（非机密），机密文件 fail-closed 只出文件名", () => {
  it("a non-confidential hit carries a real snippet and a real anchor", async () => {
    const r = await searchArtifacts(deps, { userId: "u-fac", orgId: toOrgId(ORG), projectId: PROJECT, q: "roadmap" });
    const hit = r.hits.find((h) => h.node.artifactId === "f33fs-open-hit");
    expect(hit, JSON.stringify(r.hits)).toBeDefined();
    expect(hit!.snippet).toBeTruthy();
    expect(hit!.snippet).toContain("roadmap");
    expect(hit!.anchor).toEqual({ kind: "page", value: "1" });
  });

  it("a confidential hit still appears (search is not fail-closed to the point of hiding the FILE) but carries no snippet or anchor", async () => {
    const r = await searchArtifacts(deps, { userId: "u-fac", orgId: toOrgId(ORG), projectId: PROJECT, q: "roadmap" });
    const hit = r.hits.find((h) => h.node.artifactId === "f33fs-confidential-hit");
    expect(hit, JSON.stringify(r.hits)).toBeDefined();
    expect(hit!.node.confidential).toBe(true);
    expect(hit!.snippet).toBeNull();
    expect(hit!.anchor).toBeNull();
  });

  it("COUNTER-PROOF: the confidential row really does contain the matched term -- the null is a policy choice, not an absence of a match", async () => {
    const row = await asApp(ORG, (c) =>
      c.query<{ content: string }>(
        "SELECT content FROM segment_text WHERE artifact_id = 'f33fs-confidential-hit'",
      ),
    );
    expect(row.rows[0]!.content).toContain("roadmap");
  });
});
