import { test, expect } from "@playwright/test";
import { CHAT_READ_E2E } from "./chat-read-fixture";

// Approval is now an inline durable decision. Escape never silently authorizes or denies.
test.setTimeout(150_000);
const OVERLAY_SELECTOR = '[data-state="open"][aria-hidden="true"].fixed.inset-0.z-50';

test("常显审批无全屏遮罩；Escape不裁决；重复拒绝只提交一次，结束后能发送下一条", async ({ page }) => {
  await page.goto("/login");
  await page.getByTestId("login-email").fill(CHAT_READ_E2E.email);
  await page.getByTestId("login-password").fill(CHAT_READ_E2E.password);
  await page.getByTestId("login-submit").click();
  await page.waitForURL(/\/projects$/);
  await expect.poll(async () => (await page.request.get("/api/copilotkit/info")).status(), { timeout: 60_000 }).toBe(200);
  await page.goto("/chat");
  const decisions: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && /\/permission-requests\/[^/]+\/decision$/.test(new URL(request.url()).pathname)) decisions.push(request.url());
  });
  await page.getByTestId("copilotkit-v2-input").fill(CHAT_READ_E2E.deepAgentApprovalTrigger);
  await page.getByTestId("copilotkit-v2-send").click();
  const approval = page.getByTestId("restored-run-approval");
  await expect(approval).toBeVisible({ timeout: 60_000 });
  await expect(page.locator(OVERLAY_SELECTOR)).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(approval).toBeVisible();
  expect(decisions).toHaveLength(0);

  const decided = page.waitForResponse((response) => response.request().method() === "POST" && /\/permission-requests\/[^/]+\/decision$/.test(new URL(response.url()).pathname));
  await approval.getByRole("button", { name: "拒绝", exact: true }).evaluate((button: HTMLButtonElement) => { button.click(); button.click(); });
  const response = await decided;
  expect(response.status()).toBe(200);
  expect(response.request().postDataJSON()).toEqual({ decision: "deny" });
  await expect(approval).toHaveCount(0);
  await expect(page.getByTestId("copilotkit-v2-messages")).toContainText("已按你的选择跳过这次技能调用", { timeout: 60_000 });
  expect(decisions).toHaveLength(1);
  await expect(page.locator(OVERLAY_SELECTOR)).toHaveCount(0);

  const nextRun = page.waitForRequest((request) => request.method() === "POST" && new URL(request.url()).pathname.endsWith("/agent/default/run"));
  await page.getByTestId("copilotkit-v2-input").fill("你好，这是一条简单的问候消息");
  await page.getByTestId("copilotkit-v2-send").click();
  await nextRun;
  await expect(page.getByTestId("copilotkit-v2-messages")).toContainText("你好，这是一条简单的问候消息");
});
