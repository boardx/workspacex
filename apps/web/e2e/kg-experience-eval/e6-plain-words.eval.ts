/**
 * E6 看得懂（06-UX R4 / R3-3 / R5）：界面文案不含 R5 禁用词（自动扫描）；状态不只靠颜色区分（带文字）。
 *
 * 扫的是**记忆的界面**（产品写的字），不是模型的回答正文：回答下方的引用 / 为什么用到它 / 已记下 / 矛盾卡 /
 * 记住卡，右栏记忆面板（列表与关系图两种视图），来源抽屉，大脑页。旅程把这些界面一个个走出来。
 */
import { expect, test, type Locator } from "@playwright/test";
import { KG_EVAL } from "./fixture";
import { FORBIDDEN_EN, FORBIDDEN_ZH, claimIdOf, newThread, openMemoryPanel, say, sayText, tell, waitForMemories } from "./eval-helpers";
import { attach, runJourney, seen, type Journal } from "./journey";

let j: Journal;
const texts: Record<string, string> = {};

const KG_SURFACES = "[data-testid='kg-answer-footer'], [data-testid='kg-turn-captured'], [data-testid='kg-turn-pending'], [data-testid='kg-conflict-card'], [data-testid='kg-card-remember'], [data-testid='kg-card-forget'], [data-testid='kg-card-done']";

async function collect(key: string, loc: Locator): Promise<void> {
  const all = await loc.allInnerTexts().catch(() => [] as string[]);
  texts[key] = all.join("\n");
}

test.beforeAll(async ({ browser }) => {
  test.setTimeout(900_000);
  j = await runJourney("E6", browser, async (ctx) => {
    ctx.step("登录并开一个新对话");
    const page = await ctx.pageAs(KG_EVAL.owner);
    await page.goto("/chat");
    const thread = await newThread(page);
    await tell(page, thread, ["M5", "M9"]);
    ctx.step("确认一条、改口出矛盾卡、说「记住」出记住卡");
    const launch = await claimIdOf(page, thread, "北极星项目的正式上线定在 11 月 18 日");
    const panel = await openMemoryPanel(page);
    await panel.getByTestId(`kg-row-yes-${launch}`).click();
    await say(page, sayText("CHANGE_LAUNCH"));
    await waitForMemories(page, thread, 5);
    await say(page, "记住：北极星项目的代号叫 NS-1。");
    ctx.step("问一个用得上记忆的问题，展开「为什么用到它」");
    const turn = await say(page, "首发只做安卓版是谁定的？");
    const block = turn.answer.locator("xpath=..");
    await block.getByTestId("kg-why-recall-toggle").click().catch(() => undefined);
    await page.reload();
    await page.getByTestId("copilot-assistant-message").last().waitFor({ state: "visible" });
    await page.waitForTimeout(4_000);
    const again = page.getByTestId("copilot-assistant-message").last().locator("xpath=..");
    await again.getByTestId("kg-why-recall-toggle").click().catch(() => undefined);
    await collect("answers", page.locator(KG_SURFACES));
    await ctx.shot("answers", page.getByTestId("copilotkit-v2-messages"));

    ctx.step("记忆面板：列表");
    const p2 = await openMemoryPanel(page);
    await collect("panel-list", p2);
    await ctx.shot("panel-list", p2);
    ctx.step("记忆面板：关系图");
    await p2.getByTestId("kg-view-graph").click();
    await page.waitForTimeout(1_500);
    await collect("panel-graph", p2);
    await ctx.shot("panel-graph", p2);
    await p2.getByTestId("kg-view-list").click();
    ctx.step("来源抽屉");
    await p2.locator("[data-testid^='kg-claim-open-']").first().click();
    const drawer = page.getByTestId("kg-source-drawer");
    await drawer.getByTestId("kg-source-evidence-list").waitFor({ state: "visible", timeout: 10_000 });
    await collect("drawer", drawer);
    await ctx.shot("drawer", drawer);
    ctx.step("大脑页");
    await page.goto("/brain");
    await page.getByTestId("brain-screen").waitFor({ state: "visible" });
    await page.waitForTimeout(2_000);
    await collect("brain", page.getByTestId("brain-screen"));
    await ctx.shot("brain", page);
    ctx.see("texts", texts);

    ctx.step("状态标签：每个都有字");
    await page.goto(`/chat/${encodeURIComponent(thread)}`);
    const p3 = await openMemoryPanel(page);
    const badges = await p3.locator("[data-testid^='kg-tri-state-']").allInnerTexts();
    ctx.see("triStateBadges", badges.map((b) => b.trim()));
  });
});

const hits = (t: Record<string, string>, test: (s: string) => string[]) =>
  Object.entries(t).flatMap(([k, v]) => test(v).map((w) => `${k}: ${w}`));

test("[E6.c1] 记忆界面上没有内部术语（实体、结论、三态、晋升、L0/L1、本体、知识面板）", async ({}, testInfo) => {
  await attach(testInfo, j, ["answers", "panel-list", "panel-graph", "drawer", "brain"], { surfaces: Object.keys((j.seen.texts as object | undefined) ?? {}) });
  const t = seen<Record<string, string>>(j, "texts");
  expect(Object.keys(t).length, "五类界面都要扫到").toBeGreaterThanOrEqual(5);
  expect(hits(t, (s) => FORBIDDEN_ZH.filter((w) => s.includes(w)))).toEqual([]);
});

test("[E6.c2] 记忆界面上没有代码里的英文内部名（claim / pending / confirmed / revoke…）", async ({}, testInfo) => {
  await attach(testInfo, j, ["panel-list", "drawer"]);
  const t = seen<Record<string, string>>(j, "texts");
  expect(hits(t, (s) => [...s.matchAll(new RegExp(FORBIDDEN_EN.source, "gi"))].map((m) => m[0]))).toEqual([]);
});

test("[E6.c3] 状态不只靠颜色：每个状态标签都写着「AI 记下的 / 你确认过 / 有矛盾」", async ({}, testInfo) => {
  await attach(testInfo, j, ["panel-list"], { badges: j.seen.triStateBadges ?? null });
  const badges = seen<string[]>(j, "triStateBadges");
  expect(badges.length).toBeGreaterThan(0);
  expect(badges.filter((b) => !["AI 记下的", "你确认过", "有矛盾"].includes(b))).toEqual([]);
});
