/**
 * 设计工作台「HTML 页」——模型直接写一整页 HTML+CSS，画布用沙箱 iframe 渲染。
 *
 * ## 为什么有它
 *
 * 树形原语（`design-prototype.ts` 的 21 个原语）只能表达「结构」，表达不了版式、留白、字体气质、
 * 插画与图形——盲写一棵 JSON 树的模型看不见自己画了什么，产出「指标达标但不专业」是必然的。
 * HTML 页把模型放回它最擅长的表达形式（`frontend-design` skill 写给的正是这个场景）。
 * 它以**一个 `html` 叶子节点**的形态存进页面的 `root`，所以存储 / 版本 / 分享 / 导出全走既有通道。
 *
 * ## 安全边界（三层，缺一不可）
 *
 * 1. **本文件的 `sanitizeHtmlPage`**：入库前清洗——标签与属性白名单，脚本 / 外链 / 事件处理器一概不留。
 *    这一层是**纵深防御的第一层，不是唯一一层**：
 * 2. 渲染时 iframe `sandbox="allow-scripts"`（**不给** `allow-same-origin`）：即便清洗有漏，
 *    页面也是不透明源，读不到 cookie / 存储 / 父页面 DOM，也不能导航顶层；
 * 3. srcdoc 里的 CSP `default-src 'none'`，脚本只认我们自己带 nonce 的那一段（跳转桥），
 *    模型写的任何脚本、外部请求都被浏览器挡下。
 *
 * ## 跳转
 *
 * 模型只写 `data-goto="<页序号>"`（可选），不写 JS。`htmlPageLinks` 把它们翻成既有的 `PrototypeLink`，
 * 所以「哪个元素去哪一页」的事实**只在 HTML 里有一份**——`screen.links` 是它的投影，入库时重算，不许手写。
 */

/** 单页 HTML（清洗后）的字符上限。 */
export const HTML_PAGE_MAX_CHARS = 60_000;
/** 单页 HTML 至少要有多少可见文字才算「画了东西」（质量门用）。 */
export const HTML_PAGE_MIN_VISIBLE_CHARS = 40;

/** 整段丢弃（连同内容）的元素：能执行、能加载外部内容、或不该出现在一页原型里的。 */
const DROP_WITH_CONTENT = new Set([
  "script", "iframe", "frame", "frameset", "object", "embed", "applet", "noscript", "template",
  "title", "audio", "video", "canvas", "math", "portal", "dialog",
]);

/** 保留的元素。其余标签**只去标签、留内容**（`html`/`head`/`body`/`meta`/`link` 就是这么消失的）。 */
const ALLOWED_TAGS = new Set([
  "div", "span", "p", "h1", "h2", "h3", "h4", "h5", "h6", "ul", "ol", "li", "a", "button", "img",
  "section", "header", "footer", "nav", "main", "aside", "article", "figure", "figcaption",
  "table", "thead", "tbody", "tfoot", "tr", "th", "td", "caption", "colgroup", "col",
  "label", "input", "textarea", "select", "option", "optgroup", "form", "fieldset", "legend",
  "small", "strong", "em", "b", "i", "u", "s", "br", "hr", "blockquote", "code", "pre", "mark",
  "sup", "sub", "dl", "dt", "dd", "details", "summary", "abbr", "time", "kbd", "cite", "q",
  "style",
  // SVG：插画与图标是「不像线框」的关键，只放绘图相关的，不放 script/foreignObject/use/image
  "svg", "g", "path", "circle", "rect", "line", "polyline", "polygon", "ellipse", "text", "tspan",
  "defs", "lineargradient", "radialgradient", "stop", "clippath", "mask", "pattern",
]);

const VOID_TAGS = new Set(["br", "hr", "img", "input", "col", "stop", "path", "circle", "rect", "line", "polyline", "polygon", "ellipse"]);

