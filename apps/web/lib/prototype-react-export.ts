/**
 * 对标 R10（#3955）—— **代码交接**：把原型导出成一份能直接放进 React 项目里用的 `.tsx`。
 *
 * 此前能交出去的只有 HTML（静态快照）、图片、文档与 JSON 规格——工程拿到后还得照着重写一遍。
 * 这里输出的是**一个文件、只依赖 react**、样式用标准 Tailwind 类名的组件：每页一个函数组件，
 * 默认导出带页面切换，原型里连好的跳转（`frameLinks`）在代码里就是 `onClick={() => go(n)}`。
 *
 * 取舍：
 * - **标准 Tailwind，不是产品自己的 token 类名**。画布用的 `rounded-control`、`text-11` 是本仓
 *   `tailwind.config` 里定义的，别人的项目里没有——原样导出等于交一份到别处就失效的代码。
 *   所以层级（圆角档、间距档 × 项目密度）仍取自画布那几张表（单源），只在最后一步翻成标准类名。
 * - 颜色**全部**走 CSS 变量（见 `THEME_VALUES`），类名里没有调色板色。主色取自项目 token
 *   （品牌色 / 强调色）；`neutral` 由调用方传入页面当下的 `--primary`（不在这里再抄一份全局 token）。
 * - 文字一律以 JSX 表达式里的 JSON 字符串输出（`{"…"}`）：模型写的文案里出现 `{`、`<` 都不会
 *   把生成的代码弄坏，也不存在注入。
 */
import { designPrototype, designWorkbench } from "@repo/contracts";
import type { DesignProject } from "@/lib/live-design-workbench";
import { GAP_BY_DENSITY, PAD_BY_DENSITY, RADIUS_BY_SCALE, SPACE_BY_DENSITY, guessNavIcon } from "@/components/design-loop/prototype-canvas";
import { exportFileStem, type Romanize } from "@/lib/export-file-name";
import { localDateStamp } from "@/lib/prototype-export-html";

type Node = designPrototype.PrototypeNode;
type Level = "none" | "sm" | "md" | "lg";

/** 画布专用圆角 token → 标准 Tailwind。键漏了 ⇒ 原样输出（标准类名本来就不用翻）。 */
const STOCK_RADIUS: Readonly<Record<string, string>> = {
  "rounded-control": "rounded-md", "rounded-card": "rounded-xl", "rounded-container": "rounded-2xl",
};

/**
 * 导出物自己的色板：**全部是 CSS 变量**，值写在导出文件顶部的 `THEME` 里（浅 / 深两套）。
 * 类名里不出现任何调色板色——拿到代码的人换配色只改 `THEME` 一处，和本仓 token 化是同一个理由。
 * 这些值只属于导出物，不回流画布。
 */
const THEME_VALUES: Readonly<Record<"light" | "dark", Readonly<Record<string, string>>>> = {
  light: {
    "--background": "0 0% 100%", "--foreground": "240 10% 4%", "--muted-foreground": "240 4% 46%",
    "--border": "240 6% 90%", "--subtle": "240 5% 96%", "--inverse": "240 10% 4%", "--inverse-foreground": "0 0% 98%",
  },
  dark: {
    "--background": "240 10% 4%", "--foreground": "0 0% 98%", "--muted-foreground": "240 5% 65%",
    "--border": "240 4% 16%", "--subtle": "240 4% 12%", "--inverse": "0 0% 98%", "--inverse-foreground": "240 10% 4%",
  },
};
/** 状态色（徽标、指标涨跌、危险按钮）：两套主题共用。 */
const TONE_VALUES: Readonly<Record<string, string>> = {
  "--danger": "0 72% 51%", "--danger-foreground": "0 0% 100%", "--success": "142 71% 36%", "--info": "199 89% 40%", "--warning": "32 95% 40%",
};
const tok = (name: string, prop: "bg" | "text" | "border", alpha?: string): string => `${prop}-[hsl(var(--${name})${alpha === undefined ? "" : `/${alpha}`})]`;
const PAL = {
  page: `${tok("background", "bg")} ${tok("foreground", "text")}`,
  muted: tok("muted-foreground", "text"),
  border: tok("border", "border"),
  subtle: tok("subtle", "bg"),
  inverse: `${tok("inverse", "bg")} ${tok("inverse-foreground", "text")}`,
  surface: tok("background", "bg"),
};

const PRIMARY = "bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]";

