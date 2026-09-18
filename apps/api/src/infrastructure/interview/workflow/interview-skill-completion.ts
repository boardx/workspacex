import type { ModelCallInput, ModelCallPort } from "../../../application/agent-run/ports";
import { DigitalInterviewWorkflowError } from "../../../application/interview/workflow/digital-interview-runtime.port";

const TOPIC_GUIDANCE = `主题设计要求：用户要求生成、优化或细化主题时，不要只抽取关键词或复述原主题。围绕用户最新意图，结合 currentDraft.topic，提出一个可直接用于专家访谈的聚焦主题，明确研究对象、核心问题及访谈目的。宽泛输入应收敛为一个合理的可探索角度；用中性问题表达，不编造事实或预设结论。用户未指定时间、机构或数据时不得伪造。最新请求和当前草稿优先于旧会话名称及历史主题，用户切换研究方向时应围绕新的方向设计。只有用户明确要求改名或逐字采用标题时才直接使用指定文本。保持现有严格 JSON patch 格式，topic 是完整主题文本。`;
const normalized = (value: string) => value.normalize("NFKC").replace(/[\s\p{P}\p{S}]/gu, "").toLocaleLowerCase();

function echoesTopic(text: string, topic: string, request: string): boolean {
  try {
    const patch = JSON.parse(text) as { topic?: unknown };
    if (typeof patch?.topic !== "string") return false;
    const candidate = normalized(patch.topic);
    return candidate !== "" && (candidate === normalized(topic) || normalized(request).includes(candidate));
  } catch {
    // Structural validation remains owned by normalizeSkillProposalPatch.
    return false;
  }
}

export async function completeInterviewSkill(
  model: ModelCallPort,
  input: ModelCallInput,
  context: { readonly step: string; readonly request: string; readonly topic: string },
) {
  if (context.step !== "topic") return model.complete(input);
  const guided = { ...input, system: `${input.system}\n${TOPIC_GUIDANCE}` };
  const completion = await model.complete(guided);
  // Topic design is the default for this step; only an explicit title instruction
  // may intentionally reuse words from the draft or request.
  const explicitTitle = /(?:主题|标题|名称)\s*(?:请)?\s*(?:改为|改成|设为|设置为|命名为|就用|用)|逐字(?:采用|使用|保留)|(?:rename|retitle)\b|(?:title|topic)\s+(?:exactly|verbatim)|(?:use|keep)\s+(?:the\s+)?(?:exact|verbatim)\s+(?:title|topic)/i.test(context.request);
  if (explicitTitle || !echoesTopic(completion.text, context.topic, context.request)) return completion;
  const repaired = await model.complete({
    ...guided,
    system: `${guided.system}\n上次输出仅复述当前主题（包括只改标点），没有完成本次主题设计。请重新生成，增加具体访谈角度和待探究问题；保持原始请求与 JSON 契约。`,
  });
  if (echoesTopic(repaired.text, context.topic, context.request)) throw new DigitalInterviewWorkflowError("DEPENDENCY_UNAVAILABLE");
  return repaired;
}