const GLOBAL_ATTRS = new Set(["class", "id", "style", "title", "role", "lang", "dir", "tabindex", "hidden"]);
const TAG_ATTRS: Readonly<Record<string, ReadonlySet<string>>> = {
  a: new Set(["href"]),
  img: new Set(["src", "alt", "width", "height", "loading"]),
  input: new Set(["type", "placeholder", "value", "checked", "disabled", "name", "readonly", "min", "max", "step"]),
  textarea: new Set(["placeholder", "rows", "cols", "disabled", "name", "readonly"]),
  select: new Set(["disabled", "name", "multiple"]),
  option: new Set(["value", "selected", "disabled"]),
  button: new Set(["type", "disabled"]),
  label: new Set(["for"]),
  td: new Set(["colspan", "rowspan"]),
  th: new Set(["colspan", "rowspan", "scope"]),
  col: new Set(["span"]),
  ol: new Set(["start", "reversed"]),
  details: new Set(["open"]),
  time: new Set(["datetime"]),
};
const SVG_TAGS = new Set([
  "svg", "g", "path", "circle", "rect", "line", "polyline", "polygon", "ellipse", "text", "tspan",
  "defs", "lineargradient", "radialgradient", "stop", "clippath", "mask", "pattern",
]);
const SVG_ATTRS = new Set([
  "viewbox", "width", "height", "fill", "stroke", "stroke-width", "stroke-linecap", "stroke-linejoin", "stroke-dasharray",
  "stroke-opacity", "fill-opacity", "fill-rule", "clip-rule", "opacity", "d", "cx", "cy", "r", "rx", "ry", "x", "y", "x1", "y1",
  "x2", "y2", "points", "transform", "offset", "stop-color", "stop-opacity", "gradientunits", "gradienttransform",
  "font-size", "font-weight", "font-family", "text-anchor", "dominant-baseline", "preserveaspectratio", "id", "class",
  "style", "role", "aria-hidden", "patternunits", "clip-path", "mask",
]);

/** `data-goto` 与 `data-link` 是我们自己的两个协议属性；别的 `data-*` 不留（没有用途就不开口子）。 */
const GOTO_ATTR = "data-goto";
const LINK_ATTR = "data-link";
/**
 * 元素编号：清洗时按文档顺序给每个「值得单独选中」的元素补一个 `data-ref="r<N>"`。
 * 画布上点哪个元素就选哪个（精确到元素，不是整块区域）；模型只改被选中的那一个，见 `replaceHtmlPageElement`。
 * 输入里自带的 `data-ref` 一律丢掉重编——编号是服务端事实，不是模型写的；同一份 HTML 重编结果相同（幂等）。
 */
const REF_ATTR = "data-ref";
const REF_TAGS = new Set([
  "div", "span", "p", "h1", "h2", "h3", "h4", "h5", "h6", "ul", "ol", "li", "a", "button", "img", "section", "header", "footer",
  "nav", "main", "aside", "article", "figure", "figcaption", "table", "tr", "td", "th", "label", "input", "textarea", "select",
  "form", "small", "strong", "em", "b", "i", "blockquote", "svg",
]);

const IMG_DATA_URI = /^data:image\/(?:png|jpe?g|gif|webp|svg\+xml)[;,]/i;

