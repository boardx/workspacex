/**
 * `project`（项目本身）能力域的 mock 数据 —— phase-01 第 10 个域。
 *
 * ⚠ 这是**转译**，不是发明：全部取值来自运行态原型
 * `phases/requirements/WorkspaceX Standalone.html` 里「项目工作台」那一屏（wsDetailView）。
 * 每个字段都能在原型里点到；凡原型没有的、我补的，都在 README 与 PROTOTYPE-ANSWERS 里标 [设计]/[待确认]。
 *
 * ⚠ 纯数据模块，**不带 `"use client"`**——服务端页面与客户端子组件都要 import。
 * ⚠ 只写前端 + mock，绝不接后端。切环节不真推进、发布不真发布、拖卡不真回写。
 *
 * ── 契约对齐 ──────────────────────────────────────────────────────────
 * 项目角色四种直接复用 `@/lib/identity`（其 `ProjectRole` 由 `@repo/contracts` 派生），
 * 不在此另抄一份枚举——那是本项目踩过五次的「同一事实两处」。
 * ⚠ 裁决（人类 2026-07-30）：**「项目」= 工作坊**（模板 + 会前/现场/会后三段 AI 增强）。
 *   四种项目角色**只属工作坊**。研究项目 / 用户洞察是**另外两类独立容器**（Q-12 裁 C+D），
 *   它们**只有拥有者 + 协作者两档**（U-1），界面归 `interview`/`research` 束，不在本域画。
 *
 * ── 契约里还缺、集中在此声明并标注「待迁入 packages/contracts」的 ─────────────
 *   · 「议程环节」实体本身 —— feature_list 里没有 feature 承接（OPEN-QUESTIONS Q-2）；
 *     命名**已裁决**（Q-3① 改名对齐 → `agenda_segment` / `agenda_segment_id`，D-03a 权威），
 *     UI 显示中文「环节」、testid 统一为 `agenda-segment-*`（旧 `agenda-item-*` 已废弃）。
 *   · 项目生命周期状态（active/archived）—— Q-5 未裁决，此处只演示 active。
 *   · 准备度百分比口径 —— uc-2-2 已登记 [待确认]，overview 改用原型里确实存在的「就绪检查 3/3」。
 *   · 发布结论的「绑定产出版本」「保留意见随发布」—— 成果沉淀屏有控件，契约未建模。
 *   · 候选决策（来自转写，待签署）实体 —— 成果沉淀屏有，契约未建模。
 *   · 组织停用后项目的只读呈现（uc-00-1 V12「显示只读原因而非隐藏」）—— 契约未建模。
 *
 * ⚠ 本文件含 AI agent 名（Scout/Echo/Ava/Ledger）与蓝本清单等「内建能力清单」形状，
 *   它们是**一个组织的示例配置**（uc-0-5 R7），已按纪律登记进
 *   `apps/api/tests/kernel/no-builtin-capability-lists.test.ts` 的 DECLARED_MOCK_DEBT。
 *   组件层不得出现这些字面量，一律从本文件 import。
 */
import { PROJECT_ROLE_LABEL, PROJECT_ROLES, type ProjectRole } from "@/lib/identity";

export { PROJECT_ROLE_LABEL, PROJECT_ROLES };
export type { ProjectRole };

/* ─────────────────────── 预览维度：标签页（= 工作台的「屏」） ─────────────────────── */

export type ProjectTab =
  | "overview" | "research" | "prep" | "live" | "results" | "todo" | "settings";

export const PROJECT_TABS: ProjectTab[] = [
  "overview", "research", "prep", "live", "results", "todo", "settings",
];

/** 主标签定义（顺序、文案、角标）—— 逐字来自原型 tab 条（阶段式，Layout B/wsDetailView）*/
export const TAB_DEFS: Array<{ key: ProjectTab; label: string; badge?: string; badgeTone?: "neutral" | "danger" }> = [
  { key: "overview", label: "概览" },
  { key: "research", label: "研究洞察", badge: "12" },
  { key: "prep", label: "项目筹备", badge: "2", badgeTone: "danger" },
  { key: "live", label: "现场协作" },
  { key: "results", label: "成果沉淀" },
  { key: "todo", label: "待办", badge: "6", badgeTone: "danger" },
  { key: "settings", label: "设置" },
];

