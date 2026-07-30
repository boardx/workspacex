/**
 * Mock 数据 —— 项目列表（UC-2.2）与推演画布（UC-7.3）两屏。
 *
 * ⚠ 纯数据 + 类型，**刻意不带 `"use client"`**，服务端/客户端都能 import。
 * 密度照 `phases/phase-01-run-a-project/ui-preview/PROTOTYPE-DIGEST.md` 第三、四节的实测表做：
 * 四种项目状态的字段完整度差异很大，这正是 sign-off 要看的东西。
 * 数字为原型示例蓝本的取值，非硬编码业务口径。
 */
import type { z } from "zod";
import * as C from "@repo/contracts/canvas";

/* ─────────────────────────── 项目列表（UC-2.2 R8 / 数字三节） ─────────────────────────── */

/**
 * [原型] 项目**卡片展示态**四取值，不得自造第五态。
 *
 * ⚠ 原名 `ProjectStatus` —— 与契约 `project.ProjectStatus` **同名不同义**，
 * 被 `lint-contract-source` 当场拦下（2026-07-30）。契约那个是**生命周期**
 * `["active","archived"]`（Q-5 裁 B，两态、有状态机）；这个是列表卡片上的
 * **展示态**（正在进行/筹备中/草稿/已交付），两者不是一回事：
 * 一个已交付的项目仍然是 `active`。
 *
 * 与 `IngestionRun` 的 `status` vs `state`、`VisibilityScope` vs `ChatVisibility`
 * 是同一类，处理方式沿用那两次立的纪律：**同名会掩盖分歧，改名而不是合并**。
 * ⇒ 改名 `ProjectCardState`。若日后产品裁定两者应统一，那是一次签核动作，不是一次改名。
 */
export type ProjectCardState = "running" | "preparing" | "draft" | "delivered";

export const PROJECT_CARD_STATE_LABEL: Record<ProjectCardState, string> = {
  running: "正在进行",
  preparing: "筹备中",
  draft: "草稿",
  delivered: "已交付",
};

export interface ProjectSummary {
  /** 稳定标识（testid 用，不含业务数据）*/
  id: string;
  name: string;
  /** 归属：客户 / 内部（对应筛选器）*/
  owner: "客户" | "内部";
  /** 是否高优先级（对应「高优先级」筛选）*/
  priority: boolean;
  /** 时间行，如「今天 14:00–17:30」「周四 14:00」「上周五」*/
  schedule: string;
  status: ProjectCardState;

  /** ● 正在进行 专有：环节进度 / 在场人数 / 组数 */
  stageProgress?: string; // 环节 3/7
  attendance?: string; // 12 人在场
  groups?: string; // 4 组
  /** 蓝本名与版本快照（R7：一经绑定不随蓝本发布漂移）*/
  blueprint?: string; // 蓝本 HMW 定题 v4

  /** 筹备中 / 草稿 专有：准备度百分比（R8 必显）*/
  readiness?: number; // 68
  confirmed?: string; // 9/12 已确认
  inviteState?: string; // 未邀请

  /** 已交付 专有 */
  delivery?: string; // 报告已交付
  decisions?: string; // 决策 6
  promoted?: string; // 晋升 2
}

/** 6 个项目：覆盖四种状态，字段完整度刻意拉开差异（原型第三节表）*/
export const MOCK_PROJECTS: ProjectSummary[] = [
  {
    id: "p1",
    name: "欧洲储能进入策略",
    owner: "客户",
    priority: true,
    schedule: "今天 14:00–17:30",
    status: "running",
    stageProgress: "环节 3/7",
    attendance: "12 人在场",
    groups: "4 组",
    blueprint: "蓝本 HMW 定题 v4",
  },
  {
    id: "p2",
    name: "德国工商储渠道共建",
    owner: "客户",
    priority: false,
    schedule: "周四 14:00",
    status: "preparing",
    readiness: 68,
    confirmed: "9/12 已确认",
    groups: "3 组",
    blueprint: "蓝本 商业模式共创 v3",
  },
  {
    id: "p3",
    name: "内部 · 售后网络假设风暴",
    owner: "内部",
    priority: false,
    schedule: "下周二 09:30",
    status: "draft",
    readiness: 15,
    inviteState: "未邀请",
    blueprint: "蓝本 假设风暴（快版）",
  },
  {
    id: "p4",
    name: "内部 · Q2 组织效能复盘",
    owner: "内部",
    priority: false,
    schedule: "上周五",
    status: "delivered",
    delivery: "报告已交付",
    decisions: "决策 6",
    promoted: "晋升 2",
  },
  {
    id: "p5",
    name: "北美工商储渠道尽调",
    owner: "客户",
    priority: true,
    schedule: "明天 09:00–12:00",
    status: "running",
    stageProgress: "环节 1/5",
    attendance: "8 人在场",
    groups: "3 组",
    blueprint: "蓝本 客户旅程共创 v2",
  },
  {
    id: "p6",
    name: "供应链韧性策略共创",
    owner: "客户",
    priority: false,
    schedule: "上上周三",
    status: "delivered",
    delivery: "报告已交付",
    decisions: "决策 4",
    promoted: "晋升 1",
  },
];