interface Ctx {
  readonly pal: typeof PAL;
  readonly r: (level: Level | "full") => string;
  readonly gap: (level: Level) => string;
  readonly pad: (level: Level) => string;
  readonly space: (level: Level) => string;
  /** 整个节点的跳转（`item` 缺省）：键是节点 id。 */
  readonly links: ReadonlyMap<string, number>;
  /** 某一项的跳转（tabs / 底部导航 / 列表的第 i 项）：键是 `${id}#${i}`。 */
  readonly itemLinks: ReadonlyMap<string, number>;
  /**
   * 深度 S4（#3988）：给这一页登记一个 `useState`，返回状态变量名（setter 是 `set` + 首字母大写）。
   * tabs / 底部导航的「当前项」、chip 的「选中」都是真状态——导出的代码点得动，不是一张截图。
   */
  readonly state: (initial: string) => string;
  /** 深度 S5：图标名 → 导出文件里那个图标组件的 JSX（`<IconHome />`）；没有这个图标 ⇒ 空串。 */
  readonly icon: (name: string | null | undefined) => string;
}

const str = (s: string): string => `{${JSON.stringify(s)}}`;
const cls = (...c: readonly (string | false | undefined)[]): string => `className="${c.filter(Boolean).join(" ")}"`;
const pad = (depth: number): string => "  ".repeat(depth);

const setter = (v: string): string => `set${v[0]!.toUpperCase()}${v.slice(1)}`;

/** 第 i 项点下去：先切到这一项，有跳转再跳。 */
function selectItem(n: Node, i: number, v: string, ctx: Ctx): string {
  const to = n.id === undefined ? undefined : ctx.itemLinks.get(`${n.id}#${i}`);
  return ` onClick={() => { ${setter(v)}(${i});${to === undefined ? "" : ` go(${to});`} }}`;
}

/** 状态驱动的类名：`className={cond ? "a" : "b"}`。 */
const clsIf = (cond: string, on: string, off: string): string => `className={${cond} ? ${JSON.stringify(on)} : ${JSON.stringify(off)}}`;

function go(n: Node, ctx: Ctx): string {
  const to = n.id === undefined ? undefined : ctx.links.get(n.id);
  return to === undefined ? "" : ` onClick={() => go(${to})} role="link" tabIndex={0}`;
}

/** 第 i 项自己的跳转（按钮类元素，不需要 role/tabIndex）。 */
function goItem(n: Node, i: number, ctx: Ctx): string {
  const to = n.id === undefined ? undefined : ctx.itemLinks.get(`${n.id}#${i}`);
  return to === undefined ? "" : ` onClick={() => go(${to})}`;
}

function el(depth: number, tag: string, attrs: string, inner: readonly string[] | string): string {
  const body = typeof inner === "string" ? [inner] : inner;
  if (body.length === 0) return `${pad(depth)}<${tag} ${attrs} />`;
  if (body.length === 1 && !body[0]!.includes("\n") && body[0]!.length < 80 && !body[0]!.startsWith(" ")) {
    return `${pad(depth)}<${tag} ${attrs}>${body[0]}</${tag}>`;
  }
  return `${pad(depth)}<${tag} ${attrs}>\n${body.join("\n")}\n${pad(depth)}</${tag}>`;
}

const TEXT_VARIANT: Readonly<Record<string, readonly [string, string]>> = {
  title: ["h1", "text-2xl font-semibold tracking-tight"],
  subtitle: ["h2", "text-lg font-medium"],
  body: ["p", "text-sm leading-relaxed"],
  caption: ["p", "text-xs"],
  label: ["p", "text-xs font-medium"],
};
const BTN_SIZE: Readonly<Record<string, string>> = { sm: "h-8 px-3 text-xs", md: "h-10 px-4 text-sm", lg: "h-12 px-6 text-base" };
const BADGE_TONE: Readonly<Record<string, string>> = {
  neutral: `${tok("subtle", "bg")} ${tok("foreground", "text")}`,
  info: `${tok("info", "bg", "0.12")} ${tok("info", "text")}`,
  success: `${tok("success", "bg", "0.12")} ${tok("success", "text")}`,
  warning: `${tok("warning", "bg", "0.12")} ${tok("warning", "text")}`,
  danger: `${tok("danger", "bg", "0.12")} ${tok("danger", "text")}`,
};
const RATIO: Readonly<Record<string, string>> = { square: "aspect-square", video: "aspect-video", wide: "aspect-[21/9]", portrait: "aspect-[3/4]" };

