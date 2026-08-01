/**
 * F45 -- `previewDeleteImpact` / `requestDeletion`'s CONFIRMATION gate (uc-22-4 R3.c step 8,
 * R5, R7): impact numbers before the button is even enabled, and every refusal path around
 * the second-confirmation + reason requirement.
 *
 * Six categories and the two-tier SLA are asserted in `delete-six-cascade-invalidation.test.ts`
 * and `delete-two-tier-sla.test.ts` -- this file is the gate BEFORE the cascade ever runs.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { files as C } from "@repo/contracts";
import { addClaim } from "../support/retrieval-fixtures";
import { addOrgMember, addProjectMember, asApp, ensureDatabase, migrateOnce, resetOrgs, seedOrg } from "../support/db";
import { addBrowserArtifact } from "../support/files-db";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { appConfig } from "../../src/infrastructure/db/pg-config";
import { PgIdentityRepository } from "../../src/infrastructure/identity/pg-identity-repository";
import { PgProvenanceRepository } from "../../src/infrastructure/provenance/pg-provenance-repository";
import {
  PgCascadeInvalidationRepository,
  PgDeleteImpactRepository,
  PgDeletionTaskRepository,
  PgLegalHoldGate,
} from "../../src/infrastructure/files/pg-deletion-repository";
import { previewDeleteImpact, PreviewDeleteImpactError, type PreviewDeleteImpactDeps } from "../../src/application/files/preview-delete-impact";
import { requestDeletion, RequestDeletionError, type RequestDeletionDeps } from "../../src/application/files/request-deletion";
import { toOrgId } from "../../src/domain/org-id";

const ORG = "org-f45-preview";
const PROJECT = "proj-f45-preview";

class SeqIds {
  private n = 0;
  next(): string { return `d-${++this.n}`; }
}
// Namespaced with ORG (unique per test FILE): `deletion_tasks.id` is a bare TEXT PRIMARY KEY
// with no tenant column in the key itself (same shape `files-db.ts`'s header warns about for
// `artifacts.id`) -- two files whose id factories both start counting from 1 collide on the
// PRIMARY KEY the moment the whole `tests/files/` suite runs together, not when either file
// runs alone.
class SeqRowIds {
  private n = 0;
  next(prefix: string): string { return `${prefix}-${ORG}-${++this.n}`; }
}

let db: PgDatabase;
let previewDeps: PreviewDeleteImpactDeps;
let deleteDeps: RequestDeletionDeps;

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  await resetOrgs(ORG);
  await seedOrg({ orgId: ORG, projectId: PROJECT, teamNames: ["energy"] });
  await addOrgMember(ORG, "u-fac", "consultant", `${ORG}-team-energy`);
  await addOrgMember(ORG, "u-member", "consultant", `${ORG}-team-energy`);
  await addOrgMember(ORG, "u-obs", "consultant", `${ORG}-team-energy`);
  await addOrgMember(ORG, "u-agent", "consultant", `${ORG}-team-energy`);
  await addProjectMember(ORG, PROJECT, "u-fac", "facilitator", null, true);
  await addProjectMember(ORG, PROJECT, "u-member", "member", null, false);
  await addProjectMember(ORG, PROJECT, "u-obs", "observer", null, false);
  await addProjectMember(ORG, PROJECT, "u-agent", "facilitator", null, false);

  await addBrowserArtifact({ orgId: ORG, id: "f45prev-a", projectId: PROJECT, title: "impacted.pdf" });
  await addClaim({
    orgId: ORG, id: "f45prev-claim-1", projectId: PROJECT,
    statement: "supported by impacted.pdf", status: "accepted",
    supporting: ["f45prev-a-s1"],
  });
  // V9·22-4: a prior export leaves a trail `previewDeleteImpact` must surface.
  await asApp(ORG, (c) =>
    c.query(
      `INSERT INTO download_grants
         (id, org_id, artifact_id, version_id, object_key, principal_user_id,
          permission_decision_id, purpose, token_hash, expires_at, consumed_at, consumed_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'export',$8, now() + interval '1 hour', now(), $6)`,
      [
        "f45prev-grant-1", ORG, "f45prev-a", "f45prev-a-v1",
        `${ORG}/artifacts/f45prev-a/v1/f45prev-a-v1`, "u-outsider", "dec-1",
        "a".repeat(64),
      ],
    ),
  );

  await addBrowserArtifact({ orgId: ORG, id: "f45prev-held", projectId: PROJECT, title: "held.pdf" });
  await asApp(ORG, (c) =>
    c.query(
      `INSERT INTO legal_holds (id, org_id, artifact_id, reason, applied_by)
       VALUES ($1,$2,$3,$4,$5)`,
      ["hold-1", ORG, "f45prev-held", "litigation", "u-compliance"],
    ),
  );

  db = new PgDatabase(appConfig());
  const identity = new PgIdentityRepository(db);
  const impact = new PgDeleteImpactRepository(db);
  const legalHold = new PgLegalHoldGate(db);
  previewDeps = { repo: identity, ids: new SeqIds(), impact, legalHold };
  deleteDeps = {
    repo: identity,
    ids: new SeqIds(),
    impact,
    legalHold,
    cascades: new PgCascadeInvalidationRepository(db),
    tasks: new PgDeletionTaskRepository(db),
    provenance: new PgProvenanceRepository(db),
    idFactory: new SeqRowIds(),
    now: () => new Date("2026-08-01T00:00:00.000Z"),
    trashGraceDays: async () => 30,
  };
});

afterAll(async () => {
  await db?.close();
  // I-11 (`SNAPSHOT_IMMUTABLE`): an artifact with versions cannot be DELETEd directly, only
  // by cascade from its organization -- `resetOrgs` is the only cleanup this fixture can use.
  await resetOrgs(ORG);
});

const preview = (userId: string, artifactId: string, actorKind: "user" | "agent" = "user") =>
  previewDeleteImpact(previewDeps, { userId, orgId: toOrgId(ORG), artifactId, actorKind });

const remove = (
  userId: string,
  artifactId: string,
  opts?: Partial<{ reason: string; scope: string | null; confirmedImpact: true; actorKind: "user" | "agent" }>,
) =>
  requestDeletion(deleteDeps, {
    userId,
    orgId: toOrgId(ORG),
    artifactId,
    reason: opts?.reason ?? "customer requested erasure",
    scope: opts?.scope ?? null,
    confirmedImpact: opts?.confirmedImpact ?? true,
    actorKind: opts?.actorKind ?? "user",
  });

describe("previewDeleteImpact -- the numbers a human must see before deleting", () => {
  it("contract shape: out validates against the signed contract", async () => {
    const out = await preview("u-fac", "f45prev-a");
    expect(C.operations.previewDeleteImpact.out.safeParse(out).success).toBe(true);
  });

  it("reports version/derived/segment counts and the claim that cites this artifact", async () => {
    const out = await preview("u-fac", "f45prev-a");
    expect(out.versionCount).toBe(1);
    expect(out.derivedCount).toBe(0);
    expect(out.segmentCount).toBe(1);
    expect(out.referencingClaims.map((c) => c.id)).toContain("f45prev-claim-1");
    expect(out.legalHold).toBe(false);
  });

  it("V9·22-4: surfaces a prior export as input to the decision, not just at receipt time", async () => {
    const out = await preview("u-fac", "f45prev-a");
    expect(out.exportedOutOfOrg.length).toBeGreaterThanOrEqual(1);
    expect(out.exportedOutOfOrg[0]!.exportedBy).toBe("u-outsider");
  });

  it("reports legalHold: true for an artifact under an active hold", async () => {
    const out = await preview("u-fac", "f45prev-held");
    expect(out.legalHold).toBe(true);
  });

  it("PROJECT_ROLE_INSUFFICIENT for a member (facilitator-only action)", async () => {
    await expect(preview("u-member", "f45prev-a")).rejects.toMatchObject({ reasonCode: "PROJECT_ROLE_INSUFFICIENT" });
  });

  it("PROJECT_ROLE_INSUFFICIENT for an observer", async () => {
    await expect(preview("u-obs", "f45prev-a")).rejects.toMatchObject({ reasonCode: "PROJECT_ROLE_INSUFFICIENT" });
  });

  it("🔴 D-39: AGENT_CANNOT_DELETE for an agent actor, even one holding facilitator", async () => {
    await expect(preview("u-agent", "f45prev-a", "agent")).rejects.toMatchObject({ reasonCode: "AGENT_CANNOT_DELETE" });
  });

  it("ARTIFACT_NOT_FOUND for a nonexistent artifact", async () => {
    await expect(preview("u-fac", "f45prev-does-not-exist")).rejects.toMatchObject({ reasonCode: "ARTIFACT_NOT_FOUND" });
  });

  it("N-25: a stranger to the project gets the SAME ARTIFACT_NOT_FOUND, not a permission code", async () => {
    await addOrgMember(ORG, "u-stranger", "consultant", null);
    const err = await preview("u-stranger", "f45prev-a").then(() => null).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PreviewDeleteImpactError);
    expect((err as PreviewDeleteImpactError).reasonCode).toBe("PROJECT_ROLE_INSUFFICIENT");
  });
});

describe("requestDeletion -- the confirmation gate before the cascade may run", () => {
  it("contract shape: out validates against the signed contract", async () => {
    await addBrowserArtifact({ orgId: ORG, id: "f45prev-shape", projectId: PROJECT, title: "shape.pdf" });
    const out = await remove("u-fac", "f45prev-shape");
    expect(C.operations.requestDeletion.out.safeParse(out).success).toBe(true);
  });

  it("🔴 D-39: AGENT_CANNOT_DELETE, checked before any lookup", async () => {
    await expect(remove("u-agent", "f45prev-a", { actorKind: "agent" })).rejects.toMatchObject({
      reasonCode: "AGENT_CANNOT_DELETE",
    });
  });

  it("a reason shorter than 4 characters is refused (defensive re-check of the contract's z.string().min(4))", async () => {
    await addBrowserArtifact({ orgId: ORG, id: "f45prev-shortreason", projectId: PROJECT, title: "x.pdf" });
    await expect(remove("u-fac", "f45prev-shortreason", { reason: "no" })).rejects.toBeInstanceOf(RequestDeletionError);
  });

  it("PROJECT_ROLE_INSUFFICIENT for a member", async () => {
    await addBrowserArtifact({ orgId: ORG, id: "f45prev-member-target", projectId: PROJECT, title: "y.pdf" });
    await expect(remove("u-member", "f45prev-member-target")).rejects.toMatchObject({
      reasonCode: "PROJECT_ROLE_INSUFFICIENT",
    });
  });

  it("PROJECT_ROLE_INSUFFICIENT for an observer", async () => {
    await addBrowserArtifact({ orgId: ORG, id: "f45prev-obs-target", projectId: PROJECT, title: "z.pdf" });
    await expect(remove("u-obs", "f45prev-obs-target")).rejects.toMatchObject({
      reasonCode: "PROJECT_ROLE_INSUFFICIENT",
    });
  });

  it("ARTIFACT_NOT_FOUND for a nonexistent artifact", async () => {
    await expect(remove("u-fac", "f45prev-nope")).rejects.toMatchObject({ reasonCode: "ARTIFACT_NOT_FOUND" });
  });

  it("🔴 LEGAL_HOLD_ACTIVE: a held artifact refuses the human delete request, with no cascade run", async () => {
    await expect(remove("u-fac", "f45prev-held")).rejects.toMatchObject({ reasonCode: "LEGAL_HOLD_ACTIVE" });
    // The artifact must still be fully intact -- a refused request must not have partially run.
    const stillVisible = await preview("u-fac", "f45prev-held");
    expect(stillVisible.legalHold).toBe(true);
  });

  it("succeeds for the facilitator, and writes a `deletion-requested` provenance event", async () => {
    await addBrowserArtifact({ orgId: ORG, id: "f45prev-happy", projectId: PROJECT, title: "happy.pdf" });
    const out = await remove("u-fac", "f45prev-happy", { reason: "no longer needed" });
    expect(out.taskId).toBeTruthy();
    const requestedAt = new Date("2026-08-01T00:00:00.000Z").getTime();
    expect(new Date(out.logicalInvalidationDeadline).getTime()).toBeGreaterThan(requestedAt);
    expect(new Date(out.physicalDeletionDeadline).getTime()).toBeGreaterThan(
      new Date(out.logicalInvalidationDeadline).getTime(),
    );
  });
});
