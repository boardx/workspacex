import { test, expect, type Page } from "@playwright/test";
import { CHAT_READ_E2E } from "./chat-read-fixture";

test.setTimeout(150_000);
type Run = { runId: string; threadId: string; status: string; resultMessageId: string | null; pendingApproval: { permissionRequestId: string } };
async function pendingApproval(page: Page) {
  await page.goto("/login");
  await page.getByTestId("login-email").fill(CHAT_READ_E2E.email);
  await page.getByTestId("login-password").fill(CHAT_READ_E2E.password);
  await page.getByTestId("login-submit").click();
  await page.waitForURL(/\/projects$/);
  await page.goto("/chat");
  const pending = page.waitForResponse(async response => {
    if (response.request().method() !== "GET" || !/\/agent-runs\/[^/?]+$/.test(new URL(response.url()).pathname) || !response.ok()) return false;
    const value = await response.json();
    return value.status === "awaiting_tool_permission" && Boolean(value.pendingApproval?.permissionRequestId);
  }, { timeout: 60_000 });
  await page.getByTestId("copilotkit-v2-input").fill(CHAT_READ_E2E.deepAgentApprovalTrigger);
  await page.getByTestId("copilotkit-v2-send").click();
  const response = await pending;
  const run = await response.json() as Run;
  await expect(page.getByTestId("restored-run-approval")).toBeVisible();
  const token = await page.evaluate(() => localStorage.getItem("wsx.sessionToken"));
  expect(token).toBeTruthy();
  return { run, url: response.url(), headers: { Authorization: `Bearer ${token}` } };
}

test("两个页面裁决同一审批：只有一个赢家，一条持久最终回复", async ({ page, context }) => {
  const { run, url, headers } = await pendingApproval(page);
  const second = await context.newPage();
  try {
    await second.goto(page.url());
    await expect(second.getByTestId("restored-run-approval")).toBeVisible({ timeout: 60_000 });
    const secondRun = await (await second.request.get(url, { headers })).json() as Run;
    expect(secondRun.pendingApproval.permissionRequestId).toBe(run.pendingApproval.permissionRequestId);
    const endpoint = `${url}/permission-requests/${run.pendingApproval.permissionRequestId}/decision`;
    // Both pages retain the same live request. Race the real authority endpoint,
    // without holding/intercepting either browser's production network requests.
    const decisions = await Promise.all([page, second].map(client => client.request.post(endpoint, { headers, data: { decision: "once" } })));
    expect(decisions.map(response => response.status()).sort()).toEqual([200, 409]);
    await expect.poll(async () => (await (await page.request.get(url, { headers })).json()).status, { timeout: 60_000 }).toBe("succeeded");
    const final = await (await page.request.get(url, { headers })).json() as Run;
    expect(final.runId).toBe(run.runId);
    expect(final.resultMessageId).toBeTruthy();
    const messages = await page.request.get(`${url.slice(0, url.indexOf("/agent-runs/"))}/chat/threads/${run.threadId}/messages?limit=100`, { headers });
    expect(messages.ok()).toBe(true);
    const replies = (await messages.json()).messages.filter((message: {agentRunId?: string; authorKind?: string}) => message.agentRunId === run.runId && message.authorKind === "agent");
    expect(replies).toHaveLength(1);
    expect(replies[0].id).toBe(final.resultMessageId);
    expect(replies[0].text).toContain("已按原参数执行");
    for (const client of [page, second]) {
      await client.reload();
      await expect(client.getByTestId("restored-run-approval")).toHaveCount(0);
      await expect(client.getByTestId("copilotkit-v2-messages")).toContainText("已按原参数执行", { timeout: 30_000 });
    }
    const journal = await page.request.get(`${url}/execution-events?afterSeq=-1`, { headers });
    expect(journal.ok()).toBe(true);
    const events = (await journal.json()).events as Array<{kind: string; status?: string}>;
    expect(events.filter(event => event.kind === "status" && event.status === "succeeded")).toHaveLength(1);
  } finally { await second.close(); }
});

test("待审批阶段取消：真实终态持久化，旧审批不能恢复任务", async ({ page }) => {
  const { run, url, headers } = await pendingApproval(page);
  const cancelled = await page.request.post(`${url}/cancel`, { headers });
  expect(cancelled.ok()).toBe(true);
  await expect.poll(async () => (await (await page.request.get(url, { headers })).json()).status, { timeout: 60_000 }).toBe("cancelled");
  const stale = await page.request.post(`${url}/permission-requests/${run.pendingApproval.permissionRequestId}/decision`, { headers, data: { decision: "once" } });
  expect(stale.status()).toBe(409);
  await page.reload();
  await expect(page.getByTestId("restored-run-approval")).toHaveCount(0);
  const final = await (await page.request.get(url, { headers })).json() as Run;
  expect(final.status).toBe("cancelled");
  expect(final.resultMessageId).toBeNull();
  const journal = await page.request.get(`${url}/execution-events?afterSeq=-1`, { headers });
  expect(journal.ok()).toBe(true);
  const events = (await journal.json()).events as Array<{kind: string; status?: string}>;
  expect(events.filter(event => event.kind === "status" && event.status === "cancelled")).toHaveLength(1);
  expect(events.some(event => event.kind === "status" && event.status === "succeeded")).toBe(false);
});

test("刷新和切换后仍处理同一持久审批请求", async ({ page }) => {
  const { run, url, headers } = await pendingApproval(page);
  const taskUrl = page.url();
  await page.reload();
  await expect(page.getByTestId("restored-run-approval")).toBeVisible({ timeout: 60000 });
  expect(((await (await page.request.get(url, { headers })).json()) as Run).pendingApproval.permissionRequestId).toBe(run.pendingApproval.permissionRequestId);
  await page.goto("/projects");
  await expect(page).toHaveURL(/\/projects$/);
  await page.goto(taskUrl);
  const card = page.getByTestId("restored-run-approval");
  await expect(card).toBeVisible({ timeout: 60000 });
  const decision = page.waitForResponse(response => response.request().method() === "POST" && response.url().endsWith(`/permission-requests/${run.pendingApproval.permissionRequestId}/decision`));
  await card.getByRole("button", { name: "仅本次允许", exact: true }).click();
  expect((await decision).status()).toBe(200);
  await expect.poll(async () => ((await (await page.request.get(url, { headers })).json()) as Run).status, { timeout: 60000 }).toBe("succeeded");
  await expect(card).toHaveCount(0);
  await expect(page.getByTestId("copilotkit-v2-messages")).toContainText("已按原参数执行", { timeout: 30000 });
  const final = await (await page.request.get(url, { headers })).json() as Run;
  expect(final.runId).toBe(run.runId);
  expect(final.resultMessageId).toBeTruthy();
});