function children(n: Node, depth: number, ctx: Ctx): string[] {
  return designPrototype.isPrototypeContainer(n) ? n.children.map((c) => node(c, depth, ctx)) : [];
}

/** 一个节点 → JSX 源码。按契约的闭集逐个写；`switch` 穷尽由 TS 检查（新增原语忘了这里 ⇒ 编译错）。 */
function node(n: Node, depth: number, ctx: Ctx): string {
  const d = depth + 1;
  const { pal } = ctx;
  const link = go(n, ctx);
  const clickable = link === "" ? "" : "cursor-pointer";
  switch (n.type) {
    case "stack": {
      const p = n.props ?? {};
      const row = p.direction === "row";
      const align = p.align === "between" ? "justify-between items-center" : p.align === "center" ? (row ? "items-center justify-center" : "items-center") : p.align === "end" ? "items-end" : "";
      return el(depth, "div", cls("flex", row ? "flex-row" : "flex-col", ctx.gap(p.gap ?? "md"), p.padding !== undefined && ctx.pad(p.padding), align, p.fill === true && "flex-1", clickable) + link, children(n, d, ctx));
    }
    case "card": {
      const p = n.props ?? {};
      const title = p.title === undefined ? [] : [`${pad(d)}<h3 className="text-sm font-medium">${str(p.title)}</h3>`];
      return el(depth, "div", cls("flex flex-col border", pal.border, pal.surface, ctx.r(p.radius ?? "lg"), ctx.pad(p.padding ?? "md"), ctx.gap("sm"), clickable) + link, [...title, ...children(n, d, ctx)]);
    }
    case "grid": {
      const p = n.props ?? {};
      return el(depth, "div", cls("grid", p.columns === 3 ? "grid-cols-3" : "grid-cols-2", ctx.gap(p.gap ?? "md")) + link, children(n, d, ctx));
    }
    case "section": {
      const p = n.props ?? {};
      const tone = p.tone === "muted" ? pal.subtle : p.tone === "primary" ? PRIMARY : p.tone === "inverse" ? pal.inverse : "";
      return el(depth, "section", cls("flex flex-col", tone, ctx.pad(p.padding ?? "lg"), ctx.gap("md"), p.align === "center" && "items-center text-center"), children(n, d, ctx));
    }
    case "overlay": {
      const p = n.props ?? {};
      const kind = p.kind ?? "modal";
      const title = p.title === undefined ? [] : [`${pad(d + 1)}<h2 className="text-base font-semibold">${str(p.title)}</h2>`];
      const panel = el(d, "div", cls("flex flex-col", pal.surface, ctx.gap("md"), ctx.pad("lg"),
        kind === "sheet" ? "w-full rounded-t-2xl" : kind === "toast" ? "rounded-full px-4 py-2 text-sm shadow-lg" : "w-full max-w-sm rounded-2xl shadow-xl"),
        [...title, ...children(n, d + 1, ctx)]);
      if (kind === "toast") return el(depth, "div", cls("pointer-events-none absolute inset-x-0 bottom-6 flex justify-center"), [panel]);
      return el(depth, "div", `role="dialog" aria-modal="true" ${cls("absolute inset-0 flex justify-center bg-black/40", kind === "sheet" ? "items-end" : "items-center p-6")}`, [panel]);
    }
    case "navbar": {
      const p = n.props;
      return el(depth, "header", cls("flex h-12 items-center justify-between border-b px-4", pal.border) + link, [
        `${pad(d)}<span className="w-12 text-sm">${p.left === undefined ? "" : str(p.left)}</span>`,
        `${pad(d)}<span className="text-sm font-semibold">${str(p.title)}</span>`,
        `${pad(d)}<span className="w-12 text-right text-sm">${p.right === undefined ? "" : str(p.right)}</span>`,
      ]);
    }
    case "text": {
      const p = n.props;
      const [tag, style] = TEXT_VARIANT[p.variant ?? "body"] ?? TEXT_VARIANT.body!;
      const muted = p.muted === true || p.variant === "caption";
      return el(depth, tag, cls(style, muted && pal.muted, p.align === "center" && "text-center", p.align === "end" && "text-right", clickable) + link, str(p.content));
    }
    case "button": {
      const p = n.props;
      const v = p.variant ?? "primary";
      const look = v === "primary" ? PRIMARY : v === "danger" ? `${tok("danger", "bg")} ${tok("danger-foreground", "text")}` : v === "secondary" ? `border ${pal.border}` : "bg-transparent";
      return el(depth, "button", `type="button" ${cls("inline-flex items-center justify-center gap-1.5 font-medium", BTN_SIZE[p.size ?? "md"], ctx.r(p.radius ?? "md"), look, p.full === true && "w-full")}${link.replace(' role="link" tabIndex={0}', "")}`, `${ctx.icon(p.icon)}${str(p.label)}`);
    }
    case "input": {
      const p = n.props;
      const field = p.multiline === true
        ? `${pad(d)}<textarea rows={3} ${p.placeholder === undefined ? "" : `placeholder=${str(p.placeholder)} `}${p.value === undefined ? "" : `defaultValue=${str(p.value)} `}${cls("w-full border bg-transparent px-3 py-2 text-sm", pal.border, ctx.r("md"))} />`
        : `${pad(d)}<input ${p.placeholder === undefined ? "" : `placeholder=${str(p.placeholder)} `}${p.value === undefined ? "" : `defaultValue=${str(p.value)} `}${cls("h-10 w-full border bg-transparent px-3 text-sm", pal.border, ctx.r("md"))} />`;
      const label = p.label === undefined ? [] : [`${pad(d)}<span className="text-xs font-medium">${str(p.label)}</span>`];
      return el(depth, "label", cls("flex flex-col gap-1"), [...label, field]);
    }
    case "image": {
      const p = n.props;
      // 深度 S10：用户上传的真图原样带进代码（data URL，导出的文件仍然自包含、不依赖任何图片地址）。
      if (p.src !== undefined) {
        return el(depth, "img", `src=${str(p.src)} alt=${str(p.alt)} ${p.kind === "avatar" ? cls("h-12 w-12 rounded-full object-cover", clickable) : cls("w-full object-cover", RATIO[p.ratio ?? "video"], ctx.r("md"), clickable)}${link.replace(' role="link"', "")}`, []);
      }
      return el(depth, "div", `role="img" aria-label=${str(p.alt)} ${cls("flex w-full items-center justify-center text-xs", RATIO[p.ratio ?? "video"], pal.subtle, pal.muted, ctx.r("md"), clickable)}${link.replace(' role="link"', "")}`, str(p.alt));
    }
    case "list": {
      const p = n.props;
      const items = p.items.map((it, i) => {
        const marker = p.leading === "dot" ? `${pad(d + 1)}<span aria-hidden className="h-1.5 w-1.5 rounded-full bg-[hsl(var(--primary))]" />`
          : p.leading === "check" ? `${pad(d + 1)}<span aria-hidden className="text-[hsl(var(--primary))]">✓</span>`
          : p.leading === "avatar" ? `${pad(d + 1)}<span aria-hidden ${cls("flex h-8 w-8 items-center justify-center rounded-full text-xs", pal.subtle)}>${str(it.slice(0, 1))}</span>`
          : p.leading === "icon" && ctx.icon(p.icons?.[i]) !== "" ? `${pad(d + 1)}<span aria-hidden ${cls("flex shrink-0", pal.muted)}>${ctx.icon(p.icons?.[i])}</span>` : "";
        const detail = p.detail?.[i];
        const trailing = p.trailing?.[i];
        const itemGo = goItem(n, i, ctx);
        return el(d, "li", cls("flex items-center gap-3 py-3", itemGo !== "" && "cursor-pointer") + itemGo, [
          ...(marker === "" ? [] : [marker]),
          el(d + 1, "div", cls("flex min-w-0 flex-1 flex-col"), [
            `${pad(d + 2)}<span className="text-sm">${str(it)}</span>`,
            ...(detail === undefined || detail === "" ? [] : [`${pad(d + 2)}<span ${cls("text-xs", pal.muted)}>${str(detail)}</span>`]),
          ]),
          ...(trailing === undefined || trailing === "" ? [] : [`${pad(d + 1)}<span ${cls("text-xs", pal.muted)}>${str(trailing)}</span>`]),
        ]);
      });
      return el(depth, "ul", cls("flex flex-col divide-y", pal.border, clickable) + link, items);
    }
    case "divider":
      return `${pad(depth)}<hr ${cls(pal.border)} />`;
    case "spacer":
      return `${pad(depth)}<div aria-hidden ${cls(ctx.space(n.props?.size ?? "md"))} />`;
    case "tabs": {
      const p = n.props;
      const v = ctx.state(String(p.active ?? 0));
      return el(depth, "div", `role="tablist" ${cls("flex gap-1 border-b", pal.border)}`, p.items.map((it, i) =>
        `${pad(d)}<button type="button" role="tab" aria-selected={${v} === ${i}} ${clsIf(`${v} === ${i}`, "px-3 py-2 text-sm border-b-2 border-[hsl(var(--primary))] font-medium", `px-3 py-2 text-sm ${pal.muted}`)}${selectItem(n, i, v, ctx)}>${str(it)}</button>`));
    }
    case "badge":
      return el(depth, "span", cls("inline-flex w-fit items-center rounded-full px-2 py-0.5 text-xs font-medium", BADGE_TONE[n.props.tone ?? "neutral"]), str(n.props.label));
    case "avatar": {
      const size = n.props.size === "lg" ? "h-14 w-14 text-lg" : n.props.size === "sm" ? "h-8 w-8 text-xs" : "h-10 w-10 text-sm";
      return el(depth, "span", `aria-label=${str(n.props.name)} ${cls("inline-flex items-center justify-center rounded-full font-medium", size, pal.subtle)}`, str(n.props.name.slice(0, 1)));
    }
    case "bottomnav": {
      const p = n.props;
      const v = ctx.state(String(p.active ?? 0));
      return el(depth, "nav", `aria-label="底部导航" ${cls("mt-auto flex justify-around border-t py-2", pal.border)}`, p.items.map((it, i) =>
        `${pad(d)}<button type="button" aria-current={${v} === ${i} ? "page" : undefined} ${clsIf(`${v} === ${i}`, "flex flex-col items-center gap-0.5 px-2 py-1 text-xs font-medium text-[hsl(var(--primary))]", `flex flex-col items-center gap-0.5 px-2 py-1 text-xs ${pal.muted}`)}${selectItem(n, i, v, ctx)}>${ctx.icon(p.icons?.[i] ?? guessNavIcon(it))}${str(it)}</button>`));
    }
    case "switch":
      return el(depth, "label", cls("flex items-center justify-between gap-3 text-sm"), [
        `${pad(d)}<span>${str(n.props.label)}</span>`,
        `${pad(d)}<input type="checkbox" role="switch" defaultChecked={${n.props.on === true}} className="h-5 w-9 accent-[hsl(var(--primary))]" />`,
      ]);
    case "checkbox":
      return el(depth, "label", cls("flex items-center gap-2 text-sm"), [
        `${pad(d)}<input type="checkbox" defaultChecked={${n.props.checked === true}} className="h-4 w-4 accent-[hsl(var(--primary))]" />`,
        `${pad(d)}<span>${str(n.props.label)}</span>`,
      ]);
    case "chip": {
      const v = ctx.state(String(n.props.selected === true));
      return el(depth, "button", `type="button" aria-pressed={${v}} ${clsIf(v, `rounded-full border px-3 py-1 text-xs ${PRIMARY}`, `rounded-full border px-3 py-1 text-xs ${pal.border}`)} onClick={() => ${setter(v)}((x) => !x)}`, str(n.props.label));
    }
    case "progress": {
      const p = n.props;
      return el(depth, "div", cls("flex flex-col gap-1"), [
        ...(p.label === undefined ? [] : [`${pad(d)}<span ${cls("text-xs", pal.muted)}>${str(p.label)}</span>`]),
        el(d, "div", `role="progressbar" aria-valuenow={${p.value}} aria-valuemin={0} aria-valuemax={100} ${cls("h-2 w-full overflow-hidden rounded-full", pal.subtle)}`,
          `<div className="h-full bg-[hsl(var(--primary))]" style={{ width: "${p.value}%" }} />`),
      ]);
    }
    case "stat": {
      const p = n.props;
      const tone = p.tone === "success" ? tok("success", "text") : p.tone === "danger" ? tok("danger", "text") : pal.muted;
      return el(depth, "div", cls("flex flex-col gap-1"), [
        `${pad(d)}<span ${cls("text-xs", pal.muted)}>${str(p.label)}</span>`,
        `${pad(d)}<span className="text-2xl font-semibold">${str(p.value)}</span>`,
        ...(p.delta === undefined ? [] : [`${pad(d)}<span ${cls("text-xs", tone)}>${str(p.delta)}</span>`]),
      ]);
    }
    case "hero": {
      const p = n.props;
      return el(depth, "div", cls("flex flex-col gap-3 py-8"), [
        `${pad(d)}<h1 className="text-3xl font-bold tracking-tight">${str(p.title)}</h1>`,
        ...(p.subtitle === undefined ? [] : [`${pad(d)}<p ${cls("text-base", pal.muted)}>${str(p.subtitle)}</p>`]),
        ...(p.cta === undefined ? [] : [`${pad(d)}<button type="button" ${cls("inline-flex h-11 w-fit items-center px-6 text-sm font-medium", PRIMARY, ctx.r("md"))}${link.replace(' role="link" tabIndex={0}', "")}>${str(p.cta)}</button>`]),
      ]);
    }
    case "table": {
      const p = n.props;
      return el(depth, "div", cls("overflow-x-auto"), [el(d, "table", cls("w-full text-left text-sm"), [
        el(d + 1, "thead", cls(pal.muted), [el(d + 2, "tr", "", p.columns.map((c) => `${pad(d + 3)}<th className="px-3 py-2 font-medium">${str(c)}</th>`))]),
        el(d + 1, "tbody", "", p.rows.map((row, i) => el(d + 2, "tr", cls("border-t", pal.border, p.striped === true && i % 2 === 1 && pal.subtle),
          row.map((cell) => `${pad(d + 3)}<td className="px-3 py-2">${str(cell)}</td>`)))),
      ])]);
    }
    case "chart": {
      const p = n.props;
      const values = p.values.slice(0, p.labels.length);
      const max = Math.max(...values, 0);
      const min = Math.min(...values, 0);
      const span = max - min || 1;
      const title = p.title === undefined ? [] : [`${pad(d)}<h3 className="text-sm font-medium">${str(p.title)}</h3>`];
      const labels = el(d, "div", cls("flex justify-between text-xs", pal.muted), p.labels.map((l) => `${pad(d + 1)}<span>${str(l)}</span>`));
      if (p.kind === "line") {
        const pts = values.map((v, i) => `${values.length === 1 ? 50 : (i / (values.length - 1)) * 100},${40 - ((v - min) / span) * 36 - 2}`).join(" ");
        return el(depth, "figure", cls("flex flex-col gap-2"), [...title,
          `${pad(d)}<svg viewBox="0 0 100 40" preserveAspectRatio="none" className="h-32 w-full" role="img" aria-label=${str(p.title ?? "折线图")}><polyline points="${pts}" fill="none" stroke="hsl(var(--primary))" strokeWidth="1.5" vectorEffect="non-scaling-stroke" /></svg>`,
          labels]);
      }
      return el(depth, "figure", cls("flex flex-col gap-2"), [...title,
        el(d, "div", cls("flex h-32 items-end gap-2"), values.map((v, i) =>
          `${pad(d + 1)}<div title=${str(`${p.labels[i] ?? ""}: ${v}${p.unit ?? ""}`)} className="flex-1 rounded-t bg-[hsl(var(--primary))]" style={{ height: "${Math.max(2, ((v - Math.min(min, 0)) / span) * 100).toFixed(1)}%" }} />`)),
        labels]);
    }
    case "select": {
      const p = n.props;
      return el(depth, "label", cls("flex flex-col gap-1"), [
        ...(p.label === undefined ? [] : [`${pad(d)}<span className="text-xs font-medium">${str(p.label)}</span>`]),
        el(d, "select", `${p.value === undefined ? "" : `defaultValue=${str(p.value)} `}${cls("h-10 w-full border bg-transparent px-3 text-sm", pal.border, ctx.r("md"))}`,
          p.options.map((o) => `${pad(d + 1)}<option value=${str(o)}>${str(o)}</option>`)),
      ]);
    }
    case "radio": {
      const p = n.props;
      const name = JSON.stringify(`radio-${n.id ?? p.options.join("-")}`);
      return el(depth, "fieldset", cls("flex flex-col gap-2"), [
        ...(p.label === undefined ? [] : [`${pad(d)}<legend className="mb-1 text-xs font-medium">${str(p.label)}</legend>`]),
        ...p.options.map((o, i) => el(d, "label", cls("flex items-center gap-2 text-sm"), [
          `${pad(d + 1)}<input type="radio" name={${name}} defaultChecked={${i === p.selected}} className="accent-[hsl(var(--primary))]" />`,
          `${pad(d + 1)}<span>${str(o)}</span>`,
        ])),
      ]);
    }
    case "footer": {
      const p = n.props;
      return el(depth, "footer", cls("flex flex-col gap-3 border-t px-6 py-8 text-sm", pal.border), [
        `${pad(d)}<span className="font-semibold">${str(p.brand)}</span>`,
        ...(p.links === undefined || p.links.length === 0 ? [] : [el(d, "nav", cls("flex flex-wrap gap-4", pal.muted), p.links.map((l) => `${pad(d + 1)}<a href="#">${str(l)}</a>`))]),
        ...(p.note === undefined ? [] : [`${pad(d)}<p ${cls("text-xs", pal.muted)}>${str(p.note)}</p>`]),
      ]);
    }
  }
}

