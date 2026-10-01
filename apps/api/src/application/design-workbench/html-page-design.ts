import { designHtmlPage } from "@repo/contracts";
import type { QualityDeduction, QualityReport } from "./prototype-quality";
import { PLACEHOLDER_PATTERNS, PROTOTYPE_QUALITY_THRESHOLD } from "./prototype-quality";

/**
 * 「整页 HTML」生成模式（设计工作台 方向 C）。
 *
 * ## 和树形原语那条链路的关系
 *
 * 树形链路（`design-chat-model.ts` 的 `DESIGN_PRINCIPLES` 等）把模型关在 21 个原语里——模型看不见自己
 * 画了什么，只能按一棵 JSON 树盲写，产出「结构挑不出错、但不专业」。这条链路让模型直接写 HTML+CSS，
 * 这正是 `frontend-design` skill 写给的场景，所以它的判据在这里**基本可以直接用**（树形链路那边是翻译）。
 *
 * ## 三个设计点（对应对 Claude Design 的研究结论）
 *
 * 1. **先出「设计简报」再写页**：AI 界面千篇一律的根因是模型退回训练数据里最常见的选择。
 *    骨架轮除了页划分，还要定下 4–6 个具名色值、字体角色、版式概念、一个视觉记忆点，
 *    后面每一页都带着它——风格锚是**简报 + 第一页的 CSS**，不是一串类型名。
 * 2. **质量门量「HTML 的结构事实」**：服务端没有浏览器，量不了几何（那是 CI 截图审计门的事），
 *    这里只量能从文本里机械看出来的：够不够实、有没有字阶、有没有用简报的颜色、有没有死路、
 *    有没有会撑破画布的固定宽度、有没有一排相同的卡片。
 * 3. **跳转只写 `data-goto`**：不写 JS。`screen.links` 是 HTML 的投影（契约 `htmlPageLinks`）。
 */

/* ───────────────────────────── 设计简报 ───────────────────────────── */

export interface DesignBrief {
  readonly palette: readonly { readonly name: string; readonly hex: string }[];
  readonly type: string;
  readonly layout: string;
  readonly signature: string;
}

const HEX = /^#[0-9a-fA-F]{6}$/;

/** 骨架轮给的 `brief`；不合法 ⇒ `undefined`（不猜、不补，没有简报照样能画，只是少一层约束）。 */
export function parseDesignBrief(raw: unknown): DesignBrief | undefined {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const o = raw as Record<string, unknown>;
  const palette: { name: string; hex: string }[] = [];
  if (Array.isArray(o.palette)) {
    for (const p of o.palette) {
      if (p === null || typeof p !== "object") continue;
      const hex = (p as { hex?: unknown }).hex;
      const name = (p as { name?: unknown }).name;
      if (typeof hex !== "string" || !HEX.test(hex.trim())) continue;
      palette.push({ name: typeof name === "string" ? name.trim().slice(0, 12) : "", hex: hex.trim().toUpperCase() });
      if (palette.length >= 6) break;
    }
  }
  if (palette.length < 3) return undefined;
  const text = (v: unknown, max: number): string => (typeof v === "string" ? v.trim().slice(0, max) : "");
  return { palette, type: text(o.type, 240), layout: text(o.layout, 320), signature: text(o.signature, 240) };
}

/** 简报 → 给每页轮看的文字。 */
export function briefToText(b: DesignBrief): string {
  return (
    "设计简报（每一页都要守住，风格不要在页与页之间漂）：\n" +
    `· 色板：${b.palette.map((c) => `${c.name === "" ? "" : `${c.name} `}${c.hex}`).join("、")}\n` +
    (b.type === "" ? "" : `· 字体与字阶：${b.type}\n`) +
    (b.layout === "" ? "" : `· 版式：${b.layout}\n`) +
    (b.signature === "" ? "" : `· 视觉记忆点：${b.signature}\n`)
  );
}

/* ───────────────────────────── 提示词 ───────────────────────────── */

