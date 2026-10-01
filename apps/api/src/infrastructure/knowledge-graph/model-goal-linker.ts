/**
 * issue #4360 —— 用部署的抽取模型提议「这条决定 / 待办为本人的哪个目标服务」（`GoalLinkProposerPort`）。
 *
 * 与抽取同一个模型配置（`KgExtractionModelConfig`）、同一条纪律：独立的一次性调用（不写进任何会话的历史），
 * 有 `responseSchema` 时 provider 做约束解码；读不懂 ⇒ null（当作没有提议），**不**按文本猜一个目标。
 * 目标用本次调用里的短号（g1、g2…）给模型，不把库里的 id 交出去。把握度由模型给出，是否采纳在应用层按
 * `GOAL_LINK_MIN_CONFIDENCE` 判（宁可漏挂，不要误挂）。
 */
import type { ModelCallPort } from "../../application/agent-run/ports";
import type { GoalLinkProposal, GoalLinkProposerPort } from "../../application/knowledge-graph/profile-ports";
import type { LoggerPort } from "../../application/ports/logger.port";
import type { KgExtractionModelConfig } from "./kg-extraction-model-config";

/** 导出给回环模型（scripts/loopback-golden-model-provider.ts）：按这段文字逐字识别「这是一次挂目标请求」。 */
export const KG_GOAL_LINK_SYSTEM_PROMPT =
  "你帮用户整理个人目标。给你用户的一条决定或待办，以及用户自己的几个目标（每个前面有编号）。" +
  "判断这条决定或待办是不是在为其中某个目标服务：是 ⇒ goal 填那个编号；和哪个都没有明显关系 ⇒ goal 填 null。" +
  "confidence 填 0 到 1 之间的把握度，只有非常明显时才给 0.8 以上。只输出一个 JSON 对象，不要输出任何其他文字。";

export const KG_GOAL_LINK_RESPONSE_SCHEMA = {
  name: "goal_link",
  schema: {
    type: "object",
    properties: { goal: { type: ["string", "null"] }, confidence: { type: "number" } },
    required: ["goal", "confidence"],
    additionalProperties: false,
  },
} as const;

/** 回环与测试共用的「挂目标请求」正文格式（唯一一份）。 */
export function goalLinkUserText(input: Parameters<GoalLinkProposerPort["propose"]>[0]): string {
  const kind = input.item.kind === "todo" ? "待办" : "决定";
  return [`${kind}：${input.item.statement}`, "目标：", ...input.goals.map((g) => `${g.key}. ${g.statement}`)].join("\n");
}

export function parseGoalLinkText(text: string): GoalLinkProposal | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end < start) return null;
  try {
    const v = JSON.parse(text.slice(start, end + 1)) as { goal?: unknown; confidence?: unknown };
    const goalKey = v.goal === null ? null : typeof v.goal === "string" ? v.goal.trim() : undefined;
    if (goalKey === undefined || typeof v.confidence !== "number" || !Number.isFinite(v.confidence)) return null;
    return { goalKey, confidence: Math.min(1, Math.max(0, v.confidence)) };
  } catch {
    return null;
  }
}

export class ModelGoalLinker implements GoalLinkProposerPort {
  constructor(
    private readonly model: ModelCallPort,
    private readonly config: KgExtractionModelConfig,
    private readonly logger: LoggerPort,
  ) {}

  async propose(input: Parameters<GoalLinkProposerPort["propose"]>[0]): Promise<GoalLinkProposal | null> {
    const completion = await this.model.complete({
      modelProvider: this.config.provider,
      modelId: this.config.modelId,
      system: KG_GOAL_LINK_SYSTEM_PROMPT,
      history: [],
      user: goalLinkUserText(input),
      responseSchema: KG_GOAL_LINK_RESPONSE_SCHEMA,
    });
    const parsed = parseGoalLinkText(completion.text);
    if (parsed === null) this.logger.info("kg goal link reply unparseable", { traceId: "kg-extraction" });
    return parsed;
  }
}