/** 标准 Tailwind 版的项目级圆角 / 密度——层级表取自画布（单源），只翻类名。 */
function scale(tokens: designWorkbench.DesignTokens | undefined) {
  const radius = tokens?.radius ?? "default";
  const density = tokens?.density ?? "default";
  return {
    r: (level: Level | "full") => { const c = RADIUS_BY_SCALE[radius][level]; return STOCK_RADIUS[c] ?? c; },
    gap: (level: Level) => GAP_BY_DENSITY[density][level],
    pad: (level: Level) => PAD_BY_DENSITY[density][level],
    space: (level: Level) => SPACE_BY_DENSITY[density][level],
  };
}

/** 项目的主色（HSL 三元组）：品牌色 > 强调色档位 > 调用方给的中性默认。 */
function primaryOf(project: Pick<DesignProject, "accent" | "tokens" | "theme">, neutral: designWorkbench.PrototypeAccentTokens): designWorkbench.PrototypeAccentTokens {
  const brand = project.tokens?.brand;
  if (brand != null) return designWorkbench.brandAccentTokens(brand);
  if (project.accent === "neutral") return neutral;
  return designWorkbench.PROTOTYPE_ACCENTS[project.accent][project.theme];
}

/** 中性档的兜底主色：调用方没给页面当下的值时用（jsdom / 服务端）。 */
export const EXPORT_NEUTRAL_PRIMARY: designWorkbench.PrototypeAccentTokens = { primary: "240 6% 10%", foreground: "0 0% 98%" };

