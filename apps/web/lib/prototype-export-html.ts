/**
 * 迭代 12（design-delta `paged-generation-and-doc-export` §3）—— 导出**自包含、可点击**的 HTML。
 *
 * ## 为什么不是另写一个渲染器
 *
 * 签核取舍 ①=A：导出与实时画布共用**同一个事实源**。这里的做法是
 *   · **结构**：`renderToStaticMarkup` 渲染**同一批 React 组件**（`PrototypeCanvas`）——
 *     不是"照着画一遍"，是同一份代码，所以新增一个原语只改渲染表一处（V47 钉它）。
 *   · **样式**：从**页面自己的 stylesheet** 里把用到的规则抽出来内联，而不是手抄一份 CSS。
 *     产物里的样式字面上就是这个 app 正在用的那份，没有第二处声明可漂。
 *
 * 抽样式这一步只在浏览器里做得到（要读 `document.styleSheets`），所以本模块分两半：
 * `buildPrototypeExportHtml` 是纯函数（吃 markup + css 字符串，可单测），
 * `collectPageCss` 碰 DOM（只在点导出时调）。
 *
 * ## 自包含的含义（V46 钉它）
 * 无外链：不引 CDN、不引字体文件、没有 `<script src>`。字体走系统栈。
 * 换页那一小段脚本是**内联**的，且只做一件事：显示/隐藏页。
 */
import { designPrototype } from "@repo/contracts";
import type { DesignProject } from "@/lib/live-design-workbench";

/**
 * 迭代 23 —— 产物外壳（页签、分隔线、次要文字）的配色。
 *
 * 此前这几处是**硬编码的深色值**（`#33343a` / `#17181c` / `#a0a0a8`），而 `body` 的底色
 * 按项目 theme 切换。于是浅色项目导出来是：米白底上扣着一排近黑的药丸页签、深灰的分隔线。
 * 「原型自己的明暗主题」这件事只做了一半——画布那一半跟着 token 走了，外壳没跟上。
 *
 * 不复用画布的 CSS 变量：外壳不在画布的作用域里（`.wx-light` 加在 `<html>` 上，而
 * `collectPageCss` 抽的是画布用到的规则），硬要共用就得把整套 token 也搬进产物并在两层
 * 作用域上各定义一遍。外壳只有六个颜色，写成一张按 theme 取的表更直接——**但对比度要过门**，
 * 见 `tests/ui/prototype-export-html.test.tsx` 那条断言（它算的是真实的 WCAG 比值）。
 */
interface ShellPalette {
  readonly bg: string; readonly fg: string; readonly muted: string;
  readonly line: string; readonly chip: string; readonly chipOn: string; readonly chipOnFg: string;
}
export const EXPORT_SHELL_PALETTE: Readonly<Record<"light" | "dark", ShellPalette>> = {
  light: { bg: "#fbfbfa", fg: "#17171a", muted: "#5c5c64", line: "#dcdad4", chip: "#ffffff", chipOn: "#17171a", chipOnFg: "#fbfbfa" },
  dark: { bg: "#0b0b0c", fg: "#e8e8ea", muted: "#a0a0a8", line: "#33343a", chip: "#17181c", chipOn: "#e8e8ea", chipOnFg: "#0b0b0c" },
};

/**
 * 从 markup 里取出 class token。
 *
 * ⚠ 必须**解转义**：`renderToStaticMarkup` 会把属性值里的 `>` 写成 `&gt;`，而 Tailwind 的
 * 任意变体里全是 `>`（`[&>*]:min-h-0`）。按原始字符串比，这些规则一条也匹配不上，
 * 导出的原型样式会缺一块——浏览器打开产物时用的是解转义后的真 class，所以只有抽样式
 * 这一步会错，而且错得无声。（这条是 V47 比对两边 class 集合时暴露出来的。）
 */
export function classTokensOf(html: string): readonly string[] {
  const out: string[] = [];
  for (const m of html.matchAll(/class="([^"]*)"/g)) {
    const decoded = (m[1] ?? "").replace(/&gt;/g, ">").replace(/&lt;/g, "<").replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&amp;/g, "&");
    for (const c of decoded.split(/\s+/)) if (c !== "") out.push(c);
  }
  return out;
}

/** 产物里每页一个锚点 id；跳转脚本按它找页。 */
export const exportScreenId = (i: number): string => `screen-${i}`;

/**
 * 从页面已加载的样式表里抽出**用得到**的规则。
 *
 * 判据故意宽松：只要规则的选择器里出现了产物中真实存在的某个 class token，就带上。
 * 宁可多带几条也不能少带——少带一条的表现是导出的原型样式塌掉，而多带的代价只是文件大一点。
 *
 * 跨域样式表读 `cssRules` 会抛（本 app 的样式同源，不会），抛了就跳过那一张，
 * 不让一张读不到的表把整个导出弄失败。
 */
