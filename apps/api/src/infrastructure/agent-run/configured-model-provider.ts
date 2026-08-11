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
 * targets (and their self-hosted stand-ins) speak. `complete()` always sends `stream:
 * false` -- that half of #654 阶段2a's own doc comment is still true for THIS method.
 *
 * ## `completeStream` is OFF by default (#654 阶段2a)
 *
 * `KERNEL_MODEL_STREAM_ENABLED` gates whether `this.completeStream` exists AT ALL, read
 * once here at composition time same as everything else in this config. Measured, not
 * assumed: turning this on unconditionally the moment the method existed broke 8 of
 * `no-tool-run-writeback.test.ts`'s currently-passing assertions, because every call
 * started sending `stream: true` and the existing stub server (and, by the same logic,
 * any real deployment nobody has verified end-to-end yet) does not speak SSE back --
 * `execute-run.ts` uses `deps.model.completeStream`'s mere PRESENCE to decide which path
 * to take, so a provider that unconditionally defines the method changes the behaviour
 * of every run through it, not just ones that opted in. The flag is what "opting in"
 * actually means here: default `0` reproduces every byte of pre-阶段2a behaviour, and
 * turning it on is a deliberate, separately-reviewable rollout step, not a side effect
 * of this PR merging.
 *
 * ## `tools`/tool calls (#725) -- retired by #741
 *
 * This adapter used to map `input.tools`/`input.toolExchange` to the OpenAI-compatible
 * `tools[].function.*` wire fields and parse `message.tool_calls` back out, for the TS
 * in-process tool loop `execute-run.ts` used to run. That loop is gone (see that file's
 * own header) and `ModelCallInput`/`ModelCallPort.complete()` no longer carry those fields
 * at all (`ports.ts`'s own header) -- this class went back to the pre-#725 request/response
 * shape, not a shape that merely stopped being exercised.
 */
import type {
  ModelCallInput, ModelCallPort,
} from "../../application/agent-run/ports";
import { ModelCallError } from "../../application/agent-run/ports";
import type { ReportedUsage } from "../../application/agent-run/ports";

export interface ConfiguredModelProviderConfig {
  /** The one provider name that runs may pin. Empty means: this deployment has none. */
  readonly provider: string;
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly timeoutMs: number;
  /** #654 阶段2a. Default `false` -- see this file's own header for why. */
  readonly streamEnabled: boolean;
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
    streamEnabled: env.KERNEL_MODEL_STREAM_ENABLED === "1",
  };
}

/**
 * #709 -- the OpenAI-compatible `messages` array, system first, then whatever prior turns
 * `execute-run.ts` already trimmed to budget (`input.history ?? []` -- see `ModelCallInput`'s
 * own doc comment for why this is `?? []` rather than a required field), then the current
 * turn last. Shared by `complete()` and `streamImpl()` so the two request bodies cannot
 * drift on how history gets spliced in -- they already share every other field of this
 * request shape, and a second inlined copy is exactly the kind of duplication this
 * repository's own discipline (AGENTS.md: "同一事实不得声明在两处") calls out by name.
 */
/** One OpenAI-compatible `messages[]` entry. */
interface WireMessage {
  readonly role: string;
  readonly content: string;
}

/** #709's system/history/user shape -- shared by `complete()` and `streamImpl()` so the two
 * request bodies cannot drift on how history gets spliced in. */
function buildMessages(input: ModelCallInput): readonly WireMessage[] {
  return [
    { role: "system", content: input.system },
    ...(input.history ?? []).map((m) => ({ role: m.role, content: m.content })),
    { role: "user", content: input.user },
  ];
}

