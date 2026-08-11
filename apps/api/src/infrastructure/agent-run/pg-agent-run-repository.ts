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
  AgentRunStore, AppendedRunDelta, AppendedRunStep, ClaimOutcome, HistoryAttachmentMeta,
  PendingWriteback, PinnedSkillContent, RunDelta, RunFailureCode, RunLifecycleStatus,
  RunLocator, RunProjection, ThreadHistoryMessage,
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
  tool_name: string | null; tool_args_summary: string | null; tool_result_summary: string | null;
  planning_note: string | null;
}

interface ClaimDetailRow {
  id: string; project_id: string; input_text: string; instructions: string;
  requester_user_id: string;
  input_attachments: unknown;
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string");
}

/**
 * V9-b 前置 A（#970）—— 把 `json_agg(json_build_object('filename',…,'mime',…))` 的结果收成
 * `HistoryAttachmentMeta[]`。SQL 侧已 `COALESCE(..., '[]')`，这里再兜一层脏输入（非数组、
 * 缺字段、非字符串一律丢弃）——附件元数据是「锦上添花」，绝不能因为一条坏行让整次运行失败。
 */
function toAttachmentMeta(value: unknown): HistoryAttachmentMeta[] {
  if (!Array.isArray(value)) return [];
  const out: HistoryAttachmentMeta[] = [];
  for (const v of value) {
    if (v && typeof v === "object"
      && typeof (v as { filename?: unknown }).filename === "string"
      && typeof (v as { mime?: unknown }).mime === "string") {
      const o = v as { filename: string; mime: string; extractionStatus?: unknown; extractedExcerpt?: unknown };
      out.push({
        filename: o.filename,
        mime: o.mime,
        // V9-b(F153)：抽取状态/摘录（旧行/未抽取时 status 恒 'pending'、excerpt 为 null）。
        ...(typeof o.extractionStatus === "string" ? { extractionStatus: o.extractionStatus } : {}),
        ...(typeof o.extractedExcerpt === "string" ? { extractedExcerpt: o.extractedExcerpt } : {}),
      });
    }
  }
  return out;
}

/**
 * V9-b 前置 A（#970）—— 按 `message_id` 聚合该消息的附件元数据成一个 json 数组的 SQL 片段。
 * 单源在这里，claim（触发消息）与 readThreadHistory（历史消息）两处都用它，避免第二份会漂移的
 * 聚合写法。`$msgIdExpr` 传入外层消息 id 的列引用（如 `r.input_message_id` 或 `m.id`）。
 */
