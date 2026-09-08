import { test, expect } from "@playwright/test";
import { CHAT_READ_E2E } from "./chat-read-fixture";

/**
 * 审批是一次**持久**裁决：Escape 永远不会静默批准或拒绝。
 *
 * #2999 A 组 —— 本用例原来的第一条判据是「常显审批**无全屏遮罩**」
 * （`OVERLAY_SELECTOR` count 0）。#2890/#2909/#2948 把审批改成 Radix 模态卡，
 * `components/ui/dialog.tsx` 的 `DialogContent` **无条件**渲染 `<DialogOverlay />`，
 * 该判据在模态形态下结构上不可能成立。coordinator 已裁决（issue #2999，2026-09-08）：
 * **保持模态审批，改 spec 判据**。
 *
 * 所以这里不是把那条判据删掉了事，而是换成模态形态下**等价的用户可见保证**——
 * 遮罩必须随裁决一起消失、界面不能被残留遮罩挡死（原判据真正在防的那件事）：
 *   ① 待审批时遮罩存在（模态是新验收形态，如实断言，不假装它不在）；
 *   ② Escape 不裁决（零 decision POST）——安全语义，原样保留且加强：
 *      Escape 之后审批**没有丢**，仍可重新打开继续裁决；
 *   ③ 裁决落地后遮罩必须归零，且下一条消息真的能发出去。
 * ②③ 与「重复拒绝只提交一次」都是原判据，一条未放宽。
 */
test.setTimeout(150_000);
/**
 * 选择器逐字沿用旧判据，**没有放宽**：`components/ui/dialog.tsx` 的 `DialogOverlay`
 * className 是 `fixed inset-0 z-50 bg-inverse/40 backdrop-blur-sm`，Radix 打开时给它
 * `data-state="open"` 与 `aria-hidden="true"`。
 * 已用组件级反证确认它**不是恒真的空洞门**（jsdom 渲染一个打开的 `DialogContent`，
 * 该选择器匹配到 1 个节点）——所以下面 ③ 的 `toHaveCount(0)` 是一句会红的话。
 */
const OVERLAY_SELECTOR = '[data-state="open"][aria-hidden="true"].fixed.inset-0.z-50';

test("模态审批：Escape不裁决且审批不丢；重复拒绝只提交一次；裁决后遮罩归零并能发下一条", async ({ page }) => {
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
  const permissionDialog = page.getByTestId("chat-tool-permission-dialog");
  await expect(approval).toBeVisible({ timeout: 60_000 });
  // ① 模态是新验收形态：弹窗与遮罩都在。
  await expect(permissionDialog).toBeVisible({ timeout: 30_000 });
  await expect(page.locator(OVERLAY_SELECTOR)).not.toHaveCount(0);

  // ② Escape 关闭弹层，但**不裁决**，而且审批本身没有消失——重新打开还能继续裁。
  await page.keyboard.press("Escape");
  await expect(permissionDialog).toHaveCount(0);
  await expect(approval).toBeVisible();
  expect(decisions).toHaveLength(0);
  await approval.getByRole("button", { name: "打开工具审批", exact: true }).click();
  await expect(permissionDialog).toBeVisible();
  expect(decisions).toHaveLength(0);

  // ③ 重复点「拒绝」只允许提交一次（组件的 inFlight 去重），两次点击同一帧内发出。
  const decided = page.waitForResponse((response) => response.request().method() === "POST" && /\/permission-requests\/[^/]+\/decision$/.test(new URL(response.url()).pathname));
  await permissionDialog.getByTestId("perm-deny").evaluate((button: HTMLButtonElement) => { button.click(); button.click(); });
  const response = await decided;
  expect(response.status()).toBe(200);
  expect(response.request().postDataJSON()).toEqual({ decision: "deny" });
  await expect(approval).toHaveCount(0);
  await expect(page.getByTestId("copilotkit-v2-messages")).toContainText("已按你的选择跳过这次技能调用", { timeout: 60_000 });
  expect(decisions).toHaveLength(1);
  // 裁决落地后遮罩必须归零：模态可以挡住输入，但不能在审批结束后继续挡。
  await expect(permissionDialog).toHaveCount(0);
  await expect(page.locator(OVERLAY_SELECTOR)).toHaveCount(0);

  const nextRun = page.waitForRequest((request) => request.method() === "POST" && new URL(request.url()).pathname.endsWith("/agent/default/run"));
  await page.getByTestId("copilotkit-v2-input").fill("你好，这是一条简单的问候消息");
  await page.getByTestId("copilotkit-v2-send").click();
  await nextRun;
  await expect(page.getByTestId("copilotkit-v2-messages")).toContainText("你好，这是一条简单的问候消息");
});
