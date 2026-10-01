/**
 * 首页配置的「目录」——入口与横幅预设的**单一事实源**，首页
 * （`components/home/*`）与后台配置屏（`components/org-admin/home-config-*`）共用。
 * 键集合来自契约 `homeConfig.QuickActionKey` / `BannerPreset`：`Record<Key, …>` 漏一个
 * 编译不过，契约加键而这里没跟会当场变成 TS 错误，而不是悄悄少一个入口。
 */
import {
  AudioLines, Brain, ClipboardList, FolderKanban, ListTodo, MessagesSquare, Mic, PencilRuler, Search, Shapes,
  type LucideIcon,
} from "lucide-react";
import type { BannerPreset, QuickActionKey } from "./live-home-config";

export interface QuickActionMeta {
  readonly href: string;
  readonly icon: LucideIcon;
  readonly label: string;
  readonly desc: string;
}

/** href 与 `lib/navigation.ts` 的一级入口逐个对应（`lint-nav-reachability` 守着导航侧）。 */
export const QUICK_ACTION_CATALOG: Record<QuickActionKey, QuickActionMeta> = {
  chat: { href: "/chat", icon: MessagesSquare, label: "聊天", desc: "开始一次新的对话" },
  projects: { href: "/projects", icon: FolderKanban, label: "项目", desc: "按项目组织的工作台" },
  research: { href: "/research", icon: Search, label: "深度研究", desc: "多来源调研与报告" },
  interview: { href: "/itv", icon: Mic, label: "用户访谈", desc: "访谈设计、执行与洞察" },
  survey: { href: "/studio/survey", icon: ClipboardList, label: "问卷", desc: "设计、发布与回收问卷" },
  recording: { href: "/rec", icon: AudioLines, label: "录音", desc: "实时转写与会议记录" },
  design: { href: "/studio/design-workbench", icon: PencilRuler, label: "设计", desc: "设计方案与原型" },
  brain: { href: "/brain", icon: Brain, label: "大脑", desc: "你的组织记忆" },
  board: { href: "/studio/board", icon: Shapes, label: "Board", desc: "白板与协作" },
  tasks: { href: "/tasks", icon: ListTodo, label: "任务", desc: "我的任务与待办" },
};

/** 后台展示顺序（也是新建配置时入口 `order` 的依据）。 */
export const QUICK_ACTION_ORDER: readonly QuickActionKey[] = [
  "chat", "projects", "research", "interview", "survey", "recording", "design", "brain", "board", "tasks",
];

export interface BannerPresetMeta {
  readonly label: string;
  /** 背景（只用设计 token；不出现裸色值）。文字一律 `text-inverse-foreground`。 */
  readonly className: string;
}

export const BANNER_PRESET_CATALOG: Record<Exclude<BannerPreset, "custom">, BannerPresetMeta> = {
  ocean: { label: "海洋", className: "bg-inverse" },
  forest: { label: "森林", className: "bg-gradient-to-br from-success to-ai" },
  sunset: { label: "日落", className: "bg-gradient-to-br from-warning to-destructive" },
  midnight: { label: "午夜", className: "bg-gradient-to-br from-inverse to-ai" },
  rose: { label: "玫瑰", className: "bg-gradient-to-br from-destructive to-ai" },
  slate: { label: "石板", className: "bg-gradient-to-br from-inverse to-muted-foreground" },
  amber: { label: "琥珀", className: "bg-gradient-to-br from-warning to-brand-warm" },
  violet: { label: "紫罗兰", className: "bg-gradient-to-br from-ai to-primary" },
};

export const BANNER_PRESET_ORDER: readonly Exclude<BannerPreset, "custom">[] = [
  "ocean", "forest", "sunset", "midnight", "rose", "slate", "amber", "violet",
];

const HEX6 = /^#[0-9a-fA-F]{6}$/;

/** 与契约 `BannerColor` 同一条规则（`#RRGGBB`）；这里只给输入框做即时校验，服务端仍是权威。 */
export function isValidBannerColor(value: string): boolean {
  return HEX6.test(value);
}

/** WCAG 相对亮度（sRGB → 线性）。 */
function relativeLuminance(hex: string): number {
  const channel = (i: number): number => {
    const v = parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(0) + 0.7152 * channel(1) + 0.0722 * channel(2);
}

/**
 * 自定义底色上该用浅字还是深字。取对比度更高的一边（与白/黑的对比度比较）——
 * 用户填 `#FFFF00` 不该得到白字，填 `#101010` 不该得到黑字。
 */
export function readableTextOn(hex: string): "light" | "dark" {
  const l = relativeLuminance(hex);
  const contrastWithWhite = 1.05 / (l + 0.05);
  const contrastWithBlack = (l + 0.05) / 0.05;
  return contrastWithWhite >= contrastWithBlack ? "light" : "dark";
}
