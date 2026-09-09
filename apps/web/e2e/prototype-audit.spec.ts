import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { routeDesignWorkbench } from "../scripts/lib/design-loop-fixtures.mjs";
import { machineScore, type AuditSample } from "../scripts/lib/prototype-audit-metrics.mjs";

/**
 * 原型截图审计——**机器硬判**那一半，`< 80` 判红（2026-09-09 人类指令：
 * 「你做完一次设计，界面出来以后，你要有一个机制，做截图 audit，迭代到 80 分才放行」）。
 *
 * ## 为什么要有这道门
 *
 * 迭代 14 交付时单测全绿、`apps/web` 3373 条全绿、PR 22 条 check 全绿、doctor 干净，
 * 而用户打开看到的是移动端内容塞进 1280×800 笔记本画板、图层面板文字被切、气泡全部
 * 左对齐。**既有的门看的都是「代码对不对」，没有一道看「它长得像不像个东西」。**
 *
 * ## 为什么是 playwright 用例而不是一个独立脚本
 *
 * 独立脚本要求「先手动起服务」，在 CI 上没有人去做。本仓 issue #3138 已经有三个
 * playwright 车道从来没在 CI 上跑过——再加一条跑不起来的等于假门。写成用例之后
 * 服务由 config 的 `webServer` 起，本地与 CI 同一条命令，且只有一份实现。
 *
 * ## 量 DOM 几何，不量像素
 *
 * 像素分析要引图像库、阈值全靠调；DOM 几何（位置/尺寸/字号/是否被裁）是确定性的。
 * ⚠ 必须真浏览器——jsdom 没有布局，`getBoundingClientRect` 全是 0，量出来的一切都是假的。
 */

const THRESHOLD = Number(process.env.AUDIT_THRESHOLD ?? "80");
const OUT = process.env.AUDIT_OUT ?? join(process.cwd(), "test-results", "prototype-audit");

interface AuditCase {
  readonly id: string;
  readonly theme: "dark" | "light";
  readonly frameSelector: string;
  readonly nodeSelector: string;
  readonly view?: "board";
  readonly device?: string;
  /** 只判这几条指标（权重按所选项重新归一）。 */
  readonly only?: readonly string[];
}

/**
 * ⚠ `frameSelector` 逐场景给：单页视图的画板是 `design-detail-phone-tree`，画板视图是
 * `design-detail-board-frame-0`。用同一个选择器套两种视图，画板视图会量不到任何节点。
 *
 * ⚠ 后两条是**首跑对着截图核对之后补的**，记下来因为它们是「门看不见用户看得见的东西」
 * 的活例子：
 * · `board-stage`——只量画板内部时，画布缩到 18%、三个画板挤在正中、四周一大片空，
 *   五条指标全绿。量程要覆盖**画板在画布上占多少**。
 * · `workbench-chrome`——图层面板文字被右边缘切掉（人类那张截图点名的第 8 条），
 *   而裁切指标当时只扫原型内部。审计要审**用户看到的那一屏**。
 */
const CASES: readonly AuditCase[] = [
  { id: "detail-prototype-dark", theme: "dark",
    frameSelector: "[data-testid='design-detail-phone-tree']", nodeSelector: "[data-proto]" },
  { id: "detail-prototype-light", theme: "light",
    frameSelector: "[data-testid='design-detail-phone-tree']", nodeSelector: "[data-proto]" },
  { id: "board-frame-dark", theme: "dark", view: "board",
    frameSelector: "[data-testid='design-detail-board-frame-0']", nodeSelector: "[data-proto]" },
  { id: "board-frame-laptop", theme: "dark", view: "board", device: "laptop",
    frameSelector: "[data-testid='design-detail-board-frame-0']", nodeSelector: "[data-proto]" },
  { id: "board-stage", theme: "dark", view: "board",
    frameSelector: "[data-testid='design-detail-board']", nodeSelector: "[data-board-frame]",
    only: ["fill", "density"] },
  { id: "workbench-chrome", theme: "dark",
    frameSelector: "[data-testid='design-detail']", nodeSelector: "button, span, p, h1, h2, h3, li",
    only: ["clipping"] },
];

/**
 * 在浏览器里采集度量。
 *
 * ⚠ `clipped` 的判据是「溢出**且**没有省略号」。省略号是**告知**不是缺陷——首跑没排除
 * `text-overflow: ellipsis`，门红在两条正常截断的图层名上；一道会误报的门迟早被调松
 * 或被无视（#3151 的教训）。
 */
function measureInPage({ frameSelector, nodeSelector }: { frameSelector: string; nodeSelector: string }) {
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
        clipped: el.scrollWidth > el.clientWidth + 1 && cs.textOverflow !== "ellipsis",
        tag: el.getAttribute("data-proto") ?? el.tagName.toLowerCase(),
      };
    })
    .filter((n) => n.w > 0 && n.h > 0);
  return { frame: { w: fr.width, h: fr.height }, nodes };
}

async function openDetail(page: Page, c: AuditCase): Promise<void> {
  await routeDesignWorkbench(page, {});
  await page.emulateMedia({ colorScheme: c.theme });
  await page.goto("/preview/feedback-design-loop?scene=detail-prototype&state=default", { waitUntil: "networkidle" });
  await page.waitForTimeout(800);
  // 画板/单页、换镜头都点**真控件**——审计要审用户真能走到的配置，不是只有测试到得了的内部状态。
  if (c.view === "board") {
    await page.click("[data-testid='design-detail-view-board']");
    await page.waitForTimeout(500);
  }
  if (c.device !== undefined) {
    await page.selectOption("[data-testid='design-detail-device']", c.device);
    await page.waitForTimeout(500);
  }
}

test.describe("原型截图审计（机器硬判）", () => {
  for (const c of CASES) {
    test(`${c.id} 机器分 ≥ ${String(THRESHOLD)}`, async ({ page }) => {
      mkdirSync(OUT, { recursive: true });
      await openDetail(page, c);
      await page.screenshot({ path: join(OUT, `${c.id}.png`) });

      const sample = (await page.evaluate(measureInPage, {
        frameSelector: c.frameSelector,
        nodeSelector: c.nodeSelector,
      })) as AuditSample;

      // 空集防线：量不到画板或节点 ⇒ 直接判失败，绝不因为「没发现问题」而判绿
      // （本仓九次「全绿但空转」；首跑选择器写错时正是这条接住的）。
      expect(sample.frame.w, `${c.id}：量不到画板——拒绝下判断`).toBeGreaterThan(0);
      expect(sample.nodes.length, `${c.id}：量不到任何节点——拒绝下判断`).toBeGreaterThan(0);

      const m = machineScore(sample, c.only ?? null);
      const detail = Object.entries(m.parts)
        .map(([k, v]) => `${k}=${String(Math.round(v.score))}（${v.note}）`)
        .join("；");
      writeFileSync(join(OUT, `${c.id}.json`), JSON.stringify({ ...m, frame: sample.frame, nodes: sample.nodes.length }, null, 2));
      // 分数与扣分理由都进 CI 日志——红了要能直接看出扣在哪，不用去翻 artifact。
      console.log(`[prototype-audit] ${c.id} = ${String(m.total)} 分 · ${detail}`);
      expect(m.total, `${c.id} 机器分 ${String(m.total)} < ${String(THRESHOLD)}：${detail}`).toBeGreaterThanOrEqual(THRESHOLD);
    });
  }
});
