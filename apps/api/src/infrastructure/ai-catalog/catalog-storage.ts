import { WorkSkillStableId } from "@repo/contracts/work-skill-meta";
import type { z } from "zod";
import {
  AgentWrite,
  Entry,
  PLATFORM_CATALOG_ORG_ID,
  type Kind,
  type Write,
} from "@repo/contracts/ai-catalog-admin";
import type { TenantSession } from "../../application/ports/database.port";
import {
  createCatalogAgent,
  updateCatalogAgent,
  publishCatalogAgent,
  disableCatalogAgent,
} from "./agent-adapter";
import {
  createCatalogSkill,
  appendCatalogSkillDraft,
  publishCatalogSkill,
  disableCatalogSkill,
} from "../skill/ai-catalog-skill-storage";
export async function catalogEntries(
  s: TenantSession,
  orgId: string,
  kind: z.infer<typeof Kind>,
  limit: number,
  offset: number,
  id?: string,
  entityType?: "agent" | "skill" | "skill-contract",
) {
  const result =
    kind === "agent"
      ? await s.query<Record<string, unknown>>(
          `SELECT id,name,avatar,EXISTS(SELECT 1 FROM ai_catalog_agent_drafts d WHERE d.org_id=agents.org_id AND d.agent_id=agents.id) AS has_draft,role AS description,published_version_id AS version_id,publish_state='运行中' AS published,status='enabled' AS enabled FROM agents WHERE org_id=$1 AND ($4::text IS NULL OR id=$4) ORDER BY id LIMIT $2 OFFSET $3`,
          [orgId, limit, offset, id ?? null],
        )
      : await s.query<Record<string, unknown>>(
          `SELECT * FROM (
             SELECT sk.id, sk.name, COALESCE(v.manifest->>'description','') AS description,
                    v.id AS version_id, COALESCE(v.published,false) AS published, sk.status='enabled' AS enabled,
                    COALESCE(sce.stable_id, CASE WHEN v.published AND (sk.org_id=$6 OR EXISTS (
                      SELECT 1 FROM ai_catalog_enablements ae
                       WHERE ae.org_id=sk.org_id AND ae.kind='skill' AND ae.local_id=sk.id AND ae.local_version_id=v.id
                    )) THEN v.manifest#>>'{work,stableId}' END) AS work_skill_id,
                    'skill'::text AS entity_type
               FROM skills sk
               LEFT JOIN skill_catalog_entries sce ON sce.org_id=sk.org_id AND sce.skill_id=sk.id
               LEFT JOIN LATERAL (
                 SELECT id, manifest, published FROM skill_versions
                  WHERE org_id=sk.org_id AND skill_id=sk.id ORDER BY created_at DESC, id DESC LIMIT 1
               ) v ON true
              WHERE sk.org_id=$1 AND ($4::text IS NULL OR sk.id=$4)
             UNION ALL
             SELECT id, name, duty AS description, current_version_id AS version_id,
                    status='已启用' AS published, status='已启用' AS enabled,
                    NULL AS work_skill_id, 'skill-contract'::text AS entity_type
               FROM skill_contracts WHERE org_id=$1 AND ($4::text IS NULL OR id=$4)
           ) entries WHERE ($5::text IS NULL OR entity_type=$5)
           ORDER BY id, entity_type LIMIT $2 OFFSET $3`,
          [orgId, limit, offset, id ?? null, entityType ?? null, PLATFORM_CATALOG_ORG_ID],
        );
  return result.rows.map((r) => {
    const workSkillId = WorkSkillStableId.safeParse(r.work_skill_id);
    return Entry.parse({
      orgId,
      id: r.id,
      kind,
      entityType: r.entity_type ?? kind,
      name: r.name,
      description: r.description ?? "",
      ...(workSkillId.success ? { workSkillId: workSkillId.data } : {}),
      avatarUrl: null,
      avatarKey:
        typeof r.avatar === "object" && r.avatar !== null && "key" in r.avatar
          ? String(r.avatar.key)
          : null,
      versionId: r.version_id ?? null,
      scope: orgId === PLATFORM_CATALOG_ORG_ID ? "public" : "organization",
      published: r.published === true,
      hasDraft:
        r.has_draft === true ||
        (r.entity_type === "skill" && r.published !== true),
      enabled: r.enabled === true,
    });
  });
}
export async function catalogWrite(
  s: TenantSession,
  orgId: string,
  actorId: string,
  body: z.infer<typeof Write>,
  id?: string,
) {
  return body.kind === "agent"
    ? id
      ? updateCatalogAgent(s, orgId, id, body.input)
      : createCatalogAgent(s, orgId, actorId, body.input)
    : id
      ? appendCatalogSkillDraft(s, orgId, actorId, id, body.input)
      : createCatalogSkill(s, orgId, actorId, body.input);
}
export async function catalogPublish(
  s: TenantSession,
  orgId: string,
  actorId: string,
  kind: z.infer<typeof Kind>,
  id: string,
) {
  if (kind === "agent") return publishCatalogAgent(s, orgId, actorId, id);
  const v = (
    await s.query<{ id: string }>(
      "SELECT id FROM skill_versions WHERE org_id=$1 AND skill_id=$2 ORDER BY created_at DESC,id DESC LIMIT 1",
      [orgId, id],
    )
  ).rows[0];
  if (!v) throw new Error("CATALOG_NOT_FOUND");
  await publishCatalogSkill(s, orgId, id, v.id);
  return { id, versionId: v.id };
}
export async function catalogDisable(
  s: TenantSession,
  orgId: string,
  kind: z.infer<typeof Kind>,
  id: string,
) {
  return kind === "agent"
    ? disableCatalogAgent(s, orgId, id)
    : disableCatalogSkill(s, orgId, id);
}
export async function catalogTargetExists(s: TenantSession, orgId: string) {
  return (
    (
      await s.query(
        "SELECT id FROM organizations WHERE id=$1 AND kind IN ('organization','platform')",
        [orgId],
      )
    ).rows.length > 0
  );
}
export async function catalogAudit(
  s: TenantSession,
  orgId: string,
  actor: string,
  action: string,
  kind: string,
  id: string,
) {
  await s.query(
    "INSERT INTO ai_catalog_changes(org_id,actor_id,action,kind,entity_id) VALUES($1,$2,$3,$4,$5)",
    [orgId, actor, action, kind, id],
  );
}
export async function catalogMarkManaged(
  s: TenantSession,
  kind: string,
  id: string,
) {
  await s.query(
    "INSERT INTO ai_catalog_managed(kind,entity_id) VALUES($1,$2)",
    [kind, id],
  );
}
export async function catalogMarkPublished(
  s: TenantSession,
  kind: string,
  id: string,
  version: string,
  actor: string,
) {
  await s.query(
    "INSERT INTO ai_catalog_publications(kind,entity_id,version_id,published_by) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING",
    [kind, id, version, actor],
  );
}
export async function catalogPublications(
  s: TenantSession,
  kind: string,
  limit: number,
  offset: number,
) {
  return (
    await s.query<{ entity_id: string; version_id: string }>(
      "SELECT entity_id,version_id FROM (SELECT DISTINCT ON(entity_id) entity_id,version_id,published_at FROM ai_catalog_publications WHERE kind=$1 ORDER BY entity_id,published_at DESC,version_id DESC) latest ORDER BY published_at DESC,entity_id,version_id LIMIT $2 OFFSET $3",
      [kind, limit, offset],
    )
  ).rows;
}
export async function catalogPublicationExists(
  s: TenantSession,
  kind: string,
  id: string,
  version: string,
) {
  return (
    (
      await s.query(
        "SELECT 1 FROM ai_catalog_publications WHERE kind=$1 AND entity_id=$2 AND version_id=$3",
        [kind, id, version],
      )
    ).rows.length > 0
  );
}
export async function catalogEnabledOrigins(
  s: TenantSession,
  orgId: string,
  kind: string,
) {
  return (
    await s.query<{ origin_id: string; origin_version_id: string }>(
      "SELECT origin_id,origin_version_id FROM ai_catalog_enablements WHERE org_id=$1 AND kind=$2",
      [orgId, kind],
    )
  ).rows;
}
export async function catalogLockOrganization(s: TenantSession, orgId: string) {
  await s.query("SELECT id FROM organizations WHERE id=$1 FOR UPDATE", [orgId]);
}
export async function catalogFindEnablement(
  s: TenantSession,
  orgId: string,
  key: string,
  kind: string,
  id: string,
  version: string,
) {
  return (
    (
      await s.query<{
        kind: string;
        local_id: string;
        local_version_id: string;
        origin_id: string;
        origin_version_id: string;
      }>(
        "SELECT * FROM ai_catalog_enablements WHERE org_id=$1 AND (idempotency_key=$2 OR (kind=$3 AND origin_id=$4 AND origin_version_id=$5))",
        [orgId, key, kind, id, version],
      )
    ).rows[0] ?? null
  );
}
export async function catalogRecordEnablement(
  s: TenantSession,
  orgId: string,
  kind: string,
  origin: string,
  originVersion: string,
  id: string,
  version: string,
  actor: string,
  key: string,
) {
  await s.query(
    "INSERT INTO ai_catalog_enablements(org_id,kind,origin_id,origin_version_id,local_id,local_version_id,enabled_by,idempotency_key) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
    [orgId, kind, origin, originVersion, id, version, actor, key],
  );
}
export async function catalogDefinition(
  s: TenantSession,
  orgId: string,
  row: z.infer<typeof Entry>,
) {
  if (row.kind === "agent") {
    const pending = (
      await s.query<{ input: unknown }>(
        "SELECT input FROM ai_catalog_agent_drafts WHERE org_id=$1 AND agent_id=$2",
        [orgId, row.id],
      )
    ).rows[0];
    if (pending)
      return { kind: "agent" as const, input: AgentWrite.parse(pending.input) };
    const r = (
      await s.query<{ instructions: string; model_id: string | null }>(
        "SELECT instructions,model_id FROM agents WHERE org_id=$1 AND id=$2",
        [orgId, row.id],
      )
    ).rows[0];
    return {
      kind: "agent" as const,
      input: {
        name: row.name,
        description: row.description,
        instructions: r?.instructions ?? "",
        modelId: r?.model_id ?? null,
      },
    };
  }
  if (row.entityType === "skill-contract") {
    const legacy = (
      await s.query<{
        name: string;
        duty: string;
        source: string;
        status: string;
        current_version_id: string | null;
        model_ref: string | null;
        version_state: string | null;
        prompt_template: string | null;
        input_schema: string | null;
        output_schema: string | null;
        data_scope: string[] | null;
        reads_raw_transcript: boolean | null;
        fallback_declaration: string | null;
      }>(
        `SELECT sk.name,sk.duty,sk.source,sk.status,v.id AS current_version_id,v.model_ref,v.state AS version_state,v.prompt_template,v.input_schema,v.output_schema,v.data_scope,v.reads_raw_transcript,v.fallback_declaration FROM skill_contracts sk LEFT JOIN LATERAL (SELECT * FROM skill_contract_versions WHERE org_id=sk.org_id AND skill_id=sk.id ORDER BY (id=sk.current_version_id) DESC NULLS LAST,version_number DESC LIMIT 1) v ON true WHERE sk.org_id=$1 AND sk.id=$2`,
        [orgId, row.id],
      )
    ).rows[0];
    if (!legacy) throw new Error("CATALOG_NOT_FOUND");
    return {
      kind: "skill-contract" as const,
      input: {
        name: legacy.name,
        description: legacy.duty,
        source: legacy.source,
        status: legacy.status,
        versionId: legacy.current_version_id,
        modelRef: legacy.model_ref,
        versionState: legacy.version_state,
        declaration:
          legacy.prompt_template === null
            ? null
            : {
                promptTemplate: legacy.prompt_template,
                inputSchema: legacy.input_schema!,
                outputSchema: legacy.output_schema!,
                dataScope: legacy.data_scope!,
                readsRawTranscript: legacy.reads_raw_transcript!,
                fallbackDeclaration: legacy.fallback_declaration!,
              },
      },
    };
  }
  const r = (
    await s.query<{ stable_name: string; content: Buffer }>(
      `SELECT sk.stable_name,f.content FROM skills sk LEFT JOIN skill_catalog_entries sce ON sce.org_id=sk.org_id AND sce.skill_id=sk.id LEFT JOIN LATERAL (SELECT id FROM skill_versions WHERE org_id=sk.org_id AND skill_id=sk.id ORDER BY created_at DESC,id DESC LIMIT 1) v ON true LEFT JOIN skill_version_files f ON f.org_id=sk.org_id AND f.version_id=v.id AND f.path='SKILL.md' WHERE sk.org_id=$1 AND sk.id=$2`,
      [orgId, row.id],
    )
  ).rows[0];
  return {
    kind: "skill" as const,
    input: {
      name: row.name,
      description: row.description,
      stableName: r?.stable_name ?? "",
      content: r?.content?.toString("utf8") ?? "",
    },
  };
}
export async function catalogIdempotency(
  s: TenantSession,
  orgId: string,
  key: string,
) {
  return (
    (
      await s.query<{
        kind: string;
        origin_id: string;
        origin_version_id: string;
        local_id: string;
        local_version_id: string;
      }>(
        "SELECT kind,origin_id,origin_version_id,local_id,local_version_id FROM ai_catalog_enablements WHERE org_id=$1 AND idempotency_key=$2",
        [orgId, key],
      )
    ).rows[0] ?? null
  );
}
