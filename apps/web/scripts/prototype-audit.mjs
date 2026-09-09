/**
 * 原型截图审计——渲染真组件、量真实 DOM、出机器分，`< 80` 退非零。
 *
 * 用法（需要一个已经起好的 web 服务）：
 *   BASE=http://localhost:3187 OUT=/tmp/audit node apps/web/scripts/prototype-audit.mjs
 *
 * ## 为什么复用 `/preview/feedback-design-loop`
 *
 * 那一页渲染的是**真组件**，数据由 `page.route` 拦截的夹具提供（`lib/design-loop-fixtures.mjs`）。
 * 再造一套渲染入口就是第二份事实源，而且更容易「审计的那份和用户看到的那份不是同一个」。
 *
 * ## 量的是 DOM 几何，不是像素
 *
 * 像素分析要引图像库、且阈值全靠调；DOM 几何（位置/尺寸/字号/是否被裁）是确定性的，
 * 也正好覆盖用户点名的那几类毛病。⚠ 必须真浏览器：jsdom 没有布局，`getBoundingClientRect`
 * 全是 0，量出来的一切都是假的——那正是「测试为了错误的理由通过」。
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "@playwright/test";
import { routeDesignWorkbench } from "./lib/design-loop-fixtures.mjs";
import { machineScore } from "./lib/prototype-audit-metrics.mjs";

const BASE = process.env.BASE ?? "http://localhost:3187";
const OUT = process.env.OUT ?? "/tmp/prototype-audit";
const THRESHOLD = Number(process.env.AUDIT_THRESHOLD ?? "80");
mkdirSync(OUT, { recursive: true });

/**
 * 被审的场景。每条 = 一张截图 + 一份度量。
 *
 * ⚠ `frameSelector` 逐场景给：单页视图的画板是 `design-detail-phone-tree`，画板视图是
 * `design-detail-board-frame-0`。用同一个选择器套两种视图，画板视图会量不到任何节点——
 * 首跑实测就是这样（判 0「拒绝下判断」，空集防线接住了，但那是我的选择器错，不是产品错）。
 *
 * ⚠ `board-laptop` 是**人类 2026-09-09 那张截图的配置**：画板视图 + 笔记本镜头 + 移动端
 * 内容。这条是整道门的验收——它要是判绿，这道门就是装饰。
 */
const CASES = [
  { id: "detail-prototype-dark", scene: "detail-prototype", theme: "dark",
    frameSelector: "[data-testid='design-detail-phone-tree']", nodeSelector: "[data-proto]" },
  { id: "detail-prototype-light", scene: "detail-prototype", theme: "light",
    frameSelector: "[data-testid='design-detail-phone-tree']", nodeSelector: "[data-proto]" },
  { id: "board-frame-dark", scene: "detail-prototype", theme: "dark", view: "board",
    frameSelector: "[data-testid='design-detail-board-frame-0']", nodeSelector: "[data-proto]" },
  { id: "board-frame-laptop", scene: "detail-prototype", theme: "dark", view: "board", device: "laptop",
    frameSelector: "[data-testid='design-detail-board-frame-0']", nodeSelector: "[data-proto]" },

  /**
   * ⚠ 下面两条是**首跑看图之后补的**，记下来因为它们是「门看不见用户看得见的东西」的活例子：
   *
   * · `board-stage`——只量画板内部时，画布被缩到 18%、三个画板挤在正中、四周一大片空，
   *   四条指标全绿。用户一眼就说不专业的那个东西，门完全没看见。量程要覆盖**画板在画布上
   *   占多少**，不只是内容在画板里占多少。
   * · `workbench-chrome`——图层面板的文字被右边缘切掉（人类那张截图点名的第 8 条），
   *   而裁切指标当时只扫原型内部，扫不到工作台自己。审计要审**用户看到的那一屏**，
   *   不是只审我们生成的那一小块。
   */
  { id: "board-stage", scene: "detail-prototype", theme: "dark", view: "board",
    frameSelector: "[data-testid='design-detail-board']", nodeSelector: "[data-board-frame]",
    only: ["fill", "density"] },
  { id: "workbench-chrome", scene: "detail-prototype", theme: "dark",
    frameSelector: "[data-testid='design-detail']", nodeSelector: "button, span, p, h1, h2, h3, li",
    only: ["clipping"] },
];


/**
 * 在浏览器里采集度量。
 * `clipped` 判据：元素的实际内容宽于它自己的可视宽度（`scrollWidth > clientWidth + 1`）——
 * 就是「文字被容器切掉」那种。1px 容差躲开子像素。
 */