/** 骨架轮追加的一段：在页划分之外要一份设计简报。 */
export const DESIGN_OUTLINE_HTML_ADDENDUM =
  " 另外，**在 outline 之外再给一个 brief 字段**（整套界面的设计简报，后面每一页都照它画）：" +
  '"brief":{"palette":[{"name":"色名","hex":"#RRGGBB"}],"type":"字体与字阶","layout":"版式概念","signature":"视觉记忆点"}。' +
  "palette 给 4–6 个具名色值（底色、文字色、主色、一个辅助色、一个克制的中性色），必须是这个产品的题材里**该有的**颜色，" +
  "不是你最常用的颜色；不要默认暖米色底 + 衬线标题 + 陶土色强调，也不要默认近黑底 + 荧光绿/朱红单点强调；" +
  "type 写清标题与正文各用什么气质的**系统字体**（只能用系统字体栈：无衬线 system-ui/PingFang SC、衬线 Songti SC/Georgia、圆体 ui-rounded、等宽 ui-monospace）" +
  "以及字阶（例如 标题 28/600、小标题 17/600、正文 15/400、说明 12/400）；" +
  "layout 用一两句说清版式（对齐方式、留白多还是密、主要分几栏），" +
  "signature 写这套界面独有的**一个**视觉记忆点（例如「所有数字用等宽体并对齐小数点」）。" +
  "先想这个产品的受众和主要任务，再定这些；生成前自己核对一遍：如果这份简报换成另一个题材也说得通，就说明它太泛，重写。";

const CANVAS_WIDTH = { mobile: 393, wireframe: 820, ui: 1280 } as const;
export const htmlCanvasWidth = (template: "mobile" | "ui" | "wireframe"): number => CANVAS_WIDTH[template];

const HTML_PAGE_ROOT_PRINCIPLE =
  "页面根元素用 `<div class=\"page\">`，设 `min-height:100vh; display:flex; flex-direction:column`，内容要**撑满画布高度**；";

/** 给每页轮看的视觉与技术约束。**这是 HTML 模式视觉约束的唯一事实源**（树形链路的在 `DESIGN_PRINCIPLES`）。 */
export const HTML_DESIGN_PRINCIPLES =
  " 【技术硬约束】只输出一个 `<style>` 加正文片段：不要 html/head/body/script/link/meta，不要 @import 和 @font-face，" +
  "不要任何外链（图片、字体、CDN 都会被拦）；样式全部写在那一个 `<style>` 里、用 class，不写内联 style 以外的 JS；" +
  HTML_PAGE_ROOT_PRINCIPLE +
  "宽度一律 100% / max-width / flex，**不要写超过画布宽度的固定像素宽**；图形用内联 SVG 或 CSS 画（几何、用简报色），不要 emoji 当图标；" +
  "可点击的元素写 `data-goto=\"目标页序号\"`（按钮、导航项、卡片都可以），不要写 href 和 onclick；" +
  "【视觉】①一页只有一个视觉重点（题材里最有代表性的东西，不是一排大数字配小标签），其余安静下来；" +
  "②字阶至少三档且级差明显（标题 / 正文 / 说明），标题一页最多一个，行宽不超过 40 个汉字，中文行高 1.5–1.7；" +
  "③间距成体系：只用 4 的倍数，相邻同级区块用同一档，区块之间比区块内部更松；" +
  "④颜色只用简报色板（及其明暗变体），主色只给主操作和重点，文字与底色对比度 ≥ 4.5:1，不用纯黑 #000，不用装饰性渐变；" +
  "⑤圆角跟着层级走，不要全页一个 radius；阴影克制，不要每张卡片都加同一个软阴影；" +
  "⑥结构装置要编码信息：分隔线只在真的分隔两类内容时用，卡片只在真的成组时用，编号只在内容是有序步骤时用；" +
  "⑦**不要把内容切成一排结构相同的卡片**：三项以上同类内容用列表行（主标题 / 副标题 / 右侧值）或表格，真要卡片就让主次有差别；" +
  "【避免一眼看出是生成的套路】全大写小标签当眉头、「A · B · C」中点拼元信息、「词 —— 片段」破折号标签、按钮缀「→」、" +
  "只把标题里一个词换色或斜体、每个区块都配一行小标签、每页都用同一种渐变头图；" +
  "【内容与文案】真实的文案与数据（具体的数字、人名、日期、状态），不要「标题1」「示例文本」「Lorem ipsum」；" +
  "按钮说清点下去会发生什么，同一个动作全流程同名；空态与错误态另起一页说明，不要塞进正常页；" +
  "【布局】手机页：顶部标题区 → 内容 → 底部主操作或底部导航（贴底）；桌面页可用多栏，但主内容区要有明确的视觉重心；" +
  "内容不够撑满时，用留白分组或把主操作贴底，**不要出现一大片没有意义的空白**；" +
  "【收尾自查】写完回看一遍：有没有一处装饰删掉也不损失信息？有就删掉它。";

