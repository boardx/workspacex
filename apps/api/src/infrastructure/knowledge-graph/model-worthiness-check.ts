/**
 * Phase 18 S8（#4365）——「值得记」门控的可选第二步：用部署的标准模型问一句「这条消息里有没有值得长期记住的内容」。
 *
 * 默认关（`KG_EXTRACTION_GATE_MODEL=1` 才装配，见 `readKgExtractionGateModelEnabled`）。开着时只看规则判为「放行」且
 * **未受保护**的消息（extraction-gate.ts）：目标 / 偏好 / 决定永远到不了这里。
 *
 * 回答只认 `YES` / `NO` 开头；别的回答 ⇒ 抛 `KgGateModelUnparseableError`，门控记一条 KG_GATE_MODEL_FAILED 并**照常抽取**
 * （不是静默当成 YES：解析不出是可观察的失败，计入 gateModelErrors）。不传 threadId：与抽取同理，这次调用不写进任何会话历史。
 */
import type { ModelCallPort } from "../../application/agent-run/ports";
import type { WorthinessModelPort } from "../../application/knowledge-graph/extraction-gate";
import type { KgMessage } from "../../application/knowledge-graph/ports";
import type { KgExtractionModelConfig } from "./kg-extraction-model-config";

export const KG_GATE_MODEL_SYSTEM_PROMPT =
  "你是一个过滤器。判断「本条消息」里有没有值得长期记住的内容（事实、决定、目标、偏好、待办、风险、人物或项目信息）。" +
  "寒暄、客套、纯粹的提问、简单的应答都不值得记。拿不准就回答 YES。只回答一个词：YES 或 NO。";

export class KgGateModelUnparseableError extends Error {
  readonly code = "KG_GATE_MODEL_UNPARSEABLE";
  constructor(readonly replyLength: number) {
    super(`kg gate model reply is neither YES nor NO (length ${replyLength})`);
    this.name = "KgGateModelUnparseableError";
  }
}

export function readKgExtractionGateModelEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return (env.KG_EXTRACTION_GATE_MODEL ?? "").trim() === "1";
}

export class ModelWorthinessCheck implements WorthinessModelPort {
  constructor(private readonly model: ModelCallPort, private readonly config: KgExtractionModelConfig) {}

  async worthRemembering(input: { readonly message: KgMessage; readonly context: readonly KgMessage[] }): Promise<boolean> {
    const completion = await this.model.complete({
      modelProvider: this.config.provider,
      modelId: this.config.modelId,
      system: KG_GATE_MODEL_SYSTEM_PROMPT,
      history: input.context.map((m) => ({ role: m.authorKind === "human" ? "user" as const : "assistant" as const, content: m.body })),
      user: `本条消息（${input.message.authorKind === "human" ? "用户" : "助手"}说的）：\n${input.message.body}`,
    });
    const text = completion.text.trim().toUpperCase();
    if (/^YES\b/.test(text)) return true;
    if (/^NO\b/.test(text)) return false;
    throw new KgGateModelUnparseableError(completion.text.length);
  }
}
