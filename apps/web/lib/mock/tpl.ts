/**
 * `tpl`（蓝本 / 项目模板）能力域 —— UI 先行原型的 **mock 单源**。
 *
 * ⚠ 纯 mock、零后端。数量级与字段完整度贴近真实，让 sign-off 能看出信息密度问题。
 *
 * ── 契约来源说明（ADR-020 单一事实源）──────────────────────────────────
 * 本域的领域模型权威是 `phases/phase-01-run-a-project/contracts/templates/domain.md`，
 * 但它**尚未落成 `packages/contracts/src/templates.ts`**（另有 agent 在建 contracts/）。
 * 因此本文件里的 tpl 专属枚举/类型是**临时集中的第二份**，全部标注
 * `TODO(contract): 待迁入 packages/contracts/templates`——契约落地后本文件 import 它，删掉本地副本。
 * 凡 phase-00 已签核的类型（ProjectRole 等）一律从 `@repo/contracts` 派生，不在此另写。
 *
 * 术语三分（裁决 D-03，不得混用「环节」）：
 *   · 设计配置项 ConfigItem（config_item_*）——分母由本表驱动，禁止硬编码 16/15
 *   · 议程环节 AgendaSegment（agenda_segment_id）——随时长档位变：半天7/一天11/两天14/三天19
 *   · 方法环节——固定 9 个，属 09-kg，与本域无关
 */

import type { ProjectRole } from "@/lib/identity";
import { PROJECT_ROLE_LABEL } from "@/lib/identity";

/* ════════════════════════════════════════════════════════════════════════
 * TODO(contract): 待迁入 packages/contracts/templates —— 以下为 tpl 专属临时副本
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * 时长档位（templates/domain.md I-20：内建四档封闭，自定义档位另立 custom）
 *
 * ⚠ 与契约 `templates.DurationTier` **同名、取值不一致**（契约五值，多 `custom`）
 * ⇒ 已改名分离，见 `CONTRACT_DIVERGENCES.D15`。
 * 下面三张按档位索引的表（环节数 7/11/14/19、半场数、档位文案）在 `custom` 下
 * **根本没有值可填**——这正是契约拒绝它（`CUSTOM_TIER_RULE_UNDEFINED`，D-7
 * 「宁可拒绝也不猜一个推导式」）的理由。所以四档不是遗漏，是被动躲开了。
 */
export type DurationTierView = "half-day" | "one-day" | "two-day" | "three-day";
export const DURATION_TIERS: DurationTierView[] = ["half-day", "one-day", "two-day", "three-day"];
export const TIER_LABEL: Record<DurationTierView, string> = {
  "half-day": "半天", "one-day": "一天", "two-day": "两天", "three-day": "三天",
};
/** 议程环节数 = 档位的函数（templates/domain.md I-15；uc-2-1 AC4a：7/11/14/19）*/
export const AGENDA_COUNT_BY_TIER: Record<DurationTierView, number> = {
  "half-day": 7, "one-day": 11, "two-day": 14, "three-day": 19,
};
export const TIER_HALF_SESSIONS: Record<DurationTierView, string> = {
  "half-day": "1 个半场", "one-day": "2 个半场", "two-day": "4 个半场", "three-day": "6 个半场",
};
export const DEFAULT_TIER: DurationTierView = "two-day"; // 原型默认「两天」

/**
 * 目录分组（templates/domain.md I-20 / ConfigItemDefinition.group）。
 *
 * ⚠ 2026-07-30 保真度重做（PROTOTYPE-FIDELITY-AUDIT-2「重做」判定）：
 *   原型左栏标题是「设计环节 16 / 16」，其下 **16 个面板** 顺次排列，中间夹 4 个分组小标题
 *   （会前输入 / 现场 / AI 能力 / 产出）。**第一段没有小标题**——首 5 个面板直接列在标题下。
 *   v1 把「基本配置」误当成第一个分组的小标题，于是 16 项数成 15，污染了 I-5 的分母。
 *   真相：**「基本配置」是第 1 个面板（总览面板），不是分组标题**（原型 flag `isBpBasic`，偏移 16529477）。
 *   所以本表 `basic` 分组 `divider:false`——渲染时首段不画小标题，与原型一致。
 */
export type ConfigGroup = "basic" | "pre-input" | "onsite" | "ai" | "output";
export const CONFIG_GROUPS: { key: ConfigGroup; label: string; divider: boolean }[] = [
  { key: "basic", label: "基本", divider: false }, // 原型首段无小标题
  { key: "pre-input", label: "会前输入", divider: true },
  { key: "onsite", label: "现场", divider: true },
  { key: "ai", label: "AI 能力", divider: true },
  { key: "output", label: "产出", divider: true },
];

export interface ConfigItem {
  /** 稳定 key（config_item_*）—— versions-screen 等按 key 反查 label，勿改已有 key */
  key: string;
  group: ConfigGroup;
  label: string;
  /** 发布门槛的唯一驱动（I-6）。⚠ 具体哪几项 required=true 仍待人类给出（缺 D-2） */
  required: boolean;
  /** 该项内容规模的示例计数/摘要（不是议程环节数）；总览面板与场地面板原型无角标 → 空串 */
  count: string;
  /** 是否已配完 —— 完成度派生的来源，不硬编码 */
  done: boolean;
}

/**
 * 配置项定义表 —— **本域最重要的一张表**（O-07 + O-18⑤ 收敛点）。
 * 完成度分母 = 本表条目数（禁止硬编码 16/15）；required 列驱动 D-2 未定的那道门槛。
 *
 * **16 项**，顺序与原型 flag 一致：isBpBasic → isBpTopic → isBpAgenda → isBpGroups → isBpRoles →
 * isBpSurvey → isBpItv → isBpHw → isBpVenue → isBpMat → isBpPrint → isBpCaps → isBpAgent →
 * isBpSkill → isBpOut → isBpRep（偏移 16529477–16627026，跨 114KB 全是成品）。
 * 默认蓝本 HMW 为已发布态，原型目录自报「16 / 16」→ 本表 16 项全 done=true。
 *
 * ⚠ required 一栏此处只是**占位示例**——真正哪几项必填「清单本身无依据，仍需人类给出」（缺 D-2）。
 * sign-off 必须把这份清单当作**未定**来看；界面真正演示的发布门槛是「降级 Skill 未替换」（原型明写）。
 */
