/* eslint-disable */
/**
 * audit-text-contrast.mjs —— 按**对比度**审计可见文本，完全不看 class 名。
 *
 * ## 为什么判据必须是对比度，不是 token 名
 *
 * 2026-09-22 抓到的那个缺陷（切换对话框里白字白底）教了两件事：
 *   · 所有**几何**判据都会说它可见：`isVisible()` 为真、`getBoundingClientRect` 给出
 *     373×48、`elementFromPoint` 返回它自己。对比度不在它们的判据里。
 *   · 而按 **token 名**做静态分类也不够，两个方向都会错：
 *       `agent-kernel-units.tsx` 的 `text-primary-foreground/80` 在 `<Button variant="primary">`
 *       里，底色由组件给，看文件永远看不到 → 静态判成缺陷，其实合法；
 *       `orchestration-preview.tsx` 的父级写着 `bg-warning/5`，名字里有 `bg-warning`，
 *       而 5% 浅到接近白，白字打上去照样看不见 → 静态判成合法，其实是缺陷。
 *     名字对了，对比度可以是错的。
 *
 * 所以这里只量真实渲染值：`getComputedStyle().color` 对「沿祖先找到的第一个非透明背景」，
 * 按 WCAG 相对亮度算比值。合法用法（父级真有实心底）自然通过。
 *
 * ## 三种结论，第三种如实计数
 *
 * **通过 / 不通过 / 判不了**。第三类**不算通过**——审计器自己不能再犯「判据看不见的东西」
 * 这个形状（并行会话 2026-09-22 复核时点出的两条，都会让「有效背景」算错而误判成通过）：
 *   · 祖先链上的 `opacity` / `filter` / `mix-blend-mode` **不改** `backgroundColor` 的计算值。
 *     一个 `opacity: .5` 的容器里，算出来的对比度会比眼睛看到的高一截。
 *   · 背景来自 `background-image`（渐变）或伪元素时，`backgroundColor` 往往是 `transparent`，
 *     向上寻找会穿过它落到更上层的白底 —— 于是真问题被算成通过，或反之。
 * 这两种情形一律归入「判不了」，报出来等人看，不进通过。
 *
 ## 例外怎么表达：`data-contrast-exempt="原因"`
 *
 * 有些低对比是**刻意**的（占位符的弱化、装饰性字符），而它的理由只有写代码的人知道。
 * 这类例外写在**调用点**上：给元素加 `data-contrast-exempt="一句为什么"`，审计器据它单独计数
 * 并把理由打出来。刻意不做成一份单独的豁免清单——清单会烂掉，而且读清单的人看不到上下文。
 * 空字符串不算豁免：不给理由的例外与缺陷在输出上不该有区别。
 *
 * ⚠ 其余已知局限，不假装覆盖全仓：
 *   · 只审**跑得到的页面**；没跑到的路由不在结论里。
 *   · 半透明底（如 `bg-warning/5`）按 alpha 自下而上合成一次近似，不做完美的多层合成。
 *
 * 用法：node apps/web/scripts/audit-text-contrast.mjs <url> [更多 url…]
 *       环境变量 SESSION_JSON 给登录态（见 shot-edition-local.mjs 的注入格式）。
 * 退出码：有低于阈值的命中 ⇒ 1；否则 0。
 */
import { createRequire } from "node:module";
const require = createRequire(new URL("../package.json", import.meta.url));
const pw = require("@playwright/test");
const chromium = pw.chromium ?? pw.default?.chromium;

/** WCAG AA 正文阈值。大字号（>=18.66px 粗体 / >=24px）另按 3.0 判。 */
const AA_NORMAL = 4.5;
const AA_LARGE = 3.0;

const urls = process.argv.slice(2);
if (urls.length === 0) { console.error("用法：node apps/web/scripts/audit-text-contrast.mjs <url>…"); process.exit(2); }
const session = process.env.SESSION_JSON ? JSON.parse(process.env.SESSION_JSON) : null;

