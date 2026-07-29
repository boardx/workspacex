import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { artifact as A } from "@repo/contracts";
import {
  addArtifact,
  addBinding,
  addOrgMember,
  addProjectMember,
  asApp,
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
import { toOrgId } from "../../src/domain/org-id";
import type { SegmentRecord } from "../../src/application/artifact/ports";

/**
 * F04 -- every Segment can get back to the original (I-7), and a Segment is never looser
 * than the original it came from (I-13).
 *
 * ## Why these two are in one file
 *
 * They are the two halves of what a Segment IS. A segment that cannot be traced back is not
 * citable, and a segment that can be read by people who could not read its original is a
 * laundering channel -- "you cannot see the interview, but here is the sentence from it".
 * Both are properties of the same row, and testing them apart is how one of them ends up
 * true only for the paths somebody remembered.
 */

const ORG = "org-f04-anchor";
const PROJECT = "proj-f04-anchor";

let db: PgDatabase;
let repo: PgArtifactRepository;
let identityDeps: { repo: PgIdentityRepository; ids: CountingDecisionIdFactory };
let fx: Awaited<ReturnType<typeof seedOrg>>;

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  db = new PgDatabase(appConfig());
  repo = new PgArtifactRepository(db);
  identityDeps = { repo: new PgIdentityRepository(db), ids: new CountingDecisionIdFactory() };
});

afterAll(async () => {
  await db.close();
});

beforeEach(async () => {
  await resetOrgs(ORG);
  fx = await seedOrg({ orgId: ORG, projectId: PROJECT });
});

/** An artifact with one version, ready for segments to hang off. */
async function seedVersion(artifactId: string, versionId: string, versionNumber = 1): Promise<void> {
  await addArtifact({ orgId: ORG, id: artifactId, projectId: PROJECT });
  await asApp(ORG, (c) =>
    c.query(
      `INSERT INTO artifact_versions
         (id, org_id, artifact_id, version_number, object_storage_key, content_hash, mime, size_bytes, pinned_by)
       VALUES ($1,$2,$3,$4,$5,$6,'application/pdf',4096,'u-pin')`,
      [
        versionId, ORG, artifactId, versionNumber,
        `${ORG}/artifacts/${artifactId}/v${versionNumber}/original`,
        `${versionNumber}`.repeat(64).slice(0, 64),
      ],
    ),
  );
}

describe("I-7: a Segment with no Anchor cannot exist", () => {
  beforeEach(async () => {
    await seedVersion("f04a-art-anch", "f04a-ver-anch");
  });

  it("a segment inserted with an anchor commits", async () => {
    // The counter-proof, first. Every refusal below is also satisfied by a constraint that
    // refuses all segments, which would make the model unusable rather than correct.
    await repo.addSegments(toOrgId(ORG), [
      {
        id: "f04a-seg-ok", artifactVersionId: "f04a-ver-anch", kind: "text", ordinal: 0,
        anchors: [{ id: "f04a-a-ok", kind: "page", locator: "7" }],
      },
    ]);
    const segs = await repo.findSegments(toOrgId(ORG), "f04a-ver-anch");
    expect(segs).toHaveLength(1);
  });

  it("a segment inserted with NO anchor is refused at COMMIT", async () => {
    // Deferred on purpose: the anchor does not exist yet when the segment row is written, so
    // an immediate check would make the only correct insert order impossible. At COMMIT the
    // pair is either complete or it is a segment nobody can trace.
    await expect(
      asApp(ORG, (c) =>
        c.query(
          `INSERT INTO segments (id, org_id, artifact_version_id, kind, ordinal)
           VALUES ('f04a-seg-orphan',$1,'f04a-ver-anch','text',0)`,
          [ORG],
        ),
      ),
    ).rejects.toThrow(/invariant I-7/);
  });

  it("deleting a segment's LAST anchor is refused", async () => {
    // The direction that is easy to forget. Having only the insert check means the invariant
    // silently becomes false a year later, during a re-segmentation, with nothing failing.
    await repo.addSegments(toOrgId(ORG), [
      {
        id: "f04a-seg-one", artifactVersionId: "f04a-ver-anch", kind: "text", ordinal: 0,
        anchors: [{ id: "f04a-a-only", kind: "page", locator: "1" }],
      },
    ]);
    await expect(
      asApp(ORG, (c) => c.query(`DELETE FROM anchors WHERE id = 'f04a-a-only'`)),
    ).rejects.toThrow(/invariant I-7/);
  });

  it("deleting ONE of two anchors is allowed", async () => {
    await repo.addSegments(toOrgId(ORG), [
      {
        id: "f04a-seg-two", artifactVersionId: "f04a-ver-anch", kind: "text", ordinal: 0,
        anchors: [
          { id: "f04a-a-1", kind: "page", locator: "1" },
          { id: "f04a-a-2", kind: "bbox", locator: "12,30,200,60" },
        ],
      },
    ]);
    await asApp(ORG, (c) => c.query(`DELETE FROM anchors WHERE id = 'f04a-a-1'`));
    const segs = await repo.findSegments(toOrgId(ORG), "f04a-ver-anch");
    expect(segs).toHaveLength(1);
  });

  it("deleting a whole segment takes its anchors with it and strands nothing", async () => {
    await repo.addSegments(toOrgId(ORG), [
      {
        id: "f04a-seg-gone", artifactVersionId: "f04a-ver-anch", kind: "text", ordinal: 0,
        anchors: [{ id: "f04a-a-gone", kind: "page", locator: "1" }],
      },
    ]);
    await asApp(ORG, (c) => c.query(`DELETE FROM segments WHERE id = 'f04a-seg-gone'`));
    expect(await repo.findSegments(toOrgId(ORG), "f04a-ver-anch")).toEqual([]);
  });
});

