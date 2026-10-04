import { describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FsObjectStore } from "../../src/infrastructure/storage/fs-object-store";
import { publishResearchBrief } from "../../src/application/work-content/research-brief-publication";
import { buildResearchBrief } from "../../src/domain/work-content/research-brief";
import type { ArtifactRepository } from "../../src/application/artifact/ports";
import { computeContentHash, versionContentHash } from "../../src/domain/artifact/content-hash";

describe("W001 real file materialization (no DB/services/model)", () => {
  it("writes and reopens Markdown plus truthful provenance with matching immutable version hash", async () => {
    const root = await mkdtemp(join(tmpdir(), "w001-publication-"));
    try {
      const store = new FsObjectStore(root); let id = 0;
      const repo = { createArtifact: vi.fn(async (_args: unknown) => {}), headVersionNumber: async () => 0, createVersion: vi.fn(async () => {}) };
      const brief = buildResearchBrief("Atlas", [{ text: "输入报告7/12", evidenceRefs: ["input-summary"], confidence: "low" }], []);
      const result = await publishResearchBrief({ store, repo: repo as unknown as ArtifactRepository, ids: { next: prefix => `${prefix}-${++id}` } }, {
        orgId: "org-w001-publication", initiatorUserId: "initiator", brief,
        provenance: { workflowId: "W001", instanceId: "instance", agentVersionId: "frozen", semanticSupportVerified: false },
      });
      const reopened = await Promise.all(result.materializedKeys.map(key => new FsObjectStore(root).get(key)));
      expect(result.materializedKeys).toHaveLength(2);
      expect(Buffer.from(reopened[0]!).toString()).toContain("输入报告7/12");
      expect(JSON.parse(Buffer.from(reopened[1]!).toString())).toMatchObject({ synthesized: true, briefDigest: brief.digest, instanceId: "instance", semanticSupportVerified: false });
      expect(result.contentHash).toBe(versionContentHash(reopened.map(bytes => computeContentHash(bytes!))));
      expect(repo.createArtifact.mock.calls[0]![0]).toMatchObject({ orgId: "org-w001-publication", source: "ai-generated", synthesized: true });
    } finally { await rm(root, { recursive: true, force: true }); }
  });
  it("does not record a version or return saved when object readback fails", async () => {
    const repo = { createArtifact: async () => {}, headVersionNumber: async () => 0, createVersion: vi.fn() };
    await expect(publishResearchBrief({ store: { putOnce: async () => {}, get: async () => null, head: async () => null }, repo: repo as unknown as ArtifactRepository, ids: { next: p => p } }, {
      orgId: "org-w001-publication", initiatorUserId: "initiator", brief: buildResearchBrief("Atlas", [{ text: "仅输入事实", evidenceRefs: ["input"], confidence: "low" }], []), provenance: {},
    })).rejects.toThrow("not readable");
    expect(repo.createVersion).not.toHaveBeenCalled();
  });
});