/** 图标组件名：`home` → `IconHome`，`more` → `IconMore`。 */
const iconComponent = (name: string): string => `Icon${name.replace(/(^|[-_])(\w)/g, (_m, _s, c: string) => c.toUpperCase())}`;

/** SVG 里允许出现的元素：图标只由这些画成。别的一律不认——宁可少一个图标，不往导出物里塞看不懂的标记。 */
const SVG_TAGS = new Set(["svg", "path", "circle", "line", "rect", "polyline", "polygon", "ellipse", "g"]);

/**
 * 深度 S5：把 `renderToStaticMarkup` 出来的 SVG 转成 JSX。只做三件事：`class` 去掉（那是 lucide 的类名，
 * 别人的项目里没有）、带连字符的属性转驼峰（`aria-*` / `data-*` 保持原样）、标签必须在白名单里。
 * 转不了 ⇒ `null`（这个图标不导出，不塞半截标记）。
 */
export function svgToJsx(svg: string): string | null {
  const tags = [...svg.matchAll(/<\/?([a-zA-Z]+)/g)].map((m) => m[1]!.toLowerCase());
  if (tags.length === 0 || tags[0] !== "svg" || tags.some((t) => !SVG_TAGS.has(t))) return null;
  return svg
    .replace(/\s+class="[^"]*"/g, "")
    .replace(/\s([a-z]+(?:-[a-z]+)+)=/g, (m, name: string) => (name.startsWith("aria-") || name.startsWith("data-") ? m : ` ${name.replace(/-([a-z])/g, (_x, c: string) => c.toUpperCase())}=`));
}

