/**
 * E1 零负担（06-UX R4）：新用户不做任何设置，聊 3 轮后开新会话，回答里出现「来自你之前的对话」；全过程点击数 = 0。
 *
 * 「点击数」按用户真的点了什么数（页面里捕获的可信点击事件），分两类记：
 *   - 记忆相关：点在任何记忆控件上（`data-testid` 以 `kg-` 开头的元素里）——必须是 0；
 *   - 全部：包括「新对话」按钮。开一个新会话本身就是一次操作，不是「为了让它记住而多干的活」，R2 M1 的原话是
 *     「开新会话，不用重新交代背景」。所以门槛只卡记忆相关的那一类，全部点击数照实记在证据里。
 * 说话一律用 Enter 发送（键盘，不算点击）。
 */
import { expect, test, type Page } from "@playwright/test";
import { KG_EVAL } from "./fixture";
import { CASES, newThread, say, sayText, waitForMemories, type SayKey } from "./eval-helpers";
import { attach, runJourney, seen, type Journal } from "./journey";

let j: Journal;

async function countClicks(page: Page): Promise<void> {
  await page.addInitScript(() => {
    document.addEventListener("click", (e) => {
      if (!e.isTrusted) return;
      const s = window.sessionStorage;
      s.setItem("kgEvalClicks", String(Number(s.getItem("kgEvalClicks") ?? "0") + 1));
      const t = e.target instanceof Element ? e.target.closest("[data-testid^='kg-']") : null;
      if (t !== null) s.setItem("kgEvalMemoryClicks", String(Number(s.getItem("kgEvalMemoryClicks") ?? "0") + 1));
    }, true);
  });
}

const clicks = async (page: Page) => page.evaluate(() => ({
  all: Number(window.sessionStorage.getItem("kgEvalClicks") ?? "0"),
  memory: Number(window.sessionStorage.getItem("kgEvalMemoryClicks") ?? "0"),
}));

test.beforeAll(async ({ browser }) => {
  test.setTimeout(600_000);
  j = await runJourney("E1", browser, async (ctx) => {
    const flow = CASES.zeroEffort;
    ctx.step("新用户登录");
    const page = await ctx.pageAs(KG_EVAL.newbie);
    await countClicks(page);
    await page.goto("/chat");
    ctx.step("第一个会话：聊 3 轮");
    const first = await newThread(page);
    await page.evaluate(() => { window.sessionStorage.setItem("kgEvalClicks", "0"); window.sessionStorage.setItem("kgEvalMemoryClicks", "0"); });
    for (const k of flow.tell as SayKey[]) await say(page, sayText(k));
    ctx.step("等后台记下（只为等待，不判分）");
    await waitForMemories(page, first, flow.tell.length);
    ctx.step("回答下方的「已记下」");
    const captured = page.getByTestId("kg-turn-captured");
    const capturedVisible = await captured.first().waitFor({ state: "visible", timeout: 20_000 }).then(() => true, () => false);
    ctx.see("capturedVisible", capturedVisible);
    ctx.see("capturedText", capturedVisible ? (await captured.first().innerText()).trim() : null);
    ctx.see("clicksFirstSession", await clicks(page));
    await ctx.shot("first-session", page.getByTestId("copilotkit-v2-messages"));

    ctx.step("开新会话，问之前说过的事");
    const second = await newThread(page);
    ctx.see("secondThreadIsNew", second !== first);
    const turn = await say(page, flow.ask);
    ctx.see("answer", turn.text);
    ctx.step("新会话回答下方的出处");
    const block = turn.answer.locator("xpath=..");
    const footer = block.getByTestId("kg-answer-footer");
    const footerVisible = await footer.waitFor({ state: "visible", timeout: 20_000 }).then(() => true, () => false);
    ctx.see("footerText", footerVisible ? (await footer.innerText()).trim() : null);
    ctx.see("personalBadges", await block.locator("[data-testid^='kg-from-personal-']").allInnerTexts());
    ctx.see("clicksTotal", await clicks(page));
    await ctx.shot("second-session", block);
  });
});

test("[E1.c1] 新用户聊 3 轮，回答下方自动出现「已记下」，没点过任何记忆控件", async ({}, testInfo) => {
  await attach(testInfo, j, ["first-session"], { captured: j.seen.capturedText ?? null, clicks: j.seen.clicksFirstSession ?? null });
  expect(seen<boolean>(j, "capturedVisible"), "3 轮之后应当看得到「已记下 N 条」").toBe(true);
  expect(seen<{ memory: number }>(j, "clicksFirstSession").memory).toBe(0);
});

test("[E1.c2] 开新会话问之前说过的事，回答里答出来了（不用重新交代背景）", async ({}, testInfo) => {
  await attach(testInfo, j, ["second-session"], { answer: j.seen.answer ?? null, expect: CASES.zeroEffort.expect });
  expect(seen<boolean>(j, "secondThreadIsNew")).toBe(true);
  expect(seen<string>(j, "answer")).toContain(CASES.zeroEffort.expect);
});

test("[E1.c3] 新会话的回答下方标着「来自你 … 的对话」，全程记忆相关点击 = 0", async ({}, testInfo) => {
  await attach(testInfo, j, ["second-session"], { footer: j.seen.footerText ?? null, badges: j.seen.personalBadges ?? null, clicks: j.seen.clicksTotal ?? null });
  const badges = seen<string[]>(j, "personalBadges");
  expect(badges.some((b) => /来自你.*的对话/.test(b)), `出处标签：${JSON.stringify(badges)}`).toBe(true);
  expect(seen<{ memory: number }>(j, "clicksTotal").memory).toBe(0);
});
