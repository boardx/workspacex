/**
 * F05 —— `agent_run_attempts` 的 PostgreSQL 适配器。
 *
 * 迁移：`20260905110000_f05_agent_run_attempts.sql`。方法契约见
 * `application/agent-run/run-attempts.ts` 的 `AgentRunAttemptStore` 头注。
 *
 * `messageId` 不在 `agent_run_attempts` 里冗余存储，两个方法都靠 JOIN
 * `agent_runs.input_message_id` 投影出来——同 `pg-agent-run-repository.ts` 头注
 * 「`resultMessageId` 只 PROJECT，不第二次存储」的既有纪律。
 */
import { randomUUID } from "node:crypto";
import { streamingTransport as ST } from "@repo/contracts";
import type { DatabasePort } from "../../application/ports/database.port";
import type { OrgId } from "../../domain/org-id";
import type { AgentRunAttemptStore } from "../../application/agent-run/run-attempts";

interface AttemptRow {
  run_id: string;
  attempt_seq: number;
  resumed_from_checkpoint_id: string | null;
  status: string;
  created_at: Date;
  input_message_id: string;
}

function toAttempt(row: AttemptRow): ST.AgentRunAttempt {
  return {
    runId: row.run_id,
    attemptSeq: row.attempt_seq,
    messageId: row.input_message_id,
    resumedFromCheckpointId: row.resumed_from_checkpoint_id,
    status: row.status as ST.AgentKernelRunStatus,
    createdAt: row.created_at.toISOString(),
  };
}

export class PgAgentRunAttemptRepository implements AgentRunAttemptStore {
  constructor(private readonly db: DatabasePort) {}

  async recordAttempt(
    orgId: OrgId,
    input: {
      readonly runId: string;
      readonly resumedFromCheckpointId: string | null;
      readonly status: ST.AgentKernelRunStatus;
    },
  ): Promise<ST.AgentRunAttempt> {
    return this.db.withTenant(orgId, async (s) => {
      // 同一逻辑 run 的并发续跑请求在这把锁后面串行化，避免两个调用方各自读到同一个
      // `MAX(attempt_seq)` 并算出同一个「下一个」序号（同
      // `pg-chat-message-command-repository.ts` `accept()` 幂等锁的既有先例）。
      await s.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 1))", [input.runId]);
      const result = await s.query<AttemptRow>(
        `INSERT INTO agent_run_attempts
           (id, org_id, run_id, attempt_seq, resumed_from_checkpoint_id, status)
         SELECT $1, $2, $3, COALESCE(MAX(attempt_seq), 0) + 1, $4, $5
           FROM agent_run_attempts WHERE org_id = $2 AND run_id = $3
         RETURNING run_id, attempt_seq, resumed_from_checkpoint_id, status, created_at,
           (SELECT input_message_id FROM agent_runs WHERE org_id = $2 AND id = $3) AS input_message_id`,
        [randomUUID(), orgId, input.runId, input.resumedFromCheckpointId, input.status],
      );
      return toAttempt(result.rows[0]!);
    });
  }

  async listForMessage(orgId: OrgId, messageId: string): Promise<readonly ST.AgentRunAttempt[]> {
    return this.db.withTenant(orgId, async (s) => {
      const result = await s.query<AttemptRow>(
        `SELECT a.run_id, a.attempt_seq, a.resumed_from_checkpoint_id, a.status, a.created_at,
                r.input_message_id
           FROM agent_run_attempts a
           JOIN agent_runs r ON r.id = a.run_id AND r.org_id = a.org_id
          WHERE a.org_id = $1 AND r.input_message_id = $2
          ORDER BY a.attempt_seq ASC`,
        [orgId, messageId],
      );
      return result.rows.map(toAttempt);
    });
  }
}
