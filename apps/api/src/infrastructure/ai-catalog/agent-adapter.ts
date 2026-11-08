import { randomUUID } from "node:crypto";
import { AgentWrite } from "@repo/contracts/ai-catalog-admin";
import type { z } from "zod";
import type {
  DatabasePort,
  TenantSession,
} from "../../application/ports/database.port";
import { newAgentDefinition } from "../../domain/agent/clone";
import { resolveDeepAgentModel } from "../agent/pg-default-agent-repository";
import { checkToollessSelfPublish } from "../../domain/agent/self-publish";
import {
  PgCreateAgentRepository,
  AGENT_DEFINITION_COLUMNS,
  toDefinition,
  type AgentDefinitionRow,
} from "../agent/pg-create-agent-repository";
import { PgSelfPublishAgentRepository } from "../agent/pg-self-publish-agent-repository";

export type AgentWriteInput = z.infer<typeof AgentWrite>;
/** Transaction-bound adapter: never changes the tenant or caller identity. */
export function boundDatabase(orgId: string, s: TenantSession): DatabasePort {
  return {
    withTenant: async (id, fn) => {
      if (id !== orgId) throw new Error("catalog_tenant_mismatch");
      return fn(s);
    },
    withoutTenant: async () => {
      throw new Error("catalog_global_query_forbidden");
    },
    close: async () => {},
  };
}
export async function agentDetail(s: TenantSession, orgId: string, id: string) {
  const row = (
    await s.query<AgentDefinitionRow>(
      `SELECT ${AGENT_DEFINITION_COLUMNS} FROM agents WHERE org_id=$1 AND id=$2`,
      [orgId, id],
    )
  ).rows[0];
  return row ? toDefinition(row) : null;
}
export async function createCatalogAgent(
  s: TenantSession,
  orgId: string,
  actorId: string,
  input: AgentWriteInput,
) {
  const id = `agent-${randomUUID()}`;
  const definition = newAgentDefinition({
    agentId: id,
    orgId,
    name: input.name,
    initials: input.name.slice(0, 2),
    role: input.description,
    roleLabel: input.description.slice(0, 100) || input.name,
    roleLabelNeedsConfirmation: false,
    instructions: input.instructions,
    visibility: "全组织可用",
    source: "self",
    modelId: input.modelId,
    skillMounts: [],
    concurrencyLimit: 1,
    degradePolicy: "跟随组织级",
  });
  await new PgCreateAgentRepository(boundDatabase(orgId, s)).insert(
    definition,
    actorId,
  );
  return { id, versionId: null };
}
export async function updateCatalogAgent(
  s: TenantSession,
  orgId: string,
  id: string,
  input: AgentWriteInput,
) {
  const existing = await agentDetail(s, orgId, id);
  if (!existing) throw new Error("CATALOG_ENTRY_NOT_FOUND");
  if (existing.publishState === "运行中") {
    const published = (
      await s.query<{ published_version_id: string }>(
        "SELECT published_version_id FROM agents WHERE org_id=$1 AND id=$2 FOR UPDATE",
        [orgId, id],
      )
    ).rows[0];
    if (!published?.published_version_id)
      throw new Error("CATALOG_ENTRY_NOT_DRAFT");
    await s.query(
      "INSERT INTO ai_catalog_agent_drafts(org_id,agent_id,base_version_id,input) VALUES($1,$2,$3,$4::jsonb) ON CONFLICT(org_id,agent_id) DO UPDATE SET input=EXCLUDED.input",
      [orgId, id, published.published_version_id, JSON.stringify(input)],
    );
    return { id, versionId: published.published_version_id };
  }
  if (existing.publishState !== "草稿")
    throw new Error("CATALOG_ENTRY_NOT_DRAFT");
  await s.query(
    "UPDATE agents SET name=$3,role=$4,role_label=$5,instructions=$6,model_id=$7,updated_at=now() WHERE org_id=$1 AND id=$2",
    [
      orgId,
      id,
      input.name,
      input.description,
      input.description.slice(0, 100) || input.name,
      input.instructions,
      input.modelId,
    ],
  );
  return { id, versionId: null };
}
export async function publishCatalogAgent(
  s: TenantSession,
  orgId: string,
  actorId: string,
  id: string,
  sourceModel?: { provider: string; modelId: string },
) {
  const current = (
    await s.query<{ published_version_id: string | null; status: string }>(
      "SELECT published_version_id,status FROM agents WHERE org_id=$1 AND id=$2 FOR UPDATE",
      [orgId, id],
    )
  ).rows[0];
  if (!current) throw new Error("CATALOG_ENTRY_NOT_FOUND");
  if (current.status !== "enabled") throw new Error("CATALOG_ENTRY_NOT_DRAFT");
  const pending = (
    await s.query<{ base_version_id: string; input: unknown }>(
      "SELECT base_version_id,input FROM ai_catalog_agent_drafts WHERE org_id=$1 AND agent_id=$2",
      [orgId, id],
    )
  ).rows[0];
  let frozenModel: { provider: string; modelId: string } | undefined =
    sourceModel;
  if (pending) {
    if (pending.base_version_id !== current.published_version_id)
      throw new Error("CATALOG_VERSION_CONFLICT");
    const input = AgentWrite.parse(pending.input);
    const base = (
      await s.query<{
        skill_version_ids: unknown;
        tool_policy: unknown;
        workflow_allowlist: unknown;
        pending_skill_bindings: unknown;
        model_provider: string;
        model_id: string;
      }>(
        "SELECT skill_version_ids,tool_policy,workflow_allowlist,pending_skill_bindings,model_provider,model_id FROM agent_versions WHERE org_id=$1 AND agent_id=$2 AND id=$3 AND published_at IS NOT NULL",
        [orgId, id, pending.base_version_id],
      )
    ).rows[0];
    if (!base) throw new Error("CATALOG_VERSION_CONFLICT");
    if (
      ![
        base.skill_version_ids,
        base.tool_policy,
        base.workflow_allowlist,
        base.pending_skill_bindings,
      ].every((v) => Array.isArray(v) && v.length === 0)
    )
      throw new Error("CATALOG_DEPENDENCIES_REQUIRE_INSTALLATION");
    if (input.modelId !== null && input.modelId !== base.model_id)
      throw new Error("CATALOG_MODEL_CHANGE_REQUIRES_VALIDATION");
    frozenModel = { provider: base.model_provider, modelId: base.model_id };
    await s.query(
      "UPDATE agents SET publish_state=$3,name=$4,role=$5,role_label=$6,instructions=$7,model_id=$8 WHERE org_id=$1 AND id=$2",
      [
        orgId,
        id,
        "草稿",
        input.name,
        input.description,
        input.description.slice(0, 100) || input.name,
        input.instructions,
        input.modelId,
      ],
    );
  }
  const definition = await agentDetail(s, orgId, id);
  if (!definition) throw new Error("CATALOG_ENTRY_NOT_FOUND");
  if (
    !frozenModel &&
    definition.modelId !== null &&
    definition.modelId !== resolveDeepAgentModel().modelId
  )
    throw new Error("CATALOG_MODEL_CHANGE_REQUIRES_VALIDATION");
  const gate = checkToollessSelfPublish(definition);
  if (!gate.ok) throw new Error(gate.reason);
  const out = await new PgSelfPublishAgentRepository(
    boundDatabase(orgId, s),
  ).publish({
    orgId,
    agentId: id,
    actorId,
    now: new Date(),
    ...(frozenModel ? { frozenModel } : {}),
    ...(pending
      ? {
          semanticLabel: `catalog-revision-${randomUUID()}`,
          frozenRoleFromVersionId: pending.base_version_id,
        }
      : sourceModel && current.published_version_id
        ? { semanticLabel: `catalog-enable-upgrade-${randomUUID()}` }
        : {}),
  });
  if (pending)
    await s.query(
      "DELETE FROM ai_catalog_agent_drafts WHERE org_id=$1 AND agent_id=$2",
      [orgId, id],
    );
  return { id, versionId: out.agentVersionId };
}
export async function disableCatalogAgent(
  s: TenantSession,
  orgId: string,
  id: string,
) {
  const row = await s.query(
    "UPDATE agents SET publish_state=$3,status='disabled',updated_at=now() WHERE org_id=$1 AND id=$2 RETURNING id",
    [orgId, id, "已停用"],
  );
  if (!row.rows.length) throw new Error("CATALOG_ENTRY_NOT_FOUND");
  await s.query(
    "UPDATE capability_listings SET enabled=false WHERE org_id=$1 AND id=$2",
    [orgId, id],
  );
}

