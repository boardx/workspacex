import { guard, discloseDecided, isDisclosed } from "../../application/security/permission-filter";
import { wave2Runtime } from "@repo/contracts";
import type { PersistVerifiedImportOutcome, SkillStarterImportResult } from "../../application/skill-import/ports";
import type { PersistVerifiedAgentImportOutcome, PersistVerifiedOfficialAgentRolePackOutcome, AgentStarterImportResult } from "../../application/agent-import/ports";
import { writeImportedTranslations } from "./pg-imported-translations";
import { PackLocalization } from "@repo/contracts/pack-localization";
import { randomUUID } from "node:crypto";
import type { DatabasePort, TenantSession } from "../../application/ports/database.port";
import type { AuthorizedLocalizationRequest } from "../../application/localization/entity-localization";
import type { OrgId } from "../../domain/org-id";
import { canonicalJson, legacyEquivalentDigest, sourceDefinitionDigest, starterAgentDisplayDefaults, type PortablePack } from "../../domain/localization/portable-pack";
import { skillExecutionRepresentation, skillContentDigest, type SkillStarterPack } from "../../domain/skill/starter-pack";
import { AGENT_ROLE_COLUMN_OF } from "../agent/agent-version-insert";
import { localizationSources, LOCALIZATION_TABLES } from "./pg-entity-localization-repository";

type Result = SkillStarterImportResult | AgentStarterImportResult;
type Outcome = PersistVerifiedImportOutcome | PersistVerifiedAgentImportOutcome | PersistVerifiedOfficialAgentRolePackOutcome;
function idsOf(result: Result, kind: Input["kind"]) {
  return kind === "skill" ? ("skillIds" in result ? result.skillIds : []) : ("agentIds" in result ? result.agentIds : []);
}
type Input = PortablePack & {
  orgId: OrgId; actorId: string; idempotencyKey: string; payloadDigest: string;
  localizationAuthorize?: AuthorizedLocalizationRequest["authorize"];
};
interface Ledger {
  pack_digest: string; pack_version: string; source_definition_digest: string | null;
  result_json: Result;
}
class PortableConflict extends Error {}
function requireMatch(value: unknown): asserts value { if (!value) throw new PortableConflict(); }

/** Before the existing version inserter freezes the parent, restore the portable
 * ordinary Agent's authored role snapshot. Catalog provenance remains org-owned. */
export async function initializePortableAgentDraft(s: TenantSession, orgId: string, agentId: string,
  entry: Parameters<typeof starterAgentDisplayDefaults>[0]) {
  const defaults = starterAgentDisplayDefaults(entry);
  const values: unknown[] = [orgId, agentId, defaults.roleLabel];
  const assignments = ["role_label=$3"];
  for (const [field, column] of Object.entries(AGENT_ROLE_COLUMN_OF)) {
    if (field === "catalogSource") continue;
    const value = defaults.role[field as keyof typeof defaults.role];
    values.push(["avatar", "delegationPolicy", "escalationPolicy", "kpi"].includes(field) && value !== null ? JSON.stringify(value) : value);
    assignments.push(`${column}=$${values.length}`);
  }
  await s.query(`UPDATE agents SET ${assignments.join(",")} WHERE org_id=$1 AND id=$2`, values);
}

/** Refresh only a proven, unchanged published definition. Never invoke an upgrade,
 * re-enable a capability, rebind a floating dependency or replace a manual original. */
