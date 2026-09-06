import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { test, expect, type Page } from "@playwright/test";
import { CHAT_READ_E2E } from "./chat-read-fixture";
import { openChatEmptyState, openFreshThread, sendAndSettle } from "./chat-task-workbench-fixture";

/**
 * issue #2857 —— 消息区可以滚过底部进入大片空白（devapp 2026-09-06 人类实测）。
 *
 * ## 真栈复现出来的根因（本 spec 就是那次取证的脚本）
 *
 * 落定态的线程量不出任何空白：`scrollHeight` 恰好 = 内容高度 + 上下 padding。空白只在
 * **运行中**出现：`main`（AppShell 的 `overflow-y-auto` 主区）的 `scrollHeight` 从 902
 * 涨到 1065 / 1744（1848×902 视口），最深的元素是一个 `position:absolute` 的 `sr-only`
 * `<Label>`（运行中插话表单的无障碍标签）。滚动容器 `copilotkit-v2-messages` 自己不是
 * 定位元素，这个绝对定位后代以容器**外面**那层 `relative` 包装为包含块，被摆在内容
 * 底部的静态位置——那个位置在容器可视区之下、又不属于容器的 scrollable overflow，
 * 于是只有外层 `main` 量到了它：滚轮在消息区滚到头后接着推整列，composer 被推上去，
 * 下面露出整屏 `main` 底色。线程越长，这个"幽灵"落得越深，空白越多屏。
 *
 * 修法：滚动容器自己 `relative`。本 spec 两条断言分别钉住「落定态不出现空白」与
 * 「运行中 `main` 不成为第二条滚动轴」。
 */
test.setTimeout(300_000);

const OUT = resolve(process.env.SCROLL_OVERSHOOT_OUT ?? "test-results/scroll-overshoot");
const LONG = Array.from({ length: 8 }, (_, i) => `第 ${i + 1} 段：这是一段用来把消息区撑高的正文，重复几遍以便真的出现滚动条。`).join(" ");

type Geometry = {
  scrollHeight: number;
  clientHeight: number;
  scrollTop: number;
  paddingBottom: number;
  containerBottom: number;
  deepestBottom: number;
  deepestEl: string;
  mainScrollHeight: number;
  mainClientHeight: number;
  mainScrollTop: number;
};

function measure(page: Page): Promise<Geometry> {
  return page.getByTestId("copilotkit-v2-messages").evaluate((el) => {
    let deepestBottom = -Infinity;
    let deepestEl = "";
    for (const d of Array.from(el.querySelectorAll<HTMLElement>("*"))) {
      const r = d.getBoundingClientRect();
      if (r.height === 0 && r.width === 0) continue;
      if (r.bottom > deepestBottom) {
        deepestBottom = r.bottom;
        deepestEl = `${d.tagName.toLowerCase()}[${d.dataset.testid ?? ""}].${String(d.className).slice(0, 60)}`;
      }
    }
    const main = document.querySelector("main") as HTMLElement;
    return {
      scrollHeight: el.scrollHeight,
      clientHeight: el.clientHeight,
      scrollTop: el.scrollTop,
      paddingBottom: parseFloat(getComputedStyle(el).paddingBottom),
      containerBottom: el.getBoundingClientRect().bottom,
      deepestBottom,
      deepestEl,
      mainScrollHeight: main.scrollHeight,
      mainClientHeight: main.clientHeight,
      mainScrollTop: main.scrollTop,
    };
  });
}

function expectMainNotScrollable(g: Geometry, when: string): void {
  expect(
    g.mainScrollHeight,
    `【#2857】${when}：外层 main 可滚动高度 ${g.mainScrollHeight} > 可视高度 ${g.mainClientHeight}` +
      `（最深元素 ${g.deepestEl}，底边 ${Math.round(g.deepestBottom)}px）——消息区之外出现了第二条滚动轴，滚到头就会进入空白`,
  ).toBeLessThanOrEqual(g.mainClientHeight);
}

test("#2857：落定的长线程滚到底停在最后一条消息，不进入空白", async ({ page }) => {
  mkdirSync(OUT, { recursive: true });
  await page.setViewportSize({ width: 1848, height: 902 });
  await openFreshThread(page);
  for (let i = 0; i < 5; i += 1) await sendAndSettle(page, `${i + 1} ${LONG}`);

  const messages = page.getByTestId("copilotkit-v2-messages");
  await messages.evaluate((el) => el.scrollTo({ top: el.scrollHeight, behavior: "auto" }));
  await page.waitForTimeout(500);
  const atBottom = await measure(page);
  await page.screenshot({ path: resolve(OUT, "settled-scrolled-to-bottom.png") });

  const gap = atBottom.containerBottom - atBottom.deepestBottom;
  expect(
    gap,
    `【#2857】滚到底后最深内容底边离容器底边还有 ${Math.round(gap)}px 空白（padding-bottom=${atBottom.paddingBottom}px；最深元素 ${atBottom.deepestEl}）`,
  ).toBeLessThanOrEqual(atBottom.paddingBottom + 24);
  expectMainNotScrollable(atBottom, "落定态滚到底");

  // 滚轮继续往下：消息区已到头，不应再有任何东西能被推动。
  await page.mouse.move(900, 400);
  await page.mouse.wheel(0, 5000);
  await page.waitForTimeout(500);
  const afterWheel = await measure(page);
  await page.screenshot({ path: resolve(OUT, "settled-after-wheel.png") });
  expect(afterWheel.mainScrollTop, "外层 main 不应被滚轮推动").toBe(0);
});

test("#2857：deep agent 运行中，绝对定位后代不把外层 main 撑成第二条滚动轴", async ({ page }) => {
  mkdirSync(OUT, { recursive: true });
  await page.setViewportSize({ width: 1848, height: 902 });
  await openChatEmptyState(page);
  await page.getByTestId("chat-task-workbench-capability-picker").click();
  await page
    .locator(`[data-testid="chat-task-workbench-capability-card"][data-agent-id="${CHAT_READ_E2E.deepAgentId}"]`)
    .click();

  // 先灌一轮把内容撑高——幽灵元素落在内容底部，内容越高它离可视区越远，越容易量到。
  await sendAndSettle(page, `${CHAT_READ_E2E.deepAgentMarkdownTrigger} ${LONG}`);

  await page.getByTestId("copilotkit-v2-input").fill(`${CHAT_READ_E2E.deepAgentMultiStepTrigger} ${LONG}`);
  await page.getByTestId("copilotkit-v2-send").click();
  await expect(page.getByTestId("copilotkit-v2-running-indicator")).toBeVisible({ timeout: 60_000 });

  // 运行期间连续采样：修前第 0/1 次采样 main.scrollHeight 已经是 1065 / 1128（视口 902）。
  const samples: Geometry[] = [];
  for (let i = 0; i < 6; i += 1) {
    await page.waitForTimeout(1_000);
    samples.push(await measure(page));
    if (i === 1) await page.screenshot({ path: resolve(OUT, "deep-running.png") });
  }
  for (const [i, g] of samples.entries()) expectMainNotScrollable(g, `运行中第 ${i} 次采样`);

  await expect(page.getByTestId("copilotkit-v2-running-indicator")).toHaveCount(0, { timeout: 120_000 });
  expectMainNotScrollable(await measure(page), "运行结束");
});