export function resolveProjectTab(raw: string | string[] | undefined): ProjectTab {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return PROJECT_TABS.includes(v as ProjectTab) ? (v as ProjectTab) : "overview";
}

/** 带左侧上下文子导航的标签（研究洞察 / 项目筹备 / 成果沉淀）*/
export const SUB_NAV: Partial<Record<ProjectTab, { section: string; items: Array<{ key: string; label: string; meta?: string; metaTone?: "muted" | "success" | "danger" }> }>> = {
  research: {
    section: "研究洞察",
    items: [
      { key: "overview", label: "研究总览" },
      { key: "conv", label: "对话", meta: "6" },
      { key: "survey", label: "问卷", meta: "34/48" },
      { key: "itv", label: "用户洞察", meta: "9/22" },
      { key: "research", label: "深度研究", meta: "4" },
    ],
  },
  prep: {
    section: "项目筹备",
    items: [
      { key: "scope", label: "定题与分组" },
      { key: "agenda", label: "议程", meta: "7 环节" },
      { key: "material", label: "材料准备", meta: "9 份" },
      { key: "homework", label: "会前任务", meta: "7/12" },
    ],
  },
  results: {
    section: "成果沉淀",
    items: [
      { key: "report", label: "洞察报告", meta: "对话生成", metaTone: "success" },
      { key: "decision", label: "结论与决策", meta: "1 待签", metaTone: "danger" },
      { key: "deliverable", label: "产出物", meta: "4" },
      { key: "action", label: "行动项", meta: "3/11" },
      { key: "audit", label: "审计与反馈", meta: "214" },
    ],
  },
};

/* ─────────────────────── 视角（= 项目角色，四种） ─────────────────────── */

/**
 * [原型] 四视角说明条文案 —— 逐字来自原型 JS `roleScopeNote`。
 * 这是「四视角真的改变界面」的可见承诺（UC-1.4 / X-1）：观察者能看到的显著更少。
 */
export const ROLE_SCOPE_NOTE: Record<ProjectRole, string> = {
  facilitator: "同一个界面，你有全部权限：四组对话、原始转写、切环节与介入。",
  groupLead: "同一个界面，你能看第 2 组的全部对话与组员私聊，能提交本组产出；别组内容与全场控制不可见。",
  member: "同一个界面，你能看第 2 组的共享内容与自己的对话；别组内容、组员私聊与全场控制不可见。",
  observer: "同一个界面，只读：已发布产出与脱敏聚合可见；原始转写、私聊、内部协作视图与任何操作按钮都关掉了。",
};

/** 观察者只读——canWrite=false 时隐藏所有操作按钮（前端投影，真实权限在服务端 RLS）*/
export const ROLE_CAN_WRITE: Record<ProjectRole, boolean> = {
  facilitator: true, groupLead: true, member: true, observer: false,
};

/**
 * 全场控制（切环节 / +5 分钟 / 介入 / 发布结论）**只有引导师**。
 * 组长能提交本组、看本组全部；组员只读本组共享；观察者什么控制都没有。
 * ⚠ 这是「四视角真的改变界面」的另一侧：别把组长/组员画成缩水的引导师。
 */
export const ROLE_STAGE_CONTROL: Record<ProjectRole, boolean> = {
  facilitator: true, groupLead: false, member: false, observer: false,
};

/**
 * 「我的组」—— 组长/组员对本组（第 2 组 = g2）有完整可见；引导师看全部（null=不限）；
 * 观察者无归属（只看脱敏聚合）。别组对组长/组员**只显示进度，不显示原始引述**。
 */
export const ROLE_OWN_GROUP: Record<ProjectRole, string | null> = {
  facilitator: null, groupLead: "g2", member: "g2", observer: null,
};

/** 是否能看到**所有**组的原始引述（只有引导师）。组长/组员只在本组看，观察者全脱敏。 */
export const ROLE_SEES_ALL_RAW: Record<ProjectRole, boolean> = {
  facilitator: true, groupLead: false, member: false, observer: false,
};

