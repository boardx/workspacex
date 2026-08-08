/**
 * PostgreSQL implementation of the #414 run store.
 *
 * ## The claim is the exactly-once guarantee
 *
 * `claimQueued` is one `withTenant` call, i.e. one transaction, containing
 * `SELECT ... FOR UPDATE SKIP LOCKED` and the `queued -> running` UPDATE. Two executors
 * racing the same run cannot both leave `queued`, so the one model call cannot be made
 * twice. Same shape, same reason, as `pg-ingestion-repository`'s `claimNext`.
 *
 * ## There is deliberately no cross-tenant claim
 *
 * `agent_runs` has RLS FORCEd, and a query with no tenant context does not error -- it
 * sees zero rows, which reads as "nothing to do" forever. A process serving many orgs
 * calls `claimQueued` once per org, exactly as `pg-ingestion-repository`'s header says.
 *
 * ## `resultMessageId` is PROJECTED, never stored twice
 *
 * The durable run/assistant-message link is `chat_messages.agent_run_id` with its unique
 * index (#415's migration). This file reads it through a LEFT JOIN. A `result_message_id`
 * column on `agent_runs` would be a second copy of one fact, and this repository has drifted
 * that way five times before.
 */
import { randomUUID } from "node:crypto";
import type { DatabasePort } from "../../application/ports/database.port";
import type { OrgId } from "../../domain/org-id";
import { guard, type Guarded } from "../../application/security/permission-filter";
import type {
  AgentRunStore, AppendedRunDelta, AppendedRunStep, ClaimOutcome, PendingWriteback,
  PinnedSkillContent, RunDelta, RunFailureCode, RunLifecycleStatus, RunLocator, RunProjection,
} from "../../application/agent-run/ports";

interface ClaimRow {
  id: string; thread_id: string; project_id: string; input_message_id: string;
  input_text: string; agent_id: string; agent_version_id: string; instructions: string;
  skill_version_ids: unknown; model_provider: string; model_id: string;
}

interface RunRow {
  id: string; thread_id: string; project_id: string; input_message_id: string;
  agent_id: string; agent_version_id: string; skill_version_ids: unknown;
  model_provider: string; model_id: string; status: string; error_code: string | null;
  result_message_id: string | null; created_at: Date;
}

interface StepRow {
  kind: string; status: string; started_at: Date; ended_at: Date;
  input_digest: string | null; output_digest: string | null; failure_code: string | null;
}

interface ClaimDetailRow {
  id: string; project_id: string; input_text: string; instructions: string;
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string");
}

export class PgAgentRunRepository implements AgentRunStore {
  constructor(private readonly db: DatabasePort) {}

  claimQueued(orgId: OrgId, limit: number): Promise<readonly ClaimOutcome[]> {
    return this.db.withTenant(orgId, async (s) => {
      const claimed = await s.query<ClaimRow>(
        `UPDATE agent_runs r
            SET status='running', started_at=now()
          WHERE r.org_id=$1
            AND r.id IN (
              SELECT id FROM agent_runs
               WHERE org_id=$1 AND status='queued'
               ORDER BY created_at, id
               LIMIT $2
               FOR UPDATE SKIP LOCKED
            )
        RETURNING r.id, r.thread_id, r.input_message_id, r.agent_id, r.agent_version_id,
                  r.skill_version_ids, r.model_provider, r.model_id`,
        [orgId, limit],
      );
      if (claimed.rows.length === 0) return [];
      // The claim's RETURNING cannot join, so the immutable trimmings (the thread's
      // project, the human text, the pinned version's instructions) are read after it --
      // all three are immutable for the life of the run, so reading them a statement
      // later cannot observe a different value than the claim did.
      const ids = claimed.rows.map((row) => row.id);
      const detail = await s.query<ClaimDetailRow>(
        `SELECT r.id, t.project_id, m.body AS input_text, v.instructions
           FROM agent_runs r
           JOIN chat_threads t ON t.id=r.thread_id AND t.org_id=r.org_id
           JOIN chat_messages m ON m.id=r.input_message_id AND m.org_id=r.org_id
           JOIN agent_versions v ON v.id=r.agent_version_id AND v.org_id=r.org_id
          WHERE r.org_id=$1 AND r.id = ANY($2::text[])`,
        [orgId, ids],
      );
      const byId = new Map(detail.rows.map((row) => [row.id, row]));
      const runs: ClaimOutcome[] = [];
      for (const row of claimed.rows) {
        const extra = byId.get(row.id);
        // A claimed run whose pinned Agent version, thread or input message is no longer
        // readable has nothing to execute. It is REPORTED, not skipped: the claim above
        // already moved it out of `queued`, so skipping would strand it in `running`.
        if (extra === undefined) {
          runs.push({ kind: "unresolvable", runId: row.id });
          continue;
        }
        runs.push({ kind: "executable", run: {
          runId: row.id,
          threadId: row.thread_id,
          projectId: extra.project_id,
          inputMessageId: row.input_message_id,
          inputText: extra.input_text,
          agentId: row.agent_id,
          agentVersionId: row.agent_version_id,
          instructions: extra.instructions,
          skillVersionIds: toStringArray(row.skill_version_ids),
          modelProvider: row.model_provider,
          modelId: row.model_id,
        } });
      }
      return runs;
    });
  }

