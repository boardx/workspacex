import { execFileSync } from "node:child_process";
import { expect, test, type Page } from "@playwright/test";
import { MODE_EVAL } from "./kg-mode-acceptance.fixture";
import { login, newThread, openMemoryPanel, say, tell } from "./kg-experience-eval/eval-helpers";

test.setTimeout(240_000);

async function switchOrg(page: Page, orgId: string) {
  await page.getByTestId("org-switcher").click();
  await page.getByTestId(`org-switcher-option-${orgId}`).click();
  await expect(page.getByTestId("org-switcher")).toBeEnabled();
  await expect(page.getByTestId("org-switcher")).toHaveAttribute("title", `org ${orgId}`);
  // Switching organizations intentionally navigates to Projects; wait for that navigation before starting a chat.
  await page.waitForURL(/\/projects(?:\?|$)/);
}

async function showChannels(page: Page) {
  const block = page.getByTestId("copilot-assistant-message").last().locator("xpath=..");
  await expect(block.getByTestId("kg-why-recall-toggle")).toBeVisible();
  await block.getByTestId("kg-why-recall-toggle").click();
  return block.getByTestId("kg-why-recall-body");
}

for (const [mode, orgId] of [["cloud", MODE_EVAL.cloudOrgId], ["local", MODE_EVAL.localOrgId]] as const) {
  test(`[M-${mode}] ${mode}组织：聊天入图 → AGE关联和pgvector相似召回 → 来源原文`, async ({ page }, testInfo) => {
    await login(page, MODE_EVAL.account);
    if (mode === "local") await switchOrg(page, orgId);
    const thread = await newThread(page);
    await tell(page, thread, ["M5", "M7"]);
    const panel = await openMemoryPanel(page);
    await expect(panel).toContainText("王芳");
    await page.screenshot({ path: testInfo.outputPath(`${mode}-01-memory-list.png`), fullPage: true });
    await page.getByTestId("kg-view-graph").click();
    await expect(page.getByTestId("kg-graph-canvas")).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath(`${mode}-02-age-graph.png`), fullPage: true });
    const turn = await say(page, "北极星项目首发只做安卓版，是谁决定的？");
    await expect(turn.answer).toContainText("王芳");
    const why = await showChannels(page);
    await expect(why.locator("[data-testid$='-graph']").first()).toBeVisible();
    await expect(why.locator("[data-testid$='-vector']").first()).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath(`${mode}-03-hybrid-answer.png`), fullPage: true });
    const citation = turn.answer.locator("xpath=..").locator("[data-testid^='kg-citation-']:not([data-testid^='kg-citation-chips']):not([data-testid^='kg-citation-pending-']):not([data-testid^='kg-citation-conflict-'])").first();
    await citation.click();
    await expect(page.getByTestId("kg-source-drawer")).toBeVisible();
    await expect(page.getByTestId("kg-source-drawer")).toContainText("王芳");
    await page.screenshot({ path: testInfo.outputPath(`${mode}-04-source.png`), fullPage: true });
    await testInfo.attach("measure", { body: JSON.stringify({ mode, orgId, answer: turn.text, channels: await why.innerText() }), contentType: "application/json" });
  });
}

test("[M-isolation] 同一用户在云端与local组织间切换，记忆不自动互通", async ({ page }, testInfo) => {
  await login(page, MODE_EVAL.account);
  let thread = await newThread(page);
  await tell(page, thread, ["N1"]);
  await switchOrg(page, MODE_EVAL.localOrgId);
  await page.getByTestId("org-switcher").click();
  await expect(page.getByTestId("org-menu-local-note")).toContainText("本机工作区");
  await page.keyboard.press("Escape");
  thread = await newThread(page);
  const absent = await say(page, "晨光项目的预算是多少？");
  expect(absent.text).not.toContain("120 万");
  await tell(page, thread, ["M8"]);
  const local = await say(page, "北极星项目的总预算是多少？");
  await expect(local.answer).toContainText("380 万");
  await page.screenshot({ path: testInfo.outputPath("local-isolated-answer.png"), fullPage: true });
  await switchOrg(page, MODE_EVAL.cloudOrgId);
  await newThread(page);
  const cloud = await say(page, "北极星项目的总预算是多少？");
  expect(cloud.text).not.toContain("380 万");
  await page.screenshot({ path: testInfo.outputPath("cloud-isolated-answer.png"), fullPage: true });
});

