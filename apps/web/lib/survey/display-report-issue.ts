import type { MessageKey, MessageParams } from "@/lib/i18n/messages";
import { surveyReportIssueCatalogue } from "@/lib/i18n/namespaces/survey-results";
type Translator = (key: MessageKey, params?: MessageParams) => string;
const keys = Object.fromEntries(Object.entries(surveyReportIssueCatalogue).map(([key, pair]) => [pair[0], `survey.reportIssue.${key}`])) as Record<string, MessageKey>;
/** Render compiler diagnostics only; report/model/answer content bypasses this mapper. */
export function displaySurveyReportIssue(message: string, t: Translator): string {
  if (Object.hasOwn(keys, message)) return t(keys[message]!);
  const suffixes = [
    ["：此题型不支持均值", "survey.reportIssue.unsupportedMean"],
    ["：此题型不支持选项分布", "survey.reportIssue.unsupportedDistribution"],
    ["：此题型不支持该统计方式", "survey.reportIssue.unsupportedStatistic"],
    ["：没有合法作答样本", "survey.reportIssue.noValidAnswers"],
    ["：章节没有可生成的内容", "survey.reportIssue.emptyChapter"],
  ] as const;
  for (const [suffix, key] of suffixes) if (message.endsWith(suffix)) return t(key, { title: message.slice(0, -suffix.length) });
  const group = /^分组有效样本不足 (\d+)，已隐藏$/.exec(message);
  if (group) return t("survey.reportIssue.smallGroup", { count: group[1]! });
  const share = /^纳入分析的样本不足 (\d+) 份，无法导出或共享报告$/.exec(message);
  if (share) return t("survey.reportIssue.shareSmall", { count: share[1]! });
  const block = /^“(.*)”的输出样本不足 (\d+) 份，无法导出或共享报告$/.exec(message);
  if (block) return t("survey.reportIssue.shareBlockSmall", { title: block[1]!, count: block[2]! });
  return message;
}