export const CONFIG_ITEMS: ConfigItem[] = [
  { key: "basic-overview", group: "basic", label: "基本配置", required: false, count: "", done: true },
  { key: "topic-and-background", group: "basic", label: "主题与背景", required: true, count: "2 字段", done: true },
  { key: "flow-agenda", group: "basic", label: "流程 Agenda", required: true, count: "7 环节", done: true },
  { key: "grouping-rule", group: "basic", label: "分组规则", required: true, count: "4 组", done: true },
  { key: "roles-and-perms", group: "basic", label: "角色与权限", required: true, count: "4 角色", done: true },
  { key: "survey", group: "pre-input", label: "问卷", required: false, count: "2 份", done: true },
  { key: "interview-and-subjects", group: "pre-input", label: "访谈与对象", required: false, count: "6 场", done: true },
  { key: "pre-tasks", group: "pre-input", label: "会前任务", required: false, count: "3 项", done: true },
  { key: "venue-and-format", group: "onsite", label: "场地与形式", required: true, count: "", done: true },
  { key: "project-materials", group: "onsite", label: "项目材料", required: false, count: "9 件", done: true },
  { key: "print-materials", group: "onsite", label: "分组打印素材", required: false, count: "4 件", done: true },
  { key: "group-capabilities", group: "onsite", label: "组内能力", required: false, count: "7 项", done: true },
  { key: "agent-orchestration", group: "ai", label: "Agent 编排", required: false, count: "4 个", done: true },
  { key: "skill-binding", group: "ai", label: "Skill 绑定", required: false, count: "11 个", done: true },
  { key: "outputs", group: "output", label: "输出物", required: false, count: "6 件", done: true },
  { key: "report-template", group: "output", label: "报告模板", required: false, count: "18 页", done: true },
];

/** 分母恒读表（templates/domain.md I-5）。⚠ 界面与断言都用这个函数，不写字面量。 */
export const configTotal = () => CONFIG_ITEMS.length;
export const configDoneCount = (items: ConfigItem[] = CONFIG_ITEMS) => items.filter((i) => i.done).length;
/** 发布门槛判定（I-6）：存在 required 且未完成的项 → 阻断。与「具体哪几项」无关。 */
export const blockingRequiredItems = (items: ConfigItem[] = CONFIG_ITEMS) =>
  items.filter((i) => i.required && !i.done);

/* ════════════════════════════════════════════════════════════════════════
 * 16 个配置面板的内容 —— 全部从原型逐字抽取（偏移见各常量注释）。
 * v1 把这 16 个面板判成「未探明」只渲染了 1 个（PROTOTYPE-FIDELITY-AUDIT-1 错误#1）；
 * 实为跨 114KB 的成品。此处按面板 flag 顺序落数据，界面 designer-panels.tsx 逐个渲染。
 * TODO(contract): 待迁入 packages/contracts/templates —— 以下均为 tpl 专属临时副本。
 * ════════════════════════════════════════════════════════════════════════ */

/** 面板 2 · 主题与背景（isBpTopic 16539281）*/
export const TOPIC_PANEL = {
  intro: "套用后，项目的「定题与分组」页会拿这两个字段开局：主题是一句可判定的问题，背景是这一场的约束与已知结论。蓝本定的是句式与要素，不是内容。",
  topicPattern: {
    label: "主题句式",
    template: "「以什么〔时间约束〕达成什么〔可验证的结果〕」",
    note: "AI 按这个句式从洞察里生成候选",
    rules: ["必须含时间约束", "必须可证伪", "≤ 30 字", "不写解决方案"],
  },
  backgroundFields: [
    { key: "why-now", label: "为什么现在", hint: "触发这场讨论的事件或截止日", source: "客户输入 / 会前访谈" },
    { key: "known", label: "已知结论", hint: "调研已经能确定的 2–3 条", source: "洞察库（自动带入）" },
    { key: "hard-constraint", label: "硬约束", hint: "预算、合规、时间、资质", source: "客户输入" },
    { key: "must-decide", label: "要拍板的事", hint: "这一场必须出的决定", source: "引导师填写" },
    { key: "out-of-scope", label: "不讨论的事", hint: "明确移出本场的议题", source: "引导师填写" },
  ],
  genRules: [
    "套用时 AI 先出草稿，引导师改完才算定题",
    "从 12 条洞察/访谈里生成 3 个候选主题，标注支持它的强洞察条数",
    "背景草稿必须逐句挂来源，未挂来源的句子标灰",
    "没定主题前，议程与分组页只读",
  ],
};

/** 面板 3 · 流程 Agenda（isBpAgenda 16545213）—— 环节可拖动、跨半场，AI 核对节奏 */
export interface AgendaSeg { no: string; title: string; min: number; boardSkill: string; optional: boolean; }
export const AGENDA_PANEL = {
  intro: "环节按半场编排，每半场自成一个闭环，有自己的产出与收口。每个环节要说清三件事：产出什么、三种角色各干什么、绑哪个画布与 Skill。没写产出物的环节不能保存——那是闲聊不是环节。",
  dragHint: "抓左侧握把拖动：环节可跨半场，半场可整块换位",
  // 半天档 7 环节（默认 HMW）
  segments: [
    { no: "01", title: "对齐目标", min: 25, boardSkill: "—", optional: false },
    { no: "02", title: "现状共识", min: 25, boardSkill: "Scout 简报", optional: false },
    { no: "03", title: "假设风暴 · HMW", min: 60, boardSkill: "画布 hmw ＋ 语音转便签", optional: false },
    { no: "04", title: "分组共创", min: 60, boardSkill: "画布 business-model", optional: true },
    { no: "05", title: "收敛投票", min: 25, boardSkill: "收敛投票", optional: false },
    { no: "06", title: "拍板点", min: 20, boardSkill: "决策台账", optional: false },
    { no: "07", title: "行动项", min: 15, boardSkill: "纪要与行动项", optional: true },
  ] as AgendaSeg[],
  aiRhythm: {
    tag: "AI 已核对过节奏",
    body: "对照 12 场两天档记录：第 2 天上午的「原型搭建」平均超时 22 分钟，是全场最大缺口；而「组间互评」若少于 20m，昨天的决策会被重新争论一遍。建议 10 加到 90m，把 11 压到 30m。",
  },
  actions: ["上移半场", "下移半场", "上移环节", "下移环节", "插入环节", "还原顺序", "按新顺序重算时间"],
};

/** 面板 4 · 分组规则（isBpGroups 16556882）—— 场景清单是最值钱的部分 */
export const GROUPING_PANEL = {
  intro: "套用后自动生成分组卡片：几组、每组多少人、每组认领哪个场景、组长怎么选。场景清单是这里最值钱的部分——它决定四个组不会讨论同一件事。",
  sizingRules: [
    { range: "12–16 人", groups: "4 组 · 默认", per: "每组 3 人" },
    { range: "≤ 11 人", groups: "3 组", per: "每组 2–4 人" },
    { range: "≥ 18 人", groups: "6 组", per: "加一名协同引导师" },
  ],
  sizingNote: "低于 2 人合并；每组一路录音；缺人现场可调",
  scenarios: [
    { name: "业主首次评估", ask: "第一次看储能投资时卡在哪", leadProfile: "懂收益测算的人" },
    { name: "采购比选", ask: "进入比选后凭什么被选中", leadProfile: "销售或采购背景" },
    { name: "并网审批", ask: "审批与施工协调的真实时长", leadProfile: "懂当地流程的人" },
    { name: "运营期归因", ask: "收益不达标时谁负责", leadProfile: "服务或运维背景" },
  ],
  assignRules: [
    "套用时 AI 先给一版，引导师拖拽调整",
    "组长默认取该场景画像匹配度最高的人，可一键换",
    "按背景均衡：同部门的人尽量不在同一组",
    "每组带一张观察/访谈对象表（对象、部门、联系方式、背景、方式）",
    "缺人时在分组卡片上标红，并给出需要什么背景的人",
  ],
};

