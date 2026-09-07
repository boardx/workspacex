/**
 * `BailianImageProvider` -- the third `ModelCallPort` implementation (2026-08-07, 人类直接
 * 指令："这里要可以直接看到图片，不是只是文字"——`gpt-image-2` 技能在没有任何
 * 图像生成工具的情况下只能退化成"写一段 prompt 交给用户"，人类要的是真的看到图。
 *
 * ## 真实验证过的 API 形状（不是抄文档，是拿生产 key 实测的）
 *
 * 阿里云百炼（DashScope）的文生图是**异步任务**：提交一次拿到 `task_id`，用同一个
 * key 轮询 `GET /api/v1/tasks/{task_id}` 直到 `task_status` 变成 `SUCCEEDED`/
 * `FAILED`，成功时 `output.results[0].url` 是一个有时效的签名 URL（本次实测约 10
 * 分钟内验证：提交→约 14 秒后 SUCCEEDED，返回了真实可访问的 oss 图片链接）。
 * 模型名验证结果：`wanx2.1-t2i-plus` 可用（`wanx2.2-t2i-plus` 报 "Model not exist"，
 * 不要被"2.2 应该比 2.1 新"这种直觉带偏——两边都是真实探测出来的，不是猜的）。
 *
 * ## 复用同一个 API key，不是新申请
 *
 * `KERNEL_MODEL_API_KEY`（DashScope，同 `configured-model-provider.ts` 用的那个）对
 * 图片生成端点同样有效——阿里云百炼一个 key 覆盖文本/图片/视频等全部模型，人类原话
 * "使用相同的登录API tok就可以使用所有的阿里云百炼平台的模型"，与这里的实测结果一致。
 *
 * ## 结果怎么变成"能直接看到的图片"，不需要改消息 schema
 *
 * 这个 port 的返回值仍然只是 `{ text }`（`ModelCallPort` 接口没变）——把图片 URL
 * 包成 markdown 图片语法 `![prompt](url)` 塞进 `text`。前端消息面板已经在用
 * `@copilotkit/react-ui` 的 `Markdown` 组件渲染 agent 回复（`chat-live-message-panel.tsx`，
 * #654/#670），markdown 图片语法会被原样渲染成 `<img>`——不需要新的消息类型、新的
 * 附件字段，复用已经存在且已验证的渲染路径。
 *
 * ## `baseUrl` 可配置，同 `deep-research-model-provider.ts` 的道理
 *
 * 不硬编码 `https://dashscope.aliyuncs.com`：那样会让这个 provider 永远无法被真实
 * e2e 测过"提交→轮询→取图"的完整闭环——测试只能验证参数拼对了，验证不了轮询循环
 * 本身。生产走 `KERNEL_BAILIAN_IMAGE_BASE_URL` 未设置时的默认值（真实 DashScope
 * 域名），测试指向一个本地 stub HTTP 服务器。
 */
import { setTimeout as delay } from "node:timers/promises";
import type { ModelCallInput } from "../../application/agent-run/ports";
import { ModelCallError, type ModelCallPort } from "../../application/agent-run/ports";

export const BAILIAN_IMAGE_PROVIDER_NAME = "bailian-image";
const DEFAULT_BASE_URL = "https://dashscope.aliyuncs.com";

export interface BailianImageProviderConfig {
  readonly apiKey: string;
  /** 实测可用的模型名——见文件头注，不是文档抄来的。 */
  readonly modelId: string;
  readonly pollIntervalMs: number;
  readonly timeoutMs: number;
  /** 同 `deep-research-model-provider.ts` 的 `baseUrl` 一样可配置——测试用 stub 服务器
   *  顶替真实 DashScope 域名，生产走默认值。硬编码域名会让这条 provider 无法被真实
   *  e2e 测过完整的"提交→轮询→取图"闭环，只能测到"参数拼对了"这一层。 */
  readonly baseUrl: string;
}

export function readBailianImageProviderConfig(
  env: NodeJS.ProcessEnv = process.env,
): BailianImageProviderConfig {
  const timeout = Number(env.KERNEL_BAILIAN_IMAGE_TIMEOUT_MS ?? "120000");
  const pollInterval = Number(env.KERNEL_BAILIAN_IMAGE_POLL_INTERVAL_MS ?? "3000");
  return {
    // 同一把 DashScope key，跟聊天用的那把是同一个 env var——见文件头注。
    apiKey: env.KERNEL_MODEL_API_KEY ?? "",
    modelId: (env.KERNEL_BAILIAN_IMAGE_MODEL_ID ?? "").trim() || "wanx2.1-t2i-plus",
    timeoutMs: Number.isFinite(timeout) && timeout > 0 ? timeout : 120_000,
    pollIntervalMs: Number.isFinite(pollInterval) && pollInterval > 0 ? pollInterval : 3_000,
    baseUrl: (env.KERNEL_BAILIAN_IMAGE_BASE_URL ?? "").trim() || DEFAULT_BASE_URL,
  };
}

interface SubmitResponse {
  readonly output?: { readonly task_id?: string };
  readonly code?: string;
  readonly message?: string;
}

interface TaskResponse {
  readonly output?: {
    readonly task_status?: string;
    readonly results?: readonly { readonly url?: string }[];
  };
}

export class BailianImageProvider implements ModelCallPort {
  constructor(private readonly config: BailianImageProviderConfig) {}

