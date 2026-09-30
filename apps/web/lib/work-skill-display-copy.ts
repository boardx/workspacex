/**
 * 平台内置 Work Skill —— 面向用户的中文显示名。
 *
 * 平台 starter pack 里的技能 `name` 就是稳定编号（`S061`），是技术标识，不上屏。
 * 中文名取自 `requirements/work-stack-v2/skills/S*.md` 标题括号内的名字；目录新增而这里
 * 没写时（由 `tests/lib/display-copy-single-source.test.ts` 机械核对与 S*.md 标题逐条相等，漂移即红） `workSkillDisplayName` 返回 null，调用方应隐藏该项而不是打印编号。
 */

export const WORK_SKILL_NAMES: Readonly<Record<string, string>> = {
  S003: "企业内部检索",
  S005: "会前准备",
  S006: "会议纪要",
  S007: "状态更新",
  S008: "竞争分析",
  S009: "客户研究",
  S010: "风险评估",
  S011: "根因分析",
  S012: "决策简报",
  S013: "情景分析",
  S014: "文档评审",
  S015: "回复起草",
  S016: "知识捕获",
  S017: "任务抽取",
  S018: "现状流程测绘",
  S019: "标准作业程序编写",
  S020: "高管简报成文",
  S021: "客户情报",
  S022: "客户分层",
  S023: "账户计划",
  S024: "拓客名单构建",
  S025: "线索分诊",
  S026: "外联触达序列起草",
  S027: "约会排期",
  S028: "销售通话纪要",
  S029: "商机字段更新",
  S030: "管道评审",
  S031: "销售预测",
  S032: "成交计划",
  S033: "续约雷达",
  S034: "CRM 数据卫生审计",
  S035: "客户健康度",
  S036: "商务方案 / 建议书构建",
  S061: "产品探索",
  S062: "用户访谈规划",
  S063: "研究综合",
  S064: "问题框定",
  S065: "机会地图",
  S066: "产品头脑风暴",
  S067: "PRD / 需求规格撰写",
  S068: "优先级排序",
  S069: "路线图规划",
  S070: "冲刺计划",
  S071: "实验设计",
  S072: "指标复盘",
  S073: "产品发布就绪与分级",
  S074: "用户激活",
  S075: "设计评审意见",
  S076: "设计交付给开发",
  S142: "工作项管理",
  S155: "经营复盘",
  S157: "数据探索",
  S158: "数据校验",
  S160: "SQL 查询",
  S161: "统计分析",
  S162: "KPI 体系设计",
  S164: "数据可视化",
  S167: "市场规模测算",
  S168: "趋势分析",
  S169: "知识综合 / 跨来源知识结构化",
  S170: "科学研究规划",
  S171: "证据评审",
  S172: "数据叙事",
  S195: "战略复盘",
  S196: "董事会会议准备",
  S197: "决策记账",
  S198: "OKR 对齐",
  S199: "商业模式分析",
};

const STABLE_ID = /^S\d{3}$/;

/** 名字看起来是技能稳定编号（如 `S061`）。 */
export function isWorkSkillStableId(name: string): boolean {
  return STABLE_ID.test(name.trim());
}

/** 技能显示名：普通名字原样返回；稳定编号换成中文名，查不到返回 null。 */
export function workSkillDisplayName(name: string): string | null {
  const n = name.trim();
  if (!isWorkSkillStableId(n)) return n;
  return WORK_SKILL_NAMES[n.toUpperCase()] ?? null;
}
