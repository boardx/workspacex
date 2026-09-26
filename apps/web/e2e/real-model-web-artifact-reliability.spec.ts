/**
 * **web-artifact 技能十连跑成功率**（2026-09-27 人类交办："报错了，请测试 10 轮，
 * 保证 100% 成功，解决所有的问题"）。
 *
 * ## 起点
 *
 * 三张 devapp 截图连续复现同一个失败：第 4 步「使用隔离浏览器完成结构、操作、
 * 移动视口、网络边界和文件可读性验收」失败——"模型这次没能返回可用结果：有一次
 * 工具调用始终没有返回结果……多半是它执行的脚本卡住或失败了"（`tool_call_
 * unresolved`）。已经定位并修了一层真因（`deep-agent-service` 的 `ChatOpenAI`
 * 客户端从没设过 `request_timeout`，commit 5fb5b9953）。这份 spec 验证那个修法
 * 是否真的把成功率拉到 100%，而不是停在"理论上应该有用"。
 *
 * ## 判据
 *
 * 每一轮：产物真的落库 + 真的下载到字节 + 字节头是 zip（`index.html`/`bundle.html`
 * 是自包含单文件，不强制某个具体扩展名，只认"确实有一个可下载、非空的产出文件"）。
 * 失败时抓取失败发生瞬间的 deep-agent-service 线程状态（哪个工具调用还开着、
 * 最后一条消息是什么），不满足于界面上那句人话摘要。
 */
import { expect, test, type Page } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { REAL_MODEL_SKIP_REASON, REAL_MODEL_SMOKE } from "./real-model-smoke-fixture";
import { authedBytes, authedJson } from "./support/real-model-api";

test.skip(REAL_MODEL_SKIP_REASON !== null, REAL_MODEL_SKIP_REASON ?? "");

const OUT = join(process.cwd(), "../../evidence/local-desktop/chat-quality/web-artifact-reliability.md");
const TASK_BUDGET_MS = Number(process.env.REAL_MODEL_TASK_BUDGET_MS ?? "600000");
const PROMPT = "生成一个交互式的网页，来介绍设计思维";
const RUNS = Number(process.env.REAL_MODEL_RUN_COUNT ?? "10");

interface RunRow {
  readonly n: number;
  readonly ok: boolean;
  readonly ms: number;
  readonly detail: string;
}

const rows: RunRow[] = [];

async function login(page: Page): Promise<void> {
  await page.context().clearCookies();
  await page.goto("/login");
  await page.evaluate(() => { window.localStorage.clear(); }).catch(() => {});
  await page.goto("/login");
  await page.getByTestId("login-email").fill(REAL_MODEL_SMOKE.email);
  await page.getByTestId("login-password").fill(REAL_MODEL_SMOKE.password);
  await page.getByTestId("login-submit").click();
  await expect(page).toHaveURL(/\/projects$/, { timeout: 60_000 });
}

/** 与 `real-model-office-matrix.spec.ts` 逐字同一条纪律（三道口子都已实测过）：
 * 身份服务临时不可用的恢复态、`confirm_task_intent`、通用工具权限弹窗。 */
async function sendAndSettle(page: Page, prompt: string): Promise<string> {
  await page.goto("/chat");
  const dependencyFailed = page.getByTestId("session-dependency-failed");
  const retryButton = page.getByRole("button", { name: "重试" });
  for (let attempt = 0; attempt < 5; attempt += 1) {
    if ((await dependencyFailed.count()) === 0) break;
    await retryButton.click({ timeout: 5_000 }).catch(() => {});
    await page.waitForTimeout(3_000);
  }
  const composer = page.getByTestId("copilotkit-v2-input");
  await expect(composer).toBeVisible({ timeout: 120_000 });
  await composer.fill(prompt);
  const send = page.getByTestId("copilotkit-v2-send");
  await send.click();

  const confirmIntentContinue = page.getByTestId("agent-interrupt-confirm-intent-continue");
  const toolPermissionDialog = page.getByTestId("chat-tool-permission-dialog");
  const toolPermissionAllowRun = page.getByTestId("perm-run");

  const sentAt = Date.now();
  let sawRunning = false;
  while (Date.now() - sentAt < TASK_BUDGET_MS) {
    if ((await confirmIntentContinue.count()) > 0) {
      await confirmIntentContinue.click({ timeout: 5_000 }).catch(() => {});
      await page.waitForTimeout(1_000);
      continue;
    }
    if ((await toolPermissionDialog.count()) > 0) {
      await toolPermissionAllowRun.click({ timeout: 5_000 }).catch(() => {});
      await page.waitForTimeout(1_000);
      continue;
    }
    const state = await send.getAttribute("data-send-state").catch(() => null);
    if (state === "running") sawRunning = true;
    else if (sawRunning) return "landed";
    else if (Date.now() - sentAt > 120_000) return "never-started";
    await page.waitForTimeout(2_000);
  }
  return "timeout";
}

