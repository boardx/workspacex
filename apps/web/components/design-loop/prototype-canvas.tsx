"use client";
/**
 * UC-17.8 B5.3 —— 原型画布：把契约 `designPrototype.PrototypeNode` 组件树渲染成手机屏。
 *
 * 只读渲染，没有编辑态——「整页重生成」这一轮的画布由左栏对话驱动，用户改画布的唯一入口
 * 是再说一句话。增量修改（节点级）是下一轮，届时在这里挂选中态。
 *
 * 颜色/圆角/字号全走 `.dark` token（`app/globals.css`），不写字面量——`lint-design.sh` U5/U11 门控。
 * 渲染表按 `PrototypeNodeType` 穷举：契约加了新原语这里编译不过，不会静默渲染成空。
 */
import * as React from "react";
import {
  Check, Circle, ImageIcon, Loader2, Smartphone, Tablet, Monitor, Home, Search, Bell, User, Settings, Square, CheckSquare, Lock,
  // 迭代 16（#3773 R4）：契约 `PrototypeIcon` 闭集的渲染表（下面 `ICONS` 穷举，漏一个编译不过）。
  Menu, MoreHorizontal, SlidersHorizontal, LayoutGrid, List as ListIcon, ArrowLeft, ArrowRight,
  Users, MessageCircle, Send, Share2, Heart, Star, Camera, File, Folder, Bookmark, Tag, Link2,
  Download, Upload, Plus, Pencil, Trash2, X as XIcon, RefreshCw, Play, Pause, Eye,
  ShoppingCart, CreditCard, BarChart3, Calendar, Clock, MapPin, Mail, Phone, Info, AlertTriangle,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { PrototypeLink, PrototypeNode } from "@/lib/live-design-workbench";
import { designPrototype, designWorkbench } from "@repo/contracts";

/**
 * 迭代 2：选中态。`selectedId` 当前选中的节点 id；`onSelect(id | null)` 点节点/点空白。
 * 用 context 而不是逐层传 prop：树是递归渲染的，每一层都要它。
 */
/**
 * 迭代 11（design-delta `prototype-navigation`，待签核）：画布有两种模式。
 * - `edit`（现状）：点节点 = 选中它去改。
 * - `preview`：点**有跳转关系**的节点 = 跳到目标页（`onNavigate(to)`）；没有的节点点了没反应，也**不**选中。
 * `links` 是本页的跳转表，键 `${from}#${item ?? 0}`——多项原语按项、navbar 左 0 右 1、其余恒 0。
 */
export type PrototypeCanvasMode = "edit" | "preview";
export const linkKey = (from: string, item?: number): string => `${from}#${item ?? 0}`;
/** 本页 `links[]` → 查表。只此一处把数组变成 Map，画布与画板连线共用。 */
export function linkMapOf(links: readonly PrototypeLink[] | undefined): ReadonlyMap<string, number> {
  return new Map((links ?? []).map((l) => [linkKey(l.from, l.item), l.to]));
}

const SelectionCtx = React.createContext<{
  selectedId: string | null;
  onSelect: ((id: string | null) => void) | null;
  mode: PrototypeCanvasMode;
  links: ReadonlyMap<string, number>;
  onNavigate: ((to: number) => void) | null;
  /** 迭代 16（#3773 R5）：这一轮新增/改动的节点 id——屏上给一圈高亮，说清"它改了这里"。 */
  changed: ReadonlySet<string>;
}>({ selectedId: null, onSelect: null, mode: "edit", links: new Map(), onNavigate: null, changed: new Set() });

/** 预览模式下「某个可点位」要挂的属性：有跳转 ⇒ 真正的控件 + 点击跳转；没有 ⇒ 什么都不挂。 */
function useLinkTap(id: string | undefined, item?: number) {
  const { mode, links, onNavigate } = React.useContext(SelectionCtx);
  if (mode !== "preview" || id === undefined) return { linked: false, props: {} as const };
  const to = links.get(linkKey(id, item));
  if (to === undefined || onNavigate === null) return { linked: false, props: {} as const };
  const go = () => onNavigate(to);
  return {
    linked: true,
    props: {
      "data-link-to": to,
      role: "button" as const,
      tabIndex: 0,
      onClick: (e: React.MouseEvent) => { e.stopPropagation(); go(); },
      onKeyDown: (e: React.KeyboardEvent) => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); go(); }
      },
    } as const,
  };
}

/** 每个节点根元素要挂的属性：id、选中标记、点击选中（冒泡到父节点前停住，父子重叠时选最内层）。 */
function useTap(node: PrototypeNode) {
  const { selectedId, onSelect, mode, changed } = React.useContext(SelectionCtx);
  const id = node.id;
  // 单目标原语在预览模式下的跳转（多项原语与 navbar 由各自的项挂 `useLinkTap`，这里 item 恒 0 会查不到，正好）。
  const link = useLinkTap(id);
  // 预览模式下选中语义整个关掉：没跳转的节点点了没反应，也不选中（delta V29 的反证就是这一行）。
  const interactive = mode === "edit" && onSelect !== null && id !== undefined;
  const toggle = () => { if (interactive) onSelect(id === selectedId ? null : id); };
  return {
    "data-node-id": id,
    "data-selected": id !== undefined && id === selectedId ? "true" : undefined,
    // 迭代 16（#3773 R5）：这一轮改了它。纯标记，样式挂在画布根上的 arbitrary variant 里。
    "data-changed": id !== undefined && changed.has(id) ? "true" : undefined,
    "data-linked": link.linked ? "true" : undefined,
    // 可选中时是一个真正的控件：role/tabIndex/aria-pressed + Enter/Space 触发（Codex P2：不能只挂 onClick）。
    ...(interactive
      ? {
          role: "button" as const,
          tabIndex: 0,
          "aria-pressed": id === selectedId,
          onClick: (e: React.MouseEvent) => { e.stopPropagation(); toggle(); },
          onKeyDown: (e: React.KeyboardEvent) => {
            if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); toggle(); }
          },
        }
      : link.props),
  } as const;
}

