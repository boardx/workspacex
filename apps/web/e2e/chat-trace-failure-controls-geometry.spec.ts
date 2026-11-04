import { join } from "node:path";
import { test, expect } from "@playwright/test";
import { buildTraceFixture } from "./fixtures/build-trace-fixture";
test("failed trace keeps the default summary compact", async ({ page }) => {
  await page.goto(buildTraceFixture(join(__dirname, "fixtures", "trace-failure-controls-fixture.tsx"), "failure-controls-"));
  await expect(page.getByTestId("run-trace-toggle")).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByTestId("run-trace-plan")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "隐藏失败记录" })).toBeVisible();
  const box = await page.getByTestId("run-trace-panel").boundingBox();
  expect(box!.height).toBeLessThan(100);
  await page.screenshot({ path: "../../evidence/chat-failure-controls-6244/compact-failed-trace.png" });
});
