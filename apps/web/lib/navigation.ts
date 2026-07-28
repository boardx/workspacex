import type { LucideIcon } from "lucide-react";
import {
  MessagesSquare, FolderKanban, Search, Mic, ClipboardList, LayoutTemplate,
  Brain, ListTodo, Settings2, FileText,
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
 * ⚠ 这是**已确认的产品心智**，不要另起一套（UC-0.4 R4 A1）。
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
      { key: "chat", label: "对话", href: "/chat", icon: MessagesSquare, ucRefs: ["08-chat/uc-8-1", "08-chat/uc-8-2"] },
    ],
  },
  {
    label: "编排",
    items: [
      { key: "projects", label: "项目", href: "/projects", icon: FolderKanban, ucRefs: ["02-tpl/uc-2-2", "01-auth/uc-1-4"] },
    ],
  },
  {
    label: "STUDIO",
    items: [
      { key: "research", label: "研究", href: "/studio/research", icon: Search, ucRefs: ["00-core/uc-0-2"] },
      { key: "interview", label: "访谈", href: "/studio/interview", icon: Mic, ucRefs: ["06-itv/uc-6-1", "05-rec/uc-5-1"] },
      { key: "survey", label: "问卷", href: "/studio/survey", icon: ClipboardList, ucRefs: ["12-survey/uc-12-1"] },
      { key: "prototype", label: "原型", href: "/studio/prototype", icon: LayoutTemplate, ucRefs: ["07-canvas/uc-7-1"] },
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
      { key: "admin", label: "后台", href: "/admin", icon: Settings2, ucRefs: ["17-gov/uc-17-1", "20-model/uc-20-1", "21-mcp/uc-21-1"] },
    ],
  },
];

/** 项目文件浏览器（22-files）—— file-first 原则的用户界面载体，挂在项目下 */
export const FILES_NAV: NavItem = {
  key: "files", label: "文件", href: "/projects/demo/files", icon: FileText,
  ucRefs: ["22-files/uc-22-1", "22-files/uc-22-2", "22-files/uc-22-3", "22-files/uc-22-4"],
};

export const ALL_NAV_ITEMS: NavItem[] = [...NAV_SEGMENTS.flatMap((s) => s.items), FILES_NAV];
