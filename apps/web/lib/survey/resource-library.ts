export type SurveyResourceTab = "surveys" | "modules" | "reports";
export type SurveyResourceState = "default" | "loading" | "empty" | "error";
export type SurveyCardStatus = "draft" | "collecting" | "closed";
export type TemplateCategory = "organization" | "collaboration" | "feedback";

export interface SurveyLibraryCard {
  id: string;
  title: string;
  status: SurveyCardStatus;
  questionCount: number;
  reportSectionCount: number;
  updatedAt: string;
  received?: number;
  validResponses?: number;
  target?: number;
}

export interface SurveyTemplateCard {
  id: string;
  title: string;
  category: TemplateCategory;
  questionCount: number;
  reportSectionCount: number;
  updatedAt: string;
  surveyCount: number;
}

export const SURVEY_LIBRARY_CARDS: SurveyLibraryCard[] = [
  { id: "sv-1", title: "企业数字协作成熟度诊断", status: "collecting", questionCount: 16, reportSectionCount: 8, updatedAt: "今天 10:30", received: 62, validResponses: 56, target: 100 },
  { id: "sv-team-health", title: "团队协作健康度调查", status: "draft", questionCount: 20, reportSectionCount: 6, updatedAt: "昨天 16:20" },
  { id: "sv-project-review", title: "客户项目复盘问卷", status: "closed", questionCount: 12, reportSectionCount: 5, updatedAt: "昨天 14:10", received: 86 },
  { id: "sv-tool-satisfaction", title: "员工数字工具满意度", status: "collecting", questionCount: 18, reportSectionCount: 7, updatedAt: "前天 11:15", received: 41, target: 80 },
  { id: "sv-meeting-feedback", title: "会议反馈调查", status: "draft", questionCount: 8, reportSectionCount: 3, updatedAt: "3 天前 09:40" },
  { id: "sv-knowledge-governance", title: "组织知识治理评估", status: "closed", questionCount: 24, reportSectionCount: 8, updatedAt: "4 天前 17:20", received: 124 },
];

export const SURVEY_TEMPLATE_CARDS: SurveyTemplateCard[] = [
  { id: "tpl-digital-collaboration", title: "企业数字协作成熟度诊断模板", category: "organization", questionCount: 16, reportSectionCount: 8, updatedAt: "今天 09:20", surveyCount: 12 },
  { id: "tpl-team-health", title: "团队协作健康度模板", category: "collaboration", questionCount: 20, reportSectionCount: 6, updatedAt: "昨天 15:40", surveyCount: 8 },
  { id: "tpl-project-review", title: "客户项目复盘模板", category: "feedback", questionCount: 12, reportSectionCount: 5, updatedAt: "2 天前 11:30", surveyCount: 15 },
  { id: "tpl-knowledge-governance", title: "组织知识治理评估模板", category: "organization", questionCount: 24, reportSectionCount: 8, updatedAt: "4 天前 16:50", surveyCount: 6 },
];

export const SURVEY_STATUS_LABEL: Record<SurveyCardStatus, string> = {
  draft: "草稿",
  collecting: "回收中",
  closed: "已完成",
};

export const TEMPLATE_CATEGORY_LABEL: Record<TemplateCategory, string> = {
  organization: "组织诊断",
  collaboration: "团队协作",
  feedback: "客户反馈",
};