export type ProjectFilterKey = "all" | "client" | "internal" | "priority" | "archived";

export const PROJECT_FILTERS: { key: ProjectFilterKey; label: string }[] = [
  { key: "all", label: "全部" },
  { key: "client", label: "客户" },
  { key: "internal", label: "内部" },
  { key: "priority", label: "高优先级" },
  { key: "archived", label: "已归档" },
];

export function filterProjects(list: ProjectSummary[], key: ProjectFilterKey): ProjectSummary[] {
  switch (key) {
    case "client":
      return list.filter((p) => p.owner === "客户");
    case "internal":
      return list.filter((p) => p.owner === "内部");
    case "priority":
      return list.filter((p) => p.priority);
    case "archived":
      // 归档项目不在活动列表内（原型：归档只影响「还能不能新建」）——刻意为空，用来展示筛选内空态
      return [];
    default:
      return list;
  }
}

/** 「历史项目仍被引用」区（原型第三节底部）*/
export interface HistoricalProject {
  id: string;
  name: string;
  meta: string; // 决策 9 · 被引用 14 次
}

export const MOCK_HISTORICAL: HistoricalProject[] = [
  { id: "h1", name: "长三角储能配储政策研判", meta: "决策 9 · 被引用 14 次" },
  { id: "h2", name: "海外 EPC 合作模式评估", meta: "决策 4 · 横向借用 3 次" },
];

/* ─────────────────────────── 推演画布（UC-7.3 R8 / 数字四节） ─────────────────────────── */

/**
 * [原型] 组画布状态四取值（O-32：「落后」= 有必填分区为空）
 * ⚠ 与契约 `canvas.GroupCanvasStatus` **逐值相同**（只是列举顺序不同）
 * ⇒ 从契约派生，不留第二份（ADR-020）。
 */
export type GroupCanvasStatus = z.infer<typeof C.GroupCanvasStatus>;
/** [原型] 同步三态。⚠ 与契约 `canvas.CanvasSyncStatus` **逐值相同** ⇒ 从契约派生。 */
export type CanvasSyncStatus = z.infer<typeof C.CanvasSyncStatus>;

export interface GroupCanvas {
  id: string;
  title: string;
  template: string; // hmw / empathy-map …
  stickies: number;
  status: GroupCanvasStatus;
}

/** 「本环节 · 各组画布 · 4 组」——四行状态各不同（原型四节左栏）*/
export const MOCK_GROUP_CANVASES: GroupCanvas[] = [
  { id: "g1", title: "第 1 组 · 谁在买储能", template: "hmw", stickies: 9, status: "进行中" },
  { id: "g3", title: "第 3 组 · 采购决策链", template: "empathy-map", stickies: 12, status: "只读" },
  { id: "g4", title: "第 4 组 · 安装商画像", template: "empathy-map", stickies: 4, status: "落后" },
  { id: "g2", title: "第 2 组 · 采购比选旅程", template: "journey-procurement", stickies: 6, status: "你在这组" },
];

export interface ProjectCanvas {
  id: string;
  title: string;
  summary: string; // flowchart LR · 17 节点 / 模板: persona · 24 便签
  sync: CanvasSyncStatus;
}

/** 「本项目画布 · 3 · 1 待同步」（原型四节左栏）*/
export const MOCK_PROJECT_CANVASES: ProjectCanvas[] = [
  { id: "pc1", title: "进入模式假设树 v3", summary: "flowchart LR · 17 节点", sync: "已同步" },
  { id: "pc2", title: "德国业主用户画像", summary: "模板: persona · 24 便签", sync: "画布领先" },
  { id: "pc3", title: "商业模式画布 · 路径 B", summary: "模板: business-model · 9 格", sync: "待同步" },
];

export interface BoundSkill {
  id: string;
  label: string; // 提取假设 → 假设树
  action: "运行" | "已开";
}

/** 「本环节绑定的 skill」两条（原型四节左栏）*/
export const MOCK_BOUND_SKILLS: BoundSkill[] = [
  { id: "sk1", label: "提取假设 → 假设树", action: "运行" },
  { id: "sk2", label: "语音转便签", action: "已开" },
];

