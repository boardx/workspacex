/**
 * #1415 —— `agent_url_imports` 的持久化。**只做幂等键去重**，不重复声明 `agents` 表的
 * 写路径——那份 SQL 唯一活在 `pg-create-agent-repository.ts`（`CreateAgentRepository.insert`）
 * 与 `pg-create-agent-repository.ts` 的 `SetAgentInstructionsRepository` 实现里，
 * 本文件不抄第二份（见 `import-agent-from-url.ts` 头注②③）。
 *
 * 与 `pg-skill-url-import-repository.ts` 的差别：那边一次导入落三张表（skill/version/
 * files）需要一把 `pg_advisory_xact_lock` 把整条导入串行化；这里"落库"已经拆成两次
 * 独立调用（建 agent、写指令），本仓储只在最后补记一行"这个幂等键对应哪个 agent"——
 * 记不上（并发撞了同一个幂等键）时如实抛 `IMPORT_IDEMPOTENCY_CONFLICT`，不是悄悄丢弃。
 */
import { randomUUID } from "node:crypto";
import type { DatabasePort } from "../../application/ports/database.port";
import { toOrgId } from "../../domain/org-id";
import type { AgentUrlImportRepository, ImportAgentFromUrlResult } from "../../application/agent-import/import-agent-from-url";

interface ImportRow {
  readonly agent_id: string;
  readonly content_digest: string;
}

interface AgentRow {
  readonly name: string;
  readonly publish_state: string;
  readonly instructions: string | null;
}

export class PgAgentUrlImportRepository implements AgentUrlImportRepository {
  constructor(private readonly db: DatabasePort) {}

  async findByIdempotencyKey(
    input: Parameters<AgentUrlImportRepository["findByIdempotencyKey"]>[0],
  ): Promise<ImportAgentFromUrlResult | null> {
    return this.db.withTenant(toOrgId(input.orgId), async (session) => {
      const found = await session.query<ImportRow>(
        `SELECT agent_id, content_digest
           FROM agent_url_imports
          WHERE org_id = $1 AND idempotency_key = $2`,
        [input.orgId, input.idempotencyKey],
      );
      const row = found.rows[0];
      if (row === undefined) return null;
      const agent = await session.query<AgentRow>(
        `SELECT name, publish_state, instructions FROM agents WHERE org_id = $1 AND id = $2`,
        [input.orgId, row.agent_id],
      );
      const agentRow = agent.rows[0];
      // 幂等记录还在但 agent 行没了（比如被硬删过）——这不是一次可以"回放"的成功，
      // 如实报找不到，让调用方走一条新的导入而不是拿一份对不上号的结果。
      if (agentRow === undefined) return null;
      return {
        agentId: row.agent_id,
        name: agentRow.name,
        publishState: agentRow.publish_state,
        // agent 的 instructions 可能在导入之后被用户又编辑过（这正是"导入完还能编辑"
        // 那扇窗口的意义所在）——回显的是**当前**内容，不是导入那一刻的旧值，
        // 否则重放会让编辑过的内容在界面上"倒退"回导入时的版本。
        instructions: agentRow.instructions ?? "",
        contentDigest: row.content_digest,
        replayed: true,
      };
    });
  }

  async record(input: Parameters<AgentUrlImportRepository["record"]>[0]): Promise<void> {
    await this.db.withTenant(toOrgId(input.orgId), async (session) => {
      await session.query(
        `INSERT INTO agent_url_imports
           (id, org_id, idempotency_key, source_url, content_digest, agent_id, actor_id, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          `aui_${randomUUID()}`,
          input.orgId,
          input.idempotencyKey,
          input.sourceUrl,
          input.contentDigest,
          input.agentId,
          input.actorId,
          new Date().toISOString(),
        ],
      );
    });
  }
}
