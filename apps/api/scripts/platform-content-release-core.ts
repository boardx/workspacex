/** Deterministic one-shot content release; no API bootstrap, credential or tenant writes. */
import { createHash, randomUUID } from "node:crypto";
import type { DatabasePort, TenantSession } from "../src/application/ports/database.port";
import { PLATFORM_ORG_ID, toOrgId } from "../src/domain/org-id";
import { checkWorkSkillManifests } from "../src/domain/skill/work-skill-import-check";
import { skillContentDigest, importPayloadDigest, verifySkillStarterPack, type SkillStarterPack } from "../src/domain/skill/starter-pack";
import { buildOfficialAgentRolePack, historicalOfficialRoleInstructionDigests } from "../src/domain/agent/official-role-packs";
import { PgSkillStarterImportRepository } from "../src/infrastructure/skill/pg-skill-starter-import-repository";
import { PgOfficialAgentRolePackImportRepository } from "../src/infrastructure/agent/pg-official-agent-role-pack-import-repository";
import { resolveOfficialRoleSkillRefs } from "../src/infrastructure/agent/resolve-official-role-skill-refs";
import { AGENT_ROLE_COLUMN_OF, insertAgentVersionFromDraft } from "../src/infrastructure/agent/agent-version-insert";
import { PgWorkflowDefinitionRepository } from "../src/infrastructure/workflow/pg-workflow-definition-repository";
import { PgSkillCatalogVersionResolver } from "../src/infrastructure/workflow/pg-skill-catalog-version-resolver";
import { WorkflowGraphRegistry } from "../src/infrastructure/workflow/workflow-graph-registry";
import { builtInWorkflowDefinitions, defaultWorkflowGraphs, defaultCommandWorkflowGraphs } from "../src/infrastructure/workflow/create-workflow-runtime";
import { publishBuiltInWorkflowDefinitions } from "../src/application/workflow/publish-built-in-definitions";
import type { WorkflowDefinitionVersionInput } from "@repo/contracts/workflow-runtime";

const ORG = toOrgId(PLATFORM_ORG_ID);
export const ACTOR = "svc-platform-templates";
export class ContentReleaseRejected extends Error { constructor(readonly code: string) { super(code); } }
export function need(ok: unknown, code: string): asserts ok { if (!ok) throw new ContentReleaseRejected(code); }
export const sha = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  return JSON.stringify(value) ?? "null";
}
export interface PackRef { packId: string; packVersion: string; path: string; rawSha256: string; packDigest: string; }
export interface ReleaseRequest {
  schemaVersion: 1; releaseId: string; sourceRevision: string; targetOrgId: "org-platform";
  acceptanceScope: "mvp-non-model"; expectedDatabase: string;
  packRefs: PackRef[]; officialRolePackDigest: string | null;
  workflows: { key: string; version: number; contentDigest: string }[];
  beforeStateSha256: string;
  skippedTests: ["real-model", "ai-output-quality"];
  notApplicableContents: string[];
}
export interface VerifiedInputs {
  request: ReleaseRequest; requestSha256: string; packs: SkillStarterPack[];
  workflows: WorkflowDefinitionVersionInput[];
}

/** All before-state values remain in memory; emit only a digest, never bodies. */
export async function stateDigest(s: TenantSession): Promise<string> {
  const state: unknown[] = [];
  const tables = ["agents", "agent_versions", "agent_starter_pack_imports", "skills", "skill_versions",
    "skill_version_files", "starter_pack_imports", "skill_catalog_entries", "capability_listings",
    "workflow_definitions", "workflow_definition_versions"] as const;
  for (const table of tables) {
    // Table identifiers are compile-time allowlisted, not supplied by a request.
    const result = await s.query<{ row: unknown }>(`SELECT to_jsonb(t) AS row FROM ${table} t WHERE org_id=$1`, [ORG]);
    state.push({ table, rows: result.rows.map(x => canonical(x.row)).sort() });
  }
  return sha(canonical(state));
}

