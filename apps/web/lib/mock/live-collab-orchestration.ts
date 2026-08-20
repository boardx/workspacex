/**
 * ⚠⚠⚠ 纯 MOCK 数据 —— Phase 10「现场协作编排」UI 先行原型（ADR-003 签核第 ① 件材料）⚠⚠⚠
 *
 * 这个文件里**没有一条数据接了后端**。它存在的唯一目的是让人类在设计签核前
 * 能点、能看到交互与七态，评审「编排层的真实交互逻辑」这件事本身——不是验证数据。
 *
 * 命名刻意含 `LC_MOCK_` 前缀 + 本文件头这段大字告示，是为了让签核评审者
 * **一眼分清**「这是编排层要交付的真实交互结构」与「这是等后端补上的占位假数据」。
 *
 * ── 数据来源纪律（对齐 requirements/00-overview.md 的硬前置）─────────────────
 * 每个字段标注三类之一：
 *   [原型]   —— 逐字/结构来自 `00-project/prototype-raw-text-extract.txt`，是一手 UI 依据。
 *   [待补契约] —— 原型有这个展示位，但仓库里**没有任何契约/仓储字段**能供数（如
 *              「本组进度 checklist」「需要知道」「已生成产出」「素材充足度」）。
 *              这些**不是**可以编造的真数据，UI 先行阶段只做骨架 + 明示占位。
 *   [待签核] —— 需要人类在契约设计阶段裁定口径的点（如观察者可见范围、到场判定、
 *              倒计时字段是否新增、「需介入」告警判据）。原型里给一个合理默认，
 *              不悄悄拍板成既成事实。
 *
 * ── 明确不在本 phase 重造的领域模型（各自 phase 是单一事实源）────────────────
 *   知识图谱节点/关系/决策树 → phase-02；看板六来源 → phase-02；问卷 → phase-09；
 *   深度研究 → phase-06；用户访谈 → phase-07；对话 → phase-01 08-chat；
 *   画布/转录 → phase-01 canvas/recording 束。本文件只做**编排/路由/聚合**所需的形状。
 */
import type { LucideIcon } from "lucide-react";
import {
  MessagesSquare, Mic, Telescope, ClipboardList, Network,
} from "lucide-react";
import type { ProjectRole } from "@/lib/identity";

/* ═══════════════════════ 视角切换器（对齐 01-viewer-role.md）═══════════════════════ */

export type LcViewKind = "stage" | "group";

/** [原型] 分组选项的一句话状态后缀。tone 决定徽标语义色。 */
export type LcGroupStatusTone = "running" | "missing" | "intervene";

export interface LcViewerOption {
  id: string;
  kind: LcViewKind;
  /** stage：主持台·全场；group：分组·N组 */
  label: string;
  /** 括号里的构成说明（stage）或场景（group） */
  sub: string;
  /** [原型] 状态后缀，仅分组有 */
  status?: string;
  statusTone?: LcGroupStatusTone;
  /**
   * [待签核] 这条状态从哪个真实字段来：
   *   "推演中" → 可从环节引擎推导；"缺1人" → 可从分组签到人数推导（02-group-checkin 新建）；
   *   "需介入" → **全仓无来源**（00-overview 硬前置），此处为占位默认，判据待人类裁定。
   */
  statusSource: "agenda" | "checkin" | "TODO-no-source";
}

