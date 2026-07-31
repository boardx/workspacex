/**
 * F120 / I-P17 -- `STEP_REJECTS_ARTIFACT_TYPE`, the second of the two "空转" failure codes
 * (see `step-closed-bidirectional.test.ts` for the shared history with F118/0008).
 *
 * V5's three assertions, all in this file:
 *   1. a non-empty whitelist REJECTS a source not on it
 *   2. the SAME segment ACCEPTS a source that IS on it
 *   3. an EMPTY whitelist (Q-2③'s default) accepts EVERY source
 *
 * The third is not decoration. `acceptedSources: []` meaning "unrestricted" is the contract's
 * own default, so without a test that exercises a NON-empty whitelist somewhere, this code
 * can never fire in any fixture that only ever uses the default -- "at least one segment
 * configured a non-empty whitelist" is exactly what the notes call out as the condition under
 * which this gate is not vacuous.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  addOrgMember,
  addProjectMember,
  asApp,
  ensureDatabase,
  migrateOnce,
  resetOrgs,
  seedOrg,
} from "../support/db";
import { makeHarness, type Harness } from "../support/binding-fixture";
import { bindToProjectStep } from "../../src/application/artifact/bind-to-project-step";
import { StepRejectsArtifactTypeError } from "../../src/application/artifact/binding-errors";
import { toOrgId } from "../../src/domain/org-id";

const ORG = "org-f120-sources";
const PROJECT = "proj-f120-sources";
const AUTHOR = "u-f120-sources-facilitator";

let h: Harness;

async function seedSegment(id: string, acceptedSources: readonly string[]): Promise<void> {
  await asApp(ORG, (c) =>
    c.query(
      `INSERT INTO agenda_segments (id, org_id, workshop_id, ordinal, title, duration, state, accepted_sources)
       VALUES ($1,$2,$3,0,$4,15,'active',$5)
       ON CONFLICT (id) DO NOTHING`,
      [id, ORG, PROJECT, `segment ${id}`, acceptedSources],
    ),
  );
}

/** A bare artifact of a given `source` -- `draft` mode needs no version. */
async function seedArtifact(id: string, source: string): Promise<void> {
  await asApp(ORG, (c) =>
    c.query(
      `INSERT INTO artifacts (id, org_id, project_id, source, title, created_by, synthesized)
       VALUES ($1,$2,$3,$4,$5,$6,false)
       ON CONFLICT (id) DO NOTHING`,
      [id, ORG, PROJECT, source, `artifact ${id}`, AUTHOR],
    ),
  );
}

const org = () => toOrgId(ORG);
const bind = (artifactId: string, stepId: string) =>
  bindToProjectStep(h.deps, {
    userId: AUTHOR, orgId: org(), artifactId, projectId: PROJECT, stepId, mode: "draft",
  });

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  h = await makeHarness("f120s");
});

afterAll(async () => {
  await h?.close();
});

beforeEach(async () => {
  await resetOrgs(ORG);
  const fx = await seedOrg({ orgId: ORG, projectId: PROJECT });
  await addOrgMember(ORG, AUTHOR, "consultant", fx.teams.energy!);
  await addProjectMember(ORG, PROJECT, AUTHOR, "facilitator", null);
});

describe("STEP_REJECTS_ARTIFACT_TYPE: a non-empty whitelist rejects and accepts", () => {
  it("['upload']: a prototype-run artifact is refused", async () => {
    await seedSegment("f120s-only-upload", ["upload"]);
    await seedArtifact("f120s-art-proto", "prototype-run");
    await expect(bind("f120s-art-proto", "f120s-only-upload")).rejects.toBeInstanceOf(
      StepRejectsArtifactTypeError,
    );
  });

  it("反证 -- ['upload']: an upload artifact on the SAME segment succeeds", async () => {
    await seedSegment("f120s-only-upload-2", ["upload"]);
    await seedArtifact("f120s-art-upload", "upload");
    const binding = await bind("f120s-art-upload", "f120s-only-upload-2");
    expect(binding.stepId).toBe("f120s-only-upload-2");
  });
});

describe("STEP_REJECTS_ARTIFACT_TYPE: an empty whitelist (the Q-2③ default) accepts every source", () => {
  it("acceptedSources = [] on the segment: every one of the seven ArtifactSource values binds", async () => {
    await seedSegment("f120s-unrestricted", []);
    const sources = [
      "survey",
      "conversation",
      "interview",
      "prototype-run",
      "research-run",
      "upload",
      "ai-generated",
    ] as const;
    for (const source of sources) {
      const artifactId = `f120s-art-${source}`;
      await seedArtifact(artifactId, source);
      const binding = await bind(artifactId, "f120s-unrestricted");
      expect(binding.stepId, `source "${source}" was refused on an unrestricted segment`).toBe(
        "f120s-unrestricted",
      );
    }
  });
});
