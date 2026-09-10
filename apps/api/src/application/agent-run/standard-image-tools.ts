import type {z} from 'zod';
import type {ImageGenerateInput,ImageGenerated} from '@repo/contracts/standard-image-tools';
import type {ExecutionAuthorityContext} from './tool-execution-authority';
import type {DraftSessionFiles} from './skill-draft';
import type {DocumentSession} from './standard-document-tools';
export const STANDARD_IMAGE_SERVICE=Symbol('StandardImageService');
export type ImageContext=ExecutionAuthorityContext&{bindingId:string;toolCallId:string};
export interface StandardImageService{generate(context:ImageContext,input:z.infer<typeof ImageGenerateInput>):Promise<z.infer<typeof ImageGenerated>>}
/**
 * 供应商把生成结果交回来的**两种形状**，显式区分，不合并成一个「可能是 URL 也可能是
 * 字节」的字段。
 *
 * · `url` —— 异步任务型供应商（阿里云百炼通义万相）：提交拿 task_id、轮询到终态、
 *   拿到一个有时效的签名 URL，由 `GeneratedImageDownloader` 带出网守卫去取字节。
 * · `inline` —— 同步返回型供应商（OpenAI Images，`gpt-image-*` 只回 base64、根本
 *   没有 URL）：字节已经在响应体里，没有第二跳可下载。
 *
 * 为什么不让 OpenAI 那条塞一个 `data:` URL 进 `url` 混过去：那会让 `url` 这一个字段
 * 同时是「网络地址」和「内联字节」两种东西，`assertMcpEndpointAllowed` 那道出网守卫
 * 也要跟着长出一条不出网的例外分支——同一事实两种形状，正是本仓反复漂移的形态
 * （AGENTS.md 硬约束）。判别式联合让每条路径的校验在类型上就分开。
 */
export type GeneratedImage=
 |{readonly delivery:'url';readonly url:string;readonly taskId:string;readonly modelRef:string}
 |{readonly delivery:'inline';readonly bytes:Uint8Array;readonly taskId:string;readonly modelRef:string};
export interface ImageGenerator{readonly modelRef:string;generateImage(prompt:string,signal?:AbortSignal):Promise<GeneratedImage>}
export type ImageSession=DraftSessionFiles&Pick<DocumentSession,'execute'>;
export interface GeneratedImageDownloader{download(url:string,signal:AbortSignal):Promise<{bytes:Uint8Array;mime:'image/png'|'image/jpeg'}>}
