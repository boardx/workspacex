import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  addArtifact,
  addBinding,
  addOrgMember,
  addProjectMember,
  addSegment,
  ensureDatabase,
  migrateOnce,
  resetOrgs,
  seedOrg,
} from "../support/db";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { appConfig } from "../../src/infrastructure/db/pg-config";
import { PgIdentityRepository } from "../../src/infrastructure/identity/pg-identity-repository";
import { CountingDecisionIdFactory } from "../../src/infrastructure/identity/in-memory-session-store";
import { PgArtifactRepository } from "../../src/infrastructure/artifact/pg-artifact-repository";
import { disclose } from "../../src/application/security/permission-filter";
import { buildContextItems, type RetrievalFacts } from "../../src/application/context-pack/build-items";
import { packStructureViolations } from "../../src/domain/context-pack/pack-structure";
import { toOrgId } from "../../src/domain/org-id";
import type { SegmentRecord } from "../../src/application/artifact/ports";

/**
 * F09 -- `permissionDecisionId` cannot be a string somebody typed.
 *
 * The six-tuple tests assert that the field is non-empty. Non-empty is not the property that
 * matters: `"dec-1"` is non-empty and answers nothing. I-11 wants the id to resolve to a
 * judgement that was actually made about this requester and this segment, and the only way a
 * structure test can assert that is to go and make one.
 *
 * So this file uses the real path -- real rows, real ACL bindings, the real `decide()` behind
 * `disclose()` on `path: "context-pack"` (the propagation-path entry registered to F09) --
 * and asserts that the ids on the items are the ids the identity layer minted.
 *
 * It does NOT retrieve anything. The candidate set is handed over; five-way recall is F10.
 */

const ORG = "org-f09-items";
const PROJECT = "proj-f09-items";

let db: PgDatabase;
let repo: PgArtifactRepository;
let deps: { repo: PgIdentityRepository; ids: CountingDecisionIdFactory };
let fx: Awaited<ReturnType<typeof seedOrg>>;

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  db = new PgDatabase(appConfig());
  repo = new PgArtifactRepository(db);
  deps = { repo: new PgIdentityRepository(db), ids: new CountingDecisionIdFactory() };
});

afterAll(async () => {
  await db.close();
});

beforeEach(async () => {
  await resetOrgs(ORG);
  fx = await seedOrg({ orgId: ORG, projectId: PROJECT });
  await addOrgMember(ORG, "u-energy", "consultant", fx.teams.energy!);
  await addOrgMember(ORG, "u-platform", "consultant", fx.teams.platform!);
  await addProjectMember(ORG, PROJECT, "u-energy", "facilitator", null);
  await addProjectMember(ORG, PROJECT, "u-platform", "facilitator", null);
});

const FACTS: RetrievalFacts = {
  content: "受访者原话：证据链比预算更紧缺。",
  sourceType: "interview",
  retrievalReasons: ["recall"],
  channels: ["fts"],
  score: 0.77,
};

/** Read a version's segments and run them through the guard as `userId`. */
async function discloseSegments(userId: string, versionId: string) {
  return disclose<SegmentRecord>(deps, {
    userId,
    orgId: toOrgId(ORG),
    projectId: PROJECT,
    action: "read.allHands",
    path: "context-pack",
    items: await repo.findSegments(toOrgId(ORG), versionId),
  });
}

describe("items are built from a real disclosure, on the context-pack propagation path", () => {
  let versionId: string;

  beforeEach(async () => {
    await addArtifact({ orgId: ORG, id: "f09-art-open", projectId: PROJECT });
    ({ versionId } = await addSegment({
      orgId: ORG,
      segmentId: "f09-seg-open",
      artifactId: "f09-art-open",
      anchor: { kind: "timecode", locator: "00:03:11" },
    }));
  });

  it("produces a complete item whose decision id is the one identity minted", async () => {
    const d = await discloseSegments("u-energy", versionId);
    expect(d.visible).toHaveLength(1);

    const built = buildContextItems(d, () => FACTS);
    expect(built.items).toHaveLength(1);
    const item = built.items[0]!;

    // The property under test: not "the field is non-empty" but "the field is THAT id".
    expect(item.permissionDecisionId).toBe(d.visible[0]!.permissionDecisionId);
    expect(item.permissionDecisionId).not.toBe("");
    // Version comes off the segment row, not from the caller -- an item cannot cite a
    // version its segment does not belong to.
    expect(item.artifactVersionId).toBe(versionId);
    expect(item.segmentId).toBe("f09-seg-open");
    expect(item.anchor).toEqual({ startMs: 191_000 });
  });

  it("the built item satisfies the structure contract end to end", async () => {
    const built = buildContextItems(await discloseSegments("u-energy", versionId), () => FACTS);
    const violations = packStructureViolations({
      packId: "pack-f09-live", runId: "run-f09-live",
      query: {
        tenantId: ORG, principalId: "u-energy", projectIds: [PROJECT], task: "answer",
        query: "证据链", timeRange: null, allowedSensitivity: ["internal"],
        tokenBudget: 120_000, freshnessRequirement: null, evidencePolicy: "reviewed",
      },
      retrievalPlan: [], items: [...built.items], claims: [], omissions: [...built.omissions],
      tokensUsed: 120, pinnedSnapshotId: null,
    });
    expect(violations).toEqual([]);
  });

  it("a disclosed segment with no retrieval facts is a loud failure, not a dropped item", async () => {
    // The quiet version of this bug is an item that never appears and nobody notices,
    // which is the exact thing omissions[] exists to make impossible.
    const d = await discloseSegments("u-energy", versionId);
    expect(() => buildContextItems(d, () => undefined)).toThrow(/diverged/);
  });
});

