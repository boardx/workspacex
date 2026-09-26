/**
 * 可见文本的**对比度**判据 —— 单一事实源。
 *
 * 两个消费者共用这一份：CI 里的 `e2e/prototype-audit.spec.ts`（门控），以及手工排查用的
 * `scripts/audit-text-contrast.ts`（CLI）。判据只声明一次，不许两处各写一份——本仓头号病。
 *
 * ## 为什么判据是对比度，而不是 class 名
 *
 * 2026-09-22 抓到的那个缺陷（切换对话框白字白底）教了两件事：
 *   · 所有**几何**判据都会说它可见：`isVisible()` 为真、`getBoundingClientRect` 给出 373×48、
 *     `elementFromPoint` 返回它自己。对比度不在它们的判据里。
 *   · 按 **token 名**静态分类两个方向都会错：`text-primary-foreground/80` 在
 *     `<Button variant="primary">` 里由组件给底色，看文件看不到（判成缺陷，其实合法）；
 *     而父级写着 `bg-warning/5` 的，名字里有 `bg-warning`、5% 却浅到接近白（判成合法，其实是缺陷）。
 *     **名字对了，对比度可以是错的。**
 *
 * 阈值：正文 4.5、大字（>=24px 或 >=18.66px 粗体）3.0、**图标 3.0**（非文本内容，WCAG 1.4.11）。
 *
 * ## 五种结论，后三种都不算通过
 *   通过 / 不通过 / **判不了**（祖先链上有 `opacity`/`filter`/`mix-blend-mode`/`background-image`
 *   ——它们改变呈现却不改 `backgroundColor` 的计算值）/ **声明例外**
 *   （调用点写 `data-contrast-exempt="理由"`，空字符串不算）/ 透明跳过（`color: transparent`
 *   的 hover-reveal 惯用法，故意不显示）。
 *
 * ## `examined` 必须被消费者断言
 *
 * 没有它，「0 处不通过」与「这页根本没渲染」在输出上一模一样——第一次跑 `/projects` 时
 * 我正是这样差点把空白页当成通过。同 `lint-arch-deps` 打 `scanned=` 的理由。
 */
export const AA_NORMAL = 4.5;
export const AA_LARGE = 3.0;

/**
 * 每条路由「至少该审到多少个元素」的**基线**，来自实测而不是拍脑袋。
 *
 * ## 为什么必须按页记，而不是一个全局阈值
 *
 * 页面之间差得很远（实测：`/chat` 230、`/tpl` 206、`/preview/agent-kernel` 43）。
 * 一个绝对阈值要么对内容少的页面误杀、要么对内容多的页面形同虚设——`agent-kernel` 的 43
 * 距离我第一版 CLI 里那个 40 只差 3 个元素，**再少一点就会被判成「未审到」**。
 *
 * ⚠ 这一份是**单一事实源**。第一版把下限写在两个消费者里（门控 20、CLI 40），也就是同一个
 * 判据声明在两处——本仓头号病，而且两个数还不一样。并行会话复核时点出了这件事。
 *
 * 取值 = 实测值的一半（向下取整到十位）：真渲染出来的页面不会掉一半，而重定向到登录页/
 * 空白页只有个位数，一定掉破。页面内容大改之后这个数要跟着改，改的时候顺手把新实测值记进来。
 */
export const EXAMINED_BASELINE: Readonly<Record<string, number>> = {
  "/preview/live-collab-orchestration": 24, // 实测 49
  "/preview/agent-kernel": 20,              // 实测 43
  "/preview/plan-control": 20,              // 实测 40+
  "/preview/chat-viz": 20,                  // 实测 40+
};

/** 没有记过基线的路由用这个兜底。刻意保守：宁可漏判，也不要因为一个拍的数字误杀。 */
export const EXAMINED_FALLBACK = 12;

/** 这条 URL 的下限。按 pathname 匹配，所以同一条路由在不同端口/主机上共用一份基线。 */
export function examinedFloor(url: string): number {
  let pathname = url;
  try { pathname = new URL(url, "http://localhost").pathname; } catch { /* 已经是 path */ }
  return EXAMINED_BASELINE[pathname] ?? EXAMINED_FALLBACK;
}

export interface ContrastHit {
  readonly ratio: number; readonly threshold: number; readonly tag: string;
  readonly testid: string | null; readonly cls: string; readonly sample: string;
  readonly fg: string; readonly bg: string;
}
export interface ContrastNote {
  readonly tag: string; readonly testid: string | null; readonly cls: string;
  readonly sample: string; readonly why: string;
}
export interface ContrastReport {
  readonly fail: readonly ContrastHit[];
  readonly unknown: readonly ContrastNote[];
  readonly exempt: readonly ContrastNote[];
  readonly transparent: number;
  readonly examined: number;
  readonly bodyChars: number;
}