const AUDIT = ({ aaNormal, aaLarge }) => {
  const parse = (c) => {
    const m = c.match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const p = m[1].split(",").map((x) => parseFloat(x));
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  };
  const lum = ({ r, g, b }) => {
    const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const over = (fg, bg) => ({
    r: fg.r * fg.a + bg.r * (1 - fg.a),
    g: fg.g * fg.a + bg.g * (1 - fg.a),
    b: fg.b * fg.a + bg.b * (1 - fg.a),
    a: 1,
  });
  /**
   * 有效背景。返回 `{ bg }` 或 `{ unknown: "原因" }`——**判不了就说判不了**，
   * 不返回一个算得出来但不对的颜色。
   */
  const effectiveBg = (el) => {
    let node = el, stack = [];
    while (node) {
      const cs = getComputedStyle(node);
      // 这三个改变最终呈现，却都**不改** backgroundColor 的计算值
      if (parseFloat(cs.opacity) < 0.999) return { unknown: `祖先 ${node.tagName.toLowerCase()} 有 opacity ${cs.opacity}` };
      if (cs.filter && cs.filter !== "none") return { unknown: `祖先 ${node.tagName.toLowerCase()} 有 filter` };
      if (cs.mixBlendMode && cs.mixBlendMode !== "normal") return { unknown: `祖先 ${node.tagName.toLowerCase()} 有 mix-blend-mode` };
      // 渐变/图片底：backgroundColor 常是 transparent，向上找会穿过它
      if (cs.backgroundImage && cs.backgroundImage !== "none") return { unknown: `祖先 ${node.tagName.toLowerCase()} 的底是 background-image` };
      const c = parse(cs.backgroundColor);
      if (c && c.a > 0) { stack.push(c); if (c.a >= 0.999) break; }
      node = node.parentElement;
    }
    let acc = { r: 255, g: 255, b: 255, a: 1 };
    for (let i = stack.length - 1; i >= 0; i -= 1) acc = over(stack[i], acc);
    return { bg: acc };
  };
  const out = [], unknown = [], transparent = [], exempt = [];
  // 审了多少个候选元素。**必须报出来**：没有它，「0 处不通过」与「这页根本没渲染」
  // 在输出上一模一样——本仓 `lint-arch-deps` 打 `scanned=` 正是为了同一件事。
  let examined = 0;
  for (const el of document.querySelectorAll("*")) {
    // 只看自己直接持有可见文字的元素，避免把容器算进来
    const own = [...el.childNodes].filter((n) => n.nodeType === 3 && n.textContent.trim() !== "");
    const icon = el.tagName.toLowerCase() === "svg";
    if (own.length === 0 && !icon) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === "hidden" || cs.display === "none" || parseFloat(cs.opacity) === 0) continue;
    const describeEl = () => ({
      tag: el.tagName.toLowerCase(),
      testid: el.getAttribute("data-testid") ?? el.closest("[data-testid]")?.getAttribute("data-testid") ?? null,
      cls: (el.getAttribute("class") ?? "").slice(0, 120),
      sample: (own.map((n) => n.textContent.trim()).join(" ") || "(icon)").slice(0, 60),
    });
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) continue;
    examined += 1;
    const fgRaw = parse(cs.color);
    if (!fgRaw) continue;
    /*
     * `color: transparent` 是**故意不显示**，不是对比度缺陷。本仓的 hover-reveal 惯用法
     * 就长这样（`thread-list-shell.tsx` 的图钉按钮：默认 `text-transparent`，
     * `group-hover:text-muted-foreground` 才现形，那段注释还把取舍写清楚了）。
     *
     * ⚠ 这条是审计器自己的第一版误报：把 alpha=0 的前景合成到白底上得到白色，
     * 于是 60 处里有 60 处是这个形状——一个会喊狼来了的审计器没人会信第二次。
     * alpha 为 0 ⇒ 单独计数为「透明（按故意隐藏跳过）」，不进不通过。
     */
    if (fgRaw.a <= 0.001) { transparent.push(describeEl()); continue; }
    // 调用点声明的刻意例外（必须带理由）
    const exemptNode = el.closest("[data-contrast-exempt]");
    const exemptWhy = exemptNode?.getAttribute("data-contrast-exempt")?.trim() ?? "";
    if (exemptWhy !== "") { exempt.push({ ...describeEl(), why: exemptWhy }); continue; }
    const resolved = effectiveBg(el);
    if (resolved.unknown) { unknown.push({ ...describeEl(), why: resolved.unknown }); continue; }
    const bg = resolved.bg;
    const fg = fgRaw.a >= 0.999 ? fgRaw : over(fgRaw, bg);
    const l1 = lum(fg), l2 = lum(bg);
    const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
    const size = parseFloat(cs.fontSize);
    const bold = parseInt(cs.fontWeight, 10) >= 700;
    const threshold = size >= 24 || (bold && size >= 18.66) ? aaLarge : aaNormal;
    if (ratio >= threshold) continue;
    out.push({
      ratio: +ratio.toFixed(2), threshold, tag: el.tagName.toLowerCase(),
      testid: el.getAttribute("data-testid") ?? el.closest("[data-testid]")?.getAttribute("data-testid") ?? null,
      cls: (el.getAttribute("class") ?? "").slice(0, 120),
      sample: (own.map((n) => n.textContent.trim()).join(" ") || "(icon)").slice(0, 60),
      fg: `rgb(${Math.round(fg.r)}, ${Math.round(fg.g)}, ${Math.round(fg.b)})`,
      bg: `rgb(${Math.round(bg.r)}, ${Math.round(bg.g)}, ${Math.round(bg.b)})`,
    });
  }
  return { fail: out, unknown, exempt, transparent: transparent.length, examined, bodyChars: document.body.innerText.trim().length };
};