test("[M-graph-readability] 默认窄侧栏关系图能完整显示记忆节点", async ({ page }, testInfo) => {
  await login(page, MODE_EVAL.account);
  const thread = await newThread(page);
  await tell(page, thread, ["M5", "M7"]);
  await openMemoryPanel(page);
  await page.getByTestId("kg-view-graph").click();
  const canvas = page.getByTestId("kg-graph-canvas");
  await expect(canvas.locator(".react-flow__node").first()).toBeVisible();
  let measured: unknown;
  try {
    await expect.poll(async () => {
      const geometry = await canvas.evaluate((el) => {
        const c = el.getBoundingClientRect();
        const nodes = [...el.querySelectorAll(".react-flow__node")].map((node) => {
          const n = node.getBoundingClientRect();
          const overlap = Math.max(0, Math.min(c.right,n.right)-Math.max(c.left,n.left))*Math.max(0,Math.min(c.bottom,n.bottom)-Math.max(c.top,n.top));
          return { text: node.textContent, visibleRatio: overlap / (n.width*n.height), x: n.x, width: n.width };
        });
        return { canvasWidth: c.width, nodes, minVisibleRatio: Math.min(...nodes.map((n) => n.visibleRatio)) };
      });
      measured = geometry;
      return geometry.minVisibleRatio;
    }, { timeout: 10_000, message: "默认关系图不应把记忆节点裁在侧栏外" }).toBeGreaterThanOrEqual(0.95);
  } finally {
    await testInfo.attach("measure", { body: JSON.stringify(measured), contentType: "application/json" });
    await page.screenshot({ path: testInfo.outputPath("cloud-graph-readability.png"), fullPage: true });
  }
  const nodeCount = await canvas.locator(".react-flow__node").count();
  await page.getByRole("button", { name: "放大关系图" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByRole("dialog").locator(".react-flow__node")).toHaveCount(nodeCount);
  await page.screenshot({ path: testInfo.outputPath("cloud-graph-expanded.png"), fullPage: true });
});

test("[M-local-restart] local组织刷新、新会话仍可用；AGE故障如实提示并恢复", async ({ page }, testInfo) => {
  await login(page, MODE_EVAL.account);
  await switchOrg(page, MODE_EVAL.localOrgId);
  const thread = await newThread(page);
  await tell(page, thread, ["M2"]);
  await page.reload();
  await newThread(page);
  const before = await say(page, "恒通物流那边的对接人是谁？");
  await expect(before.answer).toContainText("陈静");
  const sql = (text: string) => execFileSync("psql", ["-h",process.env.PGHOST!,"-p",process.env.PGPORT!,"-U","postgres","-d",process.env.PGDATABASE!,"-v","ON_ERROR_STOP=1","-c",text], { stdio: "pipe" });
  if (!process.env.PGDATABASE?.startsWith("wsx_kg_")) throw new Error("fault injection requires acceptance-owned DB");
  sql("ALTER FUNCTION kg_graph_neighbors(text[]) RENAME TO kg_graph_neighbors__mode_fault");
  try {
    const down = await say(page, "恒通物流那边的对接人是谁？");
    await expect(down.answer).toContainText("陈静");
    await expect(down.answer.locator("xpath=..").getByTestId("kg-channel-unavailable")).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("local-age-unavailable.png"), fullPage: true });
  } finally {
    sql("ALTER FUNCTION kg_graph_neighbors__mode_fault(text[]) RENAME TO kg_graph_neighbors");
  }
  const recovered = await say(page, "恒通物流那边的对接人是谁？");
  const why = await showChannels(page);
  await expect(why.locator("[data-testid$='-graph']").first()).toBeVisible();
  await expect(recovered.answer.locator("xpath=..").getByTestId("kg-channel-unavailable")).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath("local-age-recovered.png"), fullPage: true });
});

