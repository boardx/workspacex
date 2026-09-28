/**
 * 项目工作台的**界面配置**（不是数据）——tab 结构、子导航、四视角的前端权限投影、工作面入口。
 *
 * ⚠ 本文件取代了已删除的 `lib/mock/project.ts`：那份文件把界面配置和一个虚构项目
 *   （「欧洲进入策略 Kickoff」的项目头、洞察库、假设、待办卡片、参与者、AI 权限……）混在一起，
 *   导致所有项目显示同一套假内容。虚构数据已整体删除，各 tab 在没有真实数据来源的地方
 *   显示如实空态；这里只保留与具体项目无关、不会冒充事实的配置。
 * ⚠ 纯数据模块，**不带 `"use client"`**——服务端页面与客户端子组件都要 import。
 * ⚠ 角标 / 子导航计数一律不写死：没有真实计数来源就不显示数字。
 */
import type { LucideIcon } from "lucide-react";
import {
  MessagesSquare, LayoutTemplate, FileText, Mic, ClipboardList, ListTodo, Presentation,
} from "lucide-react";
import type { project } from "@repo/contracts";
import type { z } from "zod";
import { PROJECT_ROLE_LABEL, PROJECT_ROLES, type ProjectRole } from "@/lib/identity";

export { PROJECT_ROLE_LABEL, PROJECT_ROLES };
export type { ProjectRole };

/* ─────────────────────── 工作面清单（概览 tab 底部入口，见 F317） ─────────────────────── */

/**
 * 项目内的工作面入口。`testid` 前缀保留 `project-home-*`（`contracts/project/coverage.md`
 * V1/缺口10 逐字点名 `project-home-surfaces`）。`href: null` = 尚未建的屏，渲染成显式禁用。
 */
export interface ProjectSurface {
  key: string;
  label: string;
  desc: string;
  icon: LucideIcon;
  /** 以 `/` 开头 = 绝对路径；否则相对当前项目（`/projects/<id>/<href>`）*/
  href: string | null;
  /** 未建时说明原因，让人知道是缺口不是 bug */
  pending?: string;
}

export const PROJECT_SURFACES: ProjectSurface[] = [
  { key: "chat", label: "对话", desc: "人与 AI 团队在同一条线程上推进；批准卡在这里等你拍板", icon: MessagesSquare, href: "/chat" },
  { key: "canvas", label: "推演画布", desc: "各组画布、结构性冲突裁决、AI 落笔与回退", icon: LayoutTemplate, href: "canvas" },
  { key: "files", label: "项目文件", desc: "上传原件与系统产出物同处一棵树；删除有级联影响面", icon: FileText, href: "files" },
  { key: "interview", label: "访谈现场", desc: "实时转录、说话人指派、引述打点", icon: Mic, href: "/studio/interview" },
  { key: "survey", label: "问卷与投票", desc: "设计、回收、交叉切分、现场 60 秒投票", icon: ClipboardList, href: "/studio/survey" },
  { key: "tasks", label: "任务", desc: "人和 AI 共用同一种任务对象，责任人始终是人", icon: ListTodo, href: "/tasks" },
  {
    key: "stage", label: "现场大屏", desc: "投屏用的主持视图：环节倒计时、各组进度、广播",
    icon: Presentation, href: null, pending: "尚未建（原型档案第十节「主持台」为移动端形态，桌面大屏未抽取）",
  },
];

/* ─────────────────────── 标签页（= 工作台的「屏」） ─────────────────────── */

export type ProjectTab =
  | "overview" | "research" | "prep" | "live" | "results" | "todo" | "settings";

export const PROJECT_TABS: ProjectTab[] = [
  "overview", "research", "prep", "live", "results", "todo", "settings",
];

/** 主标签定义（顺序、文案）。角标没有真实计数来源，不显示。 */
export const TAB_DEFS: Array<{ key: ProjectTab; label: string }> = [
  { key: "overview", label: "概览" },
  { key: "research", label: "研究洞察" },
  { key: "prep", label: "项目筹备" },
  { key: "live", label: "现场协作" },
  { key: "results", label: "成果沉淀" },
  { key: "todo", label: "待办" },
  { key: "settings", label: "设置" },
];