async function currentIds(s: TenantSession, input: Input, prior: Ledger): Promise<string[]> {
  const priorIds = idsOf(prior.result_json,input.kind);
  const entries = input.kind === "skill" ? input.pack.skills : input.pack.agents;
  requireMatch(priorIds?.length === entries.length && prior.result_json.versionIds.length === entries.length);
  const ids: string[] = [];
  for (const entry of entries) {
    if (input.kind === "skill" && "files" in entry) {
      const rows = await s.query<{ id: string; name: string; version_id: string; content_digest: string; duty: string | null }>(
        `SELECT sk.id,sk.name,v.id AS version_id,v.content_digest,c.duty FROM skills sk
         JOIN LATERAL (SELECT id,content_digest FROM skill_versions WHERE org_id=sk.org_id AND skill_id=sk.id AND published
           ORDER BY created_at DESC,id DESC LIMIT 1) v ON true
         JOIN capability_listings c ON c.org_id=sk.org_id AND c.id=sk.id
         WHERE sk.org_id=$1 AND sk.stable_name=$2 AND sk.id=ANY($3::text[]) FOR UPDATE OF sk`,
        [input.orgId, entry.stableName, priorIds]);
      const row = rows.rows[0];
      requireMatch(row && row.name === entry.name && row.content_digest === skillContentDigest(entry)
        && prior.result_json.versionIds.includes(row.version_id)
        && row.duty === ("duty" in entry ? entry.duty ?? null : null));
      ids.push(row.id);
    } else if ("instructions" in entry) {
      const rows = await s.query<Record<string, unknown> & { id: string; version_id: string }>(
        `SELECT a.id,a.name,a.role_label,c.duty,v.id AS version_id,v.semantic_label,v.instructions,
         v.instruction_digest,v.model_provider,v.model_id,v.tool_policy,v.skill_version_ids,
         ${Object.values(AGENT_ROLE_COLUMN_OF).map(column => `v.${column}`).join(",")}
         FROM agents a JOIN agent_versions v ON v.org_id=a.org_id AND v.id=a.published_version_id
         JOIN capability_listings c ON c.org_id=a.org_id AND c.id=a.id
         WHERE a.org_id=$1 AND a.stable_name=$2 AND a.id=ANY($3::text[]) FOR UPDATE OF a`,
        [input.orgId, entry.stableName, priorIds]);
      const row = rows.rows[0], defaults = starterAgentDisplayDefaults(entry);
      requireMatch(row && row.name === entry.name && row.role_label === defaults.roleLabel && row.duty === defaults.duty
        && prior.result_json.versionIds.includes(row.version_id) && row.semantic_label === entry.semanticVersion
        && row.instructions === entry.instructions && row.instruction_digest === entry.instructionDigest
        && row.model_provider === entry.modelProvider && row.model_id === entry.modelId
        && canonicalJson(row.tool_policy) === canonicalJson(entry.toolPolicy));
      for (const [field, column] of Object.entries(AGENT_ROLE_COLUMN_OF)) {
        const expected = field === "catalogSource" ? (input.kind === "official-agent" ? "official" : "org") : defaults.role[field as keyof typeof defaults.role];
        requireMatch(canonicalJson(row[column]) === canonicalJson(expected));
      }
      // Official authored floating bindings were resolved when first published. The
      // verified ledger fingerprint proves that authored definition; do not re-resolve.
      if (input.kind === "agent") requireMatch(canonicalJson(row.skill_version_ids) === canonicalJson(entry.skillVersions.map(ref => ref.versionId)));
      ids.push(row.id);
    } else throw new PortableConflict();
  }
  return ids;
}

async function applyMetadata(s: TenantSession, input: Input, ids: readonly string[], createdIds: ReadonlySet<string> | false) {
  requireMatch(input.localizationAuthorize);
  const kind = input.kind === "skill" ? "skill" : "agent";
  const entries = input.kind === "skill" ? input.pack.skills : input.pack.agents;
  const { parent } = LOCALIZATION_TABLES[kind];
  for (const [index, entry] of entries.entries()) {
    requireMatch("localization" in entry);
    const localization = PackLocalization.parse(entry.localization);
    const entityId = ids[index];
    requireMatch(entityId);
    const candidate = (await localizationSources(s, input.orgId, kind, [entityId]))[0];
    requireMatch(candidate);
    const disclosed = discloseDecided(guard({ kind: "capability",id: candidate.source.entityId },candidate),input.localizationAuthorize(candidate.facts));
    requireMatch(isDisclosed(disclosed));
    const authorized = disclosed.payload;
    if (createdIds) {
      // A creator may reuse another local pack's identical Skill. Initialize source
      // locale only for newly created rows; prove the current borrowed definition
      // before attaching copy and preserve its existing language/hand-maintained copy.
      if (createdIds.has(entityId)) {
        await s.query(`UPDATE ${parent} SET source_locale=$3 WHERE org_id=$1 AND id=$2`,
          [input.orgId, entityId, localization.sourceLocale]);
      } else {
        requireMatch(kind === "skill" && "files" in entry);
        const published = (await s.query<{ content_digest: string }>(
          "SELECT content_digest FROM skill_versions WHERE org_id=$1 AND skill_id=$2 AND id=$3 AND published",
          [input.orgId, entityId, authorized.source.versionId])).rows[0];
        requireMatch(published?.content_digest === skillContentDigest(entry) && authorized.source.fields.name === entry.name
          && authorized.source.fields.duty === ("duty" in entry ? entry.duty ?? null : null));
      }
    }
    const source = (await localizationSources(s, input.orgId, kind, [entityId]))[0]!.source;
    await writeImportedTranslations(s, source, localization.translations, input.actorId);
  }
}

/** V2 wraps the existing creator in this same tenant transaction. A conflict throws
 * through withTenant before mapping the outcome, so an imported prefix cannot commit. */