export function buildPrototypeReactTsx(
  project: Pick<DesignProject, "name" | "frames" | "prototype" | "frameLinks" | "accent" | "tokens" | "theme">,
  opts: {
    readonly now?: Date;
    readonly neutral?: designWorkbench.PrototypeAccentTokens;
    /** 深度 S5：图标名 → SVG 标记（`iconSvgs` 用画布同一张表渲染）。不给 ⇒ 导出物不带图标。 */
    readonly icons?: Readonly<Record<string, string>>;
  } = {},
): string {
  const iconJsx = new Map<string, string>();
  for (const [name, svg] of Object.entries(opts.icons ?? {})) {
    const jsx = svgToJsx(svg);
    if (jsx !== null) iconJsx.set(name, jsx);
  }
  const usedIconNames = new Set<string>();
  const icon = (name: string | null | undefined): string => {
    if (name === null || name === undefined || !iconJsx.has(name)) return "";
    usedIconNames.add(name);
    return `<${iconComponent(name)} />`;
  };
  const theme = project.theme === "dark" ? "dark" : "light";
  const pal = PAL;
  const s = scale(project.tokens);
  const primary = primaryOf(project, opts.neutral ?? EXPORT_NEUTRAL_PRIMARY);
  const font = designWorkbench.PROTOTYPE_FONT_STACKS[project.tokens?.font ?? "sans"];
  const screens = project.frames.map((frame, i) => {
    const all = project.frameLinks?.[i] ?? [];
    const links = new Map(all.filter((l) => l.item === undefined).map((l) => [l.from, l.to] as const));
    const itemLinks = new Map(all.filter((l) => l.item !== undefined).map((l) => [`${l.from}#${l.item}`, l.to] as const));
    const root = project.prototype[i] ?? null;
    const hooks: string[] = [];
    const state = (initial: string): string => {
      const v = `s${hooks.length + 1}`;
      hooks.push(`  const [${v}, ${setter(v)}] = useState(${initial});`);
      return v;
    };
    const body = root === null
      ? `      <p className="p-6 text-sm">{${JSON.stringify(`「${frame}」这一页还没画出来`)}}</p>`
      : node(root, 3, { pal, links, itemLinks, state, icon, ...s });
    return [
      `/** 第 ${i + 1} 页：${frame.replace(/\*\//g, "* /")} */`,
      `function Screen${i + 1}({ go }: { go: Go }) {`,
      ...hooks,
      `  void go;`,
      `  return (`,
      `    <div className="relative flex min-h-[640px] flex-col">`,
      body,
      `    </div>`,
      `  );`,
      `}`,
    ].join("\n");
  });
  const stamp = localDateStamp(opts.now ?? new Date());
  return [
    `"use client";`,
    `/**`,
    ` * ${project.name.replace(/\*\//g, "* /")} —— 由 WorkSpaceX 设计工作台导出的 React 原型（${stamp}）。`,
    ` *`,
    ` * 一个文件，只依赖 react；样式是标准 Tailwind CSS 类名。每页一个组件，默认导出带页面切换，`,
    ` * 原型里连好的跳转就是 onClick={() => go(n)}。颜色全部走 CSS 变量，换配色只改下面 THEME 一处。`,
    ` */`,
    `import { useState, type CSSProperties, type ReactElement } from "react";`,
    ``,
    `type Go = (screen: number) => void;`,
    ``,
    `const THEME = {`,
    `  "--primary": ${JSON.stringify(primary.primary)},`,
    `  "--primary-foreground": ${JSON.stringify(primary.foreground)},`,
    ...Object.entries({ ...THEME_VALUES[theme], ...TONE_VALUES }).map(([k, val]) => `  ${JSON.stringify(k)}: ${JSON.stringify(val)},`),
    ...(font === "inherit" ? [] : [`  fontFamily: ${JSON.stringify(font)},`]),
    `} as CSSProperties;`,
    ``,
    ...[...usedIconNames].sort().map((name) => `function ${iconComponent(name)}() {\n  return (${iconJsx.get(name)!});\n}\n`),
    screens.join("\n\n"),
    ``,
    `const SCREENS: { name: string; Component: (props: { go: Go }) => ReactElement }[] = [`,
    ...project.frames.map((f, i) => `  { name: ${JSON.stringify(f)}, Component: Screen${i + 1} },`),
    `];`,
    ``,
    `export default function Prototype() {`,
    `  const [screen, setScreen] = useState(0);`,
    `  const Current = SCREENS[screen]?.Component ?? SCREENS[0]!.Component;`,
    `  return (`,
    `    <div style={THEME} className="min-h-screen ${pal.page}">`,
    `      <nav aria-label="页面" className="flex gap-1 overflow-x-auto border-b ${pal.border} p-2 text-xs">`,
    `        {SCREENS.map((s, i) => (`,
    `          <button key={s.name + i} type="button" onClick={() => setScreen(i)} aria-current={i === screen ? "page" : undefined}`,
    `            className={i === screen ? "rounded-md px-2 py-1 font-medium ${PRIMARY}" : "rounded-md px-2 py-1"}>{s.name}</button>`,
    `        ))}`,
    `      </nav>`,
    `      <main className="mx-auto max-w-5xl">`,
    `        <Current go={setScreen} />`,
    `      </main>`,
    `    </div>`,
    `  );`,
    `}`,
    ``,
  ].join("\n");
}

export function prototypeReactFileName(name: string, now: Date = new Date(), romanize?: Romanize | null): string {
  return `${exportFileStem(name, "design", romanize)}-prototype-${localDateStamp(now)}.tsx`;
}