/** 面板 5 · 角色与权限（isBpRoles 16563250 · 四角色 16570643）—— 权限矩阵含灰色硬约束 */
export const ROLES_PANEL = {
  intro: "分组规则写在蓝本里，现场才不会临时纠结。按职能混编还是按议题自选，直接改变讨论质量。",
  groupingMode: { options: ["职能混编", "按议题自选"], note: "每组必须同时有业务、财务、技术视角。AI 按名单自动排一版，引导师可改。", perGroup: "5 人（超 5 人自动拆组）" },
  leadFrom: ["引导师指定", "组内推举"],
  // 权限矩阵：行=能力，列=四角色（引导/组长/组员/观察者）；yes / no。lockedFor: 该行对哪些角色是灰色硬约束（不可在蓝本里放开）
  roleCols: ["引导", "组长", "组员", "观察者"],
  permRows: [
    { cap: "改议程", vals: [true, false, false, false], lockedFor: ["组长", "组员", "观察者"] },
    { cap: "写本组画布", vals: [true, true, true, false], lockedFor: ["观察者"] },
    { cap: "提交本组产出", vals: [false, true, false, false], lockedFor: ["引导", "组员", "观察者"] },
    { cap: "看别组过程", vals: [true, false, false, false], lockedFor: ["组长", "组员", "观察者"] },
    { cap: "看已发布结论", vals: [true, true, true, true], lockedFor: [] },
  ],
  lockNote: "灰色项不可在蓝本里放开——它们是产品的硬约束，不是默认值。",
  invite: [
    { who: "内部成员", how: "SSO 免登直接进组" },
    { who: "外部参与者", how: "手机验证码 · 只核名单 · 令牌 24h（链接绑名单，参与者不需要注册）" },
    { who: "观察者", how: "独立只读链接 · 看原始内容需单独授权" },
  ],
};

/** 面板 6 · 问卷（isBpSurvey 16570473）—— 骨架与时机，不是具体题目 */
export const SURVEY_PANEL = {
  intro: "蓝本预置问卷骨架和发放时机，不是具体题目。套用时 AI 按这次的议题把占位题目补成具体问法。",
  surveys: [
    { name: "会前预习问卷", timing: "开始前 5 天发 · 60% 阻断开始", purpose: "让现场不用花时间对齐背景。8 题、约 6 分钟。",
      skeleton: ["你认为〔…〕最大的障碍是什么 → 生成 HMW 候选方向", "在〔…〕里排优先级 → 预设投票项", "你对现状的信心程度（1–5 分）→ 混编依据", "其余 5 题 · 展开"] },
    { name: "会后满意度与效果问卷", timing: "结束后 2 小时发", purpose: "4 题：目标达成度、AI 主持有用性、最有价值的环节、最该删的环节。",
      skeleton: ["结果直接进后台的 Skill 改进队列，不只是给引导师看。"] },
  ],
};

/** 面板 7 · 访谈与对象（isBpItv 16574756）—— 配额 + 授权硬约束 + 证据规则 */
export const INTERVIEW_PLAN_PANEL = {
  intro: "蓝本规定要访谁、访多少场、提纲骨架。访谈是会前最贵的一步，写进蓝本能避免每次重新设计。",
  planLabel: "预设访谈计划 · 6 场（按角色定配额，套用时补具体人名）",
  roles: [
    { role: "客户方决策人", ask: "真实约束与不可谈判项", guide: "决策人访谈 v2", quota: 2 },
    { role: "一线执行者", ask: "现状里真正卡住的地方", guide: "JTBD 访谈法", quota: 2 },
    { role: "外部客户", ask: "购买决策链与替代方案", guide: "采购决策链", quota: 2 },
  ],
  virtualNote: "虚拟专家推演可作补充，但不计入独立证据",
  authDefaults: [
    "默认请求录音与转录 · 发受访者自助同意链接",
    "默认请求 AI 分析（建议逐人问）",
    "未收到受访者本人确认前，「开始访谈」保持禁用 —— 硬约束",
  ],
  evidenceRules: "同一说法要被 2 个独立来源支持才算数；同场访谈里的附和不算独立；虚拟专家推演不计强度，只能作提问线索。这三条会写进现场的证据矩阵。",
};

/** 面板 8 · 会前任务 Homework（isBpHw 16579564）—— 每项必须挂环节 + 写清不做会怎样 */
export const HOMEWORK_PANEL = {
  intro: "每项任务必须挂到具体环节，并写清「不做会怎样」。挂不上环节的任务就是无意义的作业，参与者能感觉到。",
  tasks: [
    { title: "带 2 个你亲历的失败案例", seg: "环节 03", forWhom: "全体", ifNot: "HMW 发散会停留在抽象层面，产出无法验证。", due: "开始前 2 天 · 文字/语音均可，AI 会预读并提炼" },
    { title: "读 AI 洞察简报并标注不同意之处", seg: "环节 02", forWhom: "全体", ifNot: "环节 02 变成单向宣讲，25 分钟白花。标注会直接进现场的争议清单。", due: "开始前 2 天" },
    { title: "准备本组 3 分钟背景陈述", seg: "环节 01", forWhom: "仅组长", ifNot: "开场对齐拖到 25 分钟以上，后面全线挤压。", due: "开始前 1 天" },
  ],
  reminderRule: "催办由 AI 做，不由引导师做：截止前 24h 未提交自动发个性化提醒（提到他本人在问卷里写的那条）；仍未提交则在概览的就绪检查里标红。",
};