  readPinnedSkills(
    orgId: OrgId,
    versionIds: readonly string[],
  ): Promise<readonly PinnedSkillContent[]> {
    return this.db.withTenant(orgId, async (s) => {
      if (versionIds.length === 0) return [];
      const result = await s.query<{ version_id: string; content: Buffer }>(
        `SELECT f.version_id, f.content
           FROM skill_version_files f
           JOIN skill_versions v ON v.id=f.version_id AND v.org_id=f.org_id
          WHERE f.org_id=$1 AND f.version_id = ANY($2::text[])
            AND f.path='SKILL.md' AND v.published`,
        [orgId, versionIds],
      );
      const byVersion = new Map(
        result.rows.map((row) => [row.version_id, row.content.toString("utf8")]),
      );
      // In the ORDER THE SNAPSHOT PINNED, and missing entries are omitted rather than
      // substituted -- the caller compares lengths and fails the run.
      return versionIds
        .filter((id) => byVersion.has(id))
        .map((id) => ({ versionId: id, content: byVersion.get(id)! }));
    });
  }

  async appendStep(orgId: OrgId, step: AppendedRunStep): Promise<void> {
    await this.db.withTenant(orgId, async (s) => {
      await s.query(
        `INSERT INTO agent_run_steps
           (id,org_id,run_id,seq,kind,status,started_at,ended_at,
            input_digest,output_digest,failure_code)
         VALUES ($1,$2,$3,$4,$5,$6,$7::timestamptz,$8::timestamptz,$9,$10,$11)`,
        [randomUUID(), orgId, step.runId, step.seq, step.kind, step.status,
          step.startedAt, step.endedAt, step.inputDigest, step.outputDigest, step.failureCode],
      );
    });
  }

  async appendModelDelta(orgId: OrgId, delta: AppendedRunDelta): Promise<void> {
    await this.db.withTenant(orgId, async (s) => {
      await s.query(
        `INSERT INTO agent_run_deltas (id,org_id,run_id,seq,text)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (org_id,run_id,seq) DO NOTHING`,
        [randomUUID(), orgId, delta.runId, delta.seq, delta.text],
      );
    });
  }

  async readModelDeltas(orgId: OrgId, runId: string, afterSeq: number): Promise<readonly RunDelta[]> {
    return this.db.withTenant(orgId, async (s) => {
      const { rows } = await s.query<{ seq: number; text: string; created_at: Date }>(
        `SELECT seq, text, created_at FROM agent_run_deltas
          WHERE org_id=$1 AND run_id=$2 AND seq > $3
          ORDER BY seq ASC`,
        [orgId, runId, afterSeq],
      );
      return rows.map((r) => ({ seq: r.seq, text: r.text, createdAt: r.created_at.toISOString() }));
    });
  }

  async storeOutputAwaitingWriteback(
    orgId: OrgId,
    runId: string,
    output: { readonly text: string },
  ): Promise<void> {
    await this.db.withTenant(orgId, async (s) => {
      await s.query(
        `UPDATE agent_runs SET status='writeback_pending', model_output=$3
          WHERE org_id=$1 AND id=$2 AND status='running'`,
        [orgId, runId, output.text],
      );
    });
  }

  async failRun(orgId: OrgId, runId: string, code: RunFailureCode): Promise<void> {
    await this.db.withTenant(orgId, async (s) => {
      await s.query(
        `UPDATE agent_runs SET status='failed', error_code=$3, ended_at=now()
          WHERE org_id=$1 AND id=$2 AND status NOT IN ('succeeded','failed')`,
        [orgId, runId, code],
      );
    });
  }

