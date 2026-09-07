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
import { Check, Circle, ImageIcon, Smartphone, Tablet, Monitor, Home, Search, Bell, User, Settings, Square, CheckSquare } from "lucide-react";
import { cn } from "@/lib/utils";
import type { PrototypeLink, PrototypeNode } from "@/lib/live-design-workbench";

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
}>({ selectedId: null, onSelect: null, mode: "edit", links: new Map(), onNavigate: null });

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
  const { selectedId, onSelect, mode } = React.useContext(SelectionCtx);
  const id = node.id;
  // 单目标原语在预览模式下的跳转（多项原语与 navbar 由各自的项挂 `useLinkTap`，这里 item 恒 0 会查不到，正好）。
  const link = useLinkTap(id);
  // 预览模式下选中语义整个关掉：没跳转的节点点了没反应，也不选中（delta V29 的反证就是这一行）。
  const interactive = mode === "edit" && onSelect !== null && id !== undefined;
  const toggle = () => { if (interactive) onSelect(id === selectedId ? null : id); };
  return {
    "data-node-id": id,
    "data-selected": id !== undefined && id === selectedId ? "true" : undefined,
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
const TEXT_VARIANT: Record<"title" | "subtitle" | "body" | "caption" | "label", string> = {
  title: "text-16 font-semibold", subtitle: "text-13 font-medium", body: "text-12", caption: "text-10", label: "text-10 font-medium uppercase tracking-wide",
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
const NAV_ICONS = [Home, Search, Bell, User, Settings] as const;
/** 迭代 6：设备尺寸——由项目模板派生（mobile → 手机，ui → 桌面，wireframe → 平板）；画布内同一套原语按宽度自适应。 */
export type PrototypeDevice = "phone" | "tablet" | "desktop";
export const DEVICE_SIZE: Record<PrototypeDevice, { readonly w: number; readonly h: number }> = {
  phone: { w: 300, h: 560 },
  tablet: { w: 440, h: 560 },
  desktop: { w: 720, h: 480 },
};
/** 图标与名字；尺寸只在 `DEVICE_SIZE` 一处（Codex：不再有 Tailwind 类那第二份数字），渲染用 inline style。 */
const DEVICE: Record<PrototypeDevice, { Icon: typeof Smartphone; label: string }> = {
  phone: { Icon: Smartphone, label: "手机" },
  tablet: { Icon: Tablet, label: "平板" },
  desktop: { Icon: Monitor, label: "桌面" },
};
/** 项目模板 → 设备：mobile 手机；ui 桌面；wireframe 平板（线框图常在中等宽度上推敲结构）。 */
export function deviceOf(template: "mobile" | "ui" | "wireframe"): PrototypeDevice {
  return template === "mobile" ? "phone" : template === "ui" ? "desktop" : "tablet";
}
const RATIO: Record<"square" | "video" | "wide" | "portrait", string> = { square: "aspect-square", video: "aspect-video", wide: "aspect-[3/1]", portrait: "aspect-[3/4]" };

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
    case "card":
      return (
        <div className="flex flex-col gap-1.5 rounded-card border border-border bg-panel p-2" data-proto="card" {...tap}>
          {node.props?.title !== undefined && <p className="text-12 font-medium">{node.props.title}</p>}
          {node.children.map((c, i) => <Node key={i} node={c} />)}
        </div>
      );
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
          className={cn("inline-flex h-8 shrink-0 items-center justify-center rounded-control px-3 text-12 font-medium", BUTTON_VARIANT[p.variant ?? "primary"], p.full === true && "w-full")}
          data-proto="button" {...tap}
        >
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
      return (
        <div className={cn("flex w-full items-center justify-center rounded-control bg-panel text-muted-foreground", RATIO[node.props.ratio ?? "video"])} data-proto="image" {...tap} aria-label={node.props.alt}>
          <ImageIcon aria-hidden className="h-4 w-4" />
          <span className="sr-only">{node.props.alt}</span>
        </div>
      );
    case "list": {
      const lead = node.props.leading ?? "dot";
      return (
        <ul className="flex w-full flex-col divide-y divide-border" data-proto="list" {...tap}>
          {node.props.items.map((item, i) => (
            <ItemTap key={i} as="li" id={node.id} item={i} className="flex items-center gap-2 py-1.5 text-12">
              {lead === "dot" && <Circle aria-hidden className="h-1.5 w-1.5 shrink-0 fill-current text-muted-foreground" />}
              {lead === "check" && <Check aria-hidden className="h-3 w-3 shrink-0 text-success" />}
              {lead === "avatar" && <span aria-hidden className="h-5 w-5 shrink-0 rounded-full bg-panel" />}
              <span className="truncate">{item}</span>
            </ItemTap>
          ))}
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
        <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-panel text-10 font-medium" data-proto="avatar" {...tap} title={node.props.name}>
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
            const Icon = NAV_ICONS[i % NAV_ICONS.length]!;
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
export function PrototypeCanvas({
  label, root, selectedId = null, onSelect = null, device = "phone", frameIndex, mode = "edit", links, onNavigate = null,
}: {
  label: string; root: PrototypeNode | null; selectedId?: string | null; onSelect?: ((id: string | null) => void) | null;
  /** 迭代 11：编辑 / 预览；本页跳转表；预览模式点有跳转的节点 ⇒ `onNavigate(目标页序号)`。 */
  mode?: PrototypeCanvasMode; links?: readonly PrototypeLink[]; onNavigate?: ((to: number) => void) | null;
  /** 迭代 8：这块屏是第几页——导出 PNG 按它找到 DOM。 */
  frameIndex?: number;
  /** 迭代 6：设备尺寸（由项目模板派生，见 `deviceOf`）。主题跟随页面 `.dark`——globals.css 没有独立的 `.light` 类，不另造第二份 token。 */
  device?: PrototypeDevice;
}) {
  const { Icon } = DEVICE[device];
  const size = DEVICE_SIZE[device];
  const linkMap = React.useMemo(() => linkMapOf(links), [links]);
  return (
    <SelectionCtx.Provider value={{ selectedId, onSelect, mode, links: linkMap, onNavigate }}>
    <div className="flex shrink-0 flex-col rounded-container border border-border bg-card text-card-foreground shadow-lg" style={{ width: size.w, height: size.h }} data-testid="design-detail-phone" data-device={device} data-frame-index={frameIndex} data-mode={mode}>
      <div className="flex items-center justify-center gap-1 border-b border-border py-1.5 text-10 text-muted-foreground">
        <Icon aria-hidden className="h-3 w-3" /> {label}
      </div>
      {root === null ? (
        <div className="flex flex-1 flex-col gap-2 p-3" data-testid="design-detail-phone-placeholder">
          <div className="h-8 rounded-control bg-panel" aria-hidden />
          <div className="h-20 rounded-control bg-panel" aria-hidden />
          <div className="h-3 w-3/4 rounded-control bg-panel" aria-hidden />
          <div className="h-3 w-1/2 rounded-control bg-panel" aria-hidden />
          <p className="mt-auto text-center text-11 text-muted-foreground">还没有原型。在左边描述你要的界面，我会直接画出来。</p>
        </div>
      ) : (
        <div
          className={cn(
            "flex min-h-0 flex-1 flex-col overflow-hidden p-2 text-card-foreground [&>*]:min-h-0 [&>[data-proto=stack]]:flex-1",
            // 选中态：静态 arbitrary variant（Tailwind 扫得到），选中节点描边 + 可点节点显示手型。
            mode === "edit" && onSelect !== null && "[&_[data-node-id]]:cursor-pointer [&_[data-node-id]:hover]:outline [&_[data-node-id]:hover]:outline-1 [&_[data-node-id]:hover]:outline-primary/40",
            "[&_[data-selected=true]]:outline [&_[data-selected=true]]:outline-2 [&_[data-selected=true]]:outline-primary [&_[data-selected=true]]:outline-offset-1",
            // 迭代 11 预览态：只有带跳转的可点位显示手型 + 悬停描边；其余节点没有任何可点暗示。
            mode === "preview" && "[&_[data-linked=true]]:cursor-pointer [&_[data-linked=true]:hover]:outline [&_[data-linked=true]:hover]:outline-2 [&_[data-linked=true]:hover]:outline-primary [&_[data-linked=true]:hover]:outline-offset-1",
          )}
          data-testid="design-detail-phone-tree"
          onClick={() => { if (mode === "edit") onSelect?.(null); }}
        >
          <Node node={root} />
        </div>
      )}
    </div>
    </SelectionCtx.Provider>
  );
}
