/**
 * Phase 18 F06 —— 用部署的标准模型从一条消息里抽实体与结论。
 *
 * 输出约束：有 `responseSchema` 时 provider 做约束解码（KERNEL_MODEL_JSON_SCHEMA=1）；没有时靠 prompt，
 * 解析端从文本里截第一个 `{` 到最后一个 `}`。**不**按行猜——猜出来的「结论」是编造，不是抽取。
 *
 * issue #4350：解析不出 ⇒ 抛 `KgExtractionUnparseableError`（任务走既有的重试 / 退避，三次后面板显示「失败」）。
 * 以前这里返回空结果，任务被当成「没有可记的」直接出队：模型坏了、面板却什么都不说，记忆就这么悄悄丢了。
 * 真正合法的空回复（`{"entities":[],"claims":[]}`）仍然是「空」，不是失败。
 */
import { knowledgeGraph as KG } from "@repo/contracts";
import type { ModelCallPort } from "../../application/agent-run/ports";
import type { KgMessage, KnowledgeExtractorPort } from "../../application/knowledge-graph/ports";
import type { LoggerPort } from "../../application/ports/logger.port";
import { parseExtraction, type ExtractionResult } from "../../domain/knowledge-graph/extraction";
import type { KgExtractionModelConfig } from "./kg-extraction-model-config";

/** 导出给 scripts/loopback-model-provider.ts：回环模型按这段文字逐字识别「这是一次抽取请求」。 */
export const KG_EXTRACTION_SYSTEM_PROMPT =
  "你是一个知识抽取器。读用户给出的「本条消息」（上文只用于理解指代），找出其中值得长期记住的内容：" +
  "人物、公司、项目、产品、概念、术语、指标、事件，以及关于它们的事实、猜测、决定、待办、风险。" +
  "用户本人明确说出的自己的目标或打算（如「我的目标是…」「我想…」「我希望…」）记为 goal，" +
  "本人明确说出的自己的偏好（如「我更喜欢…」「我倾向于…」）记为 preference：陈述保留第一人称「我」，about 可以为空；" +
  "提问、请求（「我想问…」「我想让你…」）、假设（「如果…」）、别人的目标或偏好都不算。" +
  "只抽取本条消息里明确说出的内容，不要推测，不要重复上文已经说过的内容。寒暄、客套、提问本身不算。" +
  "每条结论用一句完整、可以脱离上下文读懂的中文陈述（把「他」「这个」替换成具体名称），" +
  "about 列出它涉及的实体名，决定类结论如果说了是谁拍板，填 decidedBy，quote 摘录本条消息里支撑它的原话。" +
  "只输出一个 JSON 对象，不要输出任何其他文字。没有可记的内容就输出 {\"entities\":[],\"claims\":[]}。";

export const KG_EXTRACTION_RESPONSE_SCHEMA = {
  name: "knowledge_extraction",
  schema: {
    type: "object",
    properties: {
      entities: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            kind: { type: "string", enum: [...KG.KgObjectKind.options] },
            aliases: { type: "array", items: { type: "string" } },
          },
          required: ["name", "kind", "aliases"],
          additionalProperties: false,
        },
      },
      claims: {
        type: "array",
        items: {
          type: "object",
          properties: {
            statement: { type: "string" },
            kind: { type: "string", enum: [...KG.KgClaimKind.options] },
            confidence: { type: "number" },
            about: { type: "array", items: { type: "string" } },
            decidedBy: { type: ["string", "null"] },
            quote: { type: "string" },
          },
          required: ["statement", "kind", "confidence", "about", "decidedBy", "quote"],
          additionalProperties: false,
        },
      },
    },
    required: ["entities", "claims"],
    additionalProperties: false,
  },
} as const;

/**
 * 模型回复 → 抽取结果；不是这个形状 ⇒ null。
 *
 * 「是这个形状」= 截出来的 JSON 是个对象，`entities` / `claims` 至少有一个是数组，且出现了的都是数组。
 * `{"answer":"…"}` 这类合法 JSON 但答非所问的回复算解析不出——把它当「没有可记的」同样会悄悄丢记忆。
 */
export function parseExtractionText(text: string): ExtractionResult | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end < start) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const { entities, claims } = raw as { entities?: unknown; claims?: unknown };
  const shaped = (v: unknown) => v === undefined || Array.isArray(v);
  if (!shaped(entities) || !shaped(claims) || (entities === undefined && claims === undefined)) return null;
  return parseExtraction(raw);
}

/**
 * issue #4350：模型回了东西，但不是一个抽取结果。带类型抛出，走任务的重试 / 退避（与模型调用失败同一条路），
 * 三次后面板显示「失败」。`message` 进 `kg_extraction_queue.last_error`，只写原因码与长度，不写回复原文。
 */
export class KgExtractionUnparseableError extends Error {
  readonly code = "kg_extraction_reply_unparseable" as const;
  constructor(readonly messageId: string, readonly replyLength: number) {
    super(`kg_extraction_reply_unparseable (reply length ${replyLength})`);
    this.name = "KgExtractionUnparseableError";
  }
}

export class ModelKnowledgeExtractor implements KnowledgeExtractorPort {
  constructor(
    private readonly model: ModelCallPort,
    private readonly config: KgExtractionModelConfig,
    private readonly logger: LoggerPort,
  ) {}

  async extract(input: { readonly message: KgMessage; readonly context: readonly KgMessage[] }): Promise<ExtractionResult> {
    const completion = await this.model.complete({
      modelProvider: this.config.provider,
      modelId: this.config.modelId,
      // 不传 threadId：同 generate-followup-suggestions 的理由——这是独立的一次性调用，不能写进真实会话的历史。
      system: KG_EXTRACTION_SYSTEM_PROMPT,
      history: input.context.map((m) => ({ role: m.authorKind === "human" ? "user" as const : "assistant" as const, content: m.body })),
      user: `本条消息（${input.message.authorKind === "human" ? "用户" : "助手"}说的）：\n${input.message.body}`,
      responseSchema: KG_EXTRACTION_RESPONSE_SCHEMA,
    });
    const parsed = parseExtractionText(completion.text);
    if (parsed === null) {
      const err = new KgExtractionUnparseableError(input.message.id, completion.text.length);
      this.logger.error("kg extraction reply unparseable", {
        traceId: "kg-extraction", messageId: input.message.id, threadId: input.message.threadId, replyLength: completion.text.length, err,
      });
      throw err;
    }
    return parsed;
  }
}
