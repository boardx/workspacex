import type { survey } from "@repo/contracts";

/** Original editable content only. No responses, metrics, publication or conclusions. */
const referenceQuestions: survey.SurveyWorkflowQuestion[] = [
    { id: "Q01", order: 1, chapterId: "profile", type: "single", title: "您目前承担的主要职责层级是？", required: true, options: ["企业高管", "部门负责人", "项目负责人", "专业骨干", "一线员工"] },
    { id: "Q02", order: 2, chapterId: "profile", type: "single", title: "所在组织的主要业务领域是？", required: true, options: ["专业服务", "软件与互联网", "制造业", "能源", "其他"] },
    { id: "Q03", order: 3, chapterId: "profile", type: "single", title: "您所在组织的员工规模大致是？", required: true, options: ["50人以下", "50–199人", "200–999人", "1000–4999人", "5000人及以上"] },
    { id: "Q04", order: 4, chapterId: "strategy", type: "scale", title: "组织的数字化战略清晰度如何？", required: true, options: ["1", "2", "3", "4", "5"] },
    { id: "Q05", order: 5, chapterId: "strategy", type: "scale", title: "高层对数字化协作的重视程度如何？", required: true, options: ["1", "2", "3", "4", "5"] },
    { id: "Q06", order: 6, chapterId: "strategy", type: "scale", title: "组织在数字化方面的投入水平如何？", required: true, options: ["1", "2", "3", "4", "5"] },
    { id: "Q07", order: 7, chapterId: "collaboration", type: "scale", title: "跨部门协作的流程是否清晰？", required: true, options: ["1", "2", "3", "4", "5"] },
    { id: "Q08", order: 8, chapterId: "collaboration", type: "scale", title: "跨部门协作的效率如何？", required: true, options: ["1", "2", "3", "4", "5"] },
    { id: "Q09", order: 9, chapterId: "knowledge", type: "scale", title: "知识在组织内的共享是否顺畅？", required: true, options: ["1", "2", "3", "4", "5"] },
    { id: "Q10", order: 10, chapterId: "knowledge", type: "scale", title: "员工获取所需知识的难易程度？", required: true, options: ["1", "2", "3", "4", "5"] },
    { id: "Q11", order: 11, chapterId: "data", type: "scale", title: "基于数据的决策文化成熟度如何？", required: true, options: ["1", "2", "3", "4", "5"] },
    { id: "Q12", order: 12, chapterId: "data", type: "scale", title: "数据质量与可用性如何？", required: true, options: ["1", "2", "3", "4", "5"] },
    { id: "Q13", order: 13, chapterId: "tools", type: "scale", title: "当前使用的协作工具满足度如何？", required: true, options: ["1", "2", "3", "4", "5"] },
    { id: "Q14", order: 14, chapterId: "tools", type: "scale", title: "系统间的数据互通与集成程度如何？", required: true, options: ["1", "2", "3", "4", "5"] },
    { id: "Q15", order: 15, chapterId: "talent", type: "scale", title: "数字化人才的储备是否充足？", required: true, options: [] },
    { id: "Q16", order: 16, chapterId: "", type: "open", title: "您认为当前最优先的改进方向是？", required: true, options: [] },
  ];

const referenceReportSections: survey.SurveyWorkflowModel["reportTemplate"]["sections"] = [
        { id: "summary", title: "管理层摘要", managementQuestion: "组织整体成熟度与主要短板是什么？", method: "综合评分与差距分析", output: "text" },
        { id: "findings", title: "关键发现", managementQuestion: "哪些证据最值得管理层关注？", method: "频次与交叉分析", output: "chart", chartType: "grouped-bar" },
        { id: "meaning", title: "业务含义", managementQuestion: "短板将如何影响协作绩效？", method: "业务影响推断", output: "text" },
        { id: "gap", title: "能力缺口", managementQuestion: "当前水平与目标水平的差距是什么？", method: "目标值减当前值", output: "chart", chartType: "gap-matrix" },
        { id: "scenario", title: "情景选择", managementQuestion: "不同投入组合的结果如何？", method: "情景分析", output: "chart", chartType: "radar" },
        { id: "action", title: "优先行动", managementQuestion: "下一步最应优先做什么？", method: "影响与可行性排序", output: "text" },
        { id: "roadmap", title: "90天路线图", managementQuestion: "如何在 90 天内形成闭环？", method: "里程碑规划", output: "chart", chartType: "line" },
        { id: "boundary", title: "方法与边界", managementQuestion: "结论适用到什么范围？", method: "证据边界审查", output: "text" },
      ];

export function getSurveyReferenceQuestions(): survey.SurveyWorkflowQuestion[] {
  return structuredClone(referenceQuestions);
}
export function getSurveyReferenceReportSections(): survey.SurveyWorkflowModel["reportTemplate"]["sections"] {
  return structuredClone(referenceReportSections);
}