describe("a withheld candidate becomes an omission, not a silence", () => {
  let versionId: string;

  beforeEach(async () => {
    await addArtifact({ orgId: ORG, id: "f09-art-secret", projectId: PROJECT });
    ({ versionId } = await addSegment({
      orgId: ORG,
      segmentId: "f09-seg-secret",
      artifactId: "f09-art-secret",
      anchor: { kind: "page", locator: "4" },
    }));
    // The ORIGINAL is team-only; the segment carries no binding of its own (I-13).
    await addBinding({
      orgId: ORG,
      subject: { kind: "team", id: fx.teams.energy! },
      object: { kind: "artifact", id: "f09-art-secret" },
      scope: "team-only",
      ownerTeamId: fx.teams.energy!,
    });
  });

  it("someone outside the owning team gets no item and one `unauthorized` omission", async () => {
    const d = await discloseSegments("u-platform", versionId);
    const built = buildContextItems(d, () => FACTS);

    expect(built.items).toEqual([]);
    expect(built.omissions).toEqual([
      {
        ref: "f09-seg-secret",
        reason: "unauthorized",
        compliance: true, // a compliance discard: I-4 says it stays visible under any fold
        explain: expect.stringContaining("两层交集"),
      },
    ]);
    // The content itself never travels. `Guarded` keeps the payload out of the wrapper, and
    // the omission names only the ref.
    expect(JSON.stringify(built.omissions)).not.toContain(FACTS.content);
  });

  it("someone INSIDE the owning team gets the item -- restriction, not paralysis", async () => {
    // Counter-proof for the test above: a builder that emitted an `unauthorized` omission
    // for every candidate would pass it and be useless.
    const built = buildContextItems(await discloseSegments("u-energy", versionId), () => FACTS);
    expect(built.items).toHaveLength(1);
    expect(built.omissions).toEqual([]);
    expect(built.items[0]!.anchor).toEqual({ page: 4 });
  });
});

describe("a segment that cannot be located does not enter items[]", () => {
  it("an image-region-only segment is held back as ANCHOR_MISSING", async () => {
    // I-1, and the contract gap `context-pack-schema.test.ts` documents: the stored anchor
    // is perfectly valid, and the citation schema has no field for it. The candidate is
    // reported separately rather than being given one of the seven omission reasons, none
    // of which means "could not be located".
    await addArtifact({ orgId: ORG, id: "f09-art-photo", projectId: PROJECT });
    const { versionId } = await addSegment({
      orgId: ORG,
      segmentId: "f09-seg-photo",
      artifactId: "f09-art-photo",
      anchor: { kind: "image-region", locator: "img-2#40,40,120,120" },
    });

    const d = await discloseSegments("u-energy", versionId);
    expect(d.visible).toHaveLength(1); // it IS visible -- this is not a permission outcome

    const built = buildContextItems(d, () => ({ ...FACTS, sourceType: "photo" }));
    expect(built.items).toEqual([]);
    expect(built.unanchorable).toEqual([
      {
        segmentId: "f09-seg-photo",
        reason: "ANCHOR_MISSING",
        unmappedAnchors: [{ mapped: false, kind: "image-region", why: "no-field-in-contract" }],
      },
    ]);
    // ⚠ And it is NOT in omissions[], because no reason fitted when this was written. ADR-021 later added `unlocatable`; as the
    // contract stands, a photo segment is neither cited nor explained. See the F09 report.
    expect(built.omissions).toEqual([]);
  });
});
