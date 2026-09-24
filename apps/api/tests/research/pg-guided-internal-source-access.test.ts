import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  addArtifact,
  addBinding,
  addOrgMember,
  addProjectMember,
  ensureDatabase,
  migrateOnce,
  resetOrgs,
  seedOrg,
} from "../support/db";
import { PgGuidedInternalSourceAccess } from "../../src/infrastructure/research/pg-guided-internal-source-access";
import { PgIdentityRepository } from "../../src/infrastructure/identity/pg-identity-repository";
import { CountingDecisionIdFactory } from "../../src/infrastructure/identity/in-memory-session-store";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { appConfig } from "../../src/infrastructure/db/pg-config";
import { toOrgId } from "../../src/domain/org-id";

const ORG = "org-guided-source-acl";
const PROJECT = "project-guided-source-acl";
const ARTIFACT = "guided-team-only-artifact";
let db: PgDatabase;
let sourceAccess: PgGuidedInternalSourceAccess;

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  db = new PgDatabase(appConfig());
  sourceAccess = new PgGuidedInternalSourceAccess(
    db,
    new PgIdentityRepository(db),
    new CountingDecisionIdFactory(),
  );
});

beforeEach(async () => {
  await resetOrgs(ORG);
  const fixture = await seedOrg({ orgId: ORG, projectId: PROJECT });
  await addOrgMember(ORG, "u-energy-researcher", "consultant", fixture.teams.energy!);
  await addProjectMember(ORG, PROJECT, "u-energy-researcher", "facilitator", null);
  await addOrgMember(ORG, "u-platform-researcher", "consultant", fixture.teams.platform!);
  await addProjectMember(ORG, PROJECT, "u-platform-researcher", "facilitator", null);
  await addOrgMember(ORG, "u-energy-outsider", "consultant", fixture.teams.energy!);
  await addArtifact({ orgId: ORG, id: ARTIFACT, projectId: PROJECT });
  await addBinding({
    orgId: ORG,
    subject: { kind: "team", id: fixture.teams.energy! },
    object: { kind: "artifact", id: ARTIFACT },
    scope: "team-only",
    ownerTeamId: fixture.teams.energy!,
  });
});

describe("PgGuidedInternalSourceAccess", () => {
  it("allows the owning team and denies a different team in the same project", async () => {
    await expect(sourceAccess.authorizedSourceIds({
      orgId: toOrgId(ORG),
      userId: "u-energy-researcher",
      sessionId: "session-energy",
    }, [ARTIFACT])).resolves.toEqual([ARTIFACT]);

    await expect(sourceAccess.authorizedSourceIds({
      orgId: toOrgId(ORG),
      userId: "u-platform-researcher",
      sessionId: "session-platform",
    }, [ARTIFACT])).resolves.toEqual([]);

    await expect(sourceAccess.authorizedSourceIds({
      orgId: toOrgId(ORG),
      userId: "u-energy-outsider",
      sessionId: "session-energy-outsider",
    }, [ARTIFACT])).resolves.toEqual([]);
  });
});
