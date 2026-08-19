/**
 * `SkillTrialRunStore` 的 Postgres 实现（F962 §6.1）。
 *
 * 表见 `migrations/20260819120000_f962_skill_trial_runs_async.sql`（其头注解释了
 * 为什么是新表而不是复用 `agent_runs`）。
 *
 * 纪律照抄 `pg-canvas-instance-repository.ts`：每条查询都在
 * `db.withTenant(orgId, …)` 里（一次调用 = 一个事务，RLS 是执行层，
 * `WHERE org_id = $1` 是第二道防线），不做 check-then-act。
 */
import type { DatabasePort } from "../../application/ports/database.port";
import type { OrgId } from "../../domain/org-id";
import type {
  ClaimedTrialRun,
  SkillTrialRunStore,
  TrialRunArtifactRef,
  TrialRunFailureCode,
  TrialRunRow,
  TrialRunStatus,
} from "../../application/skill/trial-run-async-ports";

interface ClaimRow {
  readonly id: string;
  readonly actor_id: string;
  readonly version_id: string;
  readonly sample_input: string;
}

interface ReadRow extends ClaimRow {
  readonly status: string;
  readonly output: string | null;
  readonly duration_ms: number | null;
  readonly tokens: number | null;
  readonly artifacts: unknown;
  readonly failure_code: string | null;
  readonly failure_stderr: string | null;
  readonly attempts: number;
}

export class PgSkillTrialRunStore implements SkillTrialRunStore {
  constructor(private readonly db: DatabasePort) {}

  async enqueue(input: {
    readonly orgId: OrgId;
    readonly id: string;
    readonly actorId: string;
    readonly versionId: string;
    readonly sampleInput: string;
  }): Promise<void> {
    await this.db.withTenant(input.orgId, async (s) => {
      await s.query(
        `INSERT INTO skill_trial_runs (id, org_id, actor_id, version_id, sample_input, status)
         VALUES ($1, $2, $3, $4, $5, 'queued')`,
        [input.id, input.orgId, input.actorId, input.versionId, input.sampleInput],
      );
    });
  }

  /**
   * `FOR UPDATE SKIP LOCKED` 认领 —— 与 `PgAgentRunRepository.claimQueued` 同形。
   * 多个进程/多次 kick 并发时互不抢同一行，也不会因为一行被锁住而整批阻塞。
   */
  claimQueued(orgId: OrgId, limit: number): Promise<readonly ClaimedTrialRun[]> {
    return this.db.withTenant(orgId, async (s) => {
      const claimed = await s.query<ClaimRow>(
        `UPDATE skill_trial_runs r
            SET status = 'running', started_at = now()
          WHERE r.org_id = $1
            AND r.id IN (
              SELECT id FROM skill_trial_runs
               WHERE org_id = $1 AND status = 'queued'
               ORDER BY created_at, id
               LIMIT $2
               FOR UPDATE SKIP LOCKED
            )
        RETURNING r.id, r.actor_id, r.version_id, r.sample_input`,
        [orgId, limit],
      );
      return claimed.rows.map((r) => ({
        id: r.id,
        actorId: r.actor_id,
        versionId: r.version_id,
        sampleInput: r.sample_input,
      }));
    });
  }

  async succeed(input: {
    readonly orgId: OrgId;
    readonly id: string;
    readonly output: string;
    readonly durationMs: number;
    readonly tokens: number;
    readonly artifacts: readonly TrialRunArtifactRef[];
    readonly attempts: number;
  }): Promise<void> {
    await this.db.withTenant(input.orgId, async (s) => {
      await s.query(
        `UPDATE skill_trial_runs
            SET status = 'succeeded', output = $3, duration_ms = $4, tokens = $5,
                artifacts = $6::jsonb, attempts = $7, finished_at = now()
          WHERE org_id = $1 AND id = $2 AND status = 'running'`,
        [
          input.orgId,
          input.id,
          input.output,
          input.durationMs,
          input.tokens,
          JSON.stringify(input.artifacts),
          input.attempts,
        ],
      );
    });
  }

  async fail(input: {
    readonly orgId: OrgId;
    readonly id: string;
    readonly code: TrialRunFailureCode;
    readonly stderr: string;
    readonly attempts: number;
  }): Promise<void> {
    await this.db.withTenant(input.orgId, async (s) => {
      await s.query(
        `UPDATE skill_trial_runs
            SET status = 'failed', failure_code = $3, failure_stderr = $4,
                attempts = $5, finished_at = now()
          WHERE org_id = $1 AND id = $2 AND status = 'running'`,
        [input.orgId, input.id, input.code, input.stderr, input.attempts],
      );
    });
  }

  /**
   * ⚠ `actor_id = $3` 是**授权条件**，不是过滤器的一部分：读不到就是读不到，
   *   调用方翻成裸 404。别把它挪到应用层做「先读出来再判断是不是自己的」——
   *   那会让一次越权读真的把行读进内存。
   */
  findForActor(input: {
    readonly orgId: OrgId;
    readonly actorId: string;
    readonly id: string;
  }): Promise<TrialRunRow | null> {
    return this.db.withTenant(input.orgId, async (s) => {
      const result = await s.query<ReadRow>(
        `SELECT id, actor_id, version_id, sample_input, status, output, duration_ms,
                tokens, artifacts, failure_code, failure_stderr, attempts
           FROM skill_trial_runs
          WHERE org_id = $1 AND id = $2 AND actor_id = $3`,
        [input.orgId, input.id, input.actorId],
      );
      const row = result.rows[0];
      if (row === undefined) return null;
      return {
        id: row.id,
        actorId: row.actor_id,
        versionId: row.version_id,
        sampleInput: row.sample_input,
        status: row.status as TrialRunStatus,
        output: row.output,
        durationMs: row.duration_ms,
        tokens: row.tokens,
        artifacts: Array.isArray(row.artifacts) ? (row.artifacts as TrialRunArtifactRef[]) : [],
        failureCode: row.failure_code as TrialRunFailureCode | null,
        failureStderr: row.failure_stderr,
        attempts: row.attempts,
      };
    });
  }
}
