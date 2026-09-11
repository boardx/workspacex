import { afterEach, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createExportJob, downloadExportJob, getExportJob, MAX_EXPORT_ARCHIVE_BYTES, type ExportDeps } from "../../src/application/files/export-artifacts";
import { FsObjectStore } from "../../src/infrastructure/storage/fs-object-store";
import { NodeZipBuilder, readZip } from "../../src/infrastructure/files/zip-codec";
import { FakeDecisionIds, FakeProvenanceWriter, FakeRoleViewRepository } from "../support/role-view-fakes";
import { FakeExportContentRepository, FakeDownloadUrlBuilder, InMemoryExportJobRepository } from "../support/files-export-fakes";
import { SequentialIdFactory } from "../support/artifact-fakes";
import { toOrgId } from "../../src/domain/org-id";
const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "cloud-export-")); roots.push(root);
  const orgId = toOrgId("org-cloud-export"), userId = "exporter", projectId = "project";
  const objects = new FsObjectStore(root), bytes = Buffer.from("云端导出\n");
  await objects.putOnce("source", bytes, "text/plain");
  const deps: ExportDeps = { repo: new FakeRoleViewRepository({ [userId]: { orgRole: "consultant", projectRole: "facilitator" } }),
    ids: new FakeDecisionIds(), exportContent: new FakeExportContentRepository([{ artifactId: "a", name: "a.txt", sourceType: "upload",
      agendaSegmentId: null, confidential: false, versionNumber: 1, objectKey: "source", contentHash: "x", mime: "text/plain" }]),
    objectStore: objects, jobs: new InMemoryExportJobRepository(), urls: new FakeDownloadUrlBuilder(), provenance: new FakeProvenanceWriter(),
    idFactory: new SequentialIdFactory(), zip: new NodeZipBuilder(), now: () => new Date("2026-09-11T00:00:00Z") };
  const job = await createExportJob(deps, { orgId, userId, projectId, artifactIds: ["a"], treeNodeId: null });
  (deps.jobs as InMemoryExportJobRepository).artifactIdsByJob.set(job.jobId, ["a"]);
  return { deps, root, bytes, input: { orgId, userId, jobId: job.jobId } };
}
it("returns a redeemable URL and delivers real ZIP bytes after the object-store instance restarts", async () => {
  const { deps, root, bytes, input } = await fixture();
  expect((await getExportJob(deps, input)).downloadUrl).toBe(`/export-jobs/${input.jobId}/content`);
  const result = await downloadExportJob({ ...deps, objectStore: new FsObjectStore(root) }, input);
  const entries = readZip(result);
  expect(entries.some(entry => Buffer.from(entry.content).equals(bytes))).toBe(true);
  expect(entries.some(entry => entry.path === "manifest.json")).toBe(true);
});
it("denies other principals, other tenants, expired links and revoked project access before reading storage", async () => {
  const { deps, input } = await fixture(); const get = vi.spyOn(deps.objectStore, "get");
  await expect(downloadExportJob(deps, { ...input, userId: "someone-else" })).rejects.toThrow();
  await expect(downloadExportJob(deps, { ...input, orgId: toOrgId("another-org") })).rejects.toThrow();
  await expect(downloadExportJob({ ...deps, now: () => new Date("2026-09-12") }, input)).rejects.toThrow();
  await expect(downloadExportJob({ ...deps, repo: new FakeRoleViewRepository({}) }, input)).rejects.toThrow();
  await expect(downloadExportJob({ ...deps, exportContent: new FakeExportContentRepository([]) }, input)).rejects.toThrow();
  expect(get).not.toHaveBeenCalled();
});
it("reports unavailable archive instead of empty download", async () => {
  const { deps, input } = await fixture(); vi.spyOn(deps.objectStore, "get").mockResolvedValue(null);
  await expect(downloadExportJob(deps, input)).rejects.toThrow("files_export_failed");
});
it("rejects an oversized archive from HEAD before transferring its body", async () => {
  const { deps, input } = await fixture();
  const get = vi.spyOn(deps.objectStore, "get");
  vi.spyOn(deps.objectStore, "head").mockResolvedValue({ sizeBytes: MAX_EXPORT_ARCHIVE_BYTES + 1, mime: "application/zip" });
  await expect(downloadExportJob(deps, input)).rejects.toMatchObject({ reasonCode: "EXPORT_LIMIT_EXCEEDED" });
  expect(get).not.toHaveBeenCalled();
});
it("rejects an oversized source selection before loading source bytes into the ZIP builder", async () => {
  const { deps, input } = await fixture();
  const get = vi.spyOn(deps.objectStore, "get"); get.mockClear();
  vi.spyOn(deps.objectStore, "head").mockResolvedValue({ sizeBytes: MAX_EXPORT_ARCHIVE_BYTES + 1, mime: "text/plain" });
  await expect(createExportJob(deps, { orgId: input.orgId, userId: input.userId, projectId: "project",
    artifactIds: ["a"], treeNodeId: null })).rejects.toMatchObject({ reasonCode: "EXPORT_LIMIT_EXCEEDED" });
  expect(get).not.toHaveBeenCalled();
});
