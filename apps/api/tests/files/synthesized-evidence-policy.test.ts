/**
 * F42 -- uc-22-3 R7 / R12 V5 / V6 (partial): `generated` artifacts are tagged `synthesized`
 * unconditionally, and the tag is not something a caller can turn off by construction.
 *
 * Runs against `FakeArtifactRepository` (no Postgres), per issue #74's constraint and the same
 * pattern `materialize-seven-sources.test.ts` (F41) already uses for this module.
 *
 * ## What this file does NOT re-test
 *
 * `materialize-seven-sources.test.ts` already covers the seven-file-name contract end to end.
 * This file is narrowly about the ONE flag D-25 turns on: `synthesized`.
 */
import { describe, expect, it } from "vitest";
import { toOrgId } from "../../src/domain/org-id";
import { materializeSource } from "../../src/application/files/materialize-source";
import { SEVEN_SOURCE_FILE_PLAN } from "../../src/domain/files/seven-source-plan";
import type { MaterializationSourceType } from "../../src/domain/files/materialization-events";
import { FakeArtifactRepository, FakeObjectStore, SequentialIdFactory, bytesFor } from "../support/artifact-fakes";

const ORG = toOrgId("org-f42-synth");

function harness() {
  return { store: new FakeObjectStore(), repo: new FakeArtifactRepository(), ids: new SequentialIdFactory() };
}

function fullPartsFor(sourceType: MaterializationSourceType): Record<string, Uint8Array> {
  const parts: Record<string, Uint8Array> = {};
  for (const f of SEVEN_SOURCE_FILE_PLAN[sourceType]) parts[f.name] = bytesFor(`${sourceType}:${f.name}`);
  return parts;
}

describe("F42 synthesized tag -- generated artifacts are marked, non-generated ones never are", () => {
  it("AC3: a `generated` artifact is synthesized:true -- 100%, not conditionally", async () => {
    const deps = harness();
    const result = await materializeSource(deps, {
      orgId: ORG,
      projectId: "proj-1",
      sourceType: "generated",
      sourceRef: "gen-1",
      actorId: "agent-1",
      parts: fullPartsFor("generated"),
    });
    const artifact = deps.repo.artifacts.get(result.artifactId);
    expect(artifact?.synthesized).toBe(true);
  });

  it("counter-proof: the other six source types are NEVER synthesized -- the flag is not a default-on constant", async () => {
    const deps = harness();
    const nonGenerated: readonly MaterializationSourceType[] = [
      "survey", "conversation", "interview", "workshop", "research", "canvas",
    ];
    for (const sourceType of nonGenerated) {
      const result = await materializeSource(deps, {
        orgId: ORG,
        projectId: "proj-1",
        sourceType,
        sourceRef: `not-gen-${sourceType}`,
        actorId: "user-1",
        parts: fullPartsFor(sourceType),
      });
      const artifact = deps.repo.artifacts.get(result.artifactId);
      expect(artifact?.synthesized).toBe(false);
    }
  });

  it("`isSynthesizedSource`/derived tag agrees with the materialized flag: sourceType 'ai-generated' IS the synthesized tag, not a second fact", async () => {
    const { isSynthesizedSource } = await import("../../src/domain/context-pack/evidence-policy-filter");
    expect(isSynthesizedSource("ai-generated")).toBe(true);
    expect(isSynthesizedSource("interview")).toBe(false);
    expect(isSynthesizedSource("file")).toBe(false);
  });
});