/** 画布分区框（模板 `##` 段落对应的几何框）——便签按几何归区导出到对应段落 */
export interface CanvasSection {
  id: string;
  label: string; // 导出成 ## <label>
  /** 相对定位（百分比），仅用于 mock 静态呈现，非真实布局引擎 */
  x: number;
  y: number;
  w: number;
  h: number;
  required: boolean;
}

export const MOCK_SECTIONS: CanvasSection[] = [
  { id: "sec-people", label: "谁", x: 3, y: 8, w: 30, h: 82, required: true },
  { id: "sec-pain", label: "痛点", x: 35, y: 8, w: 30, h: 82, required: true },
  { id: "sec-hmw", label: "我们可以怎样", x: 67, y: 8, w: 30, h: 82, required: true },
];

export interface CanvasSticky {
  id: string;
  text: string;
  sectionId: string;
  /** 相对定位百分比（mock）*/
  x: number;
  y: number;
  author: string; // 缩写
  /** AI 落笔的便签带 AVA 角标 */
  byAi?: boolean;
}

export const MOCK_STICKIES: CanvasSticky[] = [
  { id: "s1", text: "工商业园区业主：自投自用", sectionId: "sec-people", x: 5, y: 16, author: "高" },
  { id: "s2", text: "第三方投资商 EMC 模式", sectionId: "sec-people", x: 6, y: 34, author: "郑" },
  { id: "s3", text: "回本周期看不清，不敢投", sectionId: "sec-pain", x: 37, y: 16, author: "陈" },
  { id: "s4", text: "并网审批流程各州不一", sectionId: "sec-pain", x: 38, y: 40, author: "高" },
  { id: "s5", text: "怎样把回本测算做进销售话术", sectionId: "sec-hmw", x: 69, y: 18, author: "AV", byAi: true },
  { id: "s6", text: "怎样用标准化 EMC 合同降门槛", sectionId: "sec-hmw", x: 70, y: 40, author: "AV", byAi: true },
];

/** 两个「节点」+ 一条「连线」——证明工具条 ＋节点 / 连线 可用（静态 mock，不接渲染引擎）*/
export interface CanvasNode {
  id: string;
  label: string;
  x: number;
  y: number;
}
export const MOCK_NODES: CanvasNode[] = [
  { id: "n1", label: "致命假设：EMC 可复制", x: 40, y: 66 },
  { id: "n2", label: "验证：3 个园区试点", x: 72, y: 66 },
];
export interface CanvasEdge {
  id: string;
  from: string;
  to: string;
  label: string;
  byAi?: boolean;
}
export const MOCK_EDGES: CanvasEdge[] = [
  { id: "e1", from: "n1", to: "n2", label: "需验证", byAi: true },
];

/** 「AI 在这张画布上」（原型四节右栏 · D-10）*/
export interface AiChange {
  id: string;
  kind: "sticky" | "edge";
  /** 归到哪个 ## 段落 / 哪条连线 */
  where: string;
  detail: string;
}

/** 「看改动」展开的逐条 AVA 落笔明细（3 便签 + 1 连线标签，与计数一致）*/
export const AI_CHANGES: AiChange[] = [
  { id: "ac1", kind: "sticky", where: "## 我们可以怎样", detail: "＋便签「怎样把回本测算做进销售话术」" },
  { id: "ac2", kind: "sticky", where: "## 我们可以怎样", detail: "＋便签「怎样用标准化 EMC 合同降门槛」" },
  { id: "ac3", kind: "sticky", where: "## 痛点", detail: "＋便签「并网审批各州不一，工期难承诺」" },
  { id: "ac4", kind: "edge", where: "n1 → n2", detail: "连线标签改为「需验证」（原「关联」）" },
];

export const MOCK_AI_ACTIVITY = {
  stickiesAdded: 3,
  edgeLabelsChanged: 1,
  /** D-10：默认「直接落笔」，可切「提交建议待接受」*/
  defaultDirectWrite: true,
};

/** 结构性冲突（D-09）——冲突条要说清「两侧各改了什么」*/
export interface ConflictSide {
  origin: "文档" | "画布";
  by: string;
  at: string;
  changes: string[];
}
export const MOCK_CONFLICT: { doc: ConflictSide; canvas: ConflictSide } = {
  doc: {
    origin: "文档",
    by: "周珂（源码视图）",
    at: "14:36",
    changes: [
      "新增分区 `## 竞品` （第 4 个 ## 段落）",
      "删除节点「验证：3 个园区试点」",
    ],
  },
  canvas: {
    origin: "画布",
    by: "高琳（画布拖拽）",
    at: "14:37",
    changes: [
      "把「我们可以怎样」重命名为「机会点」",
      "新增连线 致命假设 → 竞品对标（重连）",
    ],
  },
};
