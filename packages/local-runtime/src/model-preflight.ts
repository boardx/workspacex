/**
 * 「模型在列表里」和「模型能回话」是两件事。
 *
 * `up()` 此前的判据是 Ollama 的 `/api/tags` 里有没有那个标签。那条判据过不了的情况很多，
 * 而它们的共同点是**都要等用户发出第一条消息才暴露**：
 *
 *   · 权重下载到一半被中断，标签在、文件不全；
 *   · 显存/内存不够，加载即失败；
 *   · 标签名对得上、但 OpenAI 兼容端点用的 id 不是那个（`qwen3.5:4b` vs `qwen3.5:4b-q4_K_M`）；
 *   · 用户自己的 `ollama serve` 被复用，而那个实例的模型目录是另一个。
 *
 * 这些的表现都是「聊天框转圈然后报一个通用错误」——用户学不到任何可执行的信息，而启动
 * 那一刻本来有机会把话说清楚。所以启动时就发一次**最小的真实调用**：一个 token 的补全，
 * 和一次 embedding。
 *
 * ⚠ 失败**不中止启动**。没有模型的 WorkspaceX Local 仍然是可用的：画布、模板、文档、
 *   已有数据都在。中止启动会把「少一条能力」升级成「打不开」。
 * ⚠ 超时给得比较宽（冷启动要把几个 GB 的权重读进内存），但仍然有上限：一个永远不返回的
 *   端点不该让启动界面无限期停在这一步。
 */
export interface ModelProbeResult {
  readonly ok: boolean;
  /** 失败时一句可执行的话；成功时 null。 */
  readonly detail: string | null;
  /** 真实往返耗时，写进启动日志——本地模型的第一印象就是这个数。 */
  readonly elapsedMs: number;
}

export interface ProbeOptions {
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly model: string;
  readonly timeoutMs?: number;
  readonly fetchImpl?: typeof fetch;
}

const DEFAULT_TIMEOUT_MS = 120_000;

/** 一次一个 token 的补全。能过这一条，聊天链路的模型侧就是通的。 */
export async function probeChatModel(opts: ProbeOptions): Promise<ModelProbeResult> {
  return probe(opts, "/chat/completions", {
    model: opts.model,
    messages: [{ role: "user", content: "hi" }],
    max_tokens: 1,
    stream: false,
  });
}

/** 一次 embedding。检索/记忆链路用的是另一个模型，不能靠聊天那次顺带证明。 */
export async function probeEmbeddingModel(opts: ProbeOptions): Promise<ModelProbeResult> {
  return probe(opts, "/embeddings", { model: opts.model, input: "hi" });
}

async function probe(opts: ProbeOptions, path: string, body: unknown): Promise<ModelProbeResult> {
  const doFetch = opts.fetchImpl ?? fetch;
  const started = Date.now();
  try {
    const res = await doFetch(`${opts.baseUrl.replace(/\/+$/, "")}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${opts.apiKey}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(opts.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });
    const elapsedMs = Date.now() - started;
    if (res.ok) return { ok: true, detail: null, elapsedMs };
    // 服务端的原话比我们能编的任何话都有用（Ollama 会直接说 model not found / out of memory）。
    const text = (await res.text().catch(() => "")).trim().slice(0, 400);
    return {
      ok: false,
      elapsedMs,
      detail: `模型 ${opts.model} 调用返回 HTTP ${res.status}${text === "" ? "" : `：${text}`}`,
    };
  } catch (e) {
    const elapsedMs = Date.now() - started;
    const reason = e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      elapsedMs,
      detail: /timed?\s*out|aborted/i.test(reason)
        ? `模型 ${opts.model} 在 ${Math.round(elapsedMs / 1000)} 秒内没有响应（首次加载权重可能很慢；` +
          "内存不足时也会卡在这里)"
        : `模型 ${opts.model} 无法调用：${reason}`,
    };
  }
}