/** 面板 9 · 场地与形式（isBpVenue 16583471）—— 空间清单 + 三形式差异 + 布置图 */
export const VENUE_PANEL = {
  intro: "场地不是后勤细节，它决定分组能不能真的分开讨论。写成清单，套用时直接变成待办。",
  space: [
    { item: "主场地", spec: "可容 16 人 · 桌椅可移动" },
    { item: "分组空间", spec: "4 个角落或 2 个小会议室" },
    { item: "墙面", spec: "6 米可贴纸的墙 · 或 4 块移动白板" },
    { item: "屏幕", spec: "1 主屏 · 各组一台笔记本" },
    { item: "网络", spec: "≥ 5Mbps（远程组员接入）" },
  ],
  formats: [
    { key: "hybrid", label: "混合 · 本蓝本默认", detail: "线下分组，远程组员用手机进组。每组需一台设备开麦做转录。" },
    { key: "online", label: "全线上", detail: "自动增「破冰」「举手排队」两环节，打印素材整节自动跳过。" },
    { key: "offline", label: "纯线下", detail: "打印素材份数 ×1.2；需准备离线兜底（断网时本地采集队列）。" },
  ],
  layout: { note: "现场布置图 · 套用时作为一张图发给场地方", groups: ["第 1 组 · 圆桌 4 座", "第 2 组", "第 3 组", "第 4 组"], center: "主屏与引导师站位 · 中央留 2 米走动空间" },
};

/** 面板 10 · 项目材料（isBpMat 16588998）—— 物料清单 9 件，按人数换算 */
export interface MaterialRow { name: string; qty: string; forSeg: string; owner: string; }
export const MATERIALS_PANEL = {
  intro: "现场用的东西一次列清。套用后自动变成一张准备清单，并按实际组数换算数量。",
  label: "物料清单 · 9 件（数量按 4 组 / 16 人计算）",
  rows: [
    { name: "便签（4 色，76mm）", qty: "16 叠", forSeg: "03 / 04", owner: "场地方" },
    { name: "粗头马克笔（黑）", qty: "20 支", forSeg: "03 / 04", owner: "场地方" },
    { name: "圆点投票贴（红）", qty: "8 版", forSeg: "05", owner: "场地方" },
    { name: "A0 画布纸（见打印素材）", qty: "4 ＋ 2 备", forSeg: "03", owner: "我方打印" },
    { name: "桌牌（含姓名与组号）", qty: "16 个", forSeg: "01", owner: "我方打印" },
    { name: "录音设备（每组一台）", qty: "4 台", forSeg: "全程", owner: "我方" },
    { name: "计时器 / 大屏倒计时", qty: "1 套", forSeg: "全程", owner: "我方" },
    { name: "蓝丁胶", qty: "4 卷", forSeg: "03 / 04", owner: "场地方" },
    { name: "茶歇（含无咖啡因选项）", qty: "16 份", forSeg: "半场间", owner: "场地方" },
  ] as MaterialRow[],
  footnote: "数量会按实际人数重算——这里写的是 16 人 / 4 组的基准；套用时人数一变，清单自动换算并标出需要额外采购的项。",
};

/** 面板 11 · 分组打印素材（isBpPrint 16594763）—— 打印件与线上画布同构 + 二维码 OCR 回流 */
export const PRINT_PANEL = {
  intro: "打印件和线上画布必须同构，否则贴完纸没法数字化，白干一遍。",
  items: [
    { size: "A0", name: "HMW 画布", qty: "4 张 ＋ 2 备", ai: false,
      detail: "与 hmw 模板同构 · 4 区：现状痛点 / HMW 问句 / 候选做法 / 最想先试的。带组号与二维码。" },
    { size: "A3", name: "组长手册", qty: "4 份", ai: false,
      detail: "每页对应一个环节：这一环节要交什么、什么时候必须提交、卡住了找谁。组长是唯一提交人，这件事必须在纸上也写清楚。含本组题目与成功标准、环节 03 提交检查（4 项必填）、投票与陈述要点。" },
    { size: "A5", name: "洞察卡", qty: "4 套", ai: true,
      detail: "把研究阶段最强的 12 条洞察印成卡片，每组一套。现场可以直接拿它当便签用，比让大家凭记忆讨论强得多。每张卡背面印来源与置信度。" },
    { size: "A4", name: "进组指引", qty: "16 份", ai: false,
      detail: "一张纸：你在第几组、题目是什么、组长是谁、二维码扫码进自己的组。不需要注册。外部参与者另附一段数据处理说明。" },
  ],
  ocrNote: "贴完纸怎么进系统：每张 A0 右下角印二维码。手机拍照上传后，便签级 OCR 按分区归位，每张便签保留在原图中的位置，可点回原图核对。",
};

/** 面板 12 · 组内能力（isBpCaps 16601016）—— 默认开/关 + 产出回流 + 可见性 */
export const CAPS_PANEL = {
  intro: "现场每个小组能直接调用的东西。开得越多越散——蓝本的作用是替引导师先关掉不需要的。",
  caps: [
    { name: "与 AI 的对话", use: "本组共享推演，组员私聊汇总在这", state: "开 · 必留" },
    { name: "用户访谈", use: "访谈 AI 代跑并回流转写", state: "开" },
    { name: "深度研究", use: "带出处的分路检索", state: "开" },
    { name: "用户研究", use: "概念测试与可用性回合", state: "关 · 两天档才开" },
    { name: "画布便签", use: "本组假设树与证据卡", state: "开" },
    { name: "组内投票", use: "收敛用，结果回主持台", state: "开" },
    { name: "证据检索", use: "从洞察库与转写里取证", state: "开" },
  ],
  reflow: [
    { cap: "画布节点与证据卡", to: "成果沉淀的产出清单" },
    { cap: "投票结果", to: "主持台，作为切环节的依据" },
    { cap: "访谈转写与研究报告", to: "洞察库，下一场可复用" },
  ],
  visibility: [
    { who: "组员", canSee: "本组全部 · 自己的私聊", cannot: "别组内容 · 别组私聊" },
    { who: "引导师", canSee: "所有组 · 所有对话", cannot: "组员私聊" },
    { who: "观察者", canSee: "已发布产出与脱敏聚合", cannot: "原始转写与私聊" },
  ],
};

/** 面板 13 · Agent 编排（isBpAgent 16608650）—— 每环节谁在场 + 介入尺度 + 硬约束 */
export const AGENT_PANEL = {
  intro: "不是把所有 agent 都拉进来，而是规定每个环节谁在场、能做什么。同时在场的 AI 超过两个，现场会变吵。",
  label: "在场 agent · 4（同一环节最多两个可主动发言）",
  agents: [
    { name: "Facilitator", segs: "全程", canSpeak: true, does: "推进议程、识别重复议题、提议收敛", state: "默认开" },
    { name: "Analyst", segs: "03 / 04 / 05", canSpeak: true, does: "结构化拆解、标注致命假设", state: "默认开" },
    { name: "Scribe", segs: "全程", canSpeak: false, does: "转录、说话人分离、决策点捕捉", state: "默认开" },
    { name: "Scout", segs: "02 / 06", canSpeak: false, does: "现场取证、核查被质疑的数字", state: "按需召唤 · 仅被召唤时" },
  ],
  intervention: {
    threshold: "提议收敛的触发阈值：重复 5 次",
    history: "曾因阈值过低被 9 位主持人反馈「打断太早」，已从 3 次提到 5 次",
    rules: ["提议前先私下问引导师，不当众打断", "画布上可直接落笔（改动带 AI 署名）", "不可自动发起投票"],
  },
  hardLimits: [
    "AI 不能写决策 —— 拍板栏只能是人名",
    "AI 不能替组长提交产出",
    "agent 互相调用必须留痕，不能私下接力",
    "个人层内容永不进 agent 上下文",
  ],
};