/**
 * 观察者对「内部协作视图」（当前环节分工 / 待办看板明细 / 分组名单 / 设置配置区 / 原始洞察库）
 * 一律**看不到**（内容消失，不是变灰）。用它统一驱动各 tab 的观察者裁剪。
 */
export function observerHidden(view: ProjectRole): boolean {
  return view === "observer";
}

/** [原型] 视角徽标底色语义 token（原型用黑/铜/靛/灰，此处映射到设计 token） */
export type ProjectBadgeTone = "neutral" | "primary" | "ai" | "warning" | "outline";
export const ROLE_BADGE_TONE: Record<ProjectRole, ProjectBadgeTone> = {
  facilitator: "neutral", groupLead: "warning", member: "ai", observer: "outline",
};

/* ─────────────────────── 项目外壳：顶栏身份与元信息 ─────────────────────── */

/** [原型] 项目顶栏——项目名、组织、时长、分组数、三类人 + Facilitator(AI) */
export const PROJECT_HEADER = {
  id: "kickoff-8f21",
  name: "欧洲进入策略 Kickoff 项目",
  org: "远洋新能源",
  duration: "3 小时 30 分",
  groupCount: "4 个分组",
  facilitatorName: "林可",
  managerName: "周宁",
  participantCount: 12,
  aiFacilitator: "Facilitator（AI）",
  /** [原型] 概览里项目实际研究的问题（Serif 大标题）*/
  question: "2027 年前，储能业务应以何种模式进入欧洲工商业市场？",
  reportDate: "7 月 29 日汇报",
};

/**
 * [设计] 组织停用后项目的只读呈现（uc-00-1 V12：**显示只读原因而非隐藏**）。
 * ⚠ 原型完全空白——列表卡片有「已归档」标签但从未演示行为（PROTOTYPE-ANSWERS Q-5）；
 *   组织停用连标签都没有。此处按 V12 的规范补一个「保留内容 + 只读 + 说明原因」的呈现。
 */
export const ORG_DISABLED_BANNER = {
  title: "所属组织「远洋新能源」已被停用",
  reason: "组织管理员或平台已停用该组织。项目内容全部保留、暂时转为只读；组织恢复后自动解除，无需重建。",
  hint: "只读期间可查看已有产出、审计与历史，但不能编辑、提交、发布、切换环节或邀请。",
};

/* ─────────────────────── 概览（净新，原型 isWsOver） ─────────────────────── */

/** [原型] 顶部状态条：进行中 · 环节 3/7 · 就绪检查 3/3 · 12 人在场 · 09:00 开始 */
export const OVERVIEW_STATUS = {
  phase: "进行中",
  segment: "环节 3 / 7", // agenda_segment（D-03a）；显示中文「环节」
  readyCheck: "就绪检查 3/3 ✓", // 原型用「就绪检查」而非「准备度%」（后者口径 [待确认]）
  attendance: "12 人在场 · 4 组",
  timing: "09:00 开始 · 预计 12:30 进入整理",
};

/** [原型] 当前环节卡：环节名 + 倒计时 + 三角色各自的现状与入口 */
export const CURRENT_SEGMENT = {
  title: "假设风暴 → 各组填旅程图的「机会」行",
  countdown: "12:48",
  roles: [
    { role: "facilitator" as ProjectRole, self: true, note: "第 4 组落后，考虑提议收敛或延时。", action: "去主持" },
    { role: "groupLead" as ProjectRole, count: "4 位组长", note: "补齐必填分区并提交。", warn: "2 组还差「机会」行。", action: "组长视角" },
    { role: "member" as ProjectRole, count: "12 位组员", note: "每人至少 1 张便签，投票 10/12 已投。", action: "组员视角" },
  ],
};

