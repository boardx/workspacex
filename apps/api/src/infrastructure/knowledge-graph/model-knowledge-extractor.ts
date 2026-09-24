/**
 * Phase 18 F06 —— 用部署的标准模型从一条消息里抽实体与结论。
 *
 * 输出约束：有 `responseSchema` 时 provider 做约束解码（KERNEL_MODEL_JSON_SCHEMA=1）；没有时靠 prompt，
 * 解析端从文本里截第一个 `{` 到最后一个 `}`。解析不出 ⇒ 空结果（这条消息就当没有可记的），**不**
 * 按行猜——猜出来的「结论」是编造，不是抽取。
 */
import { knowledgeGraph as KG } from "@repo/contracts";
import type { ModelCallPort } from "../../application/agent-run/ports";
import type { KgMessage, KnowledgeExtractorPort } from "../../application/knowledge-graph/ports";
import type { LoggerPort } from "../../application/ports/logger.port";
import { EMPTY_EXTRACTION, parseExtraction, type ExtractionResult } from "../../domain/knowledge-graph/extraction";
import type { KgExtractionModelConfig } from "./kg-extraction-model-config";

/** 导出给 scripts/loopback-model-provider.ts：回环模型按这段文字逐字识别「这是一次抽取请求」。 */
export const KG_EXTRACTION_SYSTEM_PROMPT =
  "你是一个知识抽取器。读用户给出的「本条消息」（上文只用于理解指代），找出其中值得长期记住的内容：" +
  "人物、公司、项目、产品、概念、术语、指标、事件，以及关于它们的事实、猜测、决定、待办、风险。" +
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

export function parseExtractionText(text: string): ExtractionResult | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end < start) return null;
  try {
    return parseExtraction(JSON.parse(text.slice(start, end + 1)));
  } catch {
    return null;
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
      this.logger.info("kg extraction reply unparseable", { traceId: "kg-extraction", messageId: input.message.id });
      return EMPTY_EXTRACTION;
    }
    return parsed;
  }
}