export async function readPublishedCatalogAgent(
  s: TenantSession,
  id: string,
  versionId: string,
) {
  const rows = await s.query<Record<string, unknown>>(
    `SELECT a.*,v.instructions AS frozen_instructions,v.model_id AS frozen_model_id,v.model_provider,v.skill_version_ids,v.tool_policy,v.avatar AS frozen_avatar,v.role_category AS frozen_category,v.workflow_allowlist AS frozen_workflows,v.pending_skill_bindings AS frozen_pending_bindings FROM agents a JOIN agent_versions v ON v.org_id=a.org_id AND v.agent_id=a.id WHERE a.org_id='org-platform' AND a.id=$1 AND v.id=$2 AND a.status='enabled' AND a.publish_state='运行中' AND a.published_version_id=v.id AND v.published_at IS NOT NULL`,
    [id, versionId],
  );
  return rows.rows[0] ?? null;
}
export async function copyPublishedCatalogAgent(
  s: TenantSession,
  orgId: string,
  actorId: string,
  row: Record<string, unknown>,
) {
  // Until dependencies have a verified local installation, never copy grants or foreign pins.
  if (
    ![
      row.skill_version_ids,
      row.tool_policy,
      row.frozen_workflows,
      row.frozen_pending_bindings,
    ].every((v) => Array.isArray(v) && v.length === 0)
  )
    throw new Error("CATALOG_DEPENDENCIES_REQUIRE_INSTALLATION");
  const previous = (
    await s.query<{ local_id: string; local_version_id: string }>(
      `SELECT local_id,local_version_id FROM ai_catalog_enablements WHERE org_id=$1 AND kind='agent' AND origin_id=$2 ORDER BY enabled_at DESC,origin_version_id DESC LIMIT 1`,
      [orgId, String(row.id)],
    )
  ).rows[0];
  let created: { id: string };
  if (previous) {
    const local = (
      await s.query<{
        id: string;
        status: string;
        published_version_id: string;
        clean: boolean;
        pending: boolean;
      }>(
        `SELECT a.id,a.status,a.published_version_id,
      (a.publish_state='运行中' AND a.instructions IS NOT DISTINCT FROM v.instructions
       AND a.model_id IS NOT DISTINCT FROM v.model_id AND a.avatar IS NOT DISTINCT FROM v.avatar
       AND a.role_category IS NOT DISTINCT FROM v.role_category
       AND a.workflow_allowlist IS NOT DISTINCT FROM v.workflow_allowlist
       AND a.delegation_policy IS NOT DISTINCT FROM v.delegation_policy
       AND a.escalation_policy IS NOT DISTINCT FROM v.escalation_policy
       AND a.kpi IS NOT DISTINCT FROM v.kpi AND a.tags IS NOT DISTINCT FROM v.tags
       AND a.skill_mounts='[]'::jsonb AND a.tool_whitelist='[]'::jsonb) AS clean,
       EXISTS(SELECT 1 FROM ai_catalog_agent_drafts d WHERE d.org_id=a.org_id AND d.agent_id=a.id) AS pending
       FROM agents a JOIN agent_versions v ON v.org_id=a.org_id AND v.agent_id=a.id AND v.id=$3
       WHERE a.org_id=$1 AND a.id=$2 FOR UPDATE OF a`,
        [orgId, previous.local_id, previous.local_version_id],
      )
    ).rows[0];
    if (
      !local ||
      local.status !== "enabled" ||
      local.published_version_id !== previous.local_version_id ||
      !local.clean ||
      local.pending
    )
      throw new Error("CATALOG_VERSION_CONFLICT");
    await s.query(
      `UPDATE agents SET name=$3,role=$4,role_label=$5,instructions=$6,model_id=$7,publish_state='草稿',updated_at=now() WHERE org_id=$1 AND id=$2`,
      [
        orgId,
        local.id,
        String(row.name),
        String(row.role ?? ""),
        String(row.role ?? "").slice(0, 100) || String(row.name),
        String(row.frozen_instructions),
        row.frozen_model_id === null ? null : String(row.frozen_model_id),
      ],
    );
    created = { id: local.id };
  } else {
    created = await createCatalogAgent(s, orgId, actorId, {
      name: String(row.name),
      description: String(row.role ?? ""),
      instructions: String(row.frozen_instructions),
      modelId:
        row.frozen_model_id === null ? null : String(row.frozen_model_id),
    });
  }
  await s.query(
    "UPDATE agents SET avatar=$3::jsonb,role_category=$4 WHERE org_id=$1 AND id=$2",
    [
      orgId,
      created.id,
      row.frozen_avatar == null ? null : JSON.stringify(row.frozen_avatar),
      row.frozen_category ?? null,
    ],
  );
  return publishCatalogAgent(s, orgId, actorId, created.id, {
    provider: String(row.model_provider),
    modelId: String(row.frozen_model_id),
  });
}
