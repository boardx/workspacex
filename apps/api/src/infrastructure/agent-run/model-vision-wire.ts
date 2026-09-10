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
 *   · `readVisionModelIds` —— `KERNEL_MODEL_VISION_IDS`，判据是**模型**的属性，不是厂商的。
 *   · `toImagePart`        —— 一张图 → 一个 `image_url` part（data URL）。
 */
import type { ModelCallImage } from "../../application/agent-run/ports";

/** OpenAI 兼容的多模态 content part（LangChain 的 `ChatOpenAI` 直接吃这个形状）。 */
export type WireContentPart =
  | { readonly type: "text"; readonly text: string }
  | { readonly type: "image_url"; readonly image_url: { readonly url: string } };

/**
 * P2（#1561）—— `KERNEL_MODEL_VISION_IDS`（逗号分隔）→ 允许走多模态请求体的 modelId 集合。
 *
 * ⚠ 默认值 `qwen-vl-max,qwen-vl-plus` **没有在开发环境实测过**（本机没有
 * `KERNEL_MODEL_API_KEY`，探测不了）。`bailian-image-provider.ts:14-15` 记着这件事上
 * 栽过的跟头：`wanx2.2-t2i-plus` 报 "Model not exist"、`wanx2.1-t2i-plus` 才可用，
 * 「不要被"2.2 应该比 2.1 新"这种直觉带偏」。同样的直觉在这里也不作数——这两个名字是
 * 待验证的候选，不是已验证的事实。有 key 的环境跑
 * `node apps/api/scripts/probe-bailian-vision.mjs` 一条命令即可确认，把实测通过的名字
 * 写进 env（或改这里的默认值并把实测记录写进注释）。在那之前，如果默认值是错的，
 * 表现是**诚实的失败**（模型名不存在 → `MODEL_CALL_FAILED`），不是一个假装看过图的回答。
 */
export function readVisionModelIds(env: NodeJS.ProcessEnv): ReadonlySet<string> {
  const raw = env.KERNEL_MODEL_VISION_IDS ?? "qwen-vl-max,qwen-vl-plus";
  return new Set(raw.split(",").map((v) => v.trim()).filter((v) => v !== ""));
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