/** 多项原语 / navbar 的第 `item` 项要挂的属性（预览模式下有跳转才是控件）。 */
function ItemTap({ id, item, children, className, as: Tag = "span" }: {
  id: string | undefined; item: number; children: React.ReactNode; className?: string; as?: "span" | "li";
}) {
  const link = useLinkTap(id, item);
  return (
    <Tag className={className} data-link-item={id !== undefined ? linkKey(id, item) : undefined} data-linked={link.linked ? "true" : undefined} {...link.props}>
      {children}
    </Tag>
  );
}

const GAP: Record<"none" | "sm" | "md" | "lg", string> = { none: "gap-0", sm: "gap-1", md: "gap-2", lg: "gap-4" };
const PAD: Record<"none" | "sm" | "md" | "lg", string> = { none: "p-0", sm: "p-1", md: "p-2", lg: "p-4" };
const SPACE: Record<"none" | "sm" | "md" | "lg", string> = { none: "h-0", sm: "h-1", md: "h-3", lg: "h-6" };
const ALIGN: Record<"start" | "center" | "end" | "between", string> = {
  start: "items-start justify-start", center: "items-center justify-center", end: "items-end justify-end", between: "items-center justify-between",
};
/**
 * 文字档位 → 样式。
 *
 * ## 迭代 18：两处改动，各自有理由
 *
 * ① **`label` 不再强制全大写**。`DESIGN_PRINCIPLES` 第 ⑬ 条逐字写着「不要用全大写的
 *    小标签当眉头」——那是「一眼看出是 AI 生成」的头号特征之一。而这张表把**每一个**
 *    `variant:"label"` 都 `uppercase` 了：规则管住了模型，没管住渲染器。中文看不出来
 *    （`uppercase` 对汉字是空操作），做英文界面时就原形毕露，而且是我们自己加上去的。
 *    同一条规矩，提示词里禁止、渲染器里强制，这是本仓那条「同一事实两处」的变体。
 *
 * ② **字号级差拉开**。原来是 16 / 13 / 12 / 10：subtitle 与 body 只差 1px，
 *    在 300px 宽的手机画布上根本分不出来，「层级」于是只剩字重。改成 18 / 14 / 12 / 10，
 *    相邻两档至少差 2px，肉眼能分辨。
 *    ⚠ 档**数**没变（截图审计门 `scoreTypeScale` 数的是档数，3–6 档满分），
 *      变的是档与档之间的距离——那正是肉眼读层级的依据。
 */
const TEXT_VARIANT: Record<"title" | "subtitle" | "body" | "caption" | "label", string> = {
  title: "text-18 font-semibold", subtitle: "text-14 font-medium", body: "text-12", caption: "text-10", label: "text-10 font-medium tracking-wide",
};
/**
 * 迭代 13（delta §6）—— 圆角与尺寸的档位表。
 *
 * ⚠ 与契约的 `Radius` / `Size` 枚举一一对应；`Record<...>` 的键类型让**新增一档而忘了
 *   在这里给样式**变成一个 TS 错误，而不是运行时静悄悄地落到默认值上。
 */
const RADIUS: Record<"none" | "sm" | "md" | "lg" | "full", string> = {
  none: "rounded-none", sm: "rounded-sm", md: "rounded-control", lg: "rounded-card", full: "rounded-full",
};
const BTN_SIZE: Record<"sm" | "md" | "lg", string> = {
  sm: "h-6 px-2 text-11", md: "h-8 px-3 text-12", lg: "h-10 px-5 text-13",
};
const AVATAR_SIZE: Record<"sm" | "md" | "lg", string> = {
  sm: "h-5 w-5 text-9", md: "h-7 w-7 text-10", lg: "h-10 w-10 text-12",
};

const BUTTON_VARIANT: Record<"primary" | "secondary" | "ghost" | "danger", string> = {
  primary: "bg-primary text-primary-foreground",
  secondary: "bg-panel text-panel-foreground border border-border",
  ghost: "text-muted-foreground",
  danger: "bg-destructive text-destructive-foreground",
};
const BADGE_TONE: Record<"neutral" | "info" | "success" | "warning" | "danger", string> = {
  neutral: "bg-panel text-panel-foreground",
  info: "bg-primary/20 text-primary",
  success: "bg-success/20 text-success",
  warning: "bg-warning/20 text-warning",
  danger: "bg-destructive/20 text-destructive",
};
/**
 * 迭代 16（#3773 R4）：契约图标闭集 → lucide 组件。
 *
 * `Record<PrototypeIcon, …>` **穷举**：契约加了新图标这里编译不过，不会静默渲染成空
 * ——同这个文件头注对渲染表的既有纪律。
 */
const ICONS: Record<designPrototype.PrototypeIcon, LucideIcon> = {
  home: Home, search: Search, menu: Menu, more: MoreHorizontal, settings: Settings,
  filter: SlidersHorizontal, grid: LayoutGrid, list: ListIcon, back: ArrowLeft, forward: ArrowRight,
  user: User, users: Users, bell: Bell, message: MessageCircle, send: Send, share: Share2,
  heart: Heart, star: Star,
  image: ImageIcon, camera: Camera, file: File, folder: Folder, bookmark: Bookmark, tag: Tag,
  link: Link2, download: Download, upload: Upload,
  plus: Plus, edit: Pencil, trash: Trash2, check: Check, close: XIcon, refresh: RefreshCw,
  play: Play, pause: Pause, lock: Lock, eye: Eye,
  cart: ShoppingCart, card: CreditCard, chart: BarChart3, calendar: Calendar, clock: Clock,
  location: MapPin, mail: Mail, phone: Phone, info: Info, warning: AlertTriangle,
};