export const LC_MOCK_VIEWER_OPTIONS: LcViewerOption[] = [
  {
    id: "stage",
    kind: "stage",
    label: "主持台 · 全场",
    sub: "4 组 · 看板 / 知识图谱 / 签到",
    statusSource: "agenda",
  },
  {
    id: "g1",
    kind: "group",
    label: "第 1 组 · 首次评估投资",
    sub: "组长 李维 · 3 人",
    status: "推演中",
    statusTone: "running",
    statusSource: "agenda",
  },
  {
    id: "g2",
    kind: "group",
    label: "第 2 组 · 采购比选",
    sub: "组长 高琳 · 3 人",
    status: "推演中",
    statusTone: "running",
    statusSource: "agenda",
  },
  {
    id: "g3",
    kind: "group",
    label: "第 3 组 · 并网审批",
    sub: "组长 刘航 · 2 人（缺 1）",
    status: "需介入",
    statusTone: "intervene",
    statusSource: "TODO-no-source",
  },
  {
    id: "g4",
    kind: "group",
    label: "第 4 组 · 收益归因",
    sub: "组长 陈默 · 3 人",
    status: "推演中",
    statusTone: "running",
    statusSource: "agenda",
  },
];

/**
 * [原型] 顶部按角色区分的提示条文案（01-viewer-role.md「不能所有角色共用引导师那句话」）。
 * 引导师那句逐字来自原型；其余三句按「如实描述该角色实际拥有的权限」补写，标 [待签核]
 * 供人类核对措辞是否准确（尤其观察者可见范围本身待裁定）。
 */
export const LC_MOCK_ROLE_SCOPE_NOTE: Record<ProjectRole, string> = {
  facilitator: "引导师视角：同一个界面，你有全部权限——四组对话、原始转写、切环节与介入。",
  groupLead: "组长视角：你只能进本组（第 2 组），能看本组全部对话与组员私聊、提交本组产出；主持台·全场与别组内容不可见。",
  member: "组员视角：你只能进本组（第 2 组），可读写本组共享内容与自己的对话；别组内容、组员私聊、全场控制不可见。",
  observer: "观察者视角：只读。[待签核] 默认「全场只读聚合」——能看已发布产出与脱敏聚合，看不到原始转写/私聊/任何操作按钮。「全场只读 vs 仅分配的一组只读」由人类在契约阶段裁定。",
};

/** 哪些角色能看到「主持台·全场」选项（前端投影，真实由服务端按角色+分组成员判定）。*/
export const LC_ROLE_CAN_SEE_STAGE: Record<ProjectRole, boolean> = {
  facilitator: true,
  groupLead: false,
  member: false,
  // [待签核] 观察者能否看全场，取决于上面 note 里那条未裁定项。默认给 true（全场只读）。
  observer: true,
};

/* ═══════════════════════ 环节状态条（复用 F963 真实样式，此处 mock 供数）═══════════════════════ */

/**
 * [原型] 黑色常驻状态条内容。
 * ⚠ F963 已把标题/序号/推进动作接真（`listAgendaSegments`/`advanceAgendaSegment`），
 *   本原型是**离线预览**，用 mock 填充以展示完整视觉；真实页面走 F963 的数据源。
 * ⚠ `countdown`（剩余倒计时）与 `intervene`（第 X 组需介入）在契约里**没有字段**：
 *   `listAgendaSegments` 目前只给 `{title, state}`，没有剩余时长；「需介入」全仓无来源。
 *   都标 [待签核]，真实页面在补上对应契约字段前不得渲染编造值。
 */
export const LC_MOCK_STAGE_BAR = {
  ordinal: 3,
  total: 7,
  title: "假设风暴 → 假设树画布",
  countdown: "12:48", // [待签核] 无契约字段，需先跟 phase-01 议程束确认是否新增剩余时长
  intervene: "第 3 组需介入", // [待签核] 全仓无来源，判据待裁定
};

/* ═══════════════════════ 分组签到（02-group-checkin.md，本 phase 自己 owns）═══════════════════════ */

export interface LcCheckinMember {
  ab: string;
  name: string;
  /** 组长 / 组员 */
  tag: string;
  /** [待签核] 到场判定口径：默认「点过加入链接即到场」，是否要心跳/在线待裁定 */
  arrived: boolean;
}

