/**
 * `summarizeErrorLog`（2026-09-02，人类要求）—— 把一条系统异常的原始字段（`msg` +
 * 已脱敏的 `detail`）整理成一句标题 + 一段面向人类工程师的说明，供后台「反馈与迭代 →
 * 系统异常」页展示成跟反馈卡片一样"人能看懂、能决定怎么处理"的样子。
 *
 * ## 与 `structure-feedback-draft.ts` 同一套骨架
 *
 * 固定走注入的 `summaryModel` 配置（不是被选中 Agent 的快照——这是一次元任务）；
 * `Promise.race` 包硬超时；模型输出用宽松 JSON 提取（可能带解释性文字/代码块标记）。
 * 与反馈整理**不同**的一点：反馈整理失败会让用户"点了没反应"，所以那里抛出去让
 * 控制器映射 503；这里的调用方（`PgErrorLogWriter`）是 fire-and-forget 的后台任务，
 * 失败只需要让 `aiTitle`/`aiSummary` 保持 `null`，不需要一个专门的错误类。
 *
 * ## 为什么不喂原始未脱敏的字段（`msg` 与 `detail` 都算，2026-09-03 更新）
 *
 * 调用方必须传入**已经过 `error-log.port.ts` 脱敏**的 `msg`（`redactErrorMessage`）和
 * `detail`（`redactErrorDetail`）——异常里常见的连接串/token/JWT 不能因为多了一步"发给
 * 模型整理"就多一条泄露路径。独立评审 finding #2（2026-09-03）：初版只脱敏了 `detail`，
 * `msg` 被原样传给模型——`SystemErrorLogController.report()` 那条分支的 `msg` 直接含
 * 客户端上报文本的前 200 字，同样可能带敏感内容。这里不重新做一次脱敏，是因为脱敏的
 * 单一事实源在 `error-log.port.ts`，这里假定调用方已经处理，不是本函数的职责。
 */
import type { ModelCallPort } from "../agent-run/ports";
import { ModelCallError } from "../agent-run/ports";

/** 同 `FeedbackStructureModelConfig` 的既有先例——接口形状声明在这里，唯一实现
 *  （`infrastructure/logging/error-log-summary-model-config.ts`）由组合根注入。 */
export interface ErrorLogSummaryModelConfig {
  readonly provider: string;
  readonly modelId: string;
}

export const ERROR_LOG_SUMMARY_MODEL_CONFIG = Symbol("ErrorLogSummaryModelConfig");

export interface SummarizeErrorLogDeps {
  readonly model: ModelCallPort;
  readonly summaryModel: ErrorLogSummaryModelConfig;
  readonly log: (message: string, detail: Record<string, unknown>) => void;
}

export interface SummarizeErrorLogInput {
  /** 已脱敏（`redactErrorMessage`）——见文件头"为什么不喂原始未脱敏的字段"。 */
  readonly redactedMsg: string;
  /** 已脱敏（`redactErrorDetail`）——同上。 */
  readonly redactedDetail: unknown;
}

export interface SummarizeErrorLogResult {
  readonly title: string;
  readonly summary: string;
}

export const SUMMARIZE_ERROR_LOG_TIMEOUT_MS = 30_000;

const SYSTEM_PROMPT =
  "你是一个后端异常分析助手。你会收到一条系统捕获的异常（可能来自服务端未处理异常，" +
  "也可能来自前端上报），包含一句简短消息与一个已脱敏的详情对象（可能有 name/message/" +
  "stack，也可能是前端上报带的 url/userAgent 等）。请给运维/工程师写一段简短的中文" +
  "研判：这大概是什么问题、可能出在哪里、建议先查什么。只输出一个 JSON 对象，不要任何" +
  "解释性文字、不要 markdown 代码块标记。JSON 形如：" +
  '{"title":"不超过60字的简短标题，概括这是哪一类问题","summary":"2-4句话的研判，' +
  '面向要决定怎么处理这条异常的人，不要逐字复述 stack"}。' +
  "看不出具体原因时如实说「看不出明确原因，需要结合 traceId 查更多上下文」，不要编造。";

