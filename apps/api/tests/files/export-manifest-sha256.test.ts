/**
 * F33 -- `manifest.json`'s sha256 is the REAL hash of the bytes that actually sit in the zip,
 * per file, and the manifest's entry count equals the zip's file count (no silent
 * truncation, V4/E2). Also: a threshold that REJECTS rather than truncates, and a missing
 * object (PostgreSQL says STORED, the object store does not have it) that fails BEFORE
 * anything is written -- no half-built zip.
 *
 * In-memory throughout (see `tests/support/files-export-fakes.ts`'s header for why this does
 * not need PostgreSQL): these are properties of `export-manifest.ts` + `zip-codec.ts` +
 * `export-artifacts.ts`'s control flow, not of the SQL visibility predicate.
 */
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createExportJob, getExportJob, FilesExportError, type ExportDeps } from "../../src/application/files/export-artifacts";
import type { ExportableRow } from "../../src/application/files/export-ports";
import { MAX_EXPORT_ITEMS } from "../../src/domain/files/export-manifest";
import { readZip, NodeZipBuilder } from "../../src/infrastructure/files/zip-codec";
import { FakeObjectStore, SequentialIdFactory } from "../support/artifact-fakes";
import {
  FakeDecisionIds, FakeProvenanceWriter, FakeRoleViewRepository,
} from "../support/role-view-fakes";
import {
  FakeExportContentRepository, FakeDownloadUrlBuilder, InMemoryExportJobRepository,
} from "../support/files-export-fakes";
import { toOrgId } from "../../src/domain/org-id";

const ORG = toOrgId("org-f33-manifest");
const PROJECT = "proj-f33-manifest";
const USER = "u-facilitator";

function makeDeps(rows: readonly ExportableRow[]): {
  deps: ExportDeps;
  objectStore: FakeObjectStore;
  jobs: InMemoryExportJobRepository;
  content: FakeExportContentRepository;
} {
  const objectStore = new FakeObjectStore();
  const jobs = new InMemoryExportJobRepository();
  const content = new FakeExportContentRepository(rows);
  const deps: ExportDeps = {
    repo: new FakeRoleViewRepository({ [USER]: { orgRole: "consultant", projectRole: "facilitator" } }),
    ids: new FakeDecisionIds(),
    exportContent: content,
    objectStore,
    jobs,
    urls: new FakeDownloadUrlBuilder(),
    provenance: new FakeProvenanceWriter(),
    idFactory: new SequentialIdFactory(),
    zip: new NodeZipBuilder(),
    now: () => new Date("2026-08-01T00:00:00Z"),
  };
  return { deps, objectStore, jobs, content };
}

function row(overrides: Partial<ExportableRow> & { artifactId: string }): ExportableRow {
  return {
    name: `${overrides.artifactId}.txt`,
    sourceType: "upload",
    agendaSegmentId: null,
    confidential: false,
    versionNumber: 1,
    objectKey: `store/${overrides.artifactId}`,
    contentHash: "0".repeat(64),
    mime: "text/plain",
    ...overrides,
  };
}