export interface LcCheckinGroup {
  no: string;
  name: string;
  /** 场景（当前议题） */
  scene: string;
  /** [原型] M/N 已到 */
  arrivedCount: number;
  total: number;
  /** [复用] 免注册进场链接——生成/校验机制复用 phase-01 uc-1-2，本 phase 只可视化 */
  url: string;
  members: LcCheckinMember[];
}

export const LC_MOCK_CHECKIN = {
  /** [原型] 11 / 12 已到 · 每组一条加入链接，打开即进，不需要注册 */
  arrivedTotal: 11,
  total: 12,
  groups: [
    {
      no: "1",
      name: "首次评估投资",
      scene: "组长 李维",
      arrivedCount: 3,
      total: 3,
      url: "wsx.app/w/kickoff-8f21/g1",
      members: [
        { ab: "李", name: "李维", tag: "组长", arrived: true },
        { ab: "吴", name: "吴桐", tag: "组员", arrived: true },
        { ab: "孙", name: "孙毅", tag: "组员", arrived: true },
      ],
    },
    {
      no: "2",
      name: "采购比选",
      scene: "组长 高琳",
      arrivedCount: 3,
      total: 3,
      url: "wsx.app/w/kickoff-8f21/g2",
      members: [
        { ab: "高", name: "高琳", tag: "组长", arrived: true },
        { ab: "周", name: "周宁", tag: "组员", arrived: true },
        { ab: "郑", name: "郑好", tag: "组员", arrived: true },
      ],
    },
    {
      no: "3",
      name: "并网审批",
      scene: "组长 刘航",
      arrivedCount: 2,
      total: 3, // [原型] 该组缺 1 人，对应视角切换器「缺 1 人」状态
      url: "wsx.app/w/kickoff-8f21/g3",
      members: [
        { ab: "刘", name: "刘航", tag: "组长", arrived: true },
        { ab: "林", name: "林越", tag: "组员", arrived: true },
        { ab: "陈", name: "陈默", tag: "组员", arrived: false },
      ],
    },
    {
      no: "4",
      name: "收益归因",
      scene: "组长 韩箐",
      arrivedCount: 3,
      total: 3,
      url: "wsx.app/w/kickoff-8f21/g4",
      members: [
        { ab: "韩", name: "韩箐", tag: "组长", arrived: true },
        { ab: "秦", name: "秦朗", tag: "组员", arrived: true },
        { ab: "许", name: "许安", tag: "组员", arrived: true },
      ],
    },
  ] as LcCheckinGroup[],
};

/* ═══════════════════════ 分组五模块侧栏（03-module-routing.md）═══════════════════════ */

export type LcModuleKey = "chat" | "interview" | "research" | "survey" | "graph";

export interface LcModuleTab {
  key: LcModuleKey;
  /** 两字母图标缩写（对齐原型 CH/IT/DR/SV/KG） */
  ab: string;
  icon: LucideIcon;
  label: string;
  /**
   * [待补契约-计数] 计数来自各自模块的真实接口（对话数/访谈数/研究数/问卷数），
   * 不是编排层维护的字段。本原型用 mock 数字占位。graph 无计数。
   * 各自模块 phase：chat→phase-01、interview→phase-07、research→phase-06、
   * survey→phase-09、graph→phase-02（该 phase not_started，本模块只能 UI 骨架）。
   */
  count?: number;
  /** 该模块领域实现所属 phase（供 README/签核回溯） */
  ownerPhase: string;
}

export const LC_MOCK_MODULE_TABS: LcModuleTab[] = [
  { key: "chat", ab: "CH", icon: MessagesSquare, label: "与 AI 的对话", count: 24, ownerPhase: "phase-01 / 08-chat" },
  { key: "interview", ab: "IT", icon: Mic, label: "用户访谈", count: 2, ownerPhase: "phase-07" },
  { key: "research", ab: "DR", icon: Telescope, label: "深度研究", count: 1, ownerPhase: "phase-06" },
  { key: "survey", ab: "SV", icon: ClipboardList, label: "问卷", count: 1, ownerPhase: "phase-09" },
  { key: "graph", ab: "KG", icon: Network, label: "本组图谱", ownerPhase: "phase-02（not_started → 仅骨架）" },
];