export function resolveProjectTab(raw: string | string[] | undefined): ProjectTab {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return PROJECT_TABS.includes(v as ProjectTab) ? (v as ProjectTab) : "overview";
}

/** 容器种类（契约 `ProjectKind` 三值）；`null` = 还没读到。 */
export type ProjectContainerKind = z.infer<typeof project.ProjectKind>;

/**
 * #4584：只属工作坊的屏——「项目筹备」（定题分组 / 议程 / 会前任务）、「现场协作」（主持台 / 分组并行）、
 * 「待办」（按分组可见的看板）。它们背后的机制（议程环节、分组、`project_memberships`）对研究项目 /
 * 用户洞察两类容器在数据库层就不存在（F128 复合外键），服务端也按容器白名单关着；
 * 对这两类容器不给入口，而不是给一个点进去必 403 的 tab。
 */
export const WORKSHOP_ONLY_TABS: readonly ProjectTab[] = ["prep", "live", "todo"];

/** 该容器种类可见的主标签（顺序同 `TAB_DEFS`）。种类未知时按工作坊渲染，同 `TabSettings` 的处置。 */
export function tabDefsForKind(kind: ProjectContainerKind | null): Array<{ key: ProjectTab; label: string }> {
  if (kind === null || kind === "workshop") return TAB_DEFS;
  return TAB_DEFS.filter((t) => !WORKSHOP_ONLY_TABS.includes(t.key));
}

/** URL 上的 tab 对该容器不可见（例如手敲 `?tab=live`）⇒ 落回概览，不渲染一个工作坊屏。 */
export function resolveTabForKind(tab: ProjectTab, kind: ProjectContainerKind | null): ProjectTab {
  return tabDefsForKind(kind).some((t) => t.key === tab) ? tab : "overview";
}

/** 带左侧上下文子导航的标签（研究洞察 / 项目筹备 / 成果沉淀）。不带计数。 */
export const SUB_NAV: Partial<Record<ProjectTab, { section: string; items: Array<{ key: string; label: string }> }>> = {
  research: {
    section: "研究洞察",
    items: [
      { key: "overview", label: "研究总览" },
      { key: "conv", label: "对话" },
      { key: "survey", label: "问卷" },
      { key: "itv", label: "用户洞察" },
      { key: "research", label: "深度研究" },
      { key: "transcript", label: "录音转写" },
      { key: "sources", label: "来源" },
    ],
  },
  prep: {
    section: "项目筹备",
    items: [
      { key: "scope", label: "定题与分组" },
      { key: "agenda", label: "议程" },
      { key: "material", label: "材料准备" },
      { key: "homework", label: "会前任务" },
    ],
  },
  results: {
    section: "成果沉淀",
    items: [
      { key: "report", label: "洞察报告" },
      { key: "decision", label: "结论与决策" },
      { key: "deliverable", label: "产出物" },
      { key: "action", label: "行动项" },
      { key: "audit", label: "审计与反馈" },
    ],
  },
};

export const TAB_LABEL: Record<ProjectTab, string> = Object.fromEntries(
  TAB_DEFS.map((t) => [t.key, t.label]),
) as Record<ProjectTab, string>;

/* ─────────────────────── 视角（= 项目角色，四种）的前端投影 ─────────────────────── */

/** 四视角说明条文案（UC-1.4 / X-1）：观察者能看到的显著更少。 */
export const ROLE_SCOPE_NOTE: Record<ProjectRole, string> = {
  facilitator: "同一个界面，你有全部权限：各组对话、原始转写、切环节与介入。",
  groupLead: "同一个界面，你能看本组的全部对话与组员私聊，能提交本组产出；别组内容与全场控制不可见。",
  member: "同一个界面，你能看本组的共享内容与自己的对话；别组内容、组员私聊与全场控制不可见。",
  observer: "同一个界面，只读：已发布产出与脱敏聚合可见；原始转写、私聊、内部协作视图与任何操作按钮都关掉了。",
};

/** 观察者只读——canWrite=false 时隐藏所有操作按钮（前端投影，真实权限在服务端 RLS）*/
export const ROLE_CAN_WRITE: Record<ProjectRole, boolean> = {
  facilitator: true, groupLead: true, member: true, observer: false,
};

