import {resolveImageProfile,isRoutedImageModel,type ImageGenerateInput} from '@repo/contracts/standard-image-tools';
import type {z} from 'zod';
import {CreditConsumptionError} from "../../application/billing/credit-consumption";
/** DashScope image protocols: legacy Wanx async, Qwen3 async and Z-Image sync.
 * Shared native admission runs before vendor dispatch; generated URLs are materialized
 * by DefaultStandardImageService through the existing guarded artifact path.
 */
import {randomUUID} from "node:crypto";
import {readReportedImageQuantity,type ImageAiAdmission,type ImageAiReceipt} from "./image-ai-admission";
import { setTimeout as delay } from "node:timers/promises";
import type { ModelCallInput } from "../../application/agent-run/ports";
import { ModelCallError, type ModelCallPort } from "../../application/agent-run/ports";
import type { GeneratedImage } from "../../application/agent-run/standard-image-tools";

export const BAILIAN_IMAGE_PROVIDER_NAME = "bailian-image";
const DEFAULT_BASE_URL = "https://dashscope.aliyuncs.com";
/** Reuse only recognized official DashScope account regions, never arbitrary text endpoints. */
export function deriveBailianImageBaseUrl(textBaseUrl?:string):string {
 if(!textBaseUrl?.trim())return DEFAULT_BASE_URL;
 let url:URL;try{url=new URL(textBaseUrl);}catch{return DEFAULT_BASE_URL;}
 const official=['dashscope.aliyuncs.com','dashscope-intl.aliyuncs.com','dashscope-us.aliyuncs.com'].includes(url.hostname)
  ||/^[a-zA-Z0-9-]+\.(cn-beijing|ap-southeast-1|us-east-1|eu-central-1|ap-northeast-1|cn-hongkong)\.maas\.aliyuncs\.com$/.test(url.hostname);
 return official&&url.protocol==='https:'&&!url.username&&!url.password&&!url.port?url.origin:DEFAULT_BASE_URL;
}

export interface BailianImageProviderConfig {
  readonly apiKey: string;
  /** Fixed routed model family, or an explicitly configured legacy model. */
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
    // Reuse the configured DashScope account; base host derives the matching region.
    apiKey: env.KERNEL_MODEL_API_KEY ?? "",
    modelId: (env.KERNEL_BAILIAN_IMAGE_MODEL_ID ?? "").trim() || "qwen-image-3.0",
    timeoutMs: Number.isFinite(timeout) && timeout > 0 ? timeout : 120_000,
    pollIntervalMs: Number.isFinite(pollInterval) && pollInterval > 0 ? pollInterval : 3_000,
    baseUrl: (env.KERNEL_BAILIAN_IMAGE_BASE_URL ?? "").trim() || deriveBailianImageBaseUrl(env.KERNEL_MODEL_BASE_URL),
  };
}

interface SubmitResponse {
  readonly output?: { readonly task_id?: string };
  readonly code?: string;
  readonly message?: string;
}

interface TaskResponse {
  readonly usage?:unknown;
  readonly output?: {
    readonly task_status?: string;
    readonly results?: readonly { readonly url?: string }[];
  };
}

export class BailianImageProvider implements ModelCallPort {
  private accountingFault=false;
  constructor(private readonly config: BailianImageProviderConfig,private readonly nativeAdmission?:ImageAiAdmission,private readonly productQuotaEnabled=false) {}

  resolveRequest(input:Pick<z.infer<typeof ImageGenerateInput>,'sizeProfile'|'generationProfile'>):{modelId:string;dimension:1024|2048}{
    if(isRoutedImageModel(this.config.modelId))return resolveImageProfile(input);
    if(input.generationProfile||input.sizeProfile!=='square')throw new Error('image_profile_provider_unconfigured');
    return {modelId:this.config.modelId,dimension:1024};
  }

  supportsRequestAccounting():boolean{return Boolean(this.nativeAdmission);}

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