/** [原型] 概览待办预览（3 项 · 1 阻塞）—— 与「待办」看板同源 */
export const OVERVIEW_TODOS = [
  { id: "ot1", title: "给第 3 组补 1 位熟悉并网流程的成员", sub: "影响「并网审批」场景", tag: "阻塞", tone: "danger" as const },
  { id: "ot2", title: "给环节 05–07 绑定推演模板", sub: "这几段现在没有产出承接", tag: "进行中", tone: "warning" as const },
  { id: "ot3", title: "催回 14 份问卷", sub: "可让 AI 代发", tag: "未开始", tone: "muted" as const },
];

/** [原型] 最新动态时间线（含人与 AI 混合）*/
export const ACTIVITY_FEED = [
  { id: "a1", who: "Scout", kind: "ai" as const, text: "回答了「并网审批实际耗时」并存为洞察", time: "2h" },
  { id: "a2", who: "高", kind: "person" as const, text: "在研究室跑了 3 个虚拟画像访谈", time: "4h" },
  { id: "a3", who: "林", kind: "person" as const, text: "把 3 条洞察加入定题池并定下题目 A", time: "昨天" },
  { id: "a4", who: "周", kind: "person" as const, text: "完成 2 场现场观察并上传影像", time: "2 天前" },
];

/* ─────────────────────── 现场协作（原型 isWsDuring · 主持台全场） ─────────────────────── */

export const LIVE_STAGE = {
  attendance: "11 / 12 已到 · 每组一条加入链接，打开即进，不需要注册",
  segment: "环节 3 / 7",
  segmentTitle: "假设风暴 → 假设树画布",
  countdown: "12:48",
  needIntervention: "第 3 组需介入",
};

/** [原型] 四组并行卡片——每组一路录音，实时喂给本组推演模板 */
export const LIVE_GROUPS = [
  {
    id: "g1", name: "第 1 组 · 首次评估投资", time: "12:41",
    quote: "周宁：他们评估时根本没人算过削峰收益，都是听同行说",
    canvas: "共情图 · AI 边听边填", fill: 62, needs: false,
  },
  {
    id: "g2", name: "第 2 组 · 采购比选", time: "12:41",
    quote: "高琳：采购委员会真正怕的是签完字之后没人负责",
    canvas: "旅程图 · 比选阶段", fill: 84, needs: false, extra: "POV ＋ HMW 3 条待组长确认",
  },
  {
    id: "g3", name: "第 3 组 · 并网审批", time: "",
    quote: "近 8 分钟只有组长在说话，另两人未发言；话题偏到设备选型。Facilitator 建议你过去，或推一条提示。",
    canvas: "共情图 素材不足", fill: 21, needs: true,
  },
  {
    id: "g4", name: "第 4 组 · 收益归因", time: "12:41",
    quote: "刘航：如果收益不达标，谁来赔？这是我们卡了三次的地方",
    canvas: "价值主张画布 已填 5/9 格", fill: 55, needs: false,
    extra: "本组已提出 1 个可做原型的概念：收益保底 ＋ 月度归因看板",
  },
];

/* ─────────────────────── 成果沉淀（原型 isWsAfter） ─────────────────────── */

export const RESULTS = {
  conclusion: {
    text: "先用两周尽调锁定资质可转让性，再在收购与 EPC 合作之间二选一；自建路径当场排除。",
    signedBy: "周宁 签字 · 7/25 12:30",
  },
  hypothesis: { verified: 5, pending: 9, refuted: 3 },
  destinations: { decisions: 3, insights: 14, actions: 11 },
  /** [原型] 发布结论——危险动作：必须绑定一个确定的产出版本 + 影响范围说明 */
  publish: {
    boundVersion: "四组产出合并为「进入策略初步结论」", versionTag: "绑定 v2",
    scope: "项目成员 ＋ 客户方 3 人（观察者按已发布内容可见）",
    publisher: "林可 · 引导师 有发布授权",
    precheck: "4/4 组产出已提交且无退回中",
    reservation: "陈默：本地化率要求未核实，反对现在给客户时间承诺。",
  },
};

