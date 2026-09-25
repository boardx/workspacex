import {
  createSurveyQuestion,
  surveyQuestionStatistics,
  type SurveyWorkflowQuestion,
} from "@repo/contracts/survey-question-types";
import type { SurveyTemplateInput } from "@repo/contracts/survey-template-library";
import type { SurveyReportBlock } from "@repo/contracts/survey-report";
type Item = [
  chapter: string,
  title: string,
  type: SurveyWorkflowQuestion["type"],
  options?: string[],
];
export const SURVEY_SCENARIOS: {
  id: string;
  title: string;
  description: string;
  items: Item[];
}[] = [
  {
    id: "digital-collaboration",
    title: "企业数字协作成熟度诊断",
    description:
      "从战略治理、流程协同、知识共享、数据能力与工具体验评估组织数字协作。建议由不同部门成员分别填写。",
    items: [
      [
        "组织画像",
        "您目前承担的主要职责层级是？",
        "single",
        ["企业高管", "部门负责人", "项目负责人", "专业骨干", "一线员工"],
      ],
      [
        "组织画像",
        "所在组织的主要业务领域是？",
        "dropdown",
        ["专业服务", "软件与互联网", "制造业", "能源", "其他"],
      ],
      [
        "组织画像",
        "您所在组织的员工规模大致是？",
        "single",
        ["50人以下", "50–199人", "200–999人", "1000–4999人", "5000人及以上"],
      ],
      ["战略治理", "组织的数字化目标清晰且被团队理解。", "scale"],
      ["战略治理", "管理层持续支持跨部门数字协作。", "scale"],
      ["战略治理", "数字化投入与当前业务需求匹配。", "scale"],
      ["流程协同", "跨部门工作交接的责任与标准清楚。", "scale"],
      ["流程协同", "重要协作事项能够及时推进。", "scale"],
      ["知识共享", "需要的知识与经验容易检索。", "scale"],
      ["知识共享", "团队有持续记录和共享经验的习惯。", "scale"],
      ["数据能力", "业务决策能够获得可靠数据支持。", "scale"],
      ["数据能力", "各系统的关键数据能够有效互通。", "scale"],
      ["工具体验", "您对目前协作工具的整体体验评分是？", "rating"],
      [
        "工具体验",
        "最常遇到哪些协作障碍？",
        "multi",
        [
          "重复录入",
          "查找信息困难",
          "系统割裂",
          "权责不清",
          "沟通延迟",
          "没有明显障碍",
        ],
      ],
      [
        "改进优先级",
        "请按优先级排序需要改善的能力。",
        "ranking",
        ["流程协同", "知识共享", "数据质量", "系统集成"],
      ],
      ["改进优先级", "请描述一个最希望改善的具体协作场景。", "open"],
    ],
  },
  {
    id: "team-health",
    title: "团队协作健康度调查",
    description:
      "围绕目标共识、心理安全、工作负荷、沟通与成长评估团队体验，不用于评价个人绩效。",
    items: [
      [
        "基本情况",
        "您加入当前团队多久了？",
        "single",
        ["不足3个月", "3–12个月", "1–3年", "3年以上"],
      ],
      [
        "基本情况",
        "您主要采用哪种协作方式？",
        "single",
        ["现场办公", "远程办公", "混合办公"],
      ],
      ["目标共识", "我清楚团队当前最重要的目标。", "scale"],
      ["目标共识", "我知道自己的工作如何支持团队目标。", "scale"],
      ["目标共识", "团队对任务优先级有一致理解。", "scale"],
      ["沟通与信任", "我可以在团队中安全地表达不同观点。", "scale"],
      ["沟通与信任", "需要帮助时，能及时获得同事支持。", "scale"],
      ["沟通与信任", "团队能坦诚讨论错误并改进。", "scale"],
      ["沟通与信任", "重要信息会及时同步给相关成员。", "scale"],
      [
        "工作体验",
        "最近两周的工作负荷如何？",
        "single",
        ["明显不足", "较轻", "适中", "偏重", "严重超负荷"],
      ],
      ["工作体验", "我有足够连续时间完成专注工作。", "scale"],
      ["工作体验", "会议与日常沟通的投入是合理的。", "scale"],
      ["工作体验", "我具备完成工作所需的工具和资源。", "scale"],
      ["成长支持", "我能获得具体且有帮助的反馈。", "scale"],
      ["成长支持", "团队给予我学习和尝试的机会。", "scale"],
      ["成长支持", "我的贡献得到公平认可。", "scale"],
      ["整体感受", "您向同事推荐加入本团队的可能性有多大？", "nps"],
      [
        "改进建议",
        "哪些方面最需要改善？",
        "multi",
        [
          "目标清晰度",
          "沟通效率",
          "工作负荷",
          "心理安全",
          "成长机会",
          "协作工具",
        ],
      ],
      [
        "改进建议",
        "请按改善优先级排序。",
        "ranking",
        ["减少无效会议", "明确职责", "改善信息共享", "调整工作节奏"],
      ],
      ["改进建议", "您希望团队保持或改变什么？", "open"],
    ],
  },
  {
    id: "project-review",
    title: "客户项目复盘问卷",
    description:
      "复盘项目目标、交付质量、沟通、风险与后续改进。适合客户与项目成员填写，并按实际参与情况解释结果。",
    items: [
      ["项目背景", "本次复盘的项目名称", "short"],
      [
        "项目背景",
        "您在项目中的角色是？",
        "single",
        ["客户负责人", "客户使用者", "项目经理", "交付成员", "支持角色"],
      ],
      ["项目背景", "项目实际结束日期", "date"],
      ["交付评价", "项目最终成果与原定目标的符合程度", "rating"],
      ["交付评价", "交付成果的质量如何？", "rating"],
      [
        "交付评价",
        "项目时间安排的执行情况如何？",
        "single",
        ["提前完成", "按期完成", "轻微延期", "明显延期"],
      ],
      ["协作过程", "项目沟通清晰、及时且可追踪。", "scale"],
      ["协作过程", "关键风险被及时识别和处理。", "scale"],
      [
        "协作过程",
        "哪些因素对项目影响最大？",
        "multi",
        [
          "需求变化",
          "资源不足",
          "技术难点",
          "信息不同步",
          "决策延迟",
          "外部依赖",
        ],
      ],
      ["后续合作", "您推荐与该团队再次合作的可能性有多大？", "nps"],
      ["经验沉淀", "最值得保留的一项做法是什么？", "open"],
      ["经验沉淀", "下个项目最需要改变的一项做法是什么？", "open"],
    ],
  },
  {
    id: "tool-satisfaction",
    title: "员工数字工具满意度",
    description:
      "识别工具使用频率、易用性、可靠性和改进优先级，结合实际任务场景评价工具价值。",
    items: [
      ["使用背景", "您主要使用的工具名称", "short"],
      [
        "使用背景",
        "您的使用频率",
        "single",
        ["每天多次", "每天一次", "每周数次", "偶尔使用"],
      ],
      [
        "使用背景",
        "您使用该工具多久了？",
        "single",
        ["不足1个月", "1–6个月", "6–12个月", "1年以上"],
      ],
      ["功能体验", "主要功能能够满足我的工作任务。", "scale"],
      ["功能体验", "常用功能容易发现和理解。", "scale"],
      ["功能体验", "完成典型任务的步骤合理。", "scale"],
      ["功能体验", "界面信息清楚易读。", "scale"],
      ["功能体验", "移动端能够满足我的使用需要。", "scale"],
      ["可靠性", "工具的响应速度满足工作需要。", "scale"],
      ["可靠性", "工具稳定，很少发生影响工作的故障。", "scale"],
      ["可靠性", "信息保存和同步可靠。", "scale"],
      ["使用支持", "遇到问题时，能够获得有效支持。", "scale"],
      ["使用支持", "帮助资料容易找到和理解。", "scale"],
      ["整体评价", "整体满意度评分", "rating"],
      ["整体评价", "向同事推荐该工具的可能性", "nps"],
      [
        "改进优先级",
        "您最常遇到的问题有哪些？",
        "multi",
        [
          "操作复杂",
          "速度慢",
          "功能缺失",
          "同步问题",
          "移动端不便",
          "未遇到明显问题",
        ],
      ],
      [
        "改进优先级",
        "请按优先级排序改善方向。",
        "ranking",
        ["性能稳定", "操作便捷", "功能完整", "系统集成"],
      ],
      ["改进优先级", "请描述一个具体问题及您期望的结果。", "open"],
    ],
  },
  {
    id: "meeting-feedback",
    title: "会议反馈调查",
    description:
      "会后快速收集目标、内容、参与和行动项反馈，适合持续改进例会或工作坊。",
    items: [
      ["会议信息", "会议名称", "short"],
      ["会议信息", "会议日期", "date"],
      ["会议体验", "会议目标和议程清晰。", "scale"],
      ["会议体验", "会议内容与我的工作相关。", "scale"],
      ["会议体验", "参会者有足够机会表达意见。", "scale"],
      [
        "会议体验",
        "会议时长是否合适？",
        "single",
        ["过短", "合适", "稍长", "明显过长"],
      ],
      ["行动跟进", "会后行动项、负责人和时间明确。", "scale"],
      ["改进建议", "下次会议最值得改进的地方是什么？", "open"],
    ],
  },
  {
    id: "knowledge-governance",
    title: "组织知识治理评估",
    description:
      "评估知识获取、沉淀、复用、质量与治理责任，形成基于成员体验的知识管理改进依据。",
    items: [
      [
        "组织背景",
        "您主要所属的职能领域",
        "dropdown",
        ["研发", "产品", "销售", "运营", "交付", "人力与行政", "其他"],
      ],
      [
        "组织背景",
        "您在本组织工作的时间",
        "single",
        ["不足6个月", "6–12个月", "1–3年", "3年以上"],
      ],
      [
        "组织背景",
        "您需要查找组织知识的频率",
        "single",
        ["每天", "每周", "每月", "很少"],
      ],
      ["知识获取", "我知道到哪里查找工作所需知识。", "scale"],
      ["知识获取", "搜索结果通常能满足需要。", "scale"],
      ["知识获取", "知识目录和标签易于理解。", "scale"],
      ["知识获取", "新人能够快速找到入门材料。", "scale"],
      ["知识沉淀", "重要项目的经验会被及时记录。", "scale"],
      ["知识沉淀", "团队有明确的知识记录规范。", "scale"],
      ["知识沉淀", "知识贡献的操作成本合理。", "scale"],
      ["知识沉淀", "员工有持续贡献知识的动力。", "scale"],
      ["知识质量", "关键知识有明确维护责任人。", "scale"],
      ["知识质量", "过期知识能够及时更新或下架。", "scale"],
      ["知识质量", "知识内容具有足够的准确性。", "scale"],
      ["知识质量", "知识来源及适用条件清楚。", "scale"],
      ["知识复用", "已有知识能够减少重复工作。", "scale"],
      ["知识复用", "跨部门能够共享必要经验。", "scale"],
      ["知识复用", "常见问题已有可复用解决方法。", "scale"],
      ["治理保障", "知识访问权限与工作需要匹配。", "scale"],
      ["治理保障", "敏感知识有明确的使用边界。", "scale"],
      ["治理保障", "组织持续跟踪知识使用效果。", "scale"],
      [
        "改进方向",
        "最需要改善的环节有哪些？",
        "multi",
        [
          "获取检索",
          "记录沉淀",
          "质量维护",
          "跨部门复用",
          "责任机制",
          "权限管理",
        ],
      ],
      [
        "改进方向",
        "请按优先级排列改进方向。",
        "ranking",
        ["统一入口", "整理目录", "更新内容", "明确责任"],
      ],
      ["改进方向", "请提供一个知识查找或复用的实际案例。", "open"],
    ],
  },
];
export function scenarioTemplate(
  scenario: (typeof SURVEY_SCENARIOS)[number],
  kind: SurveyTemplateInput["kind"],
): SurveyTemplateInput {
  const questions = scenario.items.map(([chapter, title, type, options], i) => {
    const q = createSurveyQuestion(type, `${scenario.id}-q${i + 1}`, i + 1);
    q.title = title;
    q.chapterId = chapter;
    if (options) {
      q.options = options;
      q.config = {
        ...q.config,
        optionIds: options.map((_, index) => `o${index + 1}`),
      };
    }
    if (type === "scale")
      q.config = { ...q.config, lowLabel: "非常不同意", highLabel: "非常同意" };
    if (type === "open") q.required = false;
    if (i === 0) q.config = { ...q.config, description: scenario.description };
    return q;
  });
  const chapters = [...new Set(questions.map((q) => q.chapterId))];
  return {
    kind,
    title: scenario.title + (kind === "report" ? "模板" : ""),
    description: scenario.description,
    questions,
    template: {
      id: `${scenario.id}-report`,
      title: `${scenario.title}分析报告`,
      sections: chapters.map((chapter, i) => ({
        id: `${scenario.id}-section-${i + 1}`,
        title: chapter,
        blocks: questions
          .filter((q) => q.chapterId === chapter)
          .map((q) => {
            const supported = surveyQuestionStatistics(q);
            const statistic =
              q.type === "nps"
                ? "nps"
                : q.type === "ranking"
                  ? "mean_rank"
                  : supported.includes("mean")
                    ? "mean"
                    : supported.includes("distribution")
                      ? "distribution"
                      : supported.includes("responses")
                        ? "responses"
                        : "count";
            return {
              id: `${q.id}-result`,
              title: q.title,
              type:
                statistic === "mean"
                  ? "metric"
                  : statistic === "distribution"
                    ? "bar"
                    : "table",
              questionIds: [q.id],
              statistic,
              samplePolicy: "valid",
              minGroupSize: 5,
            } as SurveyReportBlock;
          }),
      })),
    },
  };
}