/** 每页轮的系统提示：只画**一页** HTML。 */
export const DESIGN_ONE_HTML_SCREEN_SYSTEM_PROMPT =
  "你是 PM 设计工作台里的设计师，像一个资深产品设计师那样直接写出界面。你正在为一个已经定好页面划分与设计简报的项目画**其中一页**，" +
  "用 HTML 与 CSS 写出来，画面会在沙箱里原样渲染。" +
  "严格按这个格式输出，不要解释、不要 markdown 代码块：\n" +
  "<notes>给工程看的交互说明，一到三句（做什么、主要交互、空态/加载/错误怎么处理）</notes>\n" +
  "<page>\n<style>…</style>\n<div class=\"page\">…</div>\n</page>\n" +
  "只画被指定的那一页，不要输出别的页。" +
  HTML_DESIGN_PRINCIPLES;

/** 输出被截断后重画时追加。方向是更精简，不是更简陋。 */
export const SIMPLER_HTML_HINT =
  "\n\n⚠ 你上一次的输出没写完就被长度限制截断了。这一次请写得**更精炼**：CSS 控制在 100 行以内、不用重复的样式块、" +
  "内联 SVG 只留最关键的一两个、列表最多 4 项。宁可精炼也要**完整输出**（必须以 </page> 结束）。";

/* ───────────────────────────── 输出解析 ───────────────────────────── */

export interface ParsedHtmlPage {
  readonly html: string;
  readonly notes: string | undefined;
  /** 清洗时丢掉的东西摘要（日志用）。 */
  readonly removed: readonly string[];
  /** 被剪掉的非法跳转（指向自己 / 不存在的页）数量。 */
  readonly prunedGotos: number;
}

/**
 * 模型文本 → 一页干净的 HTML。`<page>` 没闭合 ⇒ `null`（当作截断，调用方重画）。
 * 没写 `<page>` 标签但确实是 HTML ⇒ 宽容地收下（模型偶尔忘标签，不值得为此重画一页）。
 */
export function parseHtmlPageOutput(text: string, ctx: { readonly index: number; readonly screenCount: number }): ParsedHtmlPage | null {
  const stripped = text.replace(/^\s*```(?:html)?\s*/i, "").replace(/\s*```\s*$/i, "");
  const notesMatch = /<notes>([\s\S]*?)<\/notes>/i.exec(stripped);
  const notes = notesMatch?.[1]?.trim().slice(0, 600);
  let body: string;
  const open = /<page>/i.exec(stripped);
  if (open !== null) {
    const rest = stripped.slice(open.index + open[0].length);
    const close = /<\/page>/i.exec(rest);
    if (close === null) return null;
    body = rest.slice(0, close.index);
  } else {
    body = stripped.replace(/<notes>[\s\S]*?<\/notes>/i, "");
    if (!/<(div|section|main|style)\b/i.test(body)) return null;
  }
  const cleaned = designHtmlPage.sanitizeHtmlPage(body);
  if (cleaned.html === "") return null;
  const pruned = pruneInvalidGotos(cleaned.html, ctx.index, ctx.screenCount);
  return { html: pruned.html, notes: notes === "" ? undefined : notes, removed: cleaned.removed, prunedGotos: pruned.count };
}

/** 去掉指向自己 / 不存在的页的跳转标记（留着只会得到一个能点、点了没反应的元素）。 */
export function pruneInvalidGotos(html: string, index: number, screenCount: number): { readonly html: string; readonly count: number } {
  let count = 0;
  const out = html.replace(/\sdata-link="[A-Za-z0-9_-]{1,32}"\sdata-goto="(\d{1,2})"/g, (m, to: string) => {
    const n = Number(to);
    if (n === index || n >= screenCount) { count += 1; return ""; }
    return m;
  });
  return { html: out, count };
}

/** 风格锚：第一页的 CSS（截到 3000 字）+ 每页的可见文字摘要。比一串类型名有用得多。 */
export function summarizeHtmlScreen(frame: string, html: string, withCss: boolean): string {
  const text = designHtmlPage.htmlPageVisibleText(html).slice(0, 90);
  if (!withCss) return `「${frame}」：${text}`;
  const css = (/<style>([\s\S]*?)<\/style>/i.exec(html)?.[1] ?? "").slice(0, 3000);
  return `「${frame}」：${text}\n它的 CSS（新的一页沿用同一套变量、字阶、间距与圆角，别另起一套）：\n${css}`;
}

/* ───────────────────────────── 质量评分 ───────────────────────────── */

const WEIGHTS: Readonly<Record<string, number>> = {
  substance: 0.25, hierarchy: 0.15, palette: 0.15, affordance: 0.15, deadEnds: 0.1, placeholderCopy: 0.1, overflow: 0.1,
};