/** 面板 14 · Skill 绑定（isBpSkill 16616349）—— 11 条，1 条已降级阻断发布 */
export interface SkillBinding { name: string; seg: string; desc: string; degraded: boolean; }
export const SKILL_PANEL = {
  intro: "Skill 绑在环节上而不是绑在人上。到了那个环节，对应的 skill 自动可用，引导师不用记它叫什么。",
  label: "绑定的 Skill · 11（灰色为组织层已降级，需替换）",
  skills: [
    { name: "洞察简报生成", seg: "02", desc: "把研究结果讲成 5 分钟简报", degraded: false },
    { name: "语音转便签", seg: "03", desc: "说出来即成便签，落到对应分区", degraded: false },
    { name: "HMW 问句校准", seg: "03", desc: "太宽或太窄的问句给改写建议", degraded: false },
    { name: "亲和图自动聚类 v2", seg: "03", desc: "便签自动分堆", degraded: true },
    { name: "收敛投票", seg: "05", desc: "发起、计票、呈现分歧点", degraded: false },
    { name: "MECE 假设拆解", seg: "03", desc: "把候选题目拆成可验证假设", degraded: false },
    { name: "纪要与行动项", seg: "06 / 07", desc: "提取决策、分歧、待办与责任人", degraded: false },
  ] as SkillBinding[],
  genericNote: "其余 4 个为全程可用的通用 skill",
  degradeWarning: "1 个 Skill 已在组织层降级：「亲和图自动聚类 v2」满意度跌到 62% 已降级。发布 v5 前必须替换或解绑，否则套用时环节 03 会缺能力。",
};

/** 面板 15 · 输出物（isBpOut 16621698）—— 6 件，生成方式 + 去向 + 结项检查 */
export interface OutputRow { name: string; gen: string; to: string; required: boolean; }
export const OUTPUTS_PANEL = {
  intro: "项目结束时必须存在的东西。每件产出都要指定生成方式与去向——去向决定它会不会被人再看一眼。",
  label: "产出清单 · 6 件（红色为必须有，缺了不能结项）",
  rows: [
    { name: "3 个可推进题目（含依据）", gen: "人拍板 · AI 整理依据", to: "决策台账", required: true },
    { name: "行动项清单（带责任人与日期）", gen: "AI 提取 · 人确认", to: "任务看板", required: true },
    { name: "4 张 HMW 画布快照", gen: "组长提交后锁版本", to: "项目图谱", required: false },
    { name: "项目纪要（中英）", gen: "AI 生成 · 引导师审阅", to: "交付给客户", required: false },
    { name: "争议与保留意见记录", gen: "AI 提取 · 不做和解", to: "纪要附录", required: false },
    { name: "可晋升的判断候选", gen: "AI 提名 · 人批准", to: "晋升队列", required: false },
  ] as OutputRow[],
  reflowRule: "正式产出与被决策引用的只能绑固定快照，不能绑活文档，否则事后改动会让已签字的决策依据发生变化。画布可以继续改，但改的是新版本。",
  closeChecks: [
    "两件必须有的产出都存在",
    "每个行动项都有责任人与日期",
    "决策的拍板栏是人名",
    "复盘会已排期（未做则 14 天后提醒）",
  ],
};

/** 面板 16 · 报告模板（isBpRep 16627026）—— 客户 18 页 + 内部 6 页 + 写作硬约束 */
export interface ReportChapter { title: string; by: string; }
export const REPORT_PANEL = {
  intro: "报告的骨架写死，内容留空。结论先行、每条结论必须挂证据——这两条是模板的作用，不是写作风格偏好。",
  client: {
    label: "客户交付版 · 18 页骨架（中英双语）",
    chapters: [
      { title: "一页纸结论：3 个题目与推进顺序", by: "必须人写" },
      { title: "我们怎么得出这个结论（方法与样本）", by: "AI 起草" },
      { title: "三个题目逐一展开 · 每题一页", by: "AI 起草" },
      { title: "证据附录 · 引述与来源可点回原文", by: "AI 生成" },
      { title: "分歧与保留意见（不做和解）", by: "必须保留" },
      { title: "行动项与责任人", by: "AI 起草" },
    ] as ReportChapter[],
  },
  internal: {
    label: "内部复盘版 · 6 页",
    note: "给自己看的那一份：哪个环节超时、哪条 AI 建议被否、哪些假设后来被推翻。这份不给客户，它是蓝本迭代的输入。",
  },
  writingRules: [
    "结论先行，不铺陈过程",
    "每条结论必须挂至少一条可点开的证据",
    "引用过期或低置信证据必须标注",
    "拒绝 AI 分析的受访者只能用原文引述",
  ],
  historyNote: "套用后 AI 会先出草稿，等你改。历史数据：一场半天项目的纪要，AI 起草约 3 分钟，引导师平均改 22 分钟。改动最多的一节是「一页纸结论」，所以那一节写死为必须人写。",
};

/**
 * 发布门槛 —— 界面真正演示的那道（原型明写，非 D-2 那份未定清单）。
 * 现状唯一阻断项：绑定的 Skill 里有「组织层已降级、未替换」的（SKILL_PANEL.degradeWarning）。
 * required 未完成项（D-2 占位）作为**次级、未证实**的提示一并返回，但标 unproven。
 */
export interface PublishBlocker { reason: string; proven: boolean; }
export const publishBlockers = (): PublishBlocker[] => {
  const out: PublishBlocker[] = [];
  const degraded = SKILL_PANEL.skills.filter((s) => s.degraded);
  for (const d of degraded) {
    out.push({ reason: `Skill「${d.name}」已在组织层降级，发布前必须替换或解绑，否则套用时环节 ${d.seg} 缺能力`, proven: true });
  }
  return out;
};

/** 形式三选一；选「全线上」自动加两个议程环节（I-16）*/
export type MeetingFormat = "hybrid" | "offline" | "online";
export const MEETING_FORMATS: { key: MeetingFormat; label: string; note: string }[] = [
  { key: "hybrid", label: "混合", note: "线下分组 + 远程组员用手机进组" },
  { key: "offline", label: "线下", note: "全部在同一物理场地" },
  { key: "online", label: "全线上", note: "自动加「破冰」和「举手排队」两个议程环节" },
];
export const ONLINE_EXTRA_SEGMENTS = ["破冰", "举手排队"]; // addedBy: "format-setting"

