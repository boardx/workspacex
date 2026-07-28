/**
 * 进场类页面的 mock 数据（登录 / 链接落地 / 受访者同意书 / 小组工作台）
 *
 * ⚠ 纯数据模块，**不带 `"use client"`**——同时被服务端页面与客户端子组件 import。
 *    密度参照 `ui-preview/PROTOTYPE-DIGEST.md` 第一节与第九节实测，不是三行假数据。
 *    这里没有任何真实手机号/邮箱，手机号一律以掩码形态存在（D-01：不完整展示）。
 */

/* ── 登录页（UC-1.1 R8）───────────────────────────────────────────── */

export interface AuthProvider {
  id: string;
  label: string;
}

/** D-02：phase-1 只做邮箱 + 密码；三个第三方保留视觉位但 disabled 标 later */
export const AUTH_PROVIDERS_LATER: AuthProvider[] = [
  { id: "google", label: "Google" },
  { id: "feishu", label: "飞书" },
  { id: "sso", label: "SSO" },
];

export interface BrandActivity {
  initials: string;
  name: string;
  line: string;
  kind: "ai" | "human";
}

/** 右侧氛围区的 AI 团队动态流（原型实测三条） */
export const LOGIN_BRAND = {
  liveStat: "全球 1,284 个战略问题",
  quote: "把顾问的判断力和 AI 的耐力放在同一张桌子上。",
  activities: [
    { initials: "AV", name: "Ava · 战略分析师", line: "完成 3 条路径的假设拆解", kind: "ai" },
    { initials: "SC", name: "Scout · 同行情报", line: "核查 14 份监管文件，全部带引用", kind: "ai" },
    { initials: "LG", name: "Ledger · 收益测算", line: "正在建 5 年现金流模型", kind: "ai" },
  ] satisfies BrandActivity[],
  /** 示例邮箱仅用作 placeholder，非真实账号 */
  sampleEmail: "linke@yuanyang-consulting.cn",
};

/** O-28 链接有效期统一表里与登录相关的两条（用于文案，不写死在组件里） */
export const AUTH_POLICY = {
  sessionDays: 30,
  passwordMinLen: 12,
  resetLinkHours: 1,
  lockAfterFails: 5,
  lockWindowMinutes: 15,
  lockDurationMinutes: 15,
};

/* ── 链接落地页 / 小组工作台（UC-1.2 R8）─────────────────────────── */

export interface JoinContext {
  project: string;
  groupNo: number;
  groupName: string;
  topic: string;
  groupLead: string;
  teammates: string[];
  /** 落地页仅回显掩码（D-01：手机号不完整展示） */
  maskedPhone: string;
}

export const JOIN_CONTEXT: JoinContext = {
  project: "欧洲进入策略 KICKOFF",
  groupNo: 2,
  groupName: "采购比选",
  topic: "采购委员会为什么不敢签？",
  groupLead: "高琳",
  teammates: ["陈默"],
  maskedPhone: "138 •••• 2049",
};

/** 四步进场路径（落地页顶部的进度示意） */
export const JOIN_STEPS = ["打开链接", "确认身份", "领到身份与组", "落进小组工作台"];

/** D-01 三种意外——落地页要能逐个演示 */
export type JoinScene = "default" | "wrong-group" | "not-listed" | "reconnect";

export const JOIN_SCENES: { id: JoinScene; label: string }[] = [
  { id: "default", label: "正常进场" },
  { id: "wrong-group", label: "打开了别组的链接" },
  { id: "not-listed", label: "不在名单里" },
  { id: "reconnect", label: "掉线 / 换设备" },
];

/* 小组工作台 */

export interface Sticky {
  id: string;
  text: string;
  author: string;
  /** true = 本人贴的，展示层高亮但不暴露真实身份 */
  mine?: boolean;
}

