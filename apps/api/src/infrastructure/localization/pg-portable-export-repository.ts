import { guard, discloseDecided, isDisclosed } from "../../application/security/permission-filter";
import { createHash } from "node:crypto";
import { wave2Runtime } from "@repo/contracts";
import { LocalizationFields } from "@repo/contracts/entity-localization";
import { PackLocalization } from "@repo/contracts/pack-localization";
import type { DatabasePort, TenantSession } from "../../application/ports/database.port";
import type { PortableExportRepository } from "../../application/localization/portable-export";
import { AGENT_ROLE_COLUMN_OF } from "../agent/agent-version-insert";
import { localizationSources, LOCALIZATION_TABLES } from "./pg-entity-localization-repository";

import { restoreSkillExecution } from "../../domain/localization/skill-execution-representation";
import { portableExportPackId } from "../../domain/localization/portable-pack";

const sha = (value: string) => createHash("sha256").update(value).digest("hex");
async function translations(s: TenantSession, source: Awaited<ReturnType<typeof localizationSources>>[number]["source"]) {
  const { table, id } = LOCALIZATION_TABLES[source.kind];
  const rows = await s.query<{ locale: string; name: string | null; summary: string | null; duty: string | null; role_label: string | null; avatar_alt: string | null }>(
    `SELECT locale,name,summary,duty,role_label,avatar_alt FROM ${table}
     WHERE org_id=$1 AND ${id}=$2 AND source_revision=$3 AND status='reviewed' ORDER BY locale`,
    [source.orgId, source.entityId, source.revision]);
  return PackLocalization.parse({ sourceLocale: source.locale, translations: Object.fromEntries(rows.rows.map(row => [row.locale,
    LocalizationFields.parse({ name: row.name, summary: row.summary, duty: row.duty, roleLabel: row.role_label, avatarAlt: row.avatar_alt })])) });
}

/** Export a captured source and its exact immutable published version. A package
 * gets a new envelope digest; stored execution versions and file hashes are untouched. */
export class PgPortableExportRepository implements PortableExportRepository {
  constructor(private readonly db: DatabasePort) {}
  get(input: Parameters<PortableExportRepository["get"]>[0]) {
    return this.db.withTenant(input.orgId, async s => {
      const candidate = (await localizationSources(s, input.orgId, input.kind, [input.entityId]))[0];
      if (!candidate || !candidate.source.versionId) return null;
      const disclosed = discloseDecided(guard({ kind: "capability",id: candidate.source.entityId },candidate.source),input.authorize(candidate.facts));
      if (!isDisclosed(disclosed)) return null;
      const source = disclosed.payload;
      const localization = await translations(s, source);
      if (input.kind === "skill") {
        const row = (await s.query<{ stable_name: string; semantic_label: string; content_digest: string; manifest: Record<string, unknown> }>(
          `SELECT sk.stable_name,v.semantic_label,v.manifest,v.content_digest FROM skills sk
           JOIN skill_versions v ON v.org_id=sk.org_id AND v.skill_id=sk.id AND v.id=$3 AND v.published
           WHERE sk.org_id=$1 AND sk.id=$2`, [input.orgId,input.entityId,source.versionId])).rows[0];
        if (!row) return null;
        const files = await s.query<{ path: string; content: Buffer; media_type: string; digest: string }>(
          "SELECT path,content,media_type,digest FROM skill_version_files WHERE org_id=$1 AND version_id=$2 ORDER BY path", [input.orgId,source.versionId]);
        const representation = (await s.query<{ representation: string }>(
          "SELECT representation FROM skill_execution_representations WHERE org_id=$1 AND version_id=$2",[input.orgId,source.versionId])).rows[0]?.representation ?? null;
        const definition = restoreSkillExecution({ representation,contentDigest: row.content_digest,manifest: row.manifest,
          files: files.rows.map(file => ({ path: file.path,mediaType: file.media_type,digest: file.digest,contentBase64: file.content.toString("base64") })) });
        if (!definition) return null;
        const unsigned = wave2Runtime.UnsignedSkillStarterPackV2.parse({ schemaVersion: 2, packId: portableExportPackId(row.stable_name), packVersion: "1.0.0",
          skills: [{ stableName: row.stable_name, name: source.fields.name, semanticVersion: row.semantic_label,
            duty: source.fields.duty, ...definition, localization }] });
        return wave2Runtime.SkillStarterPackV2.parse({ ...unsigned, packDigest: sha(JSON.stringify(unsigned)) });
      }
      const row = (await s.query<Record<string, unknown> & { stable_name: string; skill_version_ids: string[] }>(
        `SELECT a.stable_name,v.semantic_label,v.instructions,v.instruction_digest,v.model_provider,v.model_id,v.tool_policy,v.skill_version_ids,
         ${Object.values(AGENT_ROLE_COLUMN_OF).map(column => `v.${column}`).join(",")}
         FROM agents a JOIN agent_versions v ON v.org_id=a.org_id AND v.agent_id=a.id AND v.id=$3
         WHERE a.org_id=$1 AND a.id=$2`, [input.orgId,input.entityId,source.versionId])).rows[0];
      if (!row) return null;
      const pins = await s.query<{ id: string; content_digest: string }>(
        "SELECT id,content_digest FROM skill_versions WHERE org_id=$1 AND id=ANY($2::text[]) AND published", [input.orgId,row.skill_version_ids]);
      const byId = new Map(pins.rows.map(pin => [pin.id, pin.content_digest]));
      // Fail closed on an unavailable pinned dependency; never silently drop a pin.
      if (row.skill_version_ids.some(id => !byId.has(id))) return null;
      const role = Object.fromEntries(Object.entries(AGENT_ROLE_COLUMN_OF).filter(([field]) => field !== "catalogSource").map(([field,column]) => [field,row[column]]));
      const unsigned = wave2Runtime.UnsignedAgentStarterPackV2.parse({ schemaVersion: 2, packId: portableExportPackId(row.stable_name), packVersion: "1.0.0",
        agents: [{ stableName: row.stable_name, name: source.fields.name, semanticVersion: row.semantic_label,
          instructions: row.instructions, instructionDigest: row.instruction_digest,
          skillVersions: row.skill_version_ids.map(id => ({ versionId: id, digest: byId.get(id)! })),
          modelProvider: row.model_provider, modelId: row.model_id, toolPolicy: row.tool_policy,
          roleLabel: source.fields.roleLabel ?? undefined, duty: source.fields.duty, role, localization }] });
      return wave2Runtime.AgentStarterPackV2.parse({ ...unsigned, packDigest: sha(JSON.stringify(unsigned)) });
    });
  }
}
