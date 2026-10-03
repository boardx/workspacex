import { createHash, randomUUID } from "node:crypto";
import type { DatabasePort, TenantSession } from "../../application/ports/database.port";
import { OfficialRoleUpgradeConflictError, type OfficialRoleUpgradeRepository } from "../../application/agent-import/upgrade-official-roles";
import { historicalOfficialRoleInstructionDigests, OFFICIAL_AGENT_ROLE_PACK_ID } from "../../domain/agent/official-role-packs";
import type { OfficialAgentStarterPack } from "../../domain/agent/starter-pack";
import { resolveOfficialRoleSkillRefs, type ResolvedOfficialRoleSkills } from "./resolve-official-role-skill-refs";
import { AGENT_ROLE_COLUMN_OF, insertAgentVersionFromDraft } from "./agent-version-insert";

const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");
/** Immutable binding revisions keep the signed pack version and a deterministic unique label. */
export const officialRoleBindingLabel = (version: string, pins: readonly string[]) =>
  `${version}+bindings.${sha256(JSON.stringify([...pins].sort()))}`;
const ROLE_FIELDS = Object.values(AGENT_ROLE_COLUMN_OF);
interface RoleRow { id: string; stable_name: string; name: string; published_version_id: string; semantic_label: string; instruction_digest: string; instructions: string; model_provider: string; model_id: string; skill_version_ids: string[]; draft: Record<string, unknown>; published: Record<string, unknown>; }
interface Ledger { pack_version: string; pack_digest: string; result_json: { agentIds: string[]; versionIds: string[] }; }
function normalized(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(normalized).join(",")}]`;
  if (typeof value === "object" && value !== null) return JSON.stringify(Object.fromEntries(Object.entries(value).sort(([a],[b]) => a.localeCompare(b)).map(([k,v])=>[k,normalized(v)])));
  return JSON.stringify(value) ?? "undefined";
}
async function eligible(session: TenantSession, orgId: string, pack: OfficialAgentStarterPack, refs: ReadonlyMap<string, ResolvedOfficialRoleSkills>) {
  const roles = await session.query<RoleRow>(`SELECT a.id,a.stable_name,a.name,a.published_version_id,v.semantic_label,v.instruction_digest,v.instructions,
    v.model_provider,v.model_id,v.skill_version_ids,to_jsonb(a) AS draft,to_jsonb(v) AS published
    FROM agents a JOIN agent_versions v ON v.org_id=a.org_id AND v.agent_id=a.id AND v.id=a.published_version_id
    WHERE a.org_id=$1 AND a.catalog_source='official' AND v.catalog_source='official'`, [orgId]);
  const imports = await session.query<Ledger>(`SELECT pack_version,pack_digest,result_json FROM agent_starter_pack_imports
    WHERE org_id=$1 AND pack_id=$2 AND status='succeeded'`, [orgId, OFFICIAL_AGENT_ROLE_PACK_ID]);
  return roles.rows.filter((row) => {
    const target = pack.agents.find((a) => a.stableName === row.stable_name);
    if (!target || row.instruction_digest !== sha256(row.instructions)) return false;
    const sourceVersion = row.semantic_label.split("+")[0]!;
    if (row.semantic_label !== sourceVersion && row.semantic_label !== officialRoleBindingLabel(sourceVersion, row.skill_version_ids)) return false;
    const refreshBindings = sourceVersion === target.semanticVersion;
    const resolvedPins = refs.get(row.stable_name)?.pins ?? [];
    // Same-version refresh is additive only, after exact authored Skills become verified.
    // Existing/custom pins cannot be silently replaced or removed.
    if (refreshBindings && (row.instruction_digest !== target.instructionDigest
      || resolvedPins.length <= row.skill_version_ids.length
      || row.skill_version_ids.some((id) => !resolvedPins.includes(id)))) return false;
    // A name or draft edit is an organization customization; never overwrite it.
    if (row.name !== target.name || row.draft.role_label !== target.roleLabel) return false;
    if (ROLE_FIELDS.some((field) => normalized(row.draft[field]) !== normalized(row.published[field]))) return false;
    // An official-looking custom import with the old text is still not an untouched official role.
    if (Object.entries(AGENT_ROLE_COLUMN_OF).some(([key,column]) => normalized(row.published[column]) !== normalized(key === "catalogSource" ? "official" : target.role[key as keyof typeof target.role]))) return false;
    if (row.model_provider !== target.modelProvider || row.model_id !== target.modelId || (!refreshBindings && row.skill_version_ids.length !== 0) || normalized(row.published.tool_policy) !== normalized(target.toolPolicy)) return false;
    return imports.rows.some((ledger) => {
      const index = ledger.result_json.agentIds.indexOf(row.id);
      return index >= 0 && ledger.result_json.versionIds[index] === row.published_version_id
        && ledger.pack_version === sourceVersion
        && (refreshBindings
          ? ledger.pack_digest === pack.packDigest && row.instruction_digest === target.instructionDigest
          : historicalOfficialRoleInstructionDigests(ledger.pack_version)[row.stable_name] === row.instruction_digest);
    });
  });
}

export class PgOfficialRoleUpgradeRepository implements OfficialRoleUpgradeRepository {
  constructor(private readonly db: DatabasePort) {}
  offers(orgId: Parameters<OfficialRoleUpgradeRepository["offers"]>[0], pack: OfficialAgentStarterPack) {
    return this.db.withTenant(orgId, async (session) => {
      const refs = await resolveOfficialRoleSkillRefs(session,orgId,pack);
      const candidates = await eligible(session, orgId, pack, refs);
      return candidates.map((r) => ({ agentId:r.id, expectedPublishedVersionId:r.published_version_id, name:r.name,
        currentVersion:r.semantic_label.split("+")[0]!,targetVersion:pack.packVersion, readySkillCount:refs.get(r.stable_name)?.pins.length ?? 0,
        pendingSkillCount:refs.get(r.stable_name)?.pending.length ?? 0 }));
    });
  }
  upgrade(input: Parameters<OfficialRoleUpgradeRepository["upgrade"]>[0]) {
    return this.db.withTenant(input.orgId, async (session) => {
      await session.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 418))", [input.orgId]);
      const selections = [...input.selections].sort((a,b) => a.agentId.localeCompare(b.agentId));
      const payloadDigest = sha256(JSON.stringify({ action: "official-role-upgrade", orgId: input.orgId, packVersion: input.pack.packVersion, packDigest: input.pack.packDigest, selections }));
      const prior = await session.query<{ payload_digest: string; result_json: { agentIds: string[]; versionIds: string[]; importedAt: string } | null; status: string }>(
        "SELECT payload_digest,result_json,status FROM agent_starter_pack_imports WHERE org_id=$1 AND idempotency_key=$2", [input.orgId,input.idempotencyKey]);
      const row = prior.rows[0];
      if (row) {
        if (row.payload_digest !== payloadDigest || row.status !== "succeeded" || !row.result_json) throw new OfficialRoleUpgradeConflictError();
        return { packVersion: input.pack.packVersion, agentIds: row.result_json.agentIds, versionIds: row.result_json.versionIds, upgradedAt: row.result_json.importedAt };
      }
      // Lock selected agents too: admin draft edits and publish operations must not race the check.
      await session.query("SELECT id FROM agents WHERE org_id=$1 AND id=ANY($2::text[]) FOR UPDATE", [input.orgId,selections.map((s)=>s.agentId)]);
      const skills = await resolveOfficialRoleSkillRefs(session,input.orgId,input.pack);
      const candidates = await eligible(session,input.orgId,input.pack,skills);
      const selected = selections.map((s) => candidates.find((c) => c.id===s.agentId && c.published_version_id===s.expectedPublishedVersionId));
      if (selected.some((s)=>!s)) throw new OfficialRoleUpgradeConflictError();
      const selectedPack = { ...input.pack, agents: input.pack.agents.filter((a)=>selected.some((r)=>r?.stable_name===a.stableName)) };
      const importedAt = new Date().toISOString(); const importId = `agent-import-${randomUUID()}`;
      const agentIds: string[] = []; const versionIds: string[] = [];
      for (const current of selected) {
        if (!current) throw new OfficialRoleUpgradeConflictError();
        const target = selectedPack.agents.find((a)=>a.stableName===current.stable_name)!;
        const versionId = `agent-version-${randomUUID()}`;
        // Deliberately retain draft role/name/status and frozen role fields from the old published version.
        await insertAgentVersionFromDraft(session,{ versionId,orgId:input.orgId,agentId:current.id,semanticLabel:current.semantic_label.split("+")[0] === target.semanticVersion
          ? officialRoleBindingLabel(target.semanticVersion, skills.get(target.stableName)?.pins ?? []) : target.semanticVersion,
          instructionDigest:target.instructionDigest,instructions:target.instructions,skillVersionIds:skills.get(target.stableName)?.pins ?? [], pendingSkillBindings:skills.get(target.stableName)?.pending ?? [],
          modelProvider:target.modelProvider,modelId:target.modelId,toolPolicy:target.toolPolicy,creatorId:input.actorId,at:importedAt,roleFromVersionId:current.published_version_id });
        await session.query("UPDATE agents SET published_version_id=$3,updated_at=$4 WHERE org_id=$1 AND id=$2 AND published_version_id=$5", [input.orgId,current.id,versionId,importedAt,current.published_version_id]);
        agentIds.push(current.id);versionIds.push(versionId);
      }
      const result = { importId,packId:input.pack.packId,packVersion:input.pack.packVersion,packDigest:input.pack.packDigest,status:"succeeded",agentIds,versionIds,importedAt };
      await session.query(`INSERT INTO agent_starter_pack_imports(id,org_id,pack_id,pack_version,pack_digest,payload_digest,idempotency_key,administrator_id,imported_at,status,result_json,failure_code)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'succeeded',$10::jsonb,NULL)`,[importId,input.orgId,input.pack.packId,input.pack.packVersion,input.pack.packDigest,payloadDigest,input.idempotencyKey,input.actorId,importedAt,JSON.stringify(result)]);
      return { packVersion:input.pack.packVersion,agentIds,versionIds,upgradedAt:importedAt };
    });
  }
}
