/**
 * F43 -- uc-22-3 V6: "AI 生成物缺 provenance.json 拒绝物化为 READY，停在 REVIEW_PENDING
 * 标「溯源信息缺失」".
 *
 * Only the `generated` source is gated (`domain/files/materialize-ready-gate.ts`). Every
 * other source has no provenance concept and is unaffected.
 */
import { describe, expect, it } from "vitest";
import { toOrgId } from "../../src/domain/org-id";
import { materializeSourceGated } from "../../src/application/files/materialize-source-gated";
import { PROVENANCE_MISSING_REASON } from "../../src/domain/files/materialize-ready-gate";
import { SEVEN_SOURCE_FILE_PLAN } from "../../src/domain/files/seven-source-plan";
import { FakeArtifactRepository, FakeObjectStore, SequentialIdFactory, bytesFor } from "../support/artifact-fakes";
import { FakeProvenanceWriter } from "../support/role-view-fakes";
import { FakeMaterializationFailureRepository, FakeSourceRefIndex } from "../support/materialize-ready-fakes";

const ORG = toOrgId("org-f43-provenance-ready");

function harness() {
  return {
    store: new FakeObjectStore(),
    repo: new FakeArtifactRepository(),
    ids: new SequentialIdFactory(),
    index: new FakeSourceRefIndex(),
    failures: new FakeMaterializationFailureRepository(),
    provenance: new FakeProvenanceWriter(),
  };
}

describe("F43 provenance-required-for-ready -- AI 生成物缺溯源 ⇒ REVIEW_PENDING", () => {
  it("generated source with provenance.json present ⇒ materializes READY", async () => {
    const deps = harness();
    const result = await materializeSourceGated(deps, {
      orgId: ORG,
      projectId: "proj-1",
      sourceType: "generated",
      sourceRef: "gen-with-provenance",
      actorId: "agent-1",
      parts: {
        "content.md": bytesFor("gen-with-provenance:content.md"),
        "provenance.json": bytesFor("gen-with-provenance:provenance.json"),
      },
    });

    expect(result.kind).toBe("materialized");
    if (result.kind !== "materialized") return;
    expect(result.readyState).toBe("READY");
    expect(result.reviewReason).toBeNull();
    expect([...result.fileNames].sort()).toEqual(["content.md", "provenance.json"]);

    const artifact = deps.repo.artifacts.get(result.artifactId) as { ingestionStatus?: string };
    // Untouched path (provenance present) goes through F41's own `materializeSource`, whose
    // `NewArtifact` never sets `ingestionStatus` -- the column default is READY.
    expect(artifact.ingestionStatus).toBeUndefined();
  });

  it("generated source missing provenance.json ⇒ still materializes content.md, but REVIEW_PENDING '溯源信息缺失', not refused outright", async () => {
    const deps = harness();
    const result = await materializeSourceGated(deps, {
      orgId: ORG,
      projectId: "proj-1",
      sourceType: "generated",
      sourceRef: "gen-missing-provenance",
      actorId: "agent-1",
      parts: {
        "content.md": bytesFor("gen-missing-provenance:content.md"),
      },
    });

    expect(result.kind).toBe("materialized");
    if (result.kind !== "materialized") return;
    expect(result.readyState).toBe("REVIEW_PENDING");
    expect(result.reviewReason).toBe(PROVENANCE_MISSING_REASON);
    expect(result.fileNames).toEqual(["content.md"]);

    // R7 "不存在业务对象存在但浏览器什么都没有的静默态" -- the artifact IS there, downloadable.
    const artifact = deps.repo.artifacts.get(result.artifactId) as { ingestionStatus?: string };
    expect(artifact.ingestionStatus).toBe("REVIEW_PENDING");
    const version = deps.repo.versions.get(result.versionId);
    expect(version).toBeDefined();
    const bytes = await deps.store.get(version!.objectStorageKey);
    expect(bytes).not.toBeNull();
  });

  it("generated source missing BOTH content.md and provenance.json ⇒ genuinely fails (not a REVIEW_PENDING gate)", async () => {
    const deps = harness();
    const result = await materializeSourceGated(deps, {
      orgId: ORG,
      projectId: "proj-1",
      sourceType: "generated",
      sourceRef: "gen-missing-everything",
      actorId: "agent-1",
      parts: {},
    });

    expect(result.kind).toBe("failed");
    if (result.kind !== "failed") return;
    expect(result.reason).toContain("content.md");
    expect(deps.repo.artifacts.size).toBe(0);
  });

  it("every non-generated source is unaffected by the provenance gate (always READY once required files are present)", async () => {
    const deps = harness();
    const parts: Record<string, Uint8Array> = {};
    for (const f of SEVEN_SOURCE_FILE_PLAN.survey) parts[f.name] = bytesFor(`gate-unaffected:${f.name}`);

    const result = await materializeSourceGated(deps, {
      orgId: ORG,
      projectId: "proj-1",
      sourceType: "survey",
      sourceRef: "survey-unaffected",
      actorId: "user-1",
      parts,
    });

    expect(result.kind).toBe("materialized");
    if (result.kind !== "materialized") return;
    expect(result.readyState).toBe("READY");
    expect(result.reviewReason).toBeNull();
  });

  it("V10: retrying the same source_ref with identical bytes does not create a new version, only a recheck provenance event", async () => {
    const deps = harness();
    const input = {
      orgId: ORG,
      projectId: "proj-1",
      sourceType: "generated" as const,
      sourceRef: "gen-idempotent",
      actorId: "agent-1",
      parts: {
        "content.md": bytesFor("gen-idempotent:content.md"),
        "provenance.json": bytesFor("gen-idempotent:provenance.json"),
      },
    };

    const first = await materializeSourceGated(deps, input);
    expect(first.kind).toBe("materialized");
    if (first.kind !== "materialized") return;

    const second = await materializeSourceGated(deps, input);
    expect(second.kind).toBe("unchanged");
    if (second.kind !== "unchanged") return;
    expect(second.artifactId).toBe(first.artifactId);
    expect(second.versionId).toBe(first.versionId);
    expect(deps.repo.versions.size).toBe(1);

    const recheckEvent = deps.provenance.appended.find((e) => e.detail["recheck"] === true);
    expect(recheckEvent).toBeTruthy();
    expect(recheckEvent?.target).toEqual({ kind: "artifact", id: first.artifactId });
  });
});