export function collectPageCss(html: string, sheets: Iterable<CSSStyleSheet>): string {
  const used = new Set<string>(classTokensOf(html));
  const out: string[] = [];
  for (const sheet of sheets) {
    let rules: CSSRuleList;
    try {
      rules = sheet.cssRules;
    } catch {
      continue; // 跨域表，读不了；跳过而不是失败
    }
    for (const rule of Array.from(rules)) {
      const text = rule.cssText;
      // `:root` / `.dark` 这类变量定义没有 class token，但产物完全靠它们上色——必须带。
      const isTokens = text.startsWith(":root") || text.startsWith(".dark") || text.startsWith("*") || text.startsWith("html") || text.startsWith("body");
      if (isTokens) { out.push(text); continue; }
      const selector = text.slice(0, text.indexOf("{"));
      for (const c of used) {
        // class 名里有 Tailwind 的转义（`.h-3\.5`），所以按"去掉反斜杠后是否包含"来比。
        if (selector.replace(/\\/g, "").includes(`.${c}`)) { out.push(text); break; }
      }
    }
  }
  return out.join("\n");
}

const escapeHtml = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * 组装最终文件。`screens[i].markup` 由调用方用 `renderToStaticMarkup` 渲染好传进来——
 * 本函数不认识 React，这样它可以在 jsdom 里被直接单测。
 */
