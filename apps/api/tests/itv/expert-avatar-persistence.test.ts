import { afterAll, beforeAll, expect, it } from "vitest";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { appConfig, migrationConfig } from "../../src/infrastructure/db/pg-config";
import { toOrgId } from "../../src/domain/org-id";
import { addOrgMember, ensureDatabase, migrateOnce, resetOrgs, seedOrg } from "../support/db";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { PgDigitalInterviewRepository } from "../../src/infrastructure/interview/pg-digital-interview-repository";
import { appendInterviewMarkdownDocument } from "../../src/infrastructure/interview/interview-markdown-store";

process.env.KERNEL_ALLOW_TEST_PRINCIPAL = "1";
process.env.KERNEL_QUIET = "1";
const ORG = "org-avatar-persistence";
const OTHER = "org-avatar-persistence-other";
const USER = "avatar-actor";
let app: NestExpressApplication;
let db: PgDatabase;
let base: string;
const headers = (user = USER, org = ORG) => ({ "x-kernel-test-principal": `${user}:${org}`, "content-type": "application/json" });
const path = () => `${base}/interviews/digital/experts/avatar-expert/avatar`;

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  db = new PgDatabase(appConfig());
  await resetOrgs(ORG, OTHER);
  const org = await seedOrg({ orgId: ORG, projectId: "proj-avatar-persistence" });
  const otherOrg = await seedOrg({ orgId: OTHER, projectId: "proj-avatar-persistence-other" });
  await addOrgMember(ORG, USER, "consultant", org.teams.energy!);
  await addOrgMember(ORG, "another-actor", "consultant", org.teams.energy!);
  await addOrgMember(OTHER, USER, "consultant", otherOrg.teams.energy!);
  await db.withTenant(toOrgId(ORG), async (s) => {
    await s.query(`INSERT INTO agents (id,org_id,stable_name,name,status,creator_id,created_at,updated_at,initials,role,visibility,source,publish_state,model_id,concurrency_limit,degrade_policy)
      VALUES ('avatar-expert',$1,'avatar-expert','Avatar expert','enabled',$2,now(),now(),'AE','Research expert','全组织可用','self','运行中','model-avatar',2,'跟随组织级')`, [ORG, USER]);
    await s.query(`INSERT INTO agent_versions (id,org_id,agent_id,semantic_label,instruction_digest,instructions,skill_version_ids,model_provider,model_id,tool_policy,creator_id,created_at,published_at)
      VALUES ('avatar-agent-v1',$1,'avatar-expert','v1',$2,'instructions',ARRAY[]::text[],'test','model-avatar','[]'::jsonb,$3,now(),now())`, [ORG, "a".repeat(64), USER]);
    await s.query(`UPDATE agents SET published_version_id='avatar-agent-v1' WHERE org_id=$1 AND id='avatar-expert'`, [ORG]);
    await s.query(`INSERT INTO capability_listings (id,org_id,kind,name,scope,enabled,abbr,duty,role_label)
      VALUES ('avatar-expert',$1,'agent','Avatar expert','org-wide',true,'AE','Research expert','Expert')`, [ORG]);
    await s.query(`INSERT INTO digital_expert_profiles (org_id,agent_id,domains) VALUES ($1,'avatar-expert',ARRAY['research']) ON CONFLICT DO NOTHING`, [ORG]);
  });
  const { createApp } = await import("../../src/main");
  app = await createApp();
  await app.listen(0, "127.0.0.1");
  const address = app.getHttpServer().address();
  base = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
}, 120_000);

afterAll(async () => { await app?.close(); await resetOrgs(ORG, OTHER); await db?.close(); });

