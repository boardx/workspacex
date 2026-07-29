/**
 * 进场类页面的 mock 数据（登录 / 链接落地 / 受访者同意书 / 小组工作台）
 *
 * ⚠ 纯数据模块，**不带 `"use client"`**——同时被服务端页面与客户端子组件 import。
 *    密度参照 `ui-preview/PROTOTYPE-DIGEST.md` 第一节与第九节实测，不是三行假数据。
 *    这里没有任何真实手机号/邮箱，手机号一律以掩码形态存在（D-01：不完整展示）。
 */

/**
 * 材料保留期的展示文案 —— **不写死数字**（D-14 / 一致性复核 N-4）
 *
 * D-14 定了留存期是**五个可配置参数**且「同意书文案必须按项目动态渲染」。
 * 写死一个数的后果不是「文案不准」，是：**只要有项目配了不同的保留期，
 * 同意书就会向受访者作出与实际不符的承诺**——那是合规风险。
 *
 * 数值仍待合规给出（`@repo/contracts/thresholds` 的 `retentionMaterial`）。
 * 在那之前**显式说明它按项目而定**，而不是填一个「看起来合理」的 180。
 */
export const RETENTION_MATERIAL_LABEL = "按本项目配置的保留期（合规尚未给出默认值）";


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
      desc: `只在这场访谈中录，存于远洋的服务器，${RETENTION_MATERIAL_LABEL}到期后自动删除。`,
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

/**
 * ⚠ 撤回链已收敛为单一事实源 `lib/withdrawal-flow.ts`（2026-07-28）。
 * 此前本文件、`lib/mock/files.ts`、`components/interview/interview-stage.tsx` 各有一份，
 * 且已漂移（第 03 步一处「≤5 分钟」一处「即时」）。
 * **撤回链是对受访者的合规承诺**——三个屏说三个时限就是三份互相矛盾的对外声明。
 * 此处只做再导出，不得在这里维护第二份。
 */
export { WITHDRAWAL_FLOW, WITHDRAWAL_SLA_SUMMARY, EXTERNAL_REPLACEMENT_NOTE, type WithdrawalStep } from "@/lib/withdrawal-flow";

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

/* ── 受访者会话屏（裁决 D-U10 / UC-6.3 一次性令牌身份）──────────────── */

/**
 * 「被记录的人，自己也要有一块屏」——同意书承诺「事后你随时可以用这条链接回来改选择、
 * 要一份文字稿、或要求删除全部记录」，那条链接就落在这一屏。
 *
 * ⚠ 受访者**不是项目角色**（裁决 D-U3）：走 UC-6.3 的一次性令牌身份，链接形如
 *   `/session?t=<token>`。令牌失效走 StateShell 的 denied 态，不暴露资源是否存在。
 *
 * ⚠ 授权回显与撤回链**都复用同意书的单一事实源**：grants 由 `CONSENT.items` 派生，
 *   撤回五步直接用 `WITHDRAWAL_FLOW`（含 D-U2 改过的 SLA，不在此另写一套）。
 */

/** 本场是否还在录音——同意书 D-U10 明确要求「录音中 / 本场已结束」两种都能看到 */
export type SessionScene = "recording" | "ended";

export const SESSION_SCENES: { id: SessionScene; label: string }[] = [
  { id: "recording", label: "录音中" },
  { id: "ended", label: "本场已结束" },
];

export function resolveSessionScene(raw: string | string[] | undefined): SessionScene {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return v === "ended" ? "ended" : "recording";
}

export interface SessionGrant {
  id: string;
  label: string;
  /** 当前是否授权（回显同意书里的选择，可在本屏「改」） */
  granted: boolean;
  /** 授权时的一句话说明 */
  onDesc: string;
  /** 撤销该项后的一句话说明（realname 关闭时说明改用代称） */
  offDesc: string;
}

const consentDefault = (id: string) =>
  CONSENT.items.find((i) => i.id === id)!.defaultChecked;

export const SESSION = {
  project: CONSENT.project,
  /** 掩码令牌：一次性令牌身份，界面只回显掩码（不完整展示，D-01 同理） */
  maskedToken: "sess-••••-7f3a",
  /** 录音已进行时长（演示值；「本场已结束」场景下不显示计时） */
  elapsed: "12:34",
  retentionDays: CONSENT.retentionDays,
  alias: CONSENT.alias,
  controller: CONSENT.controller,
  purpose:
    "这段录音只用于本项目的研究整理，存于远洋咨询的服务器；不做训练、不外发第三方。",
  endedNote:
    "本场访谈已结束，录音已停止。这条链接仍然有效——你随时可以回来改选择、要文字稿、或撤回全部记录。",
  /** grants 由同意书条款派生，保证「回显的就是当初勾的」 */
  grants: [
    {
      id: "record",
      label: "录音",
      granted: consentDefault("record"),
      onDesc: `本场访谈录音，${RETENTION_MATERIAL_LABEL}到期后自动删除。`,
      offDesc: "撤销录音等同撤回全部记录，请用下方「撤回全部记录」。",
    },
    {
      id: "transcript",
      label: "转文字稿",
      granted: consentDefault("transcript"),
      onDesc: "研究员可整理这场访谈的文字稿；你也可随时要一份属于自己的副本。",
      offDesc: "不再整理文字稿，已生成的部分进入待删除队列。",
    },
    {
      id: "realname",
      label: "实名引用",
      granted: consentDefault("realname"),
      onDesc: "报告里可以出现你的真实姓名与职务。",
      offDesc: `报告里一律写成「${CONSENT.alias}」，不出现你的名字。`,
    },
  ] satisfies SessionGrant[],
  /** 文字稿副本的送达方式（演示文案，非承诺时限） */
  transcriptDelivery: "整理完成后发到你登记的联系方式，附一份纯文本副本。",
} as const;