/**
 * 迭代 16（#3773 R4）：底部导航没给 `icons` 时，**按标签名猜**。
 *
 * 在这之前是 `NAV_ICONS[i % 5]`——按**位置**轮转，一个叫「消息」的标签页会拿到齿轮图标。
 * 那不是"没有图标"，是"图标在撒谎"，比没有更坏。猜不到就给一个中性圆点，
 * 不硬凑一个语义不对的图标。
 */
const NAV_KEYWORDS: readonly (readonly [readonly string[], designPrototype.PrototypeIcon])[] = [
  [["首页", "主页", "home", "发现"], "home"],
  [["搜索", "查找", "search"], "search"],
  [["消息", "聊天", "对话", "chat", "message"], "message"],
  [["通知", "提醒", "动态", "bell"], "bell"],
  [["我的", "个人", "账户", "我", "profile", "me"], "user"],
  [["设置", "配置", "setting"], "settings"],
  [["购物车", "车", "cart"], "cart"],
  [["订单", "单", "order"], "file"],
  [["数据", "统计", "报表", "用量", "分析"], "chart"],
  [["日历", "日程", "calendar"], "calendar"],
  [["收藏", "喜欢", "star", "favorite"], "star"],
  [["团队", "成员", "联系人"], "users"],
];
export function guessNavIcon(label: string): designPrototype.PrototypeIcon | null {
  const l = label.toLowerCase();
  for (const [keys, icon] of NAV_KEYWORDS) if (keys.some((k) => l.includes(k.toLowerCase()))) return icon;
  return null;
}
/** 迭代 6：设备尺寸——由项目模板派生（mobile → 手机，ui → 桌面，wireframe → 平板）；画布内同一套原语按宽度自适应。 */
/**
 * 迭代 14：设备尺寸与外观**都从 `lib/prototype-devices` 那张预设表来**，这里不再自己声明。
 * 原来的 `PrototypeDevice`（phone|tablet|desktop）与 `DEVICE_SIZE` 已删除——那是第二份尺寸。
 */
import { DEVICE_PRESETS, presetById, defaultPresetFor, rotated, fitScale, type PrototypeDevicePreset, type PrototypeChrome } from "@/lib/prototype-devices";
export { DEVICE_PRESETS, presetById, defaultPresetFor, rotated, fitScale };
export type { PrototypeDevicePreset, PrototypeChrome };

/** 兼容旧调用点：按项目模板取默认镜头。 */
export function deviceOf(template: "mobile" | "ui" | "wireframe"): PrototypeDevicePreset {
  return defaultPresetFor(template);
}
/** 没有改动时共用的同一个空集——每次渲染新建一个会让 context 每帧都变。 */
const EMPTY_CHANGED: ReadonlySet<string> = new Set();

/**
 * 迭代 17（#3773 后续）—— 把强调色档位翻成画布根上的**内联 token 覆盖**。
 *
 * 整棵树的颜色都是 `hsl(var(--primary))` 这种形态（`bg-primary` / `text-primary` /
 * `border-primary` / `fill-primary`…），所以只要在画布根上把这三个变量改掉，
 * 按钮、选中的 tab、底部导航的当前项、开关、进度条、图表占位……**全部**跟着变，
 * 不需要在渲染表里逐个节点做第二套颜色逻辑（那才是会漂的做法）。
 *
 * `--ring` 一起改：焦点环是主色的语义延伸，只改 `--primary` 会让键盘焦点停在旧色上，
 * 一眼看出是补丁。
 *
 * `neutral` ⇒ 返回 `undefined`，一个变量都不写——这个字段出现之前的行为逐字不变。
 */
/**
 * 迭代 19 —— **线框图模板真的画成线框图**。
 *
 * ## 这个选项此前在撒谎
 *
 * 新建时的三选一是「移动端设计 / UI 原型 / 线框图」，而 `template` 实际只决定用哪个
 * 设备预设（iphone / laptop / ipad）。选了「线框图」拿到的是**彩色高保真稿**，只是画在
 * 平板上——这个选项把「保真度」和「设备」混成一个轴，然后只实现了设备那一半。
 * 与本仓一路修过的几条同类：界面许诺了一件事，底下没有人去做它。
 *
 * ## 为什么低保真值得真的做出来
 *
 * 早期讨论要的正是"别谈颜色，先谈结构"。一份彩色稿会把评审拽进"这个蓝好不好看"，
 * 而线框图把注意力钉在信息层级与流程上。这是两种用途，不是一种用途的两种皮肤。
 *
 * ## 实现：和强调色同一个机制
 *
 * 画布里所有颜色都走 `hsl(var(--token))`，所以低保真 = 在画布根上把**语义色**全部
 * 改写成灰阶（主色、成功、警告、危险）。不需要在渲染表里为线框图再写一套分支——
 * 那才是会漂的做法，而且每加一个原语就要记得改两处。
 *
 * ⚠ 只压颜色，**不压结构**：圆角、间距、字号档位原样保留。线框图不是"把东西画丑"，
 *   是"把颜色这一层信息拿掉"，布局判断仍然要能做。
 */
/**
 * ⚠ 取值在**契约** `PROTOTYPE_WIREFRAME`，不在这里——它要和强调色走同一条对比度门
 *   （这些 token 不只当块的底色，也当文字色；实测深色画布下灰 46% 只有 3.65:1）。
 *   在这里再写一份就是「同一事实两处」，而且是门看不见的那一份。
 */
export function wireframeStyle(theme: "light" | "dark"): React.CSSProperties {
  const { primary, foreground } = designWorkbench.PROTOTYPE_WIREFRAME[theme];
  return {
    "--primary": primary,
    "--primary-foreground": foreground,
    "--ring": primary,
    // 语义色一并压平：线框图里「成功/警告/危险」不该靠颜色区分，该写出来。
    "--success": primary,
    "--warning": primary,
    "--destructive": primary,
  } as React.CSSProperties;
}

