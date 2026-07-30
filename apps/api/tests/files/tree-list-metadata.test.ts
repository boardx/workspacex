/**
 * F31 -- the row metadata and the tree projection.
 *
 * Three separable claims:
 *
 *   1. the columns the browser renders are CONSTRAINED, not conventions -- the ingestion enum
 *      is checked against the contract member for member, and "agent upload" is a column value
 *      the database enforces rather than a naming convention on `created_by` (V10);
 *   2. `originalDownloadable` and `retrievable` are two independent booleans (N-7), and the
 *      state that proves it is `REVIEW_PENDING`;
 *   3. 「未归入环节」 exists on the tree even when nothing is in it.
 *
 * ⚠ It also PINS what is not delivered. F31's `user_visible_behavior` names ten per-row fields;
 * the SIGNED `files.FileNode` is `.strict()` and carries seven. 上传者 / 版本号 / 可见性范围
 * have no place in the response, and adding them would amend a signed contract. The gap is
 * asserted here so that it cannot quietly become "done" and cannot quietly be papered over.
 */
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { artifact as A, files as C } from "@repo/contracts";
import {
  addOrgMember, addProjectMember, asApp, asOwner, ensureDatabase, migrateOnce, resetOrgs, seedOrg,
} from "../support/db";
import { addBrowserArtifact } from "../support/files-db";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { appConfig } from "../../src/infrastructure/db/pg-config";
import { PgArtifactBrowserRepository } from "../../src/infrastructure/files/pg-artifact-browser-repository";
import { ObjectStoreHeadProbe } from "../../src/infrastructure/files/object-store-head-probe";
import { PgIdentityRepository } from "../../src/infrastructure/identity/pg-identity-repository";
import { getArtifactTree, listProjectArtifacts, type BrowseDeps } from "../../src/application/files/browse-artifacts";
import {
  buildArtifactTree, UNSEGMENTED_KEY, UNSEGMENTED_LABEL, type TreeInputRow,
} from "../../src/domain/files/artifact-tree";
import {
  DOWNLOADABLE_STATES, RETRIEVABLE_STATES, originalDownloadable, retrievable,
} from "../../src/domain/files/ingestion-visibility";
import { toOrgId } from "../../src/domain/org-id";
import type { ObjectStore } from "../../src/application/artifact/ports";

const ORG = "org-f31-meta";
const PROJECT = "proj-f31-meta";
const EMPTY_PROJECT = "proj-f31-meta-empty";

class SeqIds {
  private n = 0;
  next(): string { return `d-${++this.n}`; }
}

let db: PgDatabase;
let deps: BrowseDeps;

/** The store is DOWN. V7·22-1: the list is still a 200 with metadata; only downloads degrade. */
const STORE_DOWN: ObjectStore = {
  async putOnce() { throw new Error("unavailable"); },
  async get() { throw new Error("unavailable"); },
  async head() { throw new Error("unavailable"); },
};

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  await resetOrgs(ORG);

  await seedOrg({ orgId: ORG, projectId: PROJECT, teamNames: ["energy"] });
  await asApp(ORG, (c) =>
    c.query("INSERT INTO projects (id, org_id, name) VALUES ($1,$2,$3)", [EMPTY_PROJECT, ORG, "empty"]),
  );
  await addOrgMember(ORG, "u-fac", "consultant", `${ORG}-team-energy`);
  await addProjectMember(ORG, PROJECT, "u-fac", "facilitator", null, true);
  await addProjectMember(ORG, EMPTY_PROJECT, "u-fac", "facilitator", null, true);

  await addBrowserArtifact({
    orgId: ORG, id: "m-human", projectId: PROJECT, source: "upload", title: "field notes",
    agendaSegmentId: "seg-3", sizeBytes: 4096, ingestionStatus: "READY",
    creator: { kind: "user", id: "u-fac" },
  });
  await addBrowserArtifact({
    orgId: ORG, id: "m-agent", projectId: PROJECT, source: "ai-generated", title: "ai summary",
    agendaSegmentId: null, sizeBytes: 512, confidential: true, ingestionStatus: "REVIEW_PENDING",
    creator: { kind: "agent", id: "agent-writer", runId: "run-9911" },
  });
  await addBrowserArtifact({
    orgId: ORG, id: "m-stored", projectId: PROJECT, source: "interview", title: "raw audio",
    agendaSegmentId: "seg-3", sizeBytes: 900_000, ingestionStatus: "STORED",
    creator: { kind: "user", id: "u-fac" },
  });

  db = new PgDatabase(appConfig());
  deps = {
    repo: new PgIdentityRepository(db),
    ids: new SeqIds(),
    browser: new PgArtifactBrowserRepository(db),
    objectStore: new ObjectStoreHeadProbe(STORE_DOWN),
  };
});

afterAll(async () => {
  await db?.close();
  await resetOrgs(ORG);
});

