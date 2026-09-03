/**
 * 「我的今天」mock 数据 —— UC-11.5（四语义分区）+ UC-11.6（权限包/授权流入口）。
 *
 * ⚠ 这是**界面投影用的假数据**，密度照 PROTOTYPE-DIGEST §七 与 UC-11.5 R3 原型实例做。
 *   真实的分区归属计算、状态机、权限判定都在服务端（见 UC-11.5 R9 / UC-11.6 R7）。
 *   本文件不含任何函数、图标或 React 元素，纯可序列化数据，服务端/客户端都可 import。
 */
import type { z } from "zod";
import { board as BoardC } from "@repo/contracts";

/** 风险分级 —— 单一事实源在 packages/contracts/src/board.ts（F02，共享内核只有三级）。 */
export type RiskLevel = z.infer<typeof BoardC.RiskLevel>;

/** 执行模式：人工 / AI / 人机协作 —— 「人和 AI 共用同一种任务对象」的字段级体现 */
export type ExecMode = "human" | "ai" | "collab";

export const EXEC_MODE_LABEL: Record<ExecMode, string> = {
  human: "人工",
  ai: "AI",
  collab: "人机协作",
};

/** ① 等我判断 —— 三类阻塞点：需批准(R3) / 待验收(R2) / 授权(R1) */
export interface JudgmentCard {
  id: string;
  risk: RiskLevel;
  /** 状态词：需批准 / 待验收 / 授权 */
  statusWord: string;
  /** 谁停在这里 + 等了多久（R3/R2 原型逐字：Ledger 已暂停 · 等待 4 分钟）。
   *  R1（授权）原型里这一行只有上下文描述、没有等待时长——留空。 */
  waitedBy: string;
  waitedFor?: string;
  due?: string;
  title: string;
  /** 决策问句 / 验收说明 / 授权问句 —— 留空则只显示标题（R1 原型只有一行加粗文案）。 */
  question?: string;
  /** 一条附注（仅在原型确有对应文案时使用，不用于渲染重复文案）。 */
  note?: string;
  project: string;
  actions: string[];
}

/** ② 今天该我推进 */
export interface PushCard {
  id: string;
  title: string;
  mode: ExecMode;
  /** 完成标准进度，如 [1,3] = 1/3 */
  criteria: [number, number];
  due: string;
  overdue?: boolean;
  /** 来自进行中现场环节的卡置顶 */
  live?: boolean;
  hint?: string;
  project: string;
}

/** ③ AI 正在替我跑 —— executor 是 agent，owner 恒为我本人 */
export interface RunningCard {
  id: string;
  agentInitials: string;
  agentName: string;
  title: string;
  /** 当前步骤摘要，如「敏感性 2/3」「已读 41 份」——只给一行，细节下钻详情页 */
  step: string;
  progress: number; // 0..100
  /** owner 恒为人（D-39）——界面必须同时显示「谁在跑」与「我负责」 */
  ownerName: string;
  project: string;
}

/** ④ 下一步轮到别人 —— 必须显示在等谁（具体人名），不是「等待中」 */
export interface WaitingCard {
  id: string;
  waitingOn: string; // 具体人名
  waitingOnInitial: string;
  what: string;
  due: string;
  overdue?: boolean;
  priority?: "高" | "中" | "低";
  project: string;
}

export const JUDGMENT_CARDS: JudgmentCard[] = [
  {
    // 原型字节 15928565 起，加粗标题就是这句决策问句本身——不是单独一条「问句」贴在标题下面。
    // 「AI 停在这里，不会绕过你继续」是本区（等我判断）的**分区级**提示（见 today-board.tsx 的
    // Section hint），不在单张卡片里重复。
    id: "jc-approve-path-b",
    risk: "R3",
    statusWord: "需批准",
    waitedBy: "Ledger 已暂停",
    waitedFor: "等待 4 分钟",
    due: "今天 18:00",
    title: "路径 B 是否承诺「收益保底」？这会改变整张商业模式画布的成本结构",
    project: "远洋新能源 · 欧洲市场进入",
    actions: ["提供判断", "看依据"],
  },
  {
    // 原型字节 15930015 起是同一句话，用「；」连接，两半同样是普通说明文字，
    // 不是警示——之前拆成 question + 带 ShieldCheck 图标的 warning 提示是编的强调。
    id: "jc-review-tariff",
    risk: "R2",
    statusWord: "待验收",
    waitedBy: "Scout 已交付",
    waitedFor: "完成标准 3/3",
    due: "今天",
    title: "验收「德国工商储电价机制核查报告」",
    question: "14 条结论，3 条低置信度已标出；验收后才会成为可引用证据",
    project: "远洋新能源 · 欧洲市场进入",
    actions: ["验收", "要求补证据", "看依据"],
  },
  {
    // 原型里 R1 卡只有两行：小字上下文（本字段 waitedBy）+ 加粗问句（title）。
    // 没有等待时长、没有到期时间——之前编的「等待 12 分钟」「今天」在原型里找不到依据，已去掉。
    id: "jc-authz-crm",
    risk: "R1",
    statusWord: "授权",
    waitedBy: "Echo 请求读取「客户 CRM」以核对联系人",
    title: "是否把 CRM 读取权限加入这次任务的权限包？",
    project: "远洋新能源 · 客户尽调",
    actions: ["去授权", "看依据"],
  },
];