export function accentStyle(
  accent: designWorkbench.PrototypeAccent | undefined,
  theme: "light" | "dark",
): React.CSSProperties | undefined {
  if (accent === undefined || accent === "neutral") return undefined;
  const tokens = designWorkbench.PROTOTYPE_ACCENTS[accent]?.[theme];
  // 契约加了新档位却没给值时不硬崩，也不假装有颜色——退回"没有强调色"。
  if (tokens === undefined) return undefined;
  return {
    "--primary": tokens.primary,
    "--primary-foreground": tokens.foreground,
    "--ring": tokens.primary,
  } as React.CSSProperties;
}

const RATIO: Record<"square" | "video" | "wide" | "portrait", string> = { square: "aspect-square", video: "aspect-video", wide: "aspect-[3/1]", portrait: "aspect-[3/4]" };

/**
 * 迭代 16（#3773 R4）—— `image` 按**语义**画占位，不是一律一个灰块。
 *
 * 一张商品图、一张地图、一条折线图在屏上长得一模一样时，原型就没法让人判断
 * 「这块视觉分量够不够」——而那正是看原型最主要的用途之一。
 * 这里画的是各自的**形状**（地图有路网、图表有柱/线、头像是圆的），
 * 仍然是占位（没有真图），但一眼能看出是什么。
 */
function ImagePlaceholder({ node, tap }: { node: Extract<PrototypeNode, { type: "image" }>; tap: Record<string, unknown> }): React.ReactElement {
  const p = node.props;
  const kind = p.kind ?? "photo";
  const box = cn("relative flex w-full items-center justify-center overflow-hidden rounded-control bg-panel text-muted-foreground", RATIO[p.ratio ?? "video"]);
  if (kind === "avatar") {
    return (
      <div className="flex w-full items-center justify-center" data-proto="image" data-image-kind="avatar" {...tap} aria-label={p.alt}>
        <span aria-hidden className="flex h-12 w-12 items-center justify-center rounded-full bg-panel"><User className="h-6 w-6 text-muted-foreground" /></span>
        <span className="sr-only">{p.alt}</span>
      </div>
    );
  }
  return (
    <div className={box} data-proto="image" data-image-kind={kind} {...tap} aria-label={p.alt}>
      {kind === "map" && (
        // 路网：两横两纵 + 一个定位点。够表达「这是一张地图」，不假装是真地图。
        <svg aria-hidden viewBox="0 0 120 60" className="h-full w-full" preserveAspectRatio="none">
          <rect width="120" height="60" className="fill-card" />
          <g className="stroke-border" strokeWidth="2" fill="none">
            <path d="M0 18 H120 M0 42 H120 M32 0 V60 M86 0 V60" />
          </g>
          <circle cx="60" cy="30" r="5" className="fill-primary" />
        </svg>
      )}
      {kind === "chart" && (
        <svg aria-hidden viewBox="0 0 120 60" className="h-full w-full" preserveAspectRatio="none">
          <g className="fill-primary/30">
            <rect x="10" y="34" width="14" height="22" /><rect x="34" y="22" width="14" height="34" />
            <rect x="58" y="28" width="14" height="28" /><rect x="82" y="12" width="14" height="44" />
          </g>
          <path d="M17 32 L41 20 L65 26 L89 10" className="stroke-primary" strokeWidth="2" fill="none" />
        </svg>
      )}
      {kind === "video" && (
        <span aria-hidden className="flex h-9 w-9 items-center justify-center rounded-full bg-inverse/40"><Play className="h-4 w-4 text-background-foreground" /></span>
      )}
      {kind === "logo" && <span aria-hidden className="h-8 w-8 rounded-control bg-primary/30" />}
      {kind === "illustration" && (
        <svg aria-hidden viewBox="0 0 120 60" className="h-full w-full" preserveAspectRatio="none">
          <circle cx="42" cy="26" r="14" className="fill-primary/25" />
          <rect x="58" y="24" width="34" height="22" rx="4" className="fill-border" />
        </svg>
      )}
      {kind === "photo" && <ImageIcon aria-hidden className="h-4 w-4" />}
      <span className="sr-only">{p.alt}</span>
    </div>
  );
}

