/**
 * 迭代 12（delta `paged-generation-and-doc-export` §3/§4）—— V46 / V47 / V48。
 *
 * V46 产物自包含且链接真的能点；V47 导出与实时画布同一套渲染；V48 PDF 打印视图的文档结构。
 */
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import * as React from "react";
import { EXPORT_SHELL_PALETTE, buildPrototypeExportHtml, classTokensOf, exportScreenId, localDateStamp, prototypeExportHtmlFileName } from "@/lib/prototype-export-html";
import { renderScreensToMarkup } from "@/lib/prototype-export-render";
import { PrototypeCanvas, deviceOf } from "@/components/design-loop/prototype-canvas";
import type { DesignProject } from "@/lib/live-design-workbench";

const PROJECT: DesignProject = {
  id: "p1", name: "订阅管理", template: "mobile", theme: "dark", accent: "neutral", tags: [], refImages: [], share: null, problem: "退订找不到", criteria: ["三步内退订"],
  frames: ["对话", "设置"],
  frameNotes: ["首屏即可发消息。", ""],
  prototype: [
    { id: "n1", type: "stack", children: [{ id: "n2", type: "navbar", props: { title: "对话" } }, { id: "send", type: "button", props: { label: "发送", variant: "primary" } }] },
    { id: "n4", type: "stack", children: [{ id: "n5", type: "list", props: { items: ["账号", "外观"] } }] },
  ],
  frameLinks: [[{ from: "send", to: 1 }], []],
  pushed: false, pushedAt: null, linkedFeedbackId: null, githubIssueUrl: null, githubIssueNumber: null,
  chat: [], ownerId: "u1", ownerName: "我", createdAt: "2026-09-07T00:00:00.000Z", updatedAt: "2026-09-07T00:00:00.000Z",
};
const NOW = new Date("2026-09-07T12:00:00.000Z");
/** 第一页那棵树，给"只画了一半"的场景复用。 */
const PROTOTYPE_FIRST = PROJECT.prototype[0]!;

/** 迭代 23：主题化的构建——模块级，两个 describe 共用（原来只在 V69 那个块里）。 */
const buildWithTheme = async (theme: "light" | "dark") => {
  const p = { ...PROJECT, theme };
  const screens = await renderScreensToMarkup(p);
  return buildPrototypeExportHtml({ project: p, screens, css: "", now: NOW });
};

const build = async (forPrint = false) => {
  const screens = await renderScreensToMarkup(PROJECT);
  return buildPrototypeExportHtml({ project: PROJECT, screens, css: ".x{color:red}", now: NOW, ...(forPrint ? { forPrint: true } : {}) });
};