export function verifyInputs(request: ReleaseRequest, requestSha256: string,
  load: (ref: PackRef) => Buffer): VerifiedInputs {
  need(request.schemaVersion === 1 && request.targetOrgId === ORG && request.acceptanceScope === "mvp-non-model", "REQUEST_SCOPE");
  need(/^[a-f0-9]{40}$/.test(request.sourceRevision) && /^[a-f0-9]{64}$/.test(requestSha256), "SOURCE_IDENTITY");
  need(/^[a-z0-9][a-z0-9._-]{0,100}$/.test(request.releaseId), "RELEASE_ID");
  need(typeof request.expectedDatabase === "string" && /^[a-zA-Z0-9_]{1,63}$/.test(request.expectedDatabase), "DATABASE_SCOPE");
  need(/^[a-f0-9]{64}$/.test(request.beforeStateSha256), "BEFORE_STATE_REQUIRED");
  need(canonical(request.skippedTests) === canonical(["real-model", "ai-output-quality"]), "MVP_SKIPS_REQUIRED");
  need(Array.isArray(request.notApplicableContents) && request.notApplicableContents.includes("future-catalog-v2"), "FUTURE_SCOPE_REQUIRED");
  need(Array.isArray(request.packRefs) && request.packRefs.length <= 50 && Array.isArray(request.workflows), "INPUT_LISTS");
  const seen = new Set<string>();
  const skills = new Map<string, string>();
  const packs = request.packRefs.map(ref => {
    need(/^[a-z0-9][a-z0-9-]{0,100}$/.test(ref.packId) && /^[0-9]+\.[0-9]+\.[0-9]+$/.test(ref.packVersion), "PACK_COORDINATE");
    const key = `${ref.packId}@${ref.packVersion}`;
    need(!seen.has(key), "PACK_DUPLICATE"); seen.add(key);
    const raw = load(ref); need(sha(raw) === ref.rawSha256, "PACK_BYTES_CHANGED");
    const pack = verifySkillStarterPack(JSON.parse(raw.toString("utf8")), ref);
    need(pack.packDigest === ref.packDigest, "PACK_DIGEST_CHANGED");
    const work = checkWorkSkillManifests(pack); need(work.kind !== "rejected", "PACK_WORK_MANIFEST_INVALID");
    for (const skill of pack.skills) {
      const key = `${skill.stableName}@${skill.semanticVersion}`;
      const digest = skillContentDigest(skill);
      need(!skills.has(key) || skills.get(key) === digest, "SHARED_VERSION_CONTENT_CONFLICT");
      skills.set(key, digest);
    }
    return pack;
  });
  if (request.officialRolePackDigest !== null) need(request.officialRolePackDigest === buildOfficialAgentRolePack().packDigest, "ROLE_PACK_CHANGED");
  const builtIns = builtInWorkflowDefinitions(); const workflowSeen = new Set<string>();
  const workflows = request.workflows.map(ref => {
    const key = `${ref.key}@${ref.version}`; need(!workflowSeen.has(key), "WORKFLOW_DUPLICATE"); workflowSeen.add(key);
    const def = builtIns.find(x => x.key === ref.key && x.version === ref.version);
    need(def && sha(canonical(def)) === ref.contentDigest, "WORKFLOW_NOT_SHIPPED_OR_CHANGED");
    return def;
  });
  need(packs.length + workflows.length + (request.officialRolePackDigest ? 1 : 0) > 0, "EMPTY_CONTENT_RELEASE");
  return { request, requestSha256, packs, workflows };
}