export function persistPortableImport(db: DatabasePort, input: Input & { kind: "skill" }, create: (s: TenantSession, createdIds: Set<string>) => Promise<PersistVerifiedImportOutcome>): Promise<PersistVerifiedImportOutcome>;
export function persistPortableImport(db: DatabasePort, input: Input & { kind: "agent" }, create: (s: TenantSession, createdIds: Set<string>) => Promise<PersistVerifiedAgentImportOutcome>): Promise<PersistVerifiedAgentImportOutcome>;
export function persistPortableImport(db: DatabasePort, input: Input & { kind: "official-agent" }, create: (s: TenantSession, createdIds: Set<string>) => Promise<PersistVerifiedOfficialAgentRolePackOutcome>): Promise<PersistVerifiedOfficialAgentRolePackOutcome>;
export async function persistPortableImport(db: DatabasePort, input: Input, create: (s: TenantSession, createdIds: Set<string>) => Promise<Outcome>): Promise<Outcome> {
  try {
    return await db.withTenant(input.orgId, async s => {
      await s.query("SELECT pg_advisory_xact_lock(hashtextextended($1,6156))", [input.orgId]);
      requireMatch(input.localizationAuthorize);
      const table = input.kind === "skill" ? "starter_pack_imports" : "agent_starter_pack_imports";
      const sameKey = (await s.query<{ id: string; payload_digest: string; status: string }>(`SELECT id,payload_digest,status FROM ${table} WHERE org_id=$1 AND idempotency_key=$2`, [input.orgId, input.idempotencyKey])).rows[0];
      if (sameKey && (sameKey.payload_digest !== input.payloadDigest || sameKey.status !== "failed")) return create(s, new Set());
      const prior = (await s.query<Ledger>(`SELECT pack_digest,pack_version,source_definition_digest,result_json FROM ${table}
        WHERE org_id=$1 AND pack_id=$2 AND status='succeeded' ORDER BY imported_at DESC,id DESC LIMIT 1`, [input.orgId, input.pack.packId])).rows[0];
      const fingerprint = sourceDefinitionDigest(input);
      if (prior) {
        requireMatch(prior.source_definition_digest === fingerprint ||
          (prior.source_definition_digest === null && legacyEquivalentDigest(input, prior.pack_version) === prior.pack_digest));
        const ids = await currentIds(s, input, prior);
        await applyMetadata(s, input, ids, false);
        if (input.kind === "skill") {
          for (const [index,entry] of input.pack.skills.entries()) {
            const version = (await s.query<{ id: string }>(`SELECT id FROM skill_versions
              WHERE org_id=$1 AND skill_id=$2 AND published AND content_digest=$3 AND id=ANY($4::text[])
              ORDER BY created_at DESC,id DESC LIMIT 1`,[input.orgId,ids[index],skillContentDigest(entry),prior.result_json.versionIds])).rows[0];
            requireMatch(version);
            await retainSkillExecutionRepresentation(s,input.orgId,version.id,entry);
          }
        }
        const raw = { ...prior.result_json, importId: sameKey?.id ?? `portable-import-${randomUUID()}`, packVersion: input.pack.packVersion,
          packDigest: input.pack.packDigest, importedAt: new Date().toISOString() };
        const outcome: Outcome = input.kind === "skill"
          ? { kind: "created", result: wave2Runtime.SkillStarterImportResult.parse(raw), metadataOnly: true }
          : { kind: "created", result: wave2Runtime.AgentStarterImportResult.parse(raw), metadataOnly: true };
        const result = outcome.result;
        await s.query(`INSERT INTO ${table}
          (id,org_id,pack_id,pack_version,pack_digest,payload_digest,idempotency_key,administrator_id,imported_at,status,result_json,source_definition_digest,metadata_only)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'succeeded',$10::jsonb,$11,true)
          ON CONFLICT(org_id,idempotency_key) DO UPDATE SET status='succeeded',result_json=EXCLUDED.result_json,
            failure_code=NULL,metadata_only=true,pack_digest=EXCLUDED.pack_digest,pack_version=EXCLUDED.pack_version,
            administrator_id=EXCLUDED.administrator_id,imported_at=EXCLUDED.imported_at,source_definition_digest=EXCLUDED.source_definition_digest`,
        [result.importId,input.orgId,input.pack.packId,input.pack.packVersion,input.pack.packDigest,input.payloadDigest,
          input.idempotencyKey,input.actorId,result.importedAt,JSON.stringify(result),fingerprint]);
        return outcome;
      }
      const createdIds = new Set<string>();
      const outcome = await create(s, createdIds);
      if (outcome.kind === "created" && outcome.result) {
        await applyMetadata(s, input, idsOf(outcome.result,input.kind), createdIds);
        await s.query(`UPDATE ${table} SET source_definition_digest=$3 WHERE org_id=$1 AND id=$2`, [input.orgId, outcome.result.importId, fingerprint]);
      }
      return outcome;
    });
  } catch (error) {
    if (error instanceof PortableConflict) return { kind: "name-conflict" };
    throw error;
  }
}

/** Caller proved this immutable version belongs to the tenant and matches the
 * definition digest. The database trigger independently verifies that proof. */
export async function retainSkillExecutionRepresentation(session: TenantSession, orgId: string,
  versionId: string, skill: SkillStarterPack["skills"][number]) {
  await session.query(`INSERT INTO skill_execution_representations (org_id,version_id,representation)
    VALUES ($1,$2,$3) ON CONFLICT (org_id,version_id) DO NOTHING`,
  [orgId,versionId,skillExecutionRepresentation(skill)]);
}