describe("V46 导出 HTML 是自包含的，链接真的能点", () => {
  it("无任何外链：不引 CDN、不引外部脚本或样式", async () => {
    const html = await build();
    // 反证锚点：把内联 <style> 换成外链 CDN，这三条里至少一条会红。
    expect(html).not.toContain("<script src");
    expect(html).not.toContain("<link rel=\"stylesheet\"");
    expect(html.replace(/https?:\/\/www\.w3\.org/g, "")).not.toMatch(/https?:\/\//);
  });

  it("每页一个锚点，页数 == frames.length；说明与跳转清单都在", async () => {
    const html = await build();
    for (const i of PROJECT.frames.keys()) expect(html).toContain(`id="${exportScreenId(i)}"`);
    expect(html.match(/class="wx-page"/g)).toHaveLength(PROJECT.frames.length);
    expect(html).toContain("首屏即可发消息。");
    // 跳转清单是人话（第几页 + 页标签），不是裸序号
    expect(html).toContain("第 2 页「设置」");
    expect(html).toContain("这一页没有跳转。");
  });

  it("跳转脚本按真实节点 id 寻址，且每条 link 都进了脚本的表", async () => {
    const html = await build();
    expect(html).toContain('data-node-id="');
    expect(html).toContain('{"f":"send","i":null,"t":1}');
    // 源节点的 id 真的出现在渲染出来的 markup 里——否则脚本查不到，链接是死的
    const markup = (await renderScreensToMarkup(PROJECT))[0]!.markup;
    expect(markup).toContain('data-node-id="send"');
  });

  /**
   * UIUX 第 17 轮：这条断言原来钉着的正是那个 bug。2026-09-23 用本机 Chromium 实测
   * `<a download>` + blob URL：名字里只要有非 ASCII，Chromium 就把**整个名字连扩展名**
   * 丢成 `download`——也就是说「订阅管理-可点击原型-….html」这个名字从来没有落到过
   * 任何人的硬盘上，用户拿到的一直是一个叫 `download` 的无扩展名文件。
   * 项目名里的中文留不住（退兜底 `design`），但「可点击原型」这四个字是我们自己塞进去的，
   * 改成 ASCII 之后至少扩展名和日期是活的。规则单源见 `lib/export-file-name.ts`。
   */
  it("文件名是浏览器真的会留下的那种（纯 ASCII，带日期与扩展名）", () => {
    const name = prototypeExportHtmlFileName(PROJECT.name, NOW);
    expect(name).toBe("design-prototype-2026-09-07.html");
    expect(name).toMatch(/^[\x20-\x7e]+$/);
    // 项目名本身是 ASCII 时要留住它——兜底不是把所有名字都抹平。
    expect(prototypeExportHtmlFileName("member-flow", NOW)).toBe("member-flow-prototype-2026-09-07.html");
  });
});

describe("V47 导出与实时画布是同一套渲染", () => {
  it("同一棵树：导出 markup 的语义 class 集合与实时渲染一致", async () => {
    const live = render(
      React.createElement(PrototypeCanvas, {
        label: PROJECT.frames[0]!, root: PROJECT.prototype[0]!, device: deviceOf(PROJECT.template),
        frameIndex: 0, mode: "preview" as const, links: PROJECT.frameLinks![0]!,
      }),
    );
    // 用产品代码里那个**解转义**的取词函数——`renderToStaticMarkup` 会把属性里的 `>` 转义，
    // 按原始字符串比会把"同一个 class"看成两个（这正是它当初暴露出来的那个抽样式 bug）。
    const classesOf = (html: string) => [...new Set(classTokensOf(html))].sort();
    const exported = (await renderScreensToMarkup(PROJECT))[0]!.markup;
    // ⚠ 反证：导出侧另写一个 renderNodeHtml，这条必红——那正是"同一件事声明在两处"的形态。
    expect(classesOf(exported)).toEqual(classesOf(live.container.innerHTML));
    // 原语标记也一致（新增一个原语时，两边同时出现或同时不出现）
    const protos = (html: string) => [...new Set([...html.matchAll(/data-proto="([a-z]+)"/g)].map((m) => m[1]!))].sort();
    expect(protos(exported)).toEqual(protos(live.container.innerHTML));
    expect(protos(exported)).toContain("button");
  });
});

describe("V48 PDF 打印视图：界面一节每页图文齐全", () => {
  it("打印视图里所有页都展开，页签隐藏，每页分页", async () => {
    const html = await build(true);
    // 屏幕版第 2 页起是 hidden（要点页签才看）；打印版一页都不能藏，否则打出来只有第一页
    expect(await build()).toContain('id="screen-1" hidden');
    expect(html).not.toContain('id="screen-1" hidden');
    expect(html).not.toContain('class="wx-tabs"');
    expect(html).toContain("page-break-after");
  });

  it("每页小节都有：标题 + 原型本身 + 交互说明 + 跳转清单", async () => {
    const html = await build(true);
    for (const [i, f] of PROJECT.frames.entries()) expect(html).toContain(`<h2>${i + 1}. ${f}</h2>`);
    expect(html.match(/class="wx-stage"/g)).toHaveLength(PROJECT.frames.length);
    expect(html.match(/交互说明/g)).toHaveLength(PROJECT.frames.length);
    expect(html.match(/<h3>跳转<\/h3>/g)).toHaveLength(PROJECT.frames.length);
    // 没写说明的页也要出小节（写「还没写」），不能整节消失
    expect(html).toContain("（还没写）");
  });
});

/**
 * 迭代 13（delta §5.2）—— V69。导出跟随**原型的** theme，
 * 与导出时后台碰巧是什么色无关。
 */
describe("V69 导出跟随原型主题", () => {
  it("浅色项目导出浅色；深色项目导出深色", async () => {
    const light = await buildWithTheme("light");
    const dark = await buildWithTheme("dark");
    expect(light).toContain('class="wx-light"');
    expect(light).toContain("color-scheme:light");
    expect(dark).toContain('class="dark"');
    expect(dark).toContain("color-scheme:dark");
    // ⭐ 反证锚点：导出时去读页面的 .dark（而不是项目的 theme）⇒ 两者会一样，这条红。
    expect(light).not.toBe(dark);
  });

  it("每块画板自己也带上主题作用域（不是只有最外层）", async () => {
    const markup = (await renderScreensToMarkup({ ...PROJECT, theme: "light" }))[0]!.markup;
    expect(markup).toContain("wx-light");
    expect(markup).toContain('data-theme="light"');
  });
});

/* ───────────── 迭代 23：交付物上的三件事——外壳配色、打印、跳转清单 ───────────── */

/** WCAG 相对亮度 / 对比度，吃 `#rrggbb`。与契约那侧同一套公式，这里只用在产物外壳上。 */
function contrastOf(a: string, b: string): number {
  const lum = (hex: string): number => {
    const ch = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
    const lin = ch.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * lin[0]! + 0.7152 * lin[1]! + 0.0722 * lin[2]!;
  };
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x! + 0.05) / (y! + 0.05);
}