const browser = await chromium.launch();
let total = 0, undetermined = 0;
const unaudited = [];
for (const url of urls) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  // 浅色主题：深色主题会把这一整类缺陷藏起来（同一个 token 在深色下是近黑色）
  await page.emulateMedia({ colorScheme: "light" });
  if (session) {
    await page.goto(new URL("/login", url).toString());
    await page.evaluate((s) => {
      const rev = crypto.randomUUID();
      localStorage.setItem("wsx.session", JSON.stringify({ version: 2, revision: rev, userId: s.userId, orgs: s.orgs, currentOrgId: s.currentOrgId, expiresAt: s.expiresAt }));
      localStorage.setItem("wsx.sessionToken", s.token);
      localStorage.setItem("wsx.sessionCommit", rev);
      localStorage.setItem("wsx.theme", "light");
    }, session);
  }
  // dev 模式下第一次进某条路由要现编译，默认 30 s 不够；超时算**未审到**，不算通过
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 120_000 });
  } catch (e) {
    console.log(`\n════ ${url}\n   ⚠ 打不开（${String(e).split("\n")[0]}）——本页计为未审到。`);
    unaudited.push(url); await page.close(); continue;
  }
  await page.waitForTimeout(4000);
  const { fail, unknown, exempt, transparent, examined, bodyChars } = await page.evaluate(AUDIT, { aaNormal: AA_NORMAL, aaLarge: AA_LARGE });
  console.log(`\n════ ${url}`);
  console.log(`   examined=${examined} bodyChars=${bodyChars} —— 不通过 ${fail.length} ｜ 判不了 ${unknown.length} ｜ 声明例外 ${exempt.length} ｜ 透明跳过 ${transparent}`);
  /*
   * 「这页根本没渲染」与「这页全都通过」在输出上一模一样，所以把它判成**错误**而不是通过。
   * 阈值 40 是经验值：一个真渲染出来的业务屏（实测 /chat）examined 在数百级，
   * 而重定向到登录页/空白页只有个位数。
   */
  if (examined < 40) {
    console.log(`   ⚠ 审的元素太少（examined=${examined}）——这更像是页面没渲染出来（重定向/空态/未登录），不是「全都通过」。本页计为**未审到**。`);
    unaudited.push(url);
  }
  for (const h of fail) {
    console.log(`  ✗ ${String(h.ratio).padStart(5)} < ${h.threshold}  ${h.tag}${h.testid ? `[${h.testid}]` : ""}  ${h.fg} on ${h.bg}`);
    console.log(`         「${h.sample}」  class=${h.cls}`);
  }
  for (const h of exempt) {
    console.log(`  · 声明例外  ${h.tag}${h.testid ? `[${h.testid}]` : ""}  —— ${h.why}`);
  }
  for (const h of unknown) {
    console.log(`  ? 判不了  ${h.tag}${h.testid ? `[${h.testid}]` : ""}  —— ${h.why}`);
    console.log(`         「${h.sample}」  class=${h.cls}`);
  }
  total += fail.length; undetermined += unknown.length;
  await page.close();
}
await browser.close();
console.log(`\n合计：不通过 ${total} 处，判不了 ${undetermined} 处（判不了**不算通过**）。`);
if (unaudited.length > 0) {
  console.log(`未审到 ${unaudited.length} 个页面（渲染不出来，不是通过）：\n  ${unaudited.join("\n  ")}`);
}
process.exit(total > 0 || unaudited.length > 0 ? 1 : 0);