/**
 * F159 —— `usage` 三个字段一起声明。
 *
 * ⚠ 在此之前这里只声明了 `total_tokens`，另外两个**一直在线上、一直被丢掉**：
 * 打的是 OpenAI 兼容接口，`usage` 对象本来就带 `prompt_tokens` / `completion_tokens`。
 * 「上游给不到所以不能拆 in/out」这个判断（曾被记为具名缺口 GAP-TOKEN-IO-SPLIT）
 * 是错的——错在没去读线上真实响应，只读了我们自己的解析类型。
 */
interface WireUsage {
  total_tokens?: unknown;
  prompt_tokens?: unknown;
  completion_tokens?: unknown;
}

interface CompletionResponse {
  choices?: { message?: { content?: unknown } }[];
  usage?: WireUsage;
}

/** One OpenAI-compatible `chat.completion.chunk` SSE payload. */
interface CompletionChunk {
  choices?: { delta?: { content?: unknown }; finish_reason?: unknown }[];
  usage?: WireUsage;
}

/** 非负有限数才算「报了」；其它一律 `undefined`（没报），不在这一层造 0。 */
function readCount(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

/** 线上 `usage` → 端口的 `ReportedUsage`。三维各自可缺。 */
function readUsage(usage: WireUsage | undefined): ReportedUsage {
  return {
    total: readCount(usage?.total_tokens),
    prompt: readCount(usage?.prompt_tokens),
    completion: readCount(usage?.completion_tokens),
  };
}

export class ConfiguredModelProvider implements ModelCallPort {
  private readonly config: ConfiguredModelProviderConfig;

  /**
   * Present ONLY when `config.streamEnabled` -- an explicit constructor-body assignment,
   * not a class-field initializer, so there is no ambiguity about whether `this.config`
   * is set before this decision runs. `execute-run.ts` treats the mere presence of this
   * property as "this port can stream", so the ternary here IS the opt-in gate, not just
   * an implementation detail.
   */
  readonly completeStream?: (
    input: ModelCallInput,
    onDelta: (delta: string) => Promise<void>,
  ) => Promise<{ readonly text: string; readonly tokens?: number; readonly promptTokens?: number; readonly completionTokens?: number }>;

  constructor(config: ConfiguredModelProviderConfig) {
    this.config = config;
    this.completeStream = config.streamEnabled
      ? (input, onDelta) => this.streamImpl(input, onDelta)
      : undefined;
  }

  async complete(input: ModelCallInput): Promise<
    { readonly text: string; readonly tokens?: number; readonly promptTokens?: number; readonly completionTokens?: number }
  > {
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
          messages: buildMessages(input),
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
      /*
       * F159（coord-main 裁决②修正）—— 失败体里**只**取 `usage` 的三个数字。
       *
       * 这里原本一个字节都不读，理由写在原注释里：错误体常带 host / port / 有时是带
       * 凭据的 URL。那条纪律没有松动——下面读出来的只有 `usage` 里的数字，错误文本
       * 依然不进 `detail`、不进日志、不进任何响应。之所以要读：部分 4xx 上游照样计费
       * prompt tokens 并把 usage 放在错误体里，一律记 0 会让那部分钱在账上凭空消失。
       * 读不动（非 JSON / 体已被消费）就当没报，不让它影响失败本身。
       */
      let failedUsage: ReportedUsage | undefined;
      try {
        failedUsage = readUsage(((await response.json()) as CompletionResponse).usage);
      } catch {
        failedUsage = undefined;
      }
      throw new ModelCallError(
        "MODEL_CALL_FAILED",
        `model provider responded with HTTP ${response.status}`,
        failedUsage,
      );
    }

    let parsed: CompletionResponse;
    try {
      parsed = await response.json() as CompletionResponse;
    } catch {
      throw new ModelCallError("MODEL_CALL_FAILED", "model provider response was not JSON");
    }
    const message = parsed.choices?.[0]?.message;
    const content = message?.content;
    if (typeof content !== "string" || content.trim() === "") {
      throw new ModelCallError("MODEL_CALL_FAILED", "model provider returned no content");
    }
    // Read straight off the wire response, never computed. Absent or non-numeric ⇒
    // `undefined` (the port's "not reported" state) -- not `0` invented at this layer.
    const usage = readUsage(parsed.usage);
    return { text: content, tokens: usage.total, promptTokens: usage.prompt, completionTokens: usage.completion };
  }

  /**
   * #654 阶段2a — the streaming variant, only reachable via `this.completeStream` when
   * `streamEnabled` (see constructor). Same request shape as `complete()`, `stream: true`
   * instead of `false`, and the SSE body is decoded incrementally: each
   * `chat.completion.chunk`'s `choices[0].delta.content` is handed to `onDelta` the moment
   * it arrives, in order. The final `{ text, tokens }` is the concatenation of every
   * fragment -- the SAME shape `complete()` returns, not a different contract.
   *
   * Whatever the provider says on failure NEVER reaches the caller here either: every
   * error path collapses to the same enumerated `ModelCallError` codes `complete()` uses.
   */
  private async streamImpl(
    input: ModelCallInput,
    onDelta: (delta: string) => Promise<void>,
  ): Promise<{ readonly text: string; readonly tokens?: number; readonly promptTokens?: number; readonly completionTokens?: number }> {
    const { provider, baseUrl, apiKey, timeoutMs } = this.config;
    if (provider === "" || baseUrl === "" || apiKey === "") {
      throw new ModelCallError(
        "MODEL_PROVIDER_NOT_CONFIGURED",
        "no model provider is configured for this deployment",
      );
    }
    if (input.modelProvider !== provider) {
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
          stream: true,
          messages: buildMessages(input),
        }),
      });
    } catch {
      throw new ModelCallError("MODEL_CALL_FAILED", "model provider transport failure");
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      throw new ModelCallError(
        "MODEL_CALL_FAILED",
        `model provider responded with HTTP ${response.status}`,
      );
    }
    if (response.body === null) {
      throw new ModelCallError("MODEL_CALL_FAILED", "model provider returned no stream body");
    }

    let text = "";
    let usage: ReportedUsage = {};
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        // SSE frames are separated by a blank line; a frame may still be incomplete at the
        // end of `buffer` (the socket delivered a partial frame), so only fully-terminated
        // ones are consumed here and the remainder stays for the next read.
        let boundary = buffer.indexOf("\n\n");
        while (boundary !== -1) {
          const frame = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          boundary = buffer.indexOf("\n\n");
          for (const line of frame.split("\n")) {
            const trimmed = line.trim();
            if (!trimmed.startsWith("data:")) continue; // SSE comments/keep-alives: not data.
            const payload = trimmed.slice("data:".length).trim();
            if (payload === "[DONE]") continue;
            let chunk: CompletionChunk;
            try {
              chunk = JSON.parse(payload) as CompletionChunk;
            } catch {
              // A malformed frame is a wire hiccup, not proof the whole call failed --
              // `complete()` already treats "not JSON" as fatal for the ONE reply it gets;
              // here one bad frame among dozens is not that same signal, so it is skipped.
              continue;
            }
            const delta = chunk.choices?.[0]?.delta?.content;
            if (typeof delta === "string" && delta !== "") {
              text += delta;
              await onDelta(delta);
            }
            // 流式的 usage 通常只在最后一帧出现；每帧覆盖式合并，缺的维度保留上一次的值，
            // 不用后来的 undefined 把已经报过的数抹掉。
            const framed = readUsage(chunk.usage);
            usage = {
              total: framed.total ?? usage.total,
              prompt: framed.prompt ?? usage.prompt,
              completion: framed.completion ?? usage.completion,
            };
          }
        }
      }
    } catch (e) {
      if (e instanceof ModelCallError) throw e;
      throw new ModelCallError("MODEL_CALL_FAILED", "model provider stream transport failure");
    }

    return { text, tokens: usage.total, promptTokens: usage.prompt, completionTokens: usage.completion };
  }
}