interface RoleRow {
  id: string; stable_name: string; published_version_id: string;
  draft: Record<string, unknown>; published: Record<string, unknown>;
}
async function roleRows(s: TenantSession, lock = false): Promise<RoleRow[]> {
  return (await s.query<RoleRow>(`SELECT a.id,a.stable_name,a.published_version_id,
    to_jsonb(a) AS draft,to_jsonb(v) AS published FROM agents a
    LEFT JOIN agent_versions v ON v.org_id=a.org_id AND v.agent_id=a.id AND v.id=a.published_version_id
    WHERE a.org_id=$1 ORDER BY a.id${lock ? " FOR UPDATE OF a" : ""}`, [ORG])).rows;
}
type OfficialEntry = ReturnType<typeof buildOfficialAgentRolePack>["agents"][number];
export function checkLegacy(row: RoleRow, target: OfficialEntry): void {
  const draft = row.draft, pub = row.published;
  need(pub && draft.catalog_source === "official" && pub.catalog_source === "official", "CUSTOM_ROLE_CONFLICT");
  need(draft.name === target.name && draft.role_label === target.roleLabel, "ROLE_CUSTOMIZED");
  // Import-created legacy drafts have nullable instructions/model_id and empty
  // mount/whitelist arrays. Non-default edits must not hitchhike on an upgrade.
  need((draft.instructions == null || draft.instructions === pub.instructions)
    && (draft.model_id == null || draft.model_id === pub.model_id)
    && (draft.model_provider == null || draft.model_provider === pub.model_provider)
    && (draft.tool_policy == null || canonical(draft.tool_policy) === canonical(pub.tool_policy))
    && (draft.tool_whitelist == null || canonical(draft.tool_whitelist) === "[]")
    && (draft.skill_mounts == null || canonical(draft.skill_mounts) === "[]"), "ROLE_DRAFT_RUNTIME_CHANGED");
  need(Object.values(AGENT_ROLE_COLUMN_OF).every(col => canonical(draft[col]) === canonical(pub[col])), "ROLE_DRAFT_CHANGED");
  need(Object.entries(AGENT_ROLE_COLUMN_OF).every(([key, col]) => canonical(pub[col]) === canonical(key === "catalogSource" ? "official" : target.role[key as keyof typeof target.role])), "ROLE_FIELDS_CUSTOMIZED");
  need(pub.model_provider === target.modelProvider && pub.model_id === target.modelId && canonical(pub.tool_policy) === canonical(target.toolPolicy), "ROLE_RUNTIME_CUSTOMIZED");
  need(typeof pub.instructions === "string" && sha(pub.instructions) === pub.instruction_digest, "ROLE_INSTRUCTION_CORRUPT");
  if (pub.semantic_label === target.semanticVersion && pub.instruction_digest === target.instructionDigest) return;
  const label = String(pub.semantic_label);
  need(label === label.split("+")[0] && historicalOfficialRoleInstructionDigests(label)[target.stableName] === pub.instruction_digest,
    "ROLE_LEGACY_NOT_RECOGNIZED");
  need(Array.isArray(pub.skill_version_ids) && pub.skill_version_ids.length === 0, "ROLE_LEGACY_CUSTOM_PINS");
}

export function checkBindings(row: RoleRow, refs: { readonly pins: readonly string[]; readonly pending: readonly unknown[] }): void {
  need(canonical(row.published.skill_version_ids) === canonical(refs.pins)
    && canonical(row.published.pending_skill_bindings ?? []) === canonical(refs.pending), "ROLE_BINDINGS_NOT_ALIGNED");
}