function cssOf(html: string): string {
  return [...html.matchAll(/<style>([\s\S]*?)<\/style>/gi)].map((m) => m[1]).join("\n");
}

export function scoreHtmlPage(
  html: string,
  context: { readonly screenCount: number; readonly canvasWidth: number; readonly brief?: DesignBrief },
): QualityReport {
  const text = designHtmlPage.htmlPageVisibleText(html);
  const css = cssOf(html);
  const parts: QualityDeduction[] = [];

  const chars = text.length;
  parts.push(chars >= 120
    ? { metric: "substance", score: 1, hint: "" }
    : { metric: "substance", score: Math.min(1, chars / 120), hint: `这页可见文字只有 ${String(chars)} 个字，渲染出来几乎是空的。补上真实的内容（具体的条目、数字、状态和说明），让它像一个真的界面。` });

  const sizes = new Set([...css.matchAll(/font-size\s*:\s*([\d.]+(?:px|rem|em))/gi)].map((m) => m[1]!.toLowerCase()));
  parts.push(sizes.size >= 3
    ? { metric: "hierarchy", score: 1, hint: "" }
    : { metric: "hierarchy", score: sizes.size / 3, hint: `只用了 ${String(sizes.size)} 档字号。至少三档且级差明显：标题（大而粗）/ 正文 / 说明（小而淡），一页最多一个标题。` });

  if (context.brief === undefined) parts.push({ metric: "palette", score: 1, hint: "" });
  else {
    const used = context.brief.palette.filter((c) => new RegExp(c.hex, "i").test(css)).length;
    const need = Math.min(3, context.brief.palette.length);
    parts.push(used >= need
      ? { metric: "palette", score: 1, hint: "" }
      : { metric: "palette", score: used / need, hint: `CSS 里只用到了简报色板里的 ${String(used)} 个颜色。颜色只用简报色板（${context.brief.palette.map((c) => c.hex).join(" ")}）及其明暗变体，别另起一套。` });
  }

  const interactive = designHtmlPage.htmlPageInteractiveCount(html);
  parts.push(interactive >= 1
    ? { metric: "affordance", score: 1, hint: "" }
    : { metric: "affordance", score: 0, hint: "这页没有任何可操作的东西。至少要有一个按钮 / 输入 / 导航项，让人知道下一步做什么。" });

  const links = designHtmlPage.htmlPageLinks(html);
  parts.push(context.screenCount <= 1 || links.length > 0
    ? { metric: "deadEnds", score: 1, hint: "" }
    : { metric: "deadEnds", score: 0, hint: "整个项目有多页，但这页没有一个元素带 data-goto。主操作和导航项要写 data-goto=\"目标页序号\"，别留死按钮。" });

  // 占位文案的正则是「整句匹配」（`prototype-quality.ts` 里刻意保守，宁可漏判），所以按文本片段逐个判，不是对整页文字判。
  const segments = html.replace(/<style[\s\S]*?<\/style>/gi, " ").split(/<[^>]*>/).map((t) => t.trim()).filter((t) => t !== "");
  const hits = segments.filter((t) => PLACEHOLDER_PATTERNS.some((re) => re.test(t))).length;
  parts.push(hits === 0
    ? { metric: "placeholderCopy", score: 1, hint: "" }
    : { metric: "placeholderCopy", score: Math.max(0, 1 - hits * 0.4), hint: "有占位文案（「标题1」「示例文本」「Lorem ipsum」之类）。换成这个产品里真的会出现的话。" });

  const tooWide = [...css.matchAll(/(?<![\w-])(?:min-)?width\s*:\s*(\d{3,4})px/gi)].map((m) => Number(m[1])).filter((w) => w > context.canvasWidth);
  parts.push(tooWide.length === 0
    ? { metric: "overflow", score: 1, hint: "" }
    : { metric: "overflow", score: 0, hint: `有固定宽度 ${String(tooWide[0])}px，超过了画布宽 ${String(context.canvasWidth)}px，会被撑出横向滚动。宽度改用 100% / max-width / flex。` });

  const weighted = Math.round(parts.reduce((sum, p) => sum + p.score * (WEIGHTS[p.metric] ?? 0), 0) * 100);

  // 一票否决：一排结构相同的卡片（skill「AI 生成设计扎堆的特征」第 4 类）。只数 class 里带 card 的元素。
  const classCount = new Map<string, number>();
  for (const m of html.matchAll(/<(?:div|article|section|li)\b[^>]*\sclass="([^"]*\bcard\b[^"]*)"/gi)) {
    classCount.set(m[1]!, (classCount.get(m[1]!) ?? 0) + 1);
  }
  const worst = Math.max(0, ...classCount.values());
  // 横向溢出同样一票否决：它是肉眼可见的坏，只扣 10 分的话总分仍有 90、永远触发不了重画。
  const vetoed = worst >= 4 || tooWide.length > 0;
  if (worst >= 4) parts.push({ metric: "repeatedCards", score: 0, hint: `同一种卡片重复了 ${String(worst)} 次。三项以上同类内容改用列表行（主标题 / 副标题 / 右侧值）或表格；真要卡片就让主次有差别。` });

  const total = vetoed ? Math.min(weighted, PROTOTYPE_QUALITY_THRESHOLD - 1) : weighted;
  const hints = parts.filter((p) => p.hint !== "").map((p) => `· ${p.hint}`);
  return { total, parts, feedback: total >= PROTOTYPE_QUALITY_THRESHOLD || hints.length === 0 ? "" : hints.join("\n") };
}