  async complete(input: ModelCallInput): Promise<{ readonly text: string; readonly tokens?: number }> {
    const { apiKey } = this.config;
    if (apiKey === "") {
      throw new ModelCallError("MODEL_PROVIDER_NOT_CONFIGURED", "KERNEL_MODEL_API_KEY is not set for this deployment");
    }
    if (input.modelProvider !== BAILIAN_IMAGE_PROVIDER_NAME) {
      throw new ModelCallError(
        "MODEL_PROVIDER_NOT_CONFIGURED",
        `run pinned provider "${input.modelProvider}", this port only serves "${BAILIAN_IMAGE_PROVIDER_NAME}"`,
      );
    }

    const image = await this.generateImage(input.user);
    return { text: `![${truncateForAlt(input.user.trim())}](${image.url})` };
  }

  /** Structured result for the standard image tool; persistence remains the existing artifact path. */
  async generateImage(prompt: string, callerSignal?: AbortSignal): Promise<{url:string;taskId:string;modelRef:string}> {
    const {apiKey,modelId,baseUrl}=this.config;
    if (!apiKey) throw new ModelCallError("MODEL_PROVIDER_NOT_CONFIGURED", "image provider is not configured");
    if (!prompt.trim() || prompt.length > 16_384) throw new ModelCallError("MODEL_CALL_FAILED", "image prompt is invalid");
    const timeoutMs=Math.min(120_000,Math.max(1,this.config.timeoutMs));
    const signal=callerSignal ? AbortSignal.any([callerSignal,AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs);
    try {
      signal.throwIfAborted();
      const taskId=await this.submit(baseUrl,apiKey,modelId,prompt.trim(),signal);
      while (true) {
        signal.throwIfAborted();
        const {status,url}=await this.readTask(baseUrl,apiKey,taskId,signal);
        if(status==='SUCCEEDED') {
          if(!url)throw new Error('missing image');
          const parsed=new URL(url);
          if(parsed.protocol!=='https:'||parsed.username||parsed.password||/[\s()<>]/.test(url))throw new Error('invalid image');
          return {url,taskId,modelRef:modelId};
        }
        if(!['PENDING','RUNNING'].includes(status))throw new Error('terminal failure');
        await delay(Math.min(3000,Math.max(1,this.config.pollIntervalMs)),undefined,{signal});
      }
    } catch {
      // No retry: a lost submission acknowledgement may already have created a vendor task.
      throw new ModelCallError("MODEL_CALL_FAILED", "image generation failed, was cancelled, or exceeded its deadline");
    }
  }

  private async submit(baseUrl: string, apiKey: string, modelId: string, prompt: string, signal: AbortSignal): Promise<string> {
    let response: Response;
    try {
      response = await fetch(`${baseUrl}/api/v1/services/aigc/text2image/image-synthesis`, {
        method: "POST", signal, redirect: "error",
        headers: {
          "content-type": "application/json",
          "accept-encoding": "identity",
          authorization: `Bearer ${apiKey}`,
          "X-DashScope-Async": "enable",
        },
        body: JSON.stringify({
          model: modelId,
          input: { prompt },
          parameters: { size: "1024*1024", n: 1 },
        }),
      });
    } catch {
      throw new ModelCallError("MODEL_CALL_FAILED", "image provider transport failure");
    }
    const body = await readBoundedJson(response) as SubmitResponse;
    if (!response.ok || typeof body.output?.task_id !== 'string' || !/^[A-Za-z0-9_-]{1,256}$/.test(body.output.task_id)) {
      throw new ModelCallError("MODEL_CALL_FAILED", `image task submission failed with HTTP ${response.status}`);
    }
    return body.output.task_id;
  }

  private async readTask(baseUrl: string, apiKey: string, taskId: string, signal: AbortSignal): Promise<{ status: string; url: string | null }> {
    let response: Response;
    try {
      response = await fetch(`${baseUrl}/api/v1/tasks/${taskId}`, {
        signal, redirect: "error",
        headers: { authorization: `Bearer ${apiKey}`, "accept-encoding": "identity" },
      });
    } catch {
      throw new ModelCallError("MODEL_CALL_FAILED", "image provider transport failure");
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new ModelCallError("MODEL_CALL_FAILED", `image task status read failed with HTTP ${response.status}`);
    }
    const body = await readBoundedJson(response) as TaskResponse;
    return {
      status: body.output?.task_status ?? "UNKNOWN",
      url: body.output?.results?.[0]?.url ?? null,
    };
  }
}

/** markdown alt text 不能带方括号/换行，粗暴截断即可——它只是给不能看图的场合用的替代文本。 */
function truncateForAlt(prompt: string): string {
  const cleaned = prompt.replace(/[[\]\n]/g, " ").slice(0, 100);
  return cleaned.length < prompt.length ? `${cleaned}…` : cleaned;
}

async function readBoundedJson(response:Response):Promise<unknown> {
  if(response.headers.get('content-encoding') && response.headers.get('content-encoding')!=='identity') {
    await response.body?.cancel();throw new Error('unsupported provider encoding');
  }
  if(!response.body)throw new Error('empty provider response');
  const reader=response.body.getReader();const chunks:Uint8Array[]=[];let size=0;
  try {
    while(true){const {done,value}=await reader.read();if(done)break;
      size+=value.length;if(size>65536)throw new Error('provider response too large');chunks.push(value);
    }
    return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));
  } finally {await reader.cancel().catch(()=>{});reader.releaseLock();}
}