/**
 * 全场控制（切环节 / +5 分钟 / 介入 / 发布结论）**只有引导师**。
 * 组长能提交本组、看本组全部；组员只读本组共享；观察者什么控制都没有。
 */
export const ROLE_STAGE_CONTROL: Record<ProjectRole, boolean> = {
  facilitator: true, groupLead: false, member: false, observer: false,
};

/**
 * 「提交本组产出」——引导师**与组长**，组员/观察者不可（F961）。
 *
 * ⚠ 这是后端 `domain/identity/project-role-matrix.ts` 里 `group.submitOutput` 那一条的
 *   前端投影，**不是**一份平行判据；与 `ROLE_STAGE_CONTROL`（引导师 only）取值不同，
 *   用错会造成「组长看得见按钮、点了被后端拒」或「组长有权限却看不到入口」。
 *   漂移由 `apps/web/tests/ui/project-prep-interview-subjects.test.tsx` 的角色断言兜住。
 */
export const ROLE_GROUP_SUBMIT: Record<ProjectRole, boolean> = {
  facilitator: true, groupLead: true, member: false, observer: false,
};

/**
 * 观察者对「内部协作视图」（当前环节分工 / 待办看板明细 / 分组名单 / 设置配置区 / 原始洞察库）
 * 一律**看不到**（内容消失，不是变灰）。用它统一驱动各 tab 的观察者裁剪。
 */
export function observerHidden(view: ProjectRole): boolean {
  return view === "observer";
}

/** 视角徽标底色语义 token */
export type ProjectBadgeTone = "neutral" | "primary" | "ai" | "warning" | "outline";
export const ROLE_BADGE_TONE: Record<ProjectRole, ProjectBadgeTone> = {
  facilitator: "neutral", groupLead: "warning", member: "ai", observer: "outline",
};

/* ─────────────────────── 组织停用的只读呈现（uc-00-1 V12） ─────────────────────── */

/** 组织停用后项目的只读呈现：**显示只读原因而非隐藏**。组织名来自真实数据，拿不到就不写名字。 */
export function orgDisabledBanner(orgName: string | null): { title: string; reason: string; hint: string } {
  return {
    title: orgName ? `所属组织「${orgName}」已被停用` : "所属组织已被停用",
    reason: "组织管理员或平台已停用该组织。项目内容全部保留、暂时转为只读；组织恢复后自动解除，无需重建。",
    hint: "只读期间可查看已有产出、审计与历史，但不能编辑、提交、发布、切换环节或邀请。",
  };
}

/* ─────────────────────── 新建项目向导的静态选项 ─────────────────────── */

/**
 * 新建项目向导的**选项文案**（不是默认值）。原来的虚构默认值（项目名、日期、人数、
 * 关联研究来源）已删除：`createProject.in` 收不到这些字段，向导里只读展示「未设置」。
 */
export const NEW_PROJECT_OPTIONS = {
  scratchOptions: [
    { id: "scratch", title: "从空白开始", desc: "自己排环节，没有骨架约束" },
    { id: "copy", title: "复制一场已办的", desc: "连议程、画布绑定、AI 配置一起复制" },
  ],
  blueprintNote: "蓝本必须先选：它决定环节骨架、每个环节绑哪张画布、AI 有什么权限。选完后面三步只是把骨架伸缩成这一场的议程。",
  durationTiers: [
    { id: "90m", label: "90 分钟", dashed: false },
    { id: "half", label: "半天 · 3.5h", dashed: false },
    { id: "full", label: "全天", dashed: false },
    { id: "custom", label: "自定义", dashed: true },
  ],
  linkedSources: {
    label: "关联研究来源（可选 · 决定能读哪些洞察与图谱）",
    placeholder: "不引用任何研究来源",
    note: "把一个「研究项目 / 用户洞察」容器作为只读来源引用进来，工作坊便能读到它的洞察与图谱。这是跨容器引用，不是父子归属 —— Q-12 裁定三类独立容器（C+D），父子模型（E）未采纳。",
  },
} as const;

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
