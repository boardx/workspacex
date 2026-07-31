/**
 * F34 -- 空态 (V5) / 依赖失败 (V7) / 完整性校验失败态 (V8), uc-22-1 R4.
 *
 * ## V5: what "real empty state" actually means here, and what it does NOT mean
 *
 * `usecases.md` A5·22-1 says 「八类来源节点恒显示」, and `tree-list-metadata.test.ts` (F31)
 * already PINS that this is NOT delivered -- `files.KNOWN_CONTRACT_GAPS.FS1` is an unruled
 * dispute between three pairwise-unequal source-type vocabularies, and emitting a fixed eight
 * would be this repository casting that ruling in the least visible place available. This
 * file does not relitigate that; it re-asserts the part of V5 that IS unambiguous and does
 * NOT depend on which vocabulary wins: a brand-new empty project's list is genuinely empty
 * (no sample data, no fabricated rows) rather than a crash or a stale cache hit, and the
 * SAME emptiness is what a real client would show as "上传材料" rather than an error screen.
 *
 * ## V7: the LIST already had a dependency-failure test (F31, `tree-list-metadata.test.ts`
 * line 177). What this file adds is the DOWNLOAD half of E1·22-1 -- 「预览下载按钮置灰显示原因
 * （非500裸错）」 -- which nothing before F34 exercised: `issueDownloadUrl` against a down
 * store must fail with a NAMED reason the controller can turn into a clean 503, not an
 * unhandled exception a client would see as a bare 500.
 *
 * ## V8: `INTEGRITY_CHECK_FAILED` is F34's own addition to `issueDownloadUrl`
 * (`deliver-artifact.ts`'s header explains why `previewArtifactVersion` still does not raise
 * it). The corpus is a REAL `FsObjectStore`: the fixture's `content_hash` is the all-zero
 * placeholder `addBrowserArtifact` writes (a syntactically valid SHA-256 nothing has ever
 * hashed real bytes against), so writing ANY real bytes at that key is already a mismatch --
 * no bit-flipping needed to prove the check is live.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { files as C } from "@repo/contracts";
import {
  addOrgMember, addProjectMember, asApp, ensureDatabase, migrateOnce, resetOrgs, seedOrg,
} from "../support/db";
import { addBrowserArtifact } from "../support/files-db";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { appConfig } from "../../src/infrastructure/db/pg-config";
import { PgArtifactBrowserRepository } from "../../src/infrastructure/files/pg-artifact-browser-repository";
import { PgDownloadGrantRepository } from "../../src/infrastructure/files/pg-download-grant-repository";
import { PgIdentityRepository } from "../../src/infrastructure/identity/pg-identity-repository";
import { PgProvenanceRepository } from "../../src/infrastructure/provenance/pg-provenance-repository";
import { IsolatedDownloadUrlBuilder } from "../../src/infrastructure/files/isolated-download-url-builder";
import { ObjectStoreHeadProbe } from "../../src/infrastructure/files/object-store-head-probe";
import { ObjectStoreIntegrityChecker } from "../../src/infrastructure/files/object-store-integrity-checker";
import { FsObjectStore } from "../../src/infrastructure/storage/fs-object-store";
import { listProjectArtifacts, type BrowseDeps } from "../../src/application/files/browse-artifacts";
import {
  FilesDeliveryError, issueDownloadUrl, type DeliveryDeps,
} from "../../src/application/files/deliver-artifact";
import type { ObjectStore } from "../../src/application/artifact/ports";
import { toOrgId } from "../../src/domain/org-id";

const ORG = "org-f34-empty";
const EMPTY_PROJECT = "proj-f34-empty";
const STORE_PROJECT = "proj-f34-store";

class SeqIds {
  private n = 0;
  next(): string { return `d-${++this.n}`; }
}
class SeqRowIds {
  private n = 0;
  next(prefix: string): string { return `${prefix}-${++this.n}`; }
}

const v = (artifactId: string): string => `${artifactId}-v1`;

let db: PgDatabase;
let browseDeps: BrowseDeps;
let root: string;
let realStore: FsObjectStore;

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  await resetOrgs(ORG);
  await seedOrg({ orgId: ORG, projectId: STORE_PROJECT, teamNames: ["energy"] });
  await asApp(ORG, (c) =>
    c.query("INSERT INTO projects (id, org_id, name, kind) VALUES ($1,$2,$3,'workshop')", [EMPTY_PROJECT, ORG, "empty"]),
  );
  await addOrgMember(ORG, "u-fac", "consultant", `${ORG}-team-energy`);
  await addProjectMember(ORG, EMPTY_PROJECT, "u-fac", "facilitator", null, true);
  await addProjectMember(ORG, STORE_PROJECT, "u-fac", "facilitator", null, true);

  await addBrowserArtifact({
    orgId: ORG, id: "f34dep-doc", projectId: STORE_PROJECT, source: "upload", title: "budget.pdf",
    mime: "application/pdf",
  });
  await addBrowserArtifact({
    orgId: ORG, id: "f34int-doc", projectId: STORE_PROJECT, source: "upload", title: "contract.pdf",
    mime: "application/pdf",
  });

  root = await mkdtemp(join(tmpdir(), "wsx-f34-"));
  realStore = new FsObjectStore(root);

  db = new PgDatabase(appConfig());
  browseDeps = {
    repo: new PgIdentityRepository(db),
    ids: new SeqIds(),
    browser: new PgArtifactBrowserRepository(db),
    objectStore: new ObjectStoreHeadProbe({
      async putOnce() { throw new Error("unavailable"); },
      async get() { throw new Error("unavailable"); },
      async head() { throw new Error("unavailable"); },
    }),
  };
});

afterAll(async () => {
  await db?.close();
  await resetOrgs(ORG);
  await rm(root, { recursive: true, force: true }).catch(() => undefined);
});

function deliveryDeps(objectStore: ObjectStore | { available(): Promise<boolean> }): DeliveryDeps {
  const store = "putOnce" in objectStore ? (objectStore as ObjectStore) : undefined;
  return {
    repo: new PgIdentityRepository(db),
    ids: new SeqIds(),
    grants: new PgDownloadGrantRepository(db),
    objectStore: store ? new ObjectStoreHeadProbe(store) : (objectStore as { available(): Promise<boolean> }),
    integrity: new ObjectStoreIntegrityChecker(store ?? realStore),
    urls: new IsolatedDownloadUrlBuilder(),
    provenance: new PgProvenanceRepository(db),
    idFactory: new SeqRowIds(),
    now: () => new Date(),
  };
}

describe("V5·22-1: a brand-new empty project is a REAL empty state", () => {
  it("listProjectArtifacts returns zero nodes and zero source counts -- no sample data", async () => {
    const r = await listProjectArtifacts(browseDeps, {
      userId: "u-fac", orgId: toOrgId(ORG), projectId: EMPTY_PROJECT,
      filters: null, cursor: null, pageSize: null,
    });
    expect(r.nodes).toEqual([]);
    expect(r.sourceCounts).toEqual([]);
    // Still validates against the signed contract -- an empty response is a real response,
    // not the absence of one.
    const parsed = C.operations.listProjectArtifacts.out.safeParse(r);
    expect(parsed.success ? null : parsed.error.issues, JSON.stringify(r)).toBeNull();
  });

  it(
    "PINS: the 「八类恒显示」 half of V5 is NOT delivered here either (files.KNOWN_CONTRACT_GAPS.FS1) -- " +
      "sourceCounts has no fixed-eight entries with count:0, only real counts of returned rows",
    async () => {
      const r = await listProjectArtifacts(browseDeps, {
        userId: "u-fac", orgId: toOrgId(ORG), projectId: EMPTY_PROJECT,
        filters: null, cursor: null, pageSize: null,
      });
      // If this ever becomes 8, `browse-artifacts.ts`'s header comment and this pin must be
      // updated TOGETHER -- it would mean FS1 was ruled, not that someone quietly patched it.
      expect(r.sourceCounts.length).not.toBe(8);
    },
  );
});

describe("V7·22-1: object storage down -- download fails NAMED, not a bare crash", () => {
  const DOWN: ObjectStore = {
    async putOnce() { throw new Error("unavailable"); },
    async get() { throw new Error("unavailable"); },
    async head() { throw new Error("unavailable"); },
  };

  it("issueDownloadUrl raises DEPENDENCY_UNAVAILABLE, checked BEFORE the integrity read", async () => {
    const deps = deliveryDeps(DOWN);
    const err = await issueDownloadUrl(deps, {
      userId: "u-fac", orgId: toOrgId(ORG), versionId: v("f34dep-doc"), purpose: "download",
    }).then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(FilesDeliveryError);
    expect((err as FilesDeliveryError).reasonCode).toBe("DEPENDENCY_UNAVAILABLE");
  });

  it("the failure is a closed reason code the contract's err list actually names", () => {
    expect(C.FilesError.options).toContain("DEPENDENCY_UNAVAILABLE");
  });
});

describe("V8·22-1: SHA-256 mismatch -- 「完整性校验失败」, download refused, audit written", () => {
  it("a version whose stored bytes do not hash to the recorded content_hash is refused", async () => {
    // The fixture's `content_hash` is the all-zero placeholder (`addBrowserArtifact`'s own
    // comment says so) -- writing ANY real bytes at the object key is already a mismatch.
    const key = `${ORG}/artifacts/f34int-doc/v1/${v("f34int-doc")}`;
    await realStore.putOnce(key, new TextEncoder().encode("these are not zero bytes"), "application/pdf");

    const deps = deliveryDeps(realStore);
    const err = await issueDownloadUrl(deps, {
      userId: "u-fac", orgId: toOrgId(ORG), versionId: v("f34int-doc"), purpose: "download",
    }).then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(FilesDeliveryError);
    expect((err as FilesDeliveryError).reasonCode).toBe("INTEGRITY_CHECK_FAILED");
  });

  it("the refusal wrote an `integrity-check-failed` provenance event naming the artifact and object key", async () => {
    const reader = new PgProvenanceRepository(db);
    const page = await reader.query(toOrgId(ORG), {
      targetKind: "artifact-version", targetId: v("f34int-doc"), limit: 10,
    });
    const hit = page.events.find((e) => e.type === "integrity-check-failed");
    expect(hit, JSON.stringify(page.events)).toBeDefined();
    expect(hit!.detail).toMatchObject({ artifactId: "f34int-doc", reason: "hash-mismatch" });
  });

  it(
    "COUNTER-PROOF: an untampered object (no bytes written -- object-missing is ALSO a failure, " +
      "not silently 'ok') is refused too -- a ghost node cannot be downloaded either",
    async () => {
      await addBrowserArtifact({
        orgId: ORG, id: "f34int-ghost", projectId: STORE_PROJECT, source: "upload", title: "ghost.pdf",
      });
      const deps = deliveryDeps(realStore);
      const err = await issueDownloadUrl(deps, {
        userId: "u-fac", orgId: toOrgId(ORG), versionId: v("f34int-ghost"), purpose: "download",
      }).then(
        () => null,
        (e: unknown) => e,
      );
      expect(err).toBeInstanceOf(FilesDeliveryError);
      expect((err as FilesDeliveryError).reasonCode).toBe("INTEGRITY_CHECK_FAILED");
    },
  );
});
