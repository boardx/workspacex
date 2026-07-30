import type { LucideIcon } from "lucide-react";
import {
  MessagesSquare, FolderKanban, Search, Mic, ClipboardList, LayoutTemplate,
  Brain, ListTodo, Settings2, FileText, AudioLines, Shapes, Puzzle, Bot, Users, Boxes,
} from "lucide-react";

/**
 * 左侧五段语义导航 —— 结构与分组来自对运行态原型的实测
 * （`WorkspaceX Standalone.html` 图标栏 76px 那列，逐项取 innerText 与 y 坐标）：
 *
 *   y=62  对话                    ← 无分组标签，单独居顶
 *   y=123 编排(标签) → y=148 项目
 *   y=199 STUDIO(标签) → 研究 224 / 访谈 275 / 问卷 326 / 原型 377
 *   y=428 能力(标签) → 大脑 453 / 任务 504
 *   y=555 治理(标签) → 后台 580
 *
 * 间距规律：同组项 51px 一档，分组标签在其首项上方 25px。
 * ⚠ 这是**已确认的产品心智**，五段分组与顺序不动（UC-0.4 R4 A1）。
 *
 * ────────────────────────────────────────────────────────────────────────────
 * 2026-07-30 接线修正（ADR-023 签核材料必须活在产品里）：
 *   病：十一个契约束（ui-material-map.json 声明）的**现行 v2 屏**全部只能敲 URL 进——
 *   导航连的是另一套更旧的骨架屏（/studio/interview、/studio/prototype…），
 *   三个独立 agent 各自撞上同一根：「评审签的和用户用的不是同一个产品」。
 *   （证据：全仓 grep 指向 /tpl /skill /rec /itv /canvas 的内部跳转曾 = 0 条。）
 *
 *   修：在**不动五段分组**的前提下，把十一束的现行路由都挂进导航——
 *     · 重指（不改 label/icon，像素不变）：访谈 /studio/interview → /itv；
 *       画布（旧「原型」）/studio/prototype → /canvas。
 *     · 新增：蓝本 /tpl（编排）、录音 /rec（STUDIO）、
 *            技能 /skill、智能体 /preview/agent-runtime、成员 /org-admin/preview、
 *            资产 /asset-governance（治理）。
 *     · 旧 /studio/interview、/studio/prototype 已退役为重定向（见各自 page.tsx）。
 *
 *   这条「导航树 ↔ 契约束现行路由」的对应关系由机械门控守护：
 *   `.harness/scripts/lint-nav-reachability.mjs`（双向：束route 必在导航中 ∧
 *    导航 route 必属某束或在显式白名单）。改这里必须同步跑它，否则会红。
 * ────────────────────────────────────────────────────────────────────────────
 */
export interface NavItem {
  key: string;
  label: string;
  href: string;
  icon: LucideIcon;
  /** 该入口对应哪些 UC —— 供 ui-prototyper 与 sign-off 时回溯 */
  ucRefs: string[];
}

export interface NavSegment {
  /** 分组标签；null = 无标签（顶部的「对话」）*/
  label: string | null;
  items: NavItem[];
}

export const NAV_SEGMENTS: NavSegment[] = [
  {
    label: null,
    items: [
      // 束: chat
      { key: "chat", label: "对话", href: "/chat", icon: MessagesSquare, ucRefs: ["08-chat/uc-8-1", "08-chat/uc-8-2"] },
    ],
  },
  {
    label: "编排",
    items: [
      // 束: project（列表 /projects → 工作台 /project）
      { key: "projects", label: "项目", href: "/projects", icon: FolderKanban, ucRefs: ["00-project/uc-0-2", "02-tpl/uc-2-2"] },
      // 束: templates（蓝本设计器 / 套用 / 版本）——原型里蓝本属编排能力，此前无入口
      { key: "templates", label: "蓝本", href: "/tpl", icon: LayoutTemplate, ucRefs: ["02-tpl/uc-2-1", "02-tpl/uc-2-4"] },
    ],
  },
  {
    label: "STUDIO",
    items: [
      { key: "research", label: "研究", href: "/studio/research", icon: Search, ucRefs: ["00-core/uc-0-2"] },
      // 束: interview —— 重指到 v2 现行屏 /itv（label/icon 不变，像素不变；旧 /studio/interview 已重定向）
      { key: "interview", label: "访谈", href: "/itv", icon: Mic, ucRefs: ["06-itv/uc-6-1", "06-itv/uc-6-3"] },
      // 束: recording —— 现场录音转写，此前只能敲 /rec
      { key: "recording", label: "录音", href: "/rec", icon: AudioLines, ucRefs: ["05-rec/uc-5-1", "05-rec/uc-5-2"] },
      { key: "survey", label: "问卷", href: "/studio/survey", icon: ClipboardList, ucRefs: ["12-survey/uc-12-1"] },
      // 束: canvas —— 旧「原型」骨架屏（单栏 825px）退役，重指到三栏推演画布 /canvas
      { key: "canvas", label: "画布", href: "/canvas", icon: Shapes, ucRefs: ["07-canvas/uc-7-1", "07-canvas/uc-7-3"] },
    ],
  },
  {
    label: "能力",
    items: [
      { key: "brain", label: "大脑", href: "/brain", icon: Brain, ucRefs: ["14-brain/uc-14-6"] },
      { key: "tasks", label: "任务", href: "/tasks", icon: ListTodo, ucRefs: ["11-board/uc-11-1"] },
    ],
  },
  {
    label: "治理",
    items: [
      { key: "admin", label: "后台", href: "/admin", icon: Settings2, ucRefs: ["17-gov/uc-17-1"] },
      // 束: skills（Skill 库与市场 / 发布六道关 / 绑定）
      { key: "skills", label: "技能", href: "/skill", icon: Puzzle, ucRefs: ["03-skill/uc-3-1", "03-skill/uc-3-4"] },
      // 束: agent-runtime（注册 agent → 选模型 → 挂 MCP 工具，三 area 合一）
      { key: "agent-runtime", label: "智能体", href: "/preview/agent-runtime", icon: Bot, ucRefs: ["04-agent/uc-4-1", "20-model/uc-20-1", "21-mcp/uc-21-1"] },
      // 束: org-admin（参与者 / 邀请 / 配额）
      { key: "org-admin", label: "成员", href: "/org-admin/preview", icon: Users, ucRefs: ["01-auth/uc-1-4"] },
      // 束: asset-governance（外来资产导入与生命周期治理，第 11 束）
      { key: "asset-governance", label: "资产", href: "/asset-governance", icon: Boxes, ucRefs: ["23-asset/uc-23-1"] },
    ],
  },
];

/** 项目文件浏览器（22-files）—— file-first 原则的用户界面载体，挂在项目下 */
export const FILES_NAV: NavItem = {
  key: "files", label: "文件", href: "/projects/demo/files", icon: FileText,
  ucRefs: ["22-files/uc-22-1", "22-files/uc-22-2", "22-files/uc-22-3", "22-files/uc-22-4"],
};

export const ALL_NAV_ITEMS: NavItem[] = [...NAV_SEGMENTS.flatMap((s) => s.items), FILES_NAV];
