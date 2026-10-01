/**
 * AG07 —— `AgentHandoffStore` 的 Postgres 实现（契约束 agent-role UC-7；迁移 `20260930120000_ag07_agent_handoffs.sql`）。
 *
 * 全部在调用方租户内（`withTenant`），从不跳出租户边界。两类调用方：
 *   - 网关（系统路径，没有人类 principal）：读 run 钉住的 `delegation_policy`、解析目标角色、登记 `requested`；
 *   - 发起人（HTTP）：每一条读 / 写都带 `requester_user_id = 调用者` —— 别人的转交对你不存在
 *     （`HANDOFF_NOT_FOUND`，不泄露存在性）。豁免条件见 `scripts/lint-permission-paths.mjs` 对应条目，
 *     由 tests/agent/handoff-delegation.test.ts 钉住。
 */
import { randomUUID } from "node:crypto";
import type { DatabasePort, TenantSession } from "../../application/ports/database.port";
import type {
  AgentHandoffStore, HandoffPacketT, HandoffRecord, HandoffStatusT, RunHandoffContext,
} from "../../application/agent/agent-handoff";
import type { HandoffNotAllowedReason, HandoffTargetFact } from "../../domain/agent/handoff-policy";
import type { OrgId } from "../../domain/org-id";

interface Row {
  id: string; source_run_id: string; source_thread_id: string; source_agent_id: string; requester_user_id: string;
  target_role: string; target_agent_id: string | null; target_name: string | null; status: HandoffStatusT;
  packet: HandoffPacketT; depth: number; not_allowed_reason: HandoffNotAllowedReason | null;
  new_thread_id: string | null; created_at: Date | string;
}

const COLS = `id, source_run_id, source_thread_id, source_agent_id, requester_user_id, target_role, target_agent_id,
  target_name, status, packet, depth, not_allowed_reason, new_thread_id, created_at`;

function toRecord(r: Row): HandoffRecord {
  return {
    handoffId: r.id, sourceRunId: r.source_run_id, sourceThreadId: r.source_thread_id, sourceAgentId: r.source_agent_id,
    requesterUserId: r.requester_user_id, targetRole: r.target_role, targetAgentId: r.target_agent_id,
    targetName: r.target_name, status: r.status, packet: r.packet, depth: Number(r.depth),
    notAllowedReason: r.not_allowed_reason, newThreadId: r.new_thread_id,
    createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
  };
}

async function one(s: TenantSession, sql: string, params: unknown[]): Promise<HandoffRecord | null> {
  const { rows } = await s.query<Row>(sql, params);
  return rows[0] ? toRecord(rows[0]) : null;
}

export class PgAgentHandoffStore implements AgentHandoffStore {
  constructor(private readonly db: DatabasePort) {}

  readRunHandoffContext(orgId: OrgId, runId: string): Promise<RunHandoffContext | null> {
    return this.db.withTenant(orgId, async (s) => {
      const { rows } = await s.query<{ agent_id: string; agent_version_id: string; thread_id: string; author_id: string | null; delegation_policy: unknown }>(
        `SELECT r.agent_id, r.agent_version_id, r.thread_id, m.author_id, v.delegation_policy
           FROM agent_runs r
           JOIN agent_versions v ON v.id = r.agent_version_id AND v.org_id = r.org_id AND v.agent_id = r.agent_id
           LEFT JOIN chat_messages m ON m.id = r.input_message_id AND m.org_id = r.org_id
                AND m.author_kind = 'human' AND m.thread_id = r.thread_id
          WHERE r.org_id = $1 AND r.id = $2`,
        [orgId, runId],
      );
      const row = rows[0];
      if (!row) return null;
      return {
        agentId: row.agent_id, agentVersionId: row.agent_version_id, threadId: row.thread_id,
        requesterUserId: row.author_id ?? null, delegationPolicy: row.delegation_policy ?? null,
      };
    });
  }

  sourceThreadDepth(orgId: OrgId, threadId: string): Promise<number> {
    return this.db.withTenant(orgId, async (s) => {
      const { rows } = await s.query<{ depth: number }>(
        "SELECT depth FROM agent_handoffs WHERE org_id = $1 AND new_thread_id = $2 AND status = 'confirmed'",
        [orgId, threadId],
      );
      return rows[0] ? Number(rows[0].depth) : 0;
    });
  }

  resolveTarget(orgId: OrgId, targetRole: string): Promise<(HandoffTargetFact & { readonly name: string }) | null> {
    return this.db.withTenant(orgId, async (s) => {
      // 角色编号落在该 Agent 的目录行 `capability_listings.abbr`（官方角色包导入时写入）。
      // 同一角色若有多个 Agent，优先「已发布且启用」的那个，其次最早创建的。
      const { rows } = await s.query<{ id: string; name: string; status: string; published_version_id: string | null; enabled: boolean }>(
        `SELECT a.id, a.name, a.status, a.published_version_id, l.enabled
           FROM capability_listings l
           JOIN agents a ON a.id = l.id AND a.org_id = l.org_id
          WHERE l.org_id = $1 AND l.kind = 'agent' AND l.abbr = $2
          ORDER BY (a.published_version_id IS NOT NULL AND a.status = 'enabled' AND l.enabled) DESC,
                   a.created_at, a.id
          LIMIT 1`,
        [orgId, targetRole],
      );
      const row = rows[0];
      if (!row) return null;
      return {
        agentId: row.id, name: row.name, published: row.published_version_id !== null,
        enabled: row.status === "enabled" && row.enabled,
      };
    });
  }