it("persists avatar across fresh HTTP reads without changing agent version, isolates actors and rejects stale writes", async () => {
  const initial = await fetch(path(), { headers: headers() });
  expect(initial.status).toBe(200);
  expect(await initial.json()).toEqual({ expertId: "avatar-expert", avatarKey: null, version: 0 });
  const saved = await fetch(path(), { method: "PATCH", headers: headers(), body: JSON.stringify({ avatarKey: "robot", expectedVersion: 0 }) });
  expect(saved.status).toBe(200);
  expect(await saved.json()).toEqual({ expertId: "avatar-expert", avatarKey: "robot", version: 1 });
  expect(await (await fetch(path(), { headers: headers() })).json()).toEqual({ expertId: "avatar-expert", avatarKey: "robot", version: 1 });
  expect((await db.withoutTenant((s) => s.query("SELECT expert_id FROM digital_expert_avatar_preferences WHERE expert_id='avatar-expert'"))).rows).toEqual([]);
  expect(await (await fetch(path(), { headers: headers("another-actor") })).json()).toEqual({ expertId: "avatar-expert", avatarKey: null, version: 0 });
  expect((await fetch(path(), { method: "PATCH", headers: headers("another-actor"), body: JSON.stringify({ avatarKey: "person-5", expectedVersion: 0 }) })).status).toBe(200);
  expect((await fetch(path(), { method: "PATCH", headers: headers("another-actor"), body: JSON.stringify({ avatarKey: "person-6", expectedVersion: 1 }) })).status).toBe(200);
  expect(await (await fetch(path(), { headers: headers() })).json()).toEqual({ expertId: "avatar-expert", avatarKey: "robot", version: 1 });
  expect((await fetch(path(), { method: "PATCH", headers: headers(), body: JSON.stringify({ avatarKey: "person-1", expectedVersion: 0 }) })).status).toBe(409);
  const version = await db.withTenant(toOrgId(ORG), (s) => s.query<{ published_version_id: string }>("SELECT published_version_id FROM agents WHERE org_id=$1 AND id='avatar-expert'", [ORG]));
  expect(version.rows[0]?.published_version_id).toBe("avatar-agent-v1");
  const reset = await fetch(path(), { method: "PATCH", headers: headers(), body: JSON.stringify({ avatarKey: null, expectedVersion: 1 }) });
  expect(await reset.json()).toEqual({ expertId: "avatar-expert", avatarKey: null, version: 2 });
  const contenders = await Promise.all(["robot", "person-2"].map((avatarKey) => fetch(path(), {
    method: "PATCH", headers: headers(), body: JSON.stringify({ avatarKey, expectedVersion: 2 }),
  })));
  expect(contenders.map((response) => response.status).sort()).toEqual([200, 409]);
});

it("requires authentication, expert visibility and an allowed first party SVG key", async () => {
  expect((await fetch(path())).status).toBe(401);
  expect((await fetch(path(), { headers: headers(USER, OTHER) })).status).toBe(404);
  expect((await fetch(path(), { method: "PATCH", headers: headers(USER, OTHER), body: JSON.stringify({ avatarKey: "robot", expectedVersion: 0 }) })).status).toBe(404);
  expect((await fetch(path(), { method: "PATCH", headers: headers(), body: JSON.stringify({ avatarKey: "robot", expectedVersion: 2, actorId: "another-actor" }) })).status).toBe(400);
  expect((await fetch(path(), { method: "PATCH", headers: headers(), body: JSON.stringify({ avatarKey: "<svg onload='bad'>", expectedVersion: 2 }) })).status).toBe(400);
  await db.withTenant(toOrgId(ORG), (s) => s.query("UPDATE capability_listings SET enabled=false WHERE org_id=$1 AND id='avatar-expert'", [ORG]));
  expect((await fetch(path(), { headers: headers() })).status).toBe(404);
  expect((await fetch(path(), { method: "PATCH", headers: headers(), body: JSON.stringify({ avatarKey: "robot", expectedVersion: 2 }) })).status).toBe(404);
});

