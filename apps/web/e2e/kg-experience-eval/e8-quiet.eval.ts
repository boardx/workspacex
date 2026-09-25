/**
 * E8 不打扰（06-UX R4 / R3-5）：一轮对话里主动提示最多 1 条；「已记下」提示是单行，不遮挡正文。
 *
 * 「主动提示」= 回答下方主动冒出来要你处理的卡片：矛盾提醒卡、记住 / 忘掉确认卡。
 * 最容易叠出两张的一轮：用户说「记住：<一句和已确认的内容矛盾的话>」——既要出记住卡，又会被判成矛盾。
 */
import { expect, test } from "@playwright/test";
import { KG_EVAL } from "./fixture";
import { claimIdOf, newThread, openMemoryPanel, say, sayText, tell, waitForMemories } from "./eval-helpers";
import { attach, runJourney, seen, type Journal } from "./journey";

let j: Journal;
const CARDS = "[data-testid='kg-conflict-card'], [data-testid='kg-card-remember'], [data-testid='kg-card-forget']";

test.beforeAll(async ({ browser }) => {
  test.setTimeout(600_000);
  j = await runJourney("E8", browser, async (ctx) => {
    ctx.step("登录，说两件事，确认其中一件");
    const page = await ctx.pageAs(KG_EVAL.owner);
    await page.goto("/chat");
    const thread = await newThread(page);
    await tell(page, thread, ["M8", "M9"]);
    const launch = await claimIdOf(page, thread, "北极星项目的正式上线定在 11 月 18 日");
    const panel = await openMemoryPanel(page);
    await panel.getByTestId(`kg-row-yes-${launch}`).click();
    await expect(panel.getByTestId(`kg-row-yes-${launch}`)).toContainText("你确认过");

    ctx.step("「记住：<矛盾的话>」——两种卡都该出的一轮");
    const turn = await say(page, sayText("REMEMBER_CHANGE_LAUNCH"));
    await waitForMemories(page, thread, 5);
    await page.waitForTimeout(12_000);
    const block = turn.answer.locator("xpath=..");
    ctx.see("cardsThatTurn", await block.locator(CARDS).count());
    await ctx.shot("that-turn", block);

    ctx.step("刷新后逐轮数卡片");
    await page.reload();
    await page.getByTestId("copilot-assistant-message").last().waitFor({ state: "visible" });
    await page.waitForTimeout(5_000);
    const perTurn: number[] = [];
    for (const a of await page.getByTestId("copilot-assistant-message").all()) perTurn.push(await a.locator("xpath=..").locator(CARDS).count());
    ctx.see("cardsPerTurn", perTurn);

    ctx.step("「已记下」这一行的样子");
    const line = page.getByTestId("kg-turn-captured").first();
    await line.waitFor({ state: "visible", timeout: 15_000 });
    const geometry = await line.evaluate((el) => {
      const row = el.querySelector("p") ?? el;
      const lh = parseFloat(getComputedStyle(row).lineHeight) || parseFloat(getComputedStyle(row).fontSize) * 1.5;
      const box = row.getBoundingClientRect();
      const answer = el.parentElement?.querySelector("[data-testid='copilot-assistant-message']")?.getBoundingClientRect() ?? null;
      const overlap = answer === null ? null : !(box.bottom <= answer.top || box.top >= answer.bottom || box.right <= answer.left || box.left >= answer.right);
      return { height: box.height, lineHeight: lh, overlapsAnswer: overlap };
    });
    ctx.see("capturedLine", geometry);
    await ctx.shot("captured", line.locator("xpath=..").locator("xpath=.."));
  });
});

test("[E8.c1] 一轮对话里主动冒出来的卡片最多 1 张（最容易叠两张的那一轮也是）", async ({}, testInfo) => {
  await attach(testInfo, j, ["that-turn"], { cardsThatTurn: j.seen.cardsThatTurn ?? null, cardsPerTurn: j.seen.cardsPerTurn ?? null });
  expect(seen<number>(j, "cardsThatTurn")).toBeGreaterThanOrEqual(1);
  expect(seen<number>(j, "cardsThatTurn")).toBeLessThanOrEqual(1);
  expect(Math.max(...seen<number[]>(j, "cardsPerTurn"))).toBeLessThanOrEqual(1);
});

test("[E8.c2] 「已记下」提示只有一行", async ({}, testInfo) => {
  await attach(testInfo, j, ["captured"], { capturedLine: j.seen.capturedLine ?? null });
  const g = seen<{ height: number; lineHeight: number }>(j, "capturedLine");
  expect(g.height).toBeLessThanOrEqual(g.lineHeight * 1.5);
});

test("[E8.c3] 「已记下」提示不遮挡回答正文", async ({}, testInfo) => {
  await attach(testInfo, j, ["captured"], { capturedLine: j.seen.capturedLine ?? null });
  expect(seen<{ overlapsAnswer: boolean | null }>(j, "capturedLine").overlapsAnswer).toBe(false);
});