describe("every anchor kind the contract names can be stored and read back", () => {
  it("page / bbox / timecode / message-id / question-no / image-region all round-trip", async () => {
    // Driven off the contract's enum. An anchor kind added there without a way to store it
    // means a source whose segments cannot get home, and it would surface as a runtime
    // constraint violation in the ingestion pipeline rather than here.
    await seedVersion("f04a-art-kinds", "f04a-ver-kinds");
    const locators: Record<string, string> = {
      page: "12",
      bbox: "10,20,300,80",
      timecode: "00:14:07.500",
      "message-id": "msg-91f3",
      "question-no": "Q7",
      "image-region": "img-2#40,40,120,120",
    };
    await repo.addSegments(
      toOrgId(ORG),
      A.AnchorKind.options.map((kind, i) => ({
        id: `f04a-seg-k-${i}`,
        artifactVersionId: "f04a-ver-kinds",
        kind: "text" as const,
        ordinal: i,
        anchors: [{ id: `f04a-a-k-${i}`, kind, locator: locators[kind]! }] as [
          { id: string; kind: typeof kind; locator: string },
        ],
      })),
    );

    const segs = await repo.findSegments(toOrgId(ORG), "f04a-ver-kinds");
    expect(segs).toHaveLength(A.AnchorKind.options.length);
    // Read the payloads back through the guard, using an allowed decision, so this asserts
    // what a caller actually receives rather than what the repository built.
    await addOrgMember(ORG, "u-reader", "consultant", fx.teams.energy!);
    await addProjectMember(ORG, PROJECT, "u-reader", "facilitator", null);
    const r = await disclose<SegmentRecord>(identityDeps, {
      userId: "u-reader", orgId: toOrgId(ORG), projectId: PROJECT,
      action: "read.allHands", path: "retrieval", items: segs,
    });
    const seen = r.visible.map((v) => v.payload.anchors[0]!);
    expect(seen.map((a) => a.kind).sort()).toEqual([...A.AnchorKind.options].sort());
    for (const a of seen) expect(a.locator).toBe(locators[a.kind]);
  });
});

