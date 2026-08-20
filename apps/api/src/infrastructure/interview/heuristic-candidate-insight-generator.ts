/**
 * 默认 `CandidateInsightGenerator` 实现（F01）——**确定性启发式，不是真实模型调用**。
 *
 * 本仓目前没有一个可复用的"访谈归纳 AI"调用点（同 `candidate-ports.ts` 里
 * `HistoryBasedCandidateSuggester` 文件头的既有先例：如实登记这是启发式，不假装做了
 * AI 判断）。分组口径：按 `rqId` 归并——同一研究问题下的引述算同一个候选，`rqId`
 * 均为 `null` 的引述归为一组。候选文本是该组引述原文的顺序拼接，不是摘要——
 * 摘要生成需要真实语言模型，这里不伪造一个看起来像摘要的字符串。
 *
 * 这个类是**可替换的**：`generateCandidateInsights` 只依赖 `CandidateInsightGenerator`
 * 接口，注入一个会抛错的实现即可反证 E1（AI_GENERATION_UNAVAILABLE 事务性）。
 */
import type {
  CandidateInsightGenerator,
  GeneratedCandidateInput,
  QuoteForGeneration,
} from "../../application/interview/insight-ports";

export class HeuristicCandidateInsightGenerator implements CandidateInsightGenerator {
  async generate(quotes: readonly QuoteForGeneration[]): Promise<readonly GeneratedCandidateInput[]> {
    const groups = new Map<string, QuoteForGeneration[]>();
    for (const quote of quotes) {
      const key = quote.rqId ?? "__no_rq__";
      const bucket = groups.get(key);
      if (bucket) bucket.push(quote);
      else groups.set(key, [quote]);
    }
    return [...groups.values()].map((group) => ({
      text: group.map((q) => q.text).join("；"),
      quotes: group,
    }));
  }
}
