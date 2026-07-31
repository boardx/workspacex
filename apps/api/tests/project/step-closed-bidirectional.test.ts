/**
 * F120 / I-P45 -- `STEP_CLOSED`, the first of the two "空转" failure codes
 * `bindToProjectStep` was signed off to throw and could never evaluate
 * (0008-f06-binding-modes.sql:26-30: "there is no `steps` table anywhere in phase-00").
 * F118 gave a step an entity (`agenda_segments`); this is that judgement's first live throw
 * site.
 *
 * `a check that cannot fail is worse than an absent one, because it reads as coverage`
 * (0008-f06-binding-modes.sql:29-31) is the literal debt being paid down here, which is why
 * every assertion below is BOTH directions (V4): terminal segments (`closed` AND `skipped`
 * -- there are two terminal states, and testing only one leaves the other's gate unproven)
 * refuse the bind, and non-terminal segments (`pending` AND `active`) succeed in the exact
 * same test file, so "SEGMENT_CLOSED always throws" cannot pass alongside it.
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
import { StepClosedError } from "../../src/application/artifact/binding-errors";
import { toOrgId } from "../../src/domain/org-id";

const ORG = "org-f120-closed";
const PROJECT = "proj-f120-closed";
const AUTHOR = "u-f120-facilitator";

let h: Harness;

/** A segment in a named state, with no source whitelist -- irrelevant to THIS gate. */
async function seedSegment(id: string, state: string): Promise<void> {
  await asApp(ORG, (c) =>
    c.query(
      `INSERT INTO agenda_segments (id, org_id, workshop_id, ordinal, title, duration, state)
       VALUES ($1,$2,$3,0,$4,15,$5)
       ON CONFLICT (id) DO NOTHING`,
      [id, ORG, PROJECT, `segment ${id}`, state],
    ),
  );
}

/** A bare artifact row -- `draft` mode needs no version, so no materialization is needed. */
async function seedArtifact(id: string): Promise<void> {
  await asApp(ORG, (c) =>
    c.query(
      `INSERT INTO artifacts (id, org_id, project_id, source, title, created_by, synthesized)
       VALUES ($1,$2,$3,'upload',$4,$5,false)
       ON CONFLICT (id) DO NOTHING`,
      [id, ORG, PROJECT, `artifact ${id}`, AUTHOR],
    ),
  );
}

const org = () => toOrgId(ORG);

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  h = await makeHarness("f120c");
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

describe("STEP_CLOSED: terminal segments refuse a bind, non-terminal segments do not", () => {
  it("closed: refused", async () => {
    await seedSegment("f120c-closed", "closed");
    await seedArtifact("f120c-art-closed");
    await expect(
      bindToProjectStep(h.deps, {
        userId: AUTHOR, orgId: org(), artifactId: "f120c-art-closed",
        projectId: PROJECT, stepId: "f120c-closed", mode: "draft",
      }),
    ).rejects.toBeInstanceOf(StepClosedError);
  });

  it("skipped: refused too -- there are two terminal states, not one", async () => {
    await seedSegment("f120c-skipped", "skipped");
    await seedArtifact("f120c-art-skipped");
    await expect(
      bindToProjectStep(h.deps, {
        userId: AUTHOR, orgId: org(), artifactId: "f120c-art-skipped",
        projectId: PROJECT, stepId: "f120c-skipped", mode: "draft",
      }),
    ).rejects.toBeInstanceOf(StepClosedError);
  });

  it("反证 -- active: the SAME operation succeeds, proving this is not an unconditional refusal", async () => {
    await seedSegment("f120c-active", "active");
    await seedArtifact("f120c-art-active");
    const binding = await bindToProjectStep(h.deps, {
      userId: AUTHOR, orgId: org(), artifactId: "f120c-art-active",
      projectId: PROJECT, stepId: "f120c-active", mode: "draft",
    });
    expect(binding.stepId).toBe("f120c-active");
  });

  it("反证 -- pending: succeeds as well, the gate is about terminality, not about being 'active' specifically", async () => {
    await seedSegment("f120c-pending", "pending");
    await seedArtifact("f120c-art-pending");
    const binding = await bindToProjectStep(h.deps, {
      userId: AUTHOR, orgId: org(), artifactId: "f120c-art-pending",
      projectId: PROJECT, stepId: "f120c-pending", mode: "draft",
    });
    expect(binding.stepId).toBe("f120c-pending");
  });

  it("a bind against a step_id with no agenda_segments row at all is not decided by this gate (F118's FK decides it at INSERT)", async () => {
    await seedArtifact("f120c-art-noseg");
    // No STEP_CLOSED here -- and no success either, in the general case, because F118's
    // composite FK on `artifact_bindings` refuses the INSERT. This test only asserts that
    // the gate itself does not throw STEP_CLOSED for a segment it cannot find, i.e. it does
    // not invent a verdict for a state it has no row to read.
    await expect(
      bindToProjectStep(h.deps, {
        userId: AUTHOR, orgId: org(), artifactId: "f120c-art-noseg",
        projectId: PROJECT, stepId: "f120c-does-not-exist", mode: "draft",
      }),
    ).rejects.not.toBeInstanceOf(StepClosedError);
  });
});
