/**
 * `AgentPublishRepository` / `AgentReviewerFunctionPort` 的 PostgreSQL 实现（#660）。
 *
 * 取数只取判定要用的那几列——与 `pg-create-agent-repository.ts` 的 `findForClone`
 * 同一形状（按 `id + org_id` 过滤，跨组织读不到就是 `null`，不区分「不存在」与「不是你的」）。
 */
import type { DatabasePort } from "../../application/ports/database.port";
import { toOrgId } from "../../domain/org-id";
import type {
  AgentPublishRecord,
  AgentPublishRepository,
  AgentPublishStateValue,
  AgentReviewerFunctionPort,
} from "../../application/agent/agent-publish";
import type { ToolWhitelistEntryT } from "../../domain/agent/definition";

interface PublishRow {
  readonly id: string;
  readonly creator_id: string;
  readonly publish_state: string | null;
  readonly model_id: string | null;
  readonly tool_whitelist: unknown;
}

export class PgAgentPublishRepository implements AgentPublishRepository {
  constructor(private readonly db: DatabasePort) {}

  async findForPublish(orgId: string, agentId: string): Promise<AgentPublishRecord | null> {
    return this.db.withTenant(toOrgId(orgId), async (session) => {
      const found = await session.query<PublishRow>(
        `SELECT id, creator_id, publish_state, model_id, tool_whitelist
           FROM agents
          WHERE id = $1 AND org_id = $2`,
        [agentId, orgId],
      );
      const row = found.rows[0];
      if (row === undefined) return null;
      /**
       * `publish_state IS NULL` 的行是**非本状态机创建**的（starter-pack 导入 / 系统预置
       * `ensureSystemAgent` 都不写这一列）。它们不是「草稿」，而是压根不在这套发布流程里——
       * 当作找不到，与 `toDefinition` 对同类行的处理逐字同一条理由：不要把两种不同的东西
       * 混进同一个状态机。
       */
      if (row.publish_state === null) return null;
      return {
        agentId: row.id,
        submitterId: row.creator_id,
        publishState: row.publish_state as AgentPublishStateValue,
        modelId: row.model_id,
        toolWhitelist: (row.tool_whitelist as readonly ToolWhitelistEntryT[]) ?? [],
      };
    });
  }

  async updatePublishState(
    orgId: string,
    agentId: string,
    next: AgentPublishStateValue,
    _actorId: string,
  ): Promise<void> {
    await this.db.withTenant(toOrgId(orgId), async (session) => {
      await session.query(
        "UPDATE agents SET publish_state = $3, updated_at = now() WHERE id = $1 AND org_id = $2",
        [agentId, orgId, next],
      );
    });
  }

  /**
   * agent 侧**没有**安全扫描子系统（只有 skill 有），所以今天恒为 `false`。
   *
   * ⚠ 这是 fail-closed 的**真实回答**（「没有通过的扫描记录」），不是占位：
   *   它让 `批准发布` 稳定地 `SECURITY_SCAN_PENDING`，而不是让一个从未被扫过的 agent 上线。
   *   ⛔ 不要把它改成 `true` 让测试变绿——那会把唯一挡住「未扫描即上线」的东西拆掉。
   *   扫描子系统落地时，改的是这里的取数（查扫描记录表），门控逻辑一行都不用动。
   */
  async securityScanPassed(_orgId: string, _agentId: string): Promise<boolean> {
    return false;
  }
}

export class PgAgentReviewerFunctionPort implements AgentReviewerFunctionPort {
  constructor(private readonly db: DatabasePort) {}

  /**
   * 复用 #552 的 `skill_reviewer_functions`——「谁是方法论审核人」是**组织级的一个事实**，
   * 不是 skill 专有的；理由见 `application/agent/agent-publish.ts` 文件头。
   */
  async functionOf(
    orgId: string,
    principalId: string,
  ): Promise<"methodology-reviewer" | "security-reviewer" | null> {
    return this.db.withTenant(toOrgId(orgId), async (session) => {
      const found = await session.query<{ reviewer_function: string }>(
        `SELECT reviewer_function FROM skill_reviewer_functions
          WHERE org_id = $1 AND principal_id = $2`,
        [orgId, principalId],
      );
      const row = found.rows[0];
      if (row === undefined) return null;
      return row.reviewer_function as "methodology-reviewer" | "security-reviewer";
    });
  }
}
