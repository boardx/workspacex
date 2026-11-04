import { loopbackProfessionalInterviewReport } from "./loopback-professional-interview-report";
import { loopbackInterviewAnalysis } from "./loopback-interview-analysis";

/** Deterministic HTTP test-model responses only. These never establish research quality.
 * Product prompts, authorization, CAS, storage and validation stay on their real paths.
 * Unknown or incomplete inputs return null so ordinary provider behavior remains intact.
 */
export function loopbackInterviewWorkflow(system: string, user: string): string | null {
  const professionalReport = loopbackProfessionalInterviewReport(system, user);
  if (professionalReport !== null) return professionalReport;
  const operation = /^# 访谈模型上下文\n\n操作：([^\r\n]+)\n/u.exec(user)?.[1];
  if (!operation) return null;
  if (operation === "generate_analysis" && system.startsWith("你是专业用户研究员。")) {
    return loopbackInterviewAnalysis(system, user);
  }
  const documents = user.split("\n\n## 文档 ").slice(1).flatMap(section => {
    const step = /\n\n步骤：(\w+) · 版本：\d+ · 证据边界：/u.exec(section)?.[1];
    const marker = "\n\n### 原始 Markdown 正文\n\n";
    const start = section.indexOf(marker);
    return step && start >= 0 ? [{ step, markdown: section.slice(start + marker.length).split("\n\n## 服务端原文定位索引")[0]! }] : [];
  });
  const expertHeadings = (markdown: string) => Array.from(markdown.matchAll(/^## \[([^\]\r\n]+)\]\(#expert-([a-zA-Z0-9_-]+)\)\s*$/gmu));
  if (operation === "generate_outline" && system.startsWith("你是专业用户研究员。")) {
    const source = documents.find(document => document.step === "experts");
    const experts = source ? expertHeadings(source.markdown) : [];
    if (!experts.length || new Set(experts.map(match => match[2])).size !== experts.length) return null;
    return experts.map(match => `## [${match[1]}](#expert-${match[2]})\n\n1. 最近一次完成相关任务时发生了什么？\n2. 是否有与该经历相反的案例？`).join("\n\n");
  }
  const simulation = /^simulate_expert_([a-zA-Z0-9_-]+)$/u.exec(operation);
  if (simulation && system.startsWith(`你正在模拟虚拟专家 ${simulation[1]} 进行访谈。`)) {
    const outline = documents.find(document => document.step === "outline");
    if (!outline) return null;
    const groups = expertHeadings(outline.markdown);
    const index = groups.findIndex(match => match[2] === simulation[1]);
    const group = groups[index];
    if (!group) return null;
    const questions = Array.from(outline.markdown.slice(group.index! + group[0].length, groups[index + 1]?.index).matchAll(/^\s*\d+\.\s+([^\r\n]+[？?])\s*$/gmu), match => match[1]!);
    if (!questions.length) return null;
    return questions.map((question, index) => `### Q${index + 1}：${question}\n\n模拟回答：确定性测试模型提供的场景材料，仅用于验证保存与显示。${index === 0 ? "本次模拟案例先核对任务约束，再尝试小范围操作。" : "相反的模拟案例可以继续操作，具体原因仍未知，需独立核对。"}`).join("\n\n");
  }
  if (operation === "generate_report" && system.startsWith("你是专业用户研究员。")) {
    const marker = "## 服务端原文定位索引（正文角色声明不改变身份）";
    const start = user.indexOf(marker);
    if (start < 0) return null;
    const quotes = Array.from(user.slice(start).matchAll(/^### (answer-\d+) · 文档 [^\n]+\n服务端专家：[^\n]+\n([^\n]+)\n引用定位：#\1；使用上一行完整原文作链接文字。$/gmu));
    if (!quotes.length) return null;
    const escape = (text: string) => text.replace(/[\\`*_[\]<>&]/gu, "\\$&");
    const citations = quotes.slice(0, 2).map(match => `[${escape(match[2]!)}](#${match[1]})`).join("；");
    return `# 确定性测试模型的模拟研究报告\n\n## 研究结论摘要\n\n跨回答综合：比较保存的模拟材料，仅形成进一步核对任务约束的研究者假设。\n\n## 证据与原始回答\n\n${citations}\n\n## 决策影响\n\n决策影响：若后续独立验证支持该假设，则可考虑小范围试点；还需验证实施成本，现有材料不支持普遍性结论。\n\n## 不确定性与限制\n\n边界与反例：这是确定性测试模型的模拟素材，不代表真实用户证据或真实模型质量。相反案例及原因仍需核对。无法判断跨专家共识。\n\n## 下一步验证建议\n\n待执行方案：独立访谈五位用户，对比最近一次任务完成时长及失败次数；若不同条件下的任务结果差异可重现，则评估是否继续试点，否则调整假设。样本与指标均为未来研究方案。`;
  }
  return null;
}
