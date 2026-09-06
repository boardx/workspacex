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
import { PLATFORM_ORG_ID } from "../../domain/org-id";
import type { OrgId } from "../../domain/org-id";
import { guard, type Guarded } from "../../application/security/permission-filter";
import type {
  AgentRunStore, AppendedRunDelta, AppendedRunStep, ClaimOutcome, HistoryAttachmentMeta,
  PendingWriteback, PinnedSkillContent, RunDelta, RunFailureCode, RunLifecycleStatus, RunOutputFile,
  RunLocator, RunProjection, ThreadContextState, ThreadHistoryMessage,
  TranscriptContentCipher, TranscriptStep,
} from "../../application/agent-run/ports";

interface ClaimRow {
  id: string; thread_id: string; project_id: string; input_message_id: string;
  input_text: string; agent_id: string; agent_version_id: string; instructions: string;
  skill_version_ids: unknown; model_provider: string; model_id: string;
  pending_decision?: string | null;
  pending_tool_name?: string | null;
  pending_edited_args?: string | null;
}

interface RunRow {
  id: string; thread_id: string; project_id: string; input_message_id: string;
  agent_id: string; agent_version_id: string; skill_version_ids: unknown;
  model_provider: string; model_id: string; status: string; error_code: string | null;
  result_message_id: string | null; created_at: Date;
  pending_tool_name?: string | null;
  pending_args_summary?: string | null;
  pending_decision?: string | null;
}

interface StepRow {
  kind: string; status: string; started_at: Date; ended_at: Date;
  input_digest: string | null; output_digest: string | null; failure_code: string | null;
  tool_name: string | null; tool_args_summary: string | null; tool_result_summary: string | null;
  planning_note: string | null;
  /** #742 Gap 1 -- see `AppendedRunStep.toolCallId`'s own doc. */
  tool_call_id: string | null;
}