it("edits saved virtual expert avatars only within an authorized current interview revision", async () => {
  const interviewId = "avatar-source-interview";
  const revisionId = "avatar-source-revision";
  const expertId = "virtual-avatar-stable";
  const sourceMarkdown = `# 专家\n\n## [教师](#expert-${expertId})\n\n模拟角色画像。\n\n普通链接 [未保存专家](#expert-virtual-unsaved)。`;
  await new PgDigitalInterviewRepository(db).createDraft({ orgId: toOrgId(ORG), actorId: USER, interviewId,
    scope: { kind: "none", projectId: null, researchProjectId: null }, name: "头像源访谈", topic: "需求", tags: [] });
  const append = async (markdown: string, expectedVersion: number) => db.withTenant(toOrgId(ORG), async (s) => {
    await appendInterviewMarkdownDocument(s, { orgId: toOrgId(ORG), interviewId, revisionId, step: "experts", title: "专家", markdown, evidenceMode: "simulated", references: [], expectedVersion, status: "draft" });
  });
  await db.withTenant(toOrgId(ORG), (s) => s.query("INSERT INTO digital_interview_revisions(org_id,id,interview_id,revision_number,created_by) VALUES($1,$2,$3,1,$4)", [ORG, revisionId, interviewId, USER]));
  await append(sourceMarkdown, 0);
  const sourcePath = (id = expertId, revision = revisionId) => `${base}/interviews/digital/${interviewId}/markdown/experts/${id}/avatar?revisionId=${revision}`;
  const save = (user = USER, version = 0) => fetch(sourcePath(), { method: "PATCH", headers: headers(user), body: JSON.stringify({ revisionId, avatarKey: "robot", expectedVersion: version }) });
  expect((await fetch(sourcePath())).status).toBe(401);
  expect((await fetch(sourcePath(), { headers: headers("another-actor") })).status).toBe(404);
  expect((await fetch(sourcePath(), { headers: headers(USER, OTHER) })).status).toBe(404);
  expect((await fetch(sourcePath("virtual-unsaved"), { headers: headers() })).status).toBe(404);
  expect((await fetch(sourcePath(expertId, "old-revision"), { headers: headers() })).status).toBe(409);
  expect((await fetch(sourcePath(), { headers: headers() })).status).toBe(200);
  expect((await save()).status).toBe(200);
  expect(await (await fetch(sourcePath(), { headers: headers() })).json()).toEqual({ expertId, avatarKey: "robot", version: 1 });
  expect((await save()).status).toBe(409);
  await append(sourceMarkdown.replace("教师", "改名教师"), 1);
  expect(await (await fetch(sourcePath(), { headers: headers() })).json()).toEqual({ expertId, avatarKey: "robot", version: 1 });
  const facts = await db.withTenant(toOrgId(ORG), async (s) => ({
    agents: (await s.query("SELECT id FROM agents WHERE org_id=$1 AND id=$2", [ORG, expertId])).rows,
    version: (await s.query<{ version: string }>("SELECT version FROM interview_sessions WHERE org_id=$1 AND id=$2", [ORG, interviewId])).rows[0]?.version,
    original: (await s.query<{ markdown: string }>("SELECT markdown FROM digital_interview_artifact_versions WHERE org_id=$1 AND interview_id=$2 AND step='experts' AND version_number=1", [ORG, interviewId])).rows[0]?.markdown,
  }));
  expect(facts).toEqual({ agents: [], version: "1", original: sourceMarkdown });
  await db.withTenant(toOrgId(ORG), (s) => s.query("INSERT INTO interview_collaborators(org_id,interview_id,user_id,added_by) VALUES($1,$2,'another-actor',$3)", [ORG, interviewId, USER]));
  expect(await (await fetch(sourcePath(), { headers: headers("another-actor") })).json()).toEqual({ expertId, avatarKey: null, version: 0 });
  expect((await save("another-actor")).status).toBe(200);
  const adminFixture = new PgDatabase(migrationConfig());
  try {
    await adminFixture.withTenant(toOrgId(ORG), (s) => s.query("DELETE FROM interview_collaborators WHERE org_id=$1 AND interview_id=$2 AND user_id='another-actor'", [ORG, interviewId]));
  } finally { await adminFixture.close(); }
  expect((await fetch(sourcePath(), { headers: headers("another-actor") })).status).toBe(404);
  expect((await save("another-actor", 1)).status).toBe(404);
  await append("# 专家\n\n## [其他专家](#expert-virtual-other)\n\n当前画像。", 2);
  expect((await fetch(sourcePath(), { headers: headers() })).status).toBe(404);
  expect((await save(USER, 1)).status).toBe(404);
});