    if(!input.orgId||!input.runId||!input.executionAttemptId||!input.executionLeaseEpoch)throw new ModelCallError("MODEL_CALL_FAILED","IMAGE_ACCOUNTING_CONTEXT_REQUIRED");
    const image = await this.generateImage(input.user,input.signal,{orgId:input.orgId as import("../../domain/org-id").OrgId,parentRunId:input.runId,attemptId:input.executionAttemptId,leaseEpoch:input.executionLeaseEpoch});
    // DashScope image protocols deliver a URL; native tools materialize it as an artifact.
    // 联合类型的另一支属于同步返回字节的供应商（OpenAI），这里结构上到不了。
    if (image.delivery !== 'url') throw new ModelCallError("MODEL_CALL_FAILED", "bailian image provider returned a non-url delivery");
    return { text: `![${truncateForAlt(input.user.trim())}](${image.url})` };
  }

  /** Structured result for the standard image tool; persistence remains the existing artifact path. */
  async generateImage(prompt: string, callerSignal?: AbortSignal,accountingContext?:import("./image-ai-admission").ImageBillingContext,options?:Pick<z.infer<typeof ImageGenerateInput>,'sizeProfile'|'generationProfile'>): Promise<GeneratedImage> {
    if((this.productQuotaEnabled||process.env.KERNEL_AI_PRODUCT_QUOTA_ENABLED==='1')&&!this.nativeAdmission)throw new ModelCallError('MODEL_PROVIDER_NOT_CONFIGURED','AI_NATIVE_DISPATCH_ADMISSION_UNSUPPORTED');
    const {apiKey,baseUrl}=this.config;
    const modern=isRoutedImageModel(this.config.modelId);
    const selected=options?this.resolveRequest(options):{modelId:this.config.modelId,dimension:this.config.modelId==='qwen-image-3.0-pro'?2048:1024};
    const {modelId,dimension}=selected;
    const sync=modelId==='z-image-turbo';
    if(sync&&Array.from(prompt).length>800)throw new Error('IMAGE_ICON_PROMPT_TOO_LONG');
    const body=JSON.stringify(modern?{model:modelId,input:{messages:[{role:'user',content:[{text:prompt.trim()}]}]},parameters:{size:`${dimension}*${dimension}`,...(sync?{prompt_extend:false}:{n:1})}}:{model:modelId,input:{prompt:prompt.trim()},parameters:{size:'1024*1024',n:1}});
    if (!apiKey) throw new ModelCallError("MODEL_PROVIDER_NOT_CONFIGURED", "image provider is not configured");
    if (!prompt.trim() || prompt.length > 16_384) throw new ModelCallError("MODEL_CALL_FAILED", "image prompt is invalid");
    const timeoutMs=Math.min(120_000,Math.max(1,this.config.timeoutMs));
    const signal=callerSignal ? AbortSignal.any([callerSignal,AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs);
    if(this.accountingFault)throw new ModelCallError("MODEL_CALL_FAILED","IMAGE_ACCOUNTING_REPAIR_REQUIRED");
    if(this.nativeAdmission&&!accountingContext)throw new ModelCallError("MODEL_CALL_FAILED","IMAGE_ACCOUNTING_CONTEXT_REQUIRED");
    let dispatchStarted=false;
    let receipt:ImageAiReceipt|undefined,quantity:bigint|null=null,outcome:"succeeded"|"failed"="failed";
    try {
      signal.throwIfAborted();
      receipt=this.nativeAdmission?await this.nativeAdmission.start(accountingContext!,{requestId:randomUUID(),modelProvider:BAILIAN_IMAGE_PROVIDER_NAME,modelId,serializedBody:body,quantity:1n}):undefined;
      signal.throwIfAborted();
      dispatchStarted=true;
      if(sync){
        const response=await fetch(`${baseUrl}/api/v1/services/aigc/multimodal-generation/generation`,{method:'POST',signal,redirect:'error',headers:{'content-type':'application/json','accept-encoding':'identity',authorization:`Bearer ${apiKey}`},body});
        const result=await readBoundedJson(response,signal) as any;
        quantity=readReportedImageQuantity(result.usage);
        const url=result.output?.choices?.[0]?.message?.content?.find((item:any)=>typeof item.image==='string')?.image;
        if(!response.ok||!url||typeof result.request_id!=='string'||!/^[A-Za-z0-9_-]{1,256}$/.test(result.request_id))throw new Error('invalid image response');
        validateImageUrl(url);outcome='succeeded';return {delivery:'url',url,taskId:result.request_id,modelRef:modelId};
      }
      const taskId=await this.submit(baseUrl,apiKey,body,modern,signal);
      while (true) {
        signal.throwIfAborted();
        const {status,url,usage}=await this.readTask(baseUrl,apiKey,taskId,signal,modern);
        if(!['PENDING','RUNNING'].includes(status))quantity=readReportedImageQuantity(modern&&usage&&typeof usage==='object'?{image_count:(usage as Record<string,unknown>).output_image_count}:usage);
        if(status==='SUCCEEDED') {
          if(!url)throw new Error('missing image');
          validateImageUrl(url);
          outcome='succeeded';
          return {delivery:'url',url,taskId,modelRef:modelId};
        }
        if(!['PENDING','RUNNING'].includes(status))throw new Error('terminal failure');
        await delay(Math.min(3000,Math.max(1,this.config.pollIntervalMs)),undefined,{signal});
      }
    } catch (error) {
      if(error instanceof CreditConsumptionError||!dispatchStarted)throw error;
      // No retry: a lost submission acknowledgement may already have created a vendor task.
      throw new ModelCallError("MODEL_CALL_FAILED", "image generation failed, was cancelled, or exceeded its deadline");
    } finally {
      if(receipt)try{await receipt.terminal({endedAt:new Date().toISOString(),outcome,quantity});}catch(error){this.accountingFault=true;throw error;}
    }
  }

  private async submit(baseUrl: string, apiKey: string, body:string, modern:boolean, signal: AbortSignal): Promise<string> {
    let response: Response;
    try {
      response = await fetch(`${baseUrl}/api/v1/services/aigc/${modern?'image-generation/generation':'text2image/image-synthesis'}`, {
        method: "POST", signal, redirect: "error",
        headers: {
          "content-type": "application/json",
          "accept-encoding": "identity",
          authorization: `Bearer ${apiKey}`,
          "X-DashScope-Async": "enable",
        },
        body,
      });
    } catch {
      throw new ModelCallError("MODEL_CALL_FAILED", "image provider transport failure");
    }
    const parsedBody = await readBoundedJson(response,signal) as SubmitResponse;
    if (!response.ok || typeof parsedBody.output?.task_id !== 'string' || !/^[A-Za-z0-9_-]{1,256}$/.test(parsedBody.output.task_id)) {
      throw new ModelCallError("MODEL_CALL_FAILED", `image task submission failed with HTTP ${response.status}`);
    }
    return parsedBody.output.task_id;
  }

  private async readTask(baseUrl: string, apiKey: string, taskId: string, signal: AbortSignal,modern=false): Promise<{ status: string; url: string | null;usage:unknown }> {
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
    const body = await readBoundedJson(response,signal) as TaskResponse;
    return {
      status: body.output?.task_status ?? "UNKNOWN",
      usage:body.usage,
      url: modern ? (body as any).output?.choices?.[0]?.message?.content?.find((item:any)=>typeof item.image==='string')?.image ?? null : body.output?.results?.[0]?.url ?? null,
    };
  }
}