/** 同 `structure-feedback-draft.ts` 的既有先例：模型偶尔会在 JSON 前后加解释性文字。 */
function extractJsonObject(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) throw new Error("no JSON object found in model output");
  return JSON.parse(text.slice(start, end + 1));
}

function clamp(text: string, max: number): string {
  return text.length > max ? text.slice(0, max) : text;
}

export async function summarizeErrorLog(
  deps: SummarizeErrorLogDeps,
  input: SummarizeErrorLogInput,
): Promise<SummarizeErrorLogResult | null> {
  const user = JSON.stringify({ msg: input.redactedMsg, detail: input.redactedDetail });

  // ⚠ 独立评审 finding #4（2026-09-03）：`setTimeout` 的句柄如果不在模型先赢的那条路径上
  // `clearTimeout`，定时器会一直挂到 30 秒后才触发+被回收——高并发下这是可观的悬挂句柄
  // 数量。这里保留句柄，`finally` 里无条件清掉（模型赢或超时赢都清，重复 clear 是安全的
  // no-op）。**没有做的**：真正取消/abort 掉还在跑的模型请求本身——`ModelCallPort.complete`
  // 目前完全没有 signal/abort 形状的入参（`generate-thread-title.ts` / `structure-feedback-
  // draft.ts` / `generate-followup-suggestions.ts` 这几个同骨架的元任务调用点都是同样的
  // 限制，不是本文件独有），要补这个得改端口接口 + 每个 provider 实现，是比这一个用例大得多
  // 的改动，登记为独立 issue，不在本次顺手做。
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  let completion: { readonly text: string };
  try {
    completion = await Promise.race([
      deps.model.complete({
        modelProvider: deps.summaryModel.provider,
        modelId: deps.summaryModel.modelId,
        // ⚠ 不传 threadId——同 generate-thread-title.ts / structure-feedback-draft.ts
        // 的既有先例，避免被当成要接续的真实会话。
        system: SYSTEM_PROMPT,
        user,
      }),
      new Promise<never>((_resolve, reject) => {
        timeoutHandle = setTimeout(() => reject(new Error("error log summarization timed out")), SUMMARIZE_ERROR_LOG_TIMEOUT_MS);
      }),
    ]);
  } catch (e) {
    deps.log("error log summarization: model call failed (best-effort, ai_title/ai_summary stay null)", {
      modelProvider: deps.summaryModel.provider,
      modelId: deps.summaryModel.modelId,
      code: e instanceof ModelCallError ? e.code : "MODEL_CALL_FAILED",
      detail: e instanceof ModelCallError ? e.detail : e instanceof Error ? e.message : "unexpected model call failure",
    });
    return null;
  } finally {
    // 模型赢：句柄还没触发，清掉避免悬挂到 30 秒后。超时赢：句柄已经触发过，`clearTimeout`
    // 在一个已触发的句柄上是安全的 no-op——两条路径都过这一行，不需要分别处理。
    if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
  }

  let parsed: unknown;
  try {
    parsed = extractJsonObject(completion.text);
  } catch (e) {
    deps.log("error log summarization: model output was not parseable JSON (best-effort, stays null)", {
      detail: e instanceof Error ? e.message : "unparseable model output",
    });
    return null;
  }

  const obj = parsed as Record<string, unknown>;
  const title = typeof obj.title === "string" && obj.title.trim() !== "" ? obj.title.trim() : null;
  const summary = typeof obj.summary === "string" && obj.summary.trim() !== "" ? obj.summary.trim() : null;
  if (title === null || summary === null) {
    deps.log("error log summarization: model output missing title/summary (best-effort, stays null)", {});
    return null;
  }

  return { title: clamp(title, 200), summary: clamp(summary, 2_000) };
}
