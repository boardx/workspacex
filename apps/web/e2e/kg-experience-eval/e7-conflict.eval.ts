/**
 * E7 会提醒（06-UX R4 / R2 M3）：前后矛盾的说法，在第二次出现时的回答里出现冲突提示卡；忽略后同一冲突不再重复打扰。
 *
 * 「第一次」= 用户说过并确认过的那句（你确认过）；「第二次」= 改口的那句——卡片挂在改口那一轮的回答下面。
 */
import { expect, test } from "@playwright/test";
import { KG_EVAL } from "./fixture";
import { claimIdOf, newThread, openMemoryPanel, say, sayText, tell, waitForMemories } from "./eval-helpers";
import { attach, runJourney, seen, type Journal } from "./journey";

let j: Journal;

test.beforeAll(async ({ browser }) => {
  test.setTimeout(600_000);
  j = await runJourney("E7", browser, async (ctx) => {
    ctx.step("登录，说一件事并确认它");
    const page = await ctx.pageAs(KG_EVAL.owner);
    await page.goto("/chat");
    const thread = await newThread(page);
    await tell(page, thread, ["M9"]);
    const launch = await claimIdOf(page, thread, "北极星项目的正式上线定在 11 月 18 日");
    const panel = await openMemoryPanel(page);
    await panel.getByTestId(`kg-row-yes-${launch}`).click();
    await expect(panel.getByTestId(`kg-row-yes-${launch}`)).toContainText("你确认过");

    ctx.step("改口");
    const first = await say(page, sayText("CHANGE_LAUNCH"));
    await waitForMemories(page, thread, 3);
    const block = first.answer.locator("xpath=..");
    const card = block.getByTestId("kg-conflict-card");
    const shown = await card.waitFor({ state: "visible", timeout: 30_000 }).then(() => true, () => false);
    ctx.see("firstCard", { shown, text: shown ? (await card.innerText()).trim() : null });
    await ctx.shot("first", block);

    ctx.step("忽略它，再说一遍同样的话");
    if (shown) {
      await block.getByTestId("kg-conflict-ignore").click();
      await block.getByTestId("kg-conflict-resolved").waitFor({ state: "visible", timeout: 10_000 }).catch(() => undefined);
    }
    const second = await say(page, sayText("CHANGE_LAUNCH"));
    const block2 = second.answer.locator("xpath=..");
    // 给后台足够的时间记完这一轮（回答下的记忆行最多补读到 11 秒）。
    await page.waitForTimeout(14_000);
    const again = await block2.getByTestId("kg-conflict-card").count();
    await page.reload();
    await page.getByTestId("copilot-assistant-message").last().waitFor({ state: "visible" });
    await page.waitForTimeout(4_000);
    const afterReload = await page.getByTestId("kg-conflict-card").count();
    ctx.see("afterIgnore", { cardUnderSecond: again, openCardsAfterReload: afterReload });
    await ctx.shot("second", page.getByTestId("copilotkit-v2-messages"));
  });
});

test("[E7.c1] 改口那一轮的回答下面出现矛盾提醒卡", async ({}, testInfo) => {
  await attach(testInfo, j, ["first"], { firstCard: j.seen.firstCard ?? null });
  const f = seen<{ shown: boolean; text: string | null }>(j, "firstCard");
  expect(f.shown).toBe(true);
  expect(f.text ?? "").toContain("11 月 18 日");
});

test("[E7.c2] 点「忽略」之后再说一遍，同一个矛盾不再提醒（刷新后也没有）", async ({}, testInfo) => {
  await attach(testInfo, j, ["second"], { afterIgnore: j.seen.afterIgnore ?? null });
  expect(seen<{ shown: boolean }>(j, "firstCard").shown, "得先出现过一次，「忽略」才有意义").toBe(true);
  const a = seen<{ cardUnderSecond: number; openCardsAfterReload: number }>(j, "afterIgnore");
  expect(a.cardUnderSecond).toBe(0);
  expect(a.openCardsAfterReload).toBe(0);
});