/**
 * [原型] 编排层定义的**统一卡片形态**（状态徽标 + 摘要 + 负责人头像 + 打开模块按钮）。
 * 各模块只需提供符合这个形态的数据字段——这是编排层交付物，不是各模块领域字段。
 */
export interface LcModuleCard {
  id: string;
  /** 可见性徽标：全组可见 / 仅我 / 预设 */
  vis: string;
  time: string;
  /** 一句话摘要 / 最后一条 */
  summary: string;
  /** 负责人（人或 AI） */
  who: string;
  whoIsAi?: boolean;
  /** 状态徽标（如「转录中」「已回流」「回收中」「有争议」） */
  statusLabel?: string;
  statusTone?: "neutral" | "primary" | "warning" | "danger" | "ai";
  /** 挂载技能标签 */
  skills?: string[];
}

/** [原型] 各模块的卡片列表（数量对齐侧栏计数的可见样本；chat 实际 24，此处展示 5 张） */
export const LC_MOCK_MODULE_CARDS: Record<Exclude<LcModuleKey, "graph">, LcModuleCard[]> = {
  chat: [
    { id: "ch1", vis: "全组可见", time: "12:41", summary: "帮我把「资质可转让」这条整理成三条可验证子问题，给组里投票用。", who: "高琳", statusLabel: "预设 · 收敛助手", statusTone: "ai", skills: ["收敛", "投票草案"] },
    { id: "ch2", vis: "全组可见", time: "12:33", summary: "对比中盛项目的资质尽调清单，哪几项在德国不适用？", who: "Scout", whoIsAi: true, statusLabel: "线程里的同事", statusTone: "ai", skills: ["检索", "交叉验证"] },
    { id: "ch3", vis: "仅我", time: "12:20", summary: "把我刚才口述的三点顾虑转成便签贴到画布。", who: "郑好", statusLabel: "语音转便签", statusTone: "neutral", skills: ["转便签"] },
    { id: "ch4", vis: "全组可见", time: "11:58", summary: "现在这条路径下，董事会最可能卡在哪一步？给我一个提问清单。", who: "周宁", skills: ["提问清单"] },
    { id: "ch5", vis: "预设 · 已下发", time: "开场", summary: "本组开场提示：先对齐「我们这一组要推演什么」，再进假设。", who: "Facilitator", whoIsAi: true, statusLabel: "项目里的主持人", statusTone: "ai", skills: ["开场", "对齐"] },
  ],
  interview: [
    { id: "it1", vis: "全组可见", time: "11:58", summary: "第 2 组 · 采购总监（Weber）：采购委员会真正怕的是签完字后没人负责。41 分 · 已回流。", who: "高琳", statusLabel: "已回流", statusTone: "primary", skills: ["转录", "引述抽取"] },
    { id: "it2", vis: "全组可见", time: "10:12", summary: "第 2 组 · 本地 EPC 负责人：未接通，待改约。", who: "周宁", statusLabel: "待预约", statusTone: "warning" },
  ],
  research: [
    { id: "dr1", vis: "全组可见", time: "昨天", summary: "收购后资质是否需要重新备案？来源 9 · 两派说法冲突，尚不能作为报价依据。", who: "Scout", whoIsAi: true, statusLabel: "有争议", statusTone: "danger", skills: ["检索", "交叉验证"] },
  ],
  survey: [
    { id: "sv1", vis: "全组可见", time: "回收中", summary: "坊前问卷 · 欧洲业务最大阻碍：客户侧 11/12 已回收，开放题字数中位 96 字。", who: "项目经理", statusLabel: "回收中 34/48", statusTone: "warning", skills: ["交叉分析"] },
  ],
};

