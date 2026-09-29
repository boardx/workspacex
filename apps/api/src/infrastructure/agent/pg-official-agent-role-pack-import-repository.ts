import { randomUUID } from "node:crypto";
import type { DatabasePort, TenantSession } from "../../application/ports/database.port";
import type { OfficialAgentRolePackImportRepository, AgentStarterImportResult, ExistingAgentImportOutcome, PersistVerifiedOfficialAgentRolePackOutcome } from "../../application/agent-import/ports";
import { insertAgentVersionFromDraft } from "./agent-version-insert";

/**
 * AG03 · 官方角色包落库。与 `pg-agent-starter-import-repository.ts` 同构（同一张幂等台账表
 * `agent_starter_pack_imports`，同一套 `agents`/`agent_versions`/`capability_listings` 写法），
 * 区别只在于：① `agents` 的 7 个角色列显式写成 pack 条目里的 `role.*`（`catalog_source` 恒
 * `'official'`），不是留给 DB 默认值（那是普通 org 包的路径）；② skillVersions 解析失败的
 * 失败码是 `UNRESOLVED_SKILL_REF`（UC-3 E2），不是 `AGENT_STARTER_SKILL_VERSION_MISSING/MISMATCH`
 * （UC-2 的码，两条导入路径共享同一个校验动作、不共享失败码，因为调用方要能分辨是哪条使用例）。
 */
interface ImportRow { status: "pending" | "succeeded" | "failed"; payload_digest: string; result_json: AgentStarterImportResult | null; failure_code: string | null; }
async function findImport(s: TenantSession, orgId: string, key: string): Promise<ImportRow | null> {
  const result = await s.query<ImportRow>("SELECT status,payload_digest,result_json,failure_code FROM agent_starter_pack_imports WHERE org_id=$1 AND idempotency_key=$2", [orgId, key]);
  return result.rows[0] ?? null;
}
function existing(row: ImportRow, digest: string): Exclude<ExistingAgentImportOutcome, { kind: "missing" }> {
  if (row.payload_digest !== digest) return { kind: "idempotency-conflict" };
  if (row.status === "succeeded" && row.result_json) return { kind: "replayed", result: row.result_json };
  return { kind: "previous-failure", failureCode: row.failure_code ?? "AGENT_STARTER_PACK_INVALID" };
}

export class PgOfficialAgentRolePackImportRepository implements OfficialAgentRolePackImportRepository {
  constructor(private readonly db: DatabasePort) {}

  findExisting(input: Parameters<OfficialAgentRolePackImportRepository["findExisting"]>[0]) {
    return this.db.withTenant(input.orgId, async (s): Promise<ExistingAgentImportOutcome> => {
      const row = await findImport(s, input.orgId, input.idempotencyKey);
      return row ? existing(row, input.payloadDigest) : { kind: "missing" };
    });
  }

