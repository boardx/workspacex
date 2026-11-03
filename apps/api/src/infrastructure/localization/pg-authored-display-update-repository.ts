import { guard, discloseDecided, isDisclosed } from "../../application/security/permission-filter";
import { createHash } from "node:crypto";
import { DisplayUpdateResult } from "@repo/contracts/portable-package";
import type { EntityKind } from "@repo/contracts/entity-localization";
import type { DatabasePort, TenantSession } from "../../application/ports/database.port";
import type { AuthoredDisplayUpdateRepository, UpdateResult } from "../../application/localization/authored-display-update";
import type { AuthorizedLocalizationRequest } from "../../application/localization/entity-localization";
import type { OrgId } from "../../domain/org-id";
import { AUTHORED_DISPLAY_METADATA, DISPLAY_METADATA_VERSION, DISPLAY_METADATA_DIGEST, authoredTranslations } from "../../domain/localization/authored-display-metadata";
import { officialRoleDisplayIdentities } from "../../domain/agent/official-role-packs";
import { localizationSources, LOCALIZATION_TABLES, type SourceCandidate } from "./pg-entity-localization-repository";
import { writeImportedTranslations } from "./pg-imported-translations";
type Scope = { orgId: OrgId; authorize: AuthorizedLocalizationRequest["authorize"] };
type Target = SourceCandidate & { stableKey: string };
type Receipt = { kind: EntityKind; entity_id: string; source_revision: string; metadata_digest: string };
const key = (source: SourceCandidate["source"]) => JSON.stringify([source.kind,source.entityId,source.revision]);
class MetadataConflict extends Error {}

async function targets(s: TenantSession, input: Scope, lock: boolean): Promise<Target[]> {
  const roles = officialRoleDisplayIdentities();
  const selected = await s.query<{ kind: EntityKind; id: string; stable_key: string }>(
    `SELECT 'skill'::text AS kind,sk.id,v.manifest->'work'->>'stableId' AS stable_key
      FROM skills sk JOIN LATERAL (SELECT manifest FROM skill_versions WHERE org_id=sk.org_id AND skill_id=sk.id AND published
        ORDER BY created_at DESC,id DESC LIMIT 1) v ON true
      JOIN skill_catalog_entries c ON c.org_id=sk.org_id AND c.skill_id=sk.id AND c.stable_id=v.manifest->'work'->>'stableId'
      WHERE sk.org_id=$1 AND c.stable_id=ANY($2::text[])
     UNION ALL SELECT 'agent',id,stable_name FROM agents
      WHERE org_id=$1 AND catalog_source='official' AND stable_name=ANY($3::text[]) ORDER BY kind,id`,
    [input.orgId,Object.keys(AUTHORED_DISPLAY_METADATA.skills),Object.keys(roles)]);
  const result: Target[] = [];
  for (const row of selected.rows) {
    let candidate = (await localizationSources(s,input.orgId,row.kind,[row.id]))[0];
    if (!candidate || !candidate.source.versionId || !isDisclosed(discloseDecided(guard({ kind: "capability",id: candidate.source.entityId },candidate),input.authorize(candidate.facts)))) continue;
    if (lock) {
      await s.query(`SELECT id FROM ${LOCALIZATION_TABLES[row.kind].parent} WHERE org_id=$1 AND id=$2 FOR UPDATE`,[input.orgId,row.id]);
      candidate = (await localizationSources(s,input.orgId,row.kind,[row.id]))[0];
      if (!candidate || !candidate.source.versionId || !isDisclosed(discloseDecided(guard({ kind: "capability",id: candidate.source.entityId },candidate),input.authorize(candidate.facts)))) continue;
    }
    // Revalidate the identity against the captured immutable version, rather than
    // trusting a listing projection or a pre-lock source snapshot.
    if (row.kind === "skill") {
      const current = (await s.query<{ stable_key: string }>(
        "SELECT manifest->'work'->>'stableId' AS stable_key FROM skill_versions WHERE org_id=$1 AND skill_id=$2 AND id=$3 AND published",
        [input.orgId,row.id,candidate.source.versionId])).rows[0];
      if (current?.stable_key !== row.stable_key) continue;
    } else {
      const current = (await s.query<{ stable_name: string; catalog_source: string }>(
        "SELECT stable_name,catalog_source FROM agents WHERE org_id=$1 AND id=$2",[input.orgId,row.id])).rows[0];
      if (current?.catalog_source !== "official" || current.stable_name !== row.stable_key) continue;
    }
    result.push({ ...candidate, stableKey: row.kind === "skill" ? row.stable_key : roles[row.stable_key]! });
  }
  return result;
}
async function receipts(s: TenantSession, orgId: string) {
  const rows = await s.query<Receipt>("SELECT kind,entity_id,source_revision,metadata_digest FROM entity_display_metadata_receipts WHERE org_id=$1 AND metadata_version=$2",[orgId,DISPLAY_METADATA_VERSION]);
  return new Map(rows.rows.map(row => [JSON.stringify([row.kind,row.entity_id,row.source_revision]),row.metadata_digest]));
}

