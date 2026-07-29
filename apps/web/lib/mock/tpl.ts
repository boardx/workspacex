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

/** 时长档位（templates/domain.md I-20：内建四档封闭，自定义档位另立 custom）*/
export type DurationTier = "half-day" | "one-day" | "two-day" | "three-day";
export const DURATION_TIERS: DurationTier[] = ["half-day", "one-day", "two-day", "three-day"];
export const TIER_LABEL: Record<DurationTier, string> = {
  "half-day": "半天", "one-day": "一天", "two-day": "两天", "three-day": "三天",
};
/** 议程环节数 = 档位的函数（templates/domain.md I-15；uc-2-1 AC4a：7/11/14/19）*/
export const AGENDA_COUNT_BY_TIER: Record<DurationTier, number> = {
  "half-day": 7, "one-day": 11, "two-day": 14, "three-day": 19,
};
export const TIER_HALF_SESSIONS: Record<DurationTier, string> = {
  "half-day": "1 个半场", "one-day": "2 个半场", "two-day": "4 个半场", "three-day": "6 个半场",
};
export const DEFAULT_TIER: DurationTier = "two-day"; // 原型默认「两天」

/** 五组封闭枚举（templates/domain.md I-20 / ConfigItemDefinition.group）*/
export type ConfigGroup = "basic" | "pre-input" | "onsite" | "ai" | "output";
export const CONFIG_GROUPS: { key: ConfigGroup; label: string }[] = [
  { key: "basic", label: "基本配置" },
  { key: "pre-input", label: "会前输入" },
  { key: "onsite", label: "现场" },
  { key: "ai", label: "AI 能力" },
  { key: "output", label: "产出" },
];

export interface ConfigItem {
  /** 稳定 key（config_item_*） */
  key: string;
  group: ConfigGroup;
  label: string;
  /** 发布门槛的唯一驱动（I-6）。⚠ 具体哪几项 required=true 仍待人类给出（缺 D-2） */
  required: boolean;
  /** 该项内容规模的示例计数/摘要（不是议程环节数） */
  count: string;
  /** 是否已配完 —— 完成度派生的来源，不硬编码 */
  done: boolean;
}

/**
 * 配置项定义表 —— **本域最重要的一张表**（O-07 + O-18⑤ 收敛点）。
 * 完成度分母 = 本表条目数（禁止硬编码 16/15）；required 列驱动发布门槛。
 * 已枚举 15 项；第 16 项属「待补抽取」（不阻断，分母恒读表）。
 *
 * ⚠ required 一栏此处只是**占位示例**——真正哪几项必填「清单本身无依据，仍需人类给出」（缺 D-2）。
 * 我把「主题与背景」「流程 Agenda」「分组规则」「角色与权限」「场地与形式」标为 required 只是为了
 * 让「校验失败态」有东西可演示，sign-off 必须把这份清单当作**未定**来看。
 */
export const CONFIG_ITEMS: ConfigItem[] = [
  { key: "topic-and-background", group: "basic", label: "主题与背景", required: true, count: "2 字段", done: true },
  { key: "flow-agenda", group: "basic", label: "流程 Agenda", required: true, count: "14 环节", done: true },
  { key: "grouping-rule", group: "basic", label: "分组规则", required: true, count: "4 组", done: true },
  { key: "roles-and-perms", group: "basic", label: "角色与权限", required: true, count: "4 角色", done: true },
  { key: "survey", group: "pre-input", label: "问卷", required: false, count: "2 份", done: true },
  { key: "interview-and-subjects", group: "pre-input", label: "访谈与对象", required: false, count: "6 场", done: true },
  { key: "pre-tasks", group: "pre-input", label: "会前任务", required: false, count: "3 项", done: false },
  { key: "venue-and-format", group: "onsite", label: "场地与形式", required: true, count: "已配", done: true },
  { key: "project-materials", group: "onsite", label: "项目材料", required: false, count: "9 件", done: true },
  { key: "print-materials", group: "onsite", label: "分组打印素材", required: false, count: "4 件", done: false },
  { key: "group-capabilities", group: "onsite", label: "组内能力", required: false, count: "7 项", done: true },
  { key: "agent-orchestration", group: "ai", label: "Agent 编排", required: false, count: "4 个", done: true },
  { key: "skill-binding", group: "ai", label: "Skill 绑定", required: false, count: "11 个", done: true },
  { key: "outputs", group: "output", label: "输出物", required: false, count: "6 件", done: true },
  { key: "report-template", group: "output", label: "报告模板", required: false, count: "2 份", done: true },
];

/** 分母恒读表（templates/domain.md I-5）。⚠ 界面与断言都用这个函数，不写字面量。 */
export const configTotal = () => CONFIG_ITEMS.length;
export const configDoneCount = (items: ConfigItem[] = CONFIG_ITEMS) => items.filter((i) => i.done).length;
/** 发布门槛判定（I-6）：存在 required 且未完成的项 → 阻断。与「具体哪几项」无关。 */
export const blockingRequiredItems = (items: ConfigItem[] = CONFIG_ITEMS) =>
  items.filter((i) => i.required && !i.done);

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

export type BlueprintState = "published" | "draft";
export interface BlueprintRow {
  id: string;
  name: string;
  state: BlueprintState;
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
    usedCount: 12, satisfaction: { mean: 4.6, sampleSize: 9 }, doneCount: 15, visibility: "org-wide", team: null, appliedByProject: true },
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

export type GroupStatus = "recording-ready" | "short-n" | "needs-intervention";
export const GROUP_STATUS_LABEL: Record<GroupStatus, string> = {
  "recording-ready": "录音就绪", "short-n": "缺 N 人", "needs-intervention": "需介入",
};
export const GROUP_STATUS_TONE: Record<GroupStatus, "primary" | "warning" | "danger"> = {
  "recording-ready": "primary", "short-n": "warning", "needs-intervention": "danger",
};
export interface ProjectGroup {
  ordinal: number;
  name: string;
  status: GroupStatus;
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
  { q: "议程环节的字段名", state: "四个名字打架", note: "phase-00 已落库 stepId / 已实现动作词 stage.*；uc-2-2 同一份文档既写 agenda_stage 又写 agenda_segment_id。第 7 次「同一事实两处」，改哪边都非实现者能定（Q-3）。" },
  { q: "议程环节的实体与状态机", state: "有状态、无集合", note: "『环节可被推进』已签核（stage.advance），『组长切状态 → 三视角首屏切换』依赖它，但状态集合与迁移规则完全没有（Q-2）。矩阵屏的『（当前）』标记是占位。" },
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
  return TPL_SCREENS.includes(v as TplScreen) ? (v as TplScreen) : "designer";
}
