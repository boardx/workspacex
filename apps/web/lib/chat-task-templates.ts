export interface TaskTemplate {
  readonly id: string;
  readonly label: string;
  readonly goal: string;
  /** 卡片左侧图标徽标里的单字标签（视觉分类用，不承载任何判据文案）。 */
  readonly badge: string;
  /** 徽标底色 + 前景色的语义 token 对（U5a 只允许语义色，见 `lint-design.sh`）。 */
  readonly badgeTone: "accent" | "warning-tint" | "ai-tint";
}

/**
 * 判据逐字点名的四类任务模板。`goal` 是模板被点击后真的填进输入框的文本——
 * 不是发送，是填进去（判据 TW-P0-1②反伪造条款：点了没反应/不影响输入框的按钮判 0）。
 */
export const TASK_WORKBENCH_TEMPLATES: readonly TaskTemplate[] = [
  {
    id: "chat-task-workbench-template-research",
    label: "调研市场并产出带来源的报告",
    goal: "帮我调研一下当前市场情况，产出一份带引用来源的调研报告。",
    badge: "研",
    badgeTone: "accent",
  },
  {
    id: "chat-task-workbench-template-reading",
    label: "阅读材料整理决策建议",
    goal: "帮我阅读我上传的材料，整理出可执行的决策建议。",
    badge: "读",
    badgeTone: "warning-tint",
  },
  {
    id: "chat-task-workbench-template-planning",
    label: "需求拆成计划并生成项目产物",
    goal: "帮我把这个需求拆成一份可执行的计划，并生成相应的项目产物。",
    badge: "拆",
    badgeTone: "accent",
  },
  {
    id: "chat-task-workbench-template-analysis",
    label: "分析数据发现异常并制图",
    goal: "帮我分析这份数据，找出其中的异常点，并生成图表。",
    badge: "析",
    badgeTone: "ai-tint",
  },
];
