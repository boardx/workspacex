/** Storage primitives for explicitly authorized catalog operations. Caller owns authorization and transaction. */
import { createHash, randomUUID } from "node:crypto";
import type { TenantSession } from "../../application/ports/database.port";
import { PLATFORM_ORG_ID } from "../../domain/org-id";

export interface CatalogSkillContent {
  name: string;
  stableName: string;
  description: string;
  content: string;
}
export type { PublishedSkillSnapshot } from "../../application/ai-catalog/storage-port";
import type { PublishedSkillSnapshot } from "../../application/ai-catalog/storage-port";

const digest = (text: string) =>
  createHash("sha256").update(text).digest("hex");

export async function createCatalogSkill(
  s: TenantSession,
  orgId: string,
  actorId: string,
  input: CatalogSkillContent,
) {
  const id = `skill-${randomUUID()}`;
  await s.query(
    `INSERT INTO skills(id,org_id,stable_name,name,status,creator_id,created_at,updated_at)
    VALUES($1,$2,$3,$4,'enabled',$5,now(),now())`,
    [id, orgId, input.stableName, input.name, actorId],
  );
  return appendCatalogSkillDraft(s, orgId, actorId, id, input);
}

export async function appendCatalogSkillDraft(
  s: TenantSession,
  orgId: string,
  actorId: string,
  id: string,
  input: CatalogSkillContent,
) {
  const found = await s.query(
    "SELECT id FROM skills WHERE id=$1 AND org_id=$2 FOR UPDATE",
    [id, orgId],
  );
  if (!found.rows.length) throw new Error("CATALOG_NOT_FOUND");
  const count = await s.query<{ n: string }>(
    "SELECT count(*)::text AS n FROM skill_versions WHERE skill_id=$1 AND org_id=$2",
    [id, orgId],
  );
  const versionId = `skill-version-${randomUUID()}`;
  const semanticLabel = `v${Number(count.rows[0]?.n ?? 0) + 1}`;
  await s.query(
    `INSERT INTO skill_versions(id,org_id,skill_id,semantic_label,content_digest,manifest,creator_id,created_at,published)
    VALUES($1,$2,$3,$4,$5,$6::jsonb,$7,now(),false)`,
    [
      versionId,
      orgId,
      id,
      semanticLabel,
      digest(input.content),
      JSON.stringify({ description: input.description, catalogName:input.name }),
      actorId,
    ],
  );
  await s.query(
    `INSERT INTO skill_version_files(org_id,version_id,path,content,media_type,digest)
    VALUES($1,$2,'SKILL.md',$3,'text/markdown',$4)`,
    [orgId, versionId, Buffer.from(input.content), digest(input.content)],
  );
  return { id, versionId };
}

/** Load only a published, enabled platform original, under its explicit platform transaction. */
export async function readPublishedCatalogSkill(
  s: TenantSession,
  id: string,
  versionId: string,
): Promise<PublishedSkillSnapshot | null> {
  const found = await s.query<{
    id: string;
    name: string;
    stable_name: string;
    semantic_label: string;
    content_digest: string;
    manifest: unknown;
  }>(
    `SELECT sk.id,sk.name,sk.stable_name,v.semantic_label,v.content_digest,v.manifest
    FROM skills sk JOIN skill_versions v ON v.skill_id=sk.id AND v.org_id=sk.org_id
    WHERE sk.org_id=$1 AND sk.id=$2 AND v.id=$3 AND sk.status='enabled' AND v.published`,
    [PLATFORM_ORG_ID, id, versionId],
  );
  const row = found.rows[0];
  if (!row) return null;
  const files = await s.query<{
    path: string;
    content: Buffer;
    media_type: string;
    digest: string;
  }>(
    "SELECT path,content,media_type,digest FROM skill_version_files WHERE org_id=$1 AND version_id=$2 ORDER BY path",
    [PLATFORM_ORG_ID, versionId],
  );
  return {
    id,
    versionId,
    name: typeof (row.manifest as {catalogName?:unknown})?.catalogName === "string" ? (row.manifest as {catalogName:string}).catalogName : row.name,
    stableName: row.stable_name,
    semanticLabel: row.semantic_label,
    digest: row.content_digest,
    manifest: row.manifest,
    files: files.rows.map((f) => ({
      path: f.path,
      content: f.content,
      mediaType: f.media_type,
      digest: f.digest,
    })),
  };
}

