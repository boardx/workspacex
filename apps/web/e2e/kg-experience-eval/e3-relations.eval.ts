/**
 * E3 答得对（06-UX R4）：关系类题（谁定的 / 为什么 / 被什么取代）；hybrid 比纯向量多答对 ≥ 20%。
 *
 * - c1 谁定的：答出拍板人，且回答下方「为什么用到它」里这条引用走了**关联**（图路）——hybrid 真的在起作用；
 * - c2 为什么：答出原因；
 * - c3 被什么取代：把一条说法确认过之后改口，在矛盾卡上选「以新的为准」，再问——回答用新的、不再出现旧的；
 * - c4 hybrid 比纯向量多答对 ≥ 20%：同一组关系题，数「引用来自相似（向量）通道」的答对题数作纯向量的成绩。
 *   **纯向量基线必须量得到**：整段旅程里一次「相似」通道都没出现过 ⇒ 基线不存在（本阶段没有嵌入流水线，F05），
 *   这条如实红，不拿「0 分的向量」去衬托 hybrid。
 */
import { expect, test, type Locator } from "@playwright/test";
import { KG_EVAL } from "./fixture";
import { CASES, claimIdOf, newThread, openMemoryPanel, say, sayText, tell, waitForMemories, type SayKey } from "./eval-helpers";
import { attach, runJourney, seen, type Journal } from "./journey";

interface Asked { readonly answer: string; readonly citations: ReadonlyArray<{ statement: string; channels: string[] }> }

let j: Journal;

/** 回答下方的引用 + 每条的通道（展开「为什么用到它」读用户看到的通道名：全文 / 相似 / 关联）。 */
async function readCitations(block: Locator): Promise<Asked["citations"]> {
  await block.getByTestId("kg-answer-footer").waitFor({ state: "visible", timeout: 15_000 }).catch(() => undefined);
  const toggle = block.getByTestId("kg-why-recall-toggle");
  if (!(await toggle.isVisible().catch(() => false))) return [];
  await toggle.click();
  const out: { statement: string; channels: string[] }[] = [];
  for (const r of await block.locator("[data-testid^='kg-recall-reason-']").all()) {
    const statement = (await r.locator("span").first().innerText()).replace(/^\[\d+\]\s*/, "").trim();
    const channels = await r.locator("[data-testid^='kg-recall-channel-']").allInnerTexts();
    out.push({ statement, channels: channels.map((c) => c.trim()) });
  }
  return out;
}

test.beforeAll(async ({ browser }) => {
  test.setTimeout(900_000);
  j = await runJourney("E3", browser, async (ctx) => {
    const flow = CASES.relation;
    ctx.step("登录并开一个新对话");
    const page = await ctx.pageAs(KG_EVAL.owner);
    await page.goto("/chat");
    const thread = await newThread(page);
    await tell(page, thread, flow.tell as SayKey[]);

    const ask = async (key: string, q: string) => {
      ctx.step(`问：${q}`);
      const turn = await say(page, q);
      const block = turn.answer.locator("xpath=..");
      const citations = await readCitations(block);
      ctx.see(key, { answer: turn.text, citations } satisfies Asked);
      await ctx.shot(key, block);
    };
    await ask("whoDecided", flow.whoDecided.ask);
    await ask("why", flow.why.ask);
    for (const [i, q] of flow.vectorBaseline.entries()) await ask(`baseline-${i}`, q.ask);

    ctx.step("确认一条说法，然后改口");
    const oldId = await claimIdOf(page, thread, flow.supersede.confirm);
    const panel = await openMemoryPanel(page);
    await panel.getByTestId(`kg-row-yes-${oldId}`).click();
    await expect(panel.getByTestId(`kg-row-yes-${oldId}`)).toContainText("你确认过");
    const change = await say(page, sayText(flow.supersede.say as SayKey));
    await waitForMemories(page, thread, 6);
    ctx.step("在矛盾卡上选「以新的为准」");
    const block = change.answer.locator("xpath=..");
    const card = block.getByTestId("kg-conflict-card");
    // 抽取是异步的：卡片在回答说完之后、这一轮记完时才出现（回答下的记忆行会补读）。
    const cardSeen = await card.waitFor({ state: "visible", timeout: 30_000 }).then(() => true, async () => {
      await page.reload();
      return page.getByTestId("kg-conflict-card").last().waitFor({ state: "visible", timeout: 20_000 }).then(() => true, () => false);
    });
    ctx.see("conflictCardSeen", cardSeen);
    if (cardSeen) {
      await page.getByTestId("kg-conflict-keep-new").last().click();
      await expect(page.getByTestId("kg-conflict-resolved").last()).toBeVisible();
    }
    await page.waitForTimeout(2_500);
    await ask("supersede", flow.supersede.ask);
  });
});

