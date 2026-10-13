import { research as C } from "@repo/contracts";
import type { ResearchRuntime } from "./guided-runtime-ports";

export function reportSearchLimitation(state: ResearchRuntime): string {
  if (!state.reportPartial) return "";
  const failed = state.tasks.filter(task => task.status === "failed").length;
  return C.guidedResearchReportFraming(state.brief).language === "Chinese"
    ? `检索范围与局限：${state.tasks.length} 个检索任务中有 ${failed} 个未取得可用结果。本报告基于已核验的保留资料生成，相关问题的数据局限与后续核验要求在正文中说明。\n\n`
    : `Search limitation: ${failed} of ${state.tasks.length} search tasks returned no usable results. This report uses retained verified materials; specific evidence limitations and verification needs are stated in the report.\n\n`;
}
export function reportIntroductionCapacity(state: ResearchRuntime): number {
  return C.GuidedResearchReportSynthesisModelOutput.shape.introduction.maxLength! - reportSearchLimitation(state).length;
}
