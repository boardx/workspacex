/**
 * F41 -- uc-22-3 V1 (file-first total gate): for EVERY one of the seven
 * `MaterializationSourceType`s (F40's own event-source vocabulary), producing one business
 * object and materializing it must yield an artifact whose written file-name set is EXACTLY
 * `SEVEN_SOURCE_FILE_PLAN[sourceType]`'s row -- no source may come up short, and none should
 * happen to write an extra file the contract table never asked for.
 *
 * Walks `MaterializationSourceType` (imported from F40's own event catalog), not a
 * hand-written list of seven strings, so an eighth source added there without a
 * corresponding `SEVEN_SOURCE_FILE_PLAN` row fails at the TYPE level (see that file's
 * `satisfies Record<MaterializationSourceType, ...>`), the same exhaustiveness discipline
 * `tests/rec/file-first-materialization.test.ts` already uses for F73's `CARRIERS`.
 */
import { describe, expect, it } from "vitest";
import { toOrgId } from "../../src/domain/org-id";
import {
  materializeSource,
  SourceMaterializationFailedError,
} from "../../src/application/files/materialize-source";
import {
  SEVEN_SOURCE_FILE_PLAN,
  SOURCE_TYPE_ARTIFACT_SOURCE_TAG,
} from "../../src/domain/files/seven-source-plan";
import type { MaterializationSourceType } from "../../src/domain/files/materialization-events";
import { FakeArtifactRepository, FakeObjectStore, SequentialIdFactory, bytesFor } from "../support/artifact-fakes";

const ORG = toOrgId("org-f41");

/** MaterializationSourceType has exactly these seven members -- listing them here (rather
 *  than deriving from `Object.keys`) means TypeScript itself flags the list as incomplete
 *  the moment `SEVEN_SOURCE_FILE_PLAN`'s `satisfies` clause would also start failing. */
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
  return { store: new FakeObjectStore(), repo: new FakeArtifactRepository(), ids: new SequentialIdFactory() };
}

/** Every file the plan lists for this source, required AND optional -- the "audio was
 *  actually captured" / "whiteboard was actually used" scenario, so V1's exact-set assertion
 *  compares against the FULL contract row rather than only its required subset. */
function fullPartsFor(sourceType: MaterializationSourceType): Record<string, Uint8Array> {
  const parts: Record<string, Uint8Array> = {};
  for (const f of SEVEN_SOURCE_FILE_PLAN[sourceType]) {
    parts[f.name] = bytesFor(`${sourceType}:${f.name}`);
  }
  return parts;
}

describe("F41 materialize seven sources -- uc-22-3 V1 file-first total gate", () => {
  it.each(ALL_SOURCE_TYPES)(
    "%s: materializing produces exactly the contract's file-name set, all downloadable",
    async (sourceType) => {
      const deps = harness();
      const result = await materializeSource(deps, {
        orgId: ORG,
        projectId: "proj-1",
        sourceType,
        sourceRef: `ref-${sourceType}`,
        actorId: "user-1",
        parts: fullPartsFor(sourceType),
      });

      const expectedNames = SEVEN_SOURCE_FILE_PLAN[sourceType].map((f) => f.name).sort();
      expect([...result.fileNames].sort()).toEqual(expectedNames);

      // ② every written key is really in the store, and reads back the same bytes.
      for (const key of result.materializedKeys) {
        const back = await deps.store.get(key);
        expect(back).not.toBeNull();
      }

      // The row exists and is tagged with the documented ArtifactSource workaround.
      const artifact = deps.repo.artifacts.get(result.artifactId);
      expect(artifact?.source).toBe(SOURCE_TYPE_ARTIFACT_SOURCE_TAG[sourceType]);
      expect(deps.repo.versions.has(result.versionId)).toBe(true);
    },
  );

  it("zero business objects are missing a required file across all seven sources (AC1, 'assert missing count is 0')", async () => {
    const deps = harness();
    let missingCount = 0;
    for (const sourceType of ALL_SOURCE_TYPES) {
      const result = await materializeSource(deps, {
        orgId: ORG,
        projectId: "proj-1",
        sourceType,
        sourceRef: `ac1-${sourceType}`,
        actorId: "user-1",
        parts: fullPartsFor(sourceType),
      });
      const requiredNames = SEVEN_SOURCE_FILE_PLAN[sourceType]
        .filter((f) => !("optional" in f && f.optional))
        .map((f) => f.name);
      const gotNames = new Set(result.fileNames);
      missingCount += requiredNames.filter((n) => !gotNames.has(n)).length;
    }
    expect(missingCount).toBe(0);
  });

  it("a required file missing its bytes is refused, not silently materialized short", async () => {
    const deps = harness();
    const parts = fullPartsFor("survey");
    delete parts["schema.json"];
    await expect(
      materializeSource(deps, {
        orgId: ORG,
        projectId: "proj-1",
        sourceType: "survey",
        sourceRef: "ref-survey-missing",
        actorId: "user-1",
        parts,
      }),
    ).rejects.toBeInstanceOf(SourceMaterializationFailedError);
  });

  it("D-03a: the job's environment-binding field is agenda_segment_id, never design_facet_id/method_stage_id", async () => {
    const deps = harness();
    const result = await materializeSource(deps, {
      orgId: ORG,
      projectId: "proj-1",
      sourceType: "canvas",
      sourceRef: "ref-canvas-binding",
      actorId: "user-1",
      agendaSegmentId: "seg-1",
      parts: fullPartsFor("canvas"),
    });
    const artifact = deps.repo.artifacts.get(result.artifactId) as { agendaSegmentId?: string | null };
    expect(artifact.agendaSegmentId).toBe("seg-1");
    expect(Object.keys(artifact)).not.toContain("designFacetId");
    expect(Object.keys(artifact)).not.toContain("methodStageId");
  });
});