async function synchronizeRoles(db: DatabasePort, s: TenantSession, input: VerifiedInputs): Promise<void> {
  const pack = buildOfficialAgentRolePack(); const rows = await roleRows(s, true);
  // Check every existing target before the first role mutation.
  for (const target of pack.agents) {
    const row = rows.find(x => x.stable_name === target.stableName);
    if (row) checkLegacy(row, target);
  }
  const resolved = await resolveOfficialRoleSkillRefs(s, ORG, pack);
  const repo = new PgOfficialAgentRolePackImportRepository(db);
  const at = new Date().toISOString(); const agentIds: string[] = []; const versionIds: string[] = [];
  for (const target of pack.agents) {
    const row = rows.find(x => x.stable_name === target.stableName);
    if (!row) {
      // A selected subset is bound to the fully verified source pack and real operation.
      const outcome = await repo.persistVerified({ orgId: ORG, actorId: ACTOR,
        idempotencyKey: `${input.request.releaseId}:new:${target.stableName}`,
        payloadDigest: sha(canonical({ sourcePackDigest: pack.packDigest, stableName: target.stableName })),
        pack: { ...pack, agents: [target] } });
      need(outcome.kind === "created" || outcome.kind === "replayed", "ROLE_IMPORT_REJECTED");
      continue;
    }
    if (row.published.semantic_label === target.semanticVersion && row.published.instruction_digest === target.instructionDigest) {
      checkBindings(row, resolved.get(target.stableName)!);
      continue;
    }
    const versionId = `agent-version-${randomUUID()}`;
    const refs = resolved.get(target.stableName)!;
    await insertAgentVersionFromDraft(s, { versionId, orgId: ORG, agentId: row.id,
      semanticLabel: target.semanticVersion, instructionDigest: target.instructionDigest, instructions: target.instructions,
      skillVersionIds: refs.pins, pendingSkillBindings: refs.pending, modelProvider: target.modelProvider,
      modelId: target.modelId, toolPolicy: target.toolPolicy, creatorId: ACTOR, at, roleFromVersionId: row.published_version_id });
    const changed = await s.query(`UPDATE agents SET published_version_id=$3,updated_at=$4
      WHERE org_id=$1 AND id=$2 AND published_version_id=$5 RETURNING id`, [ORG, row.id, versionId, at, row.published_version_id]);
    need(changed.rows.length === 1, "ROLE_PUBLICATION_CAS"); agentIds.push(row.id); versionIds.push(versionId);
  }
  if (agentIds.length > 0) {
    // Truthful current upgrade provenance; never synthesize a past 1.6 import.
    const result = { agentIds, versionIds, importedAt: at };
    await s.query(`INSERT INTO agent_starter_pack_imports
      (id,org_id,pack_id,pack_version,pack_digest,payload_digest,idempotency_key,administrator_id,imported_at,status,result_json,failure_code)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'succeeded',$10::jsonb,NULL)`,
      [`agent-import-${randomUUID()}`, ORG, pack.packId, pack.packVersion, pack.packDigest, input.requestSha256,
        `${input.request.releaseId}:legacy`, ACTOR, at, JSON.stringify(result)]);
  }
}

export async function readback(db: DatabasePort, s: TenantSession, input: VerifiedInputs) {
  let skillVersions = 0, roleVersions = 0, workflows = 0, pendingBindings = 0;
  const checkedSkills = new Set<string>();
  for (const pack of input.packs) for (const skill of pack.skills) {
    const coord = `${skill.stableName}@${skill.semanticVersion}`;
    if (checkedSkills.has(coord)) continue; checkedSkills.add(coord);
    const expected = skillContentDigest(skill);
    const found = await s.query<{ id: string; manifest: unknown }>(`SELECT v.id,v.manifest FROM skill_versions v
      JOIN skills k ON k.id=v.skill_id AND k.org_id=v.org_id
      WHERE v.org_id=$1 AND k.stable_name=$2 AND v.semantic_label=$3 AND v.content_digest=$4 AND v.published=true`,
      [ORG, skill.stableName, skill.semanticVersion, expected]);
    need(found.rows.length === 1, "SKILL_VERSION_READBACK");
    need(canonical(found.rows[0]!.manifest) === canonical(skill.manifest), "SKILL_MANIFEST_READBACK");
    const files = await s.query<{ path: string; digest: string; content: Buffer }>(
      "SELECT path,digest,content FROM skill_version_files WHERE org_id=$1 AND version_id=$2 ORDER BY path", [ORG, found.rows[0]!.id]);
    need(files.rows.length === skill.files.length && skill.files.every(f => files.rows.some(x =>
      x.path === f.path && x.digest === f.digest && sha(x.content) === f.digest)), "SKILL_FILE_READBACK");
    skillVersions++;
  }
  if (input.request.officialRolePackDigest !== null) {
    const rows = await roleRows(s);
    const pack = buildOfficialAgentRolePack();
    const resolved = await resolveOfficialRoleSkillRefs(s, ORG, pack);
    for (const target of pack.agents) {
      const row = rows.find(x => x.stable_name === target.stableName); need(row, "ROLE_READBACK_MISSING");
      checkLegacy(row, target);
      need(row.published.semantic_label === target.semanticVersion && row.published.instruction_digest === target.instructionDigest, "ROLE_READBACK_VERSION");
      checkBindings(row, resolved.get(target.stableName)!);
      pendingBindings += Array.isArray(row.published.pending_skill_bindings) ? row.published.pending_skill_bindings.length : 0;
      roleVersions++;
    }
  }
  const repo = new PgWorkflowDefinitionRepository(db);
  for (const def of input.workflows) {
    const actual = await repo.findVersion(ORG, def.key, def.version);
    need(actual?.status === "published", "WORKFLOW_READBACK_MISSING");
    const { status: _status, publishedAt: _at, ...content } = actual;
    need(canonical(content) === canonical(def), "WORKFLOW_READBACK_CONTENT"); workflows++;
  }
  return { skillVersions, roleVersions, workflows, pendingBindings,
    contentReadbackPassed: true, acceptanceScope: "mvp-non-model", realModel: "SKIPPED", aiOutputQuality: "SKIPPED",
    skillVerificationPromotion: "NOT_PERFORMED", fullBusinessAcceptance: false };
}

