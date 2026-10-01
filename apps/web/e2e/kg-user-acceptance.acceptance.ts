import { expect, test, type Page } from "@playwright/test";
import { KG_EVAL } from "./kg-experience-eval/fixture";
import {
  apiGet, CASES, claimIdOf, login, newThread, openMemoryPanel, say, sayText, tell,
} from "./kg-experience-eval/eval-helpers";

// Real browser + API + workers + AGE/pgvector. Only accounts are preseeded; every memory is formed by chatting.
test.describe.configure({ mode: "default" });
test.setTimeout(240_000);

async function goToBrain(page: Page) {
  await page.getByTestId("rail-profile-menu").click();
  await page.getByTestId("personal-menu-brain").click();
  await expect(page).toHaveURL(/\/brain(?:\?|$)/);
  await expect(page.getByTestId("brain-screen")).toBeVisible();
}

function citations(page: Page) {
  return page.getByTestId("copilot-assistant-message").last().locator("xpath=..").locator(
    "[data-testid^='kg-citation-']:not([data-testid^='kg-citation-chips']):not([data-testid^='kg-citation-pending-']):not([data-testid^='kg-citation-conflict-'])",
  );
}

test("[U01] 从个人菜单找到大脑、找到对话记忆并返回来源", async ({ page }) => {
  await login(page, KG_EVAL.owner);
  const thread = await newThread(page);
  await tell(page, thread, ["M1"]);
  await goToBrain(page);
  await page.getByTestId("brain-tab-sessions").click();
  const source = page.locator(`a[href*='/chat/${thread}']`).first();
  await expect(source).toBeVisible();
  await source.click();
  await expect(page).toHaveURL(new RegExp(`/chat/${thread}`));
  await expect(await openMemoryPanel(page)).toContainText("王芳");
});

test("[U02] 用户输入的记忆在列表、关系图和刷新后均可用", async ({ page }) => {
  await login(page, KG_EVAL.other);
  const thread = await newThread(page);
  await tell(page, thread, ["M1"]);
  const panel = await openMemoryPanel(page);
  await expect(panel).toContainText("王芳");
  await expect(panel).toContainText("赵磊");
  await page.getByTestId("kg-view-graph").click();
  await expect(page.getByTestId("kg-graph-canvas")).toBeVisible();
  await expect(panel).toContainText("北极星");
  await page.reload();
  const restored = await openMemoryPanel(page);
  await page.getByTestId("kg-view-list").click();
  await expect(restored).toContainText("王芳");
  await expect(restored).toContainText("赵磊");
  await expect(restored.getByTestId("kg-visibility")).toContainText("仅你可见");
});

test("[U03] 只问预算时引用精准，不混入合同和团队人数", async ({ page }, testInfo) => {
  await login(page, KG_EVAL.other);
  const thread = await newThread(page);
  await tell(page, thread, ["M8", "M2"]);
  const turn = await say(page, "北极星项目的总预算是多少？只回答预算。");
  await expect(turn.answer).toContainText("380 万");
  await expect(citations(page).first()).toBeVisible();
  const chips = await citations(page).all();
  const statements: string[] = [];
  for (const chip of chips) statements.push((await chip.getAttribute("title")) ?? (await chip.innerText()));
  const relevant = statements.filter((s) => s.includes("北极星") && s.includes("预算"));
  const precision = relevant.length / statements.length;
  await testInfo.attach("measure", { body: JSON.stringify({ answer: turn.text, statements, precision }), contentType: "application/json" });
  expect(precision, "正确答案存在还不够：不相关记忆不应挤进引用").toBeGreaterThanOrEqual(0.8);
  expect(turn.text).not.toContain("96 万");
  expect(turn.text).not.toContain("12 人");
});

test("[U04] 改写预算后开新会话，旧数值与旧引用不复活", async ({ page }) => {
  await login(page, KG_EVAL.newbie);
  const thread = await newThread(page);
  await tell(page, thread, ["M8"]);
  const id = await claimIdOf(page, thread, "北极星项目的总预算是 380 万元");
  await openMemoryPanel(page);
  await page.getByTestId(`kg-row-no-${id}`).click();
  await page.getByTestId(`kg-row-revise-${id}`).click();
  await page.getByTestId(`kg-revise-input-${id}`).fill("北极星项目的总预算是 427 万元");
  await page.getByTestId(`kg-revise-submit-${id}`).click();
  await expect(page.getByTestId("kg-panel")).toContainText("427 万");
  await page.reload();
  await newThread(page);
  const turn = await say(page, "北极星项目的总预算是多少？");
  await expect(turn.answer).toContainText("427 万");
  expect(turn.text).not.toContain("380 万");
  await expect(citations(page).first()).toBeVisible();
  expect((await citations(page).allInnerTexts()).join("\n")).not.toContain("380 万");
});