/** markdown alt text 不能带方括号/换行，粗暴截断即可——它只是给不能看图的场合用的替代文本。 */
function truncateForAlt(prompt: string): string {
  const cleaned = prompt.replace(/[[\]\n]/g, " ").slice(0, 100);
  return cleaned.length < prompt.length ? `${cleaned}…` : cleaned;
}

/**
 * 2026-09-09（issue #3175，main 上 `gates-test (3)` 卡满 60s 的那条红）：这个读循环
 * **必须自己拿着 deadline**，不能指望 `fetch` 的 `signal` 替它把 body 流销毁掉。
 *
 * 原来的形状是 `readBoundedJson(response)`——不收 signal。`generateImage` 造的
 * `AbortSignal.timeout(timeoutMs)` 只传给了 `fetch`，而 fetch 在**响应头一到**就
 * resolve；此后 `reader.read()` 能不能被打断，100% 取决于底层 transport 是否愿意在
 * signal 触发时去销毁 body。实测（body 为永不 enqueue 的 `ReadableStream` 的替身
 * transport）：signal 到点触发了、abort 监听器也跑了，读循环**纹丝不动**——这个函数
 * 身上没有任何一条能让它自己停下来的路径。CI 上的表现正是这个签名：断言写的是
 * 「2000ms 内必须 reject」，实际卡满 60002ms 被 vitest 判超时——**卡满 = promise
 * 从没 settle**，不是计时被争用打飞（同 shard 前后脚的文件都是 4-6ms）。
 *
 * ⚠ 别把「本机复现不出来」读成「没有缺陷」：macOS + Node 22 上 550 次（含 CPU 争用、
 *   含扫 1-40ms 竞态窗口）一次没卡——那里的 undici 恰好肯销毁 body。缺陷在于
 *   **这条路径的活性被外包给了 transport 的善意**，触不触发只是运气。
 *
 * `finally` 里的 `reader.cancel()` 同理不再 `await`：它属于清理，不该成为第二个能让
 * 函数活过 deadline 的地方（实测流已 error 时 `cancel()` 会带着流的错误 reject，本来
 * 就被 `.catch` 吃掉；"等它"只是白白多一处活性风险）。
 */
async function readBoundedJson(response:Response,signal:AbortSignal):Promise<unknown> {
  if(response.headers.get('content-encoding') && response.headers.get('content-encoding')!=='identity') {
    await response.body?.cancel();throw new Error('unsupported provider encoding');
  }
  if(!response.body)throw new Error('empty provider response');
  const reader=response.body.getReader();const chunks:Uint8Array[]=[];let size=0;
  try {
    while(true){const {done,value}=await abortable(reader.read(),signal);if(done)break;
      size+=value.length;if(size>65536)throw new Error('provider response too large');chunks.push(value);
    }
    return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));
  } finally {void reader.cancel().catch(()=>{});}
}

/** Reject as soon as `signal` fires, whatever the underlying promise decides to do. */
function abortable<T>(promise:Promise<T>,signal:AbortSignal):Promise<T> {
  if(signal.aborted)return Promise.reject(signal.reason);
  return new Promise<T>((resolve,reject)=>{
    const onAbort=()=>reject(signal.reason);
    signal.addEventListener('abort',onAbort,{once:true});
    // `then` 顺带承担了"给那条可能永远悬着的 read() 挂上 handler"的职责——否则它日后
    // 若 reject 会变成 unhandled rejection 打死进程。
    promise.then(resolve,reject).finally(()=>signal.removeEventListener('abort',onAbort));
  });
}

function validateImageUrl(url:string){const parsed=new URL(url);if(parsed.protocol!=='https:'||parsed.username||parsed.password||/[\s()<>]/.test(url))throw new Error('invalid image');}
