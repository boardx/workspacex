/**
 * E2 记得住（06-UX R4）：固定 20 题回忆（人名、决定、数字、日期、原因各 4 题），答对率 ≥ 90%，每条带引用。
 *
 * 一题一条检查（本维得分 = 答对题数 / 20，≥ 0.9 即达标）。「答对」= 回答正文里有标准答案，**并且**回答下方有一个
 * 引用（chip）的原文里也有它——答案来自记忆、且用户点得回去，二者缺一不算。
 *
 * 回答来自「只照着这一轮收到的【记忆】作答」的回环模型（见 loopback-kg-eval-model-provider.ts）：一题答不出来，
 * 就是召回这一轮没把那条记忆交给模型——量的是记忆系统，不是模型的措辞。
 */
import { expect, test } from "@playwright/test";
import { KG_EVAL } from "./fixture";
import { CASES, newThread, say, tell, type SayKey } from "./eval-helpers";
import { attach, runJourney, seen, type Journal } from "./journey";

interface Answer { readonly answer: string; readonly citations: readonly string[] }

let j: Journal;

test.beforeAll(async ({ browser }) => {
  test.setTimeout(1_200_000);
  j = await runJourney("E2", browser, async (ctx) => {
    ctx.step("登录并开一个新对话");
    const page = await ctx.pageAs(KG_EVAL.owner);
    await page.goto("/chat");
    const thread = await newThread(page);
    ctx.step("把 20 件事说给它听（10 句话）");
    await tell(page, thread, CASES.recall.tell as SayKey[]);
    for (const q of CASES.recall.questions) {
      ctx.step(`问 ${q.id}：${q.ask}`);
      const turn = await say(page, q.ask);
      const block = turn.answer.locator("xpath=..");
      const chips = block.locator("[data-testid^='kg-citation-']:not([data-testid^='kg-citation-chips']):not([data-testid^='kg-citation-pending-']):not([data-testid^='kg-citation-conflict-'])");
      await block.getByTestId("kg-answer-footer").waitFor({ state: "visible", timeout: 15_000 }).catch(() => undefined);
      const citations: string[] = [];
      for (const c of await chips.all()) citations.push((await c.getAttribute("title")) ?? (await c.innerText()));
      ctx.see(q.id, { answer: turn.text, citations } satisfies Answer);
      await ctx.shot(q.id, block);
    }
  });
});

for (const q of CASES.recall.questions) {
  test(`[E2.${q.id}] ${q.type}：「${q.ask}」答出「${q.expect}」且带引用`, async ({}, testInfo) => {
    const a = j.seen[q.id] as Answer | undefined;
    await attach(testInfo, j, [q.id], { ask: q.ask, expect: q.expect, answer: a?.answer ?? null, citations: a?.citations ?? null });
    const got = seen<Answer>(j, q.id);
    expect(got.answer, "回答正文里要有标准答案").toContain(q.expect);
    expect(got.citations.some((c) => c.includes(q.expect)), `引用里要有它：${JSON.stringify(got.citations)}`).toBe(true);
  });
}