/* ───────────────────────────── 局部修改（选中元素 / 选中整页） ───────────────────────────── */

export const htmlPageCss = cssOf;

/** 改**一个元素**：模型只看见这个元素和页面现有的 CSS，只改它，其余版面逐字不动（也省 token）。 */
export const DESIGN_HTML_ELEMENT_EDIT_SYSTEM_PROMPT =
  "你是 PM 设计工作台里的设计师。用户在一个已经画好的界面里选中了**一个元素**，想改它。你只改这个元素，不碰页面里的其它东西。" +
  "严格按这个格式输出，不要解释、不要 markdown 代码块：\n" +
  "<reply>给用户的一句话，说清改了什么，中文，不超过 80 字</reply>\n" +
  "<element>改完之后这个元素的**完整** HTML（包含它自己那一层标签和所有子元素）</element>\n" +
  "<css>只有需要新增或覆盖样式时才写：只写普通的选择器与声明，不写 @media/@keyframes 等全局或嵌套规则；规则只作用于这个元素及其子元素，不要重复页面已有 CSS</css>\n" +
  "沿用页面现有的 class 命名、字阶、间距、圆角和色板（页面 CSS 会给你），不要另起一套；带 data-goto 的元素保持它的 data-goto，除非用户明确要改去处。" +
  HTML_DESIGN_PRINCIPLES
    .replace("只输出一个 `<style>` 加正文片段", "样式只放在 <css>，元素只放在 <element>")
    .replace(HTML_PAGE_ROOT_PRINCIPLE, "保持被选中元素的层级，不要把它扩成整页，不要新增 page 根容器或强制全屏高度；");

/** 改**整页**：在现有这一页的基础上按要求修改，保持风格一致。 */
export const DESIGN_HTML_PAGE_EDIT_SYSTEM_PROMPT =
  "你是 PM 设计工作台里的设计师。用户选中了一个已经画好的界面页，想修改它。在现有这一页的基础上按用户的要求改，没提到的部分保持原样（结构、文案、风格、跳转都别无故改动）。" +
  "严格按这个格式输出，不要解释、不要 markdown 代码块：\n" +
  "<reply>给用户的一句话，说清改了什么，中文，不超过 80 字</reply>\n" +
  "<notes>给工程看的交互说明，一到三句</notes>\n" +
  "<page>\n<style>…</style>\n<div class=\"page\">…</div>\n</page>" +
  HTML_DESIGN_PRINCIPLES;

export interface ParsedElementEdit {
  readonly reply: string;
  readonly element: string;
  readonly css: string;
}

/** `<element>` 没闭合 / 没有 ⇒ `null`。 */
export function parseElementEditOutput(text: string): ParsedElementEdit | null {
  const element = /<element>([\s\S]*?)<\/element>/i.exec(text)?.[1]?.trim();
  if (element === undefined || element === "") return null;
  return {
    reply: (/<reply>([\s\S]*?)<\/reply>/i.exec(text)?.[1]?.trim() ?? "").slice(0, 400),
    element,
    css: (/<css>([\s\S]*?)<\/css>/i.exec(text)?.[1] ?? "").trim().slice(0, 6000),
  };
}

/** 整页修改的输出：`<reply>` + 既有的 `<notes>/<page>`。 */
export function parsePageEditOutput(text: string, ctx: { readonly index: number; readonly screenCount: number }): (ParsedHtmlPage & { readonly reply: string }) | null {
  const page = parseHtmlPageOutput(text, ctx);
  if (page === null) return null;
  return { ...page, reply: (/<reply>([\s\S]*?)<\/reply>/i.exec(text)?.[1]?.trim() ?? "").slice(0, 400) };
}
