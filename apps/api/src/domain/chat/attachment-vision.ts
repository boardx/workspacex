/**
 * #1560 · P1 —— 图片附件的**视觉理解**纯领域件：给 VLM 的提问协议、回复解析、产物 markdown 合成。
 *
 * 为什么这三件在 domain 而不在 infrastructure：它们决定「模型被要求产出什么」与「产物长什么样」，
 * 是可复现、可单测的规则，不含 HTTP / key / 供应商细节。百炼实现只负责把 `VISION_PROMPT` 发出去、
 * 把回复原文交回来（见 `infrastructure/chat/bailian-vision-extractor.ts`）。
 *
 * ⚠ 诚实边界（本仓红线：不许伪造模型输出）：
 *   · 解析不出结构时**不臆造**转录段，把模型原文整段归入描述，并在产物里明说「模型未按结构回复」。
 *   · 产物 markdown 头部逐字写明是哪个模型生成的、内容是模型的转录/描述而非确定性抽取，
 *     下游（excerpt → 上下文 → F157 快照）读到的就是这句话，不会把它当成 OCR 级事实。
 */

/** 回复里的两个结构标记——提问与解析共用同一对常量（同一事实不写两处）。 */
export const VISION_TRANSCRIPT_MARKER = "【图中文字】";
export const VISION_DESCRIPTION_MARKER = "【视觉描述】";

/**
 * 发给 VLM 的指令。两段式结构化输出，便于确定性解析；显式要求「看不清就说看不清」，
 * 因为编造出来的文字转录比空转录更有害（它会以事实的姿态进上下文并被检索到）。
 */
export const VISION_PROMPT = [
  "请阅读这张图片，并严格按以下两段格式作答，不要添加其它标题或解释：",
  `${VISION_TRANSCRIPT_MARKER}`,
  "逐字转录图中出现的所有文字（保持原语言、原顺序，可用换行区分行/块）。图中没有文字就写「（无文字）」。",
  "看不清或不确定的字，写「（不清）」占位，不要猜测补全。",
  `${VISION_DESCRIPTION_MARKER}`,
  "描述图片的视觉内容：这是什么类型的图（截图/照片/图表/示意图…）、画面里有什么、结构与关键信息。",
  "只描述你真的看到的内容，不要推测图片的来源或用途。",
].join("\n");

export interface VisionReply {
  /** 模型按结构给出的文字转录段；未按结构回复时为 `null`（不臆造）。 */
  readonly transcript: string | null;
  /** 视觉描述段；未按结构回复时是模型回复的全文。 */
  readonly description: string;
}

/** 把模型回复原文切成 `{ transcript, description }`；标记缺失时不猜结构。 */
export function parseVisionReply(raw: string): VisionReply {
  const text = raw.trim();
  const tIdx = text.indexOf(VISION_TRANSCRIPT_MARKER);
  const dIdx = text.indexOf(VISION_DESCRIPTION_MARKER);
  if (tIdx === -1 || dIdx === -1 || dIdx < tIdx) {
    return { transcript: null, description: text };
  }
  const transcript = text.slice(tIdx + VISION_TRANSCRIPT_MARKER.length, dIdx).trim();
  const description = text.slice(dIdx + VISION_DESCRIPTION_MARKER.length).trim();
  return { transcript, description };
}

export interface VisionMarkdownInput {
  /** 真实模型名（含版本，如 `qwen-vl-max`）——如实写进产物，绝不写 stub。 */
  readonly modelId: string;
  readonly reply: VisionReply;
}

/**
 * 合成落库的 markdown。结构固定：来源声明 + 文字转录 + 视觉描述。
 * 空段落也如实写「（模型未给出）」，不静默省略——省略会让读的人以为图里没有那样东西。
 */
export function composeVisionMarkdown(input: VisionMarkdownInput): string {
  const { modelId, reply } = input;
  const transcript = reply.transcript === null
    ? "（模型未按约定结构回复，转录与描述未分离，全文见下节）"
    : (reply.transcript.trim() === "" ? "（模型未给出）" : reply.transcript.trim());
  const description = reply.description.trim() === "" ? "（模型未给出）" : reply.description.trim();
  return [
    "# 图片视觉理解",
    "",
    `> 由视觉模型 \`${modelId}\` 生成：以下是**模型的转录与描述**，不是确定性文本抽取，可能有误。`,
    "",
    "## 图中文字转录",
    "",
    transcript,
    "",
    "## 视觉内容描述",
    "",
    description,
    "",
  ].join("\n");
}
