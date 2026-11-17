import { webcrypto } from "node:crypto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { aidtResearchContentPath, hashAidtResearchBytes, listAidtResearchMaterials, parseAidtResearchMaterial, readAidtResearchMaterial, uploadAidtResearchMaterial, type AidtResearchMaterialReference } from "@/features/aidt/lib/aidt-research-materials";
const mocks = vi.hoisted(() => ({ enabled: true, fetch: vi.fn(), list: vi.fn(), stage: vi.fn() }));
vi.mock("@/features/aidt/lib/aidt-module-config", () => ({ isAidtModuleEnabled: () => mocks.enabled }));
vi.mock("@/features/aidt/lib/live-aidt-stages", () => ({ listAidtStages: mocks.list, readAidtStage: mocks.stage }));
vi.mock("@/lib/api-client", async original => ({ ...await original<typeof import("@/lib/api-client")>(), apiUrl: (path: string) => `/api${path}` }));
const context = { projectId: "p", sessionToken: "captured" };
const bytes = new Uint8Array([116, 101, 120, 116]).buffer;
let reference: AidtResearchMaterialReference;
const status = () => new Response(JSON.stringify({ ingestionRunId: "run", status: "STORED", history: ["STORED"], originalDownloadable: true, retrievable: false }), { status: 200, headers: { "Content-Type": "application/json" } });
const content = (patch: Record<string, string> = {}) => new Response(bytes, { status: 200, headers: { "Content-Type": "text/plain; charset=utf-8", "X-Content-SHA256": reference.sha256, "X-Artifact-Id": "artifact", "X-Artifact-Version-Id": "version", ...patch } });
beforeEach(async () => {
  vi.resetAllMocks(); mocks.enabled = true; vi.stubGlobal("crypto", webcrypto); vi.stubGlobal("fetch", mocks.fetch);
  reference = { projectId: "p", runId: "run", artifactId: "artifact", versionId: "version", name: "教学夹具.txt", mime: "text/plain", bytes: 4, sha256: await hashAidtResearchBytes(bytes) };
});
afterEach(() => vi.unstubAllGlobals());
it("uploads actual multipart bytes with the student's duplicate choice, then verifies a distinct real run and file version", async () => {
  const file = new File(["text"], "教学夹具.txt", { type: "text/plain" }); Object.defineProperty(file, "arrayBuffer", { value: async () => bytes });
  mocks.fetch.mockResolvedValueOnce(new Response(JSON.stringify({ runs: [{ ingestionRunId: "run", artifactId: "artifact", duplicateHit: { artifactId: "artifact", versionNumber: 1, sha256: reference.sha256 } }] }), { status: 201 }));
  const receipt = await uploadAidtResearchMaterial(context, file, "use-existing");
  const [url, init] = mocks.fetch.mock.calls[0]!;
  expect(url).toBe("/api/projects/p/artifacts/upload"); expect(init.headers).toEqual({ Authorization: "Bearer captured" });
  expect(JSON.parse((init.body as FormData).get("meta") as string)).toMatchObject({ projectId: "p", onDuplicate: "use-existing", files: [{ filename: file.name, sizeBytes: 4, sha256: reference.sha256 }] });
  expect((init.body as FormData).get("files")).toBeInstanceOf(File); expect(receipt.duplicateAction).toBe("use-existing");
  mocks.fetch.mockResolvedValueOnce(status()).mockResolvedValueOnce(content());
  const result = await readAidtResearchMaterial(context, receipt);
  expect(result.reference).toEqual(reference); expect(result.reference.runId).not.toBe(result.reference.versionId);
  expect(result.status?.retrievable).toBe(false); expect(result.processingFailed).toBe(false); expect(await result.blob.arrayBuffer()).toEqual(bytes);
  expect(mocks.fetch.mock.calls.map(call => call[0])).toEqual(["/api/projects/p/artifacts/upload", "/api/ingestion-runs/run?projectId=p", "/api/ingestion-runs/run/content?projectId=p"]);
});
it("refuses corrupt bytes, altered version, hidden hashes and wrong project before reporting an original as usable", async () => {
  const patches: Record<string, string>[] = [{ "X-Content-SHA256": "0".repeat(64) }, { "X-Artifact-Id": "other" }, { "X-Artifact-Version-Id": "changed" }, { "Content-Type": "text/html" }];
  for (const patch of patches) {
    mocks.fetch.mockResolvedValueOnce(status()).mockResolvedValueOnce(content(patch));
    await expect(readAidtResearchMaterial(context, reference)).rejects.toThrow("AIDT_MATERIAL_INTEGRITY_FAILED");
  }
  const before = mocks.fetch.mock.calls.length;
  await expect(readAidtResearchMaterial({ ...context, projectId: "other" }, reference)).rejects.toThrow("AIDT_MATERIAL_SCOPE_MISMATCH");
  expect(mocks.fetch).toHaveBeenCalledTimes(before);
});
it("keeps archive or withdrawn access failures visible and stops on cancellation without reading more bytes", async () => {
  mocks.fetch.mockResolvedValueOnce(new Response(JSON.stringify({ reasonCode: "ARTIFACT_NOT_FOUND" }), { status: 404 }));
  await expect(readAidtResearchMaterial(context, reference)).rejects.toMatchObject({ status: 404 });
  const cancellation = new AbortController(); mocks.fetch.mockImplementationOnce(async () => { cancellation.abort(); return status(); });
  await expect(readAidtResearchMaterial({ ...context, signal: cancellation.signal }, reference)).rejects.toThrow("AIDT_CONTEXT_CHANGED");
  expect(mocks.fetch).toHaveBeenCalledTimes(2);
  mocks.enabled = false; await expect(readAidtResearchMaterial(context, reference)).rejects.toThrow("AIDT_CONTEXT_CHANGED"); expect(mocks.fetch).toHaveBeenCalledTimes(2);
});
it("keeps an intact original readable after explicit downstream ingestion failure without claiming READY", async () => {
  mocks.fetch.mockResolvedValueOnce(new Response(JSON.stringify({ reasonCode: "INGESTION_FAILED" }), { status: 422 })).mockResolvedValueOnce(content());
  const result = await readAidtResearchMaterial(context, reference);
  expect(result.reference).toEqual(reference); expect(result.processingFailed).toBe(true); expect(result.status).toBeNull();
  expect(mocks.fetch).toHaveBeenCalledTimes(2);
});
it.each([401, 403, 404, 503])("never falls back to content after an authorization/unknown status failure (%s)", async code => {
  mocks.fetch.mockResolvedValueOnce(new Response(JSON.stringify({ reasonCode: "INGESTION_FAILED" }), { status: code }));
  await expect(readAidtResearchMaterial(context, reference)).rejects.toMatchObject({ status: code }); expect(mocks.fetch).toHaveBeenCalledOnce();
});
it("does not reinterpret another 422 error as an intact original", async () => {
  mocks.fetch.mockResolvedValueOnce(new Response(JSON.stringify({ reasonCode: "INTEGRITY_CHECK_FAILED" }), { status: 422 }));
  await expect(readAidtResearchMaterial(context, reference)).rejects.toMatchObject({ status: 422, reasonCode: "INTEGRITY_CHECK_FAILED" }); expect(mocks.fetch).toHaveBeenCalledOnce();
});
it("uses actual run submission headers rather than the current reader, while keeping legacy references readable", async () => {
  mocks.fetch.mockResolvedValueOnce(status()).mockResolvedValueOnce(content({ "X-Upload-Submitted-By": "original-upload-submitter", "X-Upload-Submitted-At": "2026-11-16T00:30:00.000Z" }));
  const result = await readAidtResearchMaterial(context, reference);
  expect(result.reference.submittedBy).toBe("original-upload-submitter"); expect(result.reference.submittedAt).toBe("2026-11-16T00:30:00.000Z");
  expect(parseAidtResearchMaterial(JSON.stringify(reference))).toEqual(reference);
  mocks.fetch.mockResolvedValueOnce(status()).mockResolvedValueOnce(content({ "X-Upload-Submitted-By": "submitter", "X-Upload-Submitted-At": "invalid time" }));
  await expect(readAidtResearchMaterial(context, reference)).rejects.toThrow();
});
it("discovers persisted native sources without inventing a version from a name, blob or foreign stage", async () => {
  mocks.list.mockResolvedValueOnce({ items: [{ stageId: 2, revision: 1 }] });
  mocks.stage.mockResolvedValueOnce({ stage: { projectId: "p", content: { draft: { fields: { "researchFile:a": JSON.stringify(reference), "ideaFile:b": JSON.stringify(reference), "researchFile:foreign": JSON.stringify({ ...reference, projectId: "foreign" }), legacy: "blob:fake" } } } } });
  expect(await listAidtResearchMaterials(context)).toEqual([reference]);
  expect(parseAidtResearchMaterial(JSON.stringify({ name: "not uploaded" }))).toBeNull();
  expect(aidtResearchContentPath(reference)).toBe("/ingestion-runs/run/content?projectId=p");
  expect(() => aidtResearchContentPath({ projectId: "p", runId: ".." })).toThrow();
});