describe("the columns are constrained by the database, not by convention", () => {
  it("the ingestion enum in the CHECK equals artifact.IngestionStatus, member for member", async () => {
    const def = await asOwner(async (c) =>
      (await c.query<{ d: string }>(
        "SELECT pg_get_constraintdef(oid) AS d FROM pg_constraint WHERE conname = 'artifacts_ingestion_status_known'",
      )).rows[0]!.d,
    );
    const inSql = [...def.matchAll(/'([A-Z_]+)'/g)].map((m) => m[1]!).sort();
    // ⚠ The PROPERTY is set equality, not a count. `toHaveLength(10)` would turn a properly
    // reviewed addition into a red test (contract-design.md hard rule 7).
    expect(inSql).toEqual([...A.IngestionStatus.options].sort());
  });

  it("V10: an agent_run_id without an agent creator is refused, and so is the reverse", async () => {
    const insert = (kind: string, runId: string | null) =>
      asApp(ORG, (c) =>
        c.query(
          `INSERT INTO artifacts (id, org_id, project_id, source, title, created_by, synthesized, creator_kind, agent_run_id)
           VALUES ($1,$2,$3,'upload','probe','who',false,$4,$5)`,
          [`m-probe-${kind}-${runId ?? "null"}`, ORG, PROJECT, kind, runId],
        ),
      );
    // A human row carrying a run id would render as "uploaded by a person" while pointing at
    // an agent run -- the two halves of V10 disagreeing inside one row.
    await expect(insert("user", "run-x")).rejects.toThrow();
    // ...and an agent row with no run id renders as an agent nobody can trace.
    await expect(insert("agent", null)).rejects.toThrow();
  });
});

describe("N-7: originalDownloadable and retrievable are two independent booleans", () => {
  it("REVIEW_PENDING is downloadable and NOT retrievable -- the case a single flag cannot express", () => {
    expect(originalDownloadable("REVIEW_PENDING")).toBe(true);
    expect(retrievable("REVIEW_PENDING")).toBe(false);
  });

  it("the two sets are different sets, and neither is a prefix-of-enum shortcut", () => {
    expect(DOWNLOADABLE_STATES).not.toEqual(RETRIEVABLE_STATES);
    // If `retrievable` were "everything from INDEXED onward in the enum", REVIEW_PENDING would
    // be in it -- the enum order puts it after INDEXED. It is not.
    const order = A.IngestionStatus.options;
    const afterIndexed = order.slice(order.indexOf("INDEXED"));
    expect([...RETRIEVABLE_STATES].sort()).not.toEqual([...afterIndexed].sort());
  });

  it("the flags reach the response and match the row's state", async () => {
    const r = await listProjectArtifacts(deps, {
      userId: "u-fac", orgId: toOrgId(ORG), projectId: PROJECT, filters: null, cursor: null, pageSize: null,
    });
    const byId = new Map(r.nodes.map((n) => [n.artifactId, n]));
    expect(byId.get("m-stored")).toMatchObject({ originalDownloadable: true, retrievable: false });
    expect(byId.get("m-agent")).toMatchObject({ originalDownloadable: true, retrievable: false, confidential: true });
    expect(byId.get("m-human")).toMatchObject({ originalDownloadable: true, retrievable: true, confidential: false });
  });
});

describe("the row payload", () => {
  it("carries the fields the contract declares, with real values, and validates against it", async () => {
    const r = await listProjectArtifacts(deps, {
      userId: "u-fac", orgId: toOrgId(ORG), projectId: PROJECT, filters: null, cursor: null, pageSize: null,
    });
    const parsed = C.operations.listProjectArtifacts.out.safeParse(r);
    expect(parsed.success ? null : parsed.error.issues, JSON.stringify(r)).toBeNull();

    const human = r.nodes.find((n) => n.artifactId === "m-human")!;
    expect(human.name).toBe("field notes");
    expect(human.sizeBytes).toBe(4096);
    expect(human.agendaSegmentId).toBe("seg-3");
    // null, not "—". The dash is the browser's rendering of null and belongs to the frontend;
    // a server that sends "—" has made a display decision the client cannot undo.
    expect(r.nodes.find((n) => n.artifactId === "m-agent")!.agendaSegmentId).toBeNull();
    expect(new Date(human.updatedAt).toString()).not.toBe("Invalid Date");
  });

  it("V7·22-1: with object storage DOWN the list is still full metadata, with downloadAvailable false", async () => {
    const r = await listProjectArtifacts(deps, {
      userId: "u-fac", orgId: toOrgId(ORG), projectId: PROJECT, filters: null, cursor: null, pageSize: null,
    });
    expect(r.downloadAvailable).toBe(false);
    expect(r.nodes).toHaveLength(3);
  });

  /**
   * ⚠ NOT DELIVERED, pinned so it cannot drift into looking delivered.
   *
   * F31 asks each row to carry 上传者 (person or agent, with `agent_run_id`), 版本号 and
   * 可见性范围. The signed `files.FileNode` is `.strict()` and has no field for any of them.
   * The data exists (`artifacts.creator_kind` / `agent_run_id`, `artifact_versions`,
   * `acl_bindings.scope`) -- what is missing is a contract that can carry it, and amending a
   * signed contract is a human decision, not this feature's.
   */
  it("PINS THE GAP: FileNode has no uploader / version / visibility field", () => {
    const keys = Object.keys(C.FileNode.shape).sort();
    expect(keys).toEqual([
      "agendaSegmentId", "artifactId", "confidential", "ingestionStatus", "name",
      "originalDownloadable", "retrievable", "sizeBytes", "sourceType", "updatedAt",
    ]);
    for (const absent of ["uploader", "creator", "versionNumber", "visibilityScope", "scope"]) {
      expect(keys, `FileNode gained "${absent}" -- if the contract was amended, delete this pin`)
        .not.toContain(absent);
    }
  });
});

