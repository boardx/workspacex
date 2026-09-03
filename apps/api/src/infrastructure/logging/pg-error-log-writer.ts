/**
 * `PgErrorLogWriter` —— `error_logs` 的写入/翻页面。
 *
 * ## 2026-09-02（人类要求）：`record()` 落库之后**异步**生成 AI 摘要
 *
 * `record()` 本身仍然只做一次 `INSERT`，延迟画像不变——两个调用方
 * （`AllExceptionsFilter` / `SystemErrorLogController.report`）都用 `void ...record()`
 * 发起，从不 `await` 它，所以在这个方法内部再挂一段不 `await` 的后台工作，不会让任何
 * 请求路径多等一毫秒。`summarizeErrorLog` 失败（模型不可用/超时/没配置）只记日志，
 * `ai_title`/`ai_summary` 保持 `NULL`——`list()` 原样读回，界面据此渲染"还没有"或
 * "这次没生成出来"，不伪造一段摘要（见 `error-log.port.ts` 的 `ErrorLogListItem` 头注）。
 *
 * 写回摘要走 `kernel_write_error_log_ai_summary()`（SECURITY DEFINER，见迁移
 * `20260902160000_error_logs_ai_summary.sql`）——`app_rw` 因此还是不能裸 SELECT/UPDATE
 * 这张表，只能"设置某个已知 id 的两个摘要列"。取得那个 id 靠 `INSERT ... RETURNING id`，
 * 需要 `app_rw` 有 `SELECT (id)`（同一条迁移里授权）——`id` 是自增序号不是内容，单独放行
 * 不违反"诊断内容只有 app_diag_ro 能读"的既有边界。
 *
 * `list()` 改读 `kernel_read_error_logs_with_ai_summary()`，**不是**旧的
 * `kernel_read_error_logs`——那个函数已经在更早的迁移里上线，`CREATE OR REPLACE`
 * 改不了它的返回列，见 `20260902160000_error_logs_ai_summary.sql` 头注。
 */
import type { DatabasePort } from "../../application/ports/database.port";
import {
  redactErrorDetail,
  type ErrorLogEntry,
  type ErrorLogListItem,
  type ErrorLogPort,
} from "../../application/ports/error-log.port";
import type { ModelCallPort } from "../../application/agent-run/ports";
import {
  summarizeErrorLog,
  type ErrorLogSummaryModelConfig,
} from "../../application/system/summarize-error-log";

export const RETENTION_DAYS = 30;
const HOUSEKEEPING_EVERY = 50;

export async function sweepExpiredErrorLogs(db: DatabasePort): Promise<{ readonly ok: boolean; readonly error?: unknown }> {
  try {
    await db.withoutTenant((s) =>
      s.query(`DELETE FROM error_logs WHERE created_at < now() - interval '${RETENTION_DAYS} days'`),
    );
    return { ok: true };
  } catch (error) {
    return { ok: false, error };
  }
}

export interface PgErrorLogWriterAiDeps {
  readonly model: ModelCallPort;
  readonly summaryModel: ErrorLogSummaryModelConfig;
  readonly log: (message: string, detail: Record<string, unknown>) => void;
}

export class PgErrorLogWriter implements ErrorLogPort {
  private writeCount = 0;

  constructor(
    private readonly db: DatabasePort,
    private readonly readDb: DatabasePort,
    /** 未注入 = 不生成 AI 摘要，`record()` 行为与本次改动之前逐字节相同（测试里常见）。 */
    private readonly ai?: PgErrorLogWriterAiDeps,
  ) {}

  async record(entry: ErrorLogEntry): Promise<void> {
    const detail = redactErrorDetail(entry.detail);
    const id = await this.db.withoutTenant(async (s) => {
      const { rows } = await s.query<{ id: string }>(
        `INSERT INTO error_logs (trace_id, msg, detail) VALUES ($1, $2, $3::jsonb) RETURNING id`,
        [entry.traceId, entry.msg, JSON.stringify(detail)],
      );
      return rows[0]?.id ?? null;
    });

    this.writeCount += 1;
    if (this.writeCount % HOUSEKEEPING_EVERY === 0) {
      await sweepExpiredErrorLogs(this.db);
    }

    // ⚠ 不 await——见文件头："两个调用方都不等 record() 本身，这里再挂一段后台工作
    //   不会拖慢任何请求"。`id === null` 理论上不会发生（INSERT ... RETURNING 恒返回一行），
    //   但仍判一次，防的是"这一步真的没拿到 id 就去调模型、算出来的摘要没地方写"这种浪费。
    if (id !== null && this.ai !== undefined) {
      void this.generateAndWriteSummary(id, entry.msg, detail);
    }
  }

  private async generateAndWriteSummary(id: string, msg: string, redactedDetail: unknown): Promise<void> {
    const ai = this.ai;
    if (ai === undefined) return;
    let result: { readonly title: string; readonly summary: string } | null;
    try {
      result = await summarizeErrorLog(
        { model: ai.model, summaryModel: ai.summaryModel, log: ai.log },
        { msg, redactedDetail },
      );
    } catch (e) {
      // `summarizeErrorLog` 已经把已知的失败模式(模型调用失败/解析失败)自己 catch 成
      // `null`——这里的 catch 是给"没想到的"异常兜底，不让一次异常摘要生成的意外故障
      // 变成一条未处理的 promise rejection。
      ai.log("error log ai summary: unexpected failure generating summary (stays null)", { id, err: e });
      return;
    }
    if (result === null) return;
    try {
      await this.db.withoutTenant((s) =>
        s.query(`SELECT kernel_write_error_log_ai_summary($1::bigint, $2, $3)`, [id, result.title, result.summary]),
      );
    } catch (e) {
      ai.log("error log ai summary: write-back failed (best-effort, ai_title/ai_summary stay null)", { id, err: e });
    }
  }

  async list(input: { readonly limit: number; readonly beforeId: string | null }): Promise<{
    readonly items: readonly ErrorLogListItem[];
    readonly hasMore: boolean;
  }> {
    const fetchLimit = input.limit + 1;
    const rows = await this.readDb.withoutTenant((s) =>
      s.query<{
        id: string; trace_id: string; msg: string; detail: unknown; created_at: Date;
        ai_title: string | null; ai_summary: string | null;
      }>(
        `SELECT id, trace_id, msg, detail, created_at, ai_title, ai_summary FROM kernel_read_error_logs_with_ai_summary($1, $2)`,
        [fetchLimit, input.beforeId],
      ),
    );
    const hasMore = rows.rows.length > input.limit;
    const page = hasMore ? rows.rows.slice(0, input.limit) : rows.rows;
    return {
      items: page.map((r) => ({
        id: String(r.id),
        traceId: r.trace_id,
        msg: r.msg,
        detail: r.detail,
        createdAt: new Date(r.created_at).toISOString(),
        aiTitle: r.ai_title,
        aiSummary: r.ai_summary,
      })),
      hasMore,
    };
  }
}
