/**
 * 人类反馈（2026-08-17）：skill 试跑在 devapp 上报 `MODEL_UNAVAILABLE`——不是代码 bug，
 * 是这条部署没配 `KERNEL_SKILL_TRIALRUN_MODEL_ID`（一个专门为试跑新开的环境变量，
 * 见 `trial-run-skill.ts` 头注）。三个改进方案里选的是「自愈式回退」：与其要求每一个
 * 部署环境都单独配一个新变量，不如复用这个组织**已经证明能打通**的模型——它的 chat
 * 已经在用某个已发布 agent 的 `model_provider`/`model_id` 真的在跑，试跑没有理由
 * 需要一个独立的、可能忘记配的第二份配置。
 *
 * ## 为什么不直接查 `PgPublishedAgentReader`
 *
 * 那个类要一个具体 `agentId`；试跑发生在 skill 编辑器上，压根不知道该用哪个 agent——
 * 这里要的是"这个组织**随便哪个**已发布 agent 的模型"，是一条新的、更宽的查询，
 * 不是收窄参数就能复用的同一条。
 *
 * ## 为什么选"最近发布的那个"而不是"第一个"
 *
 * 组织可能同时有历史遗留的、模型早就下线的旧 agent。最近发布的那个最可能是
 * 目前实际还在被使用、模型配置仍然有效的那个——这是一个启发式，不是保证，
 * 所以 `KERNEL_SKILL_TRIALRUN_MODEL_ID`/诚实报 `MODEL_UNAVAILABLE` 仍然是兜底路径，
 * 不是被这条回退取代。
 */
import type { DatabasePort } from "../../application/ports/database.port";
import { toOrgId } from "../../domain/org-id";
import type { OrgAgentModel, OrgAgentModelReader } from "../../application/skill/trial-run-skill";

interface Row {
  readonly model_provider: string;
  readonly model_id: string;
}

export class PgOrgAgentModelReader implements OrgAgentModelReader {
  constructor(private readonly db: DatabasePort) {}

  async findAnyPublished(orgId: string): Promise<OrgAgentModel | null> {
    return this.db.withTenant(toOrgId(orgId), async (session) => {
      const result = await session.query<Row>(
        `SELECT v.model_provider, v.model_id
           FROM agents a JOIN agent_versions v
             ON v.id = a.published_version_id AND v.agent_id = a.id AND v.org_id = a.org_id
          WHERE a.org_id = $1 AND a.status = 'enabled' AND v.published_at IS NOT NULL
          ORDER BY v.published_at DESC
          LIMIT 1`,
        [orgId],
      );
      const row = result.rows[0];
      if (row === undefined) return null;
      return { provider: row.model_provider, modelId: row.model_id };
    });
  }
}