describe("the tree", () => {
  it("level 1 is source types present in the visible set; level 2 carries the segments", async () => {
    const r = await getArtifactTree(deps, { userId: "u-fac", orgId: toOrgId(ORG), projectId: PROJECT });
    const parsed = C.operations.getArtifactTree.out.safeParse(r);
    expect(parsed.success ? null : parsed.error.issues, JSON.stringify(r)).toBeNull();

    const l1 = r.tree.filter((n) => n.level === 1);
    expect(l1.map((n) => n.key).sort()).toEqual(["ai-generated", "interview", "upload"]);
    expect(l1.find((n) => n.key === "upload")!.count).toBe(1);
    expect(l1.find((n) => n.key === "interview")!.count).toBe(1);
  });

  it("「未归入环节」 is present even when the project is EMPTY", async () => {
    const r = await getArtifactTree(deps, { userId: "u-fac", orgId: toOrgId(ORG), projectId: EMPTY_PROJECT });
    const un = r.tree.find((n) => n.key === UNSEGMENTED_KEY);
    expect(un, "an upload with no segment would have nowhere to appear").toBeDefined();
    expect(un!.count).toBe(0);
    expect(un!.label).toBe(UNSEGMENTED_LABEL);
    // V5·22-1: an empty project generates NO sample data.
    expect(r.tree.filter((n) => n.level === 1)).toEqual([]);
  });

  it("COUNTER-PROOF: the obvious implementation drops that node, and the assertion catches it", () => {
    const rows: TreeInputRow[] = [{ sourceType: "upload", agendaSegmentId: "seg-1" }];

    // The real one keeps it.
    expect(buildArtifactTree(rows).map((n) => n.key)).toContain(UNSEGMENTED_KEY);

    // The version anybody would write first: group the rows, emit what you grouped. It is
    // wrong in exactly one way, and that way is invisible on screen -- a general upload
    // simply has no home, which looks identical to the upload having failed.
    const naive = [...new Set(rows.map((r) => r.agendaSegmentId ?? UNSEGMENTED_KEY))];
    expect(naive).not.toContain(UNSEGMENTED_KEY);
  });

  it("a real un-segmented row does not get overwritten by the default zero", () => {
    const tree = buildArtifactTree([
      { sourceType: "upload", agendaSegmentId: null },
      { sourceType: "upload", agendaSegmentId: null },
      { sourceType: "upload", agendaSegmentId: "seg-1" },
    ]);
    expect(tree.find((n) => n.key === UNSEGMENTED_KEY)!.count).toBe(2);
  });

  /**
   * ⚠ NOT DELIVERED: 「八类来源节点恒显示」 (usecases.md A5·22-1).
   *
   * Three source-type vocabularies exist and no two are equal (XC-03 / files FS1, unruled):
   * the SIGNED `artifact.ArtifactSource` (7), the prototype's `SourceType` (8), and
   * `segment_text.source_type` (8, different again). Emitting a fixed eight would be this code
   * casting the ruling in the least visible place available.
   */
  it("PINS THE GAP: the three vocabularies really are pairwise unequal", async () => {
    // ⚠ Widened to `string[]` deliberately. Each side is a DIFFERENT literal union, so
    // `uiSide.includes(contractValue)` is a type error -- TypeScript is correct that the two
    // vocabularies have no common type, which is precisely the fact under test. Comparing them
    // as the strings they are in the database is the honest way to state it.
    const contractSide: string[] = [...A.ArtifactSource.options].sort();
    const uiSide: string[] = [...C.SOURCE_TYPE_VOCABULARY_DISPUTED.uiSide].sort();
    const retrievalSide = await asOwner(async (c) => {
      const def = (await c.query<{ d: string }>(
        `SELECT pg_get_constraintdef(oid) AS d FROM pg_constraint
          WHERE conrelid = 'segment_text'::regclass AND contype = 'c'
            AND pg_get_constraintdef(oid) LIKE '%source_type%'`,
      )).rows[0]!.d;
      return [...def.matchAll(/'([a-z-]+)'/g)].map((m) => m[1]!).sort();
    });

    expect(contractSide).not.toEqual(uiSide);
    expect(contractSide).not.toEqual(retrievalSide);
    expect(uiSide).not.toEqual(retrievalSide);
    // ...and none is a superset of another, which is why "just widen one" is not available.
    expect(uiSide.filter((v) => !contractSide.includes(v)).length).toBeGreaterThan(0);
    expect(contractSide.filter((v) => !uiSide.includes(v)).length).toBeGreaterThan(0);
  });
});