/**
 * [待补契约] 右侧「本场状态」栏——环节倒计时复用 F963 真实源；但「本组进度 checklist」
 * 「需要知道」「已生成产出」三块**全仓无来源**（03-module-routing 第 4 点点名）。
 * 本原型渲染它们是为了让人类看到完整信息架构，但每块都会挂「待补契约字段」标记，
 * 不伪装成真数据。
 */
export const LC_MOCK_GROUP_SIDEBAR = {
  checklist: [
    { mark: "done", label: "已确认本组场景：采购比选" },
    { mark: "done", label: "每人至少 1 张便签（3/3）" },
    { mark: "doing", label: "补齐旅程图「机会」行" },
    { mark: "todo", label: "提交本组 v2 产出" },
  ] as Array<{ mark: "done" | "doing" | "todo"; label: string }>,
  needToKnow: [
    "第 3 组卡在证据冲突，收敛环节可能顺延。",
    "客户方观察者已进场，原始转写对其不可见。",
  ],
  outputs: [
    { ab: "旅", name: "旅程图 · 采购比选", meta: "84% · AI 边听边填" },
    { ab: "PO", name: "POV + HMW", meta: "3 条待组长确认" },
  ],
};

/* ═══════════════════════ 分组·本组决策小树（03-module-routing，graph 模块）═══════════════════════ */

/** [原型] 决策节点状态：领先/在议待决/冲突/已否决/待验证 */
export type LcNodeState = "领先" | "在议待决" | "冲突" | "已否决" | "待验证";
export const LC_NODE_STATE_TONE: Record<LcNodeState, "primary" | "warning" | "danger" | "neutral" | "ai"> = {
  "领先": "primary",
  "在议待决": "warning",
  "冲突": "danger",
  "已否决": "neutral",
  "待验证": "ai",
};

export interface LcTreeNode {
  id: string;
  title: string;
  state: LcNodeState;
  sub: string;
  meta: string;
}

export const LC_MOCK_GROUP_TREE = {
  /** 头：{{ curGrp.no }} {{ curFn.name }} … */
  head: { no: "第 2 组", scene: "采购比选", lead: "高琳", fn: "本组图谱" },
  nodes: [
    { id: "gn1", title: "本组要解决的问题", state: "领先", sub: "采购委员会为何迟迟不签", meta: "场景根" },
    { id: "gn2", title: "责任归属不清是主因", state: "在议待决", sub: "签完字后没人负责 → 需要归因机制", meta: "环节 3 · 高琳提出" },
    { id: "gn3", title: "价格是次要因素", state: "已否决", sub: "问卷显示交付确定性排在价格前", meta: "证据：坊前问卷 11/12" },
    { id: "gn4", title: "收益保底能换溢价", state: "待验证", sub: "仅虚拟访谈提到，缺真人证据", meta: "验证负责人 Scout" },
    { id: "gn5", title: "资质可随股权转移", state: "冲突", sub: "6 条判例支持 / 1 例失效反对", meta: "与第 3 组证据互斥" },
  ] as LcTreeNode[],
  /** [原型] 本组已确认的事实 */
  facts: [
    { text: "客户把「交付确定性」排在价格之前。", src: "坊前问卷 11/12" },
    { text: "采购委员会的核心顾虑是签约后的责任归属。", src: "访谈 · Weber" },
  ],
  /** [原型] 本组待决与下一步 */
  pending: [
    { text: "「收益保底」到底换来溢价还是纠纷？", action: "派真人访谈验证" },
    { text: "资质可转让性与第 3 组的证据冲突，需现场判一次。", action: "上台讨论" },
  ],
};

/* ═══════════════════════ 主持台·全场·看板（03-module-routing 三视图之一）═══════════════════════ */