export const PUSH_CARDS: PushCard[] = [
  {
    id: "pc-group4-delay",
    title: "决定是否给第 4 组延时 5 分钟",
    mode: "human",
    criteria: [0, 1],
    due: "现在",
    live: true,
    hint: "来自 Kickoff 项目 · 环节 3 现场进行中",
    project: "远洋新能源 · Kickoff",
  },
  {
    id: "pc-epc-visits",
    title: "约访 2 家本地 EPC 负责人",
    mode: "human",
    criteria: [1, 3],
    due: "8/04",
    overdue: true,
    project: "远洋新能源 · 欧洲市场进入",
  },
  {
    id: "pc-board-onepager",
    title: "准备客户董事会汇报的一页纸摘要",
    mode: "collab",
    criteria: [2, 4],
    due: "7/29",
    hint: "Ava 已备好初稿，等你定结论顺序",
    project: "远洋新能源 · 交付",
  },
];

export const RUNNING_CARDS: RunningCard[] = [
  {
    id: "rc-cashflow",
    agentInitials: "LG",
    agentName: "Ledger",
    title: "三路径现金流对比",
    step: "敏感性 2/3",
    progress: 66,
    ownerName: "林可",
    project: "远洋新能源 · 欧洲市场进入",
  },
  {
    id: "rc-transferability",
    agentInitials: "SC",
    agentName: "Scout",
    title: "资质可转让性尽调",
    step: "已读 41 份",
    progress: 48,
    ownerName: "林可",
    project: "远洋新能源 · 客户尽调",
  },
];

export const WAITING_CARDS: WaitingCard[] = [
  {
    id: "wc-signoff-dd",
    waitingOn: "周宁",
    waitingOnInitial: "周",
    what: "签字确认资质尽调的结论",
    due: "逾期 1 天",
    overdue: true,
    priority: "高",
    project: "远洋新能源 · 客户尽调",
  },
  {
    id: "wc-group2-output",
    waitingOn: "高琳",
    waitingOnInitial: "高",
    what: "提交第 2 组产出",
    due: "今天",
    priority: "中",
    project: "远洋新能源 · Kickoff",
  },
  {
    id: "wc-localization",
    waitingOn: "陈明",
    waitingOnInitial: "陈",
    what: "补齐供应链本地化率数据",
    due: "8/02",
    priority: "低",
    project: "远洋新能源 · 欧洲市场进入",
  },
];

/** 左栏视图与计数（原型：收件箱 3 / 需要我处理 3 / AI 正在执行 5 / 已委派 4 / 项目看板 23 / 模板与自动化 7）*/
export const TASK_VIEWS: { key: string; label: string; count: number; primary?: boolean }[] = [
  { key: "my-today", label: "我的今天", count: 6, primary: true },
  { key: "inbox", label: "收件箱", count: 3 },
  { key: "need-me", label: "需要我处理", count: 3 },
  { key: "ai-running", label: "AI 正在执行", count: 5 },
  { key: "delegated", label: "已委派", count: 4 },
  { key: "board", label: "项目看板", count: 23 },
  { key: "templates", label: "模板与自动化", count: 7 },
];

/** 运行中心 · 3 个在跑 */
export const RUN_CENTER = [
  { id: "run-cashflow", initials: "LG", title: "三路径现金流对比", step: "敏感性 2/3" },
  { id: "run-transferability", initials: "SC", title: "资质可转让性尽调", step: "已读 41 份" },
  { id: "run-persona", initials: "EC", title: "访谈引述合并", step: "已合并 7 组" },
] as const;

/**
 * 底注当日汇总 —— 折算口径遵循 UC-11.5 R10 · O-37 的**三条原则**（这三条与数值无关，先定）：
 *   ① 折算系数/单价存为组织可配口径表，不硬编码；
 *   ② 展示时必须标注样本量与口径版本；
 *   ③ 样本不足时显示「样本不足」而非折算值。
 *
 * ⚠⚠ 三个具体数值 UC 与原型**均未给出**，O-37 原文明示「系数的具体数值无依据，需产品给出」：
 *   - **每项折算几人时（系数）** —— 未给。下方 aiDone/personHours 是**原型底注逐字**
 *     （「今日 AI 完成 11 项、折算 6.5 人时」），二者之间**不构成系数关系**，只是演示值。
 *   - **最小样本量阈值** —— 未给。本文件**不编造阈值**，组件层也**不实现数值门控**；
 *     只演示「样本充足 → 显示折算值」与「样本不足 → 显示『样本不足』」两条路径的形态。
 *   - **口径表版本号 / 样本量 N** —— 未给。故不写死具体数字，标为「产品待定」。
 *   曾经写过的「基于本周 18 项 · 口径表 v3」是占位编造，已移除，避免制造「已过线」的假象。
 */
export const TODAY_SUMMARY = {
  aiDone: 11, // [原型底注] 逐字
  personHours: 6.5, // [原型底注] 逐字，非按系数计算
  waitingAuthz: 2, // [原型底注] 逐字
  ledgerVersionKnown: false, // 口径表版本号原型/UC 未给
  minSampleKnown: false, // 最小样本量阈值 UC 明示需产品给出
  coefficientKnown: false, // 折算系数 UC 明示需产品给出
  responsibilityNote: "责任人始终是人——AI 只拿到行动权，不承担验收。",
};

/** O-37 ③「样本不足」闸门的演示实例 —— 阈值数值产品待定，此处只示形态 */
export const TODAY_SUMMARY_LOW_SAMPLE = {
  aiDone: 2,
  label: "样本不足，暂不折算人时",
};
