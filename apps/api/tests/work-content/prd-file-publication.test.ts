import { describe, expect, it, vi } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { WorkflowInstanceProjection } from "@repo/contracts/workflow-runtime";
import type { ArtifactRepository, ArtifactVersionRecord } from "../../src/application/artifact/ports";
import type { WorkflowStageOutputStore } from "../../src/application/workflow/workflow-runtime-ports";
import { publishPrdArtifact } from "../../src/application/work-content/prd-publication";
import { getContentInstanceOutput } from "../../src/application/work-content/get-content-instance-output";
import { FsObjectStore } from "../../src/infrastructure/storage/fs-object-store";
import { resolveObjectPath } from "../../src/infrastructure/storage/object-store-path";
import { assemblePrdArtifact } from "../../src/domain/work-content/prd-artifact";

const prd = assemblePrdArtifact({ frame: { problemStatement: "离线时无法保存访谈草稿", evidenceRefs: ["interview:offline-1"], confidence: "medium" },
  priorities: [{ id: "R1", priority: "must" }], prd: { title: "离线草稿 PRD", requirements: [{ id: "R1", text: "重连后恢复草稿" }] },
  metrics: [{ name: "恢复率", definition: "重连后成功恢复的草稿占比" }] });
const projection = { status: "succeeded", workflowKey: "problem-to-prd", definitionVersion: 2 } as WorkflowInstanceProjection;

describe("W029 saved PRD bytes", () => {
  it("reopens the actual immutable Markdown with a new storage client and rejects changed bytes", async () => {
    const root = await mkdtemp(join(tmpdir(), "w029-file-"));
    try {
      let version: ArtifactVersionRecord | null = null; let seq = 0;
      const repo = { createArtifact: vi.fn(async () => {}), headVersionNumber: async () => 0,
        createVersion: vi.fn(async (row: unknown) => { version = row as ArtifactVersionRecord; }),
        findVersion: vi.fn(async () => version) } as unknown as ArtifactRepository;
      const published = await publishPrdArtifact({ store: new FsObjectStore(root), repo, ids: { next: p => `${p}-${++seq}` } }, {
        orgId: "org-w029-file", instanceId: "w029-file-instance", initiatorUserId: "w029-file-author", prd,
      });
      // New client + reader: the response must come from storage, not the input or model fixture.
      const files = { store: new FsObjectStore(root), repo, ids: { next: () => "unused" } };
      const outputs = { find: vi.fn(async () => ({ content: { prd, file: published.file } })) } as unknown as WorkflowStageOutputStore;
      const deps = { runtime: { get: async () => projection }, outputs, files };
      const first = await getContentInstanceOutput(deps, "org-w029-file", "w029-file-author", "w029-file-instance");
      expect(first.file).toMatchObject({ artifactId: published.file.artifactId, versionId: published.file.versionId,
        markdown: expect.stringContaining("## 需求\n- R1 [must] 重连后恢复草稿") });
      expect(first.file?.markdown).toContain("interview:offline-1");
      expect(first.file?.markdown).toContain("恢复率：重连后成功恢复的草稿占比");
      expect(first.file).not.toHaveProperty("materializedKeys");
      expect(await getContentInstanceOutput(deps, "org-w029-file", "w029-file-author", "w029-file-instance")).toEqual(first);
      expect(repo.createVersion).toHaveBeenCalledTimes(1);
      const provenance = JSON.parse(Buffer.from((await files.store.get(published.file.materializedKeys[1]!))!).toString());
      expect(provenance).toMatchObject({ workflowId: "W029", prdDigest: prd.digest, semanticSupportVerified: false });
      await writeFile(resolveObjectPath(root, published.file.materializedKeys[0]!), "changed after save");
      await expect(getContentInstanceOutput(deps, "org-w029-file", "w029-file-author", "w029-file-instance")).rejects.toThrow("unreadable or changed");
      const denied = { ...deps, runtime: { get: async () => { throw new Error("workflow_not_found"); } } };
      vi.mocked(repo.findVersion).mockClear();
      await expect(getContentInstanceOutput(denied, "org-w029-file", "peer", "w029-file-instance")).rejects.toThrow("workflow_not_found");
      expect(repo.findVersion).not.toHaveBeenCalled();
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it("does not record a saved version when storage readback fails", async () => {
    const repo = { createArtifact: async () => {}, headVersionNumber: async () => 0, createVersion: vi.fn() } as unknown as ArtifactRepository;
    await expect(publishPrdArtifact({ repo, store: { putOnce: async () => {}, get: async () => null, head: async () => null }, ids: { next: p => p } }, {
      orgId: "org-w029-file", instanceId: "w029-file-instance", initiatorUserId: "w029-file-author", prd,
    })).rejects.toThrow("not readable");
    expect(repo.createVersion).not.toHaveBeenCalled();
  });

  it("keeps historical JSON-only output readable without claiming a saved file", async () => {
    const output = await getContentInstanceOutput({ runtime: { get: async () => projection },
      outputs: { find: async () => ({ content: { prd } }) } as unknown as WorkflowStageOutputStore,
    }, "org-w029-file", "w029-file-author", "historical");
    expect(output.output).toEqual(prd);
    expect(output.file).toBeUndefined();
  });
});