function Node({ node }: { node: PrototypeNode }): React.ReactElement {
  const tap = useTap(node);
  switch (node.type) {
    case "stack": {
      const p = node.props ?? {};
      return (
        <div
          className={cn(
            "flex min-h-0", p.direction === "row" ? "flex-row" : "flex-col",
            GAP[p.gap ?? "sm"], PAD[p.padding ?? "none"],
            // 未指定 align：纵向拉伸子项占满宽度（手机屏里的行天然通栏），横向居中对齐。
            p.align !== undefined ? ALIGN[p.align] : p.direction === "row" ? "items-center" : "items-stretch",
            p.fill === true && "flex-1 overflow-y-auto",
            // 横向排布里输入框吃掉剩余宽度（消息输入区那种「输入框 + 按钮」），按钮等保持内容宽。
            p.direction === "row" && "[&>*]:min-w-0 [&>[data-proto=input]]:flex-1",
          )}
          data-proto="stack" {...tap}
        >
          {node.children.map((c, i) => <Node key={i} node={c} />)}
        </div>
      );
    }
    case "card": {
      const p = node.props;
      return (
        <div
          className={cn("flex flex-col gap-1.5 border border-border bg-panel", RADIUS[p?.radius ?? "lg"], PAD[p?.padding ?? "md"])}
          data-proto="card" {...tap}
        >
          {node.props?.title !== undefined && <p className="text-12 font-medium">{node.props.title}</p>}
          {node.children.map((c, i) => <Node key={i} node={c} />)}
        </div>
      );
    }
    case "navbar":
      return (
        <div className="flex h-9 items-center justify-between border-b border-border px-1 text-12" data-proto="navbar" {...tap}>
          <ItemTap id={node.id} item={0} className="w-10 truncate text-muted-foreground">{node.props.left ?? ""}</ItemTap>
          <span className="truncate font-semibold">{node.props.title}</span>
          <ItemTap id={node.id} item={1} className="w-10 truncate text-right text-primary">{node.props.right ?? ""}</ItemTap>
        </div>
      );
    case "text": {
      const p = node.props;
      return (
        <p
          className={cn("whitespace-pre-wrap break-words", TEXT_VARIANT[p.variant ?? "body"], p.muted === true && "text-muted-foreground",
            p.align === "center" && "text-center", p.align === "end" && "text-right")}
          data-proto="text" {...tap}
        >
          {p.content}
        </p>
      );
    }
    case "button": {
      const p = node.props;
      return (
        <span
          className={cn(
            "inline-flex shrink-0 items-center justify-center font-medium",
            BTN_SIZE[p.size ?? "md"], RADIUS[p.radius ?? "md"],
            BUTTON_VARIANT[p.variant ?? "primary"], p.full === true && "w-full",
          )}
          data-proto="button" {...tap}
        >
          {/* 迭代 16（#3773 R4）：图标在文案左边，`gap` 跟着尺寸走——图标按钮不该比文字按钮更松。 */}
          {p.icon !== undefined && React.createElement(ICONS[p.icon], { "aria-hidden": true, className: "mr-1 h-3.5 w-3.5 shrink-0" })}
          {p.label}
        </span>
      );
    }
    case "input": {
      const p = node.props;
      return (
        <div className="flex w-full flex-col gap-1" data-proto="input" {...tap}>
          {p.label !== undefined && <span className="text-10 text-muted-foreground">{p.label}</span>}
          <div className={cn("w-full rounded-control border border-input bg-background px-2 text-12", p.multiline === true ? "min-h-14 py-1.5" : "flex h-8 items-center")}>
            {p.value !== undefined && p.value !== "" ? <span className="truncate">{p.value}</span> : <span className="truncate text-muted-foreground">{p.placeholder ?? ""}</span>}
          </div>
        </div>
      );
    }
    case "image":
      return <ImagePlaceholder node={node} tap={tap} />;
    case "list": {
      const p = node.props;
      const lead = p.leading ?? "dot";
      return (
        <ul className="flex w-full flex-col divide-y divide-border" data-proto="list" {...tap}>
          {p.items.map((item, i) => {
            /*
             * 迭代 16（#3773 R4）：真实的列表行是三段式——主标题 / 副标题 / 右侧值。
             * `detail` / `trailing` / `icons` 与 `items` **逐位对应**，缺这一位就没有那一段
             * （契约刻意不要求等长：要求等长会让模型为了补一个空字符串把整条写回作废）。
             */
            const detail = p.detail?.[i]?.trim();
            const trailing = p.trailing?.[i]?.trim();
            const rowIcon = lead === "icon" ? p.icons?.[i] : undefined;
            return (
              <ItemTap key={i} as="li" id={node.id} item={i} className="flex items-center gap-2 py-1.5 text-12">
                {lead === "dot" && <Circle aria-hidden className="h-1.5 w-1.5 shrink-0 fill-current text-muted-foreground" />}
                {lead === "check" && <Check aria-hidden className="h-3 w-3 shrink-0 text-success" />}
                {lead === "avatar" && <span aria-hidden className="h-5 w-5 shrink-0 rounded-full bg-panel" />}
                {/* icons 缺这一位 ⇒ 退回圆点，不留一个空缺口让这一行比别的行窄。 */}
                {lead === "icon" && (rowIcon === undefined
                  ? <Circle aria-hidden className="h-1.5 w-1.5 shrink-0 fill-current text-muted-foreground" />
                  : React.createElement(ICONS[rowIcon], { "aria-hidden": true, className: "h-4 w-4 shrink-0 text-muted-foreground" }))}
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate">{item}</span>
                  {detail !== undefined && detail !== "" && <span className="truncate text-10 text-muted-foreground">{detail}</span>}
                </span>
                {trailing !== undefined && trailing !== "" && (
                  <span className="shrink-0 text-10 text-muted-foreground" data-proto-slot="trailing">{trailing}</span>
                )}
              </ItemTap>
            );
          })}
        </ul>
      );
    }
    case "divider":
      return <hr className="w-full border-border" data-proto="divider" {...tap} />;
    case "spacer":
      return <div aria-hidden className={cn("w-full shrink-0", SPACE[node.props?.size ?? "md"])} data-proto="spacer" {...tap} />;
    case "tabs": {
      const active = node.props.active ?? 0;
      return (
        <div className="flex w-full gap-1 border-b border-border text-11" data-proto="tabs" {...tap}>
          {node.props.items.map((t, i) => (
            <ItemTap key={i} id={node.id} item={i} className={cn("px-2 pb-1", i === active ? "border-b-2 border-primary font-medium" : "text-muted-foreground")}>{t}</ItemTap>
          ))}
        </div>
      );
    }
    case "badge":
      return <span className={cn("inline-flex shrink-0 rounded-full px-1.5 py-0.5 text-10", BADGE_TONE[node.props.tone ?? "neutral"])} data-proto="badge" {...tap}>{node.props.label}</span>;
    case "avatar":
      return (
        /*
         * 迭代 18：头像位用**强调色的淡底 + 强调色的字**，不再是一律的灰圆。
         *
         * 一条会话列表里十个一模一样的灰圆，看起来就是十个占位符；而真实界面里头像正是
         * 把"这些行是不同的人"这件事一眼交代清楚的东西。用 `primary/15` 而不是随机色：
         * 随机色等于在这套原语外面又开了一个颜色来源，而强调色本来就是这个项目的身份
         * （`neutral` 的项目里 `--primary` 仍是中性色，于是行为与这一改之前一致）。
         */
        <span
          className={cn(
            "inline-flex shrink-0 items-center justify-center rounded-full bg-primary/15 font-medium text-primary",
            AVATAR_SIZE[node.props.size ?? "md"],
          )}
          data-proto="avatar" {...tap} title={node.props.name}
        >
          {node.props.name.slice(0, 1)}
        </span>
      );
    /* ── 迭代 6 扩充 ── */
    case "grid": {
      const p = node.props ?? {};
      return (
        <div className={cn("grid w-full", p.columns === 3 ? "grid-cols-3" : "grid-cols-2", GAP[p.gap ?? "sm"])} data-proto="grid" {...tap}>
          {node.children.map((c, i) => <Node key={i} node={c} />)}
        </div>
      );
    }
    case "bottomnav": {
      const active = node.props.active ?? 0;
      return (
        <nav className="mt-auto flex w-full shrink-0 items-stretch border-t border-border pt-1" data-proto="bottomnav" {...tap}>
          {node.props.items.map((item, i) => {
            /*
             * 迭代 16（#3773 R4）：先用模型给的 `icons[i]`，没给就按标签名猜，猜不到给中性圆点。
             * 在这之前是按**位置**轮转，「消息」拿到齿轮图标——图标在撒谎比没有图标更坏。
             */
            const named = node.props.icons?.[i] ?? guessNavIcon(item);
            const Icon = named === null || named === undefined ? Circle : ICONS[named];
            return (
              <ItemTap key={i} id={node.id} item={i} className={cn("flex flex-1 flex-col items-center gap-0.5 py-1 text-10", i === active ? "text-primary" : "text-muted-foreground")}>
                <Icon aria-hidden className="h-4 w-4" />
                <span className="truncate">{item}</span>
              </ItemTap>
            );
          })}
        </nav>
      );
    }
    case "switch": {
      const on = node.props.on === true;
      return (
        <div className="flex w-full items-center justify-between py-1 text-12" data-proto="switch" {...tap}>
          <span className="truncate">{node.props.label}</span>
          <span className={cn("relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors duration-fast", on ? "bg-primary" : "bg-panel")} aria-hidden>
            <span className={cn("absolute h-4 w-4 rounded-full bg-background shadow", on ? "right-0.5" : "left-0.5")} />
          </span>
        </div>
      );
    }
    case "checkbox":
      return (
        <div className="flex w-full items-center gap-2 py-1 text-12" data-proto="checkbox" {...tap}>
          {node.props.checked === true ? <CheckSquare aria-hidden className="h-4 w-4 shrink-0 text-primary" /> : <Square aria-hidden className="h-4 w-4 shrink-0 text-muted-foreground" />}
          <span className="truncate">{node.props.label}</span>
        </div>
      );
    case "chip":
      return (
        <span className={cn("inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-11", node.props.selected === true ? "border-primary bg-primary/15 text-primary" : "border-border text-muted-foreground")} data-proto="chip" {...tap}>
          {node.props.label}
        </span>
      );
    case "progress":
      return (
        <div className="flex w-full flex-col gap-1" data-proto="progress" {...tap}>
          {node.props.label !== undefined && (
            <span className="flex justify-between text-10 text-muted-foreground"><span>{node.props.label}</span><span>{Math.round(node.props.value)}%</span></span>
          )}
          <span className="block h-1.5 w-full overflow-hidden rounded-full bg-panel" role="progressbar" aria-valuenow={node.props.value} aria-valuemin={0} aria-valuemax={100}>
            <span className="block h-full rounded-full bg-primary" style={{ width: `${Math.max(0, Math.min(100, node.props.value))}%` }} />
          </span>
        </div>
      );
    case "stat":
      return (
        <div className="flex min-w-0 flex-col gap-0.5 rounded-card border border-border bg-panel p-2" data-proto="stat" {...tap}>
          <span className="truncate text-10 text-muted-foreground">{node.props.label}</span>
          <span className="truncate text-16 font-semibold">{node.props.value}</span>
          {node.props.delta !== undefined && (
            <span className={cn("truncate text-10", node.props.tone === "success" ? "text-success" : node.props.tone === "danger" ? "text-destructive" : "text-muted-foreground")}>{node.props.delta}</span>
          )}
        </div>
      );
    case "hero":
      return (
        <div className="flex w-full flex-col gap-1.5 rounded-card bg-primary/10 p-3" data-proto="hero" {...tap}>
          <span className="text-16 font-semibold leading-tight">{node.props.title}</span>
          {node.props.subtitle !== undefined && <span className="text-11 text-muted-foreground">{node.props.subtitle}</span>}
          {node.props.cta !== undefined && <span className="mt-1 inline-flex h-8 w-fit items-center rounded-control bg-primary px-3 text-12 font-medium text-primary-foreground">{node.props.cta}</span>}
        </div>
      );
  }
}