interface ClaimDetailRow {
  // F155：`chat_threads.project_id` 自 #594 起可空（个人线程），这里跟着改成可空——
  // 驱动本来就会回 `null`，之前只是类型上没承认。见 `ClaimedAgentRun.projectId` 的注释。
  id: string; project_id: string | null; input_text: string; instructions: string;
  requester_user_id: string;
  input_attachments: unknown;
  /** DA-07b resume 续号的唯一事实源——见 `ClaimedAgentRun.resumeStepSeqBase` 的文档。 */
  max_step_seq: number;
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
  /**
   * Phase 14 F15 -- `cipher` is optional and defaults to `null` so every existing call site
   * (`new PgAgentRunRepository(db)`, across `kernel.module.ts` and ~10 test files) keeps
   * compiling and behaving byte-for-byte as before. `null` means "no transcript key
   * configured": `appendStep` then writes no full-content columns (behaves exactly as it did
   * before this feature) and `readRunTranscriptSteps` reports every step as
   * `decryptStatus: "unreadable"` -- see `transcript-content-cipher.ts`'s header for why
   * that degradation is deliberate rather than a startup failure.
   */
  constructor(
    private readonly db: DatabasePort,
    private readonly cipher: TranscriptContentCipher | null = null,
  ) {}

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
                  r.skill_version_ids, r.model_provider, r.model_id, r.pending_decision,
                  r.pending_tool_name, r.pending_edited_args`,
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
                ${attachmentsAggSql("r.input_message_id")} AS input_attachments,
                COALESCE(
                  (SELECT MAX(seq) FROM agent_run_steps WHERE org_id=r.org_id AND run_id=r.id),
                  1
                ) AS max_step_seq
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
          // UX-9 D4：edit 的降级路径也 fail closed——'edit' 行缺 pending_edited_args
          // 只能来自数据损坏（editAndRequeue 单语句同写两列），editedArgsJson 传
          // "null" 让 provider 的对象校验去报 ModelCallError，绝不静默当 approve。
          pendingDecision: row.pending_decision === "approve"
            ? { kind: "approve" as const }
            : row.pending_decision === "edit"
              ? {
                kind: "edit" as const,
                toolName: row.pending_tool_name ?? "unknown",
                editedArgsJson: row.pending_edited_args ?? "null",
              }
              : row.pending_decision === "deny"
                ? { kind: "deny" as const }
                : null,
          // DA-07b resume 续号（本次修复，见 `ClaimedAgentRun.resumeStepSeqBase` 文档）：
          // 只在真的是一次 resume 时才带上——新 run 的 `max_step_seq` 恒为 1（只有
          // acceptance 写的那一行），与"未定义时退回旧硬编码 1"完全等价，这里仍然只在
          // pending_decision 非空时赋值，让"从未 resume 过"的路径在类型和取值上都不可能
          // 因为这次改动而改变一个字节。
          ...(row.pending_decision !== null && row.pending_decision !== undefined
            ? { resumeStepSeqBase: extra.max_step_seq }
            : {}),
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
      //
      // design-delta `platform-owned-skills` -- `f.org_id = $1 OR f.org_id = PLATFORM_
      // ORG_ID`, not just `$1`. This is the ONE query that actually reads a Skill's
      // executable content for a run (`execute-run.ts`'s `buildSystemPrompt` call) --
      // every other platform-visibility change (`listAll`/`loadMountableRow`/capability
      // listing) only affects whether a Skill can be SEEN or MOUNTED. Missing this one
      // specific OR clause produces the most confusing failure mode in the whole delta:
      // an org can see the Skill in its catalog, mount it onto a thread successfully,
      // and then have every run against it fail `SKILL_VERSION_UNAVAILABLE` ("pinned 1,
      // retrieved 0") the moment it actually tries to use it -- contract.md §4③ calls
      // this out by name as the easiest spot to forget.
      const result = await s.query<{
        version_id: string; content: Buffer; stable_name: string; name: string;
      }>(
        `SELECT f.version_id, f.content, sk.stable_name, sk.name
           FROM skill_version_files f
           JOIN skill_versions v ON v.id=f.version_id AND v.org_id=f.org_id
           JOIN skills sk ON sk.id=v.skill_id AND sk.org_id=v.org_id
          WHERE (f.org_id=$1 OR f.org_id=$3) AND f.version_id = ANY($2::text[])
            AND f.path='SKILL.md' AND v.published`,
        [orgId, versionIds, PLATFORM_ORG_ID],
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
      // Phase 14 F15 -- encrypt the FULL content here, in infrastructure, never upstream:
      // `execute-run.ts` (application) may not import the cipher directly (ADR-020), so it
      // hands over plaintext on `AppendedRunStep.inputFullContent`/`outputFullContent` and
      // this is the one place it gets sealed. `this.cipher === null` (no key configured) or
      // the field left `undefined`/`null` (this cut has not threaded it through for this
      // step's kind yet) both fall through to storing NULL -- an honest "no full content for
      // this row", never a fabricated value. See `transcript-content-cipher.ts`'s header.
      const inputFullContentEnc = step.inputFullContent == null
        ? null : (this.cipher?.encrypt(step.inputFullContent) ?? null);
      const outputFullContentEnc = step.outputFullContent == null
        ? null : (this.cipher?.encrypt(step.outputFullContent) ?? null);
      // #742 Gap 1: still a plain INSERT, never an UPDATE -- `agent_run_steps` stays
      // append-only (grants + trigger unchanged by this feature). An `in_progress` row and
      // the terminal row that later reports the SAME tool call are two separate rows that
      // share `tool_call_id`; `readRun` below folds them back into one at read time.
      await s.query(
        `INSERT INTO agent_run_steps
           (id,org_id,run_id,seq,kind,status,started_at,ended_at,
            input_digest,output_digest,failure_code,
            tool_name,tool_args_summary,tool_result_summary,planning_note,tool_call_id,
            input_full_content_enc,output_full_content_enc)
         VALUES ($1,$2,$3,$4,$5,$6,$7::timestamptz,$8::timestamptz,$9,$10,$11,$12,$13,$14,$15,$16,
                 $17,$18)`,
        [randomUUID(), orgId, step.runId, step.seq, step.kind, step.status,
          step.startedAt, step.endedAt, step.inputDigest, step.outputDigest, step.failureCode,
          step.toolName, step.toolArgsSummary, step.toolResultSummary, step.planningNote,
          step.toolCallId, inputFullContentEnc, outputFullContentEnc],
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
    output: {
      readonly text: string;
      readonly finalStepSeq: number;
      readonly files?: readonly RunOutputFile[];
    },
  ): Promise<void> {
    await this.db.withTenant(orgId, async (s) => {
      // #725: `model_called_seq` travels with the run so `commitWriteback`/
      // `appendWritebackFailure` can compute the writeback step's `seq` from the ACTUAL
      // terminal step, not the pre-#725 assumption that it is always `3`.
      await s.query(
        `UPDATE agent_runs
            SET status='writeback_pending', model_output=$3, model_called_seq=$4,
                model_output_files=$5::jsonb
          WHERE org_id=$1 AND id=$2 AND status='running'`,
        // #1624：没有产物时写入 `'[]'` —— 与该列的 DEFAULT 完全一致，所以没有沙箱端口
        // 的部署里这条 UPDATE 的结果与本次改动之前逐字节相同。
        [orgId, runId, output.text, output.finalStepSeq, JSON.stringify(output.files ?? [])],
      );
    });
  }

  /**
   * 2026-08-30 —— 见 `ports.ts` `AgentRunStore.reclaimStaleRunning` 的完整取证。一条
   * `UPDATE ... RETURNING`：只标记这一刻仍然是 `running` 且 `started_at` 早于阈值的行，
   * 不会误伤这期间刚好写回完成、状态已经翻走的行（`WHERE status='running'` 是原子判据，
   * 不是先 SELECT 再 UPDATE 的两步竞态）。复用 `failRun` 同一条 SQL 形状，不新起一套。
   */
  async reclaimStaleRunning(orgId: OrgId, olderThanMs: number): Promise<number> {
    return this.db.withTenant(orgId, async (s) => {
      const reclaimed = await s.query(
        `UPDATE agent_runs SET status='failed', error_code='RUN_INTERRUPTED', ended_at=now()
          WHERE org_id=$1 AND status='running'
            AND coalesce(heartbeat_at, started_at) < now() - ($2 || ' milliseconds')::interval
        RETURNING id`,
        [orgId, olderThanMs],
      );
      return reclaimed.rows.length;
    });
  }

  /** issue #2860 —— 见 `AgentRunStore.heartbeatRun`；只对仍在 `running` 的行写。 */
  async heartbeatRun(orgId: OrgId, runId: string): Promise<void> {
    await this.db.withTenant(orgId, async (s) => {
      await s.query(
        `UPDATE agent_runs SET heartbeat_at=now() WHERE org_id=$1 AND id=$2 AND status='running'`,
        [orgId, runId],
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

  async markAwaitingToolPermission(
    orgId: OrgId, runId: string,
    pending: { readonly toolName: string; readonly argsSummary: string | null },
  ): Promise<void> {
    await this.db.withTenant(orgId, async (s) => {
      // 只从 running 起跳（触发器同样拦，但这里显式写条件让意图可读；
      // 命中 0 行不是错——并发下 run 可能已被 failRun 收走，账本以先到者为准）。
      await s.query(
        `UPDATE agent_runs
            SET status='awaiting_tool_permission', pending_tool_name=$3, pending_args_summary=$4
          WHERE org_id=$1 AND id=$2 AND status='running'`,
        [orgId, runId, pending.toolName, pending.argsSummary],
      );
    });
  }

  async approveAndRequeue(orgId: OrgId, runId: string): Promise<boolean> {
    return this.db.withTenant(orgId, async (s) => {
      // → queued 而非 → running：executor 的 claimQueued 只领 queued，置 running
      // 等于造一个永远没人执行的 run。重新入队让既有领取/并发语义原样生效。
      const updated = await s.query(
        `UPDATE agent_runs
            SET status='queued', pending_decision='approve'
          WHERE org_id=$1 AND id=$2 AND status='awaiting_tool_permission'
          RETURNING id`,
        [orgId, runId],
      );
      return updated.rows.length > 0;
    });
  }

  async editAndRequeue(orgId: OrgId, runId: string, editedArgsJson: string): Promise<boolean> {
    return this.db.withTenant(orgId, async (s) => {
      // 与 approveAndRequeue 同一条边、同一套竞态语义；单语句同写 pending_decision
      // 与 pending_edited_args——两列永远一起出现，'edit' 行缺参数只能是数据损坏。
      const updated = await s.query(
        `UPDATE agent_runs
            SET status='queued', pending_decision='edit', pending_edited_args=$3
          WHERE org_id=$1 AND id=$2 AND status='awaiting_tool_permission'
          RETURNING id`,
        [orgId, runId, editedArgsJson],
      );
      return updated.rows.length > 0;
    });
  }

  async denyAndRequeue(orgId: OrgId, runId: string): Promise<boolean> {
    return this.db.withTenant(orgId, async (s) => {
      // 与 approveAndRequeue 同一条边、同一套竞态语义——拒绝也重新入队而不是直接
      // failRun：execute-run 据此让 provider 发 resume:{decision:"reject"}，内核收到
      // 拒绝结果后自己调整后续计划，不是判定整个 run 失败（R3 步骤 6）。
      const updated = await s.query(
        `UPDATE agent_runs
            SET status='queued', pending_decision='deny'
          WHERE org_id=$1 AND id=$2 AND status='awaiting_tool_permission'
          RETURNING id`,
        [orgId, runId],
      );
      return updated.rows.length > 0;
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
        model_output_files: readonly RunOutputFile[] | null;
      }>(
        `SELECT id, thread_id, input_message_id, agent_id, model_output, writeback_attempts,
                model_output_files
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
        // #1624：列有 `DEFAULT '[]'`，但历史行与任何读不到的情况一律折成空数组——
        // "没有产物"是安全的默认，猜一个文件名会让写回去挂一个不存在的附件。
        files: row.model_output_files ?? [],
      }));
    });
  }

  commitWriteback(
    orgId: OrgId,
    input: {
      readonly runId: string; readonly threadId: string; readonly inputMessageId: string;
      readonly agentId: string; readonly text: string; readonly startedAt: string;
      readonly endedAt: string; readonly outputDigest: string;
      readonly files?: readonly RunOutputFile[];
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

      /*
       * #1624 —— 沙箱产出的文件挂成**这条助手消息的附件**，与消息、步骤、终态在
       * 同一个事务里。分开写会产生一条说"文件见附件"却没有附件的回复。
       *
       * ⚠ 幂等靠一次 `NOT EXISTS` 自查而不是 `ON CONFLICT`：`chat_message_attachments`
       *   的主键是随机 id，`(message_id, storage_ref)` 上没有唯一索引（那张表的既有语义
       *   允许同一个文件被挂到多条消息上）。写回是**有界重试**的，第二次尝试拿到的是
       *   同一条已存在的 `messageId`（见上面 RETURNING 为空那段），若无此判断就会给
       *   同一条消息挂上两份同一个文件。
       */
      for (const file of input.files ?? []) {
        await s.query(
          `INSERT INTO chat_message_attachments
             (id,org_id,thread_id,message_id,storage_ref,filename,mime,bytes)
           SELECT $1,$2,$3,$4,$5,$6,$7,$8
            WHERE NOT EXISTS (
              SELECT 1 FROM chat_message_attachments
               WHERE org_id=$2 AND message_id=$4 AND storage_ref=$5)`,
          [randomUUID(), orgId, input.threadId, messageId,
            file.objectKey, file.name, file.mime, file.sizeBytes],
        );
      }

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

  /** Phase 14 F11 -- see `AgentRunStore.findRequesterUserId`'s own doc. Same join `claimQueued`
   * uses to derive `ClaimedAgentRun.requesterUserId` (`m.author_id` off the triggering message). */
  findRequesterUserId(orgId: OrgId, runId: string): Promise<string | null> {
    return this.db.withTenant(orgId, async (s) => {
      const result = await s.query<{ author_id: string }>(
        `SELECT m.author_id
           FROM agent_runs r JOIN chat_messages m ON m.id=r.input_message_id AND m.org_id=r.org_id
          WHERE r.org_id=$1 AND r.id=$2`,
        [orgId, runId],
      );
      return result.rows[0]?.author_id ?? null;
    });
  }

  /** DA-19g -- see `AgentRunStore.findAwaitingToolPermissionRunId`'s own doc for why the AG-UI
   * bridge needs this lookup at all (its resume request carries a thread id, not a run id). */
  findAwaitingToolPermissionRunId(orgId: OrgId, threadId: string): Promise<string | null> {
    return this.db.withTenant(orgId, async (s) => {
      const result = await s.query<{ id: string }>(
        `SELECT id FROM agent_runs
          WHERE org_id=$1 AND thread_id=$2 AND status='awaiting_tool_permission'
          ORDER BY created_at DESC LIMIT 1`,
        [orgId, threadId],
      );
      return result.rows[0]?.id ?? null;
    });
  }

  async readRun(orgId: OrgId, runId: string): Promise<Guarded<RunProjection> | null> {
    const found = await this.db.withTenant(orgId, async (s) => {
      const run = await s.query<RunRow>(
        `SELECT r.id, r.thread_id, t.project_id, r.input_message_id, r.agent_id,
                r.agent_version_id, r.skill_version_ids, r.model_provider, r.model_id,
                r.status, r.error_code, r.created_at, reply.id AS result_message_id,
                r.pending_tool_name, r.pending_args_summary
           FROM agent_runs r
           JOIN chat_threads t ON t.id=r.thread_id AND t.org_id=r.org_id
           LEFT JOIN chat_messages reply
             ON reply.agent_run_id=r.id AND reply.org_id=r.org_id AND reply.author_kind='agent'
          WHERE r.org_id=$1 AND r.id=$2`,
        [orgId, runId],
      );
      const row = run.rows[0];
      if (row === undefined) return null;
      // #742 Gap 1: `agent_run_steps` is append-only, so an in-progress tool call and its
      // later terminal outcome are TWO rows sharing `tool_call_id`, not one row updated in
      // place (see `AppendedRunStep.toolCallId`'s own doc). Collapse each `tool_call_id`
      // group here to the row a client should actually see: the terminal one once it
      // exists, else the `in_progress` one while it's still pending. Rows with no
      // `tool_call_id` (every non-`tool_call` step, and any `tool_call` step whose
      // provider never supplied one) are each their own group via `COALESCE(..., id)`, so
      // this changes nothing for them -- identical to the pre-#742 one-row-per-call shape.
      //
      // DA-19g fix -- the outer ORDER BY must sort by the group's FIRST seq
      // (`group_seq`/`MIN(seq)`), never by the picked (terminal) row's own `seq`. A HITL
      // resume appends the terminal row for an already-announced call with a NEW seq
      // (`resumeStepSeqBase`/`max_step_seq` above always continues past whatever came
      // before), so sorting by the terminal row's own seq silently reorders that step to
      // the TAIL of the list the moment it resolves -- past `agui-bridge.ts`
      // `pollAguiRunToOutcome`'s position-based "already reported" cursor
      // (`initialReportedStepCount`), which re-announces it a second time
      // (`agui-bridge-hitl.test.ts`'s "resume 请求把 run 续跑到 succeeded" case: a
      // duplicate `STEP_STARTED` for the approval tool call). Sorting by the group's first
      // seq keeps the step pinned at the position it was ORIGINALLY announced at --
      // `rn = 1`'s row-picking (terminal content once it exists) is unchanged.
      const steps = await s.query<StepRow>(
        `SELECT kind,status,started_at,ended_at,input_digest,output_digest,failure_code,
                tool_name,tool_args_summary,tool_result_summary,planning_note,tool_call_id
           FROM (
             SELECT *,
               ROW_NUMBER() OVER (
                 PARTITION BY COALESCE(tool_call_id, id)
                 ORDER BY (status <> 'in_progress') DESC, seq DESC
               ) AS rn,
               MIN(seq) OVER (PARTITION BY COALESCE(tool_call_id, id)) AS group_seq
             FROM agent_run_steps WHERE org_id=$1 AND run_id=$2
           ) collapsed
          WHERE rn = 1
          ORDER BY group_seq, started_at`,
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
        // #742 Gap 1: `tool_call_id` was only needed to COLLAPSE rows in the query above --
        // it stops here, see `RunProjection.steps`'s own doc for why it never reaches the
        // public contract.
      })),
      createdAt: found.row.created_at.toISOString(),
      pendingApproval: found.row.pending_tool_name === null || found.row.pending_tool_name === undefined
        ? null
        : { toolName: found.row.pending_tool_name, argsSummary: found.row.pending_args_summary ?? null },
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
      // F154 L2：outer SELECT 也带上 id——L2 的增量摘要判定要知道「读回的这批消息，哪些已经
      // 被 thread_context_state.summarized_through_id 覆盖过」，没有 id 就分不出新旧。
      const result = await s.query<{ id: string; author_kind: string; body: string; attachments: unknown }>(
        `SELECT id, author_kind, body, attachments FROM (
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
          if (row.author_kind === "human") return { role: "user", content: row.body, id: row.id, ...withAtt };
          if (row.author_kind === "agent") return { role: "assistant", content: row.body, id: row.id, ...withAtt };
          // No third `author_kind` exists in this schema today (see the CHECK on
          // `chat_messages`); skipping rather than throwing keeps a future value from
          // turning "read some history" into "fail the whole run" for an enhancement
          // this run's correctness never depended on.
          return null;
        })
        .filter((m): m is ThreadHistoryMessage => m !== null);
    });
  }

  async readThreadContextState(orgId: OrgId, threadId: string): Promise<ThreadContextState | null> {
    return this.db.withTenant(orgId, async (s) => {
      const result = await s.query<{
        summary: string;
        summarized_through_id: string | null;
        summarized_through_at: Date | string | null;
        version: number;
      }>(
        `SELECT summary, summarized_through_id, summarized_through_at, version
           FROM thread_context_state
          WHERE org_id=$1 AND thread_id=$2`,
        [orgId, threadId],
      );
      const row = result.rows[0];
      if (row === undefined) return null;
      return {
        summary: row.summary,
        summarizedThroughId: row.summarized_through_id,
        // timestamptz → ISO 串（pg 驱动回 Date；也容忍已是串的情况）。
        summarizedThroughAt:
          row.summarized_through_at === null
            ? null
            : new Date(row.summarized_through_at).toISOString(),
        version: row.version,
      };
    });
  }

  async upsertThreadContextState(
    orgId: OrgId,
    threadId: string,
    state: {
      readonly summary: string;
      readonly summarizedThroughId: string | null;
      readonly summarizedThroughAt: string | null;
      readonly expectedVersion: number;
    },
  ): Promise<boolean> {
    return this.db.withTenant(orgId, async (s) => {
      // 乐观并发的单条原子写：
      //   · 首次（无行，expectedVersion=0）→ INSERT，version 落 1；
      //   · 增量（有行）→ ON CONFLICT DO UPDATE，但 **仅当现存 version = expectedVersion**，
      //     version 自增 1；撞并发（version 已变）→ WHERE 不满足 → 0 行受影响 → 回 false。
      // 竞态的首次并发：先到者 INSERT version=1，后到者走 ON CONFLICT、其 WHERE version=0 对不上
      // 现存的 1 → 0 行 → false。全程不静默覆盖别人的写。
      const result = await s.query<{ thread_id: string }>(
        `INSERT INTO thread_context_state
           (thread_id, org_id, summary, summarized_through_id, summarized_through_at, version, updated_at)
         VALUES ($1, $2, $3, $4, $5, 1, now())
         ON CONFLICT (thread_id) DO UPDATE
           SET summary = EXCLUDED.summary,
               summarized_through_id = EXCLUDED.summarized_through_id,
               summarized_through_at = EXCLUDED.summarized_through_at,
               version = thread_context_state.version + 1,
               updated_at = now()
         WHERE thread_context_state.version = $6
         RETURNING thread_id`,
        [
          threadId, orgId, state.summary, state.summarizedThroughId,
          state.summarizedThroughAt, state.expectedVersion,
        ],
      );
      return result.rows.length > 0;
    });
  }

  /**
   * Phase 14 F15 -- see `AgentRunStore.readRunTranscriptSteps`'s own doc for the contract
   * this implements (RUN_NOT_FOUND via `null`, raw ungrouped ledger, kind scope).
   */
  async readRunTranscriptSteps(orgId: OrgId, runId: string): Promise<readonly TranscriptStep[] | null> {
    return this.db.withTenant(orgId, async (s) => {
      // Existence check is separate from the steps query on purpose: a run that exists but
      // has not reached `model_called`/`tool_call` yet (still `queued`/building context)
      // must come back as an EMPTY transcript, not RUN_NOT_FOUND -- those are different
      // facts ("nothing to show yet" vs. "no such run") and `getRunTranscript` needs to
      // tell them apart.
      const run = await s.query<{ id: string }>(
        `SELECT id FROM agent_runs WHERE org_id=$1 AND id=$2`,
        [orgId, runId],
      );
      if (run.rows.length === 0) return null;

      const steps = await s.query<{
        id: string; kind: string; ended_at: Date;
        input_full_content_enc: string | null; output_full_content_enc: string | null;
      }>(
        `SELECT id, kind, ended_at, input_full_content_enc, output_full_content_enc
           FROM agent_run_steps
          WHERE org_id=$1 AND run_id=$2 AND kind IN ('model_called','tool_call')
          ORDER BY seq`,
        [orgId, runId],
      );
      return steps.rows.map((row): TranscriptStep => {
        const kind: TranscriptStep["kind"] = row.kind === "model_called" ? "model_call" : "tool_call";
        const createdAt = row.ended_at.toISOString();
        // I-4: `fullContent` is null iff `decryptStatus === "unreadable"`. A row with BOTH
        // columns NULL never had full content captured (this cut's `tool_call` scope gap, or
        // a pre-F15 historical row) -- there is no third contract state for "never
        // recorded" distinct from "cannot decrypt", so this is the honest mapping: we
        // cannot show it either way. See `AgentRunStore.readRunTranscriptSteps`'s doc and
        // this repository's own header note in `appendStep`.
        if (row.input_full_content_enc === null && row.output_full_content_enc === null) {
          return { runStepId: row.id, kind, decryptStatus: "unreadable", fullContent: null, createdAt };
        }
        const decryptedInput = row.input_full_content_enc === null
          ? null : this.cipher?.decrypt(row.input_full_content_enc) ?? null;
        const decryptedOutput = row.output_full_content_enc === null
          ? null : this.cipher?.decrypt(row.output_full_content_enc) ?? null;
        // A column that WAS stored but failed to come back (wrong/rotated/missing key,
        // tampered ciphertext -- E3) makes the whole step unreadable. I-4 forbids a
        // half-lit `fullContent` that silently drops just the side that failed.
        const inputFailed = row.input_full_content_enc !== null && decryptedInput === null;
        const outputFailed = row.output_full_content_enc !== null && decryptedOutput === null;
        if (inputFailed || outputFailed) {
          return { runStepId: row.id, kind, decryptStatus: "unreadable", fullContent: null, createdAt };
        }
        return {
          runStepId: row.id,
          kind,
          decryptStatus: "ok",
          fullContent: JSON.stringify({ input: decryptedInput, output: decryptedOutput }),
          createdAt,
        };
      });
    });
  }
}
