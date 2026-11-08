import { mkdtempSync, readFileSync, cpSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, afterAll, it, expect } from "vitest";
import type { NestExpressApplication } from "@nestjs/platform-express";
import {
  ensureDatabase,
  migrateOnce,
  seedOrg,
  addOrgMember,
  resetOrgs,
  asApp,
} from "../support/db";
import { DISPLAY_METADATA_VERSION } from "../../src/domain/localization/authored-display-metadata";
const ORG = "org-official-enable-chain",
  ADMIN = "official-enable-admin",
  MEMBER = "official-enable-member";
process.env.KERNEL_ALLOW_TEST_PRINCIPAL = "1";
process.env.KERNEL_QUIET = "1";
let app: NestExpressApplication, base: string;
let imageRoot: string;
const previousWorkflowRoot = process.env.WORKFLOW_DEFINITIONS_ROOT;
const headers = (user = ADMIN, org = ORG) => ({
  "content-type": "application/json",
  "x-kernel-test-principal": `${user}:${org}`,
});
const post = (path: string, body: unknown, user = ADMIN, org = ORG) =>
  fetch(base + path, {
    method: "POST",
    headers: headers(user, org),
    body: JSON.stringify(body),
  });
beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  await seedOrg({ orgId: ORG, projectId: `${ORG}-project` });
  await addOrgMember(ORG, ADMIN, "admin", null);
  await addOrgMember(ORG, MEMBER, "consultant", null);
  imageRoot = mkdtempSync(join(tmpdir(), "official-image-assets-"));
  const workflows = join(imageRoot, "requirements/work-stack-v2/workflows");
  const dockerfile = readFileSync(
    new URL("../../../../deploy/aliyun/images/api.Dockerfile", import.meta.url),
    "utf8",
  );
  // Replay only this required Docker COPY into an isolated runtime-shaped tree.
  // With the pre-fix Dockerfile this directory is absent, just as in the shipped image.
  if (
    /^COPY(?: --[^ ]+)* requirements\/work-stack-v2\/workflows \.\/requirements\/work-stack-v2\/workflows$/m.test(
      dockerfile,
    )
  ) {
    mkdirSync(dirname(workflows), { recursive: true });
    cpSync(
      fileURLToPath(
        new URL(
          "../../../../requirements/work-stack-v2/workflows",
          import.meta.url,
        ),
      ),
      workflows,
      { recursive: true },
    );
  }
  process.env.WORKFLOW_DEFINITIONS_ROOT = workflows;
  const { createApp } = await import("../../src/main");
  app = await createApp();
  await app.listen(0, "127.0.0.1");
  base = await app.getUrl();
}, 120000);
afterAll(async () => {
  await app?.close();
  await resetOrgs(ORG, "org-official-existing-localized");
  if (previousWorkflowRoot === undefined)
    delete process.env.WORKFLOW_DEFINITIONS_ROOT;
  else process.env.WORKFLOW_DEFINITIONS_ROOT = previousWorkflowRoot;
  if (imageRoot) rmSync(imageRoot, { recursive: true, force: true });
});
it("the actual shipped offer dependency chain enables localized official roles and replays safely in an existing organization", async () => {
  const displayOffer = await fetch(
    base + "/admin/entity-display-updates/offer",
    { headers: headers() },
  );
  expect(displayOffer.status).toBe(200);
  const metadata = await displayOffer.json();
  expect(metadata.metadataVersion).toBe(DISPLAY_METADATA_VERSION);
  const response = await fetch(base + "/agents/official-role-pack/offer", {
    headers: headers(),
  });
  expect(response.status).toBe(200);
  const offer = await response.json();
  expect(offer.pending.length).toBeGreaterThan(0);
  for (const pack of offer.requiredSkillPacks) {
    const r = await post("/admin/skills/starter-pack-imports", {
      ...pack,
      idempotencyKey: `picker-enable-skill-${pack.packId}@${pack.packVersion}`,
      expectedOrgId: ORG,
    });
    expect([200, 201], `${pack.packId}: ${await r.clone().text()}`).toContain(
      r.status,
    );
  }
  const body = {
    packId: offer.packId,
    packVersion: metadata.metadataVersion,
    idempotencyKey: `picker-enable-${offer.packId}@${DISPLAY_METADATA_VERSION}`,
    expectedOrgId: ORG,
  };
  const imported = await post("/admin/agents/starter-pack-imports", body);
  expect(imported.status, await imported.clone().text()).toBe(201);
  const applied = await post("/admin/entity-display-updates", {
    expectedOrgId: ORG,
    expectedMetadataVersion: metadata.metadataVersion,
    idempotencyKey: "enable-display-first",
  });
  expect(applied.status, await applied.clone().text()).toBe(200);
  const directory = await fetch(base + "/agents/directory", {
    headers: headers(MEMBER),
  });
  expect(directory.status).toBe(200);
  expect(JSON.stringify(await directory.json())).toContain("official");
  const rows = await asApp(ORG, (s) =>
    s.query("SELECT id FROM agents WHERE org_id=$1 AND catalog_source=$2", [
      ORG,
      "official",
    ]),
  );
  expect(rows.rows).toHaveLength(offer.pending.length);
  for (const pack of offer.requiredSkillPacks) {
    const replay = await post("/admin/skills/starter-pack-imports", {
      ...pack,
      idempotencyKey: `picker-enable-skill-${pack.packId}@${pack.packVersion}`,
      expectedOrgId: ORG,
    });
    expect(replay.status, await replay.clone().text()).toBe(200);
  }
  expect((await post("/admin/agents/starter-pack-imports", body)).status).toBe(
    200,
  );
  const replayDisplay = await post("/admin/entity-display-updates", {
    expectedOrgId: ORG,
    expectedMetadataVersion: metadata.metadataVersion,
    idempotencyKey: "enable-display-retry",
  });
  expect(replayDisplay.status, await replayDisplay.clone().text()).toBe(200);
  const after = await fetch(base + "/agents/official-role-pack/offer", {
    headers: headers(),
  });
  expect((await after.json()).pending).toHaveLength(0);
  expect(
    (
      await post(
        "/admin/agents/starter-pack-imports",
        { ...body, idempotencyKey: "unauthorized-member" },
        MEMBER,
      )
    ).status,
  ).toBe(403);
  expect(
    (
      await post("/admin/agents/starter-pack-imports", {
        ...body,
        expectedOrgId: "another-org",
        idempotencyKey: "wrong-tenant",
      })
    ).status,
  ).toBe(403);
}, 180000);
it("an organization with installed localized Skill packages can enable roles through the legacy dependency request sequence", async () => {
  const org = "org-official-existing-localized",
    admin = "official-existing-localized-admin";
  await seedOrg({ orgId: org, projectId: `${org}-project` });
  await addOrgMember(org, admin, "admin", null);
  const offerResponse = await fetch(base + "/agents/official-role-pack/offer", {
    headers: headers(admin, org),
  });
  expect(offerResponse.status).toBe(200);
  const offer = await offerResponse.json();
  for (const pack of offer.requiredSkillPacks) {
    const r = await post(
      "/admin/skills/starter-pack-imports",
      {
        packId: pack.packId,
        packVersion: DISPLAY_METADATA_VERSION,
        idempotencyKey: `preinstalled-localized-${pack.packId}`,
        expectedOrgId: org,
      },
      admin,
      org,
    );
    expect(r.status, await r.clone().text()).toBe(201);
  }
  const dependencyStatuses: number[] = [];
  for (const pack of offer.requiredSkillPacks) {
    const r = await post(
      "/admin/skills/starter-pack-imports",
      {
        ...pack,
        idempotencyKey: `picker-enable-skill-${pack.packId}@${pack.packVersion}`,
        expectedOrgId: org,
      },
      admin,
      org,
    );
    dependencyStatuses.push(r.status);
    expect([200, 201, 409], await r.clone().text()).toContain(r.status);
    if (r.status === 409) {
      expect(await r.json()).toMatchObject({
        reasonCode: "SKILL_STARTER_PACK_CONFLICT",
      });
    }
  }
  console.info(
    JSON.stringify({
      fixture: "preinstalled-localized",
      dependencyStatusCounts: Object.fromEntries(
        [200, 201, 409].map((status) => [
          status,
          dependencyStatuses.filter((actual) => actual === status).length,
        ]),
      ),
    }),
  );
  const imported = await post(
    "/admin/agents/starter-pack-imports",
    {
      packId: offer.packId,
      packVersion: DISPLAY_METADATA_VERSION,
      idempotencyKey: "existing-localized-enable",
      expectedOrgId: org,
    },
    admin,
    org,
  );
  expect(imported.status, await imported.clone().text()).toBe(201);
  const after = await fetch(base + "/agents/official-role-pack/offer", {
    headers: headers(admin, org),
  });
  expect((await after.json()).pending).toHaveLength(0);
}, 180000);
