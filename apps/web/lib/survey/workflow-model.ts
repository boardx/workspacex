import { survey } from "@repo/contracts";
import { z } from "zod";
import { SURVEY_QUESTION_MODULE_CARDS } from "@/lib/survey/resource-library";

export type SurveyWorkflowModel = z.infer<typeof survey.SurveyWorkflowSchema>;

export interface SurveyMetrics {
  received: number;
  valid: number;
  needsReview: number;
  completionRate: number;
  averageDurationSeconds: number;
}

export interface PublishBlocker {
  code: "QUESTION_OPTIONS_EMPTY" | "MAPPING_INCOMPLETE";
  label: string;
}

interface CreateSurveyWorkflowMockOptions {
  surveyId?: string;
  moduleId?: string;
  sourceModuleId?: string;
  moduleEditor?: boolean;
}

const cloneQuestions = (questions: survey.SurveyWorkflowQuestion[]) => questions.map((question) => ({
  ...question,
  options: [...question.options],
}));

export function createSurveyWorkflowMock(options: CreateSurveyWorkflowMockOptions = {}): survey.SurveyWorkflowModel {
  const questions: survey.SurveyWorkflowQuestion[] = [
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

  const answerFor = (id: string, value: string | string[]) => ({ questionId: id, value });
  const responses = Array.from({ length: 62 }, (_, index): survey.SurveyResponse => ({
    id: `R-${String(index + 1).padStart(4, "0")}`,
    submitter: `匿名受访者 ${index + 1}`,
    role: ["高层管理者", "部门负责人", "普通员工"][index % 3]!,
    companySize: ["50–199人", "200–999人", "1000–4999人"][index % 3]!,
    quality: index < 6 ? "review" : "normal",
    submittedAt: new Date(Date.UTC(2026, 7, 12, 1, index)).toISOString(),
    durationSeconds: 260 + index * 3,
    answers: [
      answerFor("Q01", ["企业高管", "部门负责人", "项目负责人"][index % 3]!),
      answerFor("Q02", "专业服务"),
      answerFor("Q03", ["50–199人", "200–999人", "1000–4999人"][index % 3]!),
      ...questions.slice(3, 15).map((question, questionIndex) => answerFor(question.id, String(2 + ((index + questionIndex) % 3)))),
      answerFor("Q16", "加强跨部门协作流程、系统集成与知识治理。"),
    ],
  }));

  const isNew = options.surveyId === "new";
  const requestedModuleId = options.moduleEditor ? options.moduleId : options.sourceModuleId;
  const knownModule = requestedModuleId
    ? SURVEY_QUESTION_MODULE_CARDS.some((item) => item.id === requestedModuleId)
    : false;
  const selectedQuestions = options.moduleEditor && isNew && !options.moduleId
    ? []
    : requestedModuleId
      ? knownModule
        ? cloneQuestions(questions.filter((question) => question.chapterId === requestedModuleId))
        : []
      : isNew
        ? []
        : cloneQuestions(questions);
  const selectedResponses = isNew || options.moduleId ? [] : responses;
  const moduleTitle = SURVEY_QUESTION_MODULE_CARDS.find((item) => item.id === options.moduleId)?.title;
  const title = options.moduleEditor
    ? moduleTitle ?? "未命名问卷模块"
    : isNew
      ? "未命名问卷"
      : "企业数字协作成熟度诊断";

  return survey.SurveyWorkflowSchema.parse({
    survey: { id: options.surveyId ?? "sv-1", title, status: isNew ? "draft" : "collecting", lastSavedAt: "2026-08-12T10:00:00.000Z" },
    questions: selectedQuestions,
    reportTemplate: {
      sections: [
        { id: "summary", title: "管理层摘要", managementQuestion: "组织整体成熟度与主要短板是什么？", method: "综合评分与差距分析", output: "text" },
        { id: "findings", title: "关键发现", managementQuestion: "哪些证据最值得管理层关注？", method: "频次与交叉分析", output: "chart", chartType: "grouped-bar" },
        { id: "meaning", title: "业务含义", managementQuestion: "短板将如何影响协作绩效？", method: "业务影响推断", output: "text" },
        { id: "gap", title: "能力缺口", managementQuestion: "当前水平与目标水平的差距是什么？", method: "目标值减当前值", output: "chart", chartType: "gap-matrix" },
        { id: "scenario", title: "情景选择", managementQuestion: "不同投入组合的结果如何？", method: "情景分析", output: "chart", chartType: "radar" },
        { id: "action", title: "优先行动", managementQuestion: "下一步最应优先做什么？", method: "影响与可行性排序", output: "text" },
        { id: "roadmap", title: "90天路线图", managementQuestion: "如何在 90 天内形成闭环？", method: "里程碑规划", output: "chart", chartType: "line" },
        { id: "boundary", title: "方法与边界", managementQuestion: "结论适用到什么范围？", method: "证据边界审查", output: "text" },
      ],
    },
    publication: { target: 100, link: "https://survey.boardx.test/s/7gnk2e" },
    responses: selectedResponses,
    report: {
      generatedAt: "2026-08-12T10:00:00.000Z",
      sections: [
        { id: "summary", title: "管理层摘要", body: "组织已具备一定的协作基础与工具覆盖，但系统集成与知识治理仍是主要短板。" },
        { id: "findings", title: "关键发现", body: "组织与协同文化相对领先；系统集成与知识治理显著低于目标。" },
        { id: "meaning", title: "业务含义", body: "信息重复录入和跨系统切换正在拉低协同效率。" },
        { id: "gap", title: "能力缺口", body: "系统集成差距为 -2.1，知识治理差距为 -1.7。" },
        { id: "scenario", title: "情景选择", body: "优先补齐集成底座可释放更高的知识复用价值。" },
        { id: "action", title: "优先行动", body: "先统一关键流程的数据入口，再建立知识治理责任制。" },
        { id: "roadmap", title: "90天路线图", body: "30 天盘点、60 天试点、90 天规模化。" },
        { id: "boundary", title: "方法与边界", body: "本报告基于 62 份模拟答卷，用于界面签核，不代表真实组织诊断。" },
      ],
    },
  });
}

export function getSurveyQuestionModuleQuestions(moduleId: string): survey.SurveyWorkflowQuestion[] {
  return cloneQuestions(createSurveyWorkflowMock({ surveyId: "new", moduleId, moduleEditor: true }).questions);
}

export function getSurveyMetrics(model: survey.SurveyWorkflowModel): SurveyMetrics {
  const received = model.responses.length;
  const needsReview = model.responses.filter((response) => response.quality === "review").length;
  const durationTotal = model.responses.reduce((sum, response) => sum + response.durationSeconds, 0);
  return {
    received,
    valid: received - needsReview,
    needsReview,
    completionRate: Math.round((received / model.publication.target) * 100),
    averageDurationSeconds: received === 0 ? 0 : Math.round(durationTotal / received),
  };
}

export function getPublishBlockers(model: survey.SurveyWorkflowModel): PublishBlocker[] {
  const blockers: PublishBlocker[] = [];
  if (model.questions.some((question) => question.type !== "open" && question.options.length === 0)) {
    blockers.push({ code: "QUESTION_OPTIONS_EMPTY", label: "选择题必须至少包含一个选项" });
  }
  if (model.questions.some((question) => question.chapterId.length === 0)) {
    blockers.push({ code: "MAPPING_INCOMPLETE", label: "所有题目必须归属报告章节" });
  }
  return blockers;
}

export function markResponseForReview(model: survey.SurveyWorkflowModel, responseId: string): survey.SurveyWorkflowModel {
  return {
    ...model,
    responses: model.responses.map((response) => response.id === responseId ? { ...response, quality: "review" as const } : response),
  };
}