/** [原型] 候选决策——来自转写，每条带引用位置，签署前可回听。签署是危险动作 */
export const CANDIDATE_DECISIONS = [
  {
    id: "cd1", text: "两周内完成资质转让尽调后再定路径",
    transcript: "转写 10:24:18–10:25:02", basis: "依据 v2 · 第 3 节",
    extractedBy: "Echo 提取", signer: "周",
    authz: "须周宁签署（合伙人 · 路径类决策）", canSign: false, signLabel: "请他签署",
  },
  {
    id: "cd2", text: "首批只做德国、荷兰，波兰下一阶段再评估",
    transcript: "转写 11:48:30–11:49:11", basis: "依据 v2 · 第 5 节",
    extractedBy: "Echo 提取", signer: "林",
    authz: "你有此类决策签署授权 · 有效期至 8/31", canSign: true, signLabel: "签署",
  },
];

/** [原型] 审计记录：角色 / 版本 / Agent 调用 / 决策，同一时间线，不可删除 */
export const AUDIT_TRAIL = {
  totals: { all: 214, role: 8, version: 11, agent: 183, decision: 12 },
  entries: [
    { id: "au1", time: "12:06:41", kind: "决策", text: "林可签署「首批只做德国、荷兰」", meta: "依据 v2 · 授权有效期内" },
    { id: "au2", time: "11:52:09", kind: "版本", text: "高琳提交第 2 组 v2", meta: "v1 退回理由已归档，不可覆盖" },
    { id: "au3", time: "11:20:33", kind: "调用", text: "Ava → Ledger · 现金流对比（深度 2）", meta: "412k token · 人已批准" },
    { id: "au4", time: "10:14:52", kind: "版本", text: "林可退回第 2 组 v1，附理由", meta: "v1 转为只读快照" },
    { id: "au5", time: "09:41:07", kind: "角色", text: "授予客户方王毅「观察者」＋ 第 2 组原始内容临时读权", meta: "环节 3 结束自动失效" },
  ],
};

/* ─────────────────────── 待办看板（净新，原型 isWsTodo · 四列） ─────────────────────── */

export type KanbanColumn = "todo" | "doing" | "review" | "done";
export const KANBAN_COLUMNS: Array<{ key: KanbanColumn; label: string }> = [
  { key: "todo", label: "待办" },
  { key: "doing", label: "进行中" },
  { key: "review", label: "待复核" },
  { key: "done", label: "已完成" },
];

/** 卡片来源：会前任务 / 现场行动项 / 报告缺料 / 决策后续（原型：状态改了回写原处）*/
export const KANBAN_CARDS: Array<{ id: string; col: KanbanColumn; title: string; source: string; owner: string; due?: string; blocked?: boolean; overdue?: boolean }> = [
  { id: "k1", col: "todo", title: "给第 3 组补 1 位熟悉并网流程的成员", source: "现场行动项", owner: "林", blocked: true },
  { id: "k2", col: "todo", title: "催回 14 份问卷", source: "会前任务", owner: "AI 代发", due: "今天" },
  { id: "k3", col: "todo", title: "补「本地化率 40%」补贴口径原文", source: "报告缺料", owner: "SC", overdue: true },
  { id: "k4", col: "doing", title: "给环节 05–07 绑定推演模板", source: "现场行动项", owner: "林" },
  { id: "k5", col: "doing", title: "三路径现金流对比模型", source: "决策后续", owner: "LG", due: "7/30" },
  { id: "k6", col: "review", title: "核实收购标的资质可转让性", source: "决策后续", owner: "SC", due: "7/28" },
  { id: "k7", col: "done", title: "整理欧洲工商储项目库", source: "会前任务", owner: "SC" },
  { id: "k8", col: "done", title: "约访 2 家本地 EPC 负责人（初约）", source: "现场行动项", owner: "林" },
];

/* ─────────────────────── 研究洞察（原型 isWsRov，复用 itv/research 域心智） ─────────────────────── */