describe("导出产物的外壳跟随项目主题，而不是硬编码深色", () => {
  it("浅色导出里不许再出现那几个深色字面量", async () => {
    /*
     * ⭐ 反证锚点：把 `.wx-tab` 的背景改回 `#17181c` ⇒ 这条红。
     *
     * 这是「原型自己的明暗主题」只做了一半：画布那一半跟着 token 走了，外壳（页签、
     * 分隔线、次要文字）留在深色。浅色项目导出来是米白底上扣着一排近黑药丸。
     * 既有的那条「浅色导出浅色」用例之所以一直绿，是因为它只比了 body 和 html
     * ——测试还在，它守的东西已经不完整了。
     */
    const light = await buildWithTheme("light");
    for (const dark of ["#17181c", "#33343a", "#0b0b0c"]) {
      expect(light, `浅色产物里不该出现深色字面量 ${dark}`).not.toContain(dark);
    }
    expect(light).toContain(EXPORT_SHELL_PALETTE.light.chip);
    expect(light).toContain(EXPORT_SHELL_PALETTE.light.line);
  });

  it("两套外壳配色的文字对比度都过 AA（4.5:1），页签选中态也算", () => {
    // ⭐ 反证锚点：把 light.muted 调到 #b0b0b0（看着"淡一点更好看"）⇒ 这条红。
    for (const theme of ["light", "dark"] as const) {
      const p = EXPORT_SHELL_PALETTE[theme];
      expect(contrastOf(p.bg, p.fg), `${theme} 正文`).toBeGreaterThanOrEqual(4.5);
      expect(contrastOf(p.bg, p.muted), `${theme} 次要文字`).toBeGreaterThanOrEqual(4.5);
      expect(contrastOf(p.chipOn, p.chipOnFg), `${theme} 页签选中态`).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe("打印视图：PDF 不多一张白纸，纸上不留点不动的虚线", () => {
  it("末页不再分页", async () => {
    /*
     * ⭐ 反证锚点：删掉 `.wx-page:last-of-type{page-break-after:auto}` ⇒ 这条红。
     * `page-break-after:always` 对每一页生效，最后一页后面那一次分页在 PDF 结尾
     * 凭空多出一张空白纸——屏上看不出来，交付物上每次都在。
     */
    const html = await build(true);
    expect(html).toContain("page-break-after:auto");
    expect(html).toMatch(/\.wx-page:last-of-type\{[^}]*page-break-after:auto/);
  });

  it("可跳转的虚线框在纸上撤掉——解释它的那句提示语打印时本来就被隐藏了", async () => {
    // ⭐ 反证锚点：去掉打印里的 `outline:none` ⇒ 这条红。纸上会留一圈没人说得清是什么的虚线。
    const html = await build(true);
    const printBlock = /@media print\{([\s\S]*?)\n\}/.exec(html)?.[1] ?? "";
    expect(printBlock, "没抓到 @media print 块，这条会以错误的理由通过").not.toBe("");
    expect(printBlock).toContain("[data-proto][data-linked]{outline:none}");
    expect(printBlock).toContain(".wx-hint{display:none}".replace(".wx-hint", ".wx-tabs,.wx-hint"));
  });

  it("画板与说明块不许被拦腰切开", async () => {
    const printBlock = /@media print\{([\s\S]*?)\n\}/.exec(await build(true))?.[1] ?? "";
    expect(printBlock).toContain("break-inside:avoid");
  });
});

describe("跳转清单写人话标签，不是裸节点 id", () => {
  it("「按钮「发送」 → 第 2 页「设置」」，而不是「send → 第 2 页」", async () => {
    /*
     * ⭐ 反证锚点：把 `labelOf(l.from)` 改回 `l.from` ⇒ 这条红。
     *
     * `design-doc-markdown.ts` 早在迭代 11 就改成了人话标签，注释里逐字写着
     * 「文档的读者是人」——而这份导出的 HTML 是同一批读者，一直在打印裸 id。
     * 同一件事在一处修了、另一处没跟上。
     */
    const html = await build();
    expect(html).toContain("按钮「发送」");
    expect(html).not.toMatch(/<li>send/);
  });

  it("id 在树里找不到时回落成裸 id，不编一个标签出来", async () => {
    const screens = await renderScreensToMarkup(PROJECT);
    const html = buildPrototypeExportHtml({
      project: { ...PROJECT, frameLinks: [[{ from: "已经不在了", to: 1 }], []] },
      screens, css: "", now: NOW,
    });
    expect(html).toContain("已经不在了");
  });
});

describe("迭代 37：交付物是别人打开的那个文件", () => {
  it("没画出来的页说「这一页没画出来」，不是叫收件人去对话框里说一句", async () => {
    /*
     * ⭐ 反证锚点：把 `ungenerated` 那个 prop 去掉 ⇒ 这条红。
     *
     * 这是自包含文件，里面**根本没有对话框**。此前未画出的页导出的是画布空项目态那句
     * 「在对话里说一句你要做什么，我就画出来」——收件人对着一句做不到的指示，
     * 既不知道这页是漏了还是坏了。分享页（访客那一侧）早就按 `ungenerated` 如实说，
     * 导出这一侧一直没跟上。
     */
    const p: DesignProject = { ...PROJECT, frames: ["对话", "还没画的那页"], prototype: [PROTOTYPE_FIRST, null], frameLinks: [[], []] };
    const screens = await renderScreensToMarkup(p);
    const html = buildPrototypeExportHtml({ project: p, screens, css: "", now: NOW });
    expect(html).toContain("这一页没画出来");
    expect(html).not.toContain("在对话里说一句你要做什么");
  });

  it("导出日期按本地日历，不是 UTC 的那一天", () => {
    /*
     * ⭐ 反证锚点：改回 `toISOString().slice(0,10)` ⇒ 这条红。
     * 东八区凌晨 0–8 点导出时，UTC 还停在昨天——一份交付物把自己的生成日期说错一天，
     * 而这正是收件人用来判断"是不是最新那版"的那个数。
     */
    /*
     * ⚠ 这条**必须显式设时区**才有判别力：CI 跑在 UTC 上，而 UTC 下「本地日历」与
     *   `toISOString()` 永远一致——第一版没设 TZ，把实现改回 UTC 它照样绿，
     *   是一条没有判别力的断言（实测发现）。Node 会在运行时重读 `process.env.TZ`。
     */
    const tz = process.env.TZ;
    process.env.TZ = "Asia/Shanghai";
    try {
      // 东八区的 9 月 8 日 01:00 —— UTC 那一刻还停在 9 月 7 日 17:00。
      const localEarlyMorning = new Date(Date.UTC(2026, 8, 7, 17, 0, 0));
      expect(localEarlyMorning.toISOString().slice(0, 10)).toBe("2026-09-07"); // 先证明这个场景真的分得开
      expect(localDateStamp(localEarlyMorning)).toBe("2026-09-08");
      expect(prototypeExportHtmlFileName("订阅管理", localEarlyMorning)).toContain("2026-09-08");
    } finally {
      if (tz === undefined) delete process.env.TZ; else process.env.TZ = tz;
    }
  });

  it("可跳转元素能用键盘走：有 role/tabindex 与回车处理", async () => {
    // ⭐ 反证锚点：去掉脚本里那三行（role/tabindex/keydown）⇒ 这条红。
    const html = await build();
    expect(html).toContain("setAttribute('role', 'link')");
    expect(html).toContain("setAttribute('tabindex', '0')");
    expect(html).toContain("addEventListener('keydown'");
    expect(html).toContain("[data-proto][data-linked]:focus-visible");
  });

  it("一条跳转都没有时，不说「点带虚线框的元素可以跳转」——那是一件不存在的事", async () => {
    // ⭐ 反证锚点：把提示改回无条件输出 ⇒ 这条红。
    const p: DesignProject = { ...PROJECT, frameLinks: [[], []] };
    const screens = await renderScreensToMarkup(p);
    const html = buildPrototypeExportHtml({ project: p, screens, css: "", now: NOW });
    expect(html).not.toContain("点带虚线框的元素可以跳转");
    const withLinks = await build();
    expect(withLinks).toContain("点带虚线框的元素可以跳转");
  });
});