export interface LcKanbanGroup {
  no: string;
  scene: string;
  time: string;
  /** [原型] 一句 AI 摘要引述 */
  quote: string;
  quoteBy: string;
  /** 使用的模板 */
  template: string;
  /**
   * [待补契约] 进度百分比 / 素材充足度 —— canvas 束 `listGroupCanvases` 契约已签但
   * 零仓储实现（F963 已记录），且「素材充足度」全仓无字段（00-overview 硬前置）。
   * 本原型占位，真实页面在 canvas 仓储落地前只能骨架。
   */
  progressPct: number;
  progressNote: string;
  intervene?: boolean;
  interveneNote?: string;
}

export const LC_MOCK_KANBAN: LcKanbanGroup[] = [
  { no: "第 1 组", scene: "首次评估投资", time: "12:41", quote: "他们评估时根本没人算过削峰收益，都是听同行说。", quoteBy: "周宁", template: "共情图 · AI 边听边填", progressPct: 62, progressNote: "62% 已填" },
  { no: "第 2 组", scene: "采购比选", time: "12:41", quote: "采购委员会真正怕的是签完字之后没人负责。", quoteBy: "高琳", template: "旅程图 · 比选阶段", progressPct: 84, progressNote: "84% · POV+HMW 3 条待确认" },
  { no: "第 3 组", scene: "并网审批", time: "12:33", quote: "近 8 分钟只有组长在说话，另两人未发言；话题偏到设备选型。", quoteBy: "Facilitator 观察", template: "共情图 · 素材不足", progressPct: 21, progressNote: "21% · 素材不足", intervene: true, interveneNote: "Facilitator 建议你过去，或推一条提示给组长。" },
  { no: "第 4 组", scene: "收益归因", time: "12:41", quote: "如果收益不达标，谁来赔？这是我们卡了三次的地方。", quoteBy: "刘航", template: "价值主张画布 · 5/9 格", progressPct: 56, progressNote: "已提出 1 个可做原型的概念" },
];

/* ═══════════════════════ 主持台·全场·知识图谱·决策推演（消费 phase-02 F11/F15/F16/F17）═══════════════════════ */

export const LC_MOCK_STAGE_GRAPH = {
  /** [原型] 决策树节点（从主题到可执行的选择） */
  tree: [
    { id: "tn1", title: "2027 前如何进入欧洲工商储", state: "领先", sub: "整场主题根", meta: "问题" },
    { id: "tn2", title: "自建本地实体", state: "已否决", sub: "董事会不接受不可逆承诺", meta: "客户档案 · 组织层" },
    { id: "tn3", title: "与本地 EPC 合作", state: "领先", sub: "工作量少 6 人日", meta: "推演优先" },
    { id: "tn4", title: "收购持证集成商", state: "在议待决", sub: "若资质可转则省 3 个月", meta: "待验证依赖" },
    { id: "tn5", title: "并网资质可随股权转移", state: "冲突", sub: "6 判例支持 / 1 例失效", meta: "致命假设 · 验证中" },
  ] as LcTreeNode[],
  /** [原型] 待决的岔口 · 3 */
  forks: [
    { q: "先验资质，还是先拍板 EPC 合资？", why: "两条边互斥，决定后 4 个待验证节点的开关" },
    { q: "收购标的资质到底能不能随股权转移？", why: "决定收购分支是否保留" },
    { q: "「审批 6–9 个月」与「EPC 可压到 4 个月」哪个成立？", why: "第 2、3 组各挂证据，需现场判一次" },
  ],
  /** [原型] 图谱推演预测卡 —— 如果现在拍板 */
  prediction:
    "选「本地 EPC 合资」会关掉收购分支下的 4 个待验证节点，工作量少 6 人日；但「资质可转」这条如果成立，收购分支能省 3 个月。建议：先验资质，再拍板。",
  /** [原型] 下一步可开展的工作 —— 每条指向树上一个待决节点，点「开展」派给对应模块/小组 */
  nextWork: [
    { ab: "SC", name: "Scout · 深度研究", imp: "高", goal: "补 3 家已完成股权交割的集成商资质是否重新备案的判例", cost: "约 2 人日", who: "AI", node: "并网资质可随股权转移" },
    { ab: "第3", name: "第 3 组 · 现场访谈", imp: "高", goal: "约电网受理厅确认巴伐利亚 vs 北威州审批时长差", cost: "现场 40 分", who: "刘航", node: "审批 6–9 个月" },
    { ab: "第4", name: "第 4 组 · 画布", imp: "中", goal: "把「收益保底 + 归因看板」概念做成可点击原型跟业主对齐", cost: "现场 30 分", who: "陈默 + AI", node: "收益保底能换溢价" },
  ],
};