/** 居中手机屏：有树渲染树；没有（还没生成）显示占位块，与 B4.5 之前的外观一致。 */
/**
 * 迭代 14 —— 机身外观。**只画壳，不参与布局**：状态栏/灵动岛/home 条都是绝对定位或
 * 固定高度的兄弟节点，原型内容仍占满剩余空间。
 *
 * ⚠ 这些是**装饰**，不是原语。它们不进 `data-proto`、不可选中、不进导出的 class 比对
 * （V47 比的是原语树）——把它们做成可选中的节点会让「选中一个节点去改」多出一批
 * 用户根本改不了的目标。
 */
function StatusBar({ label }: { label: string }) {
  return (
    <div className="flex shrink-0 items-center justify-between px-5 pt-1.5 text-9 font-medium text-card-foreground/80" aria-hidden data-chrome="status">
      <span>9:41</span>
      <span className="truncate px-2 text-card-foreground/45">{label}</span>
      <span className="flex items-center gap-0.5">
        <span className="inline-block h-1.5 w-2.5 rounded-sm bg-current opacity-70" />
        <span className="inline-block h-1.5 w-1.5 rounded-full bg-current opacity-70" />
        <span className="inline-block h-1.5 w-3 rounded-sm border border-current opacity-70" />
      </span>
    </div>
  );
}