describe("manifest.json 的 sha256 是 zip 里真实字节的哈希，条目数 = 文件数", () => {
  it("each manifest entry's sha256 equals sha256(the bytes actually stored at that path)", async () => {
    const rows = [
      row({ artifactId: "m-1", sourceType: "interview", agendaSegmentId: "seg-a" }),
      row({ artifactId: "m-2", sourceType: "interview", agendaSegmentId: "seg-a" }),
      row({ artifactId: "m-3", sourceType: "upload", agendaSegmentId: null }),
    ];
    const { deps, objectStore } = makeDeps(rows);
    for (const r of rows) {
      await objectStore.putOnce(r.objectKey, new TextEncoder().encode(`content of ${r.artifactId}`), r.mime);
    }

    const created = await createExportJob(deps, {
      userId: USER, orgId: ORG, projectId: PROJECT, artifactIds: null, treeNodeId: null,
    });
    expect(created.status).toBe("done");

    const job = await getExportJob(deps, { userId: USER, orgId: ORG, jobId: created.jobId });
    expect(job.downloadUrl).not.toBeNull();

    // The zip itself: fetched straight from the object store by the key `createExportJob`
    // wrote to (introspected through the fake repository, see its header).
    const zipKey = [...(deps.jobs as InMemoryExportJobRepository).raw.values()][0]!.objectKey;
    const zipBytes = await deps.objectStore.get(zipKey);
    expect(zipBytes).not.toBeNull();

    const entries = readZip(zipBytes!);
    const manifestEntry = entries.find((e) => e.path === "manifest.json");
    expect(manifestEntry).toBeDefined();
    const manifest = JSON.parse(Buffer.from(manifestEntry!.content).toString("utf8")) as {
      files: { artifact_id: string; sha256: string; path: string; version: number; source_type: string }[];
    };

    // V4: file count = manifest entry count. `entries` has manifest.json PLUS one per row.
    expect(entries.length).toBe(rows.length + 1);
    expect(manifest.files.length).toBe(rows.length);

    for (const m of manifest.files) {
      const fileEntry = entries.find((e) => e.path === m.path);
      expect(fileEntry, `manifest names path "${m.path}" but no such zip entry exists`).toBeDefined();
      const actualSha256 = createHash("sha256").update(fileEntry!.content).digest("hex");
      expect(actualSha256, `artifact ${m.artifact_id}: manifest sha256 does not match the zip's actual bytes`)
        .toBe(m.sha256);
      // And it is a REAL hash of REAL content, not a copy of the (deliberately fake, all-zero)
      // `contentHash` column every fixture in this repo seeds with -- see `files-db.ts`.
      expect(m.sha256).not.toBe("0".repeat(64));
    }
  });

  it("EXPORT_LIMIT_EXCEEDED: over the threshold is REJECTED, not silently truncated -- and nothing is written", async () => {
    const rows = Array.from({ length: MAX_EXPORT_ITEMS + 1 }, (_, i) => row({ artifactId: `over-${i}` }));
    const { deps, objectStore, jobs } = makeDeps(rows);
    // Note: no bytes are seeded into `objectStore` for any of these rows. If the threshold
    // check ran AFTER fetching bytes (or not at all), this test would fail with
    // DEPENDENCY_UNAVAILABLE instead of EXPORT_LIMIT_EXCEEDED -- which is itself proof the
    // check runs first, since nothing here could otherwise succeed.
    await expect(reasonCodeOf(createExportJob(deps, {
      userId: USER, orgId: ORG, projectId: PROJECT, artifactIds: null, treeNodeId: null,
    }))).resolves.toBe("EXPORT_LIMIT_EXCEEDED");

    expect(jobs.raw.size, "a rejected export must not persist a job row").toBe(0);
    expect(objectStore.putCount, "a rejected export must not write ANY object -- no half-built zip").toBe(0);
  });

  it("DEPENDENCY_UNAVAILABLE: a row whose object is missing from storage fails before anything is written", async () => {
    const rows = [
      row({ artifactId: "ok-1" }),
      row({ artifactId: "missing-1", objectKey: "store/does-not-exist" }),
    ];
    const { deps, objectStore, jobs } = makeDeps(rows);
    await objectStore.putOnce(rows[0]!.objectKey, new TextEncoder().encode("present"), "text/plain");
    // rows[1]'s object key is never put -- PostgreSQL metadata says it exists, storage does not.

    await expect(reasonCodeOf(createExportJob(deps, {
      userId: USER, orgId: ORG, projectId: PROJECT, artifactIds: null, treeNodeId: null,
    }))).resolves.toBe("DEPENDENCY_UNAVAILABLE");

    expect(jobs.raw.size).toBe(0);
    // The zip is assembled in memory and only `putOnce` once, at the very end -- so a failure
    // partway through fetching source bytes must leave the object count exactly as seeded
    // (the one file put above), never a partial zip object.
    expect(objectStore.putCount).toBe(1);
  });

  it("NO_PROJECT_ROLE: an observer (no export-eligible role) is refused before any row is read", async () => {
    const rows = [row({ artifactId: "n-1" })];
    const { deps, content } = makeDeps(rows);
    const observerDeps: ExportDeps = {
      ...deps,
      repo: new FakeRoleViewRepository({ [USER]: { orgRole: "consultant", projectRole: "observer" } }),
    };
    await expect(reasonCodeOf(createExportJob(observerDeps, {
      userId: USER, orgId: ORG, projectId: PROJECT, artifactIds: null, treeNodeId: null,
    }))).resolves.toBe("NO_PROJECT_ROLE");
    expect(content.calls.length, "denied before the repository is ever asked for rows").toBe(0);
  });
});

/** Rejects with a non-`FilesExportError` if the promise fulfilled or threw something else --
 *  a test that only checked `.rejects.toThrow()` would pass for the WRONG reason code. */
async function reasonCodeOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    if (e instanceof FilesExportError) return e.reasonCode;
    throw e;
  }
  throw new Error("expected the promise to reject with a FilesExportError, but it resolved");
}