/** Metadata-only authoring: never call a package upgrader, publisher, permission
 * writer or dependency resolver. Per-source receipts keep team scopes independent. */
export class PgAuthoredDisplayUpdateRepository implements AuthoredDisplayUpdateRepository {
  constructor(private readonly db: DatabasePort) {}
  offer(input: Scope) {
    return this.db.withTenant(input.orgId,async s => {
      const visible = await targets(s,input,false), applied = await receipts(s,input.orgId);
      return { metadataVersion: DISPLAY_METADATA_VERSION, installedCount: visible.length,
        available: visible.some(target => authoredTranslations(target.source.kind,target.stableKey,target.source.fields) !== null && applied.get(key(target.source)) !== DISPLAY_METADATA_DIGEST) };
    });
  }
  async apply(input: Parameters<AuthoredDisplayUpdateRepository["apply"]>[0]): Promise<UpdateResult | null> {
    if (input.expectedMetadataVersion !== DISPLAY_METADATA_VERSION || input.expectedOrgId !== input.orgId) return null;
    const authorization = input.authorize({ scope: "org-wide",ownerTeamId: null }).orgLayer;
    const payload = createHash("sha256").update(JSON.stringify({ orgId: input.orgId,actorId: input.actorId,authorization,metadataVersion: DISPLAY_METADATA_VERSION,metadataDigest: DISPLAY_METADATA_DIGEST })).digest("hex");
    try {
      return await this.db.withTenant(input.orgId,async s => {
        await s.query("SELECT pg_advisory_xact_lock(hashtextextended($1,6156))",[input.orgId]);
        const prior = (await s.query<{ payload_digest: string; result_json: unknown }>(
          "SELECT payload_digest,result_json FROM entity_display_update_requests WHERE org_id=$1 AND idempotency_key=$2",[input.orgId,input.idempotencyKey])).rows[0];
        if (prior) {
          if (prior.payload_digest !== payload) throw new MetadataConflict();
          return { ...DisplayUpdateResult.parse(prior.result_json), replayed: true };
        }
        const visible = await targets(s,input,true), applied = await receipts(s,input.orgId);
        // Version reuse is an invalid release, never a reason to rewrite previously
        // reviewed copy under the same metadata version.
        if (visible.some(target => applied.has(key(target.source)) && applied.get(key(target.source)) !== DISPLAY_METADATA_DIGEST)) throw new MetadataConflict();
        let updatedEntities = 0, skippedEntities = 0;
        for (const target of visible) {
          const translations = authoredTranslations(target.source.kind,target.stableKey,target.source.fields);
          if (!translations) { skippedEntities++; continue; }
          const changed = await writeImportedTranslations(s,target.source,translations,input.actorId,true);
          if (changed) updatedEntities++; else skippedEntities++;
          await s.query(`INSERT INTO entity_display_metadata_receipts(org_id,kind,entity_id,source_revision,metadata_version,metadata_digest,updated_by)
            VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING`,
          [input.orgId,target.source.kind,target.source.entityId,target.source.revision,DISPLAY_METADATA_VERSION,DISPLAY_METADATA_DIGEST,input.actorId]);
        }
        const result: UpdateResult = { metadataVersion: DISPLAY_METADATA_VERSION,updatedEntities,skippedEntities,appliedAt: new Date().toISOString(),replayed: false };
        await s.query("INSERT INTO entity_display_update_requests(org_id,idempotency_key,payload_digest,actor_id,result_json) VALUES($1,$2,$3,$4,$5::jsonb)",
          [input.orgId,input.idempotencyKey,payload,input.actorId,JSON.stringify(result)]);
        return result;
      });
    } catch (error) { if (error instanceof MetadataConflict) return null; throw error; }
  }
}