/** 灵动岛（新机型）/ 听筒条（旧机型）。两者都是黑色，靠形状区分。 */
function PhoneNotch({ island }: { island: boolean }) {
  return (
    <div className="pointer-events-none absolute inset-x-0 top-1 flex justify-center" aria-hidden data-chrome={island ? "island" : "notch"}>
      <span className={cn("bg-black", island ? "h-4 w-20 rounded-full" : "h-3.5 w-32 rounded-b-xl")} />
    </div>
  );
}

/** 底部的 home 指示条。iPad 也有。 */
function HomeIndicator() {
  return (
    <div className="flex shrink-0 justify-center pb-1.5 pt-1" aria-hidden data-chrome="home">
      <span className="h-1 w-24 rounded-full bg-card-foreground/30" />
    </div>
  );
}

/** 浏览器壳：红黄绿 + 地址栏。地址栏里放页标签——它就是这一页的"标题"。 */
function BrowserBar({ label }: { label: string }) {
  return (
    <div className="flex shrink-0 items-center gap-2 border-b border-border bg-panel px-2.5 py-1.5" data-chrome="browser">
      {/*
        * 交通灯用**语义 token** 而不是 macOS 那三个字面色值：色相语义正好对得上
        * （危险/警告/成功），而字面色值在浅色/深色两套主题下都不会跟着变——
        * 模拟要的是"像个浏览器窗口"，不是"像素级复刻 macOS"。
        */}
      <span className="flex gap-1" aria-hidden>
        <span className="h-2 w-2 rounded-full bg-destructive" />
        <span className="h-2 w-2 rounded-full bg-warning" />
        <span className="h-2 w-2 rounded-full bg-success" />
      </span>
      <span className="flex min-w-0 flex-1 items-center gap-1 rounded-full bg-background px-2 py-0.5 text-9 text-muted-foreground">
        <Lock aria-hidden className="h-2 w-2 shrink-0" />
        <span className="truncate">{label}</span>
      </span>
    </div>
  );
}

