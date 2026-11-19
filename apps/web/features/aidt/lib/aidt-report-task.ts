import { aidtHref } from "./project-aidt";

export { AIDT_SUMMARY_STABLE_NAME as AIDT_REPORT_SKILL } from "@repo/contracts/aidt-run-context";
export const AIDT_REPORT_GUIDANCE = [
  "生成一份学生可以独立审阅和提交的 Markdown 研究报告。只输出一次正文，从具体的项目标题开始。",
  "先给当前决策和证据强度。正文说明研究对象、场景、问题边界及问题如何演变，再呈现最有决策价值的发现、反例和缺口。引用实际使用的阶段版本。",
  "比较入选方案与替代方案，说明取舍理由。用被测原型版本、验证任务和观察结果说明认识如何变化，以及为什么返回某一步。",
  "把原始观察、学生解释和待验证假设分开。合成演练、未执行的方案、原型生成和学生确认均不能作为真实用户结果。没有数据就说明无法判断的结论。",
  "若证据不足，按研究方案组织报告，写清基线、对照条件、完成标准、用时或出错等可观察指标，以及什么结果会改变当前决定。只提出适合本项目的指标，不捏造阈值、样本或数据。",
  "用自然语言综合六步材料，省略空字段、表单流水账、内部 ID、机器字段名及聊天开场和收尾。没有授权的教师点评或其他来源只在影响判断时简述。等待学生审阅，不能自动改动或保存报告。",
].join("\n");
export function aidtReportChatHref(projectId: string, options: { tool?: "chat" | "report"; threadId?: string | null; stageThread?: string | null; returnRevision?: string | null } = {}) {
  const href = aidtHref(projectId, 6, { tool: options.tool ?? "chat", thread: options.stageThread, returnRevision: options.returnRevision });
  const [path, query] = href.split("?");
  const params = new URLSearchParams(query); params.set("summary", "1");
  if (options.threadId) params.set("summaryThread", options.threadId);
  return `${path}?${params}`;
}
