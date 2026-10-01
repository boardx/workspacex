import { expect, test } from "@playwright/test";
import { KG_EVAL } from "./kg-experience-eval/fixture";
import { login, newThread, say, tell } from "./kg-experience-eval/eval-helpers";

const mode = process.env.KG_EVAL_RECALL_MODE;
if (mode !== "hybrid" && mode !== "vector_only") throw new Error("Run this lane separately with KG_EVAL_RECALL_MODE=hybrid or vector_only");

test(`[A-${mode}] 独立检索模式：真实浏览器回答的通道和材料必须对应实际运行模式`, async ({ page }, info) => {
  await login(page, KG_EVAL.owner);
  const thread = await newThread(page);
  await tell(page, thread, ["M5", "M7"]);
  const observations = [];
  for (const [question, answer] of [
    ["北极星项目首发只做安卓版，是谁决定的？", "王芳"],
    ["为什么北极星项目首发只做安卓版？", "安卓"],
    ["北极星项目的接口统一改成了什么？", "GraphQL"],
  ]) {
    const turn = await say(page, question!);
    await expect(turn.answer).toContainText(answer!);
    const block = turn.answer.locator("xpath=..");
    await block.getByTestId("kg-why-recall-toggle").click();
    const why = block.getByTestId("kg-why-recall-body");
    await expect(why.locator("[data-testid^='kg-recall-channel-']").first()).toBeVisible();
    const channels = await why.locator("[data-testid^='kg-recall-channel-']").allInnerTexts();
    expect(channels).not.toContain("记下的");
    if (mode === "vector_only") expect([...new Set(channels)]).toEqual(["相似"]);
    else { expect(channels).toContain("全文"); expect(channels).toContain("关联"); }
    await expect(block.getByTestId("kg-channel-unavailable")).toHaveCount(0);
    observations.push({ question, expected: answer, answer: turn.text, channels });
    await page.screenshot({ path: info.outputPath(`${mode}-${observations.length}.png`), fullPage: true });
  }
  await info.attach("ablation-observations", { body: JSON.stringify({ mode, observations, dataset: "pipeline-smoke-M5-M7", qualityAcceptance: false }), contentType: "application/json" });
});