  persistVerified(input: Parameters<OfficialAgentRolePackImportRepository["persistVerified"]>[0]) {
    return this.db.withTenant(input.orgId, async (s): Promise<PersistVerifiedOfficialAgentRolePackOutcome> => {
      await s.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 418))", [input.orgId]);
      const prior = await findImport(s, input.orgId, input.idempotencyKey);
      if (prior) return existing(prior, input.payloadDigest);
      const importId = `agent-import-${randomUUID()}`;
      const importedAt = new Date().toISOString();
      await s.query(`INSERT INTO agent_starter_pack_imports (id,org_id,pack_id,pack_version,pack_digest,payload_digest,idempotency_key,administrator_id,imported_at,status,result_json,failure_code) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'pending',NULL,NULL)`, [importId, input.orgId, input.pack.packId, input.pack.packVersion, input.pack.packDigest, input.payloadDigest, input.idempotencyKey, input.actorId, importedAt]);

      // UC-3 E2 后半：挂载的 skillVersions 必须在本组织已发布目录里且摘要一致，否则
      // UNRESOLVED_SKILL_REF，事务回滚、DB 无新增行（下面的 INSERT 都还没跑）。
      const refs = input.pack.agents.flatMap((agent) => agent.skillVersions);
      if (refs.length) {
        const found = await s.query<{ id: string; content_digest: string }>("SELECT id,content_digest FROM skill_versions WHERE org_id=$1 AND id=ANY($2::text[]) AND published=true", [input.orgId, refs.map((ref) => ref.versionId)]);
        const byId = new Map(found.rows.map((row) => [row.id, row.content_digest]));
        const missingIds = refs.filter((ref) => byId.get(ref.versionId) !== ref.digest).map((ref) => ref.versionId);
        if (missingIds.length > 0) {
          await s.query("UPDATE agent_starter_pack_imports SET status='failed',failure_code='UNRESOLVED_SKILL_REF' WHERE id=$1 AND org_id=$2", [importId, input.orgId]);
          return { kind: "skill-unresolved", missingIds: [...new Set(missingIds)] };
        }
      }

      const stableNames = input.pack.agents.map((agent) => agent.stableName);
      const names = input.pack.agents.map((agent) => agent.name.toLocaleLowerCase());
      const conflicts = await s.query<{ present: boolean }>(`SELECT EXISTS (SELECT 1 FROM agents WHERE org_id=$1 AND (stable_name=ANY($2::text[]) OR lower(name)=ANY($3::text[])) UNION ALL SELECT 1 FROM capability_listings WHERE org_id=$1 AND kind='agent' AND lower(name)=ANY($3::text[])) AS present`, [input.orgId, stableNames, names]);
      if (conflicts.rows[0]?.present) {
        await s.query("UPDATE agent_starter_pack_imports SET status='failed',failure_code='AGENT_STARTER_PACK_CONFLICT' WHERE id=$1 AND org_id=$2", [importId, input.orgId]);
        return { kind: "name-conflict" };
      }

      const agentIds: string[] = []; const versionIds: string[] = [];
      for (const agent of input.pack.agents) {
        const agentId = `agent-${randomUUID()}`; const versionId = `agent-version-${randomUUID()}`;
        agentIds.push(agentId); versionIds.push(versionId);
        await s.query(
          `INSERT INTO agents (
             id,org_id,stable_name,name,status,creator_id,created_at,updated_at,published_version_id,
             role_label,role_label_needs_confirmation,
             avatar,role_category,catalog_source,workflow_allowlist,delegation_policy,escalation_policy,kpi
           ) VALUES ($1,$2,$3,$4,'enabled',$5,$6,$6,NULL,$7,false,$8::jsonb,$9,'official',$10::text[],$11::jsonb,$12::jsonb,$13::jsonb)`,
          [
            agentId, input.orgId, agent.stableName, agent.name, input.actorId, importedAt,
            agent.roleLabel,
            agent.role.avatar === null ? null : JSON.stringify(agent.role.avatar),
            agent.role.roleCategory,
            [...agent.role.workflowAllowlist],
            JSON.stringify(agent.role.delegationPolicy),
            JSON.stringify(agent.role.escalationPolicy),
            JSON.stringify(agent.role.kpi),
          ],
        );
        await insertAgentVersionFromDraft(s, { versionId, orgId: input.orgId, agentId, semanticLabel: agent.semanticVersion, instructionDigest: agent.instructionDigest, instructions: agent.instructions, skillVersionIds: agent.skillVersions.map((ref) => ref.versionId), modelProvider: agent.modelProvider, modelId: agent.modelId, toolPolicy: agent.toolPolicy, creatorId: input.actorId, at: importedAt });
        await s.query("UPDATE agents SET published_version_id=$3,updated_at=$4 WHERE id=$1 AND org_id=$2", [agentId, input.orgId, versionId, importedAt]);
        // toolPolicy 中的分类不产生任何授权（ADR-120 #2，I-6）：这里只写目录行，不触碰任何
        // 授权/凭证表——与普通 starter-pack 导入完全同一条纪律。
        await s.query("INSERT INTO capability_listings (id,org_id,kind,name,scope,owner_team_id,enabled,endpoint,abbr,duty,role_label,role_label_needs_confirmation) VALUES ($1,$2,'agent',$3,'org-wide',NULL,true,NULL,$4,$5,$6,false)", [agentId, input.orgId, agent.name, agent.roleRef, agent.roleLabel, agent.roleLabel]);
      }
      const result: AgentStarterImportResult = { importId, packId: input.pack.packId, packVersion: input.pack.packVersion, packDigest: input.pack.packDigest, status: "succeeded", agentIds, versionIds, importedAt };
      await s.query("UPDATE agent_starter_pack_imports SET status='succeeded',result_json=$3::jsonb,failure_code=NULL WHERE id=$1 AND org_id=$2", [importId, input.orgId, JSON.stringify(result)]);
      return { kind: "created", result };
    });
  }

  recordFailure(input: Parameters<OfficialAgentRolePackImportRepository["recordFailure"]>[0]) {
    return this.db.withTenant(input.orgId, async (s) => {
      await s.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 418))", [input.orgId]);
      const prior = await findImport(s, input.orgId, input.idempotencyKey);
      if (prior) return existing(prior, input.payloadDigest);
      await s.query(`INSERT INTO agent_starter_pack_imports (id,org_id,pack_id,pack_version,pack_digest,payload_digest,idempotency_key,administrator_id,imported_at,status,result_json,failure_code) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'failed',NULL,$10)`, [`agent-import-${randomUUID()}`, input.orgId, input.packId, input.packVersion, input.packDigest, input.payloadDigest, input.idempotencyKey, input.actorId, new Date().toISOString(), input.failureCode]);
      return { kind: "previous-failure" as const, failureCode: input.failureCode };
    });
  }
}