export type MeetingLang = "zh" | "en" | "bilingual";
export const MEETING_LANGS: { key: MeetingLang; label: string; note?: string }[] = [
  { key: "zh", label: "中文" },
  { key: "en", label: "English" },
  { key: "bilingual", label: "双语现场", note: "产出双语，客户方有海外董事" },
];

/** 模型策略三档并存（templates/domain.md ModelStrategy；非全局单选）*/
export const MODEL_STRATEGY: { lane: string; label: string; model: string; note: string; hardRoute?: boolean }[] = [
  { lane: "onsite", label: "现场", model: "sonnet-4.6", note: "低延迟优先" },
  { lane: "post-session", label: "会后整理", model: "opus-4.6", note: "质量优先" },
  { lane: "confidential", label: "机密材料", model: "仅本地 qwen3", note: "隐私硬路由 · 优先级高于配额降级", hardRoute: true },
];
/** 配额与降级（QuotaPolicy）。3.5M / 90% 是否项目级可覆盖 → 缺 D-3。 */
export const QUOTA_POLICY = {
  perSessionTokenBudget: 3_500_000,
  downgradeAtRatio: 0.9,
  hardStop: false,
  rationale: "现场卡住比多花钱贵。",
};

/** 六类初始化（I-17 封闭 6 值，类别不可增删）。uc-2-2 R3 第 2 步逐项对得上。 */
export const INIT_CATEGORIES: { key: string; label: string; writes: string; lands: string }[] = [
  { key: "topic-grouping", label: "定题与分组", writes: "主题句式与背景要素、4 组 × 场景清单、组长规则、访谈对象表结构", lands: "项目筹备 → 定题与分组" },
  { key: "agenda-materials", label: "议程与材料", writes: "14 环节与时长（＝该档位的议程环节数）、每环节材料要求与推演模板", lands: "项目筹备 → 议程 / 材料准备" },
  { key: "pre-session", label: "会前", writes: "问卷 2 份、访谈脚本、按角色派发的会前任务清单", lands: "项目筹备 → 会前任务；研究洞察 → 问卷" },
  { key: "onsite", label: "现场", writes: "组内能力开关、按状态载入的 agent 与 skill、录音与转录设置", lands: "现场协作" },
  { key: "roles-entry", label: "角色与进场", writes: "4 种角色的可见性、邀请链接与有效期默认值", lands: "分组与签到、角色可见性" },
  { key: "output", label: "产出", writes: "6 件输出物的验收口径、2 份报告骨架与写作硬约束", lands: "成果沉淀 → 产出物 / 洞察报告" },
];

/* ════════════════════════════════════════════════════════════════════════
 * UC-2.4 蓝本列表页 —— 行元数据与状态
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * ⚠ 与契约 `templates.BlueprintState` **同名、取值不一致**（契约三值，多 `archived`）
 * ⇒ 已改名分离，见 `CONTRACT_DIVERGENCES.D14`。
 * 契约对归档有硬不变量（I-7「归档不影响可达性，已套用项目仍可实例化」），
 * 而这份两值渲染不出归档行——归档蓝本要么消失、要么显示成 `published`，都与 I-7 冲突。
 */
export type BlueprintStateView = "published" | "draft";
export interface BlueprintRow {
  id: string;
  name: string;
  state: BlueprintStateView;
  version: number | null; // 草稿态为 null，不显示版本号
  agendaSegments: number; // 议程环节数（随档位变）
  duration: string; // 如 3.5h / 5d
  usedCount: number; // 用过 N 次（试跑不计入）
  /** 满意度：O-37③ 引导师 1–5 均值 + 样本量；样本量 < 阈值显示「样本不足」 */
  satisfaction: { mean: number; sampleSize: number } | null;
  doneCount: number; // 完成度分子（分母恒读 configTotal()）
  visibility: "org-wide" | "team-only";
  team: string | null;
  appliedByProject: boolean; // 是否被项目套用过 —— 决定 [删除] vs [归档]（O-18①）
  draftHint?: string; // 草稿态门槛提示
}

/** 满意度最小样本量阈值（缺 D-5：具体数值待产品给；此处参数化占位）*/
export const SATISFACTION_MIN_SAMPLE = 5;
export const hasEnoughSatisfactionSamples = (s: BlueprintRow["satisfaction"]) =>
  !!s && s.sampleSize >= SATISFACTION_MIN_SAMPLE;

export const BLUEPRINTS: BlueprintRow[] = [
  { id: "bp-hmw", name: "HMW 定题项目", state: "published", version: 4, agendaSegments: 7, duration: "3.5h",
    usedCount: 12, satisfaction: { mean: 4.6, sampleSize: 9 }, doneCount: 16, visibility: "org-wide", team: null, appliedByProject: true },
  { id: "bp-bmc", name: "商业模式共创", state: "published", version: 3, agendaSegments: 14, duration: "2d",
    usedCount: 21, satisfaction: { mean: 4.1, sampleSize: 14 }, doneCount: 14, visibility: "org-wide", team: null, appliedByProject: true },
  { id: "bp-diag", name: "组织诊断（两天）", state: "published", version: 2, agendaSegments: 14, duration: "2d",
    usedCount: 3, satisfaction: { mean: 4.3, sampleSize: 3 }, doneCount: 15, visibility: "team-only", team: "能源组", appliedByProject: true },
  { id: "bp-sprint", name: "设计冲刺 5 天", state: "published", version: 5, agendaSegments: 19, duration: "5d",
    usedCount: 7, satisfaction: { mean: 4.0, sampleSize: 6 }, doneCount: 13, visibility: "org-wide", team: null, appliedByProject: true },
  { id: "bp-hypo", name: "假设风暴（快版）", state: "draft", version: null, agendaSegments: 7, duration: "3.5h",
    usedCount: 0, satisfaction: null, doneCount: 12, visibility: "org-wide", team: null, appliedByProject: false, draftHint: "试跑一场后才能发布" },
  { id: "bp-review", name: "客户访谈复盘", state: "draft", version: null, agendaSegments: 4, duration: "90m",
    usedCount: 0, satisfaction: null, doneCount: 9, visibility: "org-wide", team: null, appliedByProject: false, draftHint: "试跑一场后才能发布 · 场地与打印素材两节待清空" },
  { id: "bp-strat", name: "战略假设复盘", state: "published", version: 6, agendaSegments: 7, duration: "3.5h",
    usedCount: 4, satisfaction: { mean: 4.4, sampleSize: 5 }, doneCount: 15, visibility: "org-wide", team: null, appliedByProject: false },
];
export const BLUEPRINT_STATS = { total: 7, published: 5, draft: 2 };