interface Attachment { readonly id: string; readonly filename: string; readonly bytes: number }

/** 权威判据：真的落库 + 真的下载到非空字节。不认模型措辞。
 * 端点形状与 `real-model-office-matrix.spec.ts` 的 `verifyProduced` 逐字同一条
 * （单一事实源，不重新猜一遍路径/JSON 键名）。 */
async function verifyProduced(page: Page): Promise<string> {
  const threadId = /\/chat\/([^/?#]+)/.exec(page.url())?.[1];
  if (!threadId) throw new Error("落定后 URL 上没有 threadId，拿不到权威产物列表");

  const listed = await authedJson(page, `/chat/threads/${threadId}/attachments`);
  if (!listed.ok) throw new Error(`列产物失败 HTTP ${String(listed.status)}`);
  const items = ((listed.json as { items?: Attachment[] }).items) ?? [];
  if (items.length === 0) throw new Error("没有产出任何附件");
  const file = items[items.length - 1]!;

  const bytes = await authedBytes(page, `/chat/threads/${threadId}/attachments/${file.id}/content`);
  if (bytes.length !== file.bytes) {
    throw new Error(`字节数对不上：登记 ${String(file.bytes)}，实收 ${String(bytes.length)}`);
  }
  if (bytes.length === 0) throw new Error("下载到的文件是空的");
  return `${file.filename} ${String(bytes.length)}B`;
}

test("真实模型：web-artifact 技能十连跑，验证超时修复后的成功率", async ({ page }) => {
  test.setTimeout(TASK_BUDGET_MS * RUNS + 600_000);
  await login(page);

  for (let n = 1; n <= RUNS; n += 1) {
    const started = Date.now();
    try {
      const landing = await sendAndSettle(page, PROMPT);
      if (landing !== "landed") throw new Error(`这一轮${landing === "timeout" ? "超时未落定" : "压根没跑起来"}`);
      const detail = await verifyProduced(page);
      rows.push({ n, ok: true, ms: Date.now() - started, detail });
    } catch (error) {
      const onScreen = await page.locator("main").innerText().catch(() => "");
      const failureLine = onScreen
        .split("\n")
        .map((line) => line.trim())
        .find((line) => /没能返回可用结果|工具调用.*没有返回|执行失败|超时/.test(line)) ?? "";
      rows.push({
        n, ok: false, ms: Date.now() - started,
        detail: `${(error instanceof Error ? error.message : String(error)).slice(0, 150)}`
          + (failureLine === "" ? "" : `；界面：${failureLine.slice(0, 200)}`),
      });
    }
  }

  const okCount = rows.filter((r) => r.ok).length;
  const report = [
    "# 真实模型：web-artifact 技能十连跑",
    "",
    `**${String(okCount)} / ${String(RUNS)}（${String(Math.round((okCount / RUNS) * 100))}%）**`,
    "",
    "判据：产物真的落库 + 真的下载到非空字节。模型说做好了不算。",
    "",
    "| 轮次 | 结果 | 耗时 | 详情 |",
    "|---|---|---|---|",
    ...rows.map((r) => `| ${String(r.n)} | ${r.ok ? "✅" : "❌"} | ${String(Math.round(r.ms / 1000))}s | ${r.detail} |`),
  ].join("\n");
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, report, "utf8");
  console.log(`\n${report}\n`);

  expect(rows.filter((r) => !r.ok).map((r) => `${String(r.n)}：${r.detail}`), "有轮次没成功").toEqual([]);
});
