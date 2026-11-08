import { beforeAll, afterAll, it, expect } from "vitest";
import type { NestExpressApplication } from "@nestjs/platform-express";
import {
  ensureDatabase,
  migrateOnce,
  seedOrg,
  addOrgMember,
  asApp,
  resetOrgs,
} from "../support/db";
process.env.KERNEL_ALLOW_TEST_PRINCIPAL = "1";
process.env.KERNEL_QUIET = "1";
const ORG = "org-blueprint-active-roles",
  OTHER = "org-blueprint-active-other",
  BP = "bp-active-roles";
let app: NestExpressApplication, base: string;
beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  await seedOrg({ orgId: ORG, projectId: `${ORG}-seed` });
  await seedOrg({ orgId: OTHER, projectId: `${OTHER}-seed` });
  await addOrgMember(ORG, "bp-admin", "admin", null);
  await addOrgMember(ORG, "bp-member", "consultant", null);
  await addOrgMember(OTHER, "bp-other-admin", "admin", null);
  await asApp(ORG, async (c) => {
    await c.query(
      "INSERT INTO blueprints(id,org_id,name,state,origin,created_by) VALUES($1,$2,'Role blueprint','published','blank','bp-admin')",
      [BP, ORG],
    );
    await c.query(
      "INSERT INTO blueprint_versions(id,blueprint_id,org_id,version_number,content,state) VALUES($1,$2,$3,1,'{}','published')",
      [`${BP}-v1`, BP, ORG],
    );
  });
  const { createApp } = await import("../../src/main");
  app = await createApp();
  await app.listen(0, "127.0.0.1");
  base = await app.getUrl();
}, 120000);
afterAll(async () => {
  await app?.close();
  await resetOrgs(ORG, OTHER);
});
const apply = (user: string, org = ORG) =>
  fetch(`${base}/blueprints/${BP}/apply`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-kernel-test-principal": `${user}:${org}`,
    },
    body: JSON.stringify({
      versionId: null,
      tier: null,
      projectName: "Applied blueprint",
      idempotencyKey: `apply-${user}`,
    }),
  });
it("ordinary members cannot apply and create no project", async () => {
  const r = await apply("bp-member");
  expect(r.status).toBe(403);
  expect(await r.json()).toMatchObject({ reasonCode: "ROLE_INSUFFICIENT" });
  const rows = await asApp(ORG, (c) =>
    c.query("SELECT id FROM projects WHERE name='Applied blueprint'"),
  );
  expect(rows.rows).toHaveLength(0);
});
it("administrators apply a published blueprint through the live route and persist the project", async () => {
  const r = await apply("bp-admin");
  expect(r.status).toBe(201);
  const rows = await asApp(ORG, (c) =>
    c.query("SELECT id FROM projects WHERE name='Applied blueprint'"),
  );
  expect(rows.rows).toHaveLength(1);
});
it("another organization administrator cannot apply this blueprint", async () => {
  const r = await apply("bp-other-admin", OTHER);
  expect(r.status).toBe(404);
  const rows = await asApp(OTHER, (c) =>
    c.query("SELECT id FROM projects WHERE name='Applied blueprint'"),
  );
  expect(rows.rows).toHaveLength(0);
});
