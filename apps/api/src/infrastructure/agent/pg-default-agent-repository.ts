import { createHash, randomUUID } from "node:crypto";
import type { DatabasePort } from "../../application/ports/database.port";
import type { OrgId } from "../../domain/org-id";
import {
  DEFAULT_AGENT_INSTRUCTIONS,
  DEFAULT_AGENT_NAME,
  DEFAULT_AGENT_STABLE_NAME,
  type EnsureDefaultAgentRepository,
  type EnsureDefaultAgentResult,
} from "../../application/agent/ensure-default-agent";
import { readModelProviderConfig } from "../agent-run/configured-model-provider";

const sha256 = (value: string): string => createHash("sha256").update(value).digest("hex");

/**
 * 落库形状照抄 `pg-agent-starter-import-repository.ts` 已验证的"一落地即已发布"路径
 * （见 `ensure-default-agent.ts` 头注）：一行 `agents` + 一行 `agent_versions`
 * （`published_at` 非空）+ `agents.published_version_id` 指过去 + 一行
 * `capability_listings`（`id = agentId`，chat 选择器靠这个 id 相等才能真的选中并发消息）。
 *
 * `model_provider` 读部署态唯一配置的 provider（`KERNEL_MODEL_PROVIDER`，与真正执行一次
 * run 的 `ConfiguredModelProvider` 同一个读法，`readModelProviderConfig`）——run 执行时
 * 严格要求 pin 的 provider 逐字等于这个值（无 fallback，见该文件头注），默认 agent 不能
 * 自己发明一个不会被接受的值。`model_id` 未部署专门的"默认模型"配置项，允许一个可运维
 * 覆盖的 env（`KERNEL_DEFAULT_AGENT_MODEL_ID`），没配就退到一个占位符字符串——这一列本身
 * 就没有外键校验（`agent_versions.model_id` 是自由文本，见 wave2 迁移），provider 才是
 * 真正被执行侧校验的那一半。
 */
export class PgDefaultAgentRepository implements EnsureDefaultAgentRepository {
  constructor(private readonly db: DatabasePort) {}

  async ensure(input: { readonly orgId: string; readonly actorId: string; readonly now: Date }): Promise<EnsureDefaultAgentResult> {
    return this.db.withTenant(input.orgId as OrgId, async (s) => {
      // 组织内串行化：两条注册路径（bootstrap / redeem-invite）都可能触发一次 ensure，
      // advisory lock 保证并发调用不会各自判断"不存在"后都插入一行,撞
      // `agents_stable_name_uniq`。
      await s.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 660))", [input.orgId]);
      const existing = await s.query<{ id: string }>(
        "SELECT id FROM agents WHERE org_id=$1 AND stable_name=$2",
        [input.orgId, DEFAULT_AGENT_STABLE_NAME],
      );
      const found = existing.rows[0];
      if (found) return { agentId: found.id, created: false };

      const agentId = `agent-${randomUUID()}`;
      const versionId = `agent-version-${randomUUID()}`;
      const nowIso = input.now.toISOString();
      const instructions = DEFAULT_AGENT_INSTRUCTIONS;
      const instructionDigest = sha256(instructions);
      const { provider } = readModelProviderConfig();
      const modelId = (process.env.KERNEL_DEFAULT_AGENT_MODEL_ID ?? "").trim() || "default";

      await s.query(
        "INSERT INTO agents (id,org_id,stable_name,name,status,creator_id,created_at,updated_at,published_version_id) VALUES ($1,$2,$3,$4,'enabled',$5,$6,$6,NULL)",
        [agentId, input.orgId, DEFAULT_AGENT_STABLE_NAME, DEFAULT_AGENT_NAME, input.actorId, nowIso],
      );
      await s.query(
        `INSERT INTO agent_versions (id,org_id,agent_id,semantic_label,instruction_digest,instructions,skill_version_ids,model_provider,model_id,tool_policy,creator_id,created_at,published_at)
         VALUES ($1,$2,$3,'v1',$4,$5,'{}'::text[],$6,$7,'[]'::jsonb,$8,$9,$9)`,
        [versionId, input.orgId, agentId, instructionDigest, instructions, provider, modelId, input.actorId, nowIso],
      );
      await s.query(
        "UPDATE agents SET published_version_id=$3, updated_at=$4 WHERE id=$1 AND org_id=$2",
        [agentId, input.orgId, versionId, nowIso],
      );
      await s.query(
        "INSERT INTO capability_listings (id,org_id,kind,name,scope,owner_team_id,enabled,endpoint) VALUES ($1,$2,'agent',$3,'org-wide',NULL,true,NULL)",
        [agentId, input.orgId, DEFAULT_AGENT_NAME],
      );
      return { agentId, created: true };
    });
  }
}
