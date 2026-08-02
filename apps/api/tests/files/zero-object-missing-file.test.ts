/**
 * F43 -- uc-22-3 V1 (file-first total gate), asserted at THIS feature's own gated entry point
 * (`materializeSourceGated`), not re-run against F41's bare `materializeSource` (already
 * covered by `materialize-seven-sources.test.ts`'s own AC1 assertion).
 *
 * "产生每一类业务对象各一个后，对每个 source_ref 断言文件浏览器有对应可下载文件、
 * 缺文件数为0" -- one business object per `MaterializationSourceType`, each identified by its
 * own `source_ref`, and the count of required-file misses across all of them must be zero.
 */
import { describe, expect, it } from "vitest";
import { toOrgId } from "../../src/domain/org-id";
import { materializeSourceGated } from "../../src/application/files/materialize-source-gated";
import { SEVEN_SOURCE_FILE_PLAN } from "../../src/domain/files/seven-source-plan";
import type { MaterializationSourceType } from "../../src/domain/files/materialization-events";
import { FakeArtifactRepository, FakeObjectStore, SequentialIdFactory, bytesFor } from "../support/artifact-fakes";
import { FakeProvenanceWriter } from "../support/role-view-fakes";
import { FakeMaterializationFailureRepository, FakeSourceRefIndex } from "../support/materialize-ready-fakes";

const ORG = toOrgId("org-f43-zero-missing");

const ALL_SOURCE_TYPES: readonly MaterializationSourceType[] = [
  "survey",
  "conversation",
  "interview",
  "workshop",
  "research",
  "canvas",
  "generated",
];

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

function fullPartsFor(sourceType: MaterializationSourceType): Record<string, Uint8Array> {
  const parts: Record<string, Uint8Array> = {};
  for (const f of SEVEN_SOURCE_FILE_PLAN[sourceType]) {
    parts[f.name] = bytesFor(`f43:${sourceType}:${f.name}`);
  }
  return parts;
}

describe("F43 zero-object-missing-file -- one business object per source, missing count 0", () => {
  it("every one of the seven sources materializes with zero missing required files, all downloadable", async () => {
    const deps = harness();
    let missingCount = 0;

    for (const sourceType of ALL_SOURCE_TYPES) {
      const result = await materializeSourceGated(deps, {
        orgId: ORG,
        projectId: "proj-1",
        sourceType,
        sourceRef: `zero-missing-${sourceType}`,
        actorId: "user-1",
        parts: fullPartsFor(sourceType),
      });

      expect(result.kind).toBe("materialized");
      if (result.kind !== "materialized") continue;

      const requiredNames = SEVEN_SOURCE_FILE_PLAN[sourceType]
        .filter((f) => !("optional" in f && f.optional))
        .map((f) => f.name);
      const gotNames = new Set(result.fileNames);
      missingCount += requiredNames.filter((n) => !gotNames.has(n)).length;

      // Every business object's files browser assertion: a real, readable, downloadable object.
      const artifact = deps.repo.artifacts.get(result.artifactId);
      expect(artifact).toBeDefined();
      const version = deps.repo.versions.get(result.versionId);
      expect(version).toBeDefined();
      const bytes = await deps.store.get(version!.objectStorageKey);
      expect(bytes).not.toBeNull();
    }

    expect(missingCount).toBe(0);
  });

  it("zero open materialization failures once every business object above has been produced", async () => {
    const deps = harness();
    for (const sourceType of ALL_SOURCE_TYPES) {
      await materializeSourceGated(deps, {
        orgId: ORG,
        projectId: "proj-1",
        sourceType,
        sourceRef: `zero-failures-${sourceType}`,
        actorId: "user-1",
        parts: fullPartsFor(sourceType),
      });
    }
    expect(await deps.failures.listOpen(ORG)).toHaveLength(0);
  });
});
