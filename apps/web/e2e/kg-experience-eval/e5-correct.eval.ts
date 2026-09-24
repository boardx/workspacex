/**
 * E5 改得快（06-UX R4 / R3-4「任何一条记忆，纠正或忘掉最多 2 次点击，或者一句话」）。
 *
 * 点击从「记忆就在眼前」算起（右栏记忆面板已经打开，那一条看得见）——面板本身是管理记忆的地方；
 * 打字不算点击。每一步都照产品真实的路径点：出现确认框就得点确认，那一下也算。
 * - c1 忘掉一条记错的：≤ 2 次点击，点完它就从记忆里消失；
 * - c2 改写一条记错的：≤ 2 次点击（加上打字），点完之后回答用新的说法；
 * - c3 说「忘掉 X」：回答下方出确认卡，点一下，下一轮就不再提 X。
 */
import { expect, test, type Page } from "@playwright/test";
import { KG_EVAL } from "./fixture";
import { claimIdOf, newThread, openMemoryPanel, say, tell } from "./eval-helpers";
import { attach, runJourney, seen, type Journal } from "./journey";

let j: Journal;

const FORGET = "北极星项目的团队一共 12 人";
const REVISE = "北极星项目的总预算是 380 万元";
const REVISED = "北极星项目的总预算是 400 万元";

/** 点一下；返回是否真的点到了（控件在）。 */
async function tap(page: Page, testId: string, counter: { n: number }, timeout = 3_000): Promise<boolean> {
  const el = page.getByTestId(testId);
  const there = await el.waitFor({ state: "visible", timeout }).then(() => true, () => false);
  if (!there) return false;
  await el.click();
  counter.n += 1;
  return true;
}

test.beforeAll(async ({ browser }) => {
  test.setTimeout(900_000);
  j = await runJourney("E5", browser, async (ctx) => {
    ctx.step("登录并开一个新对话");
    const page = await ctx.pageAs(KG_EVAL.owner);
    await page.goto("/chat");
    const thread = await newThread(page);
    await tell(page, thread, ["M8", "M9"]);
    const panel = await openMemoryPanel(page);

    ctx.step("忘掉一条记错的");
    const forgetId = await claimIdOf(page, thread, FORGET);
    await expect(panel.getByTestId(`kg-claim-${forgetId}`)).toBeVisible();
    const c1 = { n: 0 };
    await tap(page, `kg-row-no-${forgetId}`, c1);
    await tap(page, `kg-row-forget-${forgetId}`, c1);
    await tap(page, `kg-delete-confirm-btn-${forgetId}`, c1, 1_500);
    const gone = await panel.getByTestId(`kg-claim-${forgetId}`).waitFor({ state: "detached", timeout: 15_000 }).then(() => true, () => false);
    ctx.see("forget", { clicks: c1.n, gone });
    await ctx.shot("forget", panel);

    ctx.step("改写一条记错的");
    const reviseId = await claimIdOf(page, thread, REVISE);
    const c2 = { n: 0 };
    await tap(page, `kg-row-no-${reviseId}`, c2);
    await tap(page, `kg-row-revise-${reviseId}`, c2);
    const input = page.getByTestId(`kg-revise-input-${reviseId}`);
    await input.waitFor({ state: "visible", timeout: 5_000 });
    await input.fill(REVISED);
    await input.press("Enter");
    // Enter 没保存（还开着）⇒ 只能点「保存」，照实记这一下。
    const stillOpen = await input.waitFor({ state: "detached", timeout: 2_000 }).then(() => false, () => true);
    if (stillOpen) await tap(page, `kg-revise-submit-${reviseId}`, c2);
    const shown = await panel.getByText(REVISED).first().waitFor({ state: "visible", timeout: 15_000 }).then(() => true, () => false);
    await ctx.shot("revise", panel);
    const turn = await say(page, "北极星项目的总预算是多少？");
    ctx.see("revise", { clicks: c2.n, shown, answer: turn.text });

    ctx.step("说一句「忘掉 X」");
    const ask = await say(page, "忘掉首月目标那条");
    const block = ask.answer.locator("xpath=..");
    const card = block.getByTestId("kg-card-forget");
    const cardSeen = await card.waitFor({ state: "visible", timeout: 20_000 }).then(() => true, () => false);
    const c3 = { n: 0 };
    if (cardSeen) {
      await block.getByTestId("kg-card-accept").click();
      c3.n += 1;
      await block.getByTestId("kg-card-done").waitFor({ state: "visible", timeout: 15_000 }).catch(() => undefined);
    }
    await ctx.shot("forget-card", block);
    await page.waitForTimeout(2_500);
    const next = await say(page, "首月的活跃用户目标是多少？");
    const nextBlock = next.answer.locator("xpath=..");
    await nextBlock.getByTestId("kg-answer-footer").waitFor({ state: "visible", timeout: 8_000 }).catch(() => undefined);
    const chips = await nextBlock.locator("[data-testid^='kg-citation-']").allInnerTexts();
    ctx.see("sayForget", { cardSeen, clicks: c3.n, nextAnswer: next.text, nextCitations: chips });
    await ctx.shot("after-forget", nextBlock);
  });
});

test("[E5.c1] 忘掉一条记错的：≤ 2 次点击，点完就从记忆里消失", async ({}, testInfo) => {
  await attach(testInfo, j, ["forget"], { forget: j.seen.forget ?? null });
  const f = seen<{ clicks: number; gone: boolean }>(j, "forget");
  expect(f.gone, "点完之后这一条应当不在了").toBe(true);
  expect(f.clicks, "从看见它到忘掉它的点击数").toBeLessThanOrEqual(2);
});

test("[E5.c2] 改写一条记错的：≤ 2 次点击（加打字），之后的回答用新的说法", async ({}, testInfo) => {
  await attach(testInfo, j, ["revise"], { revise: j.seen.revise ?? null });
  const r = seen<{ clicks: number; shown: boolean; answer: string }>(j, "revise");
  expect(r.shown, "面板里应当是新的说法").toBe(true);
  expect(r.answer).toContain("400 万");
  expect(r.answer).not.toContain("380 万");
  expect(r.clicks, "从看见它到改好的点击数").toBeLessThanOrEqual(2);
});

test("[E5.c3] 说「忘掉首月目标那条」：点一下确认，下一轮就不再提", async ({}, testInfo) => {
  await attach(testInfo, j, ["forget-card", "after-forget"], { sayForget: j.seen.sayForget ?? null });
  const s = seen<{ cardSeen: boolean; clicks: number; nextAnswer: string; nextCitations: string[] }>(j, "sayForget");
  expect(s.cardSeen, "应当出一张「忘掉」确认卡").toBe(true);
  expect(s.clicks).toBeLessThanOrEqual(2);
  expect(s.nextAnswer).not.toContain("5000");
  expect(s.nextCitations.join(" ")).not.toContain("5000");
});
