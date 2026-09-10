/**
 * issue #3346 —— 「哪个模型能看图」与「一张图在线上长什么样」的**单一事实源**。
 *
 * 这两件事此前只住在 `configured-model-provider.ts` 里（P2 / #1561 建的那条像素通路只接
 * 到了直连 DashScope 的 chat provider）。#3346 的实测形态是：devapp 的 chat 跑在
 * **deep-agent** 上，`DeepAgentModelProvider` 既不实现 `supportsVision` 也不读
 * `ModelCallInput.images`——用户上传的截图挂上了消息、右栏也看得见，但打给内核的报文里
 * 只有文字，模型于是「在没看见图的情况下回答了关于图的问题」。
 *
 * 让第二个 provider 也能看图，最容易走错的一步是**在那边再抄一份**判据和一份编码函数
 * ——本仓已十一次因「同一事实声明在两处」漂移。所以这两件事搬到这里，两个 provider 各
 * 自 import，谁都不许再写第二份：
 *
 *   · `readVisionModelIds` —— 判据是**模型**的属性，不是厂商的；清单本身住在
 *     `domain/model/vision-capable-models.ts`（#3355 收敛，这里不再写第二份）。
 *   · `toImagePart`        —— 一张图 → 一个 `image_url` part（data URL）。
 */
import { resolveVisionCapableModelIds } from "../../domain/model/vision-capable-models";
import type { ModelCallImage } from "../../application/agent-run/ports";

/** OpenAI 兼容的多模态 content part（LangChain 的 `ChatOpenAI` 直接吃这个形状）。 */
export type WireContentPart =
  | { readonly type: "text"; readonly text: string }
  | { readonly type: "image_url"; readonly image_url: { readonly url: string } };

/**
 * P2（#1561）/ #3355 —— 允许走多模态请求体的 modelId 集合。
 *
 * ⚠ **这里不再声明清单**。默认清单与 `KERNEL_MODEL_VISION_IDS` 覆盖语义都住在
 * `domain/model/vision-capable-models.ts`（#3355 的单一事实源）——此前这个默认值
 * （`qwen-vl-max,qwen-vl-plus`）与抽取器的 `DEFAULT_VISION_MODEL_ID` 是两处独立手写声明，
 * 两份都漏了部署实际在用的 `qwen3.8-max`。本函数只保留为调用点的稳定入口。
 */
export function readVisionModelIds(env: NodeJS.ProcessEnv): ReadonlySet<string> {
  return resolveVisionCapableModelIds(env);
}

/**
 * P2（#1561）—— 一张图 → 一个 `image_url` part。
 *
 * 编码成 data URL（`data:<mime>;base64,<...>`）而不是传一个可访问的 URL：附件字节住在本
 * 部署的对象存储里，没有对外可达的签名 URL 通路，造一条出来等于给用户上传的图开一个
 * 公网可读面——那是一个需要单独评审的隐私决定。data URL 的代价是请求体按 4/3 膨胀，
 * 这正是 `MODEL_CALL_MAX_IMAGE_BYTES` 存在的原因。
 */
export function toImagePart(image: ModelCallImage): WireContentPart {
  const base64 = Buffer.from(image.bytes).toString("base64");
  return { type: "image_url", image_url: { url: `data:${image.mime};base64,${base64}` } };
}
