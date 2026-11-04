import { orgHomeConfigZhCN } from "./i18n/namespaces/org-home-config";
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
  chat: { href: "/chat", icon: MessagesSquare, label: orgHomeConfigZhCN["action.chat.label"], desc: orgHomeConfigZhCN["action.chat.description"] },
  projects: { href: "/projects", icon: FolderKanban, label: orgHomeConfigZhCN["action.projects.label"], desc: orgHomeConfigZhCN["action.projects.description"] },
  research: { href: "/research", icon: Search, label: orgHomeConfigZhCN["action.research.label"], desc: orgHomeConfigZhCN["action.research.description"] },
  interview: { href: "/itv", icon: Mic, label: orgHomeConfigZhCN["action.interview.label"], desc: orgHomeConfigZhCN["action.interview.description"] },
  survey: { href: "/studio/survey", icon: ClipboardList, label: orgHomeConfigZhCN["action.survey.label"], desc: orgHomeConfigZhCN["action.survey.description"] },
  recording: { href: "/rec", icon: AudioLines, label: orgHomeConfigZhCN["action.recording.label"], desc: orgHomeConfigZhCN["action.recording.description"] },
  design: { href: "/studio/design-workbench", icon: PencilRuler, label: orgHomeConfigZhCN["action.design.label"], desc: orgHomeConfigZhCN["action.design.description"] },
  brain: { href: "/brain", icon: Brain, label: orgHomeConfigZhCN["action.brain.label"], desc: orgHomeConfigZhCN["action.brain.description"] },
  board: { href: "/studio/board", icon: Shapes, label: orgHomeConfigZhCN["action.board.label"], desc: orgHomeConfigZhCN["action.board.description"] },
  tasks: { href: "/tasks", icon: ListTodo, label: orgHomeConfigZhCN["action.tasks.label"], desc: orgHomeConfigZhCN["action.tasks.description"] },
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
  ocean: { label: orgHomeConfigZhCN["homeConfig.preset.ocean"], className: "bg-inverse" },
  forest: { label: orgHomeConfigZhCN["homeConfig.preset.forest"], className: "bg-gradient-to-br from-success to-ai" },
  sunset: { label: orgHomeConfigZhCN["homeConfig.preset.sunset"], className: "bg-gradient-to-br from-warning to-destructive" },
  midnight: { label: orgHomeConfigZhCN["homeConfig.preset.midnight"], className: "bg-gradient-to-br from-inverse to-ai" },
  rose: { label: orgHomeConfigZhCN["homeConfig.preset.rose"], className: "bg-gradient-to-br from-destructive to-ai" },
  slate: { label: orgHomeConfigZhCN["homeConfig.preset.slate"], className: "bg-gradient-to-br from-inverse to-muted-foreground" },
  amber: { label: orgHomeConfigZhCN["homeConfig.preset.amber"], className: "bg-gradient-to-br from-warning to-brand-warm" },
  violet: { label: orgHomeConfigZhCN["homeConfig.preset.violet"], className: "bg-gradient-to-br from-ai to-primary" },
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
