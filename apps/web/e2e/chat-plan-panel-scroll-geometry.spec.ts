import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { test, expect } from "@playwright/test";

/**
 * issue #3245② —— 人类 2026-09-10 devapp 验收原话：「planpanel 在计划多的时候，
 * 不能上下滚动」。
 *
 * ## 根因（真浏览器实测，不是推断）
 * 容器 `chat-task-workbench-plan-control` **有**滚动容器、高度**没有**写死、父级
 * `overflow` 也**没有**裁它——三个候选全部排除。真正的原因是
 * `PlanPanelReadOnly` 的 `Card` 自带 `overflow-hidden`，这让它作为 flex item 的
 * 「自动最小尺寸」解析成 0，于是它被压缩到正好等于容器高度，容器永远算不出溢出：
 * `scrollHeight === clientHeight === 256`，`scrollTop` 推不动。
 *
 * ## 判据
 * `scrollHeight > clientHeight` **加上实际可滚动位移**（只看 scrollHeight 会被
 * 「有溢出但滚不动」蒙混），再加末步是否真的能被滚进容器内。
 * 两个方向都量：长计划必须能滚，短计划不许有滚动量。
 * 不许用截图字节数或"元素存在"代替（本仓 C2 反面教材）。
 */
function buildFixture(stepCount: number): string {
  const dir = mkdtempSync(join(tmpdir(), "plan-scroll-geometry-"));
  const page = join(dir, "page.html");
  const web = join(__dirname, "..");
  execFileSync(process.execPath,
    ["--import", "tsx", join(__dirname, "fixtures", "plan-panel-scroll-fixture.tsx"), page, String(stepCount)],
    { cwd: web, stdio: "pipe" });
  execFileSync(join(web, "node_modules", ".bin", "tailwindcss"),
    ["-c", "tailwind.config.ts", "-i", "app/globals.css", "-o", join(dir, "out.css"), "--content", page],
    { cwd: web, stdio: "pipe" });
  return pathToFileURL(page).href;
}

const SCROLLER = '[data-testid="chat-task-workbench-plan-control"]';
const STEP = '[data-testid="chat-task-workbench-plan-step"]';

async function measure(page: import("@playwright/test").Page) {
  return page.evaluate(([scrollerSel, stepSel]) => {
    const el = document.querySelector(scrollerSel) as HTMLElement;
    const steps = [...document.querySelectorAll(stepSel)] as HTMLElement[];
    const before = { sh: el.scrollHeight, ch: el.clientHeight, top: el.scrollTop };
    const lastBeforeScroll = steps[steps.length - 1]!.getBoundingClientRect().bottom;
    el.scrollTop = 100_000;
    const moved = el.scrollTop;
    const box = el.getBoundingClientRect();
    return {
      ...before, moved, steps: steps.length,
      lastBeforeScroll, lastAfterScroll: steps[steps.length - 1]!.getBoundingClientRect().bottom,
      boxBottom: box.bottom,
      docScrollX: document.scrollingElement!.scrollWidth - document.scrollingElement!.clientWidth,
    };
  }, [SCROLLER, STEP] as const);
}

test("#3245②：12 步的长计划——容器真的溢出、真的滚得动、末步滚完落回容器内", async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 800 });
  await page.goto(buildFixture(12));
  const m = await measure(page);

  // 阳性对照：夹具真的渲出了 12 步。步骤没渲出来的话，下面"滚不动"会变成静默假绿。
  expect(m.steps, "夹具没有渲出 12 个步骤，后面的滚动断言无意义").toBe(12);
  // 滚不动之前，末步确实在容器外——这就是人类看不到后面步骤的那一刻。
  expect(
    m.lastBeforeScroll,
    "夹具里第 12 步一开始就落在容器内，说明高度上限没生效，这条用例构造不出本 issue 的场景",
  ).toBeGreaterThan(m.boxBottom);

  expect(
    m.sh - m.ch,
    [
      `【#3245②】计划面板 scrollHeight ${m.sh} 与 clientHeight ${m.ch} 相等 —— 容器根本不认为自己溢出。`,
      "根因不是「没有滚动容器」也不是「高度写死」：是 PlanPanelReadOnly 的 Card 带 overflow-hidden，",
      "使它作为 flex item 的自动最小尺寸变成 0，被压缩到正好等于容器高度。",
    ].join("\n"),
  ).toBeGreaterThan(0);
  // 只看 scrollHeight 会被「有溢出但滚不动」蒙混，所以量真实位移。
  expect(m.moved, `【#3245②】容器有溢出（${m.sh} > ${m.ch}）却推不动 scrollTop（${m.moved}）`).toBeGreaterThan(0);
  // 滚到底之后，最后一步必须真的看得见。
  expect(
    m.lastAfterScroll,
    `【#3245②】滚到底之后第 12 步底边仍在容器底边 ${m.boxBottom} 之外（${m.lastAfterScroll}）——还是看不到后面的步骤。`,
  ).toBeLessThanOrEqual(m.boxBottom + 1);
  // 不许因此产生页面级横向滚动。
  expect(m.docScrollX, "计划面板带出了页面级横向滚动").toBeLessThanOrEqual(1);
});

test("#3245②：2 步的短计划不出现多余滚动量（修法不许给所有计划都挂上滚动条）", async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 800 });
  await page.goto(buildFixture(2));
  const m = await measure(page);
  expect(m.steps).toBe(2);
  expect(m.sh - m.ch, `短计划也溢出了（scrollHeight ${m.sh} / clientHeight ${m.ch}）`).toBeLessThanOrEqual(1);
  expect(m.moved, "短计划也能滚——说明容器被撑出了不该有的高度").toBe(0);
  expect(m.docScrollX).toBeLessThanOrEqual(1);
});
