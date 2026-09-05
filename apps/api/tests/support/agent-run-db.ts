/**
 * `agent_runs` / `agent_run_steps` 的最小夹具——供需要真实 `run_id`/`agent_run_steps.id` FK 目标的
 * 测试直接造行，不需要走完整 `executeQueuedRuns`。同
 * `tests/agent-runtime/agent-run-step-collapse-order.test.ts` 的 `seedRun` 先例：
 * `agent_id`/`agent_version_id` 上没有 FK（只有 `thread_id`/`input_message_id` 指向真表），
 * 不需要 agent/skill 目录夹具。
 */
import { randomUUID } from "node:crypto";
import { addChatMessage } from "./chat-db";
import { asApp } from "./db";

export async function seedAgentRun(opts: {
  orgId: string;
  id: string;
  threadId: string;
  authorId: string;
  status?: "queued" | "running" | "writeback_pending" | "succeeded" | "failed";
}): Promise<void> {
  const inputMessageId = `${opts.id}-input`;
  await addChatMessage({ orgId: opts.orgId, id: inputMessageId, threadId: opts.threadId, body: "hi", authorId: opts.authorId });
  await asApp(opts.orgId, (c) =>
    c.query(
      `INSERT INTO agent_runs
         (id, org_id, thread_id, input_message_id, agent_id, agent_version_id,
          skill_version_ids, model_provider, model_id, status)
       VALUES ($1,$2,$3,$4,$5,$6,'[]'::jsonb,$7,$8,$9)`,
      [
        opts.id, opts.orgId, opts.threadId, inputMessageId, "agent-test", "agent-version-test",
        "test-provider", "test-model", opts.status ?? "succeeded",
      ],
    ),
  );
}

/** Inserts one `tool_call` step and returns its generated id (`appendStep` does not). */
export async function seedToolCallStep(opts: {
  orgId: string;
  runId: string;
  seq: number;
  toolName: string;
}): Promise<string> {
  const id = randomUUID();
  await asApp(opts.orgId, (c) =>
    c.query(
      `INSERT INTO agent_run_steps
         (id, org_id, run_id, seq, kind, status, started_at, ended_at,
          input_digest, output_digest, failure_code,
          tool_name, tool_args_summary, tool_result_summary, planning_note, tool_call_id)
       VALUES ($1,$2,$3,$4,'tool_call','succeeded',now(),now(),
               NULL,NULL,NULL,$5,NULL,NULL,NULL,NULL)`,
      [id, opts.orgId, opts.runId, opts.seq, opts.toolName],
    ),
  );
  return id;
}