/**
 * 在浏览器里采集度量（由 playwright 序列化后在页面上下文执行）。
 * `clipped` 判据：元素的实际内容宽于它自己的可视宽度（`scrollWidth > clientWidth + 1`）——
 * 就是「文字被容器切掉」那种。1px 容差躲开子像素。
 */
function measureInPage({ frameSelector, nodeSelector }) {
  const frameEl = document.querySelector(frameSelector);
  if (!frameEl) return { frame: { w: 0, h: 0 }, nodes: [] };
  const fr = frameEl.getBoundingClientRect();
  const nodes = [...frameEl.querySelectorAll(nodeSelector)]
    .map((el) => {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return {
        x: r.x - fr.x, y: r.y - fr.y, w: r.width, h: r.height,
        fontSize: parseFloat(cs.fontSize) || 0,
        // ⚠ 溢出 ≠ 缺陷。`text-overflow: ellipsis` 是**告知**——省略号就是在说
        // 「这里还有内容」，图层名截断是正当的。首跑把两条带省略号的图层名判成缺陷，
        // 门红在一个不存在的问题上；一道会误报的门，迟早被调松或被无视。
        // 真缺陷是**没有任何提示的硬切**：溢出了，还不给省略号。
        clipped: el.scrollWidth > el.clientWidth + 1 && cs.textOverflow !== "ellipsis",
        tag: el.getAttribute("data-proto") ?? el.tagName.toLowerCase(),
      };
    })
    .filter((n) => n.w > 0 && n.h > 0);
  return { frame: { w: fr.width, h: fr.height }, nodes };
}

const browser = await chromium.launch();
const results = [];
for (const c of CASES) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: c.theme });
  const page = await context.newPage();
  await routeDesignWorkbench(page, {});
  await page.goto(`${BASE}/preview/feedback-design-loop?scene=${c.scene}&state=default`, { waitUntil: "networkidle" });
  await page.waitForTimeout(800);
  // 画板/单页同样点真控件切。
  if (c.view === "board") {
    await page.click("[data-testid='design-detail-view-board']").catch(() => {});
    await page.waitForTimeout(500);
  }
  // 换镜头走的是真控件（`design-detail-device` 那个 select），不是塞状态——审计要审用户
  // 真能走到的配置，而不是一个只有测试到得了的内部状态。
  if (c.device) {
    await page.selectOption("[data-testid='design-detail-device']", c.device).catch(() => {});
    await page.waitForTimeout(500);
  }
  await page.screenshot({ path: join(OUT, `${c.id}.png`) });

  const sample = await page.evaluate(measureInPage, {
    frameSelector: c.frameSelector,
    nodeSelector: c.nodeSelector,
  }).catch(() => null);
  await context.close();

  if (sample === null || sample.nodes.length === 0) {
    results.push({ ...c, error: "量不到任何节点——拒绝下判断，判 0", score: 0, parts: null });
    continue;
  }
  const m = machineScore(sample, c.only);
  results.push({ ...c, score: m.total, parts: m.parts, nodeCount: sample.nodes.length, frame: sample.frame });
}
await browser.close();

// 空集防线：一条都没审到 ⇒ 红，不许因为「没发现问题」而判绿（本仓九次「全绿但空转」）。
if (results.length === 0) {
  console.error("❌ [prototype-audit] 一个场景都没审到——拒绝判绿");
  process.exit(1);
}

const worst = Math.min(...results.map((r) => r.score));
writeFileSync(join(OUT, "audit.json"), JSON.stringify({ threshold: THRESHOLD, worst, results }, null, 2));

for (const r of results) {
  const head = `${r.score >= THRESHOLD ? "✅" : "❌"} ${r.id.padEnd(26)} ${String(r.score).padStart(3)} 分`;
  console.log(head + (r.error ? `  ${r.error}` : ""));
  if (r.parts) for (const [k, v] of Object.entries(r.parts)) {
    console.log(`      ${k.padEnd(10)} ${String(Math.round(v.score)).padStart(3)}  ${v.note}`);
  }
}
console.log(`\n截图与 audit.json 落在 ${OUT}`);
if (worst < THRESHOLD) {
  console.error(`\n❌ [prototype-audit] 最低分 ${String(worst)} < ${String(THRESHOLD)}——不许说做完，改到 ${String(THRESHOLD)} 分再来`);
  process.exit(1);
}
console.log(`\n✅ [prototype-audit] 最低分 ${String(worst)} ≥ ${String(THRESHOLD)}`);
