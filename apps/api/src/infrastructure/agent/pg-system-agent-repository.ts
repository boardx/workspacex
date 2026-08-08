import { createHash, randomUUID } from "node:crypto";
import type { DatabasePort } from "../../application/ports/database.port";
import type { OrgId } from "../../domain/org-id";
import { toOrgId } from "../../domain/org-id";

const sha256 = (value: string): string => createHash("sha256").update(value).digest("hex");

/**
 * 一个"系统预置、一落地即已发布"的 agent 长什么样——`ensureDefaultAgent`（#662）与
 * `ensureDeepResearchAgent`（本次新增）共用同一份落库逻辑，只是模板不同。
 *
 * ⚠ 这不是重构成"更优雅代码"：`ensure-default-agent.ts` 头注写过一次的教训
 * （"同一事实不得声明在两处"）——两个 agent 的落库形状是**同一个事实**（advisory lock
 * 用同一个 key 空间避免撞名、`capability_listings.id = agentId` 这条前端选择器依赖的
 * 关系、"一落地即已发布"而不是走 `createAgent` 的草稿路径），只有内容（名字/说明/
 * provider）不同。第二次实现这套逻辑而不是复用，正是本仓已经踩过五次的漂移形状。
 */
export interface SystemAgentTemplate {
  readonly stableName: string;
  readonly name: string;
  readonly instructions: string;
  /** 幂等锁的 key——必须跟 `stableName` 一一对应且互不相同，否则两个模板会互相排队。 */
  readonly lockKey: number;
  /** 返回这个 agent 应该 pin 的 model_provider/model_id；不同模板可能读不同的 env。 */
  resolveModel(): { readonly provider: string; readonly modelId: string };
}

export interface EnsureSystemAgentResult {
  readonly agentId: string;
  readonly created: boolean;
}

export async function ensureSystemAgent(
  db: DatabasePort,
  template: SystemAgentTemplate,
  input: { readonly orgId: string; readonly actorId: string; readonly now: Date },
): Promise<EnsureSystemAgentResult> {
  return db.withTenant(toOrgId(input.orgId), async (s) => {
    // 组织内串行化：两条注册路径（bootstrap / redeem-invite）都可能触发一次 ensure，
    // advisory lock 保证并发调用不会各自判断"不存在"后都插入一行，撞
    // `agents_stable_name_uniq`。
    await s.query("SELECT pg_advisory_xact_lock(hashtextextended($1, $2))", [input.orgId, template.lockKey]);
    const existing = await s.query<{ id: string }>(
      "SELECT id FROM agents WHERE org_id=$1 AND stable_name=$2",
      [input.orgId, template.stableName],
    );
    const found = existing.rows[0];
    if (found) return { agentId: found.id, created: false };

    const agentId = `agent-${randomUUID()}`;
    const versionId = `agent-version-${randomUUID()}`;
    const nowIso = input.now.toISOString();
    const instructionDigest = sha256(template.instructions);
    const { provider, modelId } = template.resolveModel();

    await s.query(
      "INSERT INTO agents (id,org_id,stable_name,name,status,creator_id,created_at,updated_at,published_version_id) VALUES ($1,$2,$3,$4,'enabled',$5,$6,$6,NULL)",
      [agentId, input.orgId, template.stableName, template.name, input.actorId, nowIso],
    );
    await s.query(
      `INSERT INTO agent_versions (id,org_id,agent_id,semantic_label,instruction_digest,instructions,skill_version_ids,model_provider,model_id,tool_policy,creator_id,created_at,published_at)
       VALUES ($1,$2,$3,'v1',$4,$5,'{}'::text[],$6,$7,'[]'::jsonb,$8,$9,$9)`,
      [versionId, input.orgId, agentId, instructionDigest, template.instructions, provider, modelId, input.actorId, nowIso],
    );
    await s.query(
      "UPDATE agents SET published_version_id=$3, updated_at=$4 WHERE id=$1 AND org_id=$2",
      [agentId, input.orgId, versionId, nowIso],
    );
    await s.query(
      "INSERT INTO capability_listings (id,org_id,kind,name,scope,owner_team_id,enabled,endpoint) VALUES ($1,$2,'agent',$3,'org-wide',NULL,true,NULL)",
      [agentId, input.orgId, template.name],
    );
    return { agentId, created: true };
  });
}

/**
 * 追认修好一个已存在但 `model_provider` 已过期（部署态 env 是后配的，或者干脆改了）
 * 的系统 agent——同 `backfill-default-agents.ts` 的"第二遍：repair"那一段，抽成通用
 * 函数以便 deep-research 的 backfill 复用同一份写路径。发布新版本，不 UPDATE
 * 已存在的 `agent_versions` 行（该表对 app_rw 只 GRANT SELECT,INSERT，见
 * `wave2_agent_starter_import.sql`——版本不可变，靠发布新版本修正）。
 */
export async function republishSystemAgentVersion(
  db: DatabasePort,
  template: Pick<SystemAgentTemplate, "instructions">,
  input: {
    readonly orgId: string;
    readonly agentId: string;
    readonly creatorId: string;
    readonly provider: string;
    readonly modelId: string;
    readonly semanticLabel: string;
    readonly now: Date;
  },
): Promise<void> {
  const versionId = `agent-version-${randomUUID()}`;
  const nowIso = input.now.toISOString();
  const instructionDigest = sha256(template.instructions);
  await db.withTenant(toOrgId(input.orgId), async (s) => {
    await s.query(
      `INSERT INTO agent_versions (id,org_id,agent_id,semantic_label,instruction_digest,instructions,skill_version_ids,model_provider,model_id,tool_policy,creator_id,created_at,published_at)
       VALUES ($1,$2,$3,$4,$5,$6,'{}'::text[],$7,$8,'[]'::jsonb,$9,$10,$10)`,
      [versionId, input.orgId, input.agentId, input.semanticLabel, instructionDigest, template.instructions, input.provider, input.modelId, input.creatorId, nowIso],
    );
    await s.query(
      "UPDATE agents SET published_version_id=$3, updated_at=$4 WHERE id=$1 AND org_id=$2",
      [input.agentId, input.orgId, versionId, nowIso],
    );
  });
}

/** Re-exported so callers don't need a second import just for the type. */
export type { DatabasePort, OrgId };
