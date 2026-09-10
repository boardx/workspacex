/**
 * #1560 · P1 —— `AttachmentVisionPort` 的阿里云百炼（DashScope）多模态实现。
 *
 * ## 复用同一把 key，不是新申请
 *
 * `KERNEL_MODEL_API_KEY`（DashScope，同 `configured-model-provider.ts` / `bailian-image-provider.ts`
 * 用的那把）覆盖百炼全平台模型——人类原话「使用相同的登录API tok就可以使用所有的阿里云百炼平台的模型」，
 * 与 `bailian-image-provider.ts:17-21` 记录的实测一致。所以这里**不新增** key 环境变量。
 *
 * ## 模型名：2026-09-10 已实测（#3355）
 *
 * `bailian-image-provider.ts:14-15` 有血的教训：`wanx2.2-t2i-plus` 报 "Model not exist"、
 * `wanx2.1-t2i-plus` 才可用——「不要被『2.2 应该比 2.1 新』这种直觉带偏」。本文件写成时开发机上
 * 没有 `KERNEL_MODEL_API_KEY`，默认名一直是**待实测的占位**；2026-09-10 在私有 MaaS 端点实测
 * 完成，结论与清单都记在 `domain/model/vision-capable-models.ts`，本文件不复述。
 *
 * 首次部署（或换区域/换账号）时，在有 key 的环境跑：
 *     node apps/api/scripts/probe-vision-model.mjs
 * 它逐个探测候选模型名，打印哪些真的可用；把实测通过的名字加进**唯一权威清单**
 * `domain/model/vision-capable-models.ts`（#3355 起——不要再写进 `KERNEL_VISION_MODEL_ID`，
 * 那个变量已弃用）。
 *
 * 模型名不可用时**不猜第二个名字重试**：如实回 `visionModelUnavailable`，落到附件的
 * `extraction_error` 上，宁可看得见地失败，也不要静默换一个模型产出无人知道来源的内容。
 *
 * ## 请求形状（DashScope 原生多模态接口，与文生图的异步任务不同：这条是同步返回）
 *
 *   POST {baseUrl}/api/v1/services/aigc/multimodal-generation/generation
 *   { model, input: { messages: [{ role:"user", content:[{ image: "data:<mime>;base64,…" }, { text }] }] } }
 *   → { output: { choices: [{ message: { content: [{ text }] } }] } }
 *
 * `baseUrl` 可配（`KERNEL_VISION_BASE_URL`），理由同 `bailian-image-provider.ts`：硬编码域名会让
 * 这条 provider 永远无法被真实 HTTP e2e 测过完整闭环，只能测到"参数拼对了"。
 */
import {
  composeVisionMarkdown, parseVisionReply, VISION_PROMPT,
} from "../../domain/chat/attachment-vision";
import {
  DEFAULT_VISION_EXTRACTOR_MODEL_ID, resolveVisionExtractorModelId,
} from "../../domain/model/vision-capable-models";
import type {
  AttachmentVisionPort, VisionErrorCode, VisionResult,
} from "../../application/chat/attachment-vision.port";

const DEFAULT_BASE_URL = "https://dashscope.aliyuncs.com";

/**
 * #3355 —— 默认模型名**不再在这里声明**。它是「哪个模型能看图」的一个切面，权威清单住在
 * `domain/model/vision-capable-models.ts`；此前这里的手写默认与 `KERNEL_MODEL_VISION_IDS`
 * 的手写默认是两处独立声明（名字只差一个 S，默认值还不同），两份都漏了部署实际在用的
 * `qwen3.8-max`。
 *
 * 本 re-export 保留为既有调用点/测试的稳定名字，取值与收敛前**逐字节相同**
 * （`tests/model/vision-model-single-source.test.ts` 钉住这一条）。
 */
export const DEFAULT_VISION_MODEL_ID = DEFAULT_VISION_EXTRACTOR_MODEL_ID;

/**
 * 单图字节上限。DashScope 对 base64 内联图片有请求体上限（文档口径约 10MB 量级），超了先在本地
 * 诚实拒（`visionImageTooLarge`），不把一个注定被拒的大请求发出去。可配以便实测后校准。
 */
export const DEFAULT_VISION_MAX_IMAGE_BYTES = 10 * 1024 * 1024;