  claimWritebackPending(orgId: OrgId, limit: number): Promise<readonly PendingWriteback[]> {
    return this.db.withTenant(orgId, async (s) => {
      // No status change, so this is a SELECT rather than a claiming UPDATE: `succeeded` is
      // not reachable until the message is durable, so there is no intermediate state to
      // move the row into. Two executors picking the same run up is SAFE and tested --
      // `chat_messages_agent_run_idx` decides which one writes the message, and the loser
      // reads the winner's row back. Adding a lock here would be a second mechanism
      // guarding the fact that index already guards.
      const result = await s.query<{
        id: string; thread_id: string; input_message_id: string;
        agent_id: string; model_output: string; writeback_attempts: number;
      }>(
        `SELECT id, thread_id, input_message_id, agent_id, model_output, writeback_attempts
           FROM agent_runs
          WHERE org_id=$1 AND status='writeback_pending' AND model_output IS NOT NULL
          ORDER BY created_at, id
          LIMIT $2`,
        [orgId, limit],
      );
      return result.rows.map((row) => ({
        runId: row.id,
        threadId: row.thread_id,
        inputMessageId: row.input_message_id,
        agentId: row.agent_id,
        text: row.model_output,
        attempts: row.writeback_attempts,
      }));
    });
  }

  commitWriteback(
    orgId: OrgId,
    input: {
      readonly runId: string; readonly threadId: string; readonly inputMessageId: string;
      readonly agentId: string; readonly text: string; readonly startedAt: string;
      readonly endedAt: string; readonly outputDigest: string;
    },
  ): Promise<{ readonly messageId: string }> {
    // ONE transaction: the message, the step and the terminal status commit together or
    // not at all. §6 requires `succeeded` to be unreachable before the message is durable;
    // doing the status update in a second transaction would open a window where a client
    // polling `GET /agent-runs/:runId` is told to stop polling and then finds no reply.
    return this.db.withTenant(orgId, async (s) => {
      const inserted = await s.query<{ id: string }>(
        `INSERT INTO chat_messages
           (id,org_id,thread_id,author_kind,author_id,agent_id,body,
            agent_run_id,reply_to_message_id)
         VALUES ($1,$2,$3,'agent',$4,$4,$5,$6,$7)
         ON CONFLICT DO NOTHING
         RETURNING id`,
        [randomUUID(), orgId, input.threadId, input.agentId, input.text,
          input.runId, input.inputMessageId],
      );
      // Empty RETURNING means the unique index rejected this attempt, i.e. a concurrent or
      // earlier attempt already wrote the reply. §6: "a unique `agentRunId` constraint
      // makes retry return the existing message" -- so read it, never insert a variant.
      const messageId = inserted.rows[0]?.id ?? (await s.query<{ id: string }>(
        `SELECT id FROM chat_messages
          WHERE org_id=$1 AND agent_run_id=$2 AND author_kind='agent'`,
        [orgId, input.runId],
      )).rows[0]!.id;

      // `4 + retry_count` (#519), not a literal 4: the step log is append-only, so a retry's
      // writeback cannot overwrite the exhausted attempt's `failed` step -- with a literal 4
      // the ON CONFLICT below would silently DROP the success and leave a succeeded run whose
      // only writeback step says it failed. Read from the run rather than MAX(seq)+1 so that
      // concurrent attempts within ONE generation still collapse to a single row.
      await s.query(
        `INSERT INTO agent_run_steps
           (id,org_id,run_id,seq,kind,status,started_at,ended_at,input_digest,output_digest)
         VALUES ($1,$2,$3,
                 (SELECT 4 + retry_count FROM agent_runs WHERE org_id=$2 AND id=$3),
                 'chat_writeback','succeeded',$4::timestamptz,$5::timestamptz,
                 $6,$6)
         ON CONFLICT (org_id,run_id,seq) DO NOTHING`,
        [randomUUID(), orgId, input.runId, input.startedAt, input.endedAt,
          input.outputDigest],
      );

      // Guarded on the current status so the loser of a race is a no-op rather than an
      // illegal `succeeded -> succeeded` write against the transition trigger.
      await s.query(
        `UPDATE agent_runs SET status='succeeded', ended_at=now()
          WHERE org_id=$1 AND id=$2 AND status='writeback_pending'`,
        [orgId, input.runId],
      );
      return { messageId };
    });
  }

  async recordWritebackAttempt(orgId: OrgId, runId: string): Promise<number> {
    return this.db.withTenant(orgId, async (s) => {
      const result = await s.query<{ writeback_attempts: number }>(
        `UPDATE agent_runs SET writeback_attempts = writeback_attempts + 1
          WHERE org_id=$1 AND id=$2 AND status='writeback_pending'
        RETURNING writeback_attempts`,
        [orgId, runId],
      );
      return result.rows[0]?.writeback_attempts ?? 0;
    });
  }