export function PrototypeCanvas({
  label, root, selectedId = null, onSelect = null, ungenerated = false, drawing = false, changed = EMPTY_CHANGED, accent = "neutral", wireframe = false, onRegenerate = null, device = DEVICE_PRESETS[1]!, landscape = false, frameIndex, mode = "edit", links, onNavigate = null, theme = "dark",
}: {
  label: string; root: PrototypeNode | null; selectedId?: string | null; onSelect?: ((id: string | null) => void) | null;
  /**
   * issue #3340：这一页**规划了但没画出来**（分页生成里那一轮失败），不同于「整个项目还没有原型」。
   * 两种空长得一样、说同一句话，等于把「有 2 页没画出来」这个事实藏起来——用户看到的是
   * 5 页只出来 3 页，而画布上没有任何痕迹。
   */
  ungenerated?: boolean;
  /**
   * 迭代 16（#3773 R2）：这一页**正在画**——分页生成还在跑，它排在后面还没轮到。
   *
   * 与 `ungenerated` 是两件事，必须分开说：`ungenerated` 的含义是「这一轮画失败了，
   * 你可以让我补画」，而这一页只是还没轮到——这时候给一个「补画这一页」按钮，
   * 等于请用户为一件正在发生的事重新下单。
   */
  drawing?: boolean;
  /**
   * 迭代 16（#3773 R5）：这一轮新增/改动的节点 id。
   *
   * 一轮对话之后画布整体换了一份，而屏上没有任何痕迹说明**哪里**变了——三页里改了一个
   * 按钮文案，用户只能自己逐页找。于是"改一点点"和"重看一遍全部"一样贵，
   * 而快速建模靠的恰恰是"改一点点"足够便宜。
   */
  changed?: ReadonlySet<string>;
  /**
   * 迭代 17：原型的**强调色档位**（项目级）。在这之前，不管做的是儿童记账 App 还是
   * 医院排班后台，按钮和选中态一律是同一个中性灰——所有产出看起来都像同一个模板的
   * 不同填空。档位在画布根上覆盖 `--primary` 系列 token，整棵树跟着变。
   */
  accent?: designWorkbench.PrototypeAccent;
  /**
   * 迭代 19：**低保真**（项目 template 是 `wireframe` 时）。语义色全部压成灰阶，
   * 结构原样保留——线框图不是"把东西画丑"，是"把颜色这一层信息拿掉"。
   * 为真时**强调色不生效**：低保真的全部意义就是别谈颜色。
   */
  wireframe?: boolean;
  /** 给了就在未生成的页上显示「补画这一页」；点它发一句普通对话，不新开接口。 */
  onRegenerate?: (() => void) | null;
  /** 迭代 11：编辑 / 预览；本页跳转表；预览模式点有跳转的节点 ⇒ `onNavigate(目标页序号)`。 */
  mode?: PrototypeCanvasMode; links?: readonly PrototypeLink[]; onNavigate?: ((to: number) => void) | null;
  /** 迭代 8：这块屏是第几页——导出 PNG 按它找到 DOM。 */
  frameIndex?: number;
  /** 迭代 14：设备预设（尺寸 + 外观）。默认由项目模板派生，预览时可切换（见 `lib/prototype-devices`）。 */
  device?: PrototypeDevicePreset;
  /** 迭代 14：横过来看。不可旋转的预设（桌面浏览器）忽略它。 */
  landscape?: boolean;
  /**
   * 迭代 13（delta §5.2）：**原型自己的**明暗主题，与后台页面的主题无关。
   *
   * 迭代 6 当时的注释写着「主题跟随页面 `.dark`，globals.css 没有独立的 `.light` 类，
   * 不另造第二份 token」——那条结论建立在「画布只跟随页面」这个前提上，前提已经变了：
   * 做深色 app 的人要看浅色稿，不该被迫把整个后台切成浅色。
   *
   * `.wx-light` 是 globals.css 里由 `scripts/gen-light-scope.mjs` **从 `:root` 生成**的
   * 浅色作用域（不是手抄的第二份 token，`--check` 在 lint 里守着）。
   */
  theme?: "light" | "dark";
}) {
  const size = rotated(device, landscape);
  const linkMap = React.useMemo(() => linkMapOf(links), [links]);
  return (
    <SelectionCtx.Provider value={{ selectedId, onSelect, mode, links: linkMap, onNavigate, changed }}>
    <div
      className={cn(
        // `relative` 给灵动岛定位用；`overflow-hidden` 让内容被机身圆角裁掉——
        // 少了它，内容的直角会从圆角机身里探出来，一眼假。
        "relative flex shrink-0 flex-col overflow-hidden border border-border bg-card text-card-foreground shadow-lg",
        // 深色页面里的浅色孤岛 / 浅色页面里的深色孤岛——两个方向都要能开，
        // 否则「原型主题与后台主题互不影响」只成立一半。
        theme === "light" ? "wx-light" : "dark",
      )}
      /* 迭代 17：强调色是**画布根上的 token 覆盖**，所以写在这里而不是逐节点改颜色。 */
      /*
       * 迭代 17/19：强调色与低保真都是**画布根上的 token 覆盖**。
       * 低保真优先——选了线框图还上强调色，等于把刚拿掉的那层信息又加回去。
       */
      style={{
        width: size.w, height: size.h, borderRadius: device.radius,
        ...(wireframe ? wireframeStyle(theme) : accentStyle(accent, theme)),
      }}
      data-accent={wireframe || accent === "neutral" ? undefined : accent}
      data-fidelity={wireframe ? "wireframe" : undefined}
      data-testid="design-detail-phone" data-device={device.id} data-chrome={device.chrome}
      data-landscape={landscape && device.rotatable ? "true" : "false"}
      data-frame-index={frameIndex} data-mode={mode} data-theme={theme}
    >
      {/* 迭代 14：按机身形态画壳。手机/平板是状态栏 + home 条，浏览器是工具栏。 */}
      {device.chrome === "browser" ? <BrowserBar label={label} /> : <StatusBar label={label} />}
      {device.chrome === "phone" && <PhoneNotch island={device.island === true} />}
      {root === null ? (
        <div
          className="flex flex-1 flex-col gap-2 p-3"
          data-testid={drawing ? "design-detail-phone-drawing" : ungenerated ? "design-detail-phone-ungenerated" : "design-detail-phone-placeholder"}
        >
          <div className="h-8 rounded-control bg-panel" aria-hidden />
          <div className="h-20 rounded-control bg-panel" aria-hidden />
          <div className="h-3 w-3/4 rounded-control bg-panel" aria-hidden />
          <div className="h-3 w-1/2 rounded-control bg-panel" aria-hidden />
          {drawing ? (
            <div className="mt-auto flex flex-col items-center gap-1.5" role="status">
              <Loader2 aria-hidden className="h-4 w-4 animate-spin text-primary" />
              <p className="text-center text-11 text-muted-foreground">正在画这一页…</p>
            </div>
          ) : ungenerated ? (
            <div className="mt-auto flex flex-col items-center gap-1.5">
              {/* 说的是事实：这一页规划过、这一轮没画出来，别的页不受影响。 */}
              <p className="text-center text-11 text-muted-foreground">这一页没画出来。其余页不受影响。</p>
              {onRegenerate !== null && (
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); onRegenerate(); }}
                  className="rounded-control border border-border px-2 py-0.5 text-10 transition-colors duration-fast hover:bg-panel focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  data-testid="design-detail-regenerate-frame"
                >
                  补画这一页
                </button>
              )}
            </div>
          ) : (
            <p className="mt-auto text-center text-11 text-muted-foreground">还没有原型。在左边描述你要的界面，我会直接画出来。</p>
          )}
        </div>
      ) : (
        <div
          className={cn(
            "flex min-h-0 flex-1 flex-col overflow-hidden p-2 text-card-foreground [&>*]:min-h-0 [&>[data-proto=stack]]:flex-1",
            // 选中态：静态 arbitrary variant（Tailwind 扫得到），选中节点描边 + 可点节点显示手型。
            mode === "edit" && onSelect !== null && "[&_[data-node-id]]:cursor-pointer [&_[data-node-id]:hover]:outline [&_[data-node-id]:hover]:outline-1 [&_[data-node-id]:hover]:outline-primary/40",
            "[&_[data-selected=true]]:outline [&_[data-selected=true]]:outline-2 [&_[data-selected=true]]:outline-primary [&_[data-selected=true]]:outline-offset-1",
            /*
             * 迭代 16（#3773 R5）：这一轮改动过的节点给一圈虚线。
             * 用 `success` 而不是 `primary`——primary 已经是"选中"的意思，
             * 两件事共用一个颜色，用户分不清"我选了它"和"它刚被改了"。
             * 虚线也是为此：选中是实线。
             */
            "[&_[data-changed=true]]:outline-dashed [&_[data-changed=true]]:outline-2 [&_[data-changed=true]]:outline-success [&_[data-changed=true]]:outline-offset-1",
            // 迭代 11 预览态：只有带跳转的可点位显示手型 + 悬停描边；其余节点没有任何可点暗示。
            mode === "preview" && "[&_[data-linked=true]]:cursor-pointer [&_[data-linked=true]:hover]:outline [&_[data-linked=true]:hover]:outline-2 [&_[data-linked=true]:hover]:outline-primary [&_[data-linked=true]:hover]:outline-offset-1",
          )}
          data-testid="design-detail-phone-tree"
          onClick={() => { if (mode === "edit") onSelect?.(null); }}
        >
          <Node node={root} />
        </div>
      )}
      {device.chrome !== "browser" && <HomeIndicator />}
    </div>
    </SelectionCtx.Provider>
  );
}
