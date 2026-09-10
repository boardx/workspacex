/**
 * `OpenAiImageProvider` —— `wx_image_generate` 的第二条供应商实现（人类直接指令
 * 2026-09-10：「我需要你可以接入 openai」）。
 *
 * ## 与百炼那条的形状差异（这是本文件存在的全部理由）
 *
 * `BailianImageProvider` 是**异步任务**：提交拿 `task_id` → 轮询到 `SUCCEEDED` →
 * 拿一个有时效的签名 URL，字节由 `GeneratedImageDownloader` 带着出网守卫去取。
 *
 * OpenAI Images 是**同步**：一次 `POST /v1/images/generations` 就返回结果，而且
 * `gpt-image-*` 系列**只回 base64（`b64_json`），根本不给 URL**——没有第二跳可下载。
 * 所以这条 provider 走 `GeneratedImage` 的 `inline` 分支把字节直接交回去；
 * `dall-e-3` 那类仍会回 `url` 的模型也照常支持（响应里给什么就用什么），
 * 判别逻辑只有一处，见下面 `pickDelivery`。
 *
 * ⚠ **没有 vendor 任务 id 可用**。同步接口不返回作业标识，而 `ImageGenerated.taskId`
 * 是必填（回执要能指回这次供应商调用）。这里如实合成一个
 * `openai:<model>:<created>`，不假装它是 OpenAI 那边的作业号——把 `created` 原样
 * 带上，至少能和账单/日志对时间。
 *
 * ## 响应体的读取上限不能抄 `bailian-image-provider.ts` 的 64KB
 *
 * 那条只读一小段 JSON（task_id / status / url）。这条的 JSON 里**装着整张图的
 * base64**：8MB 上限（`limits.maxFileBytes`）经 base64 膨胀约 10.7MB。抄 64KB 会让
 * 每一次真实调用都以「provider response too large」失败——而且失败得很像"上游挂了"。
 * 上限按 `IMAGE_GENERATE_LIMITS.maxBytes` 推导，不写死数字。
 *
 * ## 活性：读循环自己拿 deadline（照抄 #3175 的教训，不是照抄代码）
 *
 * `fetch` 在**响应头一到**就 resolve，此后 `reader.read()` 能不能被打断 100% 取决于
 * 底层 transport 是否愿意在 signal 触发时销毁 body。`bailian-image-provider.ts` 的
 * `readBoundedJson` 头注记着这条真实事故（CI 上卡满 60s = promise 从没 settle）。
 * 这里的读循环同样用 `abortable(...)` 把每次 `read()` 包起来，不把活性外包给善意。
 */
import { ModelCallError } from "../../application/agent-run/ports";
import { IMAGE_GENERATE_LIMITS as L } from "@repo/contracts/standard-image-tools";
import type { GeneratedImage, ImageGenerator } from "../../application/agent-run/standard-image-tools";

export const OPENAI_IMAGE_PROVIDER_NAME = "openai-image";
const DEFAULT_BASE_URL = "https://api.openai.com";
/** OpenAI 现役的图像模型名。真要换（比如上游发布了新一代），设 `KERNEL_OPENAI_IMAGE_MODEL_ID`，
 *  不要改这里的默认值去猜一个还没验证过的名字——`wanx2.2-t2i-plus` 那次「2.2 应该比 2.1 新」
 *  的直觉就是这么错的（见 `bailian-image-provider.ts` 头注）。 */
const DEFAULT_MODEL_ID = "gpt-image-1";
/** base64 比原始字节大 4/3，再留一点 JSON 结构与其它字段的余量。 */
const MAX_RESPONSE_BYTES = 4 * Math.ceil(L.maxBytes / 3) + 65_536;

export interface OpenAiImageProviderConfig {
  readonly apiKey: string;
  readonly modelId: string;
  readonly baseUrl: string;
  readonly timeoutMs: number;
  /** OpenAI 组织/项目头，未设则不发——不是必填。 */
  readonly organization: string | null;
  readonly project: string | null;
}

export function readOpenAiImageProviderConfig(env: NodeJS.ProcessEnv = process.env): OpenAiImageProviderConfig {
  const timeout = Number(env.KERNEL_OPENAI_IMAGE_TIMEOUT_MS ?? "120000");
  return {
    apiKey: (env.KERNEL_OPENAI_API_KEY ?? env.OPENAI_API_KEY ?? "").trim(),
    modelId: (env.KERNEL_OPENAI_IMAGE_MODEL_ID ?? "").trim() || DEFAULT_MODEL_ID,
    baseUrl: ((env.KERNEL_OPENAI_IMAGE_BASE_URL ?? "").trim() || DEFAULT_BASE_URL).replace(/\/+$/, ""),
    timeoutMs: Number.isFinite(timeout) && timeout > 0 ? Math.min(300_000, timeout) : 120_000,
    organization: (env.KERNEL_OPENAI_ORGANIZATION ?? "").trim() || null,
    project: (env.KERNEL_OPENAI_PROJECT ?? "").trim() || null,
  };
}

interface ImagesResponse {
  readonly created?: number;
  readonly data?: readonly { readonly b64_json?: string; readonly url?: string }[];
}

export class OpenAiImageProvider implements ImageGenerator {
  constructor(private readonly config: OpenAiImageProviderConfig) {}

  get modelRef(): string { return this.config.modelId; }

