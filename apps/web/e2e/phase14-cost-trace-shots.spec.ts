import { test, expect, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

/**
 * 取证：把 Phase 14「成本条 + 工具量化摘要」UI 先行原型各状态截图，落到
 * phases/phase-14-chat-agentic-runtime-parity/ui-preview/。
 * 纯前端 mock 预览页（不接后端），对已预热 dev server（默认 3242）截图。
 */
const OUT = join(
  process.cwd(), "..", "..",
  "phases", "phase-14-chat-agentic-runtime-parity", "ui-preview",
);
mkdirSync(OUT, { recursive: true });

test.use({ viewport: { width: 1100, height: 900 } });

async function shot(page: Page, name: string) {
  await page.waitForTimeout(250);
  await page.screenshot({ path: join(OUT, `${name}.png`), fullPage: true });
}

/* ── 需求 1：成本条七态 + 逼近/超支 ── */

const COST_SCENES: Array<[string, string]> = [
  ["default", "cost-bar-default"],
  ["loading", "cost-bar-loading"],
  ["empty", "cost-bar-empty"],
  ["invalid", "cost-bar-invalid"],
  ["dep-failed", "cost-bar-dep-failed"],
  ["denied", "cost-bar-denied"],
  ["success", "cost-bar-success"],
  ["warning", "cost-bar-warning"],
  ["over", "cost-bar-over"],
];

for (const [scene, name] of COST_SCENES) {
  test(`cost bar · ${scene}`, async ({ page }) => {
    await page.goto(`/preview/plan-run-cost?scene=${scene}`);
    await page.waitForLoadState("networkidle").catch(() => {});
    await expect(page.getByTestId("plan-run-cost-preview")).toBeVisible();
    await expect(page.getByTestId("chat-task-workbench-run-cost")).toBeVisible();
    await shot(page, `req1-${name}`);
  });
}

/* ── 需求 2：工具量化摘要三场景 ── */

const SUMMARY_SCENES: Array<[string, string]> = [
  ["with-summary", "tool-summary-with-summary"],
  ["mixed", "tool-summary-mixed"],
  ["fallback", "tool-summary-fallback"],
];

for (const [scene, name] of SUMMARY_SCENES) {
  test(`tool summary · ${scene}`, async ({ page }) => {
    await page.goto(`/preview/tool-summary?scene=${scene}`);
    await page.waitForLoadState("networkidle").catch(() => {});
    await expect(page.getByTestId("tool-summary-preview")).toBeVisible();
    await expect(page.getByTestId("agent-tool-chain-detail")).toBeVisible();
    await shot(page, `req2-${name}`);
  });
}