/** [原型] 洞察库——每条必须能点回原始证据；强度只有真人来源能标「强」*/
export const INSIGHTS = [
  { id: "i1", text: "客户把「交付确定性」排在价格之前：11/11 客户侧问卷把并网周期列为首要阻碍，访谈里也反复出现「工期没法跟董事会解释」。", source: "问卷 ＋ 访谈", strength: "强" as const, state: "已入定题池", expired: false },
  { id: "i2", text: "能源负责人是兼职角色：储能只占他 5% 的时间，他要的不是更省钱，而是不用他操心。", source: "现场观察", strength: "强" as const, state: "加入定题池", expired: false },
  { id: "i3", text: "收益归因不清可能是复购的最大阻碍——三个数字人与画像都主动提到「达不到承诺谁负责」。尚无真人证据。", source: "数字人／画像 · 探索性", strength: "弱" as const, state: "安排真人验证", expired: false },
  { id: "i4", text: "德国业主更信本地能源顾问的推荐——来自 2024 年的访谈，已超过 12 个月复核周期", source: "已过期", strength: "弱" as const, state: "派任务重新核实", expired: true },
];

/** [原型] 洞察来源分布——虚拟来源单独计数，避免用 AI 生成的共识说服自己 */
export const INSIGHT_SOURCES = [
  { label: "用户洞察 · 真人", count: 5 },
  { label: "问卷", count: 4 },
  { label: "深度研究（外部资料）", count: 3 },
  { label: "数字人／画像（探索性）", count: 3 },
];

/** [原型] 尚未验证的假设 · 3 */
export const UNVERIFIED_HYPOTHESES = [
  { id: "h1", text: "业主愿为工期承诺付 5% 溢价", note: "问卷量表分歧最大" },
  { id: "h2", text: "EPC 愿意接受排他条款", note: "需再约 2 家 EPC" },
  { id: "h3", text: "收益保底能换来溢价而非纠纷", note: "仅虚拟访谈提到" },
];

/* ─────────────────────── 项目筹备（原型 isWsScope / isWsAgenda，复用 tpl 域） ─────────────────────── */

/** [原型] 定题与分组：主题一句话 + 背景 + 四组（场景 / 组长 / 组员 / 访谈对象）*/
export const PREP_GROUPS = [
  { id: "pg1", name: "第 1 组", scenario: "首次评估投资", lead: "李维", members: "3 人", interviewee: "业主侧投资经理" },
  { id: "pg2", name: "第 2 组", scenario: "采购比选", lead: "高琳", members: "3 人", interviewee: "采购总监（Weber）" },
  { id: "pg3", name: "第 3 组", scenario: "并网审批", lead: "刘航", members: "2 人", interviewee: "电网受理厅 / 本地 EPC" },
  { id: "pg4", name: "第 4 组", scenario: "收益归因", lead: "陈默", members: "3 人", interviewee: "运维主管" },
];

/**
 * [原型] 议程环节 · 每个环节三种角色各做什么（原型 isWsAgenda 的核心）。
 * ⚠ 命名**已裁决** → D-03a `agenda_segment` / `agenda_segment_id`（Q-3① 改名对齐）。
 * 界面显示中文「环节」，testid 统一为 `agenda-segment-*`（旧 `agenda-item-*` 已废弃）。
 */
export const AGENDA = [
  { no: "02", title: "现状共识", meta: "25m · Scout 简报", current: false, roles: { facilitator: "播报市场简报", groupLead: "记下本组疑问", member: "听 · 可提问" } },
  { no: "03", title: "假设风暴", meta: "45m · 模板 hmw ＋ 语音转便签", current: true, roles: { facilitator: "计时 · 提议收敛 · 看四组进度", groupLead: "分工 · 补必填区 · 提交本组", member: "写 ≥1 张便签 · 投票" } },
  { no: "04", title: "分组共创", meta: "60m · 模板 business-model", current: false, roles: { facilitator: "切换环节 · 广播要求", groupLead: "指派格子 · 汇报", member: "填两格 · 互评" } },
];

