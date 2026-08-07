/**
 * The ONE configured model provider (Wave 2 delta §5).
 *
 * ## Why this class cannot fall back, structurally
 *
 * It holds a single `provider` string and a single base URL. There is no list, no map, no
 * "default", and `complete()` refuses any `modelProvider` that is not the configured one.
 * The failure §5 forbids -- a run answered by a provider its pinned Agent version does not
 * name -- would require adding a second endpoint here, which needs a review.
 *
 * ## Nothing the provider says reaches a client
 *
 * Every failure becomes `ModelCallError(code, detail)`. `code` is one of the contract's
 * enumerated values; `detail` is a short server-side string built HERE, from the status
 * line and a category, never from the response body and never from `String(err)`. PR #310
 * shipped the other version of this, and the lesson is not "remember to redact" -- it is
 * that the redacted thing must be the only thing that exists.
 *
 * ## The request shape
 *
 * OpenAI-compatible `/chat/completions`, which is what the providers this deployment
 * targets (and their self-hosted stand-ins) speak. `stream` is false: Wave 2's transport
 * for run progress is polling, and a streaming response would need somewhere to stream to.
 */
import type {
  ModelCallInput, ModelCallPort,
} from "../../application/agent-run/ports";
import { ModelCallError } from "../../application/agent-run/ports";

export interface ConfiguredModelProviderConfig {
  /** The one provider name that runs may pin. Empty means: this deployment has none. */
  readonly provider: string;
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly timeoutMs: number;
}

/** Read once at composition time, so a mid-flight env change cannot swap a run's provider. */
export function readModelProviderConfig(
  env: NodeJS.ProcessEnv = process.env,
): ConfiguredModelProviderConfig {
  // ⚠ 2026-08-07 devapp 实测：默认 60s 在「一个 agent 挂了多个 skill（每个 skill 的
  // SKILL.md 全文都拼进 system prompt）」时会真实超时——不是偶发，同一条较长的用户
  // 请求连续两次都在 model_called 步骤精确卡在 60000ms 失败（MODEL_CALL_FAILED），
  // 而一句"重试一次"这种短请求秒回。系统提示词越长，模型生成越慢，60s 对"多技能挂载
  // 的默认 agent"这个真实场景不够用。180s 仍在 R9（>10s 转异步任务）判定之内的同步
  // 路径可接受范围——这条超时挡的是"网络/模型真的挂了"，不是"提示词长+回复长"。
  const timeout = Number(env.KERNEL_MODEL_TIMEOUT_MS ?? "180000");
  return {
    provider: (env.KERNEL_MODEL_PROVIDER ?? "").trim(),
    baseUrl: (env.KERNEL_MODEL_BASE_URL ?? "").trim().replace(/\/+$/, ""),
    apiKey: env.KERNEL_MODEL_API_KEY ?? "",
    timeoutMs: Number.isFinite(timeout) && timeout > 0 ? timeout : 180_000,
  };
}

interface CompletionResponse {
  choices?: { message?: { content?: unknown } }[];
  usage?: { total_tokens?: unknown };
}

export class ConfiguredModelProvider implements ModelCallPort {
  constructor(private readonly config: ConfiguredModelProviderConfig) {}

  async complete(input: ModelCallInput): Promise<{ readonly text: string; readonly tokens?: number }> {
    const { provider, baseUrl, apiKey, timeoutMs } = this.config;
    if (provider === "" || baseUrl === "" || apiKey === "") {
      throw new ModelCallError(
        "MODEL_PROVIDER_NOT_CONFIGURED",
        "no model provider is configured for this deployment",
      );
    }
    if (input.modelProvider !== provider) {
      // Not a fallback point. The run pinned a provider this deployment does not serve,
      // and answering with the one it does serve would silently change the snapshot.
      throw new ModelCallError(
        "MODEL_PROVIDER_NOT_CONFIGURED",
        `run pinned provider "${input.modelProvider}", configured provider is "${provider}"`,
      );
    }

    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), timeoutMs);
    let response: Response;
    try {
      response = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        signal: abort.signal,
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: input.modelId,
          stream: false,
          messages: [
            { role: "system", content: input.system },
            { role: "user", content: input.user },
          ],
        }),
      });
    } catch {
      // The transport error object is not inspected at all. Its `message` routinely
      // contains the host, the port and sometimes the URL with credentials in it.
      throw new ModelCallError("MODEL_CALL_FAILED", "model provider transport failure");
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      // The status is a number we produced the category for; the body is never read.
      throw new ModelCallError(
        "MODEL_CALL_FAILED",
        `model provider responded with HTTP ${response.status}`,
      );
    }

    let parsed: CompletionResponse;
    try {
      parsed = await response.json() as CompletionResponse;
    } catch {
      throw new ModelCallError("MODEL_CALL_FAILED", "model provider response was not JSON");
    }
    const content = parsed.choices?.[0]?.message?.content;
    if (typeof content !== "string" || content.trim() === "") {
      // Fail rather than return "". A blank completion turned into an assistant message is
      // a fabricated reply, and the run would read as succeeded.
      throw new ModelCallError("MODEL_CALL_FAILED", "model provider returned no content");
    }
    // Read straight off the wire response, never computed. Absent or non-numeric ⇒
    // `undefined` (the port's "not reported" state) -- not `0` invented at this layer.
    const reportedTokens = parsed.usage?.total_tokens;
    const tokens = typeof reportedTokens === "number" && Number.isFinite(reportedTokens) && reportedTokens >= 0
      ? reportedTokens
      : undefined;
    return { text: content, tokens };
  }
}