test("[U05] 忘掉合同金额后重新登录、新开会话，旧记忆不复活", async ({ page, browser }) => {
  await login(page, KG_EVAL.idle);
  const thread = await newThread(page);
  await tell(page, thread, ["M2"]);
  const id = await claimIdOf(page, thread, "恒通物流的合同金额是 96 万元");
  await openMemoryPanel(page);
  await page.getByTestId(`kg-row-no-${id}`).click();
  await page.getByTestId(`kg-row-forget-${id}`).click();
  const confirm = page.getByTestId(`kg-delete-confirm-btn-${id}`);
  if (await confirm.isVisible()) await confirm.click();
  await expect(page.getByTestId(`kg-claim-${id}`)).toHaveCount(0);
  const context = await browser.newContext({ baseURL: process.env.KG_ACCEPTANCE_BASE_URL ?? `http://127.0.0.1:${process.env.WORKSPACEX_WEB_PORT}` });
  try {
    const fresh = await context.newPage();
    await login(fresh, KG_EVAL.idle);
    await newThread(fresh);
    const turn = await say(fresh, "恒通物流的合同金额是多少？");
    expect(turn.text).not.toContain("96 万");
    expect((await citations(fresh).allInnerTexts()).join("\n")).not.toContain("96 万");
    await fresh.screenshot({ path: test.info().outputPath("relogin-forgotten.png"), fullPage: true });
  } finally {
    await context.close();
  }
});

test("[U06] 已开放的项目与组织记忆有可继续操作的真实入口", async ({ page }) => {
  await login(page, KG_EVAL.owner);
  await newThread(page);
  await goToBrain(page);
  await page.getByTestId("brain-tab-shared").click();
  for (const scope of ["project", "org"]) {
    const layer = page.getByTestId(`brain-layer-${scope}`);
    await expect(layer).toBeVisible();
    await expect(layer.getByTestId(`brain-layer-${scope}-status`)).toContainText("已开放");
    const entry = layer.locator("a[href], button:not([disabled])");
    await expect.soft(entry.first(), `${scope}显示已开放，用户应能继续进入真实内容`).toBeVisible({ timeout: 5_000 });
    if (await entry.count() === 0) continue;
    await entry.first().click();
    if (scope === "project") {
      await expect(page.getByTestId("brain-shared")).not.toBeVisible();
      await goToBrain(page);
      await page.getByTestId("brain-tab-shared").click();
    } else {
      await expect(page.getByTestId("brain-org-content")).toBeVisible();
      await expect(page.getByTestId("brain-org-content")).toContainText("当前组织还没有记忆");
    }
  }
});

test("[U07] 他人私人会话不能通过 URL 或出处接口泄漏", async ({ page, browser }) => {
  await login(page, KG_EVAL.owner);
  const thread = await newThread(page);
  await say(page, sayText("N1"));
  await expect.poll(async () => {
    const r = await apiGet(page, `/knowledge-graph/threads/${thread}`);
    return (r.body as { claims?: unknown[] }).claims?.length ?? 0;
  }, { timeout: 30_000 }).toBeGreaterThan(0);
  const response = await apiGet(page, `/knowledge-graph/threads/${thread}`);
  const claim = (response.body as { claims: { id: string }[] }).claims[0]!;
  const context = await browser.newContext({ baseURL: process.env.KG_ACCEPTANCE_BASE_URL ?? `http://127.0.0.1:${process.env.WORKSPACEX_WEB_PORT}` });
  try {
    const other = await context.newPage();
    await login(other, KG_EVAL.other);
    const hidden = await apiGet(other, `/knowledge-graph/claims/${claim.id}/sources`);
    const absent = await apiGet(other, "/knowledge-graph/claims/kg-acceptance-nonexistent/sources");
    expect(hidden.status).toBe(404);
    expect(absent.status).toBe(404);
    const withoutTrace = (body: unknown) => {
      const { traceId: _traceId, ...rest } = body as Record<string, unknown>;
      return rest;
    };
    expect(withoutTrace(hidden.body)).toEqual(withoutTrace(absent.body));
    await other.goto(`/chat/${thread}`);
    // The app keeps a visible composer on a denied thread; privacy requires no disclosed messages and no sending.
    await expect(other.getByTestId("copilotkit-v2-send")).toBeDisabled();
    await expect(other.getByTestId("copilot-assistant-message")).toHaveCount(0);
    expect(await other.locator("body").innerText()).not.toContain(CASES.says.N1.say);
    await other.screenshot({ path: test.info().outputPath("private-thread-denied.png"), fullPage: true });
  } finally {
    await context.close();
  }
});

test("[U08] 窄屏用户可打开记忆，正文与必需操作无横向溢出", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page, KG_EVAL.other);
  await page.goto("/chat");
  await page.getByTestId("copilotkit-v2-mobile-list-toggle").click();
  await page.getByTestId("chat-thread-create").click();
  await page.waitForURL(/\/chat\/[^/?]+$/);
  const thread = decodeURIComponent(new URL(page.url()).pathname.split("/").at(-1)!);
  if (await page.getByTestId("copilotkit-v2-mobile-list-toggle").getAttribute("aria-expanded") === "true") {
    await page.getByTestId("copilotkit-v2-mobile-list-toggle").click();
  }
  await tell(page, thread, ["M3"]);
  await page.getByTestId("chat-task-workbench-mobile-open").click();
  const panel = await openMemoryPanel(page);
  await expect(panel).toContainText("孙悦");
  const geometry = await page.evaluate(() => ({ viewport: innerWidth, scrollWidth: document.documentElement.scrollWidth }));
  await testInfo.attach("measure", { body: JSON.stringify(geometry), contentType: "application/json" });
  expect(geometry.scrollWidth - geometry.viewport).toBeLessThanOrEqual(8);
});