export interface BailianVisionConfig {
  readonly apiKey: string;
  readonly modelId: string;
  readonly baseUrl: string;
  readonly timeoutMs: number;
  readonly maxImageBytes: number;
}

export function readBailianVisionConfig(env: NodeJS.ProcessEnv = process.env): BailianVisionConfig {
  const timeout = Number(env.KERNEL_VISION_TIMEOUT_MS ?? "60000");
  const maxBytes = Number(env.KERNEL_VISION_MAX_IMAGE_BYTES ?? "");
  return {
    apiKey: env.KERNEL_MODEL_API_KEY ?? "",
    modelId: resolveVisionExtractorModelId(env),
    baseUrl: (env.KERNEL_VISION_BASE_URL ?? "").trim() || DEFAULT_BASE_URL,
    timeoutMs: Number.isFinite(timeout) && timeout > 0 ? timeout : 60_000,
    maxImageBytes: Number.isFinite(maxBytes) && maxBytes > 0 ? maxBytes : DEFAULT_VISION_MAX_IMAGE_BYTES,
  };
}

interface GenerationResponse {
  readonly code?: string;
  readonly message?: string;
  readonly output?: {
    readonly text?: string;
    readonly choices?: readonly {
      readonly message?: { readonly content?: unknown };
    }[];
  };
}

export class BailianVisionExtractor implements AttachmentVisionPort {
  constructor(private readonly config: BailianVisionConfig = readBailianVisionConfig()) {}

  async describeImage(bytes: Uint8Array, mime: string): Promise<VisionResult> {
    const { apiKey, modelId, baseUrl, timeoutMs, maxImageBytes } = this.config;
    if (apiKey === "") return fail("visionNotConfigured");
    if (bytes.byteLength > maxImageBytes) return fail("visionImageTooLarge");

    const dataUrl = `data:${mime};base64,${Buffer.from(bytes).toString("base64")}`;
    let response: Response;
    try {
      response = await fetch(`${baseUrl}/api/v1/services/aigc/multimodal-generation/generation`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: modelId,
          input: {
            messages: [{ role: "user", content: [{ image: dataUrl }, { text: VISION_PROMPT }] }],
          },
        }),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      // 网络/超时——可重试，不是终态失败（worker 会返回 "retry" 交 outbox）。
      return fail("visionTransport");
    }

    const body = (await response.json().catch(() => ({}))) as GenerationResponse;
    if (!response.ok) return fail(classifyHttpFailure(response.status, body));

    const text = readReplyText(body);
    // 上游 200 了但没给出可用文本——如实回 rejected，**绝不**用空 markdown 冒充抽取成功。
    if (text.trim() === "") return fail("visionRejected");

    return {
      ok: true,
      modelId,
      markdown: composeVisionMarkdown({ modelId, reply: parseVisionReply(text) }),
    };
  }
}

/**
 * HTTP 失败分类。模型名问题必须**单独可见**（这正是 wanx2.2 那次踩的坑：错误被笼统当成
 * "调用失败"，没人看出来是模型名不存在）。
 */
function classifyHttpFailure(status: number, body: GenerationResponse): VisionErrorCode {
  const marker = `${body.code ?? ""} ${body.message ?? ""}`.toLowerCase();
  if (marker.includes("model not exist") || marker.includes("model.notexist")
    || marker.includes("invalidparameter: model") || marker.includes("modelnotfound")) {
    return "visionModelUnavailable";
  }
  if (status === 404) return "visionModelUnavailable";
  if (status === 401 || status === 403) return "visionNotConfigured"; // key 无效/无权——非 transport
  if (status === 429 || status >= 500) return "visionTransport"; // 限流/上游故障——可重试
  return "visionRejected";
}

/** 取回复文本：多模态回复的 `content` 是 `[{text}]` 数组；也兼容部分模型的 `output.text`。 */
function readReplyText(body: GenerationResponse): string {
  const content = body.output?.choices?.[0]?.message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => (typeof part === "string" ? part : (part as { text?: unknown } | null)?.text))
      .filter((t): t is string => typeof t === "string")
      .join("\n");
  }
  return body.output?.text ?? "";
}

function fail(code: VisionErrorCode): VisionResult {
  return { ok: false, code };
}