/** 在页面里跑的那段。`page.evaluate(auditTextContrast, { aaNormal, aaLarge })`。 */
export const auditTextContrast = ({ aaNormal, aaLarge }: { aaNormal: number; aaLarge: number }): ContrastReport => {
  interface Rgba { r: number; g: number; b: number; a: number }
  const parse = (c: string): Rgba | null => {
    const m = c.match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const p = m[1]!.split(",").map((x: string) => parseFloat(x));
    return { r: p[0] ?? 0, g: p[1] ?? 0, b: p[2] ?? 0, a: p.length > 3 ? (p[3] ?? 1) : 1 };
  };
  const lum = ({ r, g, b }: Rgba): number => {
    const f = (v: number): number => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const over = (fg: Rgba, bg: Rgba): Rgba => ({
    r: fg.r * fg.a + bg.r * (1 - fg.a),
    g: fg.g * fg.a + bg.g * (1 - fg.a),
    b: fg.b * fg.a + bg.b * (1 - fg.a),
    a: 1,
  });
  /**
   * 有效背景。返回 `{ bg }` 或 `{ unknown: "原因" }`——**判不了就说判不了**，
   * 不返回一个算得出来但不对的颜色。
   */
  const effectiveBg = (el: Element): { bg: Rgba } | { unknown: string } => {
    let node: Element | null = el;
    const stack: Rgba[] = [];
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
    let acc: Rgba = { r: 255, g: 255, b: 255, a: 1 };
    for (let i = stack.length - 1; i >= 0; i -= 1) acc = over(stack[i]!, acc);
    return { bg: acc };
  };
  const out: ContrastHit[] = [];
  const unknown: ContrastNote[] = [];
  const exempt: ContrastNote[] = [];
  const transparent: Omit<ContrastNote, "why">[] = [];
  // 审了多少个候选元素。**必须报出来**：没有它，「0 处不通过」与「这页根本没渲染」
  // 在输出上一模一样——本仓 `lint-arch-deps` 打 `scanned=` 正是为了同一件事。
  let examined = 0;
  for (const el of document.querySelectorAll("*")) {
    // 只看自己直接持有可见文字的元素，避免把容器算进来
    const own = [...el.childNodes].filter((n) => n.nodeType === 3 && (n.textContent ?? "").trim() !== "");
    const icon = el.tagName.toLowerCase() === "svg";
    if (own.length === 0 && !icon) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === "hidden" || cs.display === "none" || parseFloat(cs.opacity) === 0) continue;
    const describeEl = () => ({
      tag: el.tagName.toLowerCase(),
      testid: el.getAttribute("data-testid") ?? el.closest("[data-testid]")?.getAttribute("data-testid") ?? null,
      cls: (el.getAttribute("class") ?? "").slice(0, 120),
      sample: (own.map((n) => (n.textContent ?? "").trim()).join(" ") || "(icon)").slice(0, 60),
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
    if ("unknown" in resolved) { unknown.push({ ...describeEl(), why: resolved.unknown }); continue; }
    const bg = resolved.bg;
    const fg = fgRaw.a >= 0.999 ? fgRaw : over(fgRaw, bg);
    const l1 = lum(fg), l2 = lum(bg);
    const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
    const size = parseFloat(cs.fontSize);
    const bold = parseInt(cs.fontWeight, 10) >= 700;
    /*
     * 图标是**非文本内容**，WCAG 2.1 的 1.4.11 要求 3:1，不是正文的 4.5:1。
     * ⚠ 这是审计器自己的第四个误报：`/preview/live-collab-orchestration` 上一个
     * `text-warning` 图标量到 4.4x，按正文阈值判红——而它按非文本阈值是合格的。
     * 把图标按正文判，会让「该修的」和「本来就合规的」混在一起，人就不会认真看这份报告了。
     */
    const threshold = icon ? aaLarge : (size >= 24 || (bold && size >= 18.66) ? aaLarge : aaNormal);
    if (ratio >= threshold) continue;
    out.push({
      ratio: +ratio.toFixed(2), threshold, tag: el.tagName.toLowerCase(),
      testid: el.getAttribute("data-testid") ?? el.closest("[data-testid]")?.getAttribute("data-testid") ?? null,
      cls: (el.getAttribute("class") ?? "").slice(0, 120),
      sample: (own.map((n) => (n.textContent ?? "").trim()).join(" ") || "(icon)").slice(0, 60),
      fg: `rgb(${Math.round(fg.r)}, ${Math.round(fg.g)}, ${Math.round(fg.b)})`,
      bg: `rgb(${Math.round(bg.r)}, ${Math.round(bg.g)}, ${Math.round(bg.b)})`,
    });
  }
  return { fail: out, unknown, exempt, transparent: transparent.length, examined, bodyChars: document.body.innerText.trim().length };
};
