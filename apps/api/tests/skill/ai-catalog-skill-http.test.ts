import { beforeAll, afterAll, it, expect } from "vitest";
import type { NestExpressApplication } from "@nestjs/platform-express";
import {
  ensureDatabase,
  migrateOnce,
  seedOrg,
  addCredential,
  addOrgMember,
  resetOrgs,
  asApp,
} from "../support/db";
const ORG = "org-catalog-skill-http",
  PLATFORM = "org-platform",
  OPS = "catalog-skill-ops",
  ADMIN = "catalog-skill-admin",
  MEMBER = "catalog-skill-member";
let app: NestExpressApplication, base: string;
const previous = process.env.PLATFORM_SUPERUSER_EMAILS;
beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  for (const orgId of [ORG, PLATFORM])
    await seedOrg({ orgId, projectId: `${orgId}-catalog-test` });
  await addCredential(OPS, "catalog-skill-ops@example.test", "Ops");
  await addOrgMember(ORG, ADMIN, "admin", null);
  await addOrgMember(ORG, MEMBER, "consultant", null);
  process.env.PLATFORM_SUPERUSER_EMAILS = "catalog-skill-ops@example.test";
  process.env.KERNEL_ALLOW_TEST_PRINCIPAL = "1";
  process.env.KERNEL_QUIET = "1";
  const { createApp } = await import("../../src/main");
  app = await createApp();
  await app.listen(0, "127.0.0.1");
  base = await app.getUrl();
}, 120000);
afterAll(async () => {
  await app?.close();
  await resetOrgs(ORG, PLATFORM);
  if (previous === undefined) delete process.env.PLATFORM_SUPERUSER_EMAILS;
  else process.env.PLATFORM_SUPERUSER_EMAILS = previous;
});
function request(user: string, path: string, body?: unknown) {
  return fetch(base + path, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      "content-type": "application/json",
      "x-kernel-test-principal": `${user}:${ORG}`,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
it("public Skill requires publication then administrator enablement; raw source remains tenant-hidden", async () => {
  const path = `/platform/organizations/${PLATFORM}/ai-catalog`;
  expect(
    (
      await request(ADMIN, path, {
        kind: "skill",
        input: {
          name: "Forbidden",
          stableName: "forbidden",
          description: "No",
          content: "# No",
        },
      })
    ).status,
  ).toBe(403);
  const created = await request(OPS, path, {
    kind: "skill",
    input: {
      name: "Public HTTP Skill",
      stableName: "public-http-skill",
      description: "Public short description",
      content: "# Public HTTP Skill\n\nUse this Skill.",
    },
  });
  expect(created.status).toBe(201);
  const source = await created.json();
  expect(source.id).toBeTruthy();
  const offer = () =>
    request(MEMBER, `/organizations/${ORG}/public-ai-catalog?kind=skill`).then(
      (r) => r.json(),
    );
  expect(
    (await offer()).entries.some((x: { id: string }) => x.id === source.id),
  ).toBe(false);
  expect(
    (
      await asApp(ORG, (s) =>
        s.query("SELECT id FROM skills WHERE id=$1", [source.id]),
      )
    ).rows,
  ).toHaveLength(0);
  const published = await request(
    OPS,
    `${path}/skill/${source.id}/publish`,
    {},
  );
  expect(published.status).toBe(201);
  const out = await published.json();
  expect(out.published).toBe(true);
  expect(
    (await offer()).entries.find((x: { id: string }) => x.id === source.id)
      ?.enabled,
  ).toBe(false);
  const body = {
    kind: "skill",
    id: source.id,
    versionId: out.versionId,
    idempotencyKey: "skill-enable-http",
  };
  expect(
    (
      await request(
        MEMBER,
        `/organizations/${ORG}/public-ai-catalog/enable`,
        body,
      )
    ).status,
  ).toBe(403);
  const enabled = await request(
    ADMIN,
    `/organizations/${ORG}/public-ai-catalog/enable`,
    body,
  );
  expect(enabled.status).toBe(201);
  const local = await enabled.json();
  const repeated = await request(
    ADMIN,
    `/organizations/${ORG}/public-ai-catalog/enable`,
    body,
  );
  expect(repeated.status).toBe(201);
  expect((await repeated.json()).id).toBe(local.id);
  expect(local.originVersionId).toBe(out.versionId);
  expect(local.id).not.toBe(source.id);
  expect(
    (
      await asApp(ORG, (s) =>
        s.query(
          "SELECT id FROM skill_versions WHERE org_id=$1 AND id=$2 AND published",
          [ORG, local.versionId],
        ),
      )
    ).rows,
  ).toHaveLength(1);
  expect(
    (
      await asApp(ORG, (s) =>
        s.query("SELECT content FROM skill_version_files WHERE version_id=$1", [
          out.versionId,
        ]),
      )
    ).rows,
  ).toHaveLength(0);
  const draft2=await fetch(base+`${path}/skill/${source.id}`,{method:'PATCH',headers:{'content-type':'application/json','x-kernel-test-principal':`${OPS}:${ORG}`},body:JSON.stringify({kind:'skill',input:{name:'Public HTTP Skill',stableName:'public-http-skill',description:'Second draft description',content:'# Second immutable version'}})});expect(draft2.status).toBe(200);
  expect((await offer()).entries.find((x:{id:string})=>x.id===source.id)).toMatchObject({versionId:out.versionId,description:'Public short description'});
  const pub2=await request(OPS,`${path}/skill/${source.id}/publish`,{});expect(pub2.status).toBe(201);const version2=await pub2.json();
  const upgrade=await request(ADMIN,`/organizations/${ORG}/public-ai-catalog/enable`,{...body,versionId:version2.versionId,idempotencyKey:'skill-enable-v2'});expect(upgrade.status).toBe(201);const upgraded=await upgrade.json();expect(upgraded.id).toBe(local.id);expect(upgraded.versionId).not.toBe(local.versionId);
  const bytes=await asApp(ORG,s=>s.query<{content:Buffer}>('SELECT content FROM skill_version_files WHERE version_id=$1',[local.versionId]));expect(bytes.rows[0]?.content.toString()).toContain('# Public HTTP Skill');
  const privateDraft=await fetch(base+`/platform/organizations/${ORG}/ai-catalog/skill/${local.id}`,{method:'PATCH',headers:{'content-type':'application/json','x-kernel-test-principal':`${OPS}:${ORG}`},body:JSON.stringify({kind:'skill',input:{name:'Private fork',stableName:'local-fork',description:'Local edits',content:'# Local protected edits'}})});expect(privateDraft.status).toBe(200);
  const draft3=await fetch(base+`${path}/skill/${source.id}`,{method:'PATCH',headers:{'content-type':'application/json','x-kernel-test-principal':`${OPS}:${ORG}`},body:JSON.stringify({kind:'skill',input:{name:'Public HTTP Skill',stableName:'public-http-skill',description:'Third',content:'# Third public'}})});expect(draft3.status).toBe(200);
  const pub3=await request(OPS,`${path}/skill/${source.id}/publish`,{});expect(pub3.status).toBe(201);const version3=await pub3.json();
  const conflict=await request(ADMIN,`/organizations/${ORG}/public-ai-catalog/enable`,{...body,versionId:version3.versionId,idempotencyKey:'skill-enable-v3'});expect(conflict.status).toBe(409);expect(await conflict.json()).toMatchObject({reasonCode:'CATALOG_VERSION_CONFLICT'});
  const privateBytes=await asApp(ORG,s=>s.query<{content:Buffer}>(`SELECT f.content FROM skill_versions v JOIN skill_version_files f ON f.version_id=v.id AND f.org_id=v.org_id WHERE v.org_id=$1 AND v.skill_id=$2 ORDER BY v.created_at DESC LIMIT 1`,[ORG,local.id]));expect(privateBytes.rows[0]?.content.toString()).toBe('# Local protected edits');


});

it('platform operator reads a private legacy contract without acquiring organization membership',async()=>{
 await asApp(ORG,s=>s.query(`INSERT INTO skill_contracts(id,org_id,name,duty,source,status,visibility,created_by) VALUES('legacy-http-private',$1,'Private legacy','Private definition','自建','草稿','org-wide',$2)`,[ORG,ADMIN]));
 const path=`/platform/organizations/${ORG}/ai-catalog/skill/legacy-http-private?entityType=skill-contract`;
 expect((await request(MEMBER,path)).status).toBe(403);
 const detail=await request(OPS,path);expect(detail.status).toBe(200);expect(await detail.json()).toMatchObject({entry:{entityType:'skill-contract',name:'Private legacy'},definition:{kind:'skill-contract',input:{status:'草稿',source:'自建'}}});
});
