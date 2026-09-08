/**
 * 迭代 12（delta `paged-generation-and-doc-export` §3/§4）—— V46 / V47 / V48。
 *
 * V46 产物自包含且链接真的能点；V47 导出与实时画布同一套渲染；V48 PDF 打印视图的文档结构。
 */
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import * as React from "react";
import { buildPrototypeExportHtml, classTokensOf, exportScreenId, prototypeExportHtmlFileName } from "@/lib/prototype-export-html";
import { renderScreensToMarkup } from "@/lib/prototype-export-render";
import { PrototypeCanvas, deviceOf } from "@/components/design-loop/prototype-canvas";
import type { DesignProject } from "@/lib/live-design-workbench";

const PROJECT: DesignProject = {
  id: "p1", name: "订阅管理", template: "mobile", theme: "dark", tags: [], refImages: [], problem: "退订找不到", criteria: ["三步内退订"],
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

  it("文件名带项目名与日期", () => {
    expect(prototypeExportHtmlFileName(PROJECT.name, NOW)).toBe("订阅管理-可点击原型-2026-09-07.html");
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
  const buildWith = async (theme: "light" | "dark") => {
    const p = { ...PROJECT, theme };
    const screens = await renderScreensToMarkup(p);
    return buildPrototypeExportHtml({ project: p, screens, css: "", now: NOW });
  };

  it("浅色项目导出浅色；深色项目导出深色", async () => {
    const light = await buildWith("light");
    const dark = await buildWith("dark");
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