/** [原型] 蓝本清单（新建项目 · 套用蓝本）—— 一个组织的示例配置，非产品内建 */
export const BLUEPRINT_CATALOG = [
  { id: "bp-hmw", name: "HMW 定题", desc: "洞察 → 3 个可推进的题目", meta: "7 环节 · 半天 · 用过 12 次", selected: true },
  { id: "bp-bmc", name: "商业模式共创", desc: "分组填 BMC 并互评", meta: "9 环节 · 一天 · 用过 6 次" },
  { id: "bp-storm", name: "假设风暴（快版）", desc: "90 分钟出致命假设清单", meta: "4 环节 · 90 分 · 用过 21 次" },
  { id: "bp-sprint", name: "设计冲刺 5 天", desc: "从发散到可测原型", meta: "22 环节 · 5 天 · 用过 3 次" },
  { id: "bp-journey", name: "用户旅程共创", desc: "画旅程、标痛点、排机会", meta: "8 环节 · 半天 · 用过 9 次" },
  { id: "bp-dd", name: "尽调结论评审", desc: "把证据摆上桌，逐条签字", meta: "6 环节 · 3 小时 · 用过 5 次" },
];

/* ─────────────────────── 新建项目流程（原型 wsCreateView / isWsCreate） ─────────────────────── */

/**
 * [原型] 新建项目向导 —— 步骤 1「选蓝本九宫格」+ 从空白 / 复制一场；步骤 2「主题与时长」。
 * ⚠ **本域最关键的一处裁决落点**：原型步骤 2 有「**挂到哪个项目（决定能读哪些洞察与图谱）**」
 *   字段（原型 JS 数据区 byte 15208776），默认值「远洋新能源 · 欧洲市场进入」——它宣称的是
 *   **父子项目模型（Q-12 候选 E）**，而 Q-12 已裁 **C（三类独立容器）+ D（超类型表）**，
 *   **E 未被采纳**。处置：把该字段**改成明确的跨容器只读引用**「关联研究来源」，
 *   并在旁注写清它**不是父子层级**。详见 `ui-preview/project-v2/README.md` 第二节 与 `V1-WAS-WRONG.md`。
 */
export const NEWPROJECT = {
  /** 步骤 1：两张「非蓝本」入口（原型 byte 15206899「从空白开始」等） */
  scratchOptions: [
    { id: "scratch", title: "从空白开始", desc: "自己排环节，没有骨架约束" },
    { id: "copy", title: "复制一场已办的", desc: "连议程、画布绑定、AI 配置一起复制" },
  ],
  blueprintNote: "蓝本必须先选：它决定环节骨架、每个环节绑哪张画布、AI 有什么权限。选完后面三步只是把骨架伸缩成这一场的议程。",
  /** 步骤 2：主题与时长（默认值逐字来自原型 JS 数据区 byte 15207xxx，已核对） */
  defaults: {
    name: "欧洲进入策略 Kickoff 项目",
    durationTiers: [
      { id: "90m", label: "90 分钟", on: false },
      { id: "half", label: "半天 · 3.5h", on: true },
      { id: "full", label: "全天", on: false },
      { id: "custom", label: "自定义", on: false, dashed: true },
    ],
    datetime: "7/31 09:00",
    headcount: "12 人 → 4 组 × 3 人",
  },
  /**
   * 处置后的「关联研究来源」字段（原「挂到哪个项目」）。
   * value 是可选引用；note 明说这是**跨容器只读引用**，不是父子层级。
   */
  linkedSources: {
    label: "关联研究来源（可选 · 决定能读哪些洞察与图谱）",
    value: "远洋新能源 · 欧洲市场进入（研究项目）",
    placeholder: "不引用任何研究来源",
    note: "把一个「研究项目 / 用户洞察」容器作为只读来源引用进来，工作坊便能读到它的洞察与图谱。这是跨容器引用，不是父子归属 —— Q-12 裁定三类独立容器（C+D），父子模型（E）未采纳。",
  },
} as const;

/* ─────────────────────── 设置（原型 isWsSetup） ─────────────────────── */

/**
 * [原型] 产出与留存 —— 三项的默认值**已对原型 JS 数据区逐条核过**（isSetOut 块 byte 15274086）：
 *   · 「结束后自动写回组织大脑」= **开**（原型底色 #17171A）
 *   · 「客户可见的分享链接」= **关**（原型底色 #DEDCD3、滑块在左）← v1 mock 曾误画成「开 ✓」，
 *     这是**保真度错误（屏在、控件在、默认值反了）**，已改。见 V1-WAS-WRONG.md。
 *   · 转录留存 180 天（非开关）。
 * ⚠ 分享链接默认**关**很重要：只有开启后观察者/客户方才按已发布内容可见（B-1 的边界仍未定）。
 */
