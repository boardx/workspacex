/**
 * Studio · 原型 mock 数据（UC-7.1 · PROTOTYPE-DIGEST 第五节）
 *
 * 硬规则（要在界面上说清）：只保留最新版本 —— 改动直接落在最新版上，不做版本并排比较；
 * 上一步可以撤回，但不维护并行分支。
 */

/** 原型五步流程（用于卡片进度展示） */
export const PROTOTYPE_STEPS = ["设计方向", "信息架构", "页面与调整", "交互与状态", "交付"] as const;

export type PrototypeStatus = "blocked" | "draft" | "in-progress" | "delivered";

export interface PrototypeCard {
  id: string;
  title: string;
  status: PrototypeStatus;
  /** 当前落在第几步（1-based），delivered = 5 全部完成 */
  step: number;
  /** 状态副标（照 digest 四种卡片文案） */
  statusLine: string;
  version: string;
  updatedAt: string;
  /** 组件数（部分卡有） */
  components?: number;
  /** 审计阻断数（仅 blocked 卡） */
  blockers?: number;
  /** 阻断明细（仅 blocked 卡，用于「看 N 项阻断」展开）*/
  blockerDetails?: string[];
  /** 关联的项目环节；null = 不属于任何项目 */
  projectStage: string | null;
}

/** 本项目组 */
export const PROJECT_PROTOTYPES: PrototypeCard[] = [
  {
    id: "pt-entry-flow",
    title: "组员入口与同意书流程",
    status: "blocked",
    step: 5,
    statusLine: "最新 v3 · 审计 2 项阻断",
    version: "v3",
    updatedAt: "8 分钟前",
    components: 11,
    blockers: 2,
    blockerDetails: [
      "同意书「撤回」按钮缺少二次确认与影响范围说明（危险动作规范 D-13）",
      "登录页三个第三方按钮未标 later，会让人以为可用（D-02）",
    ],
    projectStage: "欧洲市场进入 · 环节 4「一线访谈」",
  },
  {
    id: "pt-dashboard",
    title: "现场大屏 · 主持台",
    status: "in-progress",
    step: 3,
    statusLine: "停在「页面与调整」· 7 个组件 · 3 分钟前",
    version: "v2",
    updatedAt: "3 分钟前",
    components: 7,
    projectStage: "欧洲市场进入 · 环节 3「商业模式共创」",
  },
  {
    id: "pt-report-cover",
    title: "月度决策报告 · 封面与目录",
    status: "delivered",
    step: 5,
    statusLine: "已交付 v5 · 已完成全部 5 步",
    version: "v5",
    updatedAt: "上周五",
    components: 18,
    projectStage: "欧洲市场进入 · 成果沉淀",
  },
];

/** 不属于任何项目组 */
export const UNLINKED_PROTOTYPES: PrototypeCard[] = [
  {
    id: "pt-onboarding",
    title: "顾问上手引导（草图）",
    status: "draft",
    step: 1,
    statusLine: "草稿 · 停在「设计方向」",
    version: "v1",
    updatedAt: "昨天 21:40",
    projectStage: null,
  },
  {
    id: "pt-quota-widget",
    title: "配额预警小组件",
    status: "in-progress",
    step: 2,
    statusLine: "停在「信息架构」· 4 个组件 · 1 小时前",
    version: "v1",
    updatedAt: "1 小时前",
    components: 4,
    projectStage: null,
  },
];

export const PROTOTYPE_FILTERS = [
  { key: "all", label: "全部", count: 5 },
  { key: "blocked", label: "有阻断", count: 1 },
  { key: "in-progress", label: "进行中", count: 2 },
  { key: "delivered", label: "已交付", count: 1 },
  { key: "draft", label: "草稿", count: 1 },
] as const;
export type PrototypeFilterKey = (typeof PROTOTYPE_FILTERS)[number]["key"];

export const STUDIO_AUTOSAVE = {
  elapsed: "34:12",
  runningInBackground: true,
} as const;

/** 「挂到项目环节…」可选的目标环节（原型无接口，仅供本地选择演示）*/
export interface AttachTarget {
  id: string;
  project: string;
  stage: string;
}
export const ATTACH_STAGES: AttachTarget[] = [
  { id: "st-3", project: "欧洲市场进入", stage: "环节 3「商业模式共创」" },
  { id: "st-4", project: "欧洲市场进入", stage: "环节 4「一线访谈」" },
  { id: "st-5", project: "欧洲市场进入", stage: "成果沉淀 · 决策报告" },
  { id: "st-x", project: "东南亚储能预研", stage: "环节 1「市场扫描」" },
];