function attachmentsAggSql(msgIdExpr: string): string {
  return `COALESCE(
    (SELECT json_agg(json_build_object(
              'filename', a.filename, 'mime', a.mime,
              'extractionStatus', a.extraction_status, 'extractedExcerpt', a.extracted_excerpt)
              ORDER BY a.created_at, a.id)
       FROM chat_message_attachments a
      WHERE a.org_id = $1 AND a.message_id = ${msgIdExpr}),
    '[]'::json)`;
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
        `SELECT r.id, t.project_id, m.body AS input_text, v.instructions,
                m.author_id AS requester_user_id,
                ${attachmentsAggSql("r.input_message_id")} AS input_attachments
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
          inputAttachments: toAttachmentMeta(extra.input_attachments),
          // F159：计量要归属到人，而 `agent_runs` 本身没有「谁触发的」这一列——
          // 触发它的那条人类消息的作者就是那个人，同一次 JOIN 顺手带出来。
          requesterUserId: extra.requester_user_id,
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
      // #725: also read the Skill's `stable_name`/`name` -- the tool identity/description
      // `tool-definitions.ts` builds from a pinned Skill. Same join shape as before, one
      // more table (`skills`) for the two extra columns.
      const result = await s.query<{
        version_id: string; content: Buffer; stable_name: string; name: string;
      }>(
        `SELECT f.version_id, f.content, sk.stable_name, sk.name
           FROM skill_version_files f
           JOIN skill_versions v ON v.id=f.version_id AND v.org_id=f.org_id
           JOIN skills sk ON sk.id=v.skill_id AND sk.org_id=v.org_id
          WHERE f.org_id=$1 AND f.version_id = ANY($2::text[])
            AND f.path='SKILL.md' AND v.published`,
        [orgId, versionIds],
      );
      const byVersion = new Map(
        result.rows.map((row) => [
          row.version_id,
          { content: row.content.toString("utf8"), stableName: row.stable_name, name: row.name },
        ]),
      );
      // In the ORDER THE SNAPSHOT PINNED, and missing entries are omitted rather than
      // substituted -- the caller compares lengths and fails the run.
      return versionIds
        .filter((id) => byVersion.has(id))
        .map((id) => ({ versionId: id, ...byVersion.get(id)! }));
    });
  }

  async appendStep(orgId: OrgId, step: AppendedRunStep): Promise<void> {
    await this.db.withTenant(orgId, async (s) => {
      await s.query(
        `INSERT INTO agent_run_steps
           (id,org_id,run_id,seq,kind,status,started_at,ended_at,
            input_digest,output_digest,failure_code,
            tool_name,tool_args_summary,tool_result_summary,planning_note)
         VALUES ($1,$2,$3,$4,$5,$6,$7::timestamptz,$8::timestamptz,$9,$10,$11,$12,$13,$14,$15)`,
        [randomUUID(), orgId, step.runId, step.seq, step.kind, step.status,
          step.startedAt, step.endedAt, step.inputDigest, step.outputDigest, step.failureCode,
          step.toolName, step.toolArgsSummary, step.toolResultSummary, step.planningNote],
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
    output: { readonly text: string; readonly finalStepSeq: number },
  ): Promise<void> {
    await this.db.withTenant(orgId, async (s) => {
      // #725: `model_called_seq` travels with the run so `commitWriteback`/
      // `appendWritebackFailure` can compute the writeback step's `seq` from the ACTUAL
      // terminal step, not the pre-#725 assumption that it is always `3`.
      await s.query(
        `UPDATE agent_runs SET status='writeback_pending', model_output=$3, model_called_seq=$4
          WHERE org_id=$1 AND id=$2 AND status='running'`,
        [orgId, runId, output.text, output.finalStepSeq],
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

      // `model_called_seq + 1 + retry_count` (#725, generalizing #519's `4 + retry_count`):
      // the step log is append-only, so a retry's writeback cannot overwrite the exhausted
      // attempt's `failed` step -- with a fixed offset the ON CONFLICT below would silently
      // DROP the success and leave a succeeded run whose only writeback step says it
      // failed. `model_called_seq` (default `3`, #725's migration) is what makes this
      // reproduce the exact old `4 + retry_count` numbers for every run whose terminal
      // `model_called` step was never anything but `3` -- only a tool-calling run's larger
      // stored value moves the writeback step's `seq` correspondingly. Still read from the
      // run rather than MAX(seq)+1, for the same reason #519 chose that: concurrent
      // attempts within ONE generation must compute the SAME target seq so they collapse
      // to a single row instead of a live-changing MAX letting two land as different rows.
      await s.query(
        `INSERT INTO agent_run_steps
           (id,org_id,run_id,seq,kind,status,started_at,ended_at,input_digest,output_digest)
         VALUES ($1,$2,$3,
                 (SELECT model_called_seq + 1 + retry_count FROM agent_runs
                   WHERE org_id=$2 AND id=$3),
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
      // Same generation-scoped seq as `commitWriteback` (#519, generalized by #725 -- see
      // that query's own comment), for the same reason: a second exhaustion after a retry
      // is a NEW failed step, not an overwrite of the first.
      await s.query(
        `INSERT INTO agent_run_steps
           (id,org_id,run_id,seq,kind,status,started_at,ended_at,failure_code)
         VALUES ($1,$2,$3,
                 (SELECT model_called_seq + 1 + retry_count FROM agent_runs
                   WHERE org_id=$2 AND id=$3),
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
        `SELECT kind,status,started_at,ended_at,input_digest,output_digest,failure_code,
                tool_name,tool_args_summary,tool_result_summary,planning_note
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
        toolName: step.tool_name,
        toolArgsSummary: step.tool_args_summary,
        toolResultSummary: step.tool_result_summary,
        planningNote: step.planning_note,
      })),
      createdAt: found.row.created_at.toISOString(),
    };
    // The thread's project is the object the Chat decision is made against (see
    // `resolve-visibility.ts`), so it is the ref this projection travels under.
    return guard({ kind: "project", id: found.row.project_id }, projection);
  }

  /**
   * #709 multi-turn context. Row comparison `(created_at, id) < (created_at, id)` on the
   * subquery, not a plain `created_at < $timestamp`: two messages inserted within the same
   * clock tick (real under load, and routine in tests that insert fixtures back to back)
   * would otherwise be ordered arbitrarily by Postgres and could let the CURRENT input
   * message leak into its own history. `id` is a `randomUUID()` insertion-order tiebreaker
   * nowhere else in this file, but it is the same tiebreaker `findMessages`/`claimQueued`'s
   * sibling queries already use (`ORDER BY created_at, id`).
   *
   * The inner `ORDER BY ... DESC LIMIT $4` takes the MOST RECENT `limit` prior messages;
   * the outer re-sort puts that window back into chronological order, which is the shape
   * `execute-run.ts` needs (oldest of the kept window first) without asking Postgres to
   * hand back an entire long-lived thread just to slice it in application code.
   *
   * A `beforeMessageId` that does not resolve (wrong thread, or simply not found) makes the
   * subquery return no row, and `< NULL` is never true in SQL -- the outer query returns
   * zero rows rather than throwing. That is the deliberate "found nothing" contract this
   * method's own doc comment on `AgentRunStore` describes.
   */
  async readThreadHistory(
    orgId: OrgId,
    threadId: string,
    beforeMessageId: string,
    limit: number,
  ): Promise<readonly ThreadHistoryMessage[]> {
    if (limit <= 0) return [];
    return this.db.withTenant(orgId, async (s) => {
      // V9-b 前置 A（#970）：每条历史消息顺带聚合它的附件元数据（filename/mime），让模型
      // 看到历史里「那条消息带了文件」。附件内容不在这里（那是 B/anydoc）。
      const result = await s.query<{ author_kind: string; body: string; attachments: unknown }>(
        `SELECT author_kind, body, attachments FROM (
           SELECT cm.author_kind, cm.body, cm.created_at, cm.id,
                  ${attachmentsAggSql("cm.id")} AS attachments
             FROM chat_messages cm
            WHERE cm.org_id=$1 AND cm.thread_id=$2
              AND (cm.created_at, cm.id) < (
                SELECT created_at, id FROM chat_messages WHERE org_id=$1 AND id=$3
              )
            ORDER BY cm.created_at DESC, cm.id DESC
            LIMIT $4
         ) recent
         ORDER BY created_at ASC, id ASC`,
        [orgId, threadId, beforeMessageId, limit],
      );
      return result.rows
        .map((row): ThreadHistoryMessage | null => {
          const attachments = toAttachmentMeta(row.attachments);
          // 附件字段只在真有附件时挂上（保持「空/缺省 = 没有附件」的读法，也让既有断言不被
          // 一个恒空数组搅动）。
          const withAtt = attachments.length > 0 ? { attachments } : {};
          if (row.author_kind === "human") return { role: "user", content: row.body, ...withAtt };
          if (row.author_kind === "agent") return { role: "assistant", content: row.body, ...withAtt };
          // No third `author_kind` exists in this schema today (see the CHECK on
          // `chat_messages`); skipping rather than throwing keeps a future value from
          // turning "read some history" into "fail the whole run" for an enhancement
          // this run's correctness never depended on.
          return null;
        })
        .filter((m): m is ThreadHistoryMessage => m !== null);
    });
  }
}
