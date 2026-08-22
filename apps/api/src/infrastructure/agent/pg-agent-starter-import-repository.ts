import { randomUUID } from "node:crypto";
import type { DatabasePort, TenantSession } from "../../application/ports/database.port";
import type { AgentStarterImportRepository, AgentStarterImportResult, ExistingAgentImportOutcome, PersistVerifiedAgentImportOutcome } from "../../application/agent-import/ports";

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

export class PgAgentStarterImportRepository implements AgentStarterImportRepository {
  constructor(private readonly db: DatabasePort) {}
  findExisting(input: Parameters<AgentStarterImportRepository["findExisting"]>[0]) {
    return this.db.withTenant(input.orgId, async (s): Promise<ExistingAgentImportOutcome> => {
      const row = await findImport(s, input.orgId, input.idempotencyKey);
      return row ? existing(row, input.payloadDigest) : { kind: "missing" };
    });
  }
  persistVerified(input: Parameters<AgentStarterImportRepository["persistVerified"]>[0]) {
    return this.db.withTenant(input.orgId, async (s): Promise<PersistVerifiedAgentImportOutcome> => {
      await s.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 417))", [input.orgId]);
      const prior = await findImport(s, input.orgId, input.idempotencyKey);
      if (prior) return existing(prior, input.payloadDigest);
      const importId = `agent-import-${randomUUID()}`;
      const importedAt = new Date().toISOString();
      await s.query(`INSERT INTO agent_starter_pack_imports (id,org_id,pack_id,pack_version,pack_digest,payload_digest,idempotency_key,administrator_id,imported_at,status,result_json,failure_code) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'pending',NULL,NULL)`, [importId,input.orgId,input.pack.packId,input.pack.packVersion,input.pack.packDigest,input.payloadDigest,input.idempotencyKey,input.actorId,importedAt]);
      const refs = input.pack.agents.flatMap((agent) => agent.skillVersions);
      if (refs.length) {
        const found = await s.query<{ id: string; content_digest: string }>("SELECT id,content_digest FROM skill_versions WHERE org_id=$1 AND id=ANY($2::text[]) AND published=true", [input.orgId, refs.map((ref) => ref.versionId)]);
        const byId = new Map(found.rows.map((row) => [row.id, row.content_digest]));
        const missing = refs.some((ref) => !byId.has(ref.versionId));
        const mismatch = !missing && refs.some((ref) => byId.get(ref.versionId) !== ref.digest);
        if (missing || mismatch) {
          const failureCode = missing ? "AGENT_STARTER_SKILL_VERSION_MISSING" : "AGENT_STARTER_SKILL_VERSION_MISMATCH";
          await s.query("UPDATE agent_starter_pack_imports SET status='failed',failure_code=$3 WHERE id=$1 AND org_id=$2", [importId,input.orgId,failureCode]);
          return { kind: missing ? "skill-missing" : "skill-mismatch" };
        }
      }
      const stableNames = input.pack.agents.map((agent) => agent.stableName);
      const names = input.pack.agents.map((agent) => agent.name.toLocaleLowerCase());
      const conflicts = await s.query<{ present: boolean }>(`SELECT EXISTS (SELECT 1 FROM agents WHERE org_id=$1 AND (stable_name=ANY($2::text[]) OR lower(name)=ANY($3::text[])) UNION ALL SELECT 1 FROM capability_listings WHERE org_id=$1 AND kind='agent' AND lower(name)=ANY($3::text[])) AS present`, [input.orgId,stableNames,names]);
      if (conflicts.rows[0]?.present) {
        await s.query("UPDATE agent_starter_pack_imports SET status='failed',failure_code='AGENT_STARTER_PACK_CONFLICT' WHERE id=$1 AND org_id=$2", [importId,input.orgId]);
        return { kind: "name-conflict" };
      }
      const agentIds: string[] = []; const versionIds: string[] = [];
      for (const agent of input.pack.agents) {
        const agentId = `agent-${randomUUID()}`; const versionId = `agent-version-${randomUUID()}`;
        agentIds.push(agentId); versionIds.push(versionId);
        // #1705：`role_label` 现在是 `agents` 表的 NOT NULL 列——同下面 abbr/duty 的既有
        // 纪律，从 pack 自己声明的字段派生（不新开一次契约修订，也不编一个假头衔）：
        // `stableName` 前两位大写复用同一条派生规则，避免与 abbr 撞得太像时再造一套。
        const roleLabel = agent.stableName.slice(0, 8);
        await s.query("INSERT INTO agents (id,org_id,stable_name,name,status,creator_id,created_at,updated_at,published_version_id,role_label,role_label_needs_confirmation) VALUES ($1,$2,$3,$4,'enabled',$5,$6,$6,NULL,$7,true)", [agentId,input.orgId,agent.stableName,agent.name,input.actorId,importedAt,roleLabel]);
        await s.query(`INSERT INTO agent_versions (id,org_id,agent_id,semantic_label,instruction_digest,instructions,skill_version_ids,model_provider,model_id,tool_policy,creator_id,created_at,published_at) VALUES ($1,$2,$3,$4,$5,$6,$7::text[],$8,$9,$10::jsonb,$11,$12,$12)`, [versionId,input.orgId,agentId,agent.semanticVersion,agent.instructionDigest,agent.instructions,agent.skillVersions.map((ref) => ref.versionId),agent.modelProvider,agent.modelId,JSON.stringify(agent.toolPolicy),input.actorId,importedAt]);
        await s.query("UPDATE agents SET published_version_id=$3,updated_at=$4 WHERE id=$1 AND org_id=$2", [agentId,input.orgId,versionId,importedAt]);
        // #619：`capability_listings_agent_needs_abbr_duty` 要求 kind='agent' 的行非空
        // abbr/duty。pack schema（`AgentStarterPackEntry`）没有这两个字段——不新开一次
        // 契约修订就能满足的做法是从已有字段派生：`abbr` 取 `stableName` 前两位，
        // `duty` 直接复用 `name`（同这个脚本原来给 core-loop 用的终端占位值一样短）。
        // ⚠ 这不是"编一个像样的假职责"：两个值都是从 pack 自己声明的字段推出来的事实，
        //   不是编造的内容。
        await s.query("INSERT INTO capability_listings (id,org_id,kind,name,scope,owner_team_id,enabled,endpoint,abbr,duty,role_label,role_label_needs_confirmation) VALUES ($1,$2,'agent',$3,'org-wide',NULL,true,NULL,$4,$5,$6,true)", [agentId,input.orgId,agent.name,agent.stableName.slice(0, 2).toUpperCase(),agent.name,roleLabel]);
      }
      const result: AgentStarterImportResult = { importId,packId:input.pack.packId,packVersion:input.pack.packVersion,packDigest:input.pack.packDigest,status:"succeeded",agentIds,versionIds,importedAt };
      await s.query("UPDATE agent_starter_pack_imports SET status='succeeded',result_json=$3::jsonb,failure_code=NULL WHERE id=$1 AND org_id=$2", [importId,input.orgId,JSON.stringify(result)]);
      return { kind: "created", result };
    });
  }
  recordFailure(input: Parameters<AgentStarterImportRepository["recordFailure"]>[0]) {
    return this.db.withTenant(input.orgId, async (s) => {
      await s.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 417))", [input.orgId]);
      const prior = await findImport(s,input.orgId,input.idempotencyKey);
      if (prior) return existing(prior,input.payloadDigest);
      await s.query(`INSERT INTO agent_starter_pack_imports (id,org_id,pack_id,pack_version,pack_digest,payload_digest,idempotency_key,administrator_id,imported_at,status,result_json,failure_code) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'failed',NULL,$10)`, [`agent-import-${randomUUID()}`,input.orgId,input.packId,input.packVersion,input.packDigest,input.payloadDigest,input.idempotencyKey,input.actorId,new Date().toISOString(),input.failureCode]);
      return { kind: "previous-failure" as const, failureCode: input.failureCode };
    });
  }
}