export const GROUP_WORKBENCH = {
  broadcast: {
    segment: "环节 3/7",
    title: "假设风暴 → 填你们组的旅程图",
    timer: "12:48",
  },
  canvas: { template: "POV 模板", materials: 4 },
  members: [
    { initials: "高", name: "高琳", role: "组长" },
    { initials: "陈", name: "陈默", role: "组员" },
    { initials: "B", name: "参与者 B（你）", role: "组员" },
  ],
  stickies: [
    { id: "s1", text: "怕签完没人负责", author: "陈默" },
    { id: "s2", text: "要本地案例，德国业主认落地", author: "参与者 B", mine: true },
    { id: "s3", text: "灯塔项目免费改造换背书", author: "高琳" },
    { id: "s4", text: "质保条款看不懂，法务要重读", author: "陈默" },
    { id: "s5", text: "预算审批要走三级，怕拖过窗口期", author: "参与者 B", mine: true },
    { id: "s6", text: "去年那家供应商违约过一次", author: "高琳" },
    { id: "s7", text: "数据出境卡在合规，方案 B 更稳", author: "陈默" },
  ] satisfies Sticky[],
  fcSuggestion:
    "你们组还没写「机会」那一行，剩 12 分钟。要我把刚才口头说的三点转成便签吗？",
};

/* ── 受访者同意书（UC-1.2 D-13 / 档案第九节 A）─────────────────── */

export interface ConsentItem {
  id: string;
  label: string;
  desc: string;
  defaultChecked: boolean;
}

export const CONSENT = {
  project: "欧洲进入策略 · 采购总监深访",
  /** 未勾选实名引用时使用的代称（档案示例：你已拒绝实名） */
  alias: "某物流园区运营总监",
  retentionDays: 180,
  items: [
    {
      id: "record",
      label: "录音",
      desc: "只在这场访谈中录，存于远洋的服务器，180 天后自动删除。",
      defaultChecked: true,
    },
    {
      id: "transcript",
      label: "转文字稿",
      desc: "用于研究员整理；你可以随时要一份属于自己的副本。",
      defaultChecked: true,
    },
    {
      id: "realname",
      label: "实名引用",
      desc: "未勾选时，报告里一律写成「某物流园区运营总监」，不出现你的名字。",
      defaultChecked: false,
    },
  ] satisfies ConsentItem[],
  controller: {
    org: "远洋咨询",
    contact: "林可",
    email: "compliance@yuanyang-consulting.cn",
  },
} as const;

/** D-13：撤回是一条真实的数据流，五步全部要画出来 */
export interface WithdrawalStep {
  no: string;
  step: string;
  sla: string;
  /** 需要人工介入的步（03/04）在界面上要显著区分 */
  emphasis?: "evidence" | "human";
}

export const WITHDRAWAL_FLOW: WithdrawalStep[] = [
  { no: "01", step: "文字稿与音频进入待删除队列", sla: "即时" },
  { no: "02", step: "来自该场的 7 条引述退出检索，主题矩阵重算强度", sla: "≤5 分钟" },
  {
    no: "03",
    step: "引用过它的研究报告段落标为「证据已撤回」，不静默删除",
    sla: "即时",
    emphasis: "evidence",
  },
  {
    no: "04",
    step: "若已支撑过已签字决策，通知拍板人复核，而不是自动改结论",
    sla: "需人工",
    emphasis: "human",
  },
  { no: "05", step: "物理删除并回执给受访者", sla: "≤30 天" },
];

/* ── 预览视角（小组工作台的两个项目角色）─────────────────────── */

export type GroupViewRole = "member" | "groupLead";

export const GROUP_VIEW_ROLES: { id: GroupViewRole; label: string }[] = [
  { id: "member", label: "组员视角" },
  { id: "groupLead", label: "组长视角" },
];

export function resolveGroupRole(raw: string | string[] | undefined): GroupViewRole {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return v === "groupLead" ? "groupLead" : "member";
}

export function resolveJoinScene(raw: string | string[] | undefined): JoinScene {
  const v = Array.isArray(raw) ? raw[0] : raw;
  const ok = JOIN_SCENES.some((s) => s.id === v);
  return ok ? (v as JoinScene) : "default";
}
