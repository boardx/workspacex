import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { test, expect, type Locator, type Page } from "@playwright/test";

/**
 * issue #3320 —— 「一个工具执行失败以后界面就停住了，用户以为死机」。
 *
 * ## 这条门判的到底是什么（与 #3316 的分界）
 * #3316 ① 判的是**那个 spinner 本身在不在动**；本条判的是**一次失败之后，后续工具的进行态
 * 是否对用户可见**。即便 #3316 修好，本条仍可能不成立——如果失败之后的新条目根本没进入
 * 用户视野。两条不合并，文件也尽量分开：本条新增的是 `run-trace-live-strip.tsx`，
 * 不动展开层那枚条目图标（#3316 / PR #3324 在改它），也不动蝴蝶组件。
 *
 * ## 为什么判据不能只判「元素存在」或「class 名对」
 * issue 原文写死了这条：**存在但在视口外、存在但静止的元素都能通过那种断言**。本仓已栽过
 * 「`getBoundingClientRect` 读不出 overflow 裁剪，几何全绿而用户看不见」。所以这里：
 * - **判可见** = attached + 非零盒 + 与视口相交 + **命中测试**（`elementFromPoint(中心点)`
 *   回来的节点必须是它或它的后代）。命中测试是权威那一项，前三项只是让红有诊断信息。
 * - **判活性** = `getAnimations()` 里存在 `playState === "running"` 的动画 **且** 两帧之间
 *   计算出来的 `transform` 矩阵真的变了。只断言前者会被「声明了动画却被 `animation-play-state`
 *   停住」骗过；只断言后者在慢机器上可能两帧采到同一相位，所以两条都要，并且用轮询给相位
 *   一点时间——**不放宽判据，只是不赌单次采样**。
 *
 * ## 为什么不起整个应用
 * 与 `chat-trace-disclosure-geometry.spec.ts` 同一个理由与同一套夹具形式：被测对象是
 * `RunTracePanel` 一个组件在**折叠态**下的可见性与活性，真组件 + 真编译样式即可判定。
 * 起 next dev + docker 栈只会把一条秒级断言变成两分钟且随负载假红。剧本本身
 * （失败 → 成功 → 仍在飞）由 `e2e/fixtures/trace-forward-motion-fixture.tsx` 用真组件渲出。
 */
function buildFixture(): string {
  const dir = mkdtempSync(join(tmpdir(), "trace-forward-motion-"));
  const page = join(dir, "page.html");
  const web = join(__dirname, "..");
  execFileSync(process.execPath, ["--import", "tsx", join(__dirname, "fixtures", "trace-forward-motion-fixture.tsx"), page], { cwd: web, stdio: "pipe" });
  execFileSync(join(web, "node_modules", ".bin", "tailwindcss"),
    ["-c", "tailwind.config.ts", "-i", "app/globals.css", "-o", join(dir, "out.css"), "--content", page],
    { cwd: web, stdio: "pipe" });
  return pathToFileURL(page).href;
}

type Visibility = { attached: boolean; bboxNonZero: boolean; inViewport: boolean; hitTest: boolean; note: string };

/** 四项事实一起量，红的时候能一眼看出是「没渲染」「零盒」「在视口外」还是「被盖住/被裁剪」。 */
async function measureVisibility(page: Page, locator: Locator): Promise<Visibility> {
  if (await locator.count() === 0) {
    return { attached: false, bboxNonZero: false, inViewport: false, hitTest: false, note: "元素不在 DOM 里" };
  }
  return locator.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const bboxNonZero = rect.width > 0 && rect.height > 0;
    const inViewport = rect.bottom > 0 && rect.right > 0
      && rect.top < window.innerHeight && rect.left < window.innerWidth;
    const x = rect.left + rect.width / 2, y = rect.top + rect.height / 2;
    const hit = bboxNonZero && inViewport ? document.elementFromPoint(x, y) : null;
    return {
      attached: true, bboxNonZero, inViewport,
      hitTest: hit !== null && (hit === element || element.contains(hit)),
      note: `rect=${JSON.stringify({ x: rect.x, y: rect.y, w: rect.width, h: rect.height })}`
        + ` point=(${String(Math.round(x))},${String(Math.round(y))})`
        + ` hit=${hit === null ? "null" : `${hit.tagName}${hit.getAttribute("data-testid") === null ? "" : `[${hit.getAttribute("data-testid")!}]`}`}`,
    };
  });
}

test("工具失败之后，后续工具的进行态不用展开就可见，且活性信号真的在动", async ({ page }) => {
  await page.goto(buildFixture());

  // ── 前提：整块轨迹此刻确实是**折叠**的（这正是人类那一屏的状态）。
  //    若哪天默认改成展开，本条门的前提就变了，必须在这里红出来而不是悄悄失效。
  const body = page.getByTestId("run-trace-body");
  await expect(body).toHaveAttribute("hidden", "");
  const entryVisibility = await measureVisibility(page, page.getByTestId("run-trace-entry").last());
  expect(entryVisibility.hitTest, `折叠态下轨迹条目本应命中失败（这是缺陷机制 (b) 的动态取证）：${entryVisibility.note}`).toBe(false);

  // ── 验收①③：失败之后那件仍在飞的工具，不展开就看得见，并且带细节。
  const strip = page.getByTestId("run-trace-live-strip");
  const stripVisibility = await measureVisibility(page, strip);
  expect(stripVisibility, `活性条必须四项全真——存在但在视口外/被盖住都算用户看不见：${stripVisibility.note}`)
    .toMatchObject({ attached: true, bboxNonZero: true, inViewport: true, hitTest: true });
  // 细节：说得出此刻在做什么（`execute` ⇒「正在执行工具操作」），且完成步数已经长到 2
  // ——「已完成 N 步」会随失败之后的每次收尾增大，与恒在的「· 有失败步骤」不同，它是会变的。
  await expect(page.getByTestId("run-trace-live-label")).toHaveText("正在执行工具操作 · 已完成 2 步");
  await expect(strip).toHaveAttribute("data-has-detail", "true");
  await expect(strip).toHaveAttribute("data-completed", "2");

  // ── 验收②（底线）：活性信号**真的在动**。
  const spinner = page.getByTestId("run-trace-live-spinner");
  const spinnerVisibility = await measureVisibility(page, spinner);
  expect(spinnerVisibility.hitTest, `活性图标本身也要命中，不能只是它的父容器可见：${spinnerVisibility.note}`).toBe(true);

  // (i) 浏览器确实在**跑**一个动画（不是「声明了 animation 但被停住」）。
  const animations = await spinner.evaluate((element) =>
    element.getAnimations().map((animation) => ({
      playState: animation.playState,
      name: (animation as unknown as { animationName?: string }).animationName ?? "",
    })));
  expect(animations.length, "活性图标上一个动画都没有 —— 底线②不成立").toBeGreaterThan(0);
  expect(animations.some((animation) => animation.playState === "running"),
    `活性图标上的动画没有一个在 running：${JSON.stringify(animations)}`).toBe(true);

  // (ii) 两帧比对：计算出来的 transform 矩阵必须真的变化。只断言 (i) 会被
  //      「动画在跑但视觉上不动」（例如关键帧写成同一个值）骗过。
  const readTransform = (): Promise<string> => spinner.evaluate((element) => getComputedStyle(element).transform);
  const first = await readTransform();
  let second = first;
  await expect.poll(async () => {
    second = await readTransform();
    return second !== first;
  }, { timeout: 3_000, intervals: [50] }).toBe(true);
  expect(second, `两帧 transform 相同（${first}）—— 图标是静止的`).not.toBe(first);
});
