import { test, expect, type Page } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { CHAT_READ_E2E } from "./chat-read-fixture";
import { DEEP_AGENT_HITL_TOOL_NAME } from "@repo/contracts/deep-agent-hitl";

const OUT = resolve(process.env.COPILOTKIT_V2_HITL_OUT ?? ".copilotkit-v2-hitl");
test.setTimeout(150_000);

type PendingRun = { runId: string; threadId: string; status: string; pendingApproval: { permissionRequestId: string; toolName: string; argsSummary: string | null } };
async function triggerApproval(page: Page): Promise<{ run: PendingRun; runUrl: string; headers: Record<string, string> }> {
  await page.goto("/login");
  await page.getByTestId("login-email").fill(CHAT_READ_E2E.email);
  await page.getByTestId("login-password").fill(CHAT_READ_E2E.password);
  await page.getByTestId("login-submit").click();
  await page.waitForURL(/\/projects$/);
  await expect.poll(async () => (await page.request.get("/api/copilotkit/info")).status(), { timeout: 60_000 }).toBe(200);
  await page.goto("/chat");
  const pendingResponse = page.waitForResponse(async (response) => {
    if (response.request().method() !== "GET" || !/\/agent-runs\/[^/?]+$/.test(new URL(response.url()).pathname) || !response.ok()) return false;
    const body = await response.json();
    return body.status === "awaiting_tool_permission" && Boolean(body.pendingApproval?.permissionRequestId);
  }, { timeout: 60_000 });
  await page.getByTestId("copilotkit-v2-input").fill(CHAT_READ_E2E.deepAgentApprovalTrigger);
  await page.getByTestId("copilotkit-v2-send").click();
  const response = await pendingResponse;
  const run = await response.json() as PendingRun;
  await expect(page.getByTestId("restored-run-approval")).toBeVisible({ timeout: 30_000 });
  const token = await page.evaluate(() => localStorage.getItem("wsx.sessionToken"));
  expect(token).toBeTruthy();
  return { run, runUrl: response.url(), headers: { Authorization: `Bearer ${token}` } };
}

async function decide(page: Page, run: PendingRun, decision: "once" | "forever" | "deny", label: string): Promise<void> {
  const response = page.waitForResponse((value) => value.request().method() === "POST" && value.url().includes(`/agent-runs/${run.runId}/permission-requests/${run.pendingApproval.permissionRequestId}/decision`));
  await page.getByTestId("restored-run-approval").getByRole("button", { name: label, exact: true }).click();
  const result = await response;
  expect(result.status()).toBe(200);
  expect(result.request().postDataJSON()).toEqual({ decision });
  expect(await result.json()).toEqual({ runId: run.runId, permissionRequestId: run.pendingApproval.permissionRequestId });
  await expect(page.getByTestId("restored-run-approval")).toHaveCount(0);
}

async function assertCompleted(page: Page, runUrl: string, headers: Record<string, string>, text: string): Promise<void> {
  await expect.poll(async () => {
    const response = await page.request.get(runUrl, { headers });
    expect(response.ok()).toBe(true);
    return (await response.json()).status;
  }, { timeout: 60_000 }).toBe("succeeded");
  await expect(page.getByTestId("copilotkit-v2-messages")).toContainText(text, { timeout: 30_000 });
  const journal = await page.request.get(`${runUrl}/execution-events?afterSeq=-1`, { headers });
  expect(journal.ok()).toBe(true);
  const events = (await journal.json()).events as Array<{ kind: string; status?: string; toolName?: string }>;
  expect(events.some((event) => event.kind === "tool_start" && event.toolName === DEEP_AGENT_HITL_TOOL_NAME)).toBe(true);
  expect(events.some((event) => event.kind === "status" && event.status === "failed")).toBe(false);
  mkdirSync(OUT, { recursive: true });
  writeFileSync(resolve(OUT, `${new URL(runUrl).pathname.split("/").at(-1)}-journal.json`), JSON.stringify(events, null, 2));
}

test("once：常显四选一审批，服务端恢复同一任务并完成", async ({ page }) => {
  const { run, runUrl, headers } = await triggerApproval(page);
  const approval = page.getByTestId("restored-run-approval");
  for (const label of ["仅本次允许", "本任务内允许", "以后都允许", "拒绝"]) await expect(approval.getByRole("button", { name: label, exact: true })).toBeVisible();
  expect(run.pendingApproval.toolName).toBe(DEEP_AGENT_HITL_TOOL_NAME);
  await expect(approval).toContainText("quarterly-report");
  await decide(page, run, "once", "仅本次允许");
  await assertCompleted(page, runUrl, headers, "已按原参数执行");
});

test("deny：拒绝技能后任务调整继续，不变成HITL_REJECTED失败", async ({ page }) => {
  const { run, runUrl, headers } = await triggerApproval(page);
  await decide(page, run, "deny", "拒绝");
  await assertCompleted(page, runUrl, headers, "已按你的选择跳过这次技能调用");
});

test("刷新等待审批：恢复同一请求身份，批准后REST流式恢复最终回答", async ({ page }) => {
  const { run, runUrl, headers } = await triggerApproval(page);
  await page.reload();
  await expect(page.getByTestId("restored-run-approval")).toBeVisible({ timeout: 60_000 });
  const restored = await (await page.request.get(runUrl, { headers })).json() as PendingRun;
  expect(restored.pendingApproval.permissionRequestId).toBe(run.pendingApproval.permissionRequestId);
  await decide(page, run, "once", "仅本次允许");
  await assertCompleted(page, runUrl, headers, "已按原参数执行");
  // Replaying an old approval must never act on a later request.
  const stale = await page.request.post(`${runUrl}/permission-requests/${run.pendingApproval.permissionRequestId}/decision`, { headers, data: { decision: "once" } });
  expect(stale.status()).toBe(409);
});

test("forever：真实持久审批端口发送契约forever而非展示文案always", async ({ page }) => {
  const { run, runUrl, headers } = await triggerApproval(page);
  await decide(page, run, "forever", "以后都允许");
  await assertCompleted(page, runUrl, headers, "已按原参数执行");
});
