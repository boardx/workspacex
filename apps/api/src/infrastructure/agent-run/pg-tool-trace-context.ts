/**
 * `ToolTraceContextPort` 的 PostgreSQL 实现（F190，design-delta `tool-trace-cross-run-context`）。
 *
 * 只读——不新建表、不新建列，复用既有 `agent_run_steps`（`kind='tool_call'` 行）+ `agent_runs`
 * （定位"最近几轮"）+ `chat_messages`（经 `agent_run_id` 唯一索引反查该 run 是否已写回、
 * 写回到了哪条消息 id，供调用点做 L1 去重判定）。
 */
import type { OrgId } from "../../domain/org-id";
import type { DatabasePort } from "../../application/ports/database.port";
import type {
  ToolCallTraceRun, ToolCallTraceStep, ToolTraceContextPort,
} from "../../application/agent-run/tool-trace-context";

interface TraceRow {
  run_id: string;
  output_message_id: string | null;
  tool_name: string | null;
  tool_args_summary: string | null;
  tool_result_summary: string | null;
  planning_note: string | null;
}

/**
 * `$1` orgId · `$2` threadId · `$3` excludeRunId（当前正在执行的 run，不把自己算进"历史"）
 * · `$4` runLimit
 *
 * `recent_runs` 先按时间倒序圈定"最近 N 轮**记录过 tool_call 的** run"（没有任何工具调用的
 * run 不占这 N 轮名额——F190 §1① 的"最近 N 轮 run"指的是有工具轨迹可回喂的轮次，不是任意轮次，
 * 否则一段纯问答的间隔轮会把真正有价值的工具轨迹挤出窗口）；再展开成逐 step 行，
 * `LEFT JOIN chat_messages` 反查该 run 的写回消息 id（尚未写回 ⇒ `NULL`）。
 */
const RECENT_TOOL_TRACE_SQL = `
WITH recent_runs AS (
  SELECT ar.id AS run_id, ar.created_at
    FROM agent_runs ar
   WHERE ar.org_id = $1 AND ar.thread_id = $2 AND ar.id <> $3
     AND EXISTS (
       SELECT 1 FROM agent_run_steps s
        WHERE s.org_id = ar.org_id AND s.run_id = ar.id AND s.kind = 'tool_call'
     )
   ORDER BY ar.created_at DESC, ar.id DESC
   LIMIT $4
)
SELECT rr.run_id, cm.id AS output_message_id,
       s.tool_name, s.tool_args_summary, s.tool_result_summary, s.planning_note
  FROM recent_runs rr
  JOIN agent_run_steps s
    ON s.org_id = $1 AND s.run_id = rr.run_id AND s.kind = 'tool_call'
  LEFT JOIN chat_messages cm
    ON cm.org_id = $1 AND cm.agent_run_id = rr.run_id
 ORDER BY rr.created_at DESC, rr.run_id, s.seq ASC`;

export class PgToolTraceContext implements ToolTraceContextPort {
  constructor(private readonly db: DatabasePort) {}

  async recent(
    orgId: OrgId,
    threadId: string,
    excludeRunId: string,
    runLimit: number,
  ): Promise<readonly ToolCallTraceRun[]> {
    if (runLimit <= 0) return [];
    return this.db.withTenant(orgId, async (s) => {
      const result = await s.query<TraceRow>(RECENT_TOOL_TRACE_SQL, [
        orgId, threadId, excludeRunId, runLimit,
      ]);
      // 行按 run 分组连续出现（SQL 的 ORDER BY 先按 run 的时间倒序、同一 run 内再按 seq 正序），
      // 用一次线性折叠即可还原成"每 run 一条、内含有序 steps"的形状，不需要额外排序。
      const byRun = new Map<string, { outputMessageId: string | null; steps: ToolCallTraceStep[] }>();
      const order: string[] = [];
      for (const row of result.rows) {
        let entry = byRun.get(row.run_id);
        if (entry === undefined) {
          entry = { outputMessageId: row.output_message_id, steps: [] };
          byRun.set(row.run_id, entry);
          order.push(row.run_id);
        }
        entry.steps.push({
          toolName: row.tool_name ?? "",
          toolArgsSummary: row.tool_args_summary,
          toolResultSummary: row.tool_result_summary,
          planningNote: row.planning_note,
        });
      }
      return order.map((runId): ToolCallTraceRun => {
        const entry = byRun.get(runId)!;
        return { runId, outputMessageId: entry.outputMessageId, steps: entry.steps };
      });
    });
  }
}
