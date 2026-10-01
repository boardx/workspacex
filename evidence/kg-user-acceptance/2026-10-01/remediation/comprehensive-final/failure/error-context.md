# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: kg-experience-eval/e3-relations.eval.ts >> [E3.c4] 关系题 hybrid 比纯向量多答对 ≥ 20%（纯向量基线必须量得到）
- Location: e2e/kg-experience-eval/e3-relations.eval.ts:109:5

# Error details

```
Error: expect(received).toBeGreaterThanOrEqual(expected)

Expected: >= 0.2
Received:    0
```

# Test source

```ts
  18  | let j: Journal;
  19  | 
  20  | /** 回答下方的引用 + 每条的通道（展开「为什么用到它」读用户看到的通道名：全文 / 相似 / 关联）。 */
  21  | async function readCitations(block: Locator): Promise<Asked["citations"]> {
  22  |   await block.getByTestId("kg-answer-footer").waitFor({ state: "visible", timeout: 15_000 }).catch(() => undefined);
  23  |   const toggle = block.getByTestId("kg-why-recall-toggle");
  24  |   if (!(await toggle.isVisible().catch(() => false))) return [];
  25  |   await toggle.click();
  26  |   const out: { statement: string; channels: string[] }[] = [];
  27  |   for (const r of await block.locator("[data-testid^='kg-recall-reason-']").all()) {
  28  |     const statement = (await r.locator("span").first().innerText()).replace(/^\[\d+\]\s*/, "").trim();
  29  |     const channels = await r.locator("[data-testid^='kg-recall-channel-']").allInnerTexts();
  30  |     out.push({ statement, channels: channels.map((c) => c.trim()) });
  31  |   }
  32  |   return out;
  33  | }
  34  | 
  35  | test.beforeAll(async ({ browser }) => {
  36  |   test.setTimeout(900_000);
  37  |   j = await runJourney("E3", browser, async (ctx) => {
  38  |     const flow = CASES.relation;
  39  |     ctx.step("登录并开一个新对话");
  40  |     const page = await ctx.pageAs(KG_EVAL.owner);
  41  |     await page.goto("/chat");
  42  |     const thread = await newThread(page);
  43  |     await tell(page, thread, flow.tell as SayKey[]);
  44  | 
  45  |     const ask = async (key: string, q: string) => {
  46  |       ctx.step(`问：${q}`);
  47  |       const turn = await say(page, q);
  48  |       const block = turn.answer.locator("xpath=..");
  49  |       const citations = await readCitations(block);
  50  |       ctx.see(key, { answer: turn.text, citations } satisfies Asked);
  51  |       await ctx.shot(key, block);
  52  |     };
  53  |     await ask("whoDecided", flow.whoDecided.ask);
  54  |     await ask("why", flow.why.ask);
  55  |     for (const [i, q] of flow.vectorBaseline.entries()) await ask(`baseline-${i}`, q.ask);
  56  | 
  57  |     ctx.step("确认一条说法，然后改口");
  58  |     const oldId = await claimIdOf(page, thread, flow.supersede.confirm);
  59  |     const panel = await openMemoryPanel(page);
  60  |     await panel.getByTestId(`kg-row-yes-${oldId}`).click();
  61  |     await expect(panel.getByTestId(`kg-row-yes-${oldId}`)).toContainText("你确认过");
  62  |     const change = await say(page, sayText(flow.supersede.say as SayKey));
  63  |     await waitForMemories(page, thread, 6);
  64  |     ctx.step("在矛盾卡上选「以新的为准」");
  65  |     const block = change.answer.locator("xpath=..");
  66  |     const card = block.getByTestId("kg-conflict-card");
  67  |     // 抽取是异步的：卡片在回答说完之后、这一轮记完时才出现（回答下的记忆行会补读）。
  68  |     const cardSeen = await card.waitFor({ state: "visible", timeout: 30_000 }).then(() => true, async () => {
  69  |       await page.reload();
  70  |       return page.getByTestId("kg-conflict-card").last().waitFor({ state: "visible", timeout: 20_000 }).then(() => true, () => false);
  71  |     });
  72  |     ctx.see("conflictCardSeen", cardSeen);
  73  |     if (cardSeen) {
  74  |       await page.getByTestId("kg-conflict-keep-new").last().click();
  75  |       await expect(page.getByTestId("kg-conflict-resolved").last()).toBeVisible();
  76  |     }
  77  |     await page.waitForTimeout(2_500);
  78  |     await ask("supersede", flow.supersede.ask);
  79  |   });
  80  | });
  81  | 
  82  | test("[E3.c1] 谁定的：「首发只做安卓版是谁定的？」答出王芳，且这条引用走了关联（图）", async ({}, testInfo) => {
  83  |   const a = j.seen.whoDecided as Asked | undefined;
  84  |   await attach(testInfo, j, ["whoDecided"], { answer: a?.answer ?? null, citations: a?.citations ?? null });
  85  |   const got = seen<Asked>(j, "whoDecided");
  86  |   expect(got.answer).toContain(CASES.relation.whoDecided.expect);
  87  |   const hit = got.citations.find((c) => c.statement.includes(CASES.relation.whoDecided.expect));
  88  |   expect(hit, "要有一条引用写着拍板人").toBeDefined();
  89  |   expect(hit!.channels, "这条引用应当经关联（图）找到").toContain("关联");
  90  | });
  91  | 
  92  | test("[E3.c2] 为什么：「为什么首发只做安卓版？」答出原因", async ({}, testInfo) => {
  93  |   const a = j.seen.why as Asked | undefined;
  94  |   await attach(testInfo, j, ["why"], { answer: a?.answer ?? null, citations: a?.citations ?? null });
  95  |   const got = seen<Asked>(j, "why");
  96  |   expect(got.answer).toContain(CASES.relation.why.expect);
  97  |   expect(got.citations.some((c) => c.statement.includes(CASES.relation.why.expect))).toBe(true);
  98  | });
  99  | 
  100 | test("[E3.c3] 被什么取代：改口并选「以新的为准」后再问，回答用新的日期、不再出现旧的", async ({}, testInfo) => {
  101 |   const a = j.seen.supersede as Asked | undefined;
  102 |   await attach(testInfo, j, ["supersede"], { conflictCard: j.seen.conflictCardSeen ?? null, answer: a?.answer ?? null });
  103 |   expect(seen<boolean>(j, "conflictCardSeen"), "改口时应当出现矛盾卡").toBe(true);
  104 |   const got = seen<Asked>(j, "supersede");
  105 |   expect(got.answer).toContain(CASES.relation.supersede.expect);
  106 |   expect(got.answer).not.toContain(CASES.relation.supersede.gone);
  107 | });
  108 | 
  109 | test("[E3.c4] 关系题 hybrid 比纯向量多答对 ≥ 20%（纯向量基线必须量得到）", async ({}, testInfo) => {
  110 |   const qs = CASES.relation.vectorBaseline;
  111 |   const got = qs.map((q, i) => ({ q, a: j.seen[`baseline-${i}`] as Asked | undefined }));
  112 |   const correct = (x: (typeof got)[number]) => x.a !== undefined && x.a.answer.includes(x.q.expect);
  113 |   const hybrid = got.filter(correct).length;
  114 |   const vectorOnly = got.filter((x) => correct(x) && x.a!.citations.some((c) => c.statement.includes(x.q.expect) && c.channels.includes("相似"))).length;
  115 |   const vectorSeen = got.some((x) => x.a?.citations.some((c) => c.channels.includes("相似")) === true);
  116 |   await attach(testInfo, j, qs.map((_, i) => `baseline-${i}`), { hybrid, vectorOnly, total: qs.length, vectorChannelSeen: vectorSeen });
  117 |   expect(vectorSeen, "纯向量基线量不到：整段旅程里相似（向量）通道一次都没出现（本阶段没有嵌入，F05）").toBe(true);
> 118 |   expect((hybrid - vectorOnly) / qs.length).toBeGreaterThanOrEqual(0.2);
      |                                             ^ Error: expect(received).toBeGreaterThanOrEqual(expected)
  119 | });
  120 | 
```