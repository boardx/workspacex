/**
 * F42 -- uc-22-3 R7 / R12 V5: `evidencePolicy` server-side enforcement in the real retrieval
 * pipeline (`retrieveCandidates`), against real PostgreSQL -- same harness shape as
 * `tests/kernel/filter-actions-retrieval-reasons.test.ts`.
 *
 * V5's three assertions, all against a project with ONE `ai-generated` (synthesized) segment
 * and ONE ordinary (`upload`) segment, semantically close so both compete for the same query:
 *
 *   ① `evidencePolicy: "primary-only"` -> the generated segment is NOT in `ranked`/`items`, at
 *      all -- zero recall, not merely downweighted.
 *   ② `evidencePolicy: "all"` -> it IS present, and `sourceType === "ai-generated"` on the
 *      surviving candidate IS its synthesized tag (see `evidence-policy-filter.ts`'s header for
 *      why this is not a second field).
 *   ③ A forged `evidencePolicy` value the contract's enum does not recognise -- not "primary-
 *      only", "reviewed", or "all" -- is enforced as the STRICTEST reading (`primary-only`'s
 *      zero recall), never as the loosest one. This is `coerceEvidencePolicy`'s fail-closed
 *      default, exercised end-to-end rather than as a unit test of the coercion function alone.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  addOrgMember, addProjectMember, ensureDatabase, migrateOnce, resetOrgs, seedOrg,
} from "../support/db";
import { IdentityRerank, TableEmbedding, indexSegment } from "../support/retrieval-fixtures";
import { appConfig } from "../../src/infrastructure/db/pg-config";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { PgIdentityRepository } from "../../src/infrastructure/identity/pg-identity-repository";
import { CountingDecisionIdFactory } from "../../src/infrastructure/identity/in-memory-session-store";
import { PgSegmentRetriever } from "../../src/infrastructure/retrieval/pg-segment-retriever";
import { retrieveCandidates, type RetrieveDeps } from "../../src/application/retrieval/retrieve-candidates";
import { toOrgId } from "../../src/domain/org-id";

const ORG = "org-f42-evpolicy";
const PROJECT = "proj-f42-evpolicy";
const MODEL = { model: "fixture-embed-f42", modelVersion: "1" };

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
    // Only the FTS channel needs to score anything real for this file's assertions; the vector
    // channel is exercised elsewhere (retrieval-five-channels.test.ts). A fixed vector for both
    // segments keeps this file about evidencePolicy, not about embedding fidelity.
    embeddings: new TableEmbedding(MODEL.model, MODEL.modelVersion, { "并购 尽调": [1, 0, 0, 0] }),
    rerank: new IdentityRerank(),
  } as RetrieveDeps;
});

afterAll(async () => {
  await db.close();
});

async function seedTwins(): Promise<void> {
  await resetOrgs(ORG);
  const fx = await seedOrg({ orgId: ORG, projectId: PROJECT });
  await addOrgMember(ORG, "u-f42", "consultant", fx.teams.energy!);
  await addProjectMember(ORG, PROJECT, "u-f42", "facilitator", null);

  const base = { orgId: ORG, projectId: PROJECT };
  // The ai-generated twin: same wording, so it competes for the same FTS query as the primary
  // one -- a policy that "just happens to never surface it" because it scores lower would pass
  // for the wrong reason.
  await indexSegment({
    ...base, segmentId: "f42-seg-generated", artifactId: "f42-art-generated",
    content: "并购 尽调 摘要结论。", sourceType: "ai-generated",
  });
  // The primary twin: an ordinary uploaded/first-hand source, semantically close.
  await indexSegment({
    ...base, segmentId: "f42-seg-primary", artifactId: "f42-art-primary",
    content: "并购 尽调 原始记录。", sourceType: "file",
  });
}

async function retrieve(evidencePolicyRaw: unknown) {
  return retrieveCandidates(deps, {
    userId: "u-f42",
    orgId: toOrgId(ORG),
    projectId: PROJECT,
    task: "decision-support",
    query: "并购 尽调",
    timeRange: null,
    limit: 50,
    evidencePolicyRaw,
  });
}

describe("F42 evidencePolicy server-side enforcement -- real retrieval pipeline", () => {
  beforeEach(async () => {
    await seedTwins();
  });

  it("① primary-only: the generated segment is absent from ranked candidates -- zero recall, not downweighted", async () => {
    const out = await retrieve("primary-only");
    const ids = out.ranked.map((r) => r.row.segmentId);
    expect(ids).not.toContain("f42-seg-generated");
    expect(ids).toContain("f42-seg-primary");
    expect(out.evidencePolicyEnforced).toBe("primary-only");
    // Excluded with a real, findable reason -- not a silent drop (R7's own "静默失败是最危险的缺陷模式").
    expect(out.omissions.some((o) => o.ref === "f42-seg-generated" && o.reason === "out-of-scope")).toBe(true);
  });

  it("② all: the generated segment IS present, and its sourceType is its synthesized tag", async () => {
    const out = await retrieve("all");
    const generated = out.ranked.find((r) => r.row.segmentId === "f42-seg-generated");
    expect(generated).toBeDefined();
    expect(generated!.row.sourceType).toBe("ai-generated");
    expect(out.evidencePolicyEnforced).toBe("all");
    // Not excluded -- no `out-of-scope` omission for it under "all".
    expect(out.omissions.some((o) => o.ref === "f42-seg-generated")).toBe(false);
  });

  it("③ tampered/forged evidencePolicy value is enforced at the STRICTEST reading, never the loosest", async () => {
    // Not a member of the signed enum (`primary-only`/`reviewed`/`all`) -- exactly the shape a
    // client that does not go through the generated types could produce.
    const out = await retrieve("give-me-everything");
    const ids = out.ranked.map((r) => r.row.segmentId);
    expect(ids).not.toContain("f42-seg-generated");
    expect(ids).toContain("f42-seg-primary");
    // The server recorded what it ACTUALLY enforced -- the fail-closed default, not the forged
    // string and not a silent pass-through.
    expect(out.evidencePolicyEnforced).toBe("primary-only");
  });

  it("counter-proof: an absent evidencePolicy (caller omitted it) also fails closed to primary-only, not to the loosest reading", async () => {
    const out = await retrieve(undefined);
    expect(out.evidencePolicyEnforced).toBe("primary-only");
    expect(out.ranked.map((r) => r.row.segmentId)).not.toContain("f42-seg-generated");
  });
});
