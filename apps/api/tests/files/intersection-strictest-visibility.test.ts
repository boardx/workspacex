/**
 * F42 -- uc-22-3 R7 「架构第五节」/ R12 V7: a `generated` artifact's effective `confidential`
 * flag is the STRICTEST of what the caller asked for and every source it was assembled from --
 * never looser. This is the "摘要造成越权信息洗白" guard: a summarizer that (correctly, or by a
 * bug) marks its own output non-confidential must not be able to launder a confidential source
 * into something anyone can read.
 *
 * Runs against `FakeArtifactRepository` (no Postgres), same pattern as
 * `synthesized-evidence-policy.test.ts` and `materialize-seven-sources.test.ts`.
 */
import { describe, expect, it } from "vitest";
import { toOrgId } from "../../src/domain/org-id";
import { materializeSource } from "../../src/application/files/materialize-source";
import { SEVEN_SOURCE_FILE_PLAN } from "../../src/domain/files/seven-source-plan";
import { strictestConfidential } from "../../src/domain/files/generated-visibility";
import { FakeArtifactRepository, FakeObjectStore, SequentialIdFactory, bytesFor } from "../support/artifact-fakes";

const ORG = toOrgId("org-f42-strictest");

function harness() {
  return { store: new FakeObjectStore(), repo: new FakeArtifactRepository(), ids: new SequentialIdFactory() };
}

function genParts(): Record<string, Uint8Array> {
  const parts: Record<string, Uint8Array> = {};
  for (const f of SEVEN_SOURCE_FILE_PLAN.generated) parts[f.name] = bytesFor(`generated:${f.name}`);
  return parts;
}

describe("F42 intersection -- generated content takes the strictest of its own + every source's confidentiality", () => {
  it("domain rule (pure): true wins unconditionally, regardless of how many sources are false", () => {
    expect(strictestConfidential(false, [{ confidential: false }, { confidential: false }])).toBe(false);
    expect(strictestConfidential(false, [{ confidential: false }, { confidential: true }])).toBe(true);
    expect(strictestConfidential(true, [])).toBe(true);
    // Nine public sources plus one confidential one -- not "mostly public".
    expect(
      strictestConfidential(
        false,
        Array.from({ length: 9 }, () => ({ confidential: false })).concat([{ confidential: true }]),
      ),
    ).toBe(true);
  });

  it("materialization: caller marks the generated artifact non-confidential, but one of its sources was confidential -- the STORED row is confidential:true anyway", async () => {
    const deps = harness();
    const result = await materializeSource(deps, {
      orgId: ORG,
      projectId: "proj-1",
      sourceType: "generated",
      sourceRef: "gen-launder-attempt",
      actorId: "agent-1",
      confidential: false, // the (wrong) value a naive generator call would pass
      sourceConfidentialFlags: [false, false, true], // one of the three sources it read WAS confidential
      parts: genParts(),
    });
    const artifact = deps.repo.artifacts.get(result.artifactId);
    expect(artifact?.confidential).toBe(true);
  });

  it("counter-proof: all sources non-confidential -> the caller's own (false) value survives untouched", async () => {
    const deps = harness();
    const result = await materializeSource(deps, {
      orgId: ORG,
      projectId: "proj-1",
      sourceType: "generated",
      sourceRef: "gen-all-public",
      actorId: "agent-1",
      confidential: false,
      sourceConfidentialFlags: [false, false, false],
      parts: genParts(),
    });
    const artifact = deps.repo.artifacts.get(result.artifactId);
    expect(artifact?.confidential).toBe(false);
  });

  it("non-generated sourceTypes are unaffected by `sourceConfidentialFlags` -- only `generated` content can launder a source", async () => {
    const deps = harness();
    const parts: Record<string, Uint8Array> = {};
    for (const f of SEVEN_SOURCE_FILE_PLAN.interview) parts[f.name] = bytesFor(`interview:${f.name}`);
    const result = await materializeSource(deps, {
      orgId: ORG,
      projectId: "proj-1",
      sourceType: "interview",
      sourceRef: "itv-1",
      actorId: "user-1",
      confidential: false,
      // Even if a caller mistakenly passed this for a non-generated source, it must not apply.
      sourceConfidentialFlags: [true],
      parts,
    });
    const artifact = deps.repo.artifacts.get(result.artifactId);
    expect(artifact?.confidential).toBe(false);
  });
});