/** CSS 里只做「最明显的坏东西」的清理——真正的边界是 iframe 沙箱与 CSP，这里不追求穷尽。 */
function sanitizeCss(css: string): string {
  return css
    .replace(/\\/g, "") // 去掉 CSS 转义，堵 `\75rl(` 之类的绕行
    .replace(/@import[^;]*;?/gi, "")
    .replace(/@charset[^;]*;?/gi, "")
    .replace(/expression\s*\(/gi, "none(")
    .replace(/behavior\s*:[^;}]*/gi, "")
    .replace(/-moz-binding\s*:[^;}]*/gi, "")
    .replace(/javascript\s*:/gi, "")
    .replace(/(?:https?:)?\/\/[^\s)'";]+/gi, "") // 任何远程地址一律抹掉（转义绕行后残留的也不留）
    .replace(/url\(\s*(['"]?)(?!data:image\/)[^)]*\)/gi, "none");
}

function escapeAttr(v: string): string {
  return v.replace(/&(?![a-zA-Z0-9#]{1,10};)/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeText(v: string): string {
  return v.replace(/</g, "&lt;");
}

const COMMENT_OR_TAG = /<!--[\s\S]*?-->|<!doctype[^>]*>|<\?[^>]*>|<\/([a-zA-Z][a-zA-Z0-9:-]*)\s*>|<([a-zA-Z][a-zA-Z0-9:-]*)((?:"[^"]*"|'[^']*'|[^'">])*)>/gi;
const ATTR_RE = /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

export interface SanitizedHtmlPage {
  /** 清洗后的片段（`<style>` + 正文元素），可直接放进 iframe 的 `<body>`。 */
  readonly html: string;
  /** 被丢掉的东西的摘要（给日志与「为什么这页少了东西」用），去重、最多 12 条。 */
  readonly removed: readonly string[];
}

/**
 * 清洗模型给的一页 HTML。幂等：`sanitize(sanitize(x)).html === sanitize(x).html`。
 * 从不抛：任何输入都返回一个（可能为空的）片段。
 */
export function sanitizeHtmlPage(input: string): SanitizedHtmlPage {
  const removed = new Set<string>();
  const note = (s: string): void => { if (removed.size < 12) removed.add(s); };
  const src = input.length > HTML_PAGE_MAX_CHARS * 2 ? input.slice(0, HTML_PAGE_MAX_CHARS * 2) : input;

  let out = "";
  let cursor = 0;
  let gotoSeq = 0;
  let refSeq = 0;
  const usedLinkIds = new Set<string>();
  const re = new RegExp(COMMENT_OR_TAG.source, "gi");

  const skipUntilClose = (name: string, from: number): number => {
    const close = new RegExp(`</${name}\\s*>`, "gi");
    close.lastIndex = from;
    const m = close.exec(src);
    return m === null ? src.length : m.index + m[0].length;
  };

  for (let m = re.exec(src); m !== null; m = re.exec(src)) {
    out += escapeText(src.slice(cursor, m.index));
    cursor = m.index + m[0].length;

    if (m[0].startsWith("<!--") || m[0].startsWith("<?") || m[0].toLowerCase().startsWith("<!doctype")) continue;

    const closeName = m[1]?.toLowerCase();
    if (closeName !== undefined) {
      if (ALLOWED_TAGS.has(closeName) && !VOID_TAGS.has(closeName)) out += `</${closeName}>`;
      continue;
    }

    const name = (m[2] ?? "").toLowerCase();
    if (DROP_WITH_CONTENT.has(name)) {
      note(`<${name}>`);
      const end = skipUntilClose(name, cursor);
      cursor = end;
      re.lastIndex = end;
      continue;
    }
    if (name === "style") {
      const end = skipUntilClose("style", cursor);
      const body = src.slice(cursor, end).replace(/<\/style\s*>\s*$/i, "");
      cursor = end;
      re.lastIndex = end;
      const css = sanitizeCss(body);
      if (css.trim() !== "") out += `<style>${css}</style>`;
      continue;
    }
    if (!ALLOWED_TAGS.has(name)) continue; // 只去标签、留内容

    const perTag = TAG_ATTRS[name];
    const isSvg = SVG_TAGS.has(name);
    let attrs = "";
    let goto: string | null = null;
    let link: string | null = null;
    const attrSrc = m[3] ?? "";
    const ar = new RegExp(ATTR_RE.source, "g");
    for (let a = ar.exec(attrSrc); a !== null; a = ar.exec(attrSrc)) {
      const key = (a[1] ?? "").toLowerCase();
      const raw = a[2] ?? a[3] ?? a[4] ?? "";
      if (key === "") continue;
      if (key.startsWith("on")) { note(`属性 ${key}`); continue; }
      if (key === REF_ATTR) continue; // 重编，不信输入里的
      if (key === GOTO_ATTR) { if (/^\d{1,2}$/.test(raw.trim())) goto = raw.trim(); continue; }
      if (key === LINK_ATTR) { if (/^[A-Za-z0-9_-]{1,32}$/.test(raw.trim())) link = raw.trim(); continue; }
      if (key.startsWith("aria-") && /^[a-z-]+$/.test(key)) { attrs += ` ${key}="${escapeAttr(raw)}"`; continue; }

      const allowed = isSvg ? SVG_ATTRS.has(key) : GLOBAL_ATTRS.has(key) || (perTag?.has(key) ?? false);
      if (!allowed) { note(`属性 ${key}`); continue; }

      if (key === "style") { attrs += ` style="${escapeAttr(sanitizeCss(raw))}"`; continue; }
      if (key === "href") {
        // 只留页内锚点：真要去别的页用 data-goto。外链一律改成 #，不让原型里出现能点出去的链接。
        attrs += ` href="${raw.trim().startsWith("#") ? escapeAttr(raw.trim()) : "#"}"`;
        if (!raw.trim().startsWith("#")) note("外部链接");
        continue;
      }
      if (key === "src") {
        if (IMG_DATA_URI.test(raw.trim())) attrs += ` src="${escapeAttr(raw.trim())}"`;
        else note("外部图片");
        continue;
      }
      if ((key === "clip-path" || key === "mask" || key === "fill" || key === "stroke") && /url\(/i.test(raw) && !/^url\(\s*#[\w-]+\s*\)$/i.test(raw.trim())) {
        note(`svg ${key} 外链`);
        continue;
      }
      attrs += raw === "" && (key === "checked" || key === "disabled" || key === "selected" || key === "hidden" || key === "open" || key === "multiple" || key === "readonly" || key === "reversed")
        ? ` ${key}`
        : ` ${key}="${escapeAttr(raw)}"`;
    }
    if (goto !== null) {
      let id = link ?? `goto-${goto}-${gotoSeq}`;
      while (usedLinkIds.has(id)) id = `${id.slice(0, 26)}-${(gotoSeq += 1)}`;
      usedLinkIds.add(id);
      gotoSeq += 1;
      attrs += ` ${LINK_ATTR}="${id}" ${GOTO_ATTR}="${goto}"`;
    }
    if (REF_TAGS.has(name)) { refSeq += 1; attrs += ` ${REF_ATTR}="r${String(refSeq)}"`; }
    // form 只是个容器：不带 action/method（上面白名单里本来就没有），也不让它真的提交（渲染层不给 allow-forms）。
    out += `<${name}${attrs}${VOID_TAGS.has(name) ? " /" : ""}>`;
  }
  out += escapeText(src.slice(cursor));

  let html = out.trim();
  if (html.length > HTML_PAGE_MAX_CHARS) {
    note("超长被截断");
    html = html.slice(0, HTML_PAGE_MAX_CHARS);
  }
  return { html, removed: [...removed] };
}

/** 去掉标签与 `<style>` 之后的可见文字（折叠空白）。 */
export function htmlPageVisibleText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export interface HtmlPageLink {
  readonly from: string;
  readonly to: number;
}

/** 从（清洗后的）HTML 里读出「哪个元素去哪一页」。`from` 是清洗时补齐的 `data-link` id。 */
export function htmlPageLinks(html: string): readonly HtmlPageLink[] {
  const out: HtmlPageLink[] = [];
  const re = /<[a-z][^>]*?\sdata-link="([A-Za-z0-9_-]{1,32})"[^>]*?\sdata-goto="(\d{1,2})"/gi;
  for (let m = re.exec(html); m !== null; m = re.exec(html)) out.push({ from: m[1]!, to: Number(m[2]) });
  return out;
}

/** 这页里有多少个可点击的东西（button / a / input / select / 带 data-goto 的元素）。 */
export function htmlPageInteractiveCount(html: string): number {
  return (html.match(/<(button|a|input|select|textarea)\b/gi) ?? []).length + (html.match(/\sdata-goto=/gi) ?? []).length;
}

/** 取出某个编号元素的 HTML（含自身）。找不到 ⇒ `null`。只认清洗后的 HTML，嵌套按同名标签配平。 */
export function htmlPageElement(html: string, ref: string): { readonly start: number; readonly end: number; readonly html: string } | null {
  if (!/^r\d{1,5}$/.test(ref)) return null;
  const open = new RegExp(`<([a-z][a-z0-9]*)\\b[^>]*\\sdata-ref="${ref}"[^>]*>`, "i").exec(html);
  if (open === null) return null;
  const name = open[1]!.toLowerCase();
  const start = open.index;
  if (VOID_TAGS.has(name) || open[0].endsWith("/>")) return { start, end: start + open[0].length, html: open[0] };
  const tag = new RegExp(`<(/?)${name}\\b[^>]*>`, "gi");
  tag.lastIndex = start + open[0].length;
  let depth = 1;
  for (let m = tag.exec(html); m !== null; m = tag.exec(html)) {
    depth += m[1] === "/" ? -1 : 1;
    if (depth === 0) return { start, end: m.index + m[0].length, html: html.slice(start, m.index + m[0].length) };
  }
  return null;
}

/** 某个编号元素的一句话描述（标签 + 开头的文字），给焦点 chip 与模型用。 */
export function describeHtmlPageElement(html: string, ref: string): string | null {
  const el = htmlPageElement(html, ref);
  if (el === null) return null;
  const tag = /^<([a-z0-9]+)/i.exec(el.html)?.[1]?.toLowerCase() ?? "元素";
  const text = htmlPageVisibleText(el.html).slice(0, 24);
  return text === "" ? `<${tag}>` : `<${tag}>「${text}」`;
}

/**
 * 只替换被选中的那一个元素（可选地往页面 `<style>` 末尾追加几条规则），整页再过一遍清洗。
 * 这就是「局部修改」：模型只看见并只改这一块，其余版面逐字不动，也省 token。
 * 编号不存在 ⇒ `null`（页面在选中之后变过了，调用方退回整页修改）。
 */
export function replaceHtmlPageElement(html: string, ref: string, replacement: string, addCss = ""): string | null {
  const el = htmlPageElement(html, ref);
  if (el === null) return null;
  let next = html.slice(0, el.start) + replacement + html.slice(el.end);
  if (addCss.trim() !== "") {
    const css = addCss.replace(/<\/?style[^>]*>/gi, "");
    next = /<\/style>/i.test(next) ? next.replace(/<\/style>(?![\s\S]*<\/style>)/i, `\n${css}\n</style>`) : `<style>${css}</style>${next}`;
  }
  return sanitizeHtmlPage(next).html;
}