export async function synchronize(db: DatabasePort, input: VerifiedInputs) {
  return db.withTenant(ORG, async s => {
    await s.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [ORG]);
    await s.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 418))", [ORG]);
    const identity = await s.query<{ database: string }>("SELECT current_database() AS database");
    need(identity.rows[0]?.database === input.request.expectedDatabase, "DATABASE_IDENTITY");
    const member = await s.query<{ org_role: string }>("SELECT org_role FROM org_memberships WHERE org_id=$1 AND user_id=$2", [ORG, ACTOR]);
    need(member.rows[0]?.org_role === "admin", "EXISTING_PLATFORM_ADMIN_REQUIRED");
    const key = `${input.request.releaseId}:content-release`;
    const prior = await s.query<{ payload_digest: string; status: string }>(
      "SELECT payload_digest,status FROM agent_starter_pack_imports WHERE org_id=$1 AND idempotency_key=$2", [ORG, key]);
    if (prior.rows.length > 0) {
      need(prior.rows[0]!.payload_digest === input.requestSha256 && prior.rows[0]!.status === "succeeded", "OPERATION_REPLAY_CONFLICT");
      return { ...(await readback(db, s, input)), replayed: true };
    }
    need(await stateDigest(s) === input.request.beforeStateSha256, "CONTENT_BEFORE_STATE_CAS");
    const imports = new PgSkillStarterImportRepository(db);
    for (const pack of input.packs) {
      const work = checkWorkSkillManifests(pack); need(work.kind !== "rejected", "PACK_WORK_MANIFEST_INVALID");
      // No automatic retireSuperseded, follow-up, or fabricated gateStatuses.
      const outcome = await imports.persistVerified({ orgId: ORG, actorId: ACTOR, pack,
        idempotencyKey: `${input.request.releaseId}:${pack.packId}:${pack.packVersion}`,
        payloadDigest: importPayloadDigest(pack), workManifests: work.manifests });
      need(outcome.kind === "created" || outcome.kind === "replayed", "SKILL_IMPORT_REJECTED");
    }
    if (input.request.officialRolePackDigest !== null) await synchronizeRoles(db, s, input);
    const repo = new PgWorkflowDefinitionRepository(db);
    const result = await publishBuiltInWorkflowDefinitions({ definitions: repo, catalog: repo,
      graphs: new WorkflowGraphRegistry(defaultWorkflowGraphs(), defaultCommandWorkflowGraphs()),
      skills: new PgSkillCatalogVersionResolver(db), clock: { nowIso: () => new Date().toISOString() } },
      { orgId: ORG, actor: { userId: ACTOR, orgRole: "admin" }, definitions: input.workflows });
    need(result.every(x => x.outcome === "published"), "WORKFLOW_PUBLICATION_UNAVAILABLE");
    const receipt = await readback(db, s, input);
    await s.query(`INSERT INTO agent_starter_pack_imports
      (id,org_id,pack_id,pack_version,pack_digest,payload_digest,idempotency_key,administrator_id,imported_at,status,result_json,failure_code)
      VALUES($1,$2,'platform-content-release','1',$3,$3,$4,$5,$6,'succeeded',$7::jsonb,NULL)`,
      [`agent-import-${randomUUID()}`, ORG, input.requestSha256, key, ACTOR, new Date().toISOString(), JSON.stringify(receipt)]);
    return { ...receipt, replayed: false };
  });
}