export const RETENTION_SETTINGS = [
  { id: "rs1", label: "结束后自动写回组织大脑", on: true, note: "" },
  { id: "rs2", label: "客户可见的分享链接", on: false, note: "默认关闭 · 开启后观察者与客户方才按已发布内容可见" },
];
/**
 * 留存期的**唯一声明处**（D-14：须按项目动态渲染，代码不得写死）。
 *
 * ⚠ 真实实现必须从项目参数读；这里是 mock 的单一事实源，
 * 所有展示位一律从它派生，**不许再出现第二个字面量**——
 * 本仓已四次因阈值散落而漂移。
 */
export const RETENTION_DAYS = 180; // [threshold-ok:retentionMaterial] mock 的唯一声明处，其余展示位从它派生
export const RETENTION_DAYS_LABEL = `转录留存 ${RETENTION_DAYS} 天`;

export const SETTINGS_SECTIONS = [
  { key: "flow", title: "工作流编排", desc: "模板 · 环节 · 三角色分工" },
  { key: "invite", title: "参与者与邀请", desc: "9 / 12 已确认" },
  { key: "basic", title: "基本信息", desc: "时间 · 形式 · 分组 · 语言" },
  { key: "ai", title: "AI 权限", desc: "3 项 · 1 项已关" },
  { key: "graph", title: "知识图谱", desc: "节点 84 · 分带与过期" },
  { key: "retention", title: "产出与留存", desc: `写回大脑 · 留存 ${RETENTION_DAYS} 天` },
];

/** [原型] 参与者名单——身份四选 + 邀请状态（贴合原型「参与者与邀请」屏） */
export const PARTICIPANTS = [
  { id: "pt1", initial: "高", name: "高琳", role: "组长 · 第 2 组", status: "已确认" },
  { id: "pt2", initial: "吴", name: "吴桐", role: "组员 · 第 2 组", status: "已确认" },
  { id: "pt3", initial: "周", name: "周宁", role: "观察者", status: "已确认" },
  { id: "pt4", initial: "陈", name: "陈默", role: "组员 · 第 3 组", status: "邀请已发 2 天" },
];
export const INVITE_IDENTITIES = ["组员", "组长", "观察者（只读）", "协同引导师"];

/** [原型] AI 在这场里的权限——三项默认值已对原型 JS 数据区（byte 15274xxx）逐条核过：前两项开、末项关 */
export const AI_PERMISSIONS = [
  { id: "ap1", label: "Facilitator 主动提议收敛", on: true },
  { id: "ap2", label: "实时转录与语音转便签", on: true },
  { id: "ap3", label: "AI 直接在小组画布落笔", on: false },
];


/* ─────────────────────── 每屏 UC 溯源（供 README 与 sign-off 回溯） ─────────────────────── */

export const TAB_UC: Record<ProjectTab, string> = {
  overview: "uc-00-2 R3（项目概览）· uc-1-4 R5（多视角）",
  research: "uc-00-2 · 06-itv/uc-6-0 · 00-core/uc-0-2（复用研究/访谈域）",
  prep: "02-tpl/uc-2-2（套用蓝本新建 · 定题分组 · 议程环节三角色）",
  live: "05-rec/uc-5-1 · 07-canvas/uc-7-3（主持台全场 · 四组并行）",
  results: "artifact backflow · uc-00-2 R3（结论/决策/产出/审计）",
  todo: "11-board/uc-11-1（四列看板 · 卡片来源自动同步）",
  settings: "02-tpl/uc-2-2 六类初始化 · 01-auth/uc-1-3（邀请）· uc-0-5（AI 权限）",
};

export const TAB_LABEL: Record<ProjectTab, string> = Object.fromEntries(
  TAB_DEFS.map((t) => [t.key, t.label]),
) as Record<ProjectTab, string>;