/** 版本历史（UC-2.4 R8「待补/待定」：版本历史屏在已探明区确认缺失，此处为补画）*/
export interface BlueprintVersion {
  versionNumber: number;
  state: "published" | "archived";
  publishedBy: string;
  publishedAt: string;
  changedConfigItemKeys: string[]; // 改了哪几项设计配置（V6）
  rolledBackFrom: number | null; // O-18②：回滚 = 新建等同旧版的新版本
  usedByActiveProjects: number; // 回滚约束：>0 不可作为回滚目标
}
export const VERSION_HISTORY: BlueprintVersion[] = [
  { versionNumber: 4, state: "published", publishedBy: "林可", publishedAt: "2026-07-22 14:52",
    changedConfigItemKeys: ["flow-agenda", "project-materials", "outputs"], rolledBackFrom: null, usedByActiveProjects: 3 },
  { versionNumber: 3, state: "archived", publishedBy: "林可", publishedAt: "2026-06-30 10:14",
    changedConfigItemKeys: ["grouping-rule", "skill-binding"], rolledBackFrom: null, usedByActiveProjects: 1 },
  { versionNumber: 2, state: "archived", publishedBy: "周宁", publishedAt: "2026-05-18 09:03",
    changedConfigItemKeys: ["topic-and-background", "survey", "report-template"], rolledBackFrom: null, usedByActiveProjects: 0 },
  { versionNumber: 1, state: "archived", publishedBy: "周宁", publishedAt: "2026-04-02 16:40",
    changedConfigItemKeys: [], rolledBackFrom: null, usedByActiveProjects: 0 },
];

/* ════════════════════════════════════════════════════════════════════════
 * UC-2.2 项目筹备页 —— 定题与分组、观察/访谈对象表
 * ════════════════════════════════════════════════════════════════════════ */

export const PROJECT_TOPIC = {
  topic: "远洋是否应在 2027 年前进入欧洲工商储市场，以何种模式进入？",
  background:
    "客户董事会已将储能列为第二增长曲线，Q3 需给出进入模式的初步判断。德国电价机制与并网政策是关键约束，客户方有海外董事，产出需双语。",
  sources: ["12 条洞察", "4 场访谈", "客户董事会时间表"],
  aiGenerated: true, // 机器产出，必须挂来源（uc-2-2 R7）
};

/**
 * 分组**就绪度**（筹备页）。⚠ 原名 `GroupStatus` —— 与契约 `templates.GroupStatus`
 * **同名但是两个维度**：契约那份是分组的**进度生命周期** `["未开始","进行中","已完成"]`
 * （I-14 三值封闭），这份是筹备阶段的**健康度/就绪度**（录音就绪 / 缺 N 人 / 需介入）。
 * 一个「进行中」的组同时可以「缺 N 人」——两者正交，合并会互相顶替。
 * ⇒ 改名分离，无取值分歧，不需人类裁决。
 */
export type GroupReadinessView = "recording-ready" | "short-n" | "needs-intervention";
export const GROUP_STATUS_LABEL: Record<GroupReadinessView, string> = {
  "recording-ready": "录音就绪", "short-n": "缺 N 人", "needs-intervention": "需介入",
};
export const GROUP_STATUS_TONE: Record<GroupReadinessView, "primary" | "warning" | "danger"> = {
  "recording-ready": "primary", "short-n": "warning", "needs-intervention": "danger",
};
export interface ProjectGroup {
  ordinal: number;
  name: string;
  status: GroupReadinessView;
  statusDetail: string;
  scenario: string;
  memberCount: number;
  lead: string;
}
export const PROJECT_GROUPS: ProjectGroup[] = [
  { ordinal: 1, name: "第 1 组", status: "recording-ready", statusDetail: "录音就绪", scenario: "德国工商业主的采购决策链", memberCount: 6, lead: "沈岚" },
  { ordinal: 2, name: "第 2 组", status: "short-n", statusDetail: "缺 1 人", scenario: "采购委员会比选供应商", memberCount: 2, lead: "高琳" },
  { ordinal: 3, name: "第 3 组", status: "needs-intervention", statusDetail: "组长未到，2 人闲置", scenario: "并网与电价机制核查", memberCount: 4, lead: "（待指派）" },
  { ordinal: 4, name: "第 4 组", status: "recording-ready", statusDetail: "录音就绪", scenario: "路径 B 商业模式与回本测算", memberCount: 5, lead: "周宁" },
];
export const UNGROUPED = ["郑好", "陈默"];

/** 观察/访谈对象表六列（结构与填写属本域；预约/提纲/回流属 06-itv）*/
export interface InterviewSubject {
  name: string;
  role: string;
  contact: string;
  focus: string;
  method: string;
  status: string;
}
export const INTERVIEW_SUBJECTS: InterviewSubject[] = [
  { name: "Dr. Weber", role: "某物流园区 · 运营总监", contact: "+49 ··· （AI 建议）", focus: "工商储在其园区的实际痛点与付费意愿", method: "远程视频", status: "待预约" },
  { name: "李工", role: "并网设计院 · 高级工程师", contact: "已在名单", focus: "德国并网审批周期与常见卡点", method: "电话", status: "已确认" },
  { name: "（AI 建议人选）", role: "采购总监 · 制造业", contact: "—", focus: "比选供应商时最看重的三项", method: "现场", status: "AI 建议 · 需人确认" },
];

/* ════════════════════════════════════════════════════════════════════════
 * UC-2.2 工作流编排 —— 模板层 + 议程环节×三角色矩阵 + 模板库
 * ════════════════════════════════════════════════════════════════════════ */

export const WORKFLOW_TEMPLATE = {
  name: "设计思维标准五步",
  applied: true,
  sourceVersion: "来自后台 v2", // WorkflowTemplate.sourceBlueprintVersionId 的展示
};
/** 议程环节链（每个环节上标绑定的画布模板/skill）*/
export const SEGMENT_CHAIN = [
  "对齐目标", "现状共识", "假设风暴 · hmw", "分组共创 · business-model", "收敛投票", "行动项",
];

/** 矩阵列集由角色表派生（I-28：观察者只读故不入矩阵 → 三列是角色表子集）*/
export const MATRIX_ROLES: ProjectRole[] = ["facilitator", "groupLead", "member"];
export const matrixRoleLabel = (r: ProjectRole) => PROJECT_ROLE_LABEL[r];

export interface OrchestrationRow {
  segment: string; // 议程环节 · 绑定
  binding: string;
  cells: Record<ProjectRole, string>; // 每格 = 一条角色职责 = 一条待办的发生源
}
export const ORCH_MATRIX: OrchestrationRow[] = [
  { segment: "02 现状共识", binding: "25m · Scout 简报",
    cells: { facilitator: "播报市场简报", groupLead: "记下本组疑问", member: "听 · 可提问", observer: "" } },
  { segment: "03 假设风暴（当前）", binding: "45m · 模板 hmw ＋ 语音转便签",
    cells: { facilitator: "计时 · 提议收敛 · 看四组进度", groupLead: "分工 · 补必填区 · 提交本组", member: "写 ≥1 张便签 · 投票", observer: "" } },
  { segment: "04 分组共创", binding: "60m · 模板 business-model",
    cells: { facilitator: "切换环节 · 广播要求", groupLead: "指派格子 · 汇报", member: "填两格 · 互评", observer: "" } },
];

