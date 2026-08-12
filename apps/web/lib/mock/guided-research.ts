export const GUIDED_RESEARCH_STEPS = ["home", "brief", "directions", "outline", "search", "report"] as const;
export type GuidedResearchStep = (typeof GUIDED_RESEARCH_STEPS)[number];

export function resolveGuidedResearchStep(raw?: string | string[]): GuidedResearchStep {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return GUIDED_RESEARCH_STEPS.includes(value as GuidedResearchStep) ? value as GuidedResearchStep : "home";
}

export const GUIDED_STEP_META: ReadonlyArray<{
  id: GuidedResearchStep;
  label: string;
  eyebrow: string;
}> = [
  { id: "home", label: "研究首页", eyebrow: "历史与新建" },
  { id: "brief", label: "确认主题", eyebrow: "研究输入" },
  { id: "directions", label: "研究方向", eyebrow: "可编辑" },
  { id: "outline", label: "报告大纲", eyebrow: "可编辑" },
  { id: "search", label: "Web Search", eyebrow: "执行中" },
  { id: "report", label: "研究报告", eyebrow: "完整产出" },
] as const;

export interface GuidedResearchHistoryItem {
  id: string;
  title: string;
  description: string;
  status: "draft" | "researching" | "completed";
  statusLabel: string;
  progress: number;
  sources: number;
  updatedAt: string;
  resumeAt: GuidedResearchStep;
}

export const GUIDED_RESEARCH_HISTORY: GuidedResearchHistoryItem[] = [
  {
    id: "r-energy",
    title: "欧洲储能市场进入策略",
    description: "市场规模、监管政策、竞争格局与进入路径",
    status: "researching",
    statusLabel: "研究中",
    progress: 68,
    sources: 27,
    updatedAt: "8 分钟前",
    resumeAt: "search",
  },
  {
    id: "r-grid",
    title: "德国并网审批流程与周期",
    description: "州级审批差异、材料返工与真实项目周期",
    status: "completed",
    statusLabel: "已完成",
    progress: 100,
    sources: 41,
    updatedAt: "昨天",
    resumeAt: "report",
  },
  {
    id: "r-policy",
    title: "欧盟电池法规影响评估",
    description: "碳足迹、供应链尽调与企业合规准备",
    status: "draft",
    statusLabel: "待确认主题",
    progress: 12,
    sources: 0,
    updatedAt: "3 天前",
    resumeAt: "brief",
  },
];

export interface GuidedResearchBrief {
  topic: string;
  goal: string;
  timeRange: string;
  region: string;
  focus: string;
}

export const GUIDED_RESEARCH_BRIEF: GuidedResearchBrief = {
  topic: "欧洲储能市场进入策略",
  goal: "判断未来三年最值得优先进入的国家、细分场景和合作模式，并给出可执行的进入路线图。",
  timeRange: "2023–2027",
  region: "欧盟 27 国，重点关注德国、英国、意大利和西班牙",
  focus: "市场增长质量、政策确定性、并网可行性、竞争强度与本地合作伙伴",
};

export interface GuidedResearchDirection {
  id: string;
  title: string;
  description: string;
  enabled: boolean;
}

export const GUIDED_RESEARCH_DIRECTIONS: GuidedResearchDirection[] = [
  { id: "d1", title: "市场规模与增长动能", description: "拆分表前、表后与工商业储能，辨别装机增长和收入增长的质量。", enabled: true },
  { id: "d2", title: "监管政策与并网约束", description: "比较容量市场、辅助服务、电价机制及各国并网审批摩擦。", enabled: true },
  { id: "d3", title: "竞争格局与进入路径", description: "识别头部开发商、聚合商与 EPC，评估自建、合资和渠道合作。", enabled: true },
];

export interface GuidedOutlineSection {
  id: string;
  title: string;
  questions: string[];
  enabled: boolean;
}

export const GUIDED_RESEARCH_OUTLINE: GuidedOutlineSection[] = [
  { id: "o1", title: "执行摘要与关键判断", questions: ["首选市场与进入时点", "关键风险与反证"], enabled: true },
  { id: "o2", title: "市场规模与商业模式", questions: ["2023–2027 装机与收入规模", "细分场景单位经济性"], enabled: true },
  { id: "o3", title: "政策、并网与收入机制", questions: ["关键政策变化", "各国并网周期与约束"], enabled: true },
  { id: "o4", title: "竞争格局与进入建议", questions: ["主要玩家与差异化", "合作对象及 90 天行动"], enabled: true },
];

export const GUIDED_SEARCH_SOURCES = [
  { id: "s1", domain: "ec.europa.eu", title: "Energy storage recommendations and market design", kind: "官方政策", confidence: "高" },
  { id: "s2", domain: "iea.org", title: "Batteries and Secure Energy Transitions", kind: "国际机构", confidence: "高" },
  { id: "s3", domain: "solarpowereurope.org", title: "European Market Outlook for Battery Storage 2025–2029", kind: "行业报告", confidence: "中" },
] as const;

export const GUIDED_SEARCH_TASKS = [
  { id: "t1", label: "市场规模与商业模式", status: "completed", sources: 12 },
  { id: "t2", label: "政策与收入机制", status: "completed", sources: 9 },
  { id: "t3", label: "并网周期与约束", status: "running", sources: 6 },
  { id: "t4", label: "竞争格局与进入建议", status: "queued", sources: 0 },
] as const;

export const GUIDED_REPORT_CITATIONS = [
  { id: "c1", label: "European Commission · Energy storage recommendations", url: "ec.europa.eu" },
  { id: "c2", label: "IEA · Batteries and Secure Energy Transitions", url: "iea.org" },
  { id: "c3", label: "SolarPower Europe · European Market Outlook", url: "solarpowereurope.org" },
  { id: "c4", label: "ENTSO-E · TYNDP 2024", url: "entsoe.eu" },
] as const;