  insertRequested(orgId: OrgId, row: Parameters<AgentHandoffStore["insertRequested"]>[1]): Promise<HandoffRecord> {
    return this.db.withTenant(orgId, async (s) => {
      const inserted = await one(s,
        `INSERT INTO agent_handoffs
           (id, org_id, source_run_id, tool_call_id, source_thread_id, source_agent_id, source_agent_version_id,
            requester_user_id, target_role, target_agent_id, target_name, packet, depth)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13)
         ON CONFLICT (org_id, source_run_id, tool_call_id) DO NOTHING
         RETURNING ${COLS}`,
        [
          `handoff-${randomUUID()}`, orgId, row.sourceRunId, row.toolCallId, row.sourceThreadId, row.sourceAgentId,
          row.sourceAgentVersionId, row.requesterUserId, row.targetRole, row.targetAgentId, row.targetName,
          JSON.stringify(row.packet), row.depth,
        ],
      );
      if (inserted) return inserted;
      const existing = await one(s,
        `SELECT ${COLS} FROM agent_handoffs WHERE org_id = $1 AND source_run_id = $2 AND tool_call_id = $3`,
        [orgId, row.sourceRunId, row.toolCallId],
      );
      if (!existing) throw new Error("agent_handoff_insert_lost");
      return existing;
    });
  }

  findForRequester(orgId: OrgId, handoffId: string, userId: string): Promise<HandoffRecord | null> {
    return this.db.withTenant(orgId, (s) => one(s,
      `SELECT ${COLS} FROM agent_handoffs WHERE org_id = $1 AND id = $2 AND requester_user_id = $3`,
      [orgId, handoffId, userId],
    ));
  }

  confirm(orgId: OrgId, input: Parameters<AgentHandoffStore["confirm"]>[1]): Promise<HandoffRecord | null> {
    return this.db.withTenant(orgId, async (s) => {
      const threadId = `thr-${randomUUID()}`;
      const updated = await one(s,
        `UPDATE agent_handoffs
            SET status = 'confirmed', new_thread_id = $4, target_agent_id = $5, decided_at = now()
          WHERE org_id = $1 AND id = $2 AND requester_user_id = $3 AND status = 'requested'
          RETURNING ${COLS}`,
        [orgId, input.handoffId, input.userId, threadId, input.targetAgentId],
      );
      if (!updated) return null;
      // 接收方新线程：发起人的私有个人线程（同 `createPersonalThread` 的列取值；标题由发起时起好）。
      await s.query(
        `INSERT INTO chat_threads (id, org_id, project_id, group_id, visibility_scope, title, created_by, title_source)
         VALUES ($1, $2, NULL, NULL, 'private', $3, $4, 'user')`,
        [threadId, orgId, input.threadTitle, input.userId],
      );
      return updated;
    });
  }

  reject(orgId: OrgId, handoffId: string, userId: string, reason: HandoffNotAllowedReason): Promise<HandoffRecord | null> {
    return this.db.withTenant(orgId, (s) => one(s,
      `UPDATE agent_handoffs SET status = 'rejected', not_allowed_reason = $4, decided_at = now()
        WHERE org_id = $1 AND id = $2 AND requester_user_id = $3 AND status = 'requested'
        RETURNING ${COLS}`,
      [orgId, handoffId, userId, reason],
    ));
  }

  cancel(orgId: OrgId, handoffId: string, userId: string): Promise<HandoffRecord | null> {
    return this.db.withTenant(orgId, (s) => one(s,
      `UPDATE agent_handoffs SET status = 'cancelled', decided_at = now()
        WHERE org_id = $1 AND id = $2 AND requester_user_id = $3 AND status = 'requested'
        RETURNING ${COLS}`,
      [orgId, handoffId, userId],
    ));
  }

  listBySourceThread(orgId: OrgId, threadId: string, userId: string): Promise<readonly HandoffRecord[]> {
    return this.db.withTenant(orgId, async (s) => {
      const { rows } = await s.query<Row>(
        `SELECT ${COLS} FROM agent_handoffs
          WHERE org_id = $1 AND source_thread_id = $2 AND requester_user_id = $3
          ORDER BY created_at, id`,
        [orgId, threadId, userId],
      );
      return rows.map(toRecord);
    });
  }

  findByNewThread(orgId: OrgId, threadId: string, userId: string): Promise<HandoffRecord | null> {
    return this.db.withTenant(orgId, (s) => one(s,
      `SELECT ${COLS} FROM agent_handoffs WHERE org_id = $1 AND new_thread_id = $2 AND requester_user_id = $3`,
      [orgId, threadId, userId],
    ));
  }
}