export function buildPrototypeExportHtml(input: {
  readonly project: Pick<DesignProject, "name" | "frames" | "frameNotes" | "theme" | "prototype"> & { readonly frameLinks?: readonly (readonly { from: string; item?: number; to: number }[])[] };
  readonly screens: readonly { readonly markup: string }[];
  readonly css: string;
  readonly now?: Date;
  /**
   * 迭代 12（F57，签核取舍 ②=A）：PDF 就是这份 HTML 的**打印视图**——同一个产物、同一份样式，
   * 不是第二条渲染管线。为真 ⇒ 所有页一开始就全部展开（打印不会去点页签），
   * 页签与提示语隐藏，每页之间分页。
   */
  readonly forPrint?: boolean;
}): string {
  const { project, screens, css } = input;
  const forPrint = input.forPrint === true;
  const now = input.now ?? new Date();
  const shell = EXPORT_SHELL_PALETTE[project.theme];
  /*
   * 迭代 23 —— 打印那一段 `@media print` 的三条规则，每一条都是纸上才成立的事实：
   *
   * ① 末页不再分页。`page-break-after:always` 对每一页生效，最后一页后面那一次分页会让
   *    PDF 结尾凭空多出一张空白纸。屏上看不出来，交付物上每次都在。
   * ② 可跳转元素的虚线框去掉。它是屏上的可供性提示，而纸上点不动；更糟的是解释它的那句
   *    提示语在打印时被隐藏了，于是纸上留下一圈没人说得清是什么的虚线。
   * ③ 画板与说明块不许被拦腰切开。一台手机被分在两页上，读的人要来回翻。
   */
  const nav = project.frames
    .map((f, i) => `<button type="button" class="wx-tab" data-go="${i}">${i + 1}. ${escapeHtml(f)}</button>`)
    .join("");
  const labelOf = (nodeId: string): string => {
    const found = designPrototype.findPrototypeNodePath(project.prototype, nodeId);
    return found === null ? nodeId : designPrototype.prototypeNodeLabel(found.path[found.path.length - 1]!);
  };
  const pages = screens
    .map((s, i) => {
      const links = project.frameLinks?.[i] ?? [];
      /*
       * 迭代 23：跳转清单写**人话标签**，不是裸节点 id。
       *
       * `design-doc-markdown.ts` 早在迭代 11 就改成了「按钮「发送」 → 第 2 页「设置」」，
       * 注释里逐字写着「文档的读者是人」——而这份导出的 HTML 是同一批读者，却一直在打印
       * `send → 第 2 页`。同一件事在一处修了、另一处没跟上：本仓点名过的那种漂移，
       * 这次是文档那侧先修、HTML 这侧留在原地。
       *
       * 找不到节点（树被改过、id 已不在）⇒ 回落成裸 id，不编一个标签出来。
       */
      const linkList = links.length === 0
        ? '<p class="wx-muted">这一页没有跳转。</p>'
        : `<ul>${links.map((l) => `<li>${escapeHtml(labelOf(l.from))}${l.item === undefined ? "" : `（第 ${l.item + 1} 项）`} → 第 ${l.to + 1} 页「${escapeHtml(project.frames[l.to] ?? "")}」</li>`).join("")}</ul>`;
      const note = (project.frameNotes[i] ?? "").trim();
      return `<section class="wx-page" id="${exportScreenId(i)}"${i === 0 || forPrint ? "" : " hidden"}>
<h2>${i + 1}. ${escapeHtml(project.frames[i] ?? "")}</h2>
<div class="wx-stage">${s.markup}</div>
<div class="wx-meta"><h3>交互说明</h3>${note === "" ? '<p class="wx-muted">（还没写）</p>' : `<p>${escapeHtml(note)}</p>`}<h3>跳转</h3>${linkList}</div>
</section>`;
    })
    .join("\n");

  // 跳转脚本：把 `data-proto` 节点上的 id 与本页 links 对上，点了就换页。
  // 只操作 hidden 属性，不改任何样式——产物在没有 JS 的环境里至少还能看到第一页。
  const linkTable = JSON.stringify((project.frameLinks ?? []).map((ls) => ls.map((l) => ({ f: l.from, i: l.item ?? null, t: l.to }))));

  return `<!doctype html>
<html lang="zh-CN" class="${project.theme === "light" ? "wx-light" : "dark"}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(project.name)} · 可点击原型</title>
<style>
${css}
body{margin:0;color-scheme:${project.theme};font:14px/1.6 system-ui,-apple-system,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;background:${shell.bg};color:${shell.fg}}
.wx-shell{max-width:1000px;margin:0 auto;padding:24px}
.wx-tabs{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:20px}
.wx-tab{cursor:pointer;border:1px solid ${shell.line};background:${shell.chip};color:inherit;border-radius:999px;padding:6px 14px;font:inherit}
.wx-tab[aria-pressed=true]{background:${shell.chipOn};color:${shell.chipOnFg}}
.wx-page h2{font-size:18px;margin:0 0 16px}
.wx-stage{display:flex;justify-content:center;padding:20px 0}
.wx-meta{border-top:1px solid ${shell.line};margin-top:20px;padding-top:16px}
.wx-meta h3{font-size:13px;margin:16px 0 6px;color:${shell.muted}}
.wx-muted{color:${shell.muted}}
.wx-hint{color:${shell.muted};font-size:12px;margin-top:28px}
[data-proto][data-linked]{cursor:pointer;outline:1px dashed rgba(120,160,255,.5);outline-offset:2px}
/* 打印 = 这份产物的 PDF 视图；三条纸上才成立的规则，理由见源码注释 */
@media print{
  @page{margin:12mm}
  .wx-tabs,.wx-hint{display:none}
  .wx-shell{max-width:none;padding:0}
  .wx-page{display:block!important;page-break-after:always}
  .wx-page:last-of-type{page-break-after:auto}
  .wx-page[hidden]{display:block!important}
  .wx-stage,.wx-meta{break-inside:avoid;page-break-inside:avoid}
  [data-proto][data-linked]{outline:none}
}
</style></head>
<body><div class="wx-shell">
<h1>${escapeHtml(project.name)}</h1>
<p class="wx-muted">导出于 ${now.toISOString().slice(0, 10)} · 共 ${project.frames.length} 页 · 点带虚线框的元素可以跳转</p>
${forPrint ? "" : `<nav class="wx-tabs">${nav}</nav>`}
${pages}
<p class="wx-hint">这是一个自包含文件：不联网也能打开，不依赖任何在线服务。用浏览器「打印 → 保存为 PDF」可得到交付文档。</p>
</div>
<script>
(function(){
  var links = ${linkTable};
  var pages = Array.prototype.slice.call(document.querySelectorAll('.wx-page'));
  var tabs = Array.prototype.slice.call(document.querySelectorAll('.wx-tab'));
  function go(i){
    pages.forEach(function(p,k){ p.hidden = k !== i; });
    tabs.forEach(function(t,k){ t.setAttribute('aria-pressed', String(k === i)); });
  }
  tabs.forEach(function(t){ t.addEventListener('click', function(){ go(Number(t.dataset.go)); }); });
  pages.forEach(function(page, pi){
    (links[pi] || []).forEach(function(l){
      var host = page.querySelector('[data-node-id="' + l.f + '"]') || page.querySelector('#' + CSS.escape(l.f));
      if (host === null) return;
      var target = l.i === null ? host : (host.children[l.i] || host);
      target.setAttribute('data-linked', '1');
      target.addEventListener('click', function(){ go(l.t); });
    });
  });
  if (!${forPrint ? "true" : "false"}) go(0);
})();
</script>
</body></html>`;
}

export function prototypeExportHtmlFileName(name: string, now: Date = new Date()): string {
  return `${name}-可点击原型-${now.toISOString().slice(0, 10)}.html`;
}