test("[M-vector-fault] 两种组织pgvector故障可继续回答，说明正确通道，恢复后可相似召回", async ({ page }, testInfo) => {
  if (!process.env.PGDATABASE?.startsWith("wsx_kg_")) throw new Error("fault injection requires acceptance-owned DB");
  const sql = (text: string) => execFileSync("psql", ["-h",process.env.PGHOST!,"-p",process.env.PGPORT!,"-U","postgres","-d",process.env.PGDATABASE!,"-v","ON_ERROR_STOP=1","-c",text], { stdio: "pipe" });
  await login(page, MODE_EVAL.account);
  for (const [mode, orgId] of [["cloud", MODE_EVAL.cloudOrgId], ["local", MODE_EVAL.localOrgId]] as const) {
    if (mode === "local") await switchOrg(page, orgId);
    const thread = await newThread(page);
    await tell(page, thread, ["M2"]);
    await say(page, "恒通物流那边的对接人是谁？");
    const ready = await showChannels(page);
    await expect(ready.locator("[data-testid$='-vector']").first()).toBeVisible();
    sql("ALTER TABLE object_embeddings RENAME TO object_embeddings__mode_fault");
    try {
      const down = await say(page, "恒通物流那边的对接人是谁？");
      await expect(down.answer).toContainText("陈静");
      const notice = down.answer.locator("xpath=..").getByTestId("kg-channel-unavailable");
      await expect(notice).toBeVisible();
      const why = await showChannels(page);
      await expect(why.locator("[data-testid$='-graph']").first()).toBeVisible();
      await testInfo.attach(`${mode}-measure`, { body: JSON.stringify({ mode, answer: down.text, notice: await notice.innerText(), channels: await why.innerText() }), contentType: "application/json" });
      await page.screenshot({ path: testInfo.outputPath(`${mode}-pgvector-unavailable.png`), fullPage: true });
      await expect.soft(notice, "相似检索失败时，不应错误告诉用户是关联查询不可用").toContainText("相似", { timeout: 3_000 });
    } finally {
      sql("ALTER TABLE object_embeddings__mode_fault RENAME TO object_embeddings");
    }
    const recovered = await say(page, "恒通物流那边的对接人是谁？");
    const why = await showChannels(page);
    await expect(why.locator("[data-testid$='-vector']").first()).toBeVisible();
    await expect(recovered.answer.locator("xpath=..").getByTestId("kg-channel-unavailable")).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath(`${mode}-pgvector-recovered.png`), fullPage: true });
  }
});

test("[M-both-fault] 云端与local的AGE及pgvector同时失败时仍可回答，准确提示两通道并恢复", async ({ page }, info) => {
  if (!process.env.PGDATABASE?.startsWith("wsx_kg_")) throw new Error("fault injection requires acceptance-owned DB");
  const sql = (text: string) => execFileSync("psql", ["-h", process.env.PGHOST!, "-p", process.env.PGPORT!, "-U", "postgres", "-d", process.env.PGDATABASE!, "-v", "ON_ERROR_STOP=1", "-c", text], { stdio: "pipe" });
  await login(page, MODE_EVAL.account);
  for (const [mode, orgId] of [["cloud", MODE_EVAL.cloudOrgId], ["local", MODE_EVAL.localOrgId]] as const) {
    if (mode === "local") await switchOrg(page, orgId);
    const thread = await newThread(page);
    await tell(page, thread, ["M2"]);
    await say(page, "恒通物流那边的对接人是谁？");
    const ready = await showChannels(page);
    await expect(ready.locator("[data-testid$='-vector']").first()).toBeVisible();
    await expect(ready.locator("[data-testid$='-graph']").first()).toBeVisible();
    sql("BEGIN; ALTER FUNCTION kg_graph_neighbors(text[]) RENAME TO kg_graph_neighbors__both_fault; ALTER TABLE object_embeddings RENAME TO object_embeddings__both_fault; COMMIT");
    try {
      const down = await say(page, "恒通物流那边的对接人是谁？");
      await expect(down.answer).toContainText("陈静");
      const notice = down.answer.locator("xpath=..").getByTestId("kg-channel-unavailable");
      await expect(notice).toContainText("关联");
      await expect(notice).toContainText("相似");
      await page.screenshot({ path: info.outputPath(`${mode}-both-unavailable.png`), fullPage: true });
    } finally {
      sql("BEGIN; ALTER FUNCTION kg_graph_neighbors__both_fault(text[]) RENAME TO kg_graph_neighbors; ALTER TABLE object_embeddings__both_fault RENAME TO object_embeddings; COMMIT");
    }
    const answer = await say(page, "恒通物流那边的对接人是谁？");
    await expect(answer.answer.locator("xpath=..").getByTestId("kg-channel-unavailable")).toHaveCount(0);
    const recovered = await showChannels(page);
    await expect(recovered.locator("[data-testid$='-vector']").first()).toBeVisible();
    await expect(recovered.locator("[data-testid$='-graph']").first()).toBeVisible();
    await page.screenshot({ path: info.outputPath(`${mode}-both-recovered.png`), fullPage: true });
  }
});