export const TEMPLATE_LIBRARY = [
  { name: "设计冲刺 5 天", meta: "18 议程环节 · 每天一个产出闸门" },
  { name: "战略假设复盘", meta: "半天，5 议程环节 · 假设树 ＋ 证据核对" },
  { name: "客户共创", meta: "3 小时，7 议程环节 · 旅程图 ＋ 价值主张" },
];

/* ════════════════════════════════════════════════════════════════════════
 * UC-2.3 提回蓝本 —— 偏离 diff + 待审改动
 * ════════════════════════════════════════════════════════════════════════ */

export interface Deviation {
  configItemKey: string;
  configItemLabel: string;
  before: string; // 蓝本原值
  after: string; // 本场实际值
  rationale: string; // 必填（I-11）
}
export const DEVIATIONS: Deviation[] = [
  { configItemKey: "flow-agenda", configItemLabel: "流程 Agenda", before: "6 环节 · 无「电价机制核查」", after: "7 环节 · 插入「电价机制核查」25m", rationale: "" },
  { configItemKey: "grouping-rule", configItemLabel: "分组规则", before: "3 组 · 按行业分", after: "4 组 · 按决策链角色分", rationale: "" },
  { configItemKey: "outputs", configItemLabel: "输出物", before: "6 件", after: "7 件 · 加「并网审批时间线」", rationale: "" },
];

/** 待审改动收件面（蓝本侧，已探明区确认缺失 → 补画）。⚠ 只有维护者能合并（缺 D-1）*/
export interface PendingChange {
  id: string;
  configItemLabel: string;
  before: string;
  after: string;
  rationale: string;
  sourceProject: string;
  proposedBy: string;
  proposedAt: string;
  baseVersion: number;
}
export const PENDING_CHANGES: PendingChange[] = [
  { id: "cr-1", configItemLabel: "流程 Agenda", before: "6 环节", after: "7 环节 · 插入电价机制核查",
    rationale: "两场德国项目都发现并网/电价是致命假设，前置核查能省一整个下午的返工。", sourceProject: "远洋新能源 · 欧洲市场进入", proposedBy: "沈岚", proposedAt: "2026-07-28 17:20", baseVersion: 4 },
  { id: "cr-2", configItemLabel: "流程 Agenda", before: "6 环节", after: "7 环节 · 插入竞品拆解",
    rationale: "客户更关心竞品定价而非政策，插竞品拆解更贴需求。", sourceProject: "华东储能 · 二期", proposedBy: "周宁", proposedAt: "2026-07-26 11:05", baseVersion: 4 },
  { id: "cr-3", configItemLabel: "输出物", before: "6 件", after: "7 件 · 加并网审批时间线",
    rationale: "客户董事会明确要一张可对外的时间线，几乎每场都被追问。", sourceProject: "远洋新能源 · 欧洲市场进入", proposedBy: "沈岚", proposedAt: "2026-07-28 17:22", baseVersion: 4 },
];

/* ════════════════════════════════════════════════════════════════════════
 * 项目侧缺失概念 —— UC-2.2 是项目唯一出生路径，但「项目」域需求刚被发现缺失。
 * 我需要但不存在的东西，明确列出，不替它编。
 * 依据：requirements/00-project/DERIVED-FROM-CONTRACTS.md
 * ════════════════════════════════════════════════════════════════════════ */
export const PROJECT_SIDE_UNKNOWNS = [
  { q: "项目怎么创建", state: "无出处", note: "组织角色 lead「创建与管理项目」已签核，但『怎么创建、能不能不套蓝本』无 UC（Q-1）。本向导假定「套蓝本」是主路径。" },
  { q: "议程环节的字段名", state: "已裁决并改名对齐（F121）", note: "phase-00 遗留的三个败选名（旧驼峰/蛇形环节字段名、旧 stage 前缀动作词）已由 Q-3 B① 裁定并在 F121 收敛为单源 agendaSegment / agendaSegmentId，全仓不再出现。" },
  { q: "议程环节的实体与状态机", state: "有状态、无集合", note: "『环节可被推进』已签核（agendaSegment.advance），『组长切状态 → 三视角首屏切换』依赖它，但状态集合与迁移规则完全没有（Q-2）。矩阵屏的『（当前）』标记是占位。" },
  { q: "steps 表", state: "明确不存在", note: "0008 迁移逐字写『there is no steps table』，两个失败码 STEP_CLOSED / STEP_REJECTS_ARTIFACT_TYPE 目前不可达，是指派给 phase-01 的债。" },
  { q: "项目生命周期 / status 列", state: "组织有、项目没有", note: "projects 表只有 id/org_id/name 三列，无 status、无蓝本引用列、无创建者列（Q-5）。本原型显示的『准备度%』只是展示值，口径未定（缺 D-13）。" },
  { q: "准备度百分比口径", state: "无口径", note: "原型显示 68% / 15%，但分母构成与权重未探明（缺 D-13）。" },
];

/* ════════════════════════════════════════════════════════════════════════
 * 屏枚举 + 解析器
 * ════════════════════════════════════════════════════════════════════════ */
export type TplScreen =
  | "list" | "designer" | "apply" | "prep" | "workflow" | "promote" | "versions";
export const TPL_SCREENS: TplScreen[] = [
  "list", "designer", "apply", "prep", "workflow", "promote", "versions",
];
export const TPL_SCREEN_LABEL: Record<TplScreen, string> = {
  list: "蓝本列表",
  designer: "蓝本设计器",
  apply: "新建项目向导",
  prep: "项目筹备页",
  workflow: "工作流编排",
  promote: "提回蓝本",
  versions: "版本与锁定",
};
/** 每屏对应的 UC，供预览条与 README 映射 */
export const TPL_SCREEN_UC: Record<TplScreen, string> = {
  list: "UC-2.4", designer: "UC-2.1", apply: "UC-2.2", prep: "UC-2.2",
  workflow: "UC-2.2", promote: "UC-2.3", versions: "UC-2.4",
};
export function resolveTplScreen(raw: string | string[] | undefined): TplScreen {
  const v = Array.isArray(raw) ? raw[0] : raw;
  // 默认落地屏是列表，不是设计器（F318）：/tpl 裸路径此前默认渲染原型态设计器，
  // 与真实挂载点 /tpl/designer 撞名却不是一回事，误导用户以为进的是真实设计器。
  return TPL_SCREENS.includes(v as TplScreen) ? (v as TplScreen) : "list";
}