/** Caller must verify publication ledger and write enablement ledger in this same target transaction. */
export async function copyPublishedCatalogSkill(
  s: TenantSession,
  orgId: string,
  actorId: string,
  source: PublishedSkillSnapshot,
) {
  let id = `skill-${randomUUID()}`;
  const versionId = `skill-version-${randomUUID()}`;
  const prior=(await s.query<{local_id:string;local_version_id:string}>(`SELECT local_id,local_version_id FROM ai_catalog_enablements WHERE org_id=$1 AND kind='skill' AND origin_id=$2 ORDER BY enabled_at DESC,local_version_id DESC LIMIT 1`,[orgId,source.id])).rows[0];
  if(prior){
    const current=(await s.query<{id:string;status:string}>(`SELECT v.id,sk.status FROM skills sk LEFT JOIN LATERAL (SELECT id FROM skill_versions WHERE org_id=sk.org_id AND skill_id=sk.id ORDER BY created_at DESC,id DESC LIMIT 1) v ON true WHERE sk.org_id=$1 AND sk.id=$2 FOR UPDATE OF sk`,[orgId,prior.local_id])).rows[0];
    if(!current||current.id!==prior.local_version_id||current.status!=='enabled')throw new Error('CATALOG_VERSION_CONFLICT');
    id=prior.local_id;
    await s.query('UPDATE skills SET name=$3,updated_at=now() WHERE org_id=$1 AND id=$2',[orgId,id,source.name]);
  }else{
    const stableName = `public-${createHash("sha256").update(source.id).digest("hex").slice(0,32)}`;
    await s.query(`INSERT INTO skills(id,org_id,stable_name,name,status,creator_id,created_at,updated_at) VALUES($1,$2,$3,$4,'enabled',$5,now(),now())`,[id,orgId,stableName,source.name,actorId]);
  }
  await s.query(
    `INSERT INTO skill_versions(id,org_id,skill_id,semantic_label,content_digest,manifest,creator_id,created_at,published)
    VALUES($1,$2,$3,$4,$5,$6::jsonb,$7,now(),false)`,
    [
      versionId,
      orgId,
      id,
      source.semanticLabel,
      source.digest,
      JSON.stringify(source.manifest),
      actorId,
    ],
  );
  for (const file of source.files)
    await s.query(
      `INSERT INTO skill_version_files(org_id,version_id,path,content,media_type,digest) VALUES($1,$2,$3,$4,$5,$6)`,
      [orgId, versionId, file.path, file.content, file.mediaType, file.digest],
    );
  await s.query("SELECT wave2_publish_skill_version($1,$2)", [
    orgId,
    versionId,
  ]);
  return { id, versionId };
}

export async function publishCatalogSkill(
  s: TenantSession,
  orgId: string,
  id: string,
  versionId: string,
) {
  const found = await s.query(
    "SELECT id FROM skill_versions WHERE org_id=$1 AND skill_id=$2 AND id=$3",
    [orgId, id, versionId],
  );
  if (!found.rows.length) throw new Error("CATALOG_NOT_FOUND");
  await s.query("SELECT wave2_publish_skill_version($1,$2)", [
    orgId,
    versionId,
  ]);
  await s.query("UPDATE skills SET name=COALESCE((SELECT manifest->>'catalogName' FROM skill_versions WHERE id=$3 AND org_id=$1),name),updated_at=now() WHERE org_id=$1 AND id=$2",[orgId,id,versionId]);
}

export async function disableCatalogSkill(
  s: TenantSession,
  orgId: string,
  id: string,
) {
  const found = await s.query(
    "UPDATE skills SET status='disabled',updated_at=now() WHERE org_id=$1 AND id=$2 RETURNING id",
    [orgId, id],
  );
  if (!found.rows.length) throw new Error("CATALOG_NOT_FOUND");
}
