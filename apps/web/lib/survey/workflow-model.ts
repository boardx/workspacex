import { getSurveyReferenceQuestions, getSurveyReferenceReportSections } from "./template-content";
import { survey } from "@repo/contracts";
import { z } from "zod";
import { SURVEY_QUESTION_MODULE_CARDS } from "@/lib/survey/resource-library";
import type { SurveyCreationDraft } from "@/lib/survey/creation-draft";

export type SurveyWorkflowModel = z.infer<typeof survey.SurveyWorkflowSchema>;

export interface SurveyMetrics {
  received: number;
  valid: number;
  needsReview: number;
  validRate: number;
  completionRate: number;
  averageDurationSeconds: number;
}

export interface PublishBlocker {
  code: "QUESTIONS_EMPTY" | "QUESTION_OPTIONS_EMPTY" | "MAPPING_INCOMPLETE";
  label: string;
}

interface CreateSurveyWorkflowMockOptions {
  surveyId?: string;
  moduleId?: string;
  creationDraft?: SurveyCreationDraft;
  moduleEditor?: boolean;
}

const cloneQuestions = (questions: survey.SurveyWorkflowQuestion[]) => questions.map((question) => ({
  ...question,
  options: [...question.options],
}));

export function createSurveyWorkflowMock(options: CreateSurveyWorkflowMockOptions = {}): survey.SurveyWorkflowModel {
  const questions = getSurveyReferenceQuestions();

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
  const requestedModuleId = options.moduleEditor
    ? options.moduleId
    : isNew
      ? options.creationDraft?.sourceModuleId
      : undefined;
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
      ? options.creationDraft?.name ?? "未命名问卷"
      : "企业数字协作成熟度诊断";

  return survey.SurveyWorkflowSchema.parse({
    survey: { id: options.surveyId ?? "sv-1", title, status: isNew ? "draft" : "collecting", lastSavedAt: "2026-08-12T10:00:00.000Z" },
    questions: selectedQuestions,
    reportTemplate: {
      sections: getSurveyReferenceReportSections(),
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
    validRate: received === 0 ? 0 : Math.round(((received - needsReview) / received) * 100),
    completionRate: model.publication.target === 0 ? 0 : Math.round((received / model.publication.target) * 100),
    averageDurationSeconds: received === 0 ? 0 : Math.round(durationTotal / received),
  };
}

export function getPublishBlockers(model: survey.SurveyWorkflowModel): PublishBlocker[] {
  const blockers: PublishBlocker[] = [];
  if (model.questions.length === 0) {
    blockers.push({ code: "QUESTIONS_EMPTY", label: "问卷必须至少包含一道题目" });
  }
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