/* ═══════════════════════ 屏与状态枚举（预览手段）═══════════════════════ */

export const LC_SCREENS = [
  "stage-default",
  "group-graph",
  "group-survey",
  "group-research",
  "group-interview",
  "group-chat",
  "stage-checkin",
  "stage-graph",
  "stage-kanban",
] as const;
export type LcScreen = (typeof LC_SCREENS)[number];

export const LC_SCREEN_LABEL: Record<LcScreen, string> = {
  "stage-default": "主持台 · 全场（默认）",
  "group-graph": "分组 · 本组图谱",
  "group-survey": "分组 · 问卷",
  "group-research": "分组 · 深度研究",
  "group-interview": "分组 · 用户访谈",
  "group-chat": "分组 · 与 AI 的对话",
  "stage-checkin": "主持台 · 分组与签到",
  "stage-graph": "主持台 · 知识图谱 · 决策推演",
  "stage-kanban": "主持台 · 看板",
};

/** 每屏对应 requirements 的哪一节（供 README 溯源） */
export const LC_SCREEN_UC: Record<LcScreen, string> = {
  "stage-default": "01-viewer-role（视角切换器）· 00-overview（环节状态条现场呈现）",
  "group-graph": "03-module-routing（本组图谱模块 · 消费 phase-02 KG）",
  "group-survey": "03-module-routing（问卷模块路由 · phase-09）",
  "group-research": "03-module-routing（深度研究模块路由 · phase-06）",
  "group-interview": "03-module-routing（用户访谈模块路由 · phase-07）",
  "group-chat": "03-module-routing（与 AI 的对话模块路由 · phase-01 08-chat）",
  "stage-checkin": "02-group-checkin（分组签到 · 本 phase owns）",
  "stage-graph": "03-module-routing（全场三视图 · 知识图谱决策推演 · phase-02 F11/F15/F16/F17）",
  "stage-kanban": "03-module-routing（全场三视图 · 看板 · phase-02 F02 + canvas/recording 引述）",
};

export const LC_STATES = [
  "default",
  "loading",
  "empty",
  "invalid",
  "dep-failed",
  "denied",
  "success",
] as const;
export type LcState = (typeof LC_STATES)[number];

export const LC_STATE_LABEL: Record<LcState, string> = {
  default: "默认",
  loading: "加载",
  empty: "空",
  invalid: "校验失败",
  "dep-failed": "依赖失败",
  denied: "无权限",
  success: "成功",
};

export function resolveLcScreen(raw: string | string[] | undefined): LcScreen {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return LC_SCREENS.includes(v as LcScreen) ? (v as LcScreen) : "stage-default";
}
export function resolveLcState(raw: string | string[] | undefined): LcState {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return LC_STATES.includes(v as LcState) ? (v as LcState) : "default";
}
export function resolveLcRole(raw: string | string[] | undefined): ProjectRole {
  const v = Array.isArray(raw) ? raw[0] : raw;
  const roles: ProjectRole[] = ["facilitator", "groupLead", "member", "observer"];
  return roles.includes(v as ProjectRole) ? (v as ProjectRole) : "facilitator";
}
