/**
 * #1560 · P1 —— `AttachmentVisionPort`：把**图片字节**变成「文字转录 + 视觉描述」markdown 的能力边界。
 *
 * 形状刻意与 `AttachmentToMarkdownPort` 同型（`{ok:true,...} | {ok:false, code}`，永不抛），
 * 这样抽取核心 `extractAttachment` 对两条路径的处理是同一套：拿到 markdown → putOnce 全文 →
 * recordExtracted（excerpt 进 DB）。图片抽取**不新开字段、不新开落库路径**（#1560 交付契约）。
 *
 * 具体的 VLM（阿里云百炼 Qwen-VL）只出现在 infrastructure 实现里；提问协议与产物结构在 domain
 * （`domain/chat/attachment-vision.ts`）。
 */

/**
 * 视觉抽取失败码——**封闭枚举**，如实落进 `chat_message_attachments.extraction_error`。
 * 每一条都对应一种「模型没给出内容」的真实原因，绝不存在「假装抽到了」的第五种可能。
 *
 * - `visionNotConfigured` 本部署没有视觉能力（`KERNEL_MODEL_API_KEY` 未设置 / 未接 vision port）。
 * - `visionModelUnavailable` 上游明确说模型名不存在或无权访问（如百炼 "Model not exist"）。
 * - `visionImageTooLarge` 图片字节超过视觉模型的单图上限（本地判定，没发出去就先诚实拒了）。
 * - `visionRejected`   上游受理了但没给出可用内容（内容安全拦截、空回复等）。
 * - `visionTransport`  网络/5xx/超时等**可重试**故障——不是终态，由 outbox 重试窗口兜。
 */
export type VisionErrorCode =
  | "visionNotConfigured"
  | "visionModelUnavailable"
  | "visionImageTooLarge"
  | "visionRejected"
  | "visionTransport";

/** `visionTransport` 是唯一可重试的一类；其余是确定性失败，重试没有意义。 */
export function isRetryableVisionError(code: VisionErrorCode): boolean {
  return code === "visionTransport";
}

export type VisionResult =
  | {
      readonly ok: true;
      /** 已合成好的产物 markdown（domain `composeVisionMarkdown`）。 */
      readonly markdown: string;
      /** 真实使用的模型名（含版本），如实来自配置，不写 stub。 */
      readonly modelId: string;
    }
  | { readonly ok: false; readonly code: VisionErrorCode };

export interface AttachmentVisionPort {
  /**
   * 对 `bytes`（`mime` 为 png/jpeg/webp）做视觉理解。永不抛：失败一律收敛成 `{ ok:false, code }`。
   * 实现**不得**在失败时返回空 markdown 冒充成功。
   */
  describeImage(bytes: Uint8Array, mime: string): Promise<VisionResult>;
}

export const ATTACHMENT_VISION = Symbol("AttachmentVisionPort");
