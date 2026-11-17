import { aidtHref } from "./project-aidt";

export { AIDT_SUMMARY_STABLE_NAME as AIDT_REPORT_SKILL } from "@repo/contracts/aidt-run-context";
export const AIDT_REPORT_GUIDANCE = "这是六步之后的报告总结任务，不是第七步。使用已挂载的dt-summarize-project，按本组实际已保存的六步材料及有界历史组织学生审阅稿。保留问题来源反思、意外或暂无、点子分类/选择理由、验证问题、前后认识与返工决定。原始证据、学生解释、AI推测分开；缺少材料、读取失败、截断、未决定必须明示。不补造采访、测试、教师点评、投票、文件生成或导出成功。先等待学生触发，结果由学生审阅选择，不自动修改或保存报告。";
export function aidtReportChatHref(projectId: string, options: { tool?: "chat" | "report"; threadId?: string | null; stageThread?: string | null; returnRevision?: string | null } = {}) {
  const href = aidtHref(projectId, 6, { tool: options.tool ?? "chat", thread: options.stageThread, returnRevision: options.returnRevision });
  const [path, query] = href.split("?");
  const params = new URLSearchParams(query); params.set("summary", "1");
  if (options.threadId) params.set("summaryThread", options.threadId);
  return `${path}?${params}`;
}
