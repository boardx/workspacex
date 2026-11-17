import { createHash, randomUUID } from "node:crypto";
import type { SaveStageInput } from "@repo/contracts/aidt-stages";
import { AidtStagesService } from "../../../src/application/aidt-stages/service";
import { importSkillStarterPack } from "../../../src/application/skill-import/import-skill-starter-pack";
import type { PublishedAgentSnapshot } from "../../../src/application/chat/message-command-ports";
import { toOrgId } from "../../../src/domain/org-id";
import { PgAidtStageRepository } from "../../../src/infrastructure/aidt-stages/pg-aidt-stage-repository";
import type { PgDatabase } from "../../../src/infrastructure/db/pg-database";
import { PgIdentityRepository } from "../../../src/infrastructure/identity/pg-identity-repository";
import { FileSkillStarterPackSource, REPO_SKILL_STARTER_PACK_ROOT } from "../../../src/infrastructure/skill/file-skill-starter-pack-source";
import { PgSkillStarterImportRepository } from "../../../src/infrastructure/skill/pg-skill-starter-import-repository";
import { addChatThread } from "../../support/chat-db";
import { addOrgMember, asApp, resetOrgs, seedOrg } from "../../support/db";

/** Real tenant rows and real stage usecase. No provider, HTTP interception or shared grants. */
export async function createBridgePgFixture(db: PgDatabase) {
  const prefix = `aidt-context-pg-${randomUUID()}`;
  const orgId = toOrgId(`${prefix}-org`), otherOrgId = toOrgId(`${prefix}-other-org`);
  const projectId = `${prefix}-project`, privateProjectId = `${prefix}-private`, otherProjectId = `${prefix}-other-project`;
  const ownerId = `${prefix}-owner`, studentId = `${prefix}-student`, outsiderId = `${prefix}-outsider`, importerId = `${prefix}-import-admin`;
  const threadId = `${prefix}-thread`, summaryThreadId = `${prefix}-summary-thread`;
  await seedOrg({ orgId, projectId, projectKind: "general", groupNames: [] });
  await seedOrg({ orgId: otherOrgId, projectId: otherProjectId, projectKind: "general", groupNames: [] });
  for (const userId of [ownerId, studentId, outsiderId]) await addOrgMember(orgId, userId, "consultant", null);
  await addOrgMember(orgId, importerId, "admin", null);
  await addOrgMember(otherOrgId, outsiderId, "consultant", null);
  await asApp(orgId, async session => {
    await session.query("INSERT INTO projects(id,org_id,name,kind) VALUES($1,$2,$3,'general')", [privateProjectId, orgId, "Synthetic private group"]);
    await session.query("INSERT INTO general_projects(id,org_id) VALUES($1,$2)", [privateProjectId, orgId]);
    for (const id of [projectId, privateProjectId]) await session.query("INSERT INTO project_tags(org_id,project_id,tag) VALUES($1,$2,'workspacex:aidt')", [orgId, id]);
    for (const [id, userId, role] of [[projectId, ownerId, "owner"], [projectId, studentId, "collaborator"], [privateProjectId, outsiderId, "owner"]]) {
      await session.query("INSERT INTO general_project_members(org_id,project_id,user_id,role) VALUES($1,$2,$3,$4)", [orgId, id, userId, role]);
    }
  });
  await asApp(otherOrgId, async session => {
    await session.query("INSERT INTO project_tags(org_id,project_id,tag) VALUES($1,$2,'workspacex:aidt')", [otherOrgId, otherProjectId]);
    await session.query("INSERT INTO general_project_members(org_id,project_id,user_id,role) VALUES($1,$2,$3,'owner')", [otherOrgId, otherProjectId, outsiderId]);
  });
  for (const id of [threadId, summaryThreadId]) await addChatThread({ orgId, id, projectId, visibilityScope: "plenary", createdBy: studentId });
  const stages = new AidtStagesService(new PgAidtStageRepository(db), () => true);
  const actor = { orgId, projectId, userId: studentId, threadId };
  const owner = { orgId, projectId, userId: ownerId, threadId };
  const markers = { s1: `DB_A_S1_V1_${prefix}`, s2: `DB_A_S2_V1_${prefix}`, next: `DB_A_NEW_HEAD_${prefix}`, private: `DB_B_PRIVATE_${prefix}`, forged: `FORGED_CLIENT_ONLY_${prefix}` };
  async function save(stageId: number, fields: Record<string, string>, sourceStageRevisions: SaveStageInput["sourceStageRevisions"] = []) {
    const { stage } = await stages.get(actor, stageId);
    return (await stages.save(actor, { projectId, stageId, operationId: randomUUID(), expectedRevision: stage?.revision ?? 0,
      content: { schemaVersion: 1, draft: { fields, ideas: [], selectedIdeaId: "" } }, sourceStageRevisions })).stage;
  }
  const s1 = await save(1, { initial: markers.s1, initialSource: "guess", initialBasis: "Synthetic classroom guess, not research." });
  const s2 = await save(2, { guide: markers.s2 }, [{ stageId: 1, revision: s1.revision }]);
  const privateActor = { orgId, projectId: privateProjectId, userId: outsiderId };
  await stages.save(privateActor, { projectId: privateProjectId, stageId: 1, operationId: randomUUID(), expectedRevision: 0,
    content: { schemaVersion: 1, draft: { fields: { initial: markers.private }, ideas: [], selectedIdeaId: "" } }, sourceStageRevisions: [] });
  async function mountApprovedSkill(packId: string, packVersion: string, stableName: string, targetThreadId = threadId) {
    const outcome = await importSkillStarterPack({ identities: new PgIdentityRepository(db), packs: new FileSkillStarterPackSource(REPO_SKILL_STARTER_PACK_ROOT), imports: new PgSkillStarterImportRepository(db) },
      { actorId: importerId, orgId, packId, packVersion, idempotencyKey: `${prefix}-import-${packId}-${packVersion}` });
    const mounted = await asApp(orgId, async session => {
      const result = await session.query<{ skill_id: string; version_id: string; content_digest: string }>("SELECT s.id AS skill_id,v.id AS version_id,v.content_digest FROM skills s JOIN skill_versions v ON v.org_id=s.org_id AND v.skill_id=s.id WHERE s.org_id=$1 AND s.stable_name=$2 AND v.published ORDER BY v.created_at DESC,v.id DESC LIMIT 1", [orgId, stableName]);
      const row = result.rows[0];
      if (!row || !outcome.result.skillIds.includes(row.skill_id)) throw new Error("APPROVED_FIXTURE_SKILL_NOT_IMPORTED");
      const mountId = `${prefix}-mount-${randomUUID()}`;
      await session.query("INSERT INTO thread_skill_mounts(mount_id,org_id,thread_id,skill_id,version_id,mounted_at) VALUES($1,$2,$3,$4,$5,now())", [mountId, orgId, targetThreadId, row.skill_id, row.version_id]);
      return { skillId: row.skill_id, versionId: row.version_id, contentDigest: row.content_digest, mountId };
    });
    return { ...mounted, importedPackId: packId, importedPackVersion: packVersion, ownTenantImport: true as const, platformLineageClaimed: false as const };
  }
  let generalAgentId: string | undefined, agentVersionNumber = 0;
  async function publishAgent(skillVersionIds: readonly string[]): Promise<PublishedAgentSnapshot> {
    const existing = generalAgentId;
    const agentId = existing ?? `${prefix}-agent-${randomUUID()}`, agentVersionId = `${prefix}-agent-version-${randomUUID()}`;
    const semanticLabel = `1.0.${++agentVersionNumber}`;
    const instructions = "Synthetic no-supplier integration agent. Student decisions remain unverified; never invent research.";
    await asApp(orgId, async session => {
      if (!existing) await session.query("INSERT INTO agents(id,org_id,stable_name,name,status,creator_id,created_at,updated_at) VALUES($1,$2,'general','Synthetic general context integration','enabled',$3,now(),now())", [agentId, orgId, ownerId]);
      await session.query("INSERT INTO agent_versions(id,org_id,agent_id,semantic_label,instruction_digest,instructions,skill_version_ids,model_provider,model_id,tool_policy,creator_id,created_at,published_at) VALUES($1,$2,$3,$8,$4,$5,$6::text[],'deep-agent','synthetic-recording-only','[]'::jsonb,$7,now(),now())", [agentVersionId, orgId, agentId, createHash("sha256").update(instructions).digest("hex"), instructions, skillVersionIds, ownerId, semanticLabel]);
      await session.query("UPDATE agents SET published_version_id=$1 WHERE org_id=$2 AND id=$3", [agentVersionId, orgId, agentId]);
    });
    generalAgentId = agentId;
    return { agentId, agentVersionId, instructions, skillVersionIds, skillScope: "general", modelProvider: "deep-agent", modelId: "synthetic-recording-only" };
  }
  /** Negative fixture only: a familiar stableName must not authenticate different bytes. */
  async function mountUntrustedSkill(stableName: string, targetThreadId = threadId) {
    const skillId = `${prefix}-skill-${randomUUID()}`, versionId = `${prefix}-version-${randomUUID()}`, mountId = `${prefix}-mount-${randomUUID()}`;
    const markdown = `# ${stableName}\nSynthetic integration pin; no classroom or provider execution.`;
    const digest = createHash("sha256").update(markdown).digest("hex");
    await asApp(orgId, async session => {
      await session.query("INSERT INTO skills(id,org_id,stable_name,name,status,creator_id,created_at,updated_at) VALUES($1,$2,$3,$3,'enabled',$4,now(),now())", [skillId, orgId, stableName, ownerId]);
      await session.query("INSERT INTO skill_versions(id,org_id,skill_id,semantic_label,content_digest,manifest,creator_id,created_at,published) VALUES($1,$2,$3,'1.0.0',$4,'{}'::jsonb,$5,now(),false)", [versionId, orgId, skillId, digest, ownerId]);
      await session.query("INSERT INTO skill_version_files(org_id,version_id,path,content,media_type,digest) VALUES($1,$2,'SKILL.md',$3::bytea,'text/markdown',$4)", [orgId, versionId, Buffer.from(markdown), digest]);
      await session.query("SELECT wave2_publish_skill_version($1,$2)", [orgId, versionId]);
      await session.query("INSERT INTO thread_skill_mounts(mount_id,org_id,thread_id,skill_id,version_id,mounted_at) VALUES($1,$2,$3,$4,$5,now())", [mountId, orgId, targetThreadId, skillId, versionId]);
    });
    return { skillId, versionId, mountId };
  }
  return { prefix, orgId, otherOrgId, projectId, privateProjectId, otherProjectId, ownerId, studentId, outsiderId, importerId, threadId, summaryThreadId,
    actor, owner, markers, stages, s1, s2, save, mountApprovedSkill, mountUntrustedSkill, publishAgent, cleanup: () => resetOrgs(orgId, otherOrgId) };
}