test("[E3.c1] 谁定的：「首发只做安卓版是谁定的？」答出王芳，且这条引用走了关联（图）", async ({}, testInfo) => {
  const a = j.seen.whoDecided as Asked | undefined;
  await attach(testInfo, j, ["whoDecided"], { answer: a?.answer ?? null, citations: a?.citations ?? null });
  const got = seen<Asked>(j, "whoDecided");
  expect(got.answer).toContain(CASES.relation.whoDecided.expect);
  const hit = got.citations.find((c) => c.statement.includes(CASES.relation.whoDecided.expect));
  expect(hit, "要有一条引用写着拍板人").toBeDefined();
  expect(hit!.channels, "这条引用应当经关联（图）找到").toContain("关联");
});

test("[E3.c2] 为什么：「为什么首发只做安卓版？」答出原因", async ({}, testInfo) => {
  const a = j.seen.why as Asked | undefined;
  await attach(testInfo, j, ["why"], { answer: a?.answer ?? null, citations: a?.citations ?? null });
  const got = seen<Asked>(j, "why");
  expect(got.answer).toContain(CASES.relation.why.expect);
  expect(got.citations.some((c) => c.statement.includes(CASES.relation.why.expect))).toBe(true);
});

test("[E3.c3] 被什么取代：改口并选「以新的为准」后再问，回答用新的日期、不再出现旧的", async ({}, testInfo) => {
  const a = j.seen.supersede as Asked | undefined;
  await attach(testInfo, j, ["supersede"], { conflictCard: j.seen.conflictCardSeen ?? null, answer: a?.answer ?? null });
  expect(seen<boolean>(j, "conflictCardSeen"), "改口时应当出现矛盾卡").toBe(true);
  const got = seen<Asked>(j, "supersede");
  expect(got.answer).toContain(CASES.relation.supersede.expect);
  expect(got.answer).not.toContain(CASES.relation.supersede.gone);
});

test("[E3.c4] 关系题 hybrid 比纯向量多答对 ≥ 20%（纯向量基线必须量得到）", async ({}, testInfo) => {
  const qs = CASES.relation.vectorBaseline;
  const got = qs.map((q, i) => ({ q, a: j.seen[`baseline-${i}`] as Asked | undefined }));
  const correct = (x: (typeof got)[number]) => x.a !== undefined && x.a.answer.includes(x.q.expect);
  const hybrid = got.filter(correct).length;
  const vectorOnly = got.filter((x) => correct(x) && x.a!.citations.some((c) => c.statement.includes(x.q.expect) && c.channels.includes("相似"))).length;
  const vectorSeen = got.some((x) => x.a?.citations.some((c) => c.channels.includes("相似")) === true);
  await attach(testInfo, j, qs.map((_, i) => `baseline-${i}`), { hybrid, vectorOnly, total: qs.length, vectorChannelSeen: vectorSeen });
  expect(vectorSeen, "纯向量基线量不到：整段旅程里相似（向量）通道一次都没出现（本阶段没有嵌入，F05）").toBe(true);
  expect((hybrid - vectorOnly) / qs.length).toBeGreaterThanOrEqual(0.2);
});