describe("segments hang off a VERSION, so a new version does not disturb the old one", () => {
  it("v1's segments are untouched after v2 is created with its own", async () => {
    // This is the model half of "originals are never overwritten": a citation to
    // (version 1, segment 0) keeps meaning what it meant. F05 builds the pinning API on it.
    await seedVersion("f04a-art-v", "f04a-ver-v1", 1);
    await repo.addSegments(toOrgId(ORG), [
      {
        id: "f04a-seg-v1-0", artifactVersionId: "f04a-ver-v1", kind: "text", ordinal: 0,
        anchors: [{ id: "f04a-a-v1-0", kind: "page", locator: "1" }],
      },
    ]);
    await asApp(ORG, (c) =>
      c.query(
        `INSERT INTO artifact_versions
           (id, org_id, artifact_id, version_number, object_storage_key, content_hash, mime, size_bytes, pinned_by)
         VALUES ('f04a-ver-v2',$1,'f04a-art-v',2,$2,$3,'application/pdf',8192,'u-pin')`,
        [ORG, `${ORG}/artifacts/art-v/v2/original`, "2".repeat(64)],
      ),
    );
    await repo.addSegments(toOrgId(ORG), [
      {
        id: "f04a-seg-v2-0", artifactVersionId: "f04a-ver-v2", kind: "text", ordinal: 0,
        anchors: [{ id: "f04a-a-v2-0", kind: "page", locator: "99" }],
      },
    ]);

    const v1 = await repo.findSegments(toOrgId(ORG), "f04a-ver-v1");
    const v2 = await repo.findSegments(toOrgId(ORG), "f04a-ver-v2");
    expect(v1.map((s) => s.ref.id)).toEqual(["f04a-seg-v1-0"]);
    expect(v2.map((s) => s.ref.id)).toEqual(["f04a-seg-v2-0"]);
  });
});

describe("I-13: a Segment is judged by its ORIGINAL, and only ever more strictly", () => {
  beforeEach(async () => {
    await seedVersion("f04a-art-secret", "f04a-ver-secret");
    await addOrgMember(ORG, "u-energy", "consultant", fx.teams.energy!);
    await addOrgMember(ORG, "u-platform", "consultant", fx.teams.platform!);
    await addProjectMember(ORG, PROJECT, "u-energy", "facilitator", null);
    await addProjectMember(ORG, PROJECT, "u-platform", "facilitator", null);
    // The ORIGINAL is team-only. The segment itself carries no binding at all -- which is
    // the realistic case, because segments are minted by an ingestion pipeline that has no
    // reason to know about teams.
    await addBinding({
      orgId: ORG,
      subject: { kind: "team", id: fx.teams.energy! },
      object: { kind: "artifact", id: "f04a-art-secret" },
      scope: "team-only",
      ownerTeamId: fx.teams.energy!,
    });
    await repo.addSegments(toOrgId(ORG), [
      {
        id: "f04a-seg-secret", artifactVersionId: "f04a-ver-secret", kind: "text", ordinal: 0,
        anchors: [{ id: "f04a-a-secret", kind: "timecode", locator: "00:03:11" }],
      },
    ]);
  });

  const read = async (userId: string) =>
    disclose<SegmentRecord>(identityDeps, {
      userId, orgId: toOrgId(ORG), projectId: PROJECT,
      action: "read.allHands", path: "retrieval",
      items: await repo.findSegments(toOrgId(ORG), "f04a-ver-secret"),
    });

  it("someone outside the owning team gets nothing", async () => {
    const r = await read("u-platform");
    expect(r.visible).toEqual([]);
    expect(r.withheld[0]!.reasonCode).toBe("ORG_SCOPE_DENIED");
  });

  it("someone INSIDE the owning team gets it -- restriction, not paralysis", async () => {
    const r = await read("u-energy");
    expect(r.visible).toHaveLength(1);
    expect(r.visible[0]!.payload.anchors[0]!.locator).toBe("00:03:11");
  });

  it("the repository names the original as the segment's source -- that is the mechanism", async () => {
    // Asserted directly, because the two tests above would also pass if the segment happened
    // to carry an identical binding of its own. What makes I-13 hold generally is that the
    // decision is made about the ORIGINAL.
    const segs = await repo.findSegments(toOrgId(ORG), "f04a-ver-secret");
    expect(segs[0]!.sources).toEqual([{ kind: "artifact", id: "f04a-art-secret" }]);
    expect(segs[0]!.ref).toEqual({ kind: "segment", id: "f04a-seg-secret" });
  });

  it("the payload is unreachable without a decision", async () => {
    // `Guarded<T>` keeps the payload in a module-private WeakMap, so serialising the wrapper
    // cannot leak it. Without this, "we always call disclose()" would be a convention.
    const segs = await repo.findSegments(toOrgId(ORG), "f04a-ver-secret");
    expect(JSON.stringify(segs[0])).not.toContain("00:03:11");
  });
});