  async appendWritebackFailure(
    orgId: OrgId,
    input: { readonly runId: string; readonly startedAt: string; readonly endedAt: string },
  ): Promise<void> {
    await this.db.withTenant(orgId, async (s) => {
      // Same generation-scoped seq as `commitWriteback` (#519), for the same reason: a second
      // exhaustion after a retry is a NEW failed step, not an overwrite of the first.
      await s.query(
        `INSERT INTO agent_run_steps
           (id,org_id,run_id,seq,kind,status,started_at,ended_at,failure_code)
         VALUES ($1,$2,$3,
                 (SELECT 4 + retry_count FROM agent_runs WHERE org_id=$2 AND id=$3),
                 'chat_writeback','failed',$4::timestamptz,$5::timestamptz,
                 'CHAT_WRITEBACK_FAILED')
         ON CONFLICT (org_id,run_id,seq) DO NOTHING`,
        [randomUUID(), orgId, input.runId, input.startedAt, input.endedAt],
      );
    });
  }

  /**
   * #519's reopening, as ONE statement.
   *
   * The `WHERE` is the retryability predicate: only an exhausted CHAT writeback with its
   * stored output still present. `model_output` is left untouched -- the retry writes back
   * the answer the single model call produced, never a new one -- and the transition trigger
   * refuses the move if any of that is violated, so this is not the only line holding it.
   */
  async reopenForWritebackRetry(orgId: OrgId, runId: string): Promise<boolean> {
    return this.db.withTenant(orgId, async (s) => {
      const result = await s.query<{ id: string }>(
        `UPDATE agent_runs
            SET status='writeback_pending', error_code=NULL, writeback_attempts=0,
                retry_count=retry_count+1, ended_at=NULL
          WHERE org_id=$1 AND id=$2 AND status='failed'
            AND error_code='CHAT_WRITEBACK_FAILED' AND model_output IS NOT NULL
        RETURNING id`,
        [orgId, runId],
      );
      return result.rows.length > 0;
    });
  }

  findLocator(orgId: OrgId, runId: string): Promise<RunLocator | null> {
    return this.db.withTenant(orgId, async (s) => {
      const result = await s.query<{ thread_id: string; project_id: string }>(
        `SELECT r.thread_id, t.project_id
           FROM agent_runs r JOIN chat_threads t ON t.id=r.thread_id AND t.org_id=r.org_id
          WHERE r.org_id=$1 AND r.id=$2`,
        [orgId, runId],
      );
      const row = result.rows[0];
      return row ? { threadId: row.thread_id, projectId: row.project_id } : null;
    });
  }

  async readRun(orgId: OrgId, runId: string): Promise<Guarded<RunProjection> | null> {
    const found = await this.db.withTenant(orgId, async (s) => {
      const run = await s.query<RunRow>(
        `SELECT r.id, r.thread_id, t.project_id, r.input_message_id, r.agent_id,
                r.agent_version_id, r.skill_version_ids, r.model_provider, r.model_id,
                r.status, r.error_code, r.created_at, reply.id AS result_message_id
           FROM agent_runs r
           JOIN chat_threads t ON t.id=r.thread_id AND t.org_id=r.org_id
           LEFT JOIN chat_messages reply
             ON reply.agent_run_id=r.id AND reply.org_id=r.org_id AND reply.author_kind='agent'
          WHERE r.org_id=$1 AND r.id=$2`,
        [orgId, runId],
      );
      const row = run.rows[0];
      if (row === undefined) return null;
      const steps = await s.query<StepRow>(
        `SELECT kind,status,started_at,ended_at,input_digest,output_digest,failure_code
           FROM agent_run_steps WHERE org_id=$1 AND run_id=$2 ORDER BY seq, started_at`,
        [orgId, runId],
      );
      return { row, steps: steps.rows };
    });
    if (found === null) return null;
    const projection: RunProjection = {
      runId: found.row.id,
      threadId: found.row.thread_id,
      inputMessageId: found.row.input_message_id,
      agentId: found.row.agent_id,
      agentVersionId: found.row.agent_version_id,
      skillVersionIds: toStringArray(found.row.skill_version_ids),
      modelProvider: found.row.model_provider,
      modelId: found.row.model_id,
      status: found.row.status as RunLifecycleStatus,
      error: found.row.error_code as RunFailureCode | null,
      resultMessageId: found.row.result_message_id,
      steps: found.steps.map((step) => ({
        kind: step.kind as AppendedRunStep["kind"],
        status: step.status as AppendedRunStep["status"],
        startedAt: step.started_at.toISOString(),
        endedAt: step.ended_at.toISOString(),
        inputDigest: step.input_digest,
        outputDigest: step.output_digest,
        failureCode: step.failure_code as RunFailureCode | null,
      })),
      createdAt: found.row.created_at.toISOString(),
    };
    // The thread's project is the object the Chat decision is made against (see
    // `resolve-visibility.ts`), so it is the ref this projection travels under.
    return guard({ kind: "project", id: found.row.project_id }, projection);
  }
}