  async generateImage(prompt: string, callerSignal?: AbortSignal): Promise<GeneratedImage> {
    const { apiKey, modelId, baseUrl, timeoutMs } = this.config;
    if (!apiKey) throw new ModelCallError("MODEL_PROVIDER_NOT_CONFIGURED", "image provider is not configured");
    if (!prompt.trim() || prompt.length > 16_384) throw new ModelCallError("MODEL_CALL_FAILED", "image prompt is invalid");
    const signal = callerSignal
      ? AbortSignal.any([callerSignal, AbortSignal.timeout(timeoutMs)])
      : AbortSignal.timeout(timeoutMs);
    try {
      signal.throwIfAborted();
      const body = await this.submit(baseUrl, apiKey, modelId, prompt.trim(), signal);
      return pickDelivery(body, modelId);
    } catch {
      // 不重试：同步接口的一次「确认丢失」同样可能已经在上游产生了一次计费调用。
      // 幂等由 `DefaultStandardImageService` 的 intent/result 对象负责，不在这一层重来。
      throw new ModelCallError("MODEL_CALL_FAILED", "image generation failed, was cancelled, or exceeded its deadline");
    }
  }

  private async submit(baseUrl: string, apiKey: string, modelId: string, prompt: string, signal: AbortSignal): Promise<ImagesResponse> {
    const headers: Record<string, string> = {
      "content-type": "application/json",
      "accept-encoding": "identity",
      authorization: `Bearer ${apiKey}`,
    };
    if (this.config.organization) headers["openai-organization"] = this.config.organization;
    if (this.config.project) headers["openai-project"] = this.config.project;
    // `response_format` 只对 `dall-e-*` 合法——`gpt-image-*` 收到它会 400（它恒回
    // base64）。这不是可以「都发一遍反正无害」的参数，所以按模型名分流。
    const payload: Record<string, unknown> = { model: modelId, prompt, n: 1, size: `${L.dimension}x${L.dimension}` };
    if (modelId.startsWith("dall-e")) payload.response_format = "b64_json";
    let response: Response;
    try {
      response = await fetch(`${baseUrl}/v1/images/generations`, {
        method: "POST", signal, redirect: "error", headers, body: JSON.stringify(payload),
      });
    } catch {
      throw new ModelCallError("MODEL_CALL_FAILED", "image provider transport failure");
    }
    if (!response.ok) {
      // 上游的错误正文留在服务端（同 `bailian-image-provider.ts` 的纪律）：调用方只该
      // 知道这次失败了，不该拿到供应商回的原文。
      await response.body?.cancel();
      throw new ModelCallError("MODEL_CALL_FAILED", `image generation failed with HTTP ${response.status}`);
    }
    return await readBoundedJson(response, signal) as ImagesResponse;
  }
}

/**
 * 响应里给 base64 就走 inline，给 URL 就走 url——**判别只在这一处**，调用方不需要
 * 知道用的是哪个模型。两者都没有 ⇒ 显式失败，不返回一个空壳让下游去猜。
 */
export function pickDelivery(body: ImagesResponse, modelId: string): GeneratedImage {
  const first = body.data?.[0];
  const taskId = `openai:${modelId}:${typeof body.created === "number" ? body.created : "unknown"}`.slice(0, 256);
  if (typeof first?.b64_json === "string" && first.b64_json !== "") {
    const bytes = Buffer.from(first.b64_json, "base64");
    // `Buffer.from(..., 'base64')` 对垃圾输入不抛错，会静默返回一段短 buffer——
    // 空 buffer 是「解码失败」唯一能被这里看见的信号，必须显式拦，否则一段 0 字节的
    // "图片" 会一路走到 workspace 写入才炸。
    if (bytes.length === 0) throw new ModelCallError("MODEL_CALL_FAILED", "image provider returned undecodable base64");
    if (bytes.length > L.maxBytes) throw new ModelCallError("MODEL_CALL_FAILED", "image provider returned an oversized image");
    return { delivery: "inline", bytes, taskId, modelRef: modelId };
  }
  if (typeof first?.url === "string" && first.url !== "") {
    const raw = first.url;
    let parsed: URL;
    try { parsed = new URL(raw); } catch { throw new ModelCallError("MODEL_CALL_FAILED", "image provider returned an invalid url"); }
    // 与百炼那条同一套校验：只认 https、不带内嵌凭据、不含会破坏后续处理的空白/括号。
    if (parsed.protocol !== "https:" || parsed.username || parsed.password || /[\s()<>]/.test(raw)) {
      throw new ModelCallError("MODEL_CALL_FAILED", "image provider returned an invalid url");
    }
    return { delivery: "url", url: raw, taskId, modelRef: modelId };
  }
  throw new ModelCallError("MODEL_CALL_FAILED", "image provider returned neither image bytes nor a url");
}

/** 见文件头注「活性」一节：每次 `read()` 都由 signal 兜底，上限按图片大小推导。 */
async function readBoundedJson(response: Response, signal: AbortSignal): Promise<unknown> {
  const encoding = response.headers.get("content-encoding");
  if (encoding && encoding !== "identity") { await response.body?.cancel(); throw new Error("unsupported provider encoding"); }
  if (!response.body) throw new Error("empty provider response");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    for (;;) {
      const { done, value } = await abortable(reader.read(), signal);
      if (done) break;
      size += value.length;
      if (size > MAX_RESPONSE_BYTES) throw new Error("provider response too large");
      chunks.push(value);
    }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)));
  } finally { void reader.cancel().catch(() => {}); }
}

/** Reject as soon as `signal` fires, whatever the underlying promise decides to do. */
function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
  });
}
